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

_LEGACY_ACTION_TO_CODE_KEY: dict[str, str] = {
    "replacement": "replacement",
    "puncture": "puncture",
    "repair": "puncture",
    "relocation": "relocation",
    "rim_repair": "rim_repair",
    "balancing": "balancing",
    "tpms_valve": "tpms_valve",
    "sensor": "sensor",
}

_LEGACY_REASON_TO_CODE_KEY: dict[str, str] = {
    "wear": "wear",
    "damage": "damage",
    "fitment": "fitment",
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

async def _load_code_maps(db) -> tuple[dict[int, int], dict[str, int], dict[int, tuple[int, int]], dict[str, tuple[int, int]]]:
    action_rows = await db.fetch("SELECT code, label_he FROM erp_action_codes")
    reason_rows = await db.fetch("SELECT code, linked_action_code, label_he FROM erp_reason_codes")
    valid_action_codes = {int(row["code"]): int(row["code"]) for row in action_rows}
    action_by_label = {str(row["label_he"]).strip(): int(row["code"]) for row in action_rows if row["label_he"]}
    valid_reason_codes = {
        int(row["code"]): (int(row["code"]), int(row["linked_action_code"]))
        for row in reason_rows
    }
    reason_by_label = {
        str(row["label_he"]).strip(): (int(row["code"]), int(row["linked_action_code"]))
        for row in reason_rows
        if row["label_he"]
    }
    return valid_action_codes, action_by_label, valid_reason_codes, reason_by_label


def _resolve_action_code(
    raw_action: int | str,
    valid_action_codes: dict[int, int],
    action_by_label: dict[str, int],
) -> int | None:
    if isinstance(raw_action, int):
        return raw_action if raw_action in valid_action_codes else None
    if isinstance(raw_action, str):
        stripped = raw_action.strip()
        if stripped.isdigit():
            as_int = int(stripped)
            return as_int if as_int in valid_action_codes else None
        return action_by_label.get(stripped)
    return None


def _resolve_reason_code(
    raw_reason: int | str | None,
    action_code: int,
    valid_reason_codes: dict[int, tuple[int, int]],
    reason_by_label: dict[str, tuple[int, int]],
) -> int:
    if raw_reason is None:
        return 0
    if isinstance(raw_reason, int):
        resolved = valid_reason_codes.get(raw_reason)
        if resolved and resolved[1] == action_code:
            return resolved[0]
        return 0
    if isinstance(raw_reason, str):
        stripped = raw_reason.strip()
        if stripped.isdigit():
            as_int = int(stripped)
            resolved = valid_reason_codes.get(as_int)
            if resolved and resolved[1] == action_code:
                return resolved[0]
            return 0
        resolved = reason_by_label.get(stripped)
        if resolved and resolved[1] == action_code:
            return resolved[0]
    return 0


def _normalize_tires_actions(
    tires: dict[str, list[dict]],
    valid_action_codes: dict[int, int],
    action_by_label: dict[str, int],
    valid_reason_codes: dict[int, tuple[int, int]],
    reason_by_label: dict[str, tuple[int, int]],
) -> dict[str, list[dict]]:
    normalized: dict[str, list[dict]] = {}
    for wheel, actions in (tires or {}).items():
        out: list[dict] = []
        for action in actions or []:
            raw_action = action.get("action")
            action_code = _resolve_action_code(raw_action, valid_action_codes, action_by_label)
            if action_code is None and isinstance(raw_action, str):
                legacy_label = _LEGACY_ACTION_TO_CODE_KEY.get(raw_action)
                if legacy_label:
                    action_code = action_by_label.get(legacy_label)
            if action_code is None:
                continue
            raw_reason = action.get("reason")
            reason_code = _resolve_reason_code(raw_reason, action_code, valid_reason_codes, reason_by_label)
            if reason_code == 0 and isinstance(raw_reason, str):
                legacy_reason = _LEGACY_REASON_TO_CODE_KEY.get(raw_reason)
                if legacy_reason:
                    resolved = reason_by_label.get(legacy_reason)
                    if resolved and resolved[1] == action_code:
                        reason_code = resolved[0]
            out.append({
                "action": action_code,
                "reason": reason_code,
                "transfer_target": action.get("transfer_target"),
                "remarks": action.get("remarks"),
            })
        if out:
            normalized[wheel] = out
    return normalized


async def _submit_to_erp(order, car_data: dict, shop_id: str, erp_hash: str, db) -> None:
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
    (
        valid_action_codes,
        action_by_label,
        valid_reason_codes,
        reason_by_label,
    ) = await _load_code_maps(db)

    erp_payload = {
        "request_id": order["request_id"],
        "mileage": mechanic_inputs.get("mileage_update"),
        "front_alignment": bool(mechanic_inputs.get("front_alignment", False)),
        "front_alignment_code": 6 if mechanic_inputs.get("front_alignment") else None,
        "carool_id": order["carool_diagnosis_id"],
        "license_plate": order["license_plate"],
        # Defensive copy — we mutate the per-wheel action lists below to
        # append Carool predictions, and we don't want to scribble on the
        # caller's dict if they happen to be reusing it.
        "tires": _normalize_tires_actions(
            mechanic_inputs.get("tires") or {},
            valid_action_codes,
            action_by_label,
            valid_reason_codes,
            reason_by_label,
        ),
    }
    remarks = None
    if car_data.get("mileage_overridden"):
        actual = car_data.get("actual_mileage")
        last = car_data.get("last_mileage")
        remarks = f"KM entered: {actual} | Last KM on file: {last}"
    if remarks:
        for actions in erp_payload["tires"].values():
            for action in actions:
                action["remarks"] = remarks

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
        "SELECT id, request_id, carool_diagnosis_id, license_plate, car_data FROM open_orders WHERE id = $1 AND shop_id = $2",
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

    await _submit_to_erp(
        order_for_submit,
        _coerce_jsonb(order_row["car_data"]),
        shop["shop_id"],
        shop["erp_hash"],
        db,
    )

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
