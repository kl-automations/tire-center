# Backend Structure Plan — Tire Center

> **Owner:** Mel (developer)
> **Created:** 2026-04-16
> **Purpose:** Full backend structure plan incorporating ERP (SOAP), Carool (REST), GCP infrastructure, and Firestore realtime. Use this as the starting point when the ERP team finishes their endpoints.
> **Backend code:** `backend/`
> **Infrastructure:** GCP — see `backend-manual.md` for provisioning steps

---

## Architecture Overview

```
Browser (React)
    │
    ▼
FastAPI (GCP VM → Cloud Run in prod)
    ├── JWT middleware (all routes except /auth/*)
    ├── ERP adapter (SOAP via zeep)        ← stubs until ERP team is ready
    ├── Carool adapter (REST via httpx)    ← live now
    ├── Cloud SQL / PostgreSQL (asyncpg)
    └── Firebase Admin SDK (Firestore signals)
```

**Key principle:** The ERP adapter is one isolated file (`backend/adapters/erp.py`). When the ERP team finalises field names and method signatures, only that file changes — routes, DB logic, and JWT stay untouched.

---

## Request Flow (The 3 Waves)

### Wave 0 — Auth
```
Frontend          Backend              ERP (SOAP)
   │                  │                    │
   ├─ POST /auth/send-code ──────────────► IsValidUser(email)
   │                  │◄─ "send SMS" ack ──┤
   │                  │                    │
   ├─ POST /auth/verify ────────────────► VerifyCode(email, code)
   │                  │◄─ approved/denied ─┤
   │◄─ { token, erp_hash, shop_id } ───────┤
```

JWT payload: `{ shop_id, erp_hash, exp }`
`erp_hash` is stored by the client in `localStorage` and sent as `X-ERP-Hash` on every subsequent request.

---

### Wave 1 — Car Lookup (open a new order)
```
Frontend          Backend              ERP (SOAP)
   │                  │                    │
   ├─ POST /api/car ──────────────────► GetCarData(plate, mileage, shop_id, erp_hash)
   │                  │◄─ car data ────────┤
   │                  ├─ INSERT open_orders row (status='open')
   │◄─ { recognized, request_id, tire_sizes, quality, wheel_count, ... }
```

`request_id` is the ERP's identifier for this service visit. It is stored in `open_orders` and must be included in Wave 2.

---

### Wave 1.5 — Carool Photo Session (runs during AcceptedRequest)
```
Frontend          Backend              Carool (REST)
   │                  │                    │
   [first photo tap]  │                    │
   ├─ POST /api/carool/session ─────────► POST /ai-diagnoses
   │◄─ { carool_id } ◄──────────────────┤
   │                  ├─ UPDATE open_orders SET carool_diagnosis_id
   │                  │                    │
   [per wheel, ×N (max 4 wheels, 2 photos each)]
   ├─ POST /api/carool/photo ──────────► POST /ai-diagnoses/{id}/sidewall-picture
   ├─ POST /api/carool/photo ──────────► POST /ai-diagnoses/{id}/tread-picture
   │                  │                    │
   [after last wheel] │                    │
   ├─ POST /api/carool/finalize ────────► POST /ai-diagnoses/{id}/uploaded
   │                  │                    │
   [async — Carool fires webhook]          │
   POST /api/webhook/carool ◄─────────────┤
        ├─ UPDATE open_orders.diagnosis JSONB (Carool results per wheel)
        └─ Write Firestore signal → frontend picks up results live
```

---

### Wave 2 — Diagnosis Submission
```
Frontend          Backend              ERP (SOAP)
   │                  │                    │
   ├─ POST /api/diagnosis ─────────────► SubmitDiagnosis(request_id, wheels, alignment, carool_id, ...)
   │                  │◄─ ack ────────────┤
   │                  ├─ UPDATE open_orders SET status='waiting'
   │◄─ { ack: true }
```

After this, the order sits in `waiting` until the ERP fires its webhook.

---

### ERP Webhook (async, post Wave 2)
```
ERP               Backend              Firestore
   │                  │                    │
   ├─ POST /api/webhook/erp ─────────────┤
   │    X-ERP-Hash: <hash>               │
   │                  ├─ Validate hash    │
   │                  ├─ UPDATE open_orders (status, per-wheel approvals, declined_at)
   │                  └─ Write orders/{shop_id}/updates/{order_id} ──────────────► triggers onSnapshot in browser
```

---

## API Routes

