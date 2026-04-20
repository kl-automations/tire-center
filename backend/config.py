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

Optional secrets (CAROOL_*, FIREBASE_SERVICE_ACCOUNT):
  Loaded with a warning if absent so the app can start while those integrations
  are still being configured.
"""

import os
from google.cloud import secretmanager

_project_id = os.environ["GCP_PROJECT_ID"]
_sm = secretmanager.SecretManagerServiceClient()


def _require(name: str) -> str:
    """Fetch a secret that must exist. Raises on failure."""
    path = f"projects/{_project_id}/secrets/{name}/versions/latest"
    response = _sm.access_secret_version(name=path)
    return response.payload.data.decode("utf-8").strip()


def _optional(name: str) -> str | None:
    """Fetch a secret that may not exist yet. Returns None and logs a warning."""
    try:
        return _require(name)
    except Exception as e:
        print(f"[config] WARNING: optional secret '{name}' not found — {e}")
        return None


# ── Required secrets — app will not start if any of these are missing ─────────

JWT_SECRET = _require("JWT_SECRET")

DB_HOST     = _require("DB_HOST")      # IP on Dev VM; Unix socket path on Cloud Run
DB_NAME     = _require("DB_NAME")
DB_USER     = _require("DB_USER")
DB_PASSWORD = _require("DB_PASSWORD")

# ── Optional secrets — missing values disable the relevant integration ─────────

CAROOL_API_KEY      = _optional("CAROOL_API_KEY")
CAROOL_PAGE_ORIGIN  = _optional("CAROOL_PAGE_ORIGIN")
FIREBASE_SERVICE_ACCOUNT = _optional("FIREBASE_SERVICE_ACCOUNT")  # JSON string
