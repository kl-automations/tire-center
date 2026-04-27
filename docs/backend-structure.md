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
    ├── ERP adapter (SOAP via zeep)        ← live (history export still stubbed)
    ├── Carool adapter (REST via httpx)    ← live
    ├── Cloud SQL / PostgreSQL (asyncpg)
    └── Firebase Admin SDK (Firestore signals)
```

**Key principle:** All ERP SOAP calls are isolated in `backend/adapters/erp.py`. Routes, DB logic, and JWT handling have no knowledge of ERP field names or method signatures, so when the ERP team revises a field or ships a new method (e.g. for the still-stubbed history export) only the adapter changes.

---

## Request Flow (The 3 Waves)

### Wave 0 — Auth
```
Frontend          Backend              ERP (SOAP)
   │                  │                    │
   ├─ POST /api/auth/request-code ───────► IsValidUser(userCode)
   │                  │◄─ "send SMS" ack ──┤
   │                  │                    │
   ├─ POST /api/auth/verify ─────────────► Login(userCode, otp)
   │                  │◄─ approved/denied ─┤
   │◄─ { token } ──────────────────────────┤
```

JWT payload: `{ shop_id, erp_hash, exp }` (signed HS256, 30-day TTL).
The client stores only the JWT and sends it as `Authorization: Bearer <jwt>`
on every subsequent request — `shop_id` and `erp_hash` are read from inside
the token by the backend, never sent as a separate header.

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
   ├─ POST /api/diagnosis ─────────────► SendDiagnose(ApplyId, CarNumber, Diagnosis{LastMileage, DiagnosisLines[]})
   │                  │◄─ ack ────────────┤
   │                  ├─ UPDATE open_orders SET status='waiting'
   │◄─ { ack: true }
```

After this, the order sits in `waiting` until the ERP fires its webhook.

**ERP action codes are reasons, not action types.** The ERP only accepts a
single numeric `ActionCode` per `DiagnosisLine`, and that code represents
*why* the tyre needs work — `wear` (3), `damage` (23), `fitment` (25),
`puncture` (4), or `front_alignment` (2). Frontend actions like `sensor`,
`balancing`, `rim_repair`, `relocation`, and `tpms-valve` have **no ERP
equivalent**: they are persisted in `open_orders.diagnosis` (JSONB) and
silently skipped when building the `DiagnosisLines` payload.

---

### ERP Webhook (async, post Wave 2)
```
ERP               Backend              Firestore
   │                  │                    │
   ├─ POST /api/webhook/erp ─────────────┤
   │                  ├─ Validate auth (mechanism TBD with ERP team)
   │                  ├─ UPDATE open_orders (status, per-wheel approvals, declined_at)
   │                  └─ Write orders/{shop_id}/updates/{order_id} ──────────────► triggers onSnapshot in browser
```

---

## API Routes

### Auth

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/api/auth/request-code` | None | Forward `userCode` to ERP `IsValidUser` → ERP sends OTP via SMS |
| POST | `/api/auth/verify` | None | Verify `userCode` + `otp` via ERP `Login` → return signed JWT |

**`POST /api/auth/request-code`**
```json
// Request
{ "userCode": "12345" }

// Response 200
{ "success": true, "otp_debug": null }

// Response 400
{ "detail": "erp_rejected_user" }
```
> `otp_debug` is only populated when `ERP_TEST_MODE=true` so automated tests can run without a real phone.

**`POST /api/auth/verify`**
```json
// Request
{ "userCode": "12345", "otp": "482910" }

// Response 200
{ "success": true, "token": "<jwt>" }