### Auth

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/api/auth/send-code` | None | Send email to ERP → ERP sends SMS to mechanic |
| POST | `/api/auth/verify` | None | Verify SMS code with ERP → return signed JWT |

**`POST /api/auth/send-code`**
```json
// Request
{ "email": "mechanic@hertz-tlv.co.il" }

// Response 200
{ "sent": true }

// Response 401
{ "sent": false }
```

**`POST /api/auth/verify`**
```json
// Request
{ "email": "mechanic@hertz-tlv.co.il", "code": "482910" }

// Response 200
{ "token": "<jwt>", "erp_hash": "a3f9c2...", "shop_id": "hertz-tlv-01" }

// Response 401
{ "error": "invalid_code" }
```

---

### Orders

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/api/orders` | JWT | List all open orders for this shop |
| GET | `/api/orders/{order_id}` | JWT | Single order detail |

**`GET /api/orders` response:**
```json
{
  "total": 3,
  "orders": [
    {
      "id": "uuid",
      "request_id": "req_a1b2c3",
      "license_plate": "12-345-67",
      "plate_type": "civilian",
      "mileage": 87450,
      "car_data": { ... },
      "diagnosis": { ... },
      "status": "waiting",
      "carool_diagnosis_id": "6756",
      "created_at": "2026-04-16T10:00:00Z",
      "updated_at": "2026-04-16T10:05:00Z"
    }
  ]
}
```

---

### Car Lookup (Wave 1)

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/api/car` | JWT + X-ERP-Hash | Lookup plate in ERP, open order in DB |

**Request:**
```json
{ "license_plate": "12-345-67", "mileage": 87450 }
```

**Response — recognized:**
```json
{
  "recognized": true,
  "order_id": "uuid",
  "request_id": "req_a1b2c3d4",
  "ownership_id": "HERTZ",
  "tire_level": "premium",
  "wheel_count": 4,
  "tire_sizes": {
    "front": { "size": "205/55R16", "profile": "summer" },
    "rear":  { "size": "205/55R16", "profile": "summer" }
  },
  "carool_needed": true,
  "last_mileage": 84200
}
```

**Response — not recognized:**
```json
{ "recognized": false, "order_id": "uuid" }
```
> Even when not recognized, an order is created in the DB so the mechanic can still submit a manual diagnosis.

---

### Carool (Wave 1.5)

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/api/carool/session` | JWT | Open Carool diagnosis session, store ID in order |
| POST | `/api/carool/photo` | JWT | Proxy sidewall or tread photo upload to Carool |
| POST | `/api/carool/finalize` | JWT | Signal Carool that all photos are uploaded |

**`POST /api/carool/session` request:**
```json
{ "order_id": "uuid" }
```
Backend reads `license_plate` and `mileage` from the order row, creates Carool session, stores `carool_diagnosis_id`.

**`POST /api/carool/photo` request:** `multipart/form-data`
```
order_id:    uuid
wheel:       FRONT_LEFT | FRONT_RIGHT | REAR_LEFT | REAR_RIGHT
photo_type:  sidewall | tread
file:        <image blob>
```
Backend forwards to `POST /ai-diagnoses/{carool_id}/sidewall-picture` or `.../tread-picture`.

**`POST /api/carool/finalize` request:**
```json
{ "order_id": "uuid" }
```

---

### Diagnosis Submission (Wave 2)

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/api/diagnosis` | JWT + X-ERP-Hash | Submit full diagnosis to ERP, set order status to waiting |

**Request:**
```json
{
  "order_id": "uuid",
  "mileage_update": 87450,
  "front_alignment": true,
  "tires": {
    "front-right": [
      { "action": "replacement", "reason": "wear", "carool_status": "available", "carool_id": "crl_009" },
      { "action": "balancing" }
    ],
    "front-left": [{ "action": "tpms-valve" }],
    "rear-right": [{ "action": "sensor" }],
    "rear-left":  [{ "action": "transfer", "transfer_target": "rear-right" }]
  }
}
```

---

### History Export

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/api/history` | JWT + X-ERP-Hash | Ask ERP to email a history report |

```json
// Request
{ "date_from": "2025-01-01", "date_to": "2025-03-31", "email": "manager@hertz-tlv.co.il" }

// Response 200
{ "ack": true }
```

---

