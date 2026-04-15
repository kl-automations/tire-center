# Backend Implementation Backlog — Tire Center

> **Owner:** Mel (developer)
> **Created:** 2026-04-13
> **Context:** Full backend to be built from scratch. GCP infrastructure and secrets are already provisioned — see `MANUAL_SETUP.md`. All tasks here are code-only.
> **Backend code:** `backend/`
> **Frontend code:** `src/`

---

## Phase 1 — FastAPI Skeleton

> Unblocks everything. Test with mock ERP responses before real ERP is available.

| # | Task | Details | Done when |
|---|------|---------|-----------|
| B1 | Scaffold FastAPI project | Create `backend/main.py`, `Dockerfile`, `requirements.txt`. Dependencies: `fastapi`, `uvicorn`, `asyncpg`, `python-jose`, `firebase-admin`, `httpx` | `docker build` succeeds. `GET /health` returns `{"status":"ok"}` |
| B2 | Cloud SQL connection pool | Connect via `asyncpg` using `CLOUD_SQL_CONNECTION_NAME` env var. Fail fast with clear error if DB unreachable on startup | App connects on startup. Clear error if DB is down |
| B3 | Run DB migrations | Execute schema below on startup or via migration script | `\d open_orders` shows all columns and indexes |
| B4 | JWT middleware | `get_current_shop()` FastAPI dependency: decode JWT, extract `shop_id`. Return `401` if token missing or invalid. **Never read `shop_id` from request body** | Protected route returns `401` without token, `200` with valid token |

**`open_orders` schema:**
```sql
CREATE TABLE open_orders (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id          text NOT NULL,
  license_plate    text NOT NULL,
  plate_type       text NOT NULL,
  mileage          integer,
  car_data         jsonb,
  diagnosis        jsonb,
  status           text NOT NULL DEFAULT 'waiting',
  erp_hash         text NOT NULL,
  declined_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON open_orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_open_orders_shop_id     ON open_orders (shop_id);
CREATE INDEX idx_open_orders_status      ON open_orders (status);
CREATE INDEX idx_open_orders_declined_at ON open_orders (declined_at) WHERE declined_at IS NOT NULL;
```

---

## Phase 2 — Auth Endpoint

| # | Endpoint | Details | Done when |
|---|----------|---------|-----------|
| B5 | `POST /api/auth` | Forward `{username, password}` to ERP `/auth`. On approval: sign JWT with `{shop_id, erp_hash}`, return `{token, shop_id, erp_hash}`. On rejection: return `401` | Valid ERP creds → JWT returned. Invalid creds → `401` |

---

## Phase 3 — Core API Endpoints

| # | Endpoint | Details | Done when |
|---|----------|---------|-----------|
| B6 | `GET /api/orders` | Return `open_orders` rows for authenticated `shop_id`. Always: `WHERE shop_id = :shop_id` from JWT. Response shape: `{total, orders: [...]}` | curl with valid JWT returns only that shop's orders |
| B7 | `GET /api/orders/{order_id}` | Return single order. Verify `shop_id` from JWT matches row — return `404` if not found or wrong shop | Returns order. Returns `404` for order belonging to a different shop |
| B8 | `POST /api/car` | Extract `shop_id` + `erp_hash` from JWT → forward `{shop_id, license_plate, mileage}` to ERP with `erp_hash` in auth header → return ERP response as-is | Car data object returned from ERP |
| B9 | `POST /api/diagnosis` | Validate JWT → confirm `order_id` exists AND `shop_id` matches → forward to ERP → on ERP `200`: set `status = 'waiting'` in DB → return ack | Order status updates in DB. Wrong shop `order_id` returns `404` |
| B10 | `POST /api/history` | Extract `shop_id` + `erp_hash` from JWT → forward `{shop_id, date_from, date_to, email}` to ERP → return ack | ERP receives request |

---

## Phase 4 — ERP Webhook + Firestore

