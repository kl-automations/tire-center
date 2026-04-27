"""
JWT auth dependency.
Usage in a route:  shop = Depends(get_current_shop)
Returns:           { "shop_id": str, "erp_hash": str }
"""

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from config import JWT_SECRET
from logging_utils import log, log_error

_bearer = HTTPBearer()

ALGORITHM = "HS256"


def get_current_shop(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
) -> dict:
    """
    FastAPI dependency that validates the Bearer JWT and returns the shop context.

    Decodes the HS256 JWT from the Authorization header, verifies the signature
    against JWT_SECRET, and checks that both shop_id and erp_hash claims are present.

    Returns:
        { "shop_id": str, "erp_hash": str }

    Raises:
        401 Unauthorized: Token is missing, expired, has an invalid signature,
                          or is missing required claims.
    """
    token = credentials.credentials
    try:
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
    except (JWTError, ValueError) as e:
        log_error("auth", f"JWT verification failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )
