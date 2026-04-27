"""
Diagnosis router — Wave 2 of the service-order flow.

The mechanic submits the completed diagnosis (per-wheel actions, alignment,
updated mileage). The backend:
  1. Validates the order belongs to the authenticated shop.
  2. Forwards the payload to the ERP via SOAP (submit_diagnosis).
  3. Sets open_orders.status = 'waiting' and persists the diagnosis JSONB.

After this point the ERP will asynchronously fire POST /api/webhook/erp
with the approval decision (approved / partly-approved / declined).
"""

import json

from fastapi import APIRouter, Depends, HTTPException, Request
from logging_utils import log, log_error
from middleware.auth import get_current_shop
from models.schemas import DiagnosisRequest
from adapters import erp

router = APIRouter(prefix="/api", tags=["diagnosis"])


@router.post(
    "/diagnosis",
    summary="Submit a completed tyre-service diagnosis",
    description=(
        "Accepts the mechanic's full diagnosis for a service visit: per-wheel tyre actions, "
        "front-alignment flag, and updated mileage. "
        "The payload is forwarded to the ERP and persisted in `open_orders.diagnosis` (JSONB). "
        "On success the order status transitions to **`waiting`** (pending manager approval). "
        "Returns `502` if the ERP rejects the submission."
    ),
    response_description="Acknowledgement that the diagnosis was accepted by the ERP.",
)
async def submit_diagnosis(
    body: DiagnosisRequest,
    request: Request,
    shop: dict = Depends(get_current_shop),
):
    """
    Validate, forward to ERP, and persist the mechanic's diagnosis.

    Ownership check: verifies open_orders.shop_id matches the JWT shop_id.
    The erp_payload is constructed from the request body and the ERP request_id
    stored on the order, then sent to the ERP via erp.submit_diagnosis (SendDiagnose SOAP).

    Raises:
        404: Order not found or does not belong to the authenticated shop.
        502: ERP returned a failure response (ReturnCode != "1").
    """
    log(
        "ROUTER/diagnosis",
        f"submit received order_id={body.order_id} shop_id={shop['shop_id']} mileage={body.mileage_update} alignment={body.front_alignment}",
    )
    db = request.app.state.db
    log("DB", f"SELECT open_orders for order_id={body.order_id}")
    order = await db.fetchrow(
        "SELECT request_id, carool_diagnosis_id, license_plate FROM open_orders WHERE id = $1 AND shop_id = $2",
        body.order_id, shop["shop_id"],
    )
    if not order:
        log_error("diagnosis", f"order not found order_id={body.order_id}")
        raise HTTPException(status_code=404, detail="Order not found")

    erp_payload = {
        "request_id": order["request_id"],
        "mileage": body.mileage_update,
        "front_alignment": body.front_alignment,
        "carool_id": order["carool_diagnosis_id"],
        "license_plate": order["license_plate"],
        "tires": {
            wheel: [a.model_dump(exclude_none=True) for a in actions]
            for wheel, actions in body.tires.items()
        },
    }

    log("ROUTER/diagnosis", f"forwarding diagnosis to ERP request_id={order['request_id']}")
    ok = await erp.submit_diagnosis(order["request_id"], erp_payload, shop["shop_id"], shop["erp_hash"])
    if not ok:
        log_error("diagnosis", f"ERP rejected diagnosis order_id={body.order_id} request_id={order['request_id']}")
        raise HTTPException(status_code=502, detail="ERP rejected diagnosis")

    log("DB", f"UPDATE open_orders SET status='waiting' for order_id={body.order_id}")
    await db.execute(
        "UPDATE open_orders SET status = 'waiting', diagnosis = $1 WHERE id = $2",
        json.dumps(erp_payload), body.order_id,
    )
    log("ROUTER/diagnosis", f"submit success order_id={body.order_id} status=waiting")

    return {"ack": True}
