"""
Car-lookup router — opens a new service order for a given licence plate.

Wave 1 of the request flow:
  Frontend  →  POST /api/car  →  ERP Apply (SOAP)
            →  INSERT open_orders (status='open')
            →  return vehicle + order data to frontend
"""

import json

from fastapi import APIRouter, Depends, HTTPException, Request
from middleware.auth import get_current_shop
from models.schemas import CarLookupRequest
from adapters import erp

router = APIRouter(prefix="/api", tags=["car"])


@router.post(
    "/car",
    summary="Look up vehicle and open a service order",
    description=(
        "Calls the ERP **Apply** SOAP method to fetch vehicle details "
        "(tyre sizes, quality tier, wheel count, etc.) for the given licence plate. "
        "On success, inserts a row in **open_orders** with `status='open'` and "
        "returns the vehicle data together with the new `order_id`."
    ),
    response_description=(
        "Vehicle data from the ERP merged with the newly created `order_id` (UUID)."
    ),
)
async def car_lookup(
    body: CarLookupRequest,
    request: Request,
    shop: dict = Depends(get_current_shop),
):
    """
    Fetch vehicle data from the ERP and create an open_orders row.

    The ERP response is stored verbatim in open_orders.car_data (JSONB) and
    also forwarded to the caller so the frontend can render the accepted-request
    screen immediately without an extra GET /api/orders/{id} round-trip.

    Raises:
        400: ERP rejected the request (e.g. mileage too low, unrecognised plate).
    """
    car_data = await erp.lookup_car(
        license_plate=body.license_plate,
        mileage=body.mileage,
        shop_id=shop["shop_id"],
        erp_hash=shop["erp_hash"],
    )

    if not car_data["recognized"]:
        raise HTTPException(
            status_code=400,
            detail=car_data.get("erp_message", "erp_rejected"),
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
        json.dumps(car_data),
        str(car_data.get("request_id")),
        shop["erp_hash"],
    )

    return {
        "order_id": str(order_id),
        **car_data,
    }
