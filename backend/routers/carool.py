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
from logging_utils import log, log_error
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
    log("ROUTER/carool", f"open_session received order_id={body.order_id} shop_id={shop['shop_id']}")
    if not CAROOL_ENABLED:
        log("ROUTER/carool", "open_session skipped — CAROOL_ENABLED=false (returning 204)")
        # Returning a `Response` object bypasses `response_model` validation —
        # a dict body would fail to serialize as `CaroolSessionResponse`.
        return Response(status_code=204)
    db = request.app.state.db
    log("DB", f"SELECT open_orders for order_id={body.order_id} shop_id={shop['shop_id']}")
    order = await db.fetchrow(
        "SELECT license_plate, mileage FROM open_orders WHERE id = $1 AND shop_id = $2",
        body.order_id, shop["shop_id"],
    )
    if not order:
        log_error("carool", f"open_session order not found order_id={body.order_id}")
        raise HTTPException(status_code=404, detail="Order not found")

    carool_id = await carool.open_session(body.order_id, order["license_plate"], order["mileage"])

    log("DB", f"UPDATE open_orders.carool_diagnosis_id={carool_id} for order_id={body.order_id}")
    await db.execute(
        "UPDATE open_orders SET carool_diagnosis_id = $1 WHERE id = $2",
        carool_id, body.order_id,
    )
    log("ROUTER/carool", f"open_session success order_id={body.order_id} carool_id={carool_id}")

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
    log(
        "ROUTER/carool",
        f"upload_photo received order_id={order_id} wheel={wheel} photo_type={photo_type} shop_id={shop['shop_id']}",
    )
    if not CAROOL_ENABLED:
        log("ROUTER/carool", "upload_photo skipped — CAROOL_ENABLED=false (returning 204)")
        return Response(status_code=204)
    db = request.app.state.db
    log("DB", f"SELECT carool_diagnosis_id for order_id={order_id} shop_id={shop['shop_id']}")
    carool_id = await db.fetchval(
        "SELECT carool_diagnosis_id FROM open_orders WHERE id = $1 AND shop_id = $2",
        order_id, shop["shop_id"],
    )
    if not carool_id:
        log_error("carool", f"upload_photo no active session order_id={order_id}")
        raise HTTPException(status_code=404, detail="Order or Carool session not found")

    image_bytes = await file.read()
    log("ROUTER/carool", f"upload_photo file read bytes={len(image_bytes)} carool_id={carool_id}")
    await carool.upload_photo(carool_id, photo_type, image_bytes, file.content_type or "image/jpeg")

    log("ROUTER/carool", f"upload_photo success order_id={order_id} wheel={wheel} type={photo_type}")
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
    log("ROUTER/carool", f"finalize received order_id={body.order_id} shop_id={shop['shop_id']}")
    if not CAROOL_ENABLED:
        log("ROUTER/carool", "finalize skipped — CAROOL_ENABLED=false (returning 204)")
        return Response(status_code=204)
    db = request.app.state.db
    log("DB", f"SELECT carool_diagnosis_id for order_id={body.order_id}")
    carool_id = await db.fetchval(
        "SELECT carool_diagnosis_id FROM open_orders WHERE id = $1 AND shop_id = $2",
        body.order_id, shop["shop_id"],
    )
    if not carool_id:
        log_error("carool", f"finalize no active session order_id={body.order_id}")
        raise HTTPException(status_code=404, detail="Order or Carool session not found")

    await carool.finalize_session(carool_id)
    log("ROUTER/carool", f"finalize success order_id={body.order_id} carool_id={carool_id}")
    return {"finalized": True}
