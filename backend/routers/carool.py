from fastapi import APIRouter, Depends, File, Form, Request, UploadFile, HTTPException
from middleware.auth import get_current_shop
from models.schemas import CaroolSessionRequest, CaroolSessionResponse, CaroolFinalizeRequest
from adapters import carool

router = APIRouter(prefix="/api/carool", tags=["carool"])


@router.post("/session", response_model=CaroolSessionResponse)
async def open_session(
    body: CaroolSessionRequest,
    request: Request,
    shop: dict = Depends(get_current_shop),
):
    db = request.app.state.db
    order = await db.fetchrow(
        "SELECT license_plate, mileage FROM open_orders WHERE id = $1 AND shop_id = $2",
        body.order_id, shop["shop_id"],
    )
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    carool_id = await carool.open_session(order["license_plate"], order["mileage"])

    await db.execute(
        "UPDATE open_orders SET carool_diagnosis_id = $1 WHERE id = $2",
        carool_id, body.order_id,
    )

    return CaroolSessionResponse(carool_id=carool_id)


@router.post("/photo")
async def upload_photo(
    request: Request,
    order_id: str = Form(...),
    wheel: str = Form(...),       # FRONT_LEFT | FRONT_RIGHT | REAR_LEFT | REAR_RIGHT
    photo_type: str = Form(...),  # sidewall | tread
    file: UploadFile = File(...),
    shop: dict = Depends(get_current_shop),
):
    db = request.app.state.db
    carool_id = await db.fetchval(
        "SELECT carool_diagnosis_id FROM open_orders WHERE id = $1 AND shop_id = $2",
        order_id, shop["shop_id"],
    )
    if not carool_id:
        raise HTTPException(status_code=404, detail="Order or Carool session not found")

    image_bytes = await file.read()
    await carool.upload_photo(carool_id, photo_type, image_bytes, file.content_type or "image/jpeg")

    return {"uploaded": True}


@router.post("/finalize")
async def finalize(
    body: CaroolFinalizeRequest,
    request: Request,
    shop: dict = Depends(get_current_shop),
):
    db = request.app.state.db
    carool_id = await db.fetchval(
        "SELECT carool_diagnosis_id FROM open_orders WHERE id = $1 AND shop_id = $2",
        body.order_id, shop["shop_id"],
    )
    if not carool_id:
        raise HTTPException(status_code=404, detail="Order or Carool session not found")

    await carool.finalize_session(carool_id)
    return {"finalized": True}
