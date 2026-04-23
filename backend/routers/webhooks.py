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

import os
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Request
from models.schemas import ErpWebhookPayload, CaroolWebhookPayload

router = APIRouter(prefix="/api/webhook", tags=["webhooks"])


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
        db = app.state.firestore
        db.collection("orders").document(shop_id) \
          .collection("updates").document(order_id) \
          .set({"status": status, "updated_at": datetime.now(timezone.utc).isoformat()})
    except Exception:
        pass


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
    Process an ERP order-status update and propagate it to Firestore.

    Looks up the order by ERP request_id (not UUID). Stores the full payload
    under open_orders.diagnosis['erp_response'] for auditability.

    TODO: verify X-ERP-Hash header once auth method confirmed with ERP team (open Q4).

    Raises:
        404: No order with the given request_id found in the database.
    """
    # TODO: verify X-ERP-Hash header once auth method confirmed with ERP team (Q4)
    db = request.app.state.db

    order = await db.fetchrow(
        "SELECT id, shop_id FROM open_orders WHERE request_id = $1",
        payload.request_id,
    )
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    declined_at = datetime.now(timezone.utc) if payload.status == "declined" else None

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
        payload.status,
        declined_at,
        payload.model_dump_json(),
        order["id"],
    )

    _firestore_signal(request.app, order["shop_id"], str(order["id"]), payload.status)
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
    api_key = request.headers.get("X-API-KEY", "")
    if api_key != os.environ.get("CAROOL_API_KEY", ""):
        raise HTTPException(status_code=401, detail="Unauthorized")

    db = request.app.state.db

    order = await db.fetchrow(
        "SELECT id, shop_id, status FROM open_orders WHERE id = $1",
        payload.externalId,
    )
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

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
    return {"ack": True}
