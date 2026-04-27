"""
Carool AI photo-analysis router — Wave 1.5 of the service-order flow.

The mechanic taps the camera icon for up to 4 wheels (2 photos each):
  1. POST /api/carool/session   →  Carool POST /ai-diagnoses   →  returns carool_id
  2. POST /api/carool/photo     →  Carool POST /ai-diagnoses/{id}/sidewall-picture
                                or Carool POST /ai-diagnoses/{id}/tread-picture
  3. POST /api/carool/finalize  →  Carool POST /ai-diagnoses/{id}/uploaded
     (Carool then calls POST /api/webhook/carool asynchronously with results)

All three endpoints require a valid JWT (Authorization: Bearer <token>).
"""

from fastapi import APIRouter, Depends, File, Form, Request, Response, UploadFile, HTTPException
from middleware.auth import get_current_shop
from models.schemas import CaroolSessionRequest, CaroolSessionResponse, CaroolFinalizeRequest
from adapters import carool
from config import CAROOL_ENABLED

router = APIRouter(prefix="/api/carool", tags=["carool"])


@router.post(
    "/session",
    response_model=CaroolSessionResponse,
    summary="Open a Carool AI photo-analysis session",
    description=(
        "Creates a new Carool analysis session for the given order. "
        "The `carool_id` returned must be supplied to all subsequent "
        "`/api/carool/photo` and `/api/carool/finalize` calls. "
        "The ID is also stored in `open_orders.carool_diagnosis_id`."
    ),
    response_description="The Carool session ID to use in photo upload and finalize calls.",
    responses={204: {"description": "Carool integration is disabled (CAROOL_ENABLED=0); no-op."}},
)
async def open_session(
    body: CaroolSessionRequest,
    request: Request,
    shop: dict = Depends(get_current_shop),
):
    """
    Open a Carool session and persist the session ID against the order.

    Verifies the order belongs to the authenticated shop before creating
    the session. The order ID is forwarded to Carool as `externalId` so the
    webhook callback can be matched back to the originating order. On success,
    updates open_orders.carool_diagnosis_id.

    Raises:
        404: Order not found or does not belong to the authenticated shop.
    """
    if not CAROOL_ENABLED:
        # Returning a `Response` object bypasses `response_model` validation —
        # a dict body would fail to serialize as `CaroolSessionResponse`.
        return Response(status_code=204)
    db = request.app.state.db
    order = await db.fetchrow(
        "SELECT license_plate, mileage FROM open_orders WHERE id = $1 AND shop_id = $2",
        body.order_id, shop["shop_id"],
    )
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    carool_id = await carool.open_session(body.order_id, order["license_plate"], order["mileage"])

    await db.execute(
        "UPDATE open_orders SET carool_diagnosis_id = $1 WHERE id = $2",
        carool_id, body.order_id,
    )

    return CaroolSessionResponse(carool_id=carool_id)


@router.post(
    "/photo",
    summary="Upload a tyre photo to an active Carool session",
    description=(
        "Accepts a multipart/form-data upload. "
        "`wheel` must be one of: `FRONT_LEFT`, `FRONT_RIGHT`, `REAR_LEFT`, `REAR_RIGHT`. "
        "`photo_type` must be one of: `sidewall`, `tread`. "
        "Each wheel supports up to two photos (one sidewall + one tread). "
        "Requires an active Carool session opened via `/api/carool/session`."
    ),
    response_description="Confirmation that the photo was forwarded to Carool.",
    responses={204: {"description": "Carool integration is disabled (CAROOL_ENABLED=0); no-op."}},
)
async def upload_photo(
    request: Request,
    order_id: str = Form(...),
    wheel: str = Form(...),       # FRONT_LEFT | FRONT_RIGHT | REAR_LEFT | REAR_RIGHT
    photo_type: str = Form(...),  # sidewall | tread
    file: UploadFile = File(...),
    shop: dict = Depends(get_current_shop),
):
    """
    Stream a tyre photo to Carool for the given wheel position and photo type.

    Reads carool_diagnosis_id from open_orders to obtain the active session ID.
    The image bytes are read into memory and forwarded via the Carool adapter.

    Raises:
        404: Order not found, does not belong to the shop, or has no active Carool session.
    """
    if not CAROOL_ENABLED:
        return Response(status_code=204)
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


@router.post(
    "/finalize",
    summary="Finalise a Carool session after all photos are uploaded",
    description=(
        "Signals Carool that photo upload is complete and AI analysis should begin. "
        "Carool will process the images asynchronously and fire a webhook to "
        "`POST /api/webhook/carool` when results are ready."
    ),
    response_description="Confirmation that Carool was notified to start analysis.",
    responses={204: {"description": "Carool integration is disabled (CAROOL_ENABLED=0); no-op."}},
)
async def finalize(
    body: CaroolFinalizeRequest,
    request: Request,
    shop: dict = Depends(get_current_shop),
):
    """
    Tell Carool all photos are uploaded and analysis can begin.

    After this call, Carool processes the images asynchronously. When done it
    fires POST /api/webhook/carool with the analysis results, which the backend
    merges into open_orders.diagnosis and signals via Firestore.

    Raises:
        404: Order not found, does not belong to the shop, or has no active Carool session.
    """
    if not CAROOL_ENABLED:
        return Response(status_code=204)
    db = request.app.state.db
    carool_id = await db.fetchval(
        "SELECT carool_diagnosis_id FROM open_orders WHERE id = $1 AND shop_id = $2",
        body.order_id, shop["shop_id"],
    )
    if not carool_id:
        raise HTTPException(status_code=404, detail="Order or Carool session not found")

    await carool.finalize_session(carool_id)
    return {"finalized": True}
