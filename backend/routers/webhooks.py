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
import os
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Request
from logging_utils import log, log_error
from models.schemas import ErpWebhookPayload, CaroolWebhookPayload

router = APIRouter(prefix="/api/webhook", tags=["webhooks"])


# Inverse of the lookup tables in adapters/erp.py — maps ERP codes back to
# the wheel-position / action-name strings used internally and by the frontend.
_LOCATION_TO_POSITION = {
    "1": "front-left", "2": "front-right", "3": "rear-right",
    "4": "rear-left",  "5": "spare-tire",  "7": "rear-left-inner",
    "8": "rear-right-inner",
}
_ACTION_TO_NAME = {
    "3": "wear", "23": "damage", "25": "fitment",
    "4": "puncture", "2": "front_alignment",
}
_FRONT_ALIGNMENT_LOCATION = "6"
_FRONT_ALIGNMENT_ACTION = "2"

# Replacement-action codes (any approved replacement → wheel marked "full")
_REPLACEMENT_ACTIONS = {"3", "23", "25"}
_PUNCTURE_ACTION = "4"


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
async def erp_webhook(payload: ErpWebhookPayload, request: Request):
    """
    Process an ERP per-line approval payload, derive per-wheel + overall status,
    and propagate the result to Firestore.

    Steps:
      1. Look up the order by str(payload.request_id) — DB stores request_id as text.
      2. Group DiagnoseData by Location.
      3. For each non-front-alignment location, compute "full" / "puncture-only" / "none".
      4. For the front-alignment line (Location='6', Action='2'), record its Confirmed flag.
      5. Compute overall status from all non-alignment items:
            all '1' → 'approved', all '0' → 'declined', mix → 'partly-approved'.
      6. Persist under open_orders.diagnosis['erp_response'], update status / declined_at,
         and signal Firestore.

    TODO: verify X-ERP-Hash header once auth method confirmed with ERP team (open Q4).

    Raises:
        404: No order with the given request_id found in the database.
    """
    log(
        "WEBHOOK/erp",
        f"received request_id={payload.request_id} lines={len(payload.DiagnoseData)}",
    )
    db = request.app.state.db

    log("DB", f"SELECT open_orders WHERE request_id={payload.request_id}")
    order = await db.fetchrow(
        "SELECT id, shop_id FROM open_orders WHERE request_id = $1",
        str(payload.request_id),
    )
    if not order:
        log_error("erp_webhook", f"order not found for request_id={payload.request_id}")
        raise HTTPException(status_code=404, detail="Order not found")

    items_by_location: dict[str, list] = {}
    for item in payload.DiagnoseData:
        items_by_location.setdefault(item.Location, []).append(item)

    wheels: dict[str, str] = {}
    front_alignment_confirmed = False
    non_alignment_items = []

    for location, items in items_by_location.items():
        if location == _FRONT_ALIGNMENT_LOCATION:
            for item in items:
                if item.Action == _FRONT_ALIGNMENT_ACTION:
                    front_alignment_confirmed = item.Confirmed == "1"
            continue

        position = _LOCATION_TO_POSITION.get(location)
        if not position:
            # Unknown location code — skip but keep auditing via raw payload below.
            continue

        non_alignment_items.extend(items)

        replacement_present = any(
            item.Action in _REPLACEMENT_ACTIONS for item in items
        )
        replacement_approved = any(
            item.Action in _REPLACEMENT_ACTIONS and item.Confirmed == "1"
            for item in items
        )
        puncture_approved = any(
            item.Action == _PUNCTURE_ACTION and item.Confirmed == "1"
            for item in items
        )

        if replacement_approved:
            wheels[position] = "full"
        elif puncture_approved:
            # "puncture-only" specifically means the mechanic asked for a
            # replacement and the ERP downgraded it to a puncture repair.
            # If puncture was the only submitted action, an approval is "full".
            wheels[position] = "puncture-only" if replacement_present else "full"
        else:
            wheels[position] = "none"

    if non_alignment_items:
        confirmed_flags = {item.Confirmed for item in non_alignment_items}
        if confirmed_flags == {"1"}:
            status = "approved"
        elif confirmed_flags == {"0"}:
            status = "declined"
        else:
            status = "partly-approved"
    else:
        # Edge case: payload contains only the front-alignment line (no per-wheel
        # items), e.g. when alignment was the sole submitted action. Derive the
        # overall status from the alignment flag — wheels{} will be empty.
        status = "approved" if front_alignment_confirmed else "declined"

    erp_response = {
        "wheels": wheels,
        "front_alignment_confirmed": front_alignment_confirmed,
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
        "Merges the AI results into `open_orders.diagnosis['carool_result']` and "
        "writes a Firestore signal. "
        "Authenticated via **X-API-KEY** header (must match the `CAROOL_API_KEY` secret)."
    ),
    response_description="Acknowledgement that the Carool results were persisted.",
)
async def carool_webhook(payload: CaroolWebhookPayload, request: Request):
    """
    Merge Carool AI analysis results into the order and signal the frontend.

    Authenticates via X-API-KEY header. Uses payload.externalId to locate the
    order (this field is set by the backend when calling Carool open_session).
    Stores the full payload under open_orders.diagnosis['carool_result'].

    Raises:
        401: X-API-KEY header missing or does not match CAROOL_API_KEY secret.
        404: No order matching payload.externalId found in the database.
    """
    log("WEBHOOK/carool", f"received externalId={payload.externalId}")
    api_key = request.headers.get("X-API-KEY", "")
    if api_key != os.environ.get("CAROOL_API_KEY", ""):
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

    _firestore_signal(request.app, order["shop_id"], str(order["id"]), order["status"])
    log("WEBHOOK/carool", f"ack order_id={order['id']} status={order['status']}")
    return {"ack": True}