// Response 401
{ "detail": "invalid_otp" }
```
> The JWT carries `{ shop_id, erp_hash, exp }`. Clients send it as `Authorization: Bearer <jwt>` on every protected route.

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
| POST | `/api/car` | JWT | Lookup plate in ERP, open order in DB |

**Request:**
```json
{ "license_plate": "12-345-67", "mileage": 87450 }
```

**Response — recognized:**
```json
{
  "recognized": true,
  "order_id": "uuid",
  "request_id": "12345",
  "ownership_id": "HERTZ",
  "car_model": "TOYOTA COROLLA 2020",
  "last_mileage": 84200,
  "tire_sizes": {
    "front": "205/55R16",
    "rear":  "205/55R16"
  },
  "erp_message": "OK",
  "tire_level": null,
  "wheel_count": null,
  "carool_needed": null
}
```
> `tire_sizes.front` and `.rear` are flat strings exactly as the ERP returns them. `tire_level`, `wheel_count`, and `carool_needed` are reserved fields that the current ERP `Apply` response does not populate — they are returned as `null` until the ERP exposes them.

**Response — not recognized (ERP `ReturnCode != "1"`):**
The route returns HTTP `400` with `{ "detail": <ERP ReturnMessage> }`. No order is created in this case.

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
| POST | `/api/diagnosis` | JWT | Submit full diagnosis to ERP, set order status to waiting |

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
| POST | `/api/history` | JWT | Ask ERP to email a history report |

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
| POST | `/api/webhook/erp` | TBD | ERP fires order approval / rejection (auth mechanism still pending) |
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

-- ── ERP reference tables (admin-managed) ────────────────────────────────────
-- Map the frontend's diagnosis vocabulary onto the ERP's numeric codes.
-- Both tables are seeded with the live ERP codes; rows are intended to be
-- editable by an admin (no code change required to extend the mapping).

CREATE TABLE erp_action_codes (
  id               serial  PRIMARY KEY,
  erp_code         integer NOT NULL UNIQUE,
  description      text    NOT NULL,        -- Hebrew label as used in the ERP UI
  frontend_action  text,                    -- e.g. 'replacement', 'puncture', 'front_alignment'
  frontend_reason  text                     -- e.g. 'wear', 'damage', 'fitment' (null when not applicable)
);

-- Seed:
--   2  = front_alignment            (no reason)
--   3  = replacement / wear
--   4  = puncture                   (no reason)
--   23 = replacement / damage
--   25 = replacement / fitment

CREATE TABLE erp_tire_locations (
  id               serial  PRIMARY KEY,
  erp_code         integer NOT NULL UNIQUE,
  description      text    NOT NULL,        -- Hebrew label as used in the ERP UI
  wheel_position   text    NOT NULL         -- 'front-left' | 'front-right' | 'rear-left' | 'rear-right' | 'spare-tire' | 'no-location' | 'rear-left-inner' | 'rear-right-inner'
);

-- Seed:
--   1 = front-left          5 = spare-tire
--   2 = front-right         6 = no-location          (used for front_alignment)
--   3 = rear-right          7 = rear-left-inner
--   4 = rear-left           8 = rear-right-inner
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

## ERP Adapter — Status

All ERP SOAP calls live in `adapters/erp.py` (single point of change for ERP
integration). Status of each adapter function:

| Function | Status | SOAP method |
|----------|--------|-------------|
| `request_otp(user_code)` | LIVE | `IsValidUser` |
| `verify_login(user_code, otp)` | LIVE | `Login` |
| `lookup_car(license_plate, mileage, shop_id, erp_hash)` | LIVE | `Apply` |
| `submit_diagnosis(request_id, payload, shop_id, erp_hash)` | LIVE | `SendDiagnose` |
| `request_history_export(shop_id, date_from, date_to, email, erp_hash)` | **STUB** | TBD — adapter currently returns `True` without calling the ERP |

The auth flow uses the mechanic's `userCode` (not email) and an OTP delivered
via SMS. `shop_id` in the JWT is set to the `userCode`; `erp_hash` is the OTP
value, reused as the SOAP `password` argument on subsequent calls.

---

## Firestore Realtime Signal

After every status-changing event (ERP webhook, Carool webhook), the backend writes:

```
orders/{shop_id}/updates/{order_id}  =  { status, updated_at }
```

The frontend's `onSnapshot` listener on `orders/{shop_id}/updates` triggers a re-fetch of the affected order. No polling required.

---

## Build Order

All build-order steps are complete as of 2026-04-26. See `docs/backend-plan.md`
for the per-area status summary (what's live vs. still stubbed).

---

## Open Questions

| # | Question | Blocks |
|---|----------|--------|
| Q1 | ERP webhook auth mechanism — shared secret header? mTLS? IP allowlist? | `POST /api/webhook/erp` is wired up but currently has no auth check. |
| Q2 | Firebase / Firestore integration — `FIREBASE_SERVICE_ACCOUNT` is not yet configured in GCP Secret Manager, so realtime signal writes are skipped after webhook DB updates. | Live frontend updates without page refresh. |
