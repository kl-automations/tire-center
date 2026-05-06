"""
Car-lookup router — opens (or reuses) a service order for a given licence plate.

Wave 1 of the request flow:
  Frontend  →  POST /api/car  →  if an open_orders row already exists for this
                                 shop+plate (status='open'), reuse it: refresh
                                 its mileage and return the stored car_data.
                              →  otherwise call ERP Apply (SOAP), INSERT a new
                                 open_orders row (status='open'), and return
                                 vehicle + order data to the frontend.

Reusing the existing row avoids creating duplicate open orders when a mechanic
re-scans the same plate. The mileage update is propagated to the ERP later, in
Wave 2 (POST /api/diagnosis), which already sends mileage_update.
"""

import json

from fastapi import APIRouter, Depends, HTTPException, Request
from logging_utils import log, log_error
from middleware.auth import get_current_shop
from models.schemas import CarLookupRequest, LastMileageRequest, LastMileageResponse
from adapters import erp

router = APIRouter(prefix="/api", tags=["car"])


@router.post(
    "/car",
    summary="Look up vehicle and open (or reuse) a service order",
    description=(
        "Opens a service order for the given licence plate, reusing an existing "
        "open order when one is available.\n\n"
        "**Reuse path** — if **open_orders** already contains a row with the "
        "authenticated `shop_id`, the same `license_plate`, and `status='open'` "
        "(the newest such row by `created_at` if more than one exists), the ERP "
        "is **not** called. The row's `mileage` is refreshed from the request "
        "(when a non-null mileage is supplied) and the stored `car_data` is "
        "returned alongside the existing `order_id`. The bumped mileage is "
        "forwarded to the ERP later, in Wave 2 (`POST /api/diagnosis`), via "
        "`mileage_update`.\n\n"
        "**Fresh path** — if no matching open order exists, the ERP **Apply** "
        "SOAP method is called to fetch vehicle details (tyre sizes, quality "
        "tier, wheel count, etc.), a new row is inserted in **open_orders** "
        "with `status='open'`, and the vehicle data is returned with the new "
        "`order_id`."
    ),
    response_description=(
        "Vehicle data (from the ERP on a fresh lookup, or from the stored "
        "`car_data` on reuse) merged with the `order_id` (UUID) — same shape "
        "in both cases."
    ),
)
async def car_lookup(
    body: CarLookupRequest,
    request: Request,
    shop: dict = Depends(get_current_shop),
):
    """
    Fetch vehicle data and return it with an `order_id`, reusing an existing
    open order when possible.

    On the reuse path, the ERP is not called: the matching open_orders row's
    mileage is refreshed (when a non-null mileage is supplied in the request)
    and the previously stored car_data JSONB is returned to the caller. On the
    fresh path, the ERP response is stored verbatim in open_orders.car_data and
    also forwarded to the caller so the frontend can render the accepted-request
    screen immediately without an extra GET /api/orders/{id} round-trip.

    The response shape is identical for both paths: `order_id` plus all fields
    of car_data spread at the top level.

    Raises:
        400: ERP rejected the request on the fresh path (e.g. mileage too low,
             unrecognised plate). The reuse path never calls the ERP and so
             cannot raise this.
    """
    log(
        "ROUTER/car",
        f"car_lookup received shop_id={shop['shop_id']} plate={body.license_plate} mileage={body.mileage}",
    )

    db = request.app.state.db

    # Reuse an existing open order for the same shop+plate if one exists.
    # The ERP call is skipped in that case — Wave 2 (POST /api/diagnosis) sends
    # mileage_update, so the updated mileage will reach the ERP naturally then.
    log(
        "DB",
        f"SELECT open_orders WHERE shop_id={shop['shop_id']} plate={body.license_plate} status='open'",
    )
    existing = await db.fetchrow(
        """
        SELECT id, car_data
        FROM open_orders
        WHERE shop_id = $1 AND license_plate = $2 AND status = 'open'
        ORDER BY created_at DESC
        LIMIT 1
        """,
        shop["shop_id"],
        body.license_plate,
    )
    if existing:
        # Only refresh mileage when the caller actually supplied one. mileage is
        # Optional[int] in CarLookupRequest, and an absent value must not clobber
        # the stored mileage with NULL.
        if body.mileage is not None:
            log(
                "DB",
                f"UPDATE open_orders SET mileage={body.mileage} WHERE id={existing['id']}",
            )
            await db.execute(
                "UPDATE open_orders SET mileage = $1 WHERE id = $2",
                body.mileage,
                existing["id"],
            )
        else:
            log(
                "ROUTER/car",
                f"car_lookup reuse: mileage not provided, leaving stored value untouched order_id={existing['id']}",
            )
        # asyncpg returns jsonb columns as JSON strings (no custom codec registered).
        stored_car_data = existing["car_data"]
        if isinstance(stored_car_data, str):
            stored_car_data = json.loads(stored_car_data)
        log(
            "ROUTER/car",
            f"car_lookup reused order_id={existing['id']} plate={body.license_plate}",
        )
        return {
            "order_id": str(existing["id"]),
            **stored_car_data,
        }

    car_data = await erp.lookup_car(
        license_plate=body.license_plate,
        mileage=body.mileage,
        shop_id=shop["shop_id"],
        erp_hash=shop["erp_hash"],
    )

    if not car_data["recognized"]:
        log_error(
            "car",
            f"ERP did not recognise plate={body.license_plate} message={car_data.get('erp_message')}",
        )
        raise HTTPException(
            status_code=400,
            detail=car_data.get("erp_message", "erp_rejected"),
        )

    log("DB", f"INSERT open_orders shop_id={shop['shop_id']} plate={body.license_plate}")
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
    log("DB", f"INSERT open_orders -> order_id={order_id}")
    log("ROUTER/car", f"car_lookup success order_id={order_id} plate={body.license_plate}")

    return {
        "order_id": str(order_id),
        **car_data,
    }


