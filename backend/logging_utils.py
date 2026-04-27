"""
Structured logging helper used by every backend module.

Format (info):
    [YYYY-MM-DD HH:MM:SS] [CATEGORY/subcategory] message

Format (error — pops out when tailing logs under load):
    [YYYY-MM-DD HH:MM:SS] [ERROR] [CATEGORY/subcategory] message

Examples:
    [2024-01-15 14:23:07] [ROUTER/carool] Opening session for order_id=abc123
    [2024-01-15 14:23:07] [ADAPTER/carool] POST https://carool-api/.../ai-diagnoses -> 200
    [2024-01-15 14:23:08] [DB] Inserting diagnosis row for order_id=abc123
    [2024-01-15 14:23:08] [ERROR] [ADAPTER/carool] Upload failed: 401 Unauthorized

Timestamps are always in UTC so they line up across the Dev VM, Cloud Run,
and a developer laptop. All output goes to stdout (flush=True) so Cloud Run /
Docker pick it up immediately. Keep this module dependency-free so it can
be imported from anywhere in the backend, including config.py at startup.
"""

from datetime import datetime, timezone


def _ts() -> str:
    """Return a UTC timestamp formatted as ``YYYY-MM-DD HH:MM:SS``."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def log(category: str, message: str) -> None:
    """Print one structured info line: ``[TIMESTAMP] [CATEGORY] message``."""
    print(f"[{_ts()}] [{category}] {message}", flush=True)


def log_error(category: str, message: str) -> None:
    """
    Print one structured error line: ``[TIMESTAMP] [ERROR] [CATEGORY] message``.

    The leading ``[ERROR]`` token makes failures jump out visually when
    tailing/grepping logs under load instead of blending in with the
    surrounding info-level traffic.
    """
    print(f"[{_ts()}] [ERROR] [{category}] {message}", flush=True)
