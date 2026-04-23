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

from fastapi import APIRouter, Depends, HTTPException, Request
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
    stored on the order, then sent via erp.submit_diagnosis (currently stubbed).

    Raises:
        404: Order not found or does not belong to the authenticated shop.
        502: ERP returned a failure response (stubbed: always succeeds for now).
    """
    db = request.app.state.db
    order = await db.fetchrow(
        "SELECT request_id, carool_diagnosis_id FROM open_orders WHERE id = $1 AND shop_id = $2",
        body.order_id, shop["shop_id"],
    )
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    erp_payload = {
        "request_id": order["request_id"],
        "mileage": body.mileage_update,
        "front_alignment": body.front_alignment,
        "carool_id": order["carool_diagnosis_id"],
        "tires": {
            wheel: [a.model_dump(exclude_none=True) for a in actions]
            for wheel, actions in body.tires.items()
        },
    }

    ok = await erp.submit_diagnosis(order["request_id"], erp_payload, shop["erp_hash"])
    if not ok:
        raise HTTPException(status_code=502, detail="ERP rejected diagnosis")

    await db.execute(
        "UPDATE open_orders SET status = 'waiting', diagnosis = $1 WHERE id = $2",
        erp_payload, body.order_id,
    )

    return {"ack": True}