### Webhooks (inbound)

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/api/webhook/erp` | X-ERP-Hash | ERP fires order approval / rejection |
| POST | `/api/webhook/carool` | X-API-KEY | Carool fires AI analysis results |

**ERP webhook payload:**
```json
{
  "request_id": "req_a1b2c3d4",
  "status": "partly-approved",
  "front_alignment": "approved",
  "tires": {
    "front-right": { "replacement": "approved", "balancing": "approved" },
    "front-left":  { "tpms-valve": "approved" },
    "rear-right":  { "sensor": "declined" },
    "rear-left":   { "transfer": "approved" }
  }
}
```

**Carool webhook payload** (from `webhook.json`):
```json
{
  "dateAnalysis": "2026-04-16",
  "externalId": "order-uuid",
  "vehicle": { "license": "12-222-34", "licenseCountry": "IL", "vin": "..." },
  "prediction": {
    "sidewalls": [
      {
        "position": "FRONT_LEFT",
        "brand": "Michelin",
        "pattern": "Primacy 4",
        "season": "SUMMER",
        "dimension": { "width": 205, "ratio": 55, "diameter": 16, "loadIndex": 91, "speedIndex": "V" },
        "dot": { "date": 1221 }
      }
    ],
    "treads": [
      { "position": "FRONT_LEFT", "wearPercent": 20.7, "confidence": 12 }
    ]
  },
  "recommendations": [
    { "axle": "FRONT", "dimension": { "width": 205, "ratio": 55, "diameter": 16, "loadIndex": 91, "speedIndex": "V" } },
    { "axle": "REAR",  "dimension": { "width": 205, "ratio": 55, "diameter": 16, "loadIndex": 91, "speedIndex": "V" } }
  ]
}
```

---

### Internal

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/health` | None | Health check — returns `{ "status": "ok" }` |
| POST | `/internal/cleanup` | OIDC token (Cloud Scheduler) | Delete declined orders from yesterday before 16:00 |

---

## Database Schema

```sql
CREATE TABLE open_orders (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id              text        NOT NULL,
  license_plate        text        NOT NULL,
  plate_type           text        NOT NULL,
  mileage              integer,
  car_data             jsonb,        -- ERP Wave 1 response stored here
  diagnosis            jsonb,        -- mechanic selections + Carool results per wheel
  status               text        NOT NULL DEFAULT 'open',
  request_id           text,         -- ERP's identifier, set after Wave 1
  carool_diagnosis_id  text,         -- Carool session ID, set on first photo
  erp_hash             text        NOT NULL,
  declined_at          timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- status values: 'open' | 'waiting' | 'approved' | 'partly-approved' | 'declined'
-- 'open'    = order created, diagnosis not yet submitted to ERP
-- 'waiting' = diagnosis submitted, awaiting ERP webhook
-- others    = set by ERP webhook

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON open_orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_open_orders_shop_id     ON open_orders (shop_id);
CREATE INDEX idx_open_orders_status      ON open_orders (status);
CREATE INDEX idx_open_orders_request_id  ON open_orders (request_id) WHERE request_id IS NOT NULL;
CREATE INDEX idx_open_orders_declined_at ON open_orders (declined_at) WHERE declined_at IS NOT NULL;
```

### `diagnosis` JSONB structure (per order, after all data collected)
```json
{
  "front_alignment": true,
  "wheels": {
    "front-left": {
      "actions": [
        { "action": "replacement", "reason": "wear", "carool_status": "available", "carool_id": "crl_009" },
        { "action": "balancing" }
      ],
      "carool": {
        "brand": "Michelin",
        "pattern": "Primacy 4",
        "season": "SUMMER",
        "dimension": "205/55R16 91V",
        "dot": "1221",
        "wear_percent": 20.7,
        "wear_confidence": 12
      },
      "approval": null
    }
  },
  "erp_response": { }
}
```

---

## Project File Structure

```
backend/
├── main.py                  # FastAPI app, lifespan (DB pool init), route registration
├── Dockerfile
├── requirements.txt
├── db/
│   └── schema.sql           # Full schema — run once on first deploy
├── routers/
│   ├── auth.py              # /api/auth/*
│   ├── orders.py            # /api/orders/*
│   ├── car.py               # /api/car
│   ├── carool.py            # /api/carool/*
│   ├── diagnosis.py         # /api/diagnosis
│   ├── history.py           # /api/history
│   ├── webhooks.py          # /api/webhook/*
│   └── internal.py          # /internal/*
├── adapters/
│   ├── erp.py               # ALL ERP SOAP calls (zeep) — only file that changes when ERP is ready
│   └── carool.py            # Carool REST calls (httpx)
├── middleware/
│   └── auth.py              # get_current_shop() FastAPI dependency — decode JWT, extract shop_id + erp_hash
└── models/
    └── schemas.py           # Pydantic request/response models
```

---

