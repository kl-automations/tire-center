from fastapi import APIRouter, Depends, Request
from middleware.auth import get_current_shop
from models.schemas import CarLookupRequest
from adapters import erp

router = APIRouter(prefix="/api", tags=["car"])


@router.post("/car")
async def car_lookup(
    body: CarLookupRequest,
    request: Request,
    shop: dict = Depends(get_current_shop),
):
    car_data = await erp.lookup_car(
        license_plate=body.license_plate,
        mileage=body.mileage,
        shop_id=shop["shop_id"],
        erp_hash=shop["erp_hash"],
    )

    db = request.app.state.db
    order_id = await db.fetchval(
        """
        INSERT INTO open_orders
          (shop_id, license_plate, plate_type, mileage, car_data, request_id, erp_hash)
        VALUES ($1, $2, 'civilian', $3, $4, $5, $6)
        RETURNING id
        """,
        shop["shop_id"],
        body.license_plate,
        body.mileage,
        car_data,
        car_data.get("request_id"),
        shop["erp_hash"],
    )

    return {
        "order_id": str(order_id),
        **car_data,
    }
