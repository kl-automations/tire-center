"""
Internal routes called by GCP Cloud Scheduler, not the frontend.
Protected by OIDC token (Cloud Scheduler attaches it automatically).
"""

from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Request

router = APIRouter(prefix="/internal", tags=["internal"])


@router.post("/cleanup")
async def cleanup_declined(request: Request):
    """
    Delete declined orders from yesterday (before 16:00 local time).
    Cloud Scheduler fires this once a day.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=1)

    db = request.app.state.db
    result = await db.execute(
        "DELETE FROM open_orders WHERE status = 'declined' AND declined_at < $1",
        cutoff,
    )
    # result is a string like "DELETE 3"
    deleted = int(result.split()[-1]) if result else 0
    return {"deleted": deleted}
