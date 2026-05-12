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
from models.schemas import CarLookupRequest, CodesResponse, LastMileageRequest, LastMileageResponse
from adapters import erp

router = APIRouter(prefix="/api", tags=["car"])

@router.get(
    "/codes",
    summary="Fetch ERP action/reason codes",
    description=(
        "Returns the live action and reason code tables directly from the DB. "
        "No auth required and no caching is applied."
    ),
    response_model=CodesResponse,
)
async def get_codes(request: Request):
    db = request.app.state.db
    actions_rows = await db.fetch(
        """
        SELECT code, label_he, label_ar, label_ru
        FROM erp_action_codes
        ORDER BY code
        """
    )
    reasons_rows = await db.fetch(
        """
        SELECT code, label_he, label_ar, label_ru, linked_action_code
        FROM erp_reason_codes
        ORDER BY linked_action_code, code
        """
    )
    return {
        "actions": [dict(row) for row in actions_rows],
        "reasons": [dict(row) for row in reasons_rows],
    }


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
        (
            "car_lookup received "
            f"shop_id={shop['shop_id']} plate={body.license_plate} mileage={body.mileage} "
            f"last_mileage_hint={body.last_mileage_hint}"
        ),
    )

    db = request.app.state.db

    # Reuse an existing open order for the same shop+plate if one exists.
    # The ERP call is skipped in that case — Wave 2 (POST /api/diagnosis) sends
    # mileage_update, so the updated mileage will reach the ERP naturally then.
    log(
        "DB",
        f"SELECT open_orders WHERE shop_id={shop['shop_id']} plate={body.license_plate} status IN ('open','waiting')",
    )
    existing = await db.fetchrow(
        """
        SELECT id, car_data, diagnosis
        FROM open_orders
        WHERE shop_id = $1 AND license_plate = $2 AND status IN ('open', 'waiting')
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
        from routers.diagnosis import _coerce_jsonb  # lazy — same pattern as webhooks.py

        diag = _coerce_jsonb(existing["diagnosis"])
        mechanic_inputs = diag.get("mechanic_inputs") if diag else None

        if mechanic_inputs and mechanic_inputs.get("tires"):
            derived_lines = []
            for wheel, actions in mechanic_inputs["tires"].items():
                for a in actions or []:
                    if isinstance(a.get("action"), int):
                        derived_lines.append(
                            {
                                "wheel": wheel,
                                "action": a["action"],
                                "reason": a.get("reason") or 0,
                            }
                        )
            stored_car_data["existing_lines"] = derived_lines
            if "front_alignment" in mechanic_inputs:
                stored_car_data["front_alignment"] = bool(mechanic_inputs["front_alignment"])
        log(
            "ROUTER/car",
            f"car_lookup reused order_id={existing['id']} plate={body.license_plate}",
        )
        return {
            "order_id": str(existing["id"]),
            "existing_lines": [],
            **stored_car_data,
        }

    should_override_km = (
        body.last_mileage_hint is not None
        and body.mileage is not None
        and body.mileage < body.last_mileage_hint
    )
    override_km = body.last_mileage_hint + 1 if should_override_km else None
    car_data = await erp.lookup_car(
        license_plate=body.license_plate,
        mileage=body.mileage,
        shop_id=shop["shop_id"],
        erp_hash=shop["erp_hash"],
        override_km=override_km,
    )
    if should_override_km:
        car_data["actual_mileage"] = body.mileage
        car_data["mileage_overridden"] = True

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
        mileage_data = await erp.get_last_mileage(
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
        return LastMileageResponse(last_mileage=None, max_mileage=None)

    log(
        "ROUTER/car",
        (
            "last_mileage success "
            f"plate={body.license_plate} value={mileage_data.get('last_mileage')} "
            f"max={mileage_data.get('max_mileage')}"
        ),
    )
    return LastMileageResponse(
        last_mileage=mileage_data.get("last_mileage"),
        max_mileage=mileage_data.get("max_mileage"),
    )
