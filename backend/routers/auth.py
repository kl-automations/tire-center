"""
Authentication router — two-step OTP login backed by the ERP SOAP service.

Flow:
  1. POST /api/auth/request-code  →  ERP IsValidUser  →  ERP sends OTP via SMS
  2. POST /api/auth/verify         →  ERP Login         →  JWT returned to client

The JWT payload is { shop_id, erp_hash, exp }. All protected routes read
shop_id and erp_hash from the token via the get_current_shop dependency.
"""

from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, HTTPException
from jose import jwt
from config import JWT_SECRET
from models.schemas import RequestCodeRequest, RequestCodeResponse, VerifyOtpRequest, VerifyOtpResponse
from adapters import erp

router = APIRouter(prefix="/api/auth", tags=["auth"])

ALGORITHM = "HS256"
TOKEN_TTL_HOURS = 12


def _make_token(user_code: str) -> str:
    """
    Sign and return a 12-hour JWT for the given user code.

    The shop_id and erp_hash claims are both set to user_code as a placeholder
    until the ERP team finalises the session-hash semantics (see open question Q1
    in backend-plan.md). Replace both values once the ERP Login response
    includes a real shop_id and hash.
    """
    payload = {
        "shop_id": user_code,   # TODO: replace with ERP-returned shop_id
        "erp_hash": user_code,  # TODO: replace with ERP-returned erp_hash
        "exp": datetime.now(timezone.utc) + timedelta(hours=TOKEN_TTL_HOURS),
    }
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
    result = await erp.request_otp(body.userCode)
    if not result["success"]:
        raise HTTPException(status_code=400, detail="erp_rejected_user")
    return RequestCodeResponse(success=True, otp_debug=result["otp_debug"])


@router.post(
    "/verify",
    response_model=VerifyOtpResponse,
    summary="Verify OTP and receive JWT (step 2 of login)",
    description=(
        "Submits the mechanic's user code and OTP to the ERP **Login** SOAP method. "
        "On success a signed JWT (HS256, 12-hour TTL) is returned. "
        "Include it as **Authorization: Bearer \\<token\\>** on every subsequent request."
    ),
    response_description="Signed JWT to use as Bearer token on all protected endpoints.",
)
async def verify(body: VerifyOtpRequest):
    """Step 2 — verify OTP via ERP Login; return a signed JWT on success."""
    result = await erp.verify_login(body.userCode, body.otp)
    if not result["success"]:
        raise HTTPException(status_code=401, detail="invalid_otp")
    token = _make_token(body.userCode)
    return VerifyOtpResponse(success=True, token=token)
