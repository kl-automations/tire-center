"""
Tire Center — FastAPI backend
All secrets are loaded from GCP Secret Manager via config.py at startup.

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

import config
from routers import auth, car, carool, diagnosis, history, internal, orders, webhooks


# ── DB connection ─────────────────────────────────────────────────────────────

async def _create_db_pool() -> asyncpg.Pool:
    """
    Dev VM:    config.DB_HOST is the Postgres IP — direct TCP on port 5432.
    Cloud Run: config.DB_HOST is the Unix socket path — asyncpg accepts it as host.
    No code change needed when switching; only the secret value in GCP changes.
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
    if firebase_admin._apps:
        return
    sa_json = config.FIREBASE_SERVICE_ACCOUNT
    if sa_json:
        sa_dict = json.loads(sa_json) if sa_json.strip().startswith("{") else None
        cred = credentials.Certificate(sa_dict) if sa_dict else credentials.Certificate(sa_json)
    else:
        # Fall back to ADC when the secret isn't configured yet
        cred = credentials.ApplicationDefault()
    firebase_admin.initialize_app(cred)


# ── Lifespan ──────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    # config.py has already loaded all secrets at import time
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
