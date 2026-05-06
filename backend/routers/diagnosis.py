"""
Diagnosis router — Wave 2 of the service-order flow.

Two ways into the ERP submission:

  1. POST /api/diagnosis        — direct path (Carool disabled or not needed).
                                   Builds the ERP payload from the request body
                                   and forwards immediately, exactly as before.

  2. POST /api/diagnosis/draft  — staged path (Carool active).
                                   Persists the mechanic's inputs under
                                   open_orders.diagnosis['mechanic_inputs'] and
                                   moves the order to status='pending_carool'.
                                   The ERP submission is deferred until the
                                   Carool webhook fires; that handler imports
                                   `_submit_to_erp` from this module to merge
                                   the AI prediction into the payload and send
                                   it on.

Either way the ERP submission ends with status='waiting' and the full
erp_payload persisted in open_orders.diagnosis. After that the ERP fires
POST /api/webhook/erp asynchronously with the manager's approval decision.
"""

import json

from fastapi import APIRouter, Depends, HTTPException, Request
from logging_utils import log, log_error
from middleware.auth import get_current_shop
from models.schemas import DiagnosisRequest
from adapters import erp

router = APIRouter(prefix="/api", tags=["diagnosis"])


# Carool reports per-tyre predictions under uppercase / underscored keys, while
# the rest of the app (and erp_payload) uses lowercase / hyphenated keys. This
# mapping is only consulted when merging carool_result into the ERP payload.
_ERP_WHEEL_TO_CAROOL: dict[str, str] = {
    "front-left":  "FRONT_LEFT",
    "front-right": "FRONT_RIGHT",
    "rear-left":   "REAR_LEFT",
    "rear-right":  "REAR_RIGHT",
}


def _coerce_jsonb(value) -> dict:
    """
    Normalise a JSONB column value into a Python dict.

    asyncpg returns jsonb columns as strings (no codec is registered on the
    pool — see _create_db_pool in main.py), so callers that read `diagnosis`
    must decode it before treating it as a mapping.
    """
    if value is None:
        return {}
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            # Truncate the raw value so a runaway blob doesn't blow up the
            # log line; 100 chars is enough to recognise the corruption
            # signature without leaking the entire JSONB column.
            log_error(
                "diagnosis",
                f"_coerce_jsonb failed to decode diagnosis JSONB; raw[:100]={value[:100]!r}",
            )
            return {}
    if isinstance(value, dict):
        return value
    return {}


def _build_mechanic_inputs(body: DiagnosisRequest) -> dict:
    """Serialise the request body fields we persist under mechanic_inputs."""
    return {
        "mileage_update": body.mileage_update,
        "front_alignment": body.front_alignment,
        "tires": {
            wheel: [a.model_dump(exclude_none=True) for a in actions]
            for wheel, actions in body.tires.items()
        },
    }


async def _submit_to_erp(order, shop_id: str, erp_hash: str, db) -> None:
    """
    Forward a stored diagnosis to the ERP and persist the result.

    `order` must expose: id, request_id, carool_diagnosis_id, license_plate,
    diagnosis (full JSONB; either an asyncpg.Record or a plain dict).

    The function reads `mechanic_inputs` (mileage_update / front_alignment /
    tires) out of `order['diagnosis']` and builds the same erp_payload shape
    that the legacy direct-submit path produced. If `order['diagnosis']` also
    contains `carool_result`, the relevant per-tyre Carool prediction is
    appended to the end of the matching `erp_payload['tires'][wheel]` list so
    the data travels with the diagnosis (the ERP adapter ignores entries
    without a recognised `action` key, so this never breaks SOAP submission).

    On a successful ERP ack, the order's diagnosis JSONB is overwritten with
    the merged erp_payload and status flips to 'waiting'.

    Raises:
        HTTPException 502: ERP returned a failure response.
    """
    diagnosis = _coerce_jsonb(order["diagnosis"])
    mechanic_inputs = diagnosis.get("mechanic_inputs") or {}

    erp_payload = {
        "request_id": order["request_id"],
        "mileage": mechanic_inputs.get("mileage_update"),
        "front_alignment": bool(mechanic_inputs.get("front_alignment", False)),
        "carool_id": order["carool_diagnosis_id"],
        "license_plate": order["license_plate"],
        # Defensive copy — we mutate the per-wheel action lists below to
        # append Carool predictions, and we don't want to scribble on the
        # caller's dict if they happen to be reusing it.
        "tires": {
            wheel: list(actions or [])
            for wheel, actions in (mechanic_inputs.get("tires") or {}).items()
        },
    }

    carool_result = diagnosis.get("carool_result")
    if isinstance(carool_result, dict):
        prediction = carool_result.get("prediction") or {}
        merged_wheels: list[str] = []
        for wheel, actions in erp_payload["tires"].items():
            carool_key = _ERP_WHEEL_TO_CAROOL.get(wheel)
            if not carool_key:
                continue
            wheel_prediction = prediction.get(carool_key)
            if wheel_prediction is None:
                continue
            actions.append({"carool_prediction": wheel_prediction})
            merged_wheels.append(wheel)
        if merged_wheels:
            log(
                "ROUTER/diagnosis",
                f"merged carool prediction order_id={order['id']} wheels={merged_wheels}",
            )

    log(
        "ROUTER/diagnosis",
        f"forwarding diagnosis to ERP order_id={order['id']} request_id={order['request_id']}",
    )
    ok = await erp.submit_diagnosis(order["request_id"], erp_payload, shop_id, erp_hash)
    if not ok:
        log_error(
            "diagnosis",
            f"ERP rejected diagnosis order_id={order['id']} request_id={order['request_id']}",
        )
        raise HTTPException(status_code=502, detail="ERP rejected diagnosis")

    log("DB", f"UPDATE open_orders SET status='waiting' for order_id={order['id']}")
    await db.execute(
        "UPDATE open_orders SET status = 'waiting', diagnosis = $1 WHERE id = $2",
        json.dumps(erp_payload),
        order["id"],
    )
    log(
        "ROUTER/diagnosis",
        f"submit success order_id={order['id']} status=waiting",
    )


