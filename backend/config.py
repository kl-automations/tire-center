"""
Centralised configuration — all secrets loaded from GCP Secret Manager at startup.

The backend runs exclusively on GCP (Dev VM or Cloud Run).
No .env fallback exists by design: the ERP firewall whitelists only the VM's IP.

DB routing:
  Dev VM      — DB_HOST secret holds the Postgres IP; direct TCP connection.
  Cloud Run   — DB_HOST secret holds the Unix socket path
                (e.g. /cloudsql/project:region:instance); asyncpg uses it as host.
  Switching between the two requires no code changes — only update the secret value
  in the relevant GCP project.

Optional secrets (CAROOL_*, FIREBASE_SERVICE_ACCOUNT, FIREBASE_WEB_CONFIG):
  Loaded with a warning if absent so the app can start while those integrations
  are still being configured.
"""

import os
from google.cloud import secretmanager

from logging_utils import log, log_error

_project_id = os.environ["GCP_PROJECT_ID"]
log("CONFIG", f"Initialising Secret Manager client for project={_project_id}")
_sm = secretmanager.SecretManagerServiceClient()


def _require(name: str) -> str:
    """Fetch a secret that must exist. Raises on failure."""
    log("CONFIG", f"Loading required secret '{name}'")
    path = f"projects/{_project_id}/secrets/{name}/versions/latest"
    try:
        response = _sm.access_secret_version(name=path)
    except Exception as e:
        log_error("config", f"Failed to load required secret '{name}': {e}")
        raise
    log("CONFIG", f"Loaded required secret '{name}' (len={len(response.payload.data)})")
    return response.payload.data.decode("utf-8").strip()


def _optional(name: str) -> str | None:
    """Fetch a secret that may not exist yet. Returns None and logs a warning."""
    log("CONFIG", f"Loading optional secret '{name}'")
    try:
        value = _require(name)
        log("CONFIG", f"Optional secret '{name}' present")
        return value
    except Exception as e:
        log("CONFIG", f"WARNING: optional secret '{name}' not found — {e}")
        return None


# ── Required secrets — app will not start if any of these are missing ─────────

JWT_SECRET = _require("JWT_SECRET")

DB_HOST     = _require("DB_HOST")      # IP on Dev VM; Unix socket path on Cloud Run
DB_NAME     = _require("DB_NAME")
DB_USER     = _require("DB_USER")
DB_PASSWORD = _require("DB_PASSWORD")

CAROOL_BASE_URL = _require("CAROOL_BASE_URL")

# ── Optional secrets — missing values disable the relevant integration ─────────

CAROOL_API_KEY      = _optional("CAROOL_API_KEY")
CAROOL_PAGE_ORIGIN  = _optional("CAROOL_PAGE_ORIGIN")
FIREBASE_SERVICE_ACCOUNT = _optional("FIREBASE_SERVICE_ACCOUNT")  # JSON string
# Optional Firebase JS SDK config (JSON) for the mechanic PWA — apiKey, authDomain,
# projectId, appId, etc. Exposed via GET /api/config when present.
FIREBASE_WEB_CONFIG = _optional("FIREBASE_WEB_CONFIG")

# Master kill-switch for the Carool integration. Default is ON: any value other
# than "0" (including a missing secret) leaves Carool enabled. Set the
# CAROOL_ENABLED secret to exactly "0" to disable all Carool routes and hide
# the Carool UI in the frontend.
CAROOL_ENABLED = _optional("CAROOL_ENABLED") != "0"
log("CONFIG", f"CAROOL_ENABLED={CAROOL_ENABLED}")
log("CONFIG", "All secrets loaded successfully")