## Secrets (already in GCP Secret Manager)

| Secret name | Used by |
|---|---|
| `JWT_SECRET` | Signing / verifying JWTs |
| `DB_PASSWORD` | Cloud SQL connection |
| `CAROOL_API_KEY` | `X-API-KEY` header on all Carool calls |
| `CAROOL_PAGE_ORIGIN` | `X-Page-origin` header on all Carool calls |
| `FIREBASE_SERVICE_ACCOUNT` | Firebase Admin SDK (Firestore signals) |
| `WEBHOOK_SECRET` | *(reserved — ERP webhook auth method TBD with ERP team)* |

---

## ERP Adapter — Stub Contract

Until the ERP team delivers their endpoints, `adapters/erp.py` returns hardcoded stubs that match the expected response shapes. Every function has a `# TODO: replace stub` comment with the known SOAP method name (or `# SOAP method TBD` where unknown).

```python
# adapters/erp.py

async def send_auth_code(email: str) -> bool:
    # TODO: replace stub — SOAP method TBD (IsValidUser variant?)
    return True

async def verify_auth_code(email: str, code: str) -> dict | None:
    # TODO: replace stub — SOAP method TBD
    # Returns { shop_id, erp_hash } on success, None on failure
    if code == "000000":
        return None
    return { "shop_id": "hertz-tlv-01", "erp_hash": "stub-hash-abc123" }

async def lookup_car(license_plate: str, mileage: int, shop_id: str, erp_hash: str) -> dict:
    # TODO: replace stub — SOAP method TBD
    return {
        "recognized": True,
        "request_id": f"req_stub_{license_plate}",
        "ownership_id": "HERTZ",
        "tire_level": "premium",
        "wheel_count": 4,
        "tire_sizes": {
            "front": { "size": "205/55R16", "profile": "summer" },
            "rear":  { "size": "205/55R16", "profile": "summer" }
        },
        "carool_needed": True,
        "last_mileage": mileage - 3000
    }

async def submit_diagnosis(request_id: str, payload: dict, erp_hash: str) -> bool:
    # TODO: replace stub — SOAP method TBD
    return True

async def request_history_export(shop_id: str, date_from: str, date_to: str, email: str, erp_hash: str) -> bool:
    # TODO: replace stub — SOAP method TBD
    return True
```

---

## Firestore Realtime Signal

After every status-changing event (ERP webhook, Carool webhook), the backend writes:

```
orders/{shop_id}/updates/{order_id}  =  { status, updated_at }
```

The frontend's `onSnapshot` listener on `orders/{shop_id}/updates` triggers a re-fetch of the affected order. No polling required.

---

## Build Order

| # | What | Unblocks |
|---|------|---------|
| 1 | Scaffold `main.py`, `Dockerfile`, `requirements.txt` | Everything |
| 2 | DB schema (`schema.sql`) + Cloud SQL connection pool | All DB reads/writes |
| 3 | JWT middleware (`middleware/auth.py`) | All protected routes |
| 4 | ERP adapter stubs (`adapters/erp.py`) | Auth + Wave 1 + Wave 2 routes |
| 5 | Auth routes (`routers/auth.py`) | Frontend login |
| 6 | Car lookup route (`routers/car.py`) | Frontend Wave 1 |
| 7 | Carool adapter + routes (`adapters/carool.py`, `routers/carool.py`) | Camera UI |
| 8 | Diagnosis route (`routers/diagnosis.py`) | Frontend Wave 2 |
| 9 | Webhook handlers (`routers/webhooks.py`) + Firestore signals | Live order updates |
| 10 | Orders list/detail routes (`routers/orders.py`) | Open requests page |
| 11 | History + cleanup routes | History export, nightly cleanup |

---

## Open Questions for ERP Team

| # | Question | Blocks |
|---|----------|--------|
| Q1 | SOAP method names for auth (send code + verify code) | Step 4–5 above |
| Q2 | SOAP method name + exact field names for car lookup | Step 6 |
| Q3 | SOAP method name + exact field names for diagnosis submission | Step 8 |
| Q4 | Webhook auth mechanism — does ERP send `X-ERP-Hash`? A shared secret? Both? | Step 9 |
| Q5 | Does car lookup response include `carool_needed` field? | Carool session trigger logic |
| Q6 | Does car lookup response include `shop_id` or is it always read from JWT? | Step 6 |
| Q7 | ERP base URL for production vs dev | All ERP adapter calls |
| Q8 | Does ERP retry webhook calls on non-200? How many times, what backoff? | Step 9 reliability |
