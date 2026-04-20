"""
Tire Center — FastAPI backend
Dev VM / Cloud Run: secrets come from GCP Secret Manager, DB via Cloud SQL connector.
Local dev only:     set CLOUD_SQL_CONNECTION_NAME + DB_* as env vars and run the
                    Cloud SQL Auth Proxy locally, or point at a local postgres.

Start: uvicorn main:app --reload --port 8000
Prod:  Docker → Cloud Run (Dockerfile)
"""

import json
import os
from contextlib import asynccontextmanager

import asyncpg
import firebase_admin
from firebase_admin import credentials, firestore
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from google.cloud import secretmanager

from routers import auth, car, carool, diagnosis, history, internal, orders, webhooks


# ── Secret Manager helper ────────────────────────────────────────────────────

def _load_secret(project_id: str, name: str) -> str:
    """Fetch the latest version of a secret from GCP Secret Manager."""
    client = secretmanager.SecretManagerServiceClient()
    secret_path = f"projects/{project_id}/secrets/{name}/versions/latest"
    response = client.access_secret_version(name=secret_path)
    return response.payload.data.decode("utf-8")


def _load_secrets_into_env():
    """
    Pull all required secrets from Secret Manager and set them as env vars
    so the rest of the app can read os.environ["SECRET_NAME"] uniformly.
    Skip any that are already set (allows local dev override via .env).
    """
    project_id = os.environ.get("GCP_PROJECT_ID")
    if not project_id:
        # Running fully locally with env vars — nothing to load.
        return

    secret_names = [
        "JWT_SECRET",
        "DB_PASSWORD",
        "CAROOL_API_KEY",
        "CAROOL_PAGE_ORIGIN",
        "FIREBASE_SERVICE_ACCOUNT",  # JSON string
    ]
    for name in secret_names:
        if os.environ.get(name):
            continue  # already set locally, don't overwrite
        try:
            os.environ[name] = _load_secret(project_id, name)
        except Exception as e:
            print(f"[secrets] WARNING: could not load {name}: {e}")


# ── DB connection via Cloud SQL Python Connector ─────────────────────────────

async def _create_db_pool() -> asyncpg.Pool:
    connection_name = os.environ.get("CLOUD_SQL_CONNECTION_NAME")

    if connection_name:
        # On GCP (VM or Cloud Run) — use the Cloud SQL connector (no exposed port needed)
        from google.cloud.sql.connector import Connector, IPTypes
        connector = Connector()

        async def _getconn(conn: str):
            return await connector.connect_async(
                conn,
                "asyncpg",
                user=os.environ["DB_USER"],
                password=os.environ["DB_PASSWORD"],
                db=os.environ["DB_NAME"],
                ip_type=IPTypes.PUBLIC,
            )

        pool = await asyncpg.create_pool(
            dsn=None,
            connect=lambda: _getconn(connection_name),
            min_size=2,
            max_size=10,
        )
    else:
        # Local dev — direct TCP to a local postgres
        pool = await asyncpg.create_pool(
            host=os.environ.get("DB_HOST", "localhost"),
            port=int(os.environ.get("DB_PORT", 5432)),
            database=os.environ["DB_NAME"],
            user=os.environ["DB_USER"],
            password=os.environ["DB_PASSWORD"],
            min_size=2,
            max_size=10,
        )

    return pool


# ── Firebase init ─────────────────────────────────────────────────────────────

def _init_firebase():
    if firebase_admin._apps:
        return
    sa_json = os.environ.get("FIREBASE_SERVICE_ACCOUNT")
    if sa_json:
        # Secret Manager gives us the JSON string; parse it into a dict
        sa_dict = json.loads(sa_json) if sa_json.strip().startswith("{") else None
        cred = credentials.Certificate(sa_dict) if sa_dict else credentials.Certificate(sa_json)
    else:
        # On GCP with ADC (Application Default Credentials) configured
        cred = credentials.ApplicationDefault()
    firebase_admin.initialize_app(cred)


# ── Lifespan ──────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    _load_secrets_into_env()

    app.state.db = await _create_db_pool()

    _init_firebase()
    app.state.firestore = firestore.client()

    yield

    await app.state.db.close()


# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(title="Tire Center API", lifespan=lifespan)

ALLOWED_ORIGINS = os.environ.get("ALLOWED_ORIGINS", "http://localhost:5173").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(car.router)
app.include_router(carool.router)
app.include_router(diagnosis.router)
app.include_router(history.router)
app.include_router(orders.router)
app.include_router(webhooks.router)
app.include_router(internal.router)


@app.get("/health")
async def health():
    return {"status": "ok"}
