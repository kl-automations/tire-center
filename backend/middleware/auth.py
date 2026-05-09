"""
JWT auth dependency.
Usage in a route:  shop = Depends(get_current_shop)
Returns:           { "shop_id": str, "erp_hash": str }
"""

from typing import Annotated

from fastapi import Cookie, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt

from config import JWT_SECRET
from logging_utils import log, log_error

_bearer = HTTPBearer(auto_error=False)

ALGORITHM = "HS256"


def _decode_shop_jwt(token: str) -> dict:
    payload = jwt.decode(
        token,
        JWT_SECRET,
        algorithms=[ALGORITHM],
    )
    shop_id: str = payload.get("shop_id")
    erp_hash: str = payload.get("erp_hash")
    if not shop_id or not erp_hash:
        raise ValueError("missing claims")
    log("AUTH", f"JWT verified shop_id={shop_id}")
    return {"shop_id": shop_id, "erp_hash": erp_hash}


def get_current_shop(
    jwt_cookie: Annotated[str | None, Cookie(alias="token")] = None,
    credentials: Annotated[
        HTTPAuthorizationCredentials | None,
        Depends(_bearer),
    ] = None,
) -> dict:
    """
    Validates the HS256 JWT from the HttpOnly cookie (``token``) or, during
    rollout, the ``Authorization: Bearer`` header. Cookie is preferred when both
    are present so the browser session stays authoritative once PR-B lands.

    Returns:
        { "shop_id": str, "erp_hash": str }

    Raises:
        401 Unauthorized: Token is missing, expired, has an invalid signature,
                          or is missing required claims.
    """
    token: str | None = None
    if jwt_cookie:
        token = jwt_cookie
    elif credentials:
        token = credentials.credentials
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )
    try:
        return _decode_shop_jwt(token)
    except (JWTError, ValueError) as e:
        log_error("auth", f"JWT verification failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )
