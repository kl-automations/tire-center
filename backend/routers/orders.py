"""
Orders router — read-only access to a shop's open service orders.

Both endpoints are scoped to the authenticated shop_id from the JWT:
no mechanic can ever read another shop's orders, even if they know the UUID.
Declined orders remain in the list until the mechanic dismisses them or
nightly /internal/cleanup removes them.
"""

import json

from fastapi import APIRouter, Depends, HTTPException, Request
from logging_utils import log, log_error
from middleware.auth import get_current_shop

router = APIRouter(prefix="/api/orders", tags=["orders"])

# Companion router exposing a singular `/api/order/{order_id}` path, used by
# the frontend to rehydrate the AcceptedRequest screen after a full page
# reload that lost the sessionStorage cache. Same auth / shop scoping as the
# plural router; different status-code semantics (200 / 404 / 410) so the
# client knows whether the order is still open.
order_singular_router = APIRouter(prefix="/api/order", tags=["orders"])


def _decode_jsonb_columns(record: dict) -> None:
    """
    Decode JSONB columns returned as raw strings by asyncpg.

    No JSONB codec is registered on the connection pool, so asyncpg returns
    JSONB columns as plain strings. The frontend expects parsed objects
    (e.g. ``row.diagnosis.tires``), so we eagerly decode in place.

    Mutates ``record`` so callers don't need to reassign. On decode failure
    the column is set to ``None`` rather than left as a misleading string.
    """
    for col in ("diagnosis", "car_data"):
        val = record.get(col)
        if isinstance(val, str):
            try:
                record[col] = json.loads(val)
            except (json.JSONDecodeError, TypeError):
                record[col] = None


@router.get(
    "",
    summary="List all open service orders for the authenticated shop",
    description=(
        "Returns all orders for the shop identified by the JWT, including "
        "`declined` rows until dismissed or removed by nightly cleanup. "
        "Orders are sorted newest-first. "
        "Response shape: `{ total: int, orders: [...] }`."
    ),
    response_description="Paginated list of open orders with full DB columns.",
)
async def list_orders(
    request: Request,
    shop: dict = Depends(get_current_shop),
):
    """
    Fetch all orders for the authenticated shop.

    Reads shop_id from the JWT (never from the request body). Returns all
    columns from open_orders ordered by created_at DESC.
    UUIDs are coerced to strings for JSON serialisation.
    """
    log("ROUTER/orders", f"list_orders received shop_id={shop['shop_id']}")
    db = request.app.state.db
    log("DB", f"SELECT open_orders WHERE shop_id={shop['shop_id']}")
    rows = await db.fetch(
        """
        SELECT id, request_id, license_plate, plate_type, mileage,
               car_data, diagnosis, status, carool_diagnosis_id,
               created_at, updated_at
        FROM open_orders
        WHERE shop_id = $1
        ORDER BY created_at DESC
        """,
        shop["shop_id"],
    )
    orders = [dict(r) for r in rows]
    for o in orders:
        o["id"] = str(o["id"])
        _decode_jsonb_columns(o)
    log("ROUTER/orders", f"list_orders returning {len(orders)} orders shop_id={shop['shop_id']}")
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
    log("ROUTER/orders", f"get_order received order_id={order_id} shop_id={shop['shop_id']}")
    db = request.app.state.db
    log("DB", f"SELECT open_orders WHERE id={order_id} AND shop_id={shop['shop_id']}")
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
        log_error("orders", f"get_order not found order_id={order_id} shop_id={shop['shop_id']}")
        raise HTTPException(status_code=404, detail="Order not found")
    result = dict(row)
    result["id"] = str(result["id"])
    _decode_jsonb_columns(result)
    log("ROUTER/orders", f"get_order success order_id={order_id} status={result.get('status')}")
    return result


# Statuses for which the AcceptedRequest screen is still valid. Anything
# outside this set means the order has already been submitted to the ERP
# (or finalised), so the client should redirect to a result screen rather
# than try to keep editing.
_ACTIVE_ORDER_STATUSES = {"open", "pending_carool", "waiting"}


