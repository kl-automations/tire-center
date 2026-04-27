# Backend Implementation Status — Tire Center

> **Owner:** Mel (developer)
> **Status as of:** 2026-04-26 — **all phases complete**
> **Backend code:** `backend/`
> **Frontend code:** `src/`
> **Companion doc:** `docs/backend-structure.md` (architecture & API reference)

> This document was originally a phased build backlog written before the ERP
> was integrated. The architecture it described is now superseded — the live
> backend talks to the ERP over SOAP (zeep), not a generic REST `/auth`
> endpoint, and the auth flow is OTP-via-SMS (not email). The plan below has
> been collapsed into a status summary of what actually shipped.

---

## What was built

| Area | Status | Notes |
|------|--------|-------|
| Auth (OTP via `userCode`) | ✅ Live | `POST /api/auth/request-code` → ERP `IsValidUser` (sends SMS). `POST /api/auth/verify` → ERP `Login` → returns JWT `{ shop_id, erp_hash, exp }`. **No email anywhere.** |
| Car lookup | ✅ Live | `POST /api/car` → ERP `Apply` SOAP. Inserts `open_orders` row with `status='open'` and the ERP `request_id`. |
| Carool photo session | ✅ Live | `POST /api/carool/session` / `/photo` / `/finalize` — proxies to Carool REST. Session ID stored in `open_orders.carool_diagnosis_id`. |
| Diagnosis submission | ✅ Live | `POST /api/diagnosis` → ERP `SendDiagnose` SOAP. Translates per-wheel actions into `DiagnosisLine` rows; sets `open_orders.status='waiting'` on success. |
| Webhook handlers | ✅ Live | `POST /api/webhook/erp` and `POST /api/webhook/carool` update `open_orders` and (will) emit Firestore signals. |
| Orders list & detail | ✅ Live | `GET /api/orders` and `GET /api/orders/{id}` — JWT-scoped to `shop_id`. |
| Internal cleanup | ✅ Live | `POST /internal/cleanup` — deletes yesterday's pre-16:00 declined orders. |

---

## What is still stubbed

| Item | Reason |
|------|--------|
| `request_history_export` (in `adapters/erp.py`) | SOAP method name & request shape not yet provided by the ERP team. The route `POST /api/history` is wired up and returns success; the adapter is a no-op (`return True`). |
| Firestore realtime signals | `FIREBASE_SERVICE_ACCOUNT` is not yet configured in GCP Secret Manager. The webhook handlers update the DB but skip the Firestore write. Frontend currently does not subscribe. |

---

## New DB tables (added during ERP integration)

Two reference tables were added to `backend/db/schema.sql` to map the
frontend's diagnosis vocabulary onto the ERP's numeric codes. Both are seeded
with the live ERP codes; the long-term intent is for them to be admin-managed
(edit rows in DB → no code change required).

- **`erp_action_codes`** — maps `(frontend_action, frontend_reason)` → `erp_code`. Seeded with codes `2` (front alignment), `3` (wear), `4` (puncture), `23` (damage), `25` (fitment).
- **`erp_tire_locations`** — maps `wheel_position` → `erp_code`. Seeded with codes `1`–`8` covering all wheel positions plus a `no-location` entry (`6`) used for non-wheel-specific actions like front alignment.

Note: the codes are currently inlined as Python dicts in `adapters/erp.py`
(`_REASON_CODE`, `_TIRE_LOCATION_CODE`). Switching the adapter to query these
tables is a future cleanup task.
