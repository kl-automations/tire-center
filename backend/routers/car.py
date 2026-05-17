"""
Car-lookup router — opens (or reuses) a service order for a given licence plate.

Wave 1 of the request flow:
  Frontend  →  POST /api/car  →  if an open_orders row exists for this shop+plate
                                 with status='open', reuse it: refresh mileage,
                                 return stored car_data (no ERP call).
                              →  otherwise call ERP Apply (SOAP). If the ERP
                                 request_id matches an existing row (any status),
                                 update that row's car_data in place; else INSERT
                                 a new row (status='open').

Reusing the open row avoids duplicate drafts. Calling the ERP when the plate has
only a waiting (or completed) row refreshes ERP state and reconciles by request_id.
The mileage update is propagated to the ERP later, in Wave 2 (POST /api/diagnosis),
which already sends mileage_update.
"""

import asyncio
import json

import httpx

from fastapi import APIRouter, Depends, HTTPException, Request
from logging_utils import log, log_error
from middleware.auth import get_current_shop
from models.schemas import CarLookupRequest, CodesResponse, LastMileageRequest, LastMileageResponse
from adapters import erp
from routers.diagnosis import _coerce_jsonb
from routers.stock_availability import _ack_tafnit_with_retry, _resolve_erp_shop_id
from routers.webhooks import _stock_availability_signal

router = APIRouter(prefix="/api", tags=["car"])


def _merge_saved_diagnosis_into_car_data(car_data: dict, diagnosis_raw) -> None:
    """
    Overlay mechanic-entered diagnosis from DB onto car_data for the response.

    Uses mechanic_inputs.tires → top-level tires, and the same for
    front_alignment. Only sets existing_lines when at least one line is derived.
    """
    diag = _coerce_jsonb(diagnosis_raw)
    if not isinstance(diag, dict):
        return

    mechanic_inputs = diag.get("mechanic_inputs") if isinstance(diag.get("mechanic_inputs"), dict) else None

    tires_dict = None
    if mechanic_inputs and mechanic_inputs.get("tires"):
        tires_dict = mechanic_inputs["tires"]
    elif isinstance(diag.get("tires"), dict):
        tires_dict = diag["tires"]

    if tires_dict:
        derived_lines = []
        for wheel, actions in tires_dict.items():
            for a in actions or []:
                if isinstance(a, dict) and isinstance(a.get("action"), int):
                    derived_lines.append(
                        {
                            "wheel": wheel,
                            "action": a["action"],
                            "reason": a.get("reason") or 0,
                        }
                    )
        if derived_lines:
            car_data["existing_lines"] = derived_lines

    if mechanic_inputs is not None and "front_alignment" in mechanic_inputs:
        car_data["front_alignment"] = bool(mechanic_inputs["front_alignment"])
    elif "front_alignment" in diag:
        car_data["front_alignment"] = bool(diag["front_alignment"])


