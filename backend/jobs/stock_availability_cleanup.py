"""
Nightly (03:00 UTC) cleanup for stock_availability_requests retention.

Accepted and declined rows older than 24 hours (by ``updated_at``) are deleted.
``live`` rows are never touched here. Scheduling is driven from FastAPI lifespan
(no Cloud Scheduler dependency for this sweep).
"""

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any

import asyncpg
from fastapi import FastAPI

from logging_utils import log, log_error


def _seconds_until_next_0300_utc() -> float:
    """Seconds from *now* (UTC wall clock) until the next 03:00:00 UTC instant."""
    now = datetime.now(timezone.utc)
    target = now.replace(hour=3, minute=0, second=0, microsecond=0)
    if now >= target:
        target += timedelta(days=1)
    return max(0.0, (target - now).total_seconds())


async def run_cleanup_once(db: asyncpg.Pool) -> dict[str, Any]:
    """
    Delete accepted/declined stock-availability rows past the 24h retention window.

    Returns:
        ``{"deleted": int, "by_status": {"accepted": n, "declined": m}}`` with
        per-status counts for deleted rows only.
    """
    rows = await db.fetch(
        """
        DELETE FROM stock_availability_requests
        WHERE status IN ('accepted', 'declined')
          AND updated_at < now() - INTERVAL '24 hours'
        RETURNING status
        """
    )
    by_status: dict[str, int] = {}
    for row in rows:
        st = row["status"]
        by_status[st] = by_status.get(st, 0) + 1
    return {"deleted": len(rows), "by_status": by_status}


async def cleanup_loop(app: FastAPI) -> None:
    """
    Sleep until the next 03:00 UTC, run ``run_cleanup_once``, repeat.

    Recomputes the sleep interval from *now* after each iteration so clock drift
    does not accumulate. Survives per-iteration failures; propagates cancellation.
    """
    started_logged = False
    try:
        while True:
            sleep_s = _seconds_until_next_0300_utc()
            if not started_logged:
                log(
                    "JOB/stock-availability-cleanup",
                    f"cleanup_loop started next_sleep_s={sleep_s:.1f}",
                )
                started_logged = True
            else:
                log(
                    "JOB/stock-availability-cleanup",
                    f"cleanup_loop scheduling next_sleep_s={sleep_s:.1f}",
                )
            await asyncio.sleep(sleep_s)
            try:
                summary = await run_cleanup_once(app.state.db)
                log(
                    "JOB/stock-availability-cleanup",
                    f"stock_availability_cleanup run deleted={summary['deleted']} by_status={summary['by_status']}",
                )
            except asyncio.CancelledError:
                raise
            except Exception as e:
                log_error("JOB/stock-availability-cleanup", f"cleanup iteration failed: {e}")
    except asyncio.CancelledError:
        log("JOB/stock-availability-cleanup", "cleanup_loop cancelled")
        raise