@order_singular_router.get(
    "/{order_id}",
    summary="Rehydrate an in-progress order for the AcceptedRequest screen",
    description=(
        "Returns enough data to repopulate the AcceptedRequest screen after a "
        "page reload that lost the sessionStorage cache. Reuses the exact "
        "shape POST /api/car returns on an existing-order reuse: `order_id` "
        "plus all keys of the stored `car_data` JSONB, with the addition of "
        "`license_plate`, `plate_type`, `mileage` and `front_alignment` so "
        "the screen can render without a second round-trip.\n\n"
        "Status-code semantics:\n"
        "- **200** — order is still active (`open`, `pending_carool`, or `waiting`).\n"
        "- **404** — no such order, or it belongs to a different shop.\n"
        "- **410** — order has moved past the editable window (`approved`, "
        "`partly-approved`, `declined`, or other terminal states); the client should "
        "redirect to the appropriate result screen."
    ),
    response_description="Flattened car_data + per-row metadata for AcceptedRequest.",
)
async def get_order_for_rehydrate(
    order_id: str,
    request: Request,
    shop: dict = Depends(get_current_shop),
):
    """
    Lightweight rehydrate-only endpoint for the AcceptedRequest screen.

    Pure cache replay — no ERP call. The order cannot transition state during
    the open→waiting window because that transition is itself triggered by
    submitting our diagnosis; ERP is otherwise idle.

    Raises:
        404: Order not found, or belongs to a different shop.
        410: Order has moved past the editable lifecycle (waiting/approved/
             partly-approved/declined).
    """
    log(
        "ROUTER/orders",
        f"get_order_for_rehydrate received order_id={order_id} shop_id={shop['shop_id']}",
    )
    db = request.app.state.db
    log(
        "DB",
        f"SELECT open_orders WHERE id={order_id} AND shop_id={shop['shop_id']}",
    )
    row = await db.fetchrow(
        """
        SELECT id, request_id, license_plate, plate_type, mileage,
               car_data, diagnosis, status
        FROM open_orders
        WHERE id = $1 AND shop_id = $2
        """,
        order_id,
        shop["shop_id"],
    )
    if not row:
        log_error(
            "orders",
            f"get_order_for_rehydrate not found order_id={order_id} shop_id={shop['shop_id']}",
        )
        raise HTTPException(status_code=404, detail="Order not found")

    status = row["status"]
    if status not in _ACTIVE_ORDER_STATUSES:
        log(
            "ROUTER/orders",
            f"get_order_for_rehydrate gone (410) order_id={order_id} status={status}",
        )
        raise HTTPException(status_code=410, detail=f"Order is {status}")

    car_data = row["car_data"]
    if isinstance(car_data, str):
        try:
            car_data = json.loads(car_data)
        except json.JSONDecodeError:
            car_data = {}
    if not isinstance(car_data, dict):
        car_data = {}

    from routers.diagnosis import _coerce_jsonb  # lazy — same pattern as car.py

    diagnosis = _coerce_jsonb(row["diagnosis"])
    mechanic_inputs = diagnosis.get("mechanic_inputs") if isinstance(diagnosis.get("mechanic_inputs"), dict) else None

    tires_dict = None
    if mechanic_inputs and mechanic_inputs.get("tires"):
        tires_dict = mechanic_inputs["tires"]
    elif isinstance(diagnosis.get("tires"), dict):
        tires_dict = diagnosis["tires"]

    derived_lines: list[dict] = []
    if tires_dict:
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

    if mechanic_inputs is not None and "front_alignment" in mechanic_inputs:
        front_alignment = bool(mechanic_inputs["front_alignment"])
    elif "front_alignment" in diagnosis:
        front_alignment = bool(diagnosis["front_alignment"])
    else:
        front_alignment = False

    log(
        "ROUTER/orders",
        f"get_order_for_rehydrate success order_id={order_id} status={status}",
    )
    return {
        "order_id": str(row["id"]),
        "license_plate": row["license_plate"],
        "plate_type": row["plate_type"],
        "mileage": row["mileage"],
        "front_alignment": front_alignment,
        **car_data,
        "existing_lines": derived_lines,
    }
