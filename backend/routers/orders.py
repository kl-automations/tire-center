"""
Orders router — read-only access to a shop's open service orders.

Both endpoints are scoped to the authenticated shop_id from the JWT:
no mechanic can ever read another shop's orders, even if they know the UUID.
Declined orders are excluded from the list endpoint (they are cleaned up
nightly by /internal/cleanup) but remain accessible by direct ID lookup
until deleted.
"""

from fastapi import APIRouter, Depends, HTTPException, Request
from middleware.auth import get_current_shop

router = APIRouter(prefix="/api/orders", tags=["orders"])


@router.get(
    "",
    summary="List all open service orders for the authenticated shop",
    description=(
        "Returns all non-declined orders for the shop identified by the JWT. "
        "Orders are sorted newest-first. Declined orders are omitted from the list "
        "(they are deleted by the nightly cleanup job). "
        "Response shape: `{ total: int, orders: [...] }`."
    ),
    response_description="Paginated list of open orders with full DB columns.",
)
async def list_orders(
    request: Request,
    shop: dict = Depends(get_current_shop),
):
    """
    Fetch all non-declined orders for the authenticated shop.

    Reads shop_id from the JWT (never from the request body). Returns all
    columns from open_orders except declined rows, ordered by created_at DESC.
    UUIDs are coerced to strings for JSON serialisation.
    """
    db = request.app.state.db
    rows = await db.fetch(
        """
        SELECT id, request_id, license_plate, plate_type, mileage,
               car_data, diagnosis, status, carool_diagnosis_id,
               created_at, updated_at
        FROM open_orders
        WHERE shop_id = $1 AND status != 'declined'
        ORDER BY created_at DESC
        """,
        shop["shop_id"],
    )
    orders = [dict(r) for r in rows]
    for o in orders:
        o["id"] = str(o["id"])
    return {"total": len(orders), "orders": orders}


@router.get(
    "/{order_id}",
    summary="Get a single service order by ID",
    description=(
        "Returns the full detail row for the given order UUID. "
        "Returns **404** if the order does not exist **or** belongs to a different shop — "
        "these two cases are intentionally indistinguishable for security."
    ),
    response_description="Full open_orders row for the requested order.",
)
async def get_order(
    order_id: str,
    request: Request,
    shop: dict = Depends(get_current_shop),
):
    """
    Fetch a single order by UUID, enforcing shop ownership.

    The shop_id from the JWT is included in the WHERE clause so that a mechanic
    cannot enumerate other shops' orders by guessing UUIDs.

    Raises:
        404: Order not found or belongs to a different shop.
    """
    db = request.app.state.db
    row = await db.fetchrow(
        """
        SELECT id, request_id, license_plate, plate_type, mileage,
               car_data, diagnosis, status, carool_diagnosis_id,
               created_at, updated_at
        FROM open_orders
        WHERE id = $1 AND shop_id = $2
        """,
        order_id, shop["shop_id"],
    )
    if not row:
        raise HTTPException(status_code=404, detail="Order not found")
    result = dict(row)
    result["id"] = str(result["id"])
    return result
