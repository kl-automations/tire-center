"""
History-export router — allows a shop to request a service-history report via email.

Delegates entirely to the ERP: the backend extracts shop_id and erp_hash from
the JWT and forwards the date range + email to the ERP SOAP method. The ERP
generates and sends the report asynchronously; there is no webhook callback.
"""

from fastapi import APIRouter, Depends
from logging_utils import log
from middleware.auth import get_current_shop
from models.schemas import HistoryRequest
from adapters import erp

router = APIRouter(prefix="/api", tags=["history"])


@router.post(
    "/history",
    summary="Request a service-history export by email",
    description=(
        "Asks the ERP to compile a history report for the authenticated shop "
        "covering the given date range and email it to the specified address. "
        "The ERP handles report generation and delivery asynchronously — "
        "this endpoint returns an acknowledgement only. "
        "Returns `{ \"ack\": true }` on success."
    ),
    response_description="Acknowledgement that the ERP accepted the export request.",
)
async def export_history(
    body: HistoryRequest,
    shop: dict = Depends(get_current_shop),
):
    """
    Forward a history-export request to the ERP.

    The shop_id and erp_hash are read from the JWT via get_current_shop.
    The ERP will email the report to body.email; there is no polling endpoint.

    Note: request_history_export is currently a stub in adapters/erp.py.
    """
    log(
        "ROUTER/history",
        f"export received shop_id={shop['shop_id']} from={body.date_from} to={body.date_to} email={body.email}",
    )
    ok = await erp.request_history_export(
        shop_id=shop["shop_id"],
        date_from=body.date_from,
        date_to=body.date_to,
        email=body.email,
        erp_hash=shop["erp_hash"],
    )
    log("ROUTER/history", f"export ack={ok} shop_id={shop['shop_id']}")
    return {"ack": ok}