@router.post(
    "/diagnosis",
    summary="Submit a completed tyre-service diagnosis (direct path)",
    description=(
        "Direct ERP submission. Used when Carool is disabled, when the ERP "
        "has flagged the vehicle as not requiring a Carool photo session, or "
        "as the legacy/fallback path. The payload is forwarded to the ERP "
        "immediately and persisted in `open_orders.diagnosis` (JSONB); on "
        "success the order status transitions to **`waiting`**. "
        "When Carool is active for the order use `POST /api/diagnosis/draft` "
        "instead, which defers the ERP call until the AI results are in."
    ),
    response_description="Acknowledgement that the diagnosis was accepted by the ERP.",
)
async def submit_diagnosis(
    body: DiagnosisRequest,
    request: Request,
    shop: dict = Depends(get_current_shop),
):
    """
    Validate ownership and submit straight to the ERP.

    The request body itself is the source of truth for mechanic inputs — we do
    not require a prior /api/diagnosis/draft. To reuse `_submit_to_erp` (which
    expects mechanic_inputs to live under order['diagnosis']) we wrap the body
    fields into the same shape before handing it off.

    Raises:
        404: Order not found or does not belong to the authenticated shop.
        502: ERP returned a failure response.
    """
    log(
        "ROUTER/diagnosis",
        f"submit received order_id={body.order_id} shop_id={shop['shop_id']} mileage={body.mileage_update} alignment={body.front_alignment}",
    )
    db = request.app.state.db
    log("DB", f"SELECT open_orders for order_id={body.order_id}")
    order_row = await db.fetchrow(
        "SELECT id, request_id, carool_diagnosis_id, license_plate FROM open_orders WHERE id = $1 AND shop_id = $2",
        body.order_id, shop["shop_id"],
    )
    if not order_row:
        log_error("diagnosis", f"order not found order_id={body.order_id}")
        raise HTTPException(status_code=404, detail="Order not found")

    # Bridge the legacy direct-submit shape into _submit_to_erp's contract.
    # Nothing is persisted to `diagnosis.mechanic_inputs` here — the helper
    # overwrites the column with the final erp_payload after a successful ack,
    # which matches the behaviour the route had pre-refactor.
    order_for_submit = {
        "id": order_row["id"],
        "request_id": order_row["request_id"],
        "carool_diagnosis_id": order_row["carool_diagnosis_id"],
        "license_plate": order_row["license_plate"],
        "diagnosis": {"mechanic_inputs": _build_mechanic_inputs(body)},
    }

    await _submit_to_erp(order_for_submit, shop["shop_id"], shop["erp_hash"], db)

    return {"ack": True}


@router.post(
    "/diagnosis/draft",
    summary="Save the mechanic's diagnosis inputs while Carool runs",
    description=(
        "Persists the mechanic's tyre / mileage / front-alignment inputs under "
        "`open_orders.diagnosis['mechanic_inputs']` and moves the order to "
        "`status='pending_carool'`. **Does not call the ERP.** "
        "The frontend should follow this with `POST /api/carool/finalize`; "
        "when Carool fires its results webhook the backend merges the "
        "predictions and submits to the ERP automatically. "
        "Accepts the same body shape as `POST /api/diagnosis`."
    ),
    response_description="Acknowledgement that the draft was saved.",
)
async def save_diagnosis_draft(
    body: DiagnosisRequest,
    request: Request,
    shop: dict = Depends(get_current_shop),
):
    """
    Save mechanic inputs without contacting the ERP.

    Same ownership check as the direct submit path. The full request body
    (minus order_id) is stored under diagnosis.mechanic_inputs as JSONB so
    the deferred ERP submission triggered from the Carool webhook can read
    it back without any further frontend involvement.

    Raises:
        404: Order not found or does not belong to the authenticated shop.
    """
    log(
        "ROUTER/diagnosis",
        f"draft received order_id={body.order_id} shop_id={shop['shop_id']} mileage={body.mileage_update} alignment={body.front_alignment}",
    )
    db = request.app.state.db
    log("DB", f"SELECT open_orders for draft order_id={body.order_id}")
    order_row = await db.fetchrow(
        "SELECT id FROM open_orders WHERE id = $1 AND shop_id = $2",
        body.order_id, shop["shop_id"],
    )
    if not order_row:
        log_error("diagnosis", f"draft order not found order_id={body.order_id}")
        raise HTTPException(status_code=404, detail="Order not found")

    mechanic_inputs = _build_mechanic_inputs(body)

    log("DB", f"UPDATE open_orders SET status='pending_carool' for order_id={body.order_id}")
    await db.execute(
        """
        UPDATE open_orders
        SET diagnosis = jsonb_set(COALESCE(diagnosis, '{}'), '{mechanic_inputs}', $1::jsonb),
            status = 'pending_carool'
        WHERE id = $2
        """,
        json.dumps(mechanic_inputs),
        body.order_id,
    )
    log(
        "ROUTER/diagnosis",
        f"draft saved order_id={body.order_id} status=pending_carool",
    )

    return {"saved": True}
