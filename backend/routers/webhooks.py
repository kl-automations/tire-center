"""
Inbound webhooks from ERP and Carool.
Both write a Firestore signal after updating the DB so the frontend
gets a live push without polling.
"""

import os
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Request
from models.schemas import ErpWebhookPayload, CaroolWebhookPayload

router = APIRouter(prefix="/api/webhook", tags=["webhooks"])


def _firestore_signal(app, shop_id: str, order_id: str, status: str):
    """Write orders/{shop_id}/updates/{order_id} in Firestore."""
    try:
        db = app.state.firestore
        db.collection("orders").document(shop_id) \
          .collection("updates").document(order_id) \
          .set({"status": status, "updated_at": datetime.now(timezone.utc).isoformat()})
    except Exception:
        pass  # Firestore signal is best-effort — don't fail the webhook response


@router.post("/erp")
async def erp_webhook(payload: ErpWebhookPayload, request: Request):
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


@router.post("/carool")
async def carool_webhook(payload: CaroolWebhookPayload, request: Request):
    # Carool sends X-API-KEY for auth — verify it
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
