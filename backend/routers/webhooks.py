"""
Inbound webhooks from ERP and Carool.

Both handlers update open_orders and then write a Firestore signal so the
React frontend can receive live status updates via onSnapshot without polling.

Security:
- ERP webhook:    X-ERP-Hash header validation is pending confirmation from
                  the ERP team (see open question Q4 in backend-plan.md).
                  TODO: add header verification once auth method is confirmed.
- Carool webhook: X-API-KEY header is validated against the CAROOL_API_KEY secret.
"""

import json
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Request
from logging_utils import log, log_error
from models.schemas import ErpWebhookPayload, CaroolWebhookPayload
from config import CAROOL_API_KEY
from routers.diagnosis import _coerce_jsonb, _submit_to_erp

router = APIRouter(prefix="/api/webhook", tags=["webhooks"])


# Inverse of the lookup tables in adapters/erp.py — maps ERP location codes
# back to the wheel-position strings used internally and by the frontend.
_LOCATION_TO_POSITION = {
    "1": "front-left", "2": "front-right", "3": "rear-right",
    "4": "rear-left",  "5": "spare-tire",  "7": "rear-left-inner",
    "8": "rear-right-inner",
}
_FRONT_ALIGNMENT_LOCATION = "6"


def _firestore_signal(app, shop_id: str, order_id: str, status: str):
    """
    Write a live-update document to Firestore so the browser UI refreshes.

    Path: orders/{shop_id}/updates/{order_id}
    The frontend listens via onSnapshot on the `updates` sub-collection and
    re-fetches the affected order when a change is detected.

    This call is best-effort — exceptions are swallowed so a Firestore outage
    never causes the webhook to return a non-200 to the caller.
    """
    try:
        log("FIRESTORE", f"signal write shop_id={shop_id} order_id={order_id} status={status}")
        db = app.state.firestore
        db.collection("orders").document(shop_id) \
          .collection("updates").document(order_id) \
          .set({"status": status, "updated_at": datetime.now(timezone.utc).isoformat()})
        log("FIRESTORE", f"signal write success order_id={order_id}")
    except Exception as e:
        log_error("firestore", f"signal write failed order_id={order_id}: {e}")


