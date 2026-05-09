"""
Public runtime-config endpoint.

Exposes a small, non-secret subset of backend configuration to the frontend
so it can adapt its UI to feature flags decided at deploy time. Currently
only reports whether the Carool integration is enabled, which lets the
mechanic PWA hide the photo-flow entry points when Carool is turned off.

When FIREBASE_WEB_CONFIG is set, also returns a `firebase` object (apiKey,
authDomain, projectId, …) so the PWA can initialise the Firebase JS SDK for
Firestore listeners. These values are public in any Firebase web app.

No authentication is required — values returned here must never be
sensitive. If a future flag needs to be private, expose it through an
authenticated endpoint instead.
"""

import json

from fastapi import APIRouter

import config
from logging_utils import log

router = APIRouter(prefix="/api/config", tags=["config"])


@router.get(
    "",
    summary="Public runtime feature flags",
    description=(
        "Returns the subset of backend configuration the frontend needs to "
        "render the correct UI: `carool_enabled` (CAROOL_ENABLED secret) and "
        "optionally `firebase` (FIREBASE_WEB_CONFIG JSON) for Firestore listeners."
    ),
    response_description="Feature flags consumed by the frontend on app load.",
)
async def get_public_config():
    """Return non-secret feature flags read directly from `config`."""
    log("ROUTER/config", f"GET /api/config -> carool_enabled={config.CAROOL_ENABLED}")
    out: dict = {"carool_enabled": config.CAROOL_ENABLED}
    raw = config.FIREBASE_WEB_CONFIG
    if raw:
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                out["firebase"] = parsed
        except json.JSONDecodeError:
            log("ROUTER/config", "WARNING: FIREBASE_WEB_CONFIG is not valid JSON — omitting firebase block")
    return out
