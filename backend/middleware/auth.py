"""
JWT auth dependency.
Usage in a route:  shop = Depends(get_current_shop)
Returns:           { "shop_id": str, "erp_hash": str }
"""

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from config import JWT_SECRET

_bearer = HTTPBearer()

ALGORITHM = "HS256"


def get_current_shop(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
) -> dict:
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
        return {"shop_id": shop_id, "erp_hash": erp_hash}
    except (JWTError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )
