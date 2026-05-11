"""
Authentication router — two-step OTP login backed by the ERP SOAP service.

Flow:
  1. POST /api/auth/request-code  →  ERP IsValidUser  →  ERP sends OTP via SMS
  2. POST /api/auth/verify         →  ERP Login         →  JWT returned to client

The JWT payload is { shop_id, erp_hash, exp } and optionally erp_shop_id (numeric
Tafnit shop key from IsValidUser AdditionalData). All protected routes read
shop_id and erp_hash from the token via the get_current_shop dependency.
"""

import hashlib
import os
import time
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Response
from firebase_admin import auth as firebase_admin_auth
from jose import jwt

from adapters import erp
from config import JWT_SECRET
from logging_utils import log, log_error
from middleware.auth import get_current_shop
from models.schemas import (
    FirebaseCustomTokenResponse,
    RequestCodeRequest,
    RequestCodeResponse,
    VerifyOtpRequest,
    VerifyOtpResponse,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])

ALGORITHM = "HS256"
TOKEN_TTL_DAYS = 180
# Local HTTP dev: set COOKIE_SECURE=0 so the browser accepts Set-Cookie without Secure.
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "1").strip().lower() in ("1", "true", "yes")

# Bridges request-code → verify within one process: stores erp_shop_id from IsValidUser
# until Login succeeds. TODO(b2b): multi-instance deploys need a shared store (Redis/DB);
# this dict is per-process only.
_PENDING_LOGIN_TTL_S = 600
_pending_login_erp_shop: dict[str, tuple[str, float]] = {}


def _prune_pending_login_cache() -> None:
    now = time.time()
    dead = [k for k, (_, exp) in _pending_login_erp_shop.items() if exp <= now]
    for k in dead:
        del _pending_login_erp_shop[k]


def _cache_pending_login(user_code: str, erp_shop_id: str) -> None:
    _prune_pending_login_cache()
    _pending_login_erp_shop[user_code] = (erp_shop_id, time.time() + _PENDING_LOGIN_TTL_S)


def _consume_pending_login(user_code: str) -> str | None:
    _prune_pending_login_cache()
    entry = _pending_login_erp_shop.pop(user_code, None)
    if entry is None:
        return None
    erp_id, exp = entry
    if exp <= time.time():
        return None
    return erp_id


def _make_token(user_code: str, otp: str, erp_shop_id: str | None = None) -> str:
    """
    Sign and return a JWT for the given user code.

    shop_id is set to user_code (confirmed correct mapping). erp_hash is set
    to the OTP submitted during verification, which acts as the session hash
    used on subsequent ERP SOAP calls. erp_shop_id is optional and omitted
    from the payload when None (legacy / dev without AdditionalData).
    """
    payload: dict = {
        "shop_id": user_code,
        "erp_hash": otp,
        "exp": datetime.now(timezone.utc) + timedelta(days=TOKEN_TTL_DAYS),
    }
    if erp_shop_id is not None:
        payload["erp_shop_id"] = erp_shop_id
    return jwt.encode(payload, JWT_SECRET, algorithm=ALGORITHM)


@router.post(
    "/request-code",
    response_model=RequestCodeResponse,
    summary="Send OTP to mechanic (step 1 of login)",
    description=(
        "Calls the ERP **IsValidUser** SOAP method with the mechanic's user code. "
        "If the user is valid the ERP dispatches an OTP via SMS. "
        "When **ERP_TEST_MODE=true** the raw OTP is also returned in "
        "`otp_debug` so you can test without a real phone."
    ),
    response_description="Confirmation that the OTP was dispatched.",
)
async def request_code(body: RequestCodeRequest):
    """Step 1 — validate user code and trigger OTP dispatch via ERP IsValidUser."""
    log("ROUTER/auth", f"request-code received userCode={body.userCode}")
    result = await erp.request_otp(body.userCode)
    if not result["success"]:
        log_error("auth", f"request-code ERP rejected userCode={body.userCode}")
        raise HTTPException(status_code=400, detail="erp_rejected_user")
    eid = result.get("erp_shop_id")
    if eid is not None:
        _cache_pending_login(body.userCode, eid)
    log("ROUTER/auth", f"request-code success userCode={body.userCode}")
    return RequestCodeResponse(success=True, otp_debug=result["otp_debug"])


@router.post(
    "/verify",
    response_model=VerifyOtpResponse,
    summary="Verify OTP and receive JWT (step 2 of login)",
    description=(
        "Submits the mechanic's user code and OTP to the ERP **Login** SOAP method. "
        "On success a signed JWT (HS256) is returned in the body **and** set as an "
        "HttpOnly cookie (`token`, Path=/api). Clients may use either the cookie or "
        "**Authorization: Bearer** until the frontend migrates to cookie-only auth."
    ),
    response_description="Signed JWT (also mirrored in HttpOnly cookie for PR-A rollout).",
)
async def verify(response: Response, body: VerifyOtpRequest):
    """Step 2 — verify OTP via ERP Login; return JWT in body and Set-Cookie."""
    log("ROUTER/auth", f"verify received userCode={body.userCode}")
    result = await erp.verify_login(body.userCode, body.otp)
    if not result["success"]:
        log_error("auth", f"verify invalid OTP userCode={body.userCode} message={result.get('message')}")
        raise HTTPException(status_code=401, detail="invalid_otp")
    erp_shop_id = _consume_pending_login(body.userCode)
    if erp_shop_id is None:
        log(
            "ROUTER/auth",
            "WARNING: verify had no pending erp_shop_id (cache miss / restart / IsValidUser omitted AdditionalData) "
            f"userCode={body.userCode}",
        )
    token = _make_token(body.userCode, body.otp, erp_shop_id)
    log("ROUTER/auth", f"verify success userCode={body.userCode} JWT issued (TTL={TOKEN_TTL_DAYS}d)")
    max_age = TOKEN_TTL_DAYS * 24 * 3600
    response.set_cookie(
        key="token",
        value=token,
        max_age=max_age,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite="strict",
        path="/api",
    )
    return VerifyOtpResponse(success=True, token=token)


@router.post(
    "/logout",
    summary="Clear session cookie",
    description=(
        "Clears the HttpOnly `token` cookie. Does not require a valid JWT — idempotent. "
        "PR-B: call from the PWA on logout alongside clearing any legacy client state."
    ),
)
async def logout(response: Response):
    """Expire the session cookie."""
    response.set_cookie(
        key="token",
        value="",
        max_age=0,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite="strict",
        path="/api",
    )
    return {"ok": True}


@router.post(
    "/firebase-custom-token",
    response_model=FirebaseCustomTokenResponse,
    response_model_exclude_none=True,
    summary="Mint a Firebase custom token for Firestore listeners",
    description=(
        "Returns a Firebase Auth custom token for the authenticated mechanic's shop. "
        "The client signs in with `signInWithCustomToken` and subscribes to "
        "`orders/{shop_id}/updates` via onSnapshot. Requires the same Bearer JWT as "
        "all other protected routes."
    ),
)
async def firebase_custom_token(shop: dict = Depends(get_current_shop)):
    """Mint a custom token with claim `shop_id` (and `erp_shop_id` when present) for Firestore rules."""
    shop_id = shop["shop_id"]
    uid = "m_" + hashlib.sha256(shop_id.encode("utf-8")).hexdigest()
    claims: dict = {"shop_id": shop_id}
    erp_shop_id = shop.get("erp_shop_id")
    if erp_shop_id is not None:
        claims["erp_shop_id"] = erp_shop_id
    try:
        tok = firebase_admin_auth.create_custom_token(uid, claims)
    except Exception as e:
        log_error("auth", f"firebase custom token failed shop_id={shop_id}: {e}")
        raise HTTPException(status_code=503, detail="firebase_token_unavailable") from e
    token_str = tok.decode("utf-8") if isinstance(tok, bytes) else str(tok)
    log("ROUTER/auth", f"firebase-custom-token issued shop_id={shop_id}")
    return FirebaseCustomTokenResponse(
        custom_token=token_str,
        shop_id=shop_id,
        erp_shop_id=erp_shop_id,
    )
