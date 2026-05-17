# CLAUDE.md — Tire-Center

Agent guidance for working in this repo. Read this file before touching any code or producing any output.

Tafnit transport / auth / codes are documented in [`tafnit_spec.md`](./tafnit_spec.md). Treat that as canonical — do not duplicate or contradict it.

---

## Session start protocol

Every new session must read these files before taking any action:

1. `CLAUDE.md` (this file)
2. `CHANGELOG.md` — current state, in-progress work, known issues
3. `quick-tools.md` — deploy commands and infrastructure reference
4. `tafnit_spec.md` — Tafnit integration spec

Read additional files only as relevant to the specific task at hand.

---

## Role — PM session vs Coder session

### PM session
- Read-only. No file edits, no mutations.
- Deliverable is a written task brief that a coder session (or the user) will execute.
- Read code to gather context, ask clarifying questions, then produce a brief.

### Coder session
- Receives a task brief and executes it.
- **Always update `CHANGELOG.md`** when completing a task — mark completed items done, add any new in-progress items, update the state summary.
- Before finishing any session, confirm `CHANGELOG.md` reflects the new project state.

---

## Output format — task briefs

All task briefs must:

- Be wrapped entirely in a single triple-backtick markdown block.
- Be written in plain English — no code snippets or illustrative examples.
- Reference exact file paths and function names where they matter.
- Follow this structure: **Context → Files to touch → Exact behavior → Edge cases → Contracts**

---

## What this is

Mechanic-facing PWA in production. React 18 + TypeScript + Vite + Tailwind v4 on the frontend (`react-router-dom` for routing); FastAPI on Python 3.11 with async Postgres on the backend. Hosted on a GCP VM behind nginx with a Firebase project for real-time signals. **Module B** of the Kogol V2 spec — drives Tafnit's mechanic-side workflow.

The app is **Tafnit's mechanic surface**. Tafnit owns orders, customers, shops, codes, and red-route orchestration. We render its data, accept mechanic input, and feed acks back. Cross-system logic (multi-shop search, Voicy escalation, driver-side flow) lives elsewhere.

---

## Tech stack

| Layer | Stack |
|---|---|
| Frontend | React 18 + TypeScript + Vite + Tailwind v4 + `react-router-dom` |
| Backend | FastAPI + Python 3.11 + Uvicorn |
| Database | PostgreSQL via `asyncpg` |
| Real-time | Firebase Firestore `onSnapshot` |
| ERP transport | SOAP via `zeep` |
| Carool client | REST via `httpx` |
| Secrets | GCP Secret Manager — project ID: `tire-center-dev` |
| Hosting | GCP VM (`35.252.12.169`) behind nginx |
| i18n | i18next — Hebrew (RTL, default), Russian (LTR), Arabic (RTL) |

---

## Hard rules — do not violate without explicit user approval

- **All secrets via GCP Secret Manager.** No `.env` files. App refuses to start if a required secret is missing.
- **JWT auth on every `/api/*` endpoint** other than `/health`. Shop ID is encoded in the token; scope every query by it.
- **15s login cooldown stays.** Tafnit rate-limits per mechanic; the cooldown protects against rapid taps.
- **Real-time delivery is Firestore `onSnapshot`.** No polling, no WebSockets, no SSE.
- **ERP transport is `zeep` SOAP.** Do not replace with raw HTTP or a different SOAP library. Action / reason codes resolve from Postgres lookup tables, not hardcoded.
- **Carool stays feature-flagged.** `CAROOL_ENABLED=0` in GCP secrets disables it; the backend returns 204 from all three Carool endpoints when off, and the frontend reads `/api/config` to hide the UI.
- **`react-router-dom` is the router.** Do not introduce a `NavigationContext`.
- **Tafnit is the only outbound counterpart for stock-availability traffic.** Do not call Voicy directly.
- **No new dependencies without checking in.**

---

## What we build

- Two-step SMS-OTP login + JWT issuance.
- Plate lookup → diagnosis → ERP submission → approval / decline flow.
- Per-wheel action / reason code recording with optional Carool AI photo flow.
- Real-time order status updates via Firestore `onSnapshot`.
- Three new dashboard tiles (Stock Availability live; Demand Overview and Monthly Receipt as phase-2 placeholders).
- He / Ru / Ar i18n with direction switching.
- PWA: manifest + service worker + offline shell.

---

## The three new dashboard tiles

| Tile | Phase | State |
|---|---|---|
| Stock Availability | Phase 1 | Live. Receives Tafnit-pushed inventory requests; mechanic approves / declines. |
| Demand Overview | Phase 2 | Non-clickable tile, "coming soon". |
| Monthly Receipt | Phase 2 | Non-clickable tile, "coming soon". |

Phase 2 is undated. The two phase-2 tiles use the same visual treatment as the live ones but are disabled, with their own distinct translation keys.

---

## Stock Availability rules

