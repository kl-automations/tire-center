from fastapi import APIRouter, Depends, HTTPException, Request
from middleware.auth import get_current_shop

router = APIRouter(prefix="/api/orders", tags=["orders"])


@router.get("")
async def list_orders(
    request: Request,
    shop: dict = Depends(get_current_shop),
):
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


@router.get("/{order_id}")
async def get_order(
    order_id: str,
    request: Request,
    shop: dict = Depends(get_current_shop),
):
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
