"""
Stock Availability router — list + mechanic approve/decline (Tafnit SOAP ack).
"""

import asyncio

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, status

from adapters.erp import send_query_response
from logging_utils import log, log_error
from middleware.auth import get_current_shop
from routers.webhooks import _stock_availability_signal

router = APIRouter(prefix="/api/stock-availability", tags=["stock-availability"])

_MAX_ACK_ATTEMPTS = 30
_BACKOFF_SECS = (1, 2, 4, 8, 16, 32)


def _backoff_seconds(failure_count: int) -> float:
    idx = failure_count - 1
    if 0 <= idx < len(_BACKOFF_SECS):
        return float(_BACKOFF_SECS[idx])
    return 60.0


def _is_transport_error(exc: BaseException) -> bool:
    return isinstance(exc, httpx.RequestError)


async def _ack_tafnit_with_retry(
    app,
    *,
    shop_id: str,
    erp_hash: str,
    erp_shop_id: str,
    request_id: str,
    apply_id: int,
    tire_shop_code: int,
    tafnit_response: int,
    ack_status: str,
) -> None:
    """
    Background: SendQueryResponse then Firestore ``ack_status``.
    Retries only on transport failures; any HTTP/SOAP-layer completion writes ack.
    """
    try:
        failures = 0
        while True:
            try:
                rc = await send_query_response(
                    apply_id,
                    tire_shop_code,
                    tafnit_response,
                    shop_id,
                    erp_hash,
                )
                log(
                    "ROUTER/stock-availability",
                    f"SendQueryResponse ok request_id={request_id} ReturnCode={rc} firestore={ack_status}",
                )
                _stock_availability_signal(app, erp_shop_id, request_id, ack_status)
                return
            except Exception as e:
                if _is_transport_error(e):
                    failures += 1
                    log(
                        "ROUTER/stock-availability",
                        f"SendQueryResponse transport error request_id={request_id} failures={failures}: {e}",
                    )
                    if failures >= _MAX_ACK_ATTEMPTS:
                        log_error(
                            "ROUTER/stock-availability",
                            f"SendQueryResponse gave up after {failures} transport failures request_id={request_id}",
                        )
                        return
                    await asyncio.sleep(_backoff_seconds(failures))
                    continue
                log(
                    "ROUTER/stock-availability",
                    f"SendQueryResponse non-transport (treating as acked) request_id={request_id}: {e}",
                )
                _stock_availability_signal(app, erp_shop_id, request_id, ack_status)
                return
    except Exception as e:
        log_error(
            "ROUTER/stock-availability",
            f"_ack_tafnit_with_retry outer failure request_id={request_id}: {e}",
        )


@router.get(
    "/requests",
    summary="List stock-availability requests for authenticated shop",
    description=(
        "Returns current stock-availability rows scoped to the mechanic's shop. "
        "Only live/accepted rows are returned for initial UI hydration."
    ),
)
async def list_stock_availability_requests(
    request: Request,
    shop: dict = Depends(get_current_shop),
):
    db = request.app.state.db
    erp_shop_id = shop.get("erp_shop_id")
    if not erp_shop_id:
        log(
            "ROUTER/stock-availability",
            "WARNING: list requests skipped — JWT has no erp_shop_id (legacy token); returning empty",
        )
        return {"requests": []}

    log("ROUTER/stock-availability", f"list requests erp_shop_id={erp_shop_id}")

    rows = await db.fetch(
        """
        SELECT request_id, tire_size, quantity, status, closed_reason
        FROM stock_availability_requests
        WHERE shop_id = $1 AND status IN ('live', 'accepted')
        ORDER BY created_at DESC
        """,
        erp_shop_id,
    )

    requests = [
        {
            "request_id": row["request_id"],
            "tire_size": row["tire_size"],
            "quantity": int(row["quantity"]),
            "status": row["status"],
            "closed_reason": row["closed_reason"],
        }
        for row in rows
    ]
    log(
        "ROUTER/stock-availability",
        f"list requests returning={len(requests)} erp_shop_id={erp_shop_id}",
    )
    return {"requests": requests}


def _require_erp_shop(shop: dict) -> str:
    erp_shop_id = shop.get("erp_shop_id")
    if not erp_shop_id or not str(erp_shop_id).strip():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token missing erp_shop_id",
        )
    return str(erp_shop_id).strip()


def _parse_apply_id(request_id: str) -> int:
    try:
        return int(request_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid request_id",
        )


@router.post(
    "/requests/{request_id}/approve",
    summary="Approve a live stock-availability request",
)
async def approve_stock_availability_request(
    request: Request,
    request_id: str,
    shop: dict = Depends(get_current_shop),
):
    erp_shop_id = _require_erp_shop(shop)
    apply_id = _parse_apply_id(request_id)
    try:
        tire_shop_code = int(erp_shop_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid erp_shop_id",
        )

    db = request.app.state.db
    row = await db.fetchrow(
        """
        UPDATE stock_availability_requests
        SET status = 'accepted'
        WHERE request_id = $1 AND shop_id = $2 AND status = 'live'
        RETURNING request_id
        """,
        request_id,
        erp_shop_id,
    )
    if not row:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Request not live",
        )

    _stock_availability_signal(request.app, erp_shop_id, request_id, "accepted")

    asyncio.create_task(
        _ack_tafnit_with_retry(
            request.app,
            shop_id=shop["shop_id"],
            erp_hash=shop["erp_hash"],
            erp_shop_id=erp_shop_id,
            request_id=request_id,
            apply_id=apply_id,
            tire_shop_code=tire_shop_code,
            tafnit_response=1,
            ack_status="accepted_acked",
        )
    )

    log("ROUTER/stock-availability", f"approve request_id={request_id} erp_shop_id={erp_shop_id}")
    return {"status": "accepted"}


@router.post(
    "/requests/{request_id}/decline",
    summary="Decline a live stock-availability request",
)
async def decline_stock_availability_request(
    request: Request,
    request_id: str,
    shop: dict = Depends(get_current_shop),
):
    erp_shop_id = _require_erp_shop(shop)
    apply_id = _parse_apply_id(request_id)
    try:
        tire_shop_code = int(erp_shop_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid erp_shop_id",
        )

    db = request.app.state.db
    row = await db.fetchrow(
        """
        UPDATE stock_availability_requests
        SET status = 'declined'
        WHERE request_id = $1 AND shop_id = $2 AND status = 'live'
        RETURNING request_id
        """,
        request_id,
        erp_shop_id,
    )
    if not row:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Request not live",
        )

    _stock_availability_signal(request.app, erp_shop_id, request_id, "declined")

    asyncio.create_task(
        _ack_tafnit_with_retry(
            request.app,
            shop_id=shop["shop_id"],
            erp_hash=shop["erp_hash"],
            erp_shop_id=erp_shop_id,
            request_id=request_id,
            apply_id=apply_id,
            tire_shop_code=tire_shop_code,
            tafnit_response=2,
            ack_status="declined_acked",
        )
    )

    log("ROUTER/stock-availability", f"decline request_id={request_id} erp_shop_id={erp_shop_id}")
    return {"status": "declined"}