- **Inbound**: Tafnit pushes a new request → backend persists to `stock_availability_requests` (Postgres) → Firestore signal → frontend renders card.
- **Tafnit assigns the shop.** Trust the `shop_id` on the inbound payload — no rebroadcasting, no re-filtering.
- **Cancel-search** from Tafnit silently removes the card. No toast, no banner.
- **Approve**: backend marks `accepted`, acks Tafnit, signals frontend. Row persists 24h, then nightly cleanup deletes it.
- **Decline**: backend marks `declined`, acks Tafnit with a **retry loop**. Tafnit ack is required before the user-facing dismissal timer starts.
- **15s auto-dismiss** on declined cards starts only after Tafnit's ack arrives. Mechanic can also tap × manually post-ack.
- **Retry semantics**: only transport-layer failures (connection, timeout) trigger backoff retries. A SOAP fault or HTTP error body counts as a received response — do not retry on it.

---

## Deploy commands

Full reference in `quick-tools.md`. Critical points:

**Push backend** (from local, PowerShell):
scp the `backend/` folder to `memla@35.252.12.169:/home/memla/`, then on the VM: kill the uvicorn process, activate `~/venv`, and start uvicorn with `nohup` appending to `~/uvicorn.log`. Always use append (`>>`) not overwrite (`>`).

**Push frontend** (from local): run `npm run build` in `frontend/`, then scp `dist/*` to `/home/memla/frontend/dist/`. On the VM, **run `chmod -R 755 /home/memla/frontend/dist/` before `sudo nginx -s reload`** — scp preserves restrictive umask and nginx (www-data) will 403 without the chmod.

---

## Repo layout

- `frontend/src/app/components/` — screen components (one per route)
- `frontend/src/app/usePhoneBackSync.ts` — Android back-button hook
- `frontend/src/locales/` — He / Ru / Ar translation files
- `backend/main.py` — entry, lifespan, router registration
- `backend/routers/` — one file per route group (`auth`, `car`, `carool`, `diagnosis`, `orders`, `webhooks`, `internal`, `history`, `config_router`)
- `backend/adapters/erp.py` — SOAP client
- `backend/adapters/carool.py` — Carool REST client
- `backend/middleware/auth.py` — JWT bearer token dependency
- `backend/models/schemas.py` — Pydantic request / response models

---

## ActionCode reference (most-used)

Resolve from `erp_action_codes` / `erp_reason_codes` tables — do not hardcode.

| Code | Hebrew |
|---|---|
| 1 | תיקון תקר |
| 2 | העברה |
| 3 | החלפת צמיג |
| 5 | יישור ג'אנט |
| 6 | כיוון פרונט (PC) |
| 7 | איזון גלגלים |
| 8 | שסתום |
| 9 | חיישן (TPMS) |

---

## Common gotchas

- Tafnit's `ReturnCode` is a **string** — compare `== "1"`, never `== 1`.
- `ReturnCode == "2"` from Tafnit means "already exists" → treat as success in most paths.
- `asyncpg` returns JSONB columns as strings (no codec on the pool). Decode with `_coerce_jsonb()` in `routers/diagnosis.py` or equivalent.
- `UserMileage` not `LastMileage` inside `SendDiagnose > Diagnosis` — using the wrong name causes the ERP to silently ignore the value.
- `request_id` in the ERP webhook is always a string, even though it looks numeric. Pydantic typed as int will reject valid payloads.
- Frontend chmod before nginx reload — skipping causes 403 on new assets even though the files are on disk.
- Backend must run inside `~/venv` — always activate before launching uvicorn.

---

## Things to push back on

- "Switch routing to a NavigationContext" — no, that's the demo's pattern, not prod.
- "Drop the 15s login cooldown" — no.
- "Move secrets to a `.env` file" — no.
- "Add polling for live updates" — no, Firestore `onSnapshot`.
- "Replace `zeep` with X" — no.
- "Filter stock-availability requests on our side" — no, Tafnit assigns the shop.
- "Send the decline ack and forget" — no, retry loop until transport succeeds.
- "Retry on SOAP fault or HTTP error body" — no, only transport-layer failures trigger retry.
- "Auto-dismiss declined cards immediately" — no, only after Tafnit's ack.
- "Reach out to Voicy directly" — no, Tafnit is the only counterpart.
- "Make the Demand / Monthly tiles clickable in phase 1" — no.

---

## Working with the user

- Solo developer, roi.krn@gmail.com. Ship velocity over architectural perfection.
- Sibling repos: `TIRE-B2C/` (Module A, read-only reference) and `tire-center-demo/` (UI scaffolding — read visual structure only, do not import `NavigationContext` or `mockApi`).
- When in doubt about a Tafnit field shape: check `tafnit_spec.md`, then ask. Do not invent contracts silently.
- Open questions are flagged in `b2b-context.md` §9. Touch any in code → leave a `TODO(b2b)` comment.