@router.post(
    "/car/last-mileage",
    summary="Fetch the last recorded mileage for a vehicle (LP-blur pre-check)",
    description=(
        "Lightweight pre-check called by the frontend on licence-plate input "
        "blur, before the mechanic finishes entering the current mileage. "
        "Calls the ERP **GetLastMileage** SOAP method and returns the value "
        "so the UI can warn the mechanic if the mileage they enter is below "
        "the last value on file.\n\n"
        "**Response semantics**: `last_mileage` is `null` when the ERP has "
        "no history for this vehicle (ReturnCode='1'), otherwise the int "
        "mileage. The frontend treats `null` as 'skip validation'.\n\n"
        "**Failure handling**: any ERP / network failure is swallowed and "
        "returned as `{ \"last_mileage\": null }` so a transient ERP outage "
        "never hard-blocks the mechanic on the LP screen — the comparison is "
        "purely advisory."
    ),
    response_model=LastMileageResponse,
    response_description="Last recorded mileage on file, or null when no history exists.",
)
async def car_last_mileage(
    body: LastMileageRequest,
    shop: dict = Depends(get_current_shop),
):
    """
    Return the ERP's last recorded mileage for a vehicle, or null on no history / error.

    The endpoint is intentionally fail-soft: any exception from the SOAP
    call is logged and the response is reduced to `{ "last_mileage": null }`,
    matching the no-history case so the frontend has a single contract.
    """
    log(
        "ROUTER/car",
        f"last_mileage received shop_id={shop['shop_id']} plate={body.license_plate}",
    )
    try:
        last_mileage = await erp.get_last_mileage(
            license_plate=body.license_plate,
            shop_id=shop["shop_id"],
            erp_hash=shop["erp_hash"],
        )
    except Exception as e:
        # Spec: never hard-block on a failed check. Collapse any ERP/network
        # failure into the no-history shape so the frontend treats it as
        # "skip validation" rather than surfacing an alert.
        log_error(
            "car",
            f"GetLastMileage failed plate={body.license_plate}: {e}; returning last_mileage=null",
        )
        return LastMileageResponse(last_mileage=None)

    log(
        "ROUTER/car",
        f"last_mileage success plate={body.license_plate} value={last_mileage}",
    )
    return LastMileageResponse(last_mileage=last_mileage)
