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
    payload = {
        "shop_id": user_code,   # other routers read shop["shop_id"]
        "erp_hash": user_code,  # kept for router compatibility; replace when ERP sessions are defined
        "exp": datetime.now(timezone.utc) + timedelta(hours=TOKEN_TTL_HOURS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=ALGORITHM)


@router.post("/request-code", response_model=RequestCodeResponse)
async def request_code(body: RequestCodeRequest):
    """Phase 1 — trigger IsValidUser; ERP sends OTP via SMS."""
    result = await erp.request_otp(body.userCode)
    if not result["success"]:
        raise HTTPException(status_code=400, detail="erp_rejected_user")
    return RequestCodeResponse(success=True, otp_debug=result["otp_debug"])


@router.post("/verify", response_model=VerifyOtpResponse)
async def verify(body: VerifyOtpRequest):
    """Phase 2 — submit OTP via Login; returns JWT on success."""
    result = await erp.verify_login(body.userCode, body.otp)
    if not result["success"]:
        raise HTTPException(status_code=401, detail="invalid_otp")
    token = _make_token(body.userCode)
    return VerifyOtpResponse(success=True, token=token)
