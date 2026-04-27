"""
Public runtime-config endpoint.

Exposes a small, non-secret subset of backend configuration to the frontend
so it can adapt its UI to feature flags decided at deploy time. Currently
only reports whether the Carool integration is enabled, which lets the
mechanic PWA hide the photo-flow entry points when Carool is turned off.

No authentication is required — values returned here must never be
sensitive. If a future flag needs to be private, expose it through an
authenticated endpoint instead.
"""

from fastapi import APIRouter

import config
from logging_utils import log

router = APIRouter(prefix="/api/config", tags=["config"])


@router.get(
    "",
    summary="Public runtime feature flags",
    description=(
        "Returns the subset of backend configuration the frontend needs to "
        "render the correct UI. Currently a single flag, `carool_enabled`, "
        "controlled by the optional `CAROOL_ENABLED` GCP secret (any value "
        "other than `\"0\"` — including a missing secret — leaves Carool on)."
    ),
    response_description="Feature flags consumed by the frontend on app load.",
)
async def get_public_config():
    """Return non-secret feature flags read directly from `config`."""
    log("ROUTER/config", f"GET /api/config -> carool_enabled={config.CAROOL_ENABLED}")
    return {"carool_enabled": config.CAROOL_ENABLED}
