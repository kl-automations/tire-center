from fastapi import APIRouter, Depends, HTTPException, Request
from middleware.auth import get_current_shop
from models.schemas import DiagnosisRequest
from adapters import erp

router = APIRouter(prefix="/api", tags=["diagnosis"])


@router.post("/diagnosis")
async def submit_diagnosis(
    body: DiagnosisRequest,
    request: Request,
    shop: dict = Depends(get_current_shop),
):
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