@router.post(
    "/erp",
    summary="Receive an order-status update from the ERP",
    description=(
        "Called by the ERP when the garage manager approves or declines a submitted diagnosis. "
        "Updates `open_orders.status`, merges the ERP response into `diagnosis` JSONB, "
        "sets `declined_at` if status is `'declined'`, and writes a Firestore signal "
        "so the mechanic's browser updates in real time. "
        "**Note:** X-ERP-Hash header validation is not yet implemented — pending ERP team confirmation."
    ),
    response_description="Acknowledgement that the status update was persisted.",
)
async def erp_webhook(request: Request):
    """
    Process an ERP per-line approval payload, derive per-wheel + overall status,
    and propagate the result to Firestore.

    Steps:
      1. Look up the order by payload.request_id (text key in open_orders).
      2. Group DiagnoseData by Location.
      3. Build a per-wheel ActionCode → bool map (`action_approvals`) so the
         frontend can render the exact per-line decision for every action,
         not just the rolled-up wheel summary.
      4. Load submitted diagnosis JSONB and treat diagnosis.tires as source of truth
         for which approval lines exist.
      5. For each submitted wheel, compute "full" / "none" from returned approvals.
      6. Compute overall status by cross-referencing submitted lines:
            all approved → 'approved', none approved → 'declined', mixed → 'partly-approved'.
      7. Persist under open_orders.diagnosis['erp_response'] (including
         `action_approvals`), update status / declined_at, and signal Firestore.

    TODO: verify X-ERP-Hash header once auth method confirmed with ERP team (open Q4).

    Raises:
        404: No order with the given request_id found in the database.
    """
    raw = await request.body()
    raw_text = raw.decode("utf-8", errors="replace")
    log("WEBHOOK/erp", f"raw body: {raw_text}")
    try:
        import json as _json
        data = _json.loads(raw.decode("utf-8", errors="replace"))
        payload = ErpWebhookPayload(**data)
    except Exception as e:
        log_error("erp_webhook", f"payload parse failed: {e} | raw={raw_text[:500]}")
        raise HTTPException(status_code=400, detail=str(e))

    log(
        "WEBHOOK/erp",
        f"received request_id={payload.request_id} lines={len(payload.DiagnoseData)}",
    )
    db = request.app.state.db

    log("DB", f"SELECT open_orders WHERE request_id={payload.request_id}")
    order = await db.fetchrow(
        "SELECT id, shop_id, diagnosis FROM open_orders WHERE request_id = $1",
        payload.request_id,
    )
    if not order:
        log_error("erp_webhook", f"order not found for request_id={payload.request_id}")
        raise HTTPException(status_code=404, detail="Order not found")

    items_by_location: dict[str, list] = {}
    for item in payload.DiagnoseData:
        items_by_location.setdefault(item.Location, []).append(item)

    # Per-wheel approval map keyed by ActionCode string. Mirrors what the ERP
    # actually returned in DiagnoseData so the frontend can render exact
    # per-line approvals without re-deriving them from the wheels summary.
    action_approvals: dict[str, dict[str, bool]] = {}
    for item in payload.DiagnoseData:
        if item.Location == _FRONT_ALIGNMENT_LOCATION:
            continue
        position = _LOCATION_TO_POSITION.get(item.Location)
        if not position:
            continue
        if position not in action_approvals:
            action_approvals[position] = {}
        action_approvals[position][item.Action] = item.Confirmed == "1"

    wheels: dict[str, str] = {}
    front_alignment_confirmed = False

    for location, items in items_by_location.items():
        if location == _FRONT_ALIGNMENT_LOCATION:
            for item in items:
                if item.Confirmed == "1":
                    front_alignment_confirmed = True
            continue

        position = _LOCATION_TO_POSITION.get(location)
        if not position:
            # Unknown location code — skip but keep auditing via raw payload below.
            continue

    diagnosis = _coerce_jsonb(order["diagnosis"])
    submitted_tires = diagnosis.get("tires") or {}
    submitted_front_alignment = bool(diagnosis.get("front_alignment"))

    # Cross-reference action_approvals against what the mechanic actually
    # submitted: any submitted action the ERP did not echo back is treated
    # as declined (False) so the frontend renders an explicit red ✗ badge
    # rather than nothing. Relocation source lines are not approval lines
    # and are skipped here (matches the totals loop below).
    #
    # front_alignment is intentionally not touched: it is tracked separately
    # via `front_alignment_confirmed` and rendered from that flag, not from
    # action_approvals.
    for position, actions in submitted_tires.items():
        for action in actions or []:
            if action.get("transfer_target"):
                continue
            action_code = str(action.get("action"))
            if position not in action_approvals:
                action_approvals[position] = {}
            if action_code not in action_approvals[position]:
                action_approvals[position][action_code] = False

    total_submitted_lines = 0
    approved_submitted_lines = 0

    for position, actions in submitted_tires.items():
        wheel_approvals = action_approvals.get(position, {})
        wheels[position] = "full" if any(wheel_approvals.values()) else "none"
        for action in actions or []:
            if action.get("transfer_target"):
                # Relocation source lines are never approval lines.
                continue
            action_code = str(action.get("action"))
            total_submitted_lines += 1
            if wheel_approvals.get(action_code) is True:
                approved_submitted_lines += 1

    if submitted_front_alignment:
        total_submitted_lines += 1
        if front_alignment_confirmed:
            approved_submitted_lines += 1

    if total_submitted_lines == 0 or approved_submitted_lines == 0:
        status = "declined"
    elif approved_submitted_lines == total_submitted_lines:
        status = "approved"
    else:
        status = "partly-approved"

    erp_response = {
        "wheels": wheels,
        "front_alignment_confirmed": front_alignment_confirmed,
        "action_approvals": action_approvals,
    }

    declined_at = datetime.now(timezone.utc) if status == "declined" else None
    log(
        "WEBHOOK/erp",
        f"computed status={status} order_id={order['id']} wheels={wheels} alignment_confirmed={front_alignment_confirmed}",
    )

    log("DB", f"UPDATE open_orders status={status} for order_id={order['id']}")
    await db.execute(
        """
        UPDATE open_orders
        SET status = $1, declined_at = $2,
            diagnosis = jsonb_set(
                COALESCE(diagnosis, '{}'),
                '{erp_response}',
                $3::jsonb
            )
        WHERE id = $4
        """,
        status,
        declined_at,
        json.dumps(erp_response),
        order["id"],
    )

    _firestore_signal(request.app, order["shop_id"], str(order["id"]), status)
    log("WEBHOOK/erp", f"ack order_id={order['id']} status={status}")
    return {"ack": True}