| # | Task | Details | Done when |
|---|------|---------|-----------|
| B11 | `POST /api/webhook/order-status` | Validate `X-Webhook-Secret` header against `WEBHOOK_SECRET` env var — return `401` + log if mismatch. Verify `request_id` exists in DB — return `401` if not. Update: `status`, per-wheel approvals in `diagnosis` jsonb, set `declined_at` if `status = 'declined'`. Then call B12. Return `200` | Correct secret + valid order → DB updated. Wrong secret → `401` |
| B12 | Firestore signal write | After DB update: write `orders/{shop_id}/updates/{order_id} = {status, updated_at}` using Firebase Admin SDK. Service account JSON from `FIREBASE_SERVICE_ACCOUNT` env var | Firestore document appears after webhook POST |

---

## Phase 5 — Scheduled Cleanup

| # | Task | Details | Done when |
|---|------|---------|-----------|
| B13 | `POST /internal/cleanup` | Delete: `WHERE status = 'declined' AND declined_at::date = CURRENT_DATE - 1 AND declined_at::time < '16:00:00'`. Authenticate via OIDC token from Cloud Scheduler (verify in middleware) | Correct rows deleted. Rows declined after 16:00 survive |

---

## Phase 6 — Frontend Integration

| # | File | Replace mock with | Done when |
|---|------|------------------|-----------|
| F1 | `lib/api/client.ts` *(new)* | Base fetch wrapper — attach `Authorization: Bearer <jwt>` from `localStorage` on every request | All API calls go through this client |
| F2 | `lib/firebase.ts` *(new)* | Firebase app init + Firestore client, reading from `VITE_FIREBASE_PROJECT_ID` env var | Firestore client initializes without error |
| F3 | `lib/hooks/useOpenOrders.ts` *(new)* | `GET /api/orders` fetch + Firestore `onSnapshot` listener that calls `refetchOrder(id)` on change | Orders load on mount. UI updates when Firestore signal fires |
| F4 | `Login.tsx` | `POST /api/auth` → store `token`, `erp_hash`, `shop_id` in `localStorage` | Login stores JWT. Invalid creds show error |
| F5 | `OpenRequests.tsx` | Replace `MOCK_REQUESTS` with `useOpenOrders` hook | Real orders shown. Status updates without page refresh |
| F6 | `LicensePlateLookup.tsx` | `POST /api/car` → display returned car data | Car data renders after plate lookup |
| F7 | `DiagnosisForm.tsx` | `POST /api/diagnosis` → show success/error state | Submission updates order status in UI |
| F8 | `HistoryExportModal.tsx` | `POST /api/history` → show "Email sent" confirmation | Modal shows ack after submit |

**Firestore listener pattern (for F3):**
```typescript
import { collection, onSnapshot } from 'firebase/firestore'

onSnapshot(
  collection(db, 'orders', shopId, 'updates'),
  (snapshot) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type === 'modified' || change.type === 'added') {
        refetchOrder(change.doc.id)
      }
    })
  }
)
```

---

## Open Questions — Resolve with ERP Team Before Starting Phase 2

| # | Question | Blocks |
|---|----------|--------|
| Q1 | ERP base URL and auth header format — does `erp_hash` go in `Authorization: Bearer <hash>` or a custom header? | B8, B9, B10 |
| Q2 | Exact request/response payload shapes — field names, date formats, error codes | B5, B8, B9 |
| Q3 | ERP webhook retry behavior — if our endpoint returns non-200, does ERP retry? How many times? | B11 |
| Q4 | Does ERP login response include `shop_id`? If not, must be pre-configured | B5 |

---

## Priority Order

1. **B1–B4** — Skeleton + DB + JWT middleware
2. **B5** — Auth endpoint (frontend becomes usable)
3. **F1–F4** — API client + Firebase init + login wired up
4. **B6–B7 + F3 + F5** — Orders list end-to-end with live updates
5. **B11–B12** — Webhook + Firestore signal
6. **B8 + F6** — Car lookup end-to-end
7. **B9 + F7** — Diagnosis end-to-end
8. **B13** — Cleanup endpoint
9. **B10 + F8** — History export