async def _auto_approve_stock_on_car_lookup(
    request: Request,
    shop: dict,
    license_plate: str,
) -> None:
    erp_shop_id = await _resolve_erp_shop_id(request, shop)
    if not erp_shop_id:
        log(
            "ROUTER/car",
            f"WARNING: auto_approve stock_request skipped, erp_shop_id unresolved plate={license_plate}",
        )
        return

    try:
        tire_shop_code = int(erp_shop_id)
    except ValueError:
        log(
            "ROUTER/car",
            f"WARNING: auto_approve stock_request skipped, invalid erp_shop_id={erp_shop_id} plate={license_plate}",
        )
        return

    db = request.app.state.db
    try:
        rows = await db.fetch(
            """
            UPDATE stock_availability_requests
            SET status = 'accepted'
            WHERE car_number = $1 AND shop_id = $2 AND status = 'live'
            RETURNING request_id
            """,
            license_plate,
            erp_shop_id,
        )
    except Exception as e:
        log_error(
            "ROUTER/car",
            f"auto_approve stock_request DB failure plate={license_plate}: {e}",
        )
        return

    for row in rows:
        request_id = row["request_id"]
        try:
            apply_id = int(request_id)
        except ValueError:
            log(
                "ROUTER/car",
                f"WARNING: auto_approve stock_request skipped invalid request_id={request_id} plate={license_plate}",
            )
            continue

        _stock_availability_signal(request.app, erp_shop_id, request_id, "accepted")
        asyncio.create_task(
            _ack_tafnit_with_retry(
                request.app,
                shop_id=shop["shop_id"],
                erp_hash=shop["erp_hash"],
                erp_shop_id=erp_shop_id,
                request_id=request_id,
                apply_id=apply_id,
                tire_shop_code=tire_shop_code,
                tafnit_response=1,
                ack_status="accepted_acked",
            )
        )
        log(
            "ROUTER/car",
            f"auto_approve stock_request plate={license_plate} request_id={request_id} erp_shop_id={erp_shop_id}",
        )


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
    try:
        tire_levels_rows = await db.fetch(
            "SELECT code, description FROM erp_tire_level_codes ORDER BY code"
        )
    except Exception:
        tire_levels_rows = []
    return {
        "actions": [dict(row) for row in actions_rows],
        "reasons": [dict(row) for row in reasons_rows],
        "tire_levels": [dict(row) for row in tire_levels_rows],
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
        "**ERP path** — if no matching `open` row exists, the ERP **Apply** "
        "SOAP method is called. When the returned `request_id` matches an "
        "existing row for the same shop and plate (any status), that row's "
        "`car_data` and optional `mileage` are updated in place and the same "
        "`order_id` is returned; otherwise a new `open` row is inserted."
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

    On the reuse path (`status='open'` only), the ERP is not called: mileage may
    be refreshed and stored car_data is returned. Otherwise the ERP is consulted;
    the row is updated in place when `request_id` matches an existing row, or a
    new row is inserted. The response is always `order_id` plus car_data fields
    at the top level.

    Raises:
        400: ERP rejected the request on the ERP path (e.g. mileage too low,
             unrecognised plate). The open reuse path never calls the ERP.
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
        f"SELECT open_orders WHERE shop_id={shop['shop_id']} plate={body.license_plate} status='open'",
    )
    existing = await db.fetchrow(
        """
        SELECT id, car_data, diagnosis
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
        _merge_saved_diagnosis_into_car_data(stored_car_data, existing["diagnosis"])
        log(
            "ROUTER/car",
            f"car_lookup reused order_id={existing['id']} plate={body.license_plate}",
        )
        asyncio.create_task(
            _auto_approve_stock_on_car_lookup(request, shop, body.license_plate)
        )
        return {
            "order_id": str(existing["id"]),
            **stored_car_data,
        }

    should_override_km = (
        body.last_mileage_hint is not None
        and body.mileage is not None
        and body.mileage < body.last_mileage_hint
    )
    override_km = body.last_mileage_hint + 1 if should_override_km else None
    try:
        car_data = await erp.lookup_car(
            license_plate=body.license_plate,
            mileage=body.mileage,
            shop_id=shop["shop_id"],
            erp_hash=shop["erp_hash"],
            override_km=override_km,
        )
    except (httpx.ReadTimeout, httpx.ConnectTimeout):
        raise HTTPException(status_code=503, detail="erp_timeout")
    if should_override_km:
        car_data["actual_mileage"] = body.mileage
        car_data["mileage_overridden"] = True

    _ownership = (car_data.get("ownership_id") or "").replace('"', "").replace("'", "")
    _plate_type = "military" if "צהל" in _ownership else body.plate_type

    if not car_data["recognized"]:
        log_error(
            "car",
            f"ERP did not recognise plate={body.license_plate} message={car_data.get('erp_message')}",
        )
        raise HTTPException(
            status_code=400,
            detail=car_data.get("erp_message", "erp_rejected"),
        )

    erp_request_id = str(car_data.get("request_id") or "")
    matched = None
    if erp_request_id:
        matched = await db.fetchrow(
            """
            SELECT id, diagnosis
            FROM open_orders
            WHERE shop_id = $1 AND license_plate = $2 AND request_id = $3
            ORDER BY created_at DESC
            LIMIT 1
            """,
            shop["shop_id"],
            body.license_plate,
            erp_request_id,
        )

    if matched:
        log(
            "DB",
            (
                f"UPDATE open_orders (request_id match) shop_id={shop['shop_id']} "
                f"plate={body.license_plate} order_id={matched['id']}"
            ),
        )
        await db.execute(
            """
            UPDATE open_orders
            SET car_data = $1::jsonb,
                mileage = COALESCE($2, mileage),
                plate_type = $4
            WHERE id = $3
            """,
            json.dumps(car_data),
            body.mileage,
            matched["id"],
            _plate_type,
        )
        response_car = dict(car_data)
        log(
            "ROUTER/car",
            (
                f"car_lookup updated existing order_id={matched['id']} "
                f"plate={body.license_plate} request_id={erp_request_id}"
            ),
        )
        asyncio.create_task(
            _auto_approve_stock_on_car_lookup(request, shop, body.license_plate)
        )
        return {
            "order_id": str(matched["id"]),
            "plate_type": _plate_type,
            **response_car,
        }

    log("DB", f"INSERT open_orders shop_id={shop['shop_id']} plate={body.license_plate}")
    order_id = await db.fetchval(
        """
        INSERT INTO open_orders
          (shop_id, license_plate, plate_type, mileage, car_data, request_id, erp_hash)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id
        """,
        shop["shop_id"],
        body.license_plate,
        _plate_type,
        body.mileage,
        json.dumps(car_data),
        erp_request_id,
        shop["erp_hash"],
    )
    log("DB", f"INSERT open_orders -> order_id={order_id}")
    log("ROUTER/car", f"car_lookup success order_id={order_id} plate={body.license_plate}")

    asyncio.create_task(
        _auto_approve_stock_on_car_lookup(request, shop, body.license_plate)
    )
    return {
        "order_id": str(order_id),
        "plate_type": _plate_type,
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