@router.post(
    "/carool",
    summary="Receive AI analysis results from Carool",
    description=(
        "Called asynchronously by Carool after a photo-analysis session is complete "
        "(triggered by POST /api/carool/finalize). "
        "Merges the AI results into `open_orders.diagnosis['carool_result']`, then "
        "auto-submits the combined diagnosis to the ERP (the order is expected to "
        "be sitting at `status='pending_carool'` from a prior `/api/diagnosis/draft` "
        "call). On a successful ERP ack the order moves to `status='waiting'` and a "
        "Firestore signal is written; on ERP rejection the failure is logged and the "
        "order stays in `pending_carool` so it can be re-submitted manually. "
        "Always returns 200 — Carool retries indefinitely on any non-2xx response. "
        "Authenticated via **X-API-KEY** header (must match the `CAROOL_API_KEY` secret)."
    ),
    response_description="Acknowledgement that the Carool results were persisted.",
)
async def carool_webhook(payload: CaroolWebhookPayload, request: Request):
    """
    Merge Carool AI analysis results into the order and forward to the ERP.

    Authenticates via X-API-KEY header. Uses payload.externalId to locate the
    order (this field is set by the backend when calling Carool open_session).
    Stores the full payload under open_orders.diagnosis['carool_result'], then
    re-fetches the row (including erp_hash) and calls _submit_to_erp, which
    builds the merged ERP payload, sends SendDiagnose, and on success flips
    status to 'waiting'. ERP failures are logged but never surfaced to Carool
    — Carool would retry indefinitely on any non-2xx response.

    Raises:
        401: Either the CAROOL_API_KEY secret is not configured on this instance
             (logged as a "500 Misconfigured" ops issue), or the incoming
             X-API-KEY header is missing / does not match the secret
             (logged as "401 Unauthorized"). Both return 401 to the caller to
             avoid leaking internal config state.
        404: No order matching payload.externalId found in the database.
    """
    log("WEBHOOK/carool", f"received externalId={payload.externalId}")
    api_key = request.headers.get("X-API-KEY", "")
    if not CAROOL_API_KEY:
        log_error("carool_webhook", f"500 Misconfigured — CAROOL_API_KEY secret is not set; rejecting all Carool callbacks externalId={payload.externalId}")
        raise HTTPException(status_code=401, detail="Unauthorized")
    if api_key != CAROOL_API_KEY:
        log_error("carool_webhook", f"401 Unauthorized — bad/missing X-API-KEY externalId={payload.externalId}")
        raise HTTPException(status_code=401, detail="Unauthorized")

    db = request.app.state.db

    log("DB", f"SELECT open_orders WHERE id={payload.externalId}")
    order = await db.fetchrow(
        "SELECT id, shop_id, status FROM open_orders WHERE id = $1",
        payload.externalId,
    )
    if not order:
        log_error("carool_webhook", f"order not found externalId={payload.externalId}")
        raise HTTPException(status_code=404, detail="Order not found")

    log("DB", f"UPDATE open_orders SET diagnosis.carool_result for order_id={order['id']}")
    await db.execute(
        """
        UPDATE open_orders
        SET diagnosis = jsonb_set(
                COALESCE(diagnosis, '{}'),
                '{carool_result}',
                $1::jsonb
            )
        WHERE id = $2
        """,
        payload.model_dump_json(),
        order["id"],
    )

    # Re-fetch the freshly merged row so _submit_to_erp can read both
    # mechanic_inputs (saved earlier by /api/diagnosis/draft) and the
    # carool_result we just persisted. erp_hash is read from open_orders
    # because the webhook has no JWT to fall back on.
    #
    # NOTE: backend-plan.md and the original change spec describe a separate
    # `shops` table holding shop credentials and suggest a JOIN here. That
    # table does not exist in the current schema (see backend/db/schema.sql);
    # erp_hash is currently a column on open_orders. Switch this query to
    # `JOIN shops s ON s.id = o.shop_id` once that migration lands.
    log("DB", f"SELECT order full row for ERP submit order_id={order['id']}")
    full_order = await db.fetchrow(
        """
        SELECT id, shop_id, request_id, carool_diagnosis_id,
               license_plate, diagnosis, car_data, erp_hash
        FROM open_orders
        WHERE id = $1
        """,
        order["id"],
    )
    if not full_order:
        # Should be impossible — we just updated the same row above.
        log_error(
            "carool_webhook",
            f"order vanished between carool_result update and ERP re-fetch order_id={order['id']}",
        )
        return {"ack": True}

    try:
        await _submit_to_erp(
            full_order,
            _coerce_jsonb(full_order["car_data"]),
            full_order["shop_id"],
            full_order["erp_hash"],
            db,
        )
    except Exception as e:
        # Carool retries on any non-2xx response, which we never want — the
        # mechanic's order is now stuck in 'pending_carool' and a human needs
        # to retry the ERP submission manually. Surface it loudly in logs.
        log_error(
            "carool_webhook",
            f"ERP submit failed after carool merge order_id={order['id']}: {e}; "
            f"acking carool to prevent retries — manual ERP re-submit required",
        )
        return {"ack": True}

    _firestore_signal(request.app, full_order["shop_id"], str(full_order["id"]), "waiting")
    log("WEBHOOK/carool", f"ack order_id={order['id']} status=waiting (ERP submitted)")
    return {"ack": True}
