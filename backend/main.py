"""
Tire Center — FastAPI backend entry point.

All secrets are loaded from GCP Secret Manager via config.py at import time.
The app uses a lifespan context manager to create and tear down the asyncpg
connection pool and Firebase Admin SDK on startup/shutdown.

Local dev:  uvicorn main:app --reload --port 8000
Production: Docker → uvicorn on $PORT (default 8080) → Cloud Run
"""

import json
import os
from contextlib import asynccontextmanager

import asyncpg
import firebase_admin
from firebase_admin import credentials, firestore
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

import config
from routers import auth, car, carool, config_router, diagnosis, history, internal, orders, webhooks


# ── DB connection ─────────────────────────────────────────────────────────────

async def _create_db_pool() -> asyncpg.Pool:
    """
    Create and return an asyncpg connection pool.

    The connection target is determined solely by the DB_HOST secret value:
      - Dev VM:    an IP address → asyncpg opens a direct TCP connection on port 5432.
      - Cloud Run: a Unix socket path → asyncpg uses the Cloud SQL proxy socket.
    No code change is needed when switching environments; only the secret
    value in GCP Secret Manager changes.
    """
    return await asyncpg.create_pool(
        host=config.DB_HOST,
        database=config.DB_NAME,
        user=config.DB_USER,
        password=config.DB_PASSWORD,
        min_size=2,
        max_size=10,
    )


# ── Firebase init ─────────────────────────────────────────────────────────────

def _init_firebase():
    """
    Initialise the Firebase Admin SDK if it has not already been initialised.

    If FIREBASE_SERVICE_ACCOUNT is set (JSON string or file path) it is used
    directly. Otherwise the SDK falls back to Application Default Credentials
    (ADC), which works automatically on GCP VMs and Cloud Run without any
    extra configuration.
    """
    if firebase_admin._apps:
        return
    sa_json = config.FIREBASE_SERVICE_ACCOUNT
    if sa_json:
        sa_dict = json.loads(sa_json) if sa_json.strip().startswith("{") else None
        cred = credentials.Certificate(sa_dict) if sa_dict else credentials.Certificate(sa_json)
    else:
        # Fall back to ADC when the secret is not configured (e.g. local dev without Firebase)
        cred = credentials.ApplicationDefault()
    firebase_admin.initialize_app(cred)


# ── Lifespan ──────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    FastAPI lifespan context manager — runs startup and shutdown logic.

    Startup:
      1. config.py has already loaded all secrets from GCP Secret Manager at
         import time, so they are available here without an extra async call.
      2. Creates the asyncpg connection pool and attaches it to app.state.db.
      3. Initialises Firebase Admin SDK and attaches the Firestore client to
         app.state.firestore.

    Shutdown:
      - Closes all connections in the asyncpg pool gracefully.
    """
    # config.py has already loaded all secrets at import time
    app.state.db = await _create_db_pool()

    _init_firebase()
    app.state.firestore = firestore.client()

    yield

    await app.state.db.close()


# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="Tire Center API",
    description=(
        "Backend API for the Tire Center mechanic PWA. "
        "Handles authentication (ERP OTP flow), vehicle lookup, tyre-service diagnosis "
        "submission, Carool AI photo analysis, and order management. "
        "All protected endpoints require **Authorization: Bearer \\<JWT\\>**."
    ),
    version="1.0.0",
    lifespan=lifespan,
)

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
app.include_router(config_router.router)
app.include_router(diagnosis.router)
app.include_router(history.router)
app.include_router(orders.router)
app.include_router(webhooks.router)
app.include_router(internal.router)


@app.get(
    "/health",
    summary="Health check",
    description="Returns `{\"status\": \"ok\"}`. Used by GCP load balancer health probes and CI smoke tests.",
    tags=["meta"],
)
async def health():
    """Lightweight liveness probe — no DB query, no external calls."""
    return {"status": "ok"}
