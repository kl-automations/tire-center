# CLAUDE.md — Tire-Center

Agent guidance for working in this repo. Same content surface as [`b2b-context.md`](./b2b-context.md), restated as scannable rules. When in doubt, read the prose version first.

Tafnit transport / auth / codes are documented in [`./tafnit_spec.md`](./tafnit_spec.md). Treat that as canonical — do not duplicate or contradict it.

---

## What this is

Mechanic-facing PWA in production (currently v1.1.8). React 18 + TypeScript + Vite + Tailwind on the frontend (`react-router-dom` for routing); FastAPI on Python 3.11 with async Postgres on the backend. Hosted on a GCP VM behind nginx with a Firebase project for real-time signals. **Module B** of the Kogol V2 spec — drives Tafnit's mechanic-side workflow.

The app is **Tafnit's mechanic surface**. Tafnit owns orders, customers, shops, codes, and red-route orchestration. We render its data, accept mechanic input, and feed acks back. Cross-system logic (multi-shop search, Voicy escalation, driver-side flow) lives elsewhere.

## Hard rules — do not violate without explicit user approval

- **All secrets via GCP Secret Manager.** No `.env` files. App refuses to start if a required secret is missing.
- **JWT auth on every `/api/*` endpoint** other than `/health`. Shop ID is encoded in the token; scope every query by it.
- **15s login cooldown stays.** Tafnit rate-limits per mechanic; the cooldown protects against rapid taps.
- **Real-time delivery is Firestore `onSnapshot`.** Backend writes signals on state changes; frontend subscribes. **No polling, no WebSockets, no SSE.** FCM is wired but not used for closed-app push at this stage.
- **ERP transport is `zeep` SOAP.** Don't replace with raw HTTP or a different SOAP library. Action / reason codes resolve from Postgres lookup tables, not hardcoded.
- **Carool stays feature-flagged.** `CAROOL_ENABLED=0` in GCP secrets disables it; the backend returns 204 from all three Carool endpoints when off, and the frontend reads `/api/config` to hide the UI.
- **`react-router-dom` is the router.** Do not introduce a `NavigationContext` (the demo project has one — that's design scaffolding, not source).
- **Tafnit is the only outbound counterpart for stock-availability traffic.** Even when the actual answer came from Voicy talking to a different shop, our acks go to Tafnit and only Tafnit. Do not call Voicy directly.
- **No new dependencies without checking in.**

## What we DO build here

- Two-step SMS-OTP login + JWT issuance.
- Plate lookup → diagnosis → ERP submission → approval / decline flow.
- Per-wheel action / reason code recording with optional Carool AI photo flow.
- Real-time order status updates via Firestore `onSnapshot`.
- Three new dashboard tiles (see below).
- He / Ru / Ar i18n with direction switching.
- PWA: manifest + service worker + offline shell.

## The three new dashboard tiles

| Tile | Phase | State |
|---|---|---|
| Stock Availability | Phase 1 | Live page. Receives Tafnit-pushed inventory requests; mechanic approves / declines. |
| Demand Overview | Phase 2 | Non-clickable tile, "coming soon". |
| Monthly Receipt | Phase 2 | Non-clickable tile, "coming soon". |

Phase 2 is undated and ships when the customer asks for it. The two phase-2 tiles use the same visual treatment as the live ones but are disabled, with their own distinct translation keys (so wording can diverge later).

## Stock Availability rules

- **Inbound**: Tafnit pushes new request → backend persists in `stock_availability_requests` (new Postgres table) → Firestore signal → frontend renders card.
- **Tafnit assigns the shop.** Trust the `shop_id` on the inbound payload — no rebroadcasting, no re-filtering on our side.
- **Cancel-search** from Tafnit silently removes the card. No toast, no banner.
- **Approve**: backend marks `accepted`, acks Tafnit, signals frontend. Row persists 24 h, then nightly cleanup deletes it.
- **Decline**: backend marks `declined`, acks Tafnit with a **retry loop** (Tafnit ack is required before the user-facing dismissal timer starts).
- **15s auto-dismiss** on declined cards starts only after Tafnit's ack arrives. The mechanic can also tap × manually post-ack.
- **Tafnit endpoints don't exist yet** — we're writing our half first. Field shapes are proposed in `b2b-context.md` §5.1; expect tweaks during integration week.

## ActionCode reference (most-used)

Live in Postgres lookup tables (`erp_action_codes`, `erp_reason_codes`). Resolve per-request, do not hardcode.

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

Reason codes link to action codes via `linked_action_code` and resolve the same way.

## Things to push back on

If a user request implies any of the following, stop and confirm:

- "Switch routing to a NavigationContext" — no, that's the demo's pattern, not prod.
- "Drop the 15s login cooldown" — no, see hard rules.
- "Move secrets to a `.env` file" — no.
- "Add polling for live updates" — no, Firestore `onSnapshot`.
- "Replace `zeep` with X" — no.
- "Filter stock-availability requests on our side" — no, Tafnit assigns the shop.
- "Send the decline ack and forget" — no, retry loop until Tafnit acks; user-visible timer waits on the ack.
- "Auto-dismiss declined cards immediately" — no, only after Tafnit's ack.
- "Reach out to Voicy directly" — no, Tafnit is the only counterpart.
- "Make the Demand / Monthly tiles clickable in phase 1" — no, non-clickable placeholders.

## Common gotchas

- Tafnit's `ReturnCode` is a **string** — compare `== "1"`, never `== 1`.
- `ReturnCode == "2"` from Tafnit means "already exists" → treat as success in most paths.
- `asyncpg` returns JSONB columns as strings (no codec on the pool). Decode with `_coerce_jsonb()` in `routers/diagnosis.py` or equivalent.
- Backend runs inside `~/venv` — `source ~/venv/bin/activate` before launching uvicorn.
- Backend logs go to `~/uvicorn.log` (append mode — never `>`).
- Frontend builds locally → `scp dist/*` to `/home/memla/frontend/dist/` → `sudo nginx -s reload`. See `quick-tools.md`.

## Repo layout

- `frontend/src/app/components/` — screen components (one per route).
- `frontend/src/app/usePhoneBackSync.ts` — Android back-button hook.
- `frontend/src/locales/` — He / Ru / Ar translation files.
- `backend/main.py` — entry, lifespan, router registration.
- `backend/routers/` — one file per route group (`auth`, `car`, `carool`, `diagnosis`, `orders`, `webhooks`, `internal`, `history`, `config_router`).
- `backend/adapters/erp.py` — SOAP client.
- `backend/adapters/carool.py` — Carool REST client.
- `backend/middleware/auth.py` — JWT bearer token dependency.
- `backend/models/schemas.py` — Pydantic request / response models.

## Working with the user

- User is roi.krn@gmail.com. Solo developer; ship-velocity over architectural perfection where the two conflict.
- Sibling driver-app repo is `TIRE-B2C/` — read-only reference for Module A patterns. Do not modify it from this repo's tasks.
- Sibling demo repo is `tire-center-demo/` — UI scaffolding for the new dashboard surfaces. Read it for visual structure; do not import its `NavigationContext` or `mockApi`.
- VM `35.252.12.169` and the deploy commands in `quick-tools.md` are for this repo.
- When in doubt about a Tafnit field shape: check `tafnit_spec.md`, then ask. Do not invent contracts silently.

## Open questions (do not silently resolve)

Flagged in `b2b-context.md` §9. Touch any of them in code → leave a `TODO(b2b)` comment.
