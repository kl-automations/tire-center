from fastapi import APIRouter, Depends
from middleware.auth import get_current_shop
from models.schemas import HistoryRequest
from adapters import erp

router = APIRouter(prefix="/api", tags=["history"])


@router.post("/history")
async def export_history(
    body: HistoryRequest,
    shop: dict = Depends(get_current_shop),
):
    ok = await erp.request_history_export(
        shop_id=shop["shop_id"],
        date_from=body.date_from,
        date_to=body.date_to,
        email=body.email,
        erp_hash=shop["erp_hash"],
    )
    return {"ack": ok}
