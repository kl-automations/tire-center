"""
Internal routes called by GCP Cloud Scheduler, not the frontend.

These endpoints must never be exposed to the public internet. In production
they are protected by Cloud Scheduler's OIDC token (attached automatically).

TODO: add OIDC token verification middleware before deploying to production.
      See backend-plan.md task B13 for requirements.
"""

from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Request

from logging_utils import log

router = APIRouter(prefix="/internal", tags=["internal"])


@router.post(
    "/cleanup",
    summary="Delete yesterday's declined orders (Cloud Scheduler only)",
    description=(
        "Deletes rows from **open_orders** where `status = 'declined'` and the order "
        "was declined more than 24 hours ago. "
        "Intended to be called once daily by GCP Cloud Scheduler. "
        "**This endpoint has no authentication in the current implementation** — "
        "OIDC token verification must be added before go-live (see backend-plan.md B13)."
    ),
    response_description="Count of rows deleted.",
    include_in_schema=False,  # hide from public Swagger UI / Mintlify
)
async def cleanup_declined(request: Request):
    """
    Delete declined orders older than 24 hours.

    Uses a 24-hour rolling cutoff rather than a fixed calendar-day boundary
    to avoid timezone edge cases. Cloud Scheduler fires this once a day.

    Returns:
        { "deleted": int } — the number of rows removed from open_orders.

    Security note:
        No auth is enforced here yet. Before deploying to production, verify
        the incoming OIDC token issued by Cloud Scheduler against the expected
        service account (see backend-plan.md task B13).
    """
    log("ROUTER/internal", "cleanup invoked (Cloud Scheduler)")
    cutoff = datetime.now(timezone.utc) - timedelta(days=1)

    db = request.app.state.db
    log("DB", f"DELETE open_orders WHERE status='declined' AND declined_at<{cutoff.isoformat()}")
    declined_result = await db.execute(
        "DELETE FROM open_orders WHERE status = 'declined' AND declined_at < $1",
        cutoff,
    )
    declined_deleted = int(declined_result.split()[-1]) if declined_result else 0

    log("DB", "DELETE stock_availability_requests WHERE status='accepted' AND updated_at < now()-24h")
    stock_result = await db.execute(
        """
        DELETE FROM stock_availability_requests
        WHERE status = 'accepted' AND updated_at < now() - INTERVAL '24 hours'
        """
    )
    stock_deleted = int(stock_result.split()[-1]) if stock_result else 0

    log(
        "ROUTER/internal",
        f"cleanup deleted_declined={declined_deleted} deleted_stock_availability={stock_deleted}",
    )
    return {
        "deleted": declined_deleted,
        "deleted_stock_availability": stock_deleted,
    }
