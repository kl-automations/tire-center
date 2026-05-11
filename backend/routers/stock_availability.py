"""
Stock Availability router — initial page-state endpoint for mechanic UI.
"""

from fastapi import APIRouter, Depends, Request

from logging_utils import log
from middleware.auth import get_current_shop

router = APIRouter(prefix="/api/stock-availability", tags=["stock-availability"])


@router.get(
    "/requests",
    summary="List stock-availability requests for authenticated shop",
    description=(
        "Returns current stock-availability rows scoped to the mechanic's shop. "
        "Only live/accepted rows are returned for initial UI hydration."
    ),
)
async def list_stock_availability_requests(
    request: Request,
    shop: dict = Depends(get_current_shop),
):
    db = request.app.state.db
    erp_shop_id = shop.get("erp_shop_id")
    if not erp_shop_id:
        log(
            "ROUTER/stock-availability",
            "WARNING: list requests skipped — JWT has no erp_shop_id (legacy token); returning empty",
        )
        return {"requests": []}

    log("ROUTER/stock-availability", f"list requests erp_shop_id={erp_shop_id}")

    rows = await db.fetch(
        """
        SELECT request_id, tire_size, quantity, status
        FROM stock_availability_requests
        WHERE shop_id = $1 AND status IN ('live', 'accepted')
        ORDER BY created_at DESC
        """,
        erp_shop_id,
    )

    requests = [
        {
            "request_id": row["request_id"],
            "tire_size": row["tire_size"],
            "quantity": int(row["quantity"]),
            "status": row["status"],
        }
        for row in rows
    ]
    log(
        "ROUTER/stock-availability",
        f"list requests returning={len(requests)} erp_shop_id={erp_shop_id}",
    )
    return {"requests": requests}
