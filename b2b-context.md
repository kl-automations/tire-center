# Tire-Center — Project Context

> Mechanic-facing PWA for the Kogol tire-service ecosystem. This document is the **single source of project context** — what it does, what's already shipped, what's coming, and the architectural rules a contributor (human or AI) needs to know before touching code.
>
> Companion document: [`CLAUDE.md`](./CLAUDE.md) — same content, restated as scannable rules for an AI coding agent. Read whichever fits how you think.
>
> Tafnit (ERP) integration mechanics — transport, auth, SOAP envelopes, codes, quirks — are documented separately in [`tafnit_spec.md`](./tafnit_spec.md). Do not duplicate that material here; link to it.

---

## 1. What this app is

A mechanic in a tire shop opens this app on their phone. They scan or type a license plate; Tafnit (the ERP) returns the open service order; they record per-wheel actions (replacement, repair, relocation, etc.), optionally photograph each tire for AI analysis (Carool), and submit the diagnosis. The garage manager approves or declines via Tafnit; the mechanic sees the result in real time, pushed to the open tab.

This has been in production for some time and is currently at v1.1.8. It is **not a green-field project** — most of what's described below already exists and is in daily use. The active development surface is a set of three new dashboard tiles being added on top of the existing flow.

## 2. Where it sits in the Kogol ecosystem

The Kogol V2 program is divided into modules in the Hebrew tech spec (`מסמך אפיון טכני - מערכת פנצ'ריות קוגול V2 וממשק נהגים`). **This repo is Module B** — the Mechanic Web App (Tire-Shop App V2) and its backend.

| Module | What | Where it lives | Our concern? |
|---|---|---|---|
| A. Driver Web App | Driver-facing PWA + thin backend (license-plate funnel into Tafnit). | `TIRE-B2C/` (sibling repo) | No. Parallel work. |
| **B. Tire-Shop App V2** | This repo. Mechanic-facing PWA, getting upgrades for red-route screens, demand insight, and monthly reconciliation. | `tire-center/` | **Yes — this is us.** |
| C. Voicy + State Machine | Voice-AI calls to shops + queue/timeout logic for red-route inventory checks. | Separate service. | No. Tafnit is our only counterpart. |
| D. Tafnit Deep Integration | The contract layer between us and Tafnit. | Distributed across A and B's backends. | Yes, our half. |
| E. QA / Design / Meetings | Operational. | — | Out of code scope. |
| F. DevOps | GCP VM + nginx + Cloud Run + Firebase deployment. | This repo's CI/CD. | Yes, ours. |

**The mental model**: tire-center is **Tafnit's mechanic-facing front-end** — driving Tafnit's diagnosis workflow, displaying Tafnit's order data, surfacing Tafnit's stock-availability requests, and feeding Tafnit's analytics back to the shop. All cross-system orchestration (red-route queueing, Voicy escalation, customer-side notifications) happens inside Tafnit. This app is a stateful, real-time **delivery surface** for Tafnit-driven events.

## 3. Architectural rules — non-negotiable

These are decisions that have already been made and should not be revisited without explicit user approval.

### 3.1. Tafnit is the source of truth for orders, customers, and shops
There is local Postgres state, but it is **not authoritative**. We mirror, cache, and stage data only as far as needed to deliver a fast UX between Tafnit calls. Every order, every customer, every shop, every action/reason code originates in Tafnit. When in doubt, re-fetch from Tafnit instead of trusting a local row.

### 3.2. Local Postgres, with discipline
Postgres on the GCP VM holds the working state we need across browser sessions: `open_orders` (live in-flight diagnoses), `stock_availability_requests` (incoming red-route requests — see §5.1), the code lookup tables (`erp_action_codes`, `erp_reason_codes`), shops, etc. Schema changes are explicit migrations, not silent drift. Nightly cleanups remove anything past its lifecycle (declined `open_orders`, expired stock-availability rows, etc.).

### 3.3. Two-step SMS auth → JWT, no exceptions
Mechanics log in by user code → SMS OTP (sent by Tafnit) → JWT issued by us, stored in `localStorage`. All `/api/*` endpoints require the JWT. The shop the mechanic belongs to is encoded in the JWT and used to scope every read and write — a mechanic can never see another shop's orders or stock-availability requests, even by guessing UUIDs. The 15-second cooldown on the login button is a deliberate guard against Tafnit's per-mechanic rate-limit; do not remove it.

### 3.4. All secrets in GCP Secret Manager — no `.env` files
The backend refuses to start if any required secret is missing. The ERP firewall whitelists only the VM's IP, so a misplaced credential in a `.env` is both unnecessary and a security regression. New secrets are added via `gcloud secrets`, not by editing files.

### 3.5. Real-time updates flow through Firestore `onSnapshot`
The backend writes a small signal doc to Firestore whenever an order status changes (ERP approval, ERP decline, new stock-availability request, etc.). The open browser tab subscribes via `onSnapshot` and reacts. **No polling**, **no WebSockets**, **no SSE**. FCM is wired but not used for closed-app push at this stage — only foreground real-time delivery via Firestore.

### 3.6. The mechanic's tab is the only client we serve
No public API, no third-party clients, no read-only dashboards. Everything served from `/api/*` is for the mechanic's PWA. Auth, CORS, rate-limiting are all calibrated to that single surface.

### 3.7. Demo is scaffolding, not source
The sibling `tire-center-demo/` directory is a UI prototype agreed with the customer for the new dashboard surfaces. **It is not source for prod**. Port screen behavior deliberately — copy visual patterns, copy translation strings — but **do not import its `NavigationContext`**; tire-center uses `react-router-dom` and that does not change. Demo's `mockApi` is fake; replace it with real backend calls when porting.

## 4. The mechanic's flow (current production)

```
1. Mechanic enters license plate → POST /api/car/lookup → ERP returns order
2. Mechanic records per-wheel actions in the UI (sessionStorage scratchpad)
3. [Optional] Mechanic photographs tyres:
      POST /api/carool/session → POST /api/carool/photo (×1–8)
4. Mechanic clicks Submit:
   — Carool path:   POST /api/diagnosis/draft (saves inputs, status→pending_carool)
                    → POST /api/carool/finalize (triggers async AI analysis)
                    → UI shows waiting spinner (120s watchdog)
                    → POST /api/webhook/carool fires (Carool sends results)
                    → backend merges results + submits to ERP automatically
   — Fallback path: POST /api/diagnosis → ERP immediately (Carool disabled or no session)
5. ERP manager approves/declines → POST /api/webhook/erp fires
6. Backend updates status, writes Firestore signal → frontend reacts via onSnapshot
```

Order status lifecycle:

```
open → pending_carool → waiting → approved / partly-approved / declined
         (Carool path)
open → waiting → approved / partly-approved / declined
         (fallback path)
```

## 5. The new dashboard surface (Module B V2)

The dashboard now hosts three new tiles in addition to **New Request** and **Open Requests**:

| Tile | Phase | Behavior |
|---|---|---|
| **Stock Availability** | Phase 1 | Live page. Receives red-route inventory check requests from Tafnit and lets the mechanic approve / decline each one. |
| **Demand Overview** | Phase 2 | Non-clickable tile with a "coming soon" message. Tile is rendered but disabled. |
| **Monthly Receipt** | Phase 2 | Non-clickable tile with a "coming soon" message. Tile is rendered but disabled. |

All three tiles share the dashboard's existing visual treatment (icon circle, title, subtitle, indigo / violet / cyan badge colors per the demo). Phase 2 has no fixed date — it ships when the customer asks for it.

### 5.1. Stock Availability — the live one

The "red route" in the Kogol V2 spec is the flow where Tafnit checks multiple shops for tire stock before sending a driver. When Tafnit picks a shop, this app receives a stock-availability request; the mechanic confirms or declines; the answer goes back to Tafnit. **All inbound and outbound traffic for these requests goes through Tafnit, even when the actual answer came from Voicy talking to a different shop** — Tafnit is the single counterpart this app speaks to.

#### Inbound: new request from Tafnit
- Tafnit pushes a new request: `{request_id, shop_id, tire_size, quantity, ...}`. The `shop_id` field tells us which shop to surface this to; **Tafnit does the routing — we do not filter or rebroadcast**.
- Backend persists it to a new `stock_availability_requests` Postgres table (status `live`).
- Backend writes a Firestore signal; the open Stock Availability page receives it via `onSnapshot` and renders a card.
- An incoming "cancel search" command from Tafnit (search resolved elsewhere) **silently removes** the corresponding card — no toast, no banner, just gone. The mechanic was never going to action it.

#### Outbound: mechanic taps Approve
- Backend marks the row `accepted`, sends the accept ack to Tafnit, writes a Firestore signal, frontend moves the card to the "accepted" section.
- Accepted rows persist for **24 hours**, then are removed by the nightly cleanup.

#### Outbound: mechanic taps Decline
- Backend marks the row `declined` and sends the decline ack to Tafnit. **Tafnit must ack the decline before the user-facing dismissal timer starts.**
- The decline ack is sent through a **retry loop** — if Tafnit doesn't respond, retry with backoff until acked.
- Once Tafnit acks, the frontend starts a **15-second auto-dismiss** timer; the row is then deleted from the table. The mechanic can also tap × on the declined card to dismiss it manually post-ack.

#### Tafnit endpoint contract — proposed (TBD: not yet wired by Tafnit)
> ⚠️ **Tafnit's side does not exist yet.** We are deliberately writing our half first so the Tafnit team can implement against a finished contract. Field shapes here are proposals; expect tweaks during integration week.

| Direction | Working name | Purpose | Body shape (proposed) |
|---|---|---|---|
| Tafnit → us | `POST /api/webhook/stock-availability` | New request push | `{request_id, shop_id, tire_size, quantity, expires_at?}` |
| Tafnit → us | `POST /api/webhook/stock-availability/cancel` | Cancel search (resolved elsewhere) | `{request_id}` |
| us → Tafnit | (Tafnit method TBD) | Accept ack | `{request_id, shop_id}` |
| us → Tafnit | (Tafnit method TBD) | Decline ack — retry until acked | `{request_id, shop_id}` |

Auth on the inbound webhooks follows the same pattern as `POST /api/webhook/erp` — see `tafnit_spec.md` for header convention. Outbound calls reuse the existing `erp_hash` flow.

### 5.2. Demand Overview & Monthly Receipt — phase 2 placeholders

Both pages display data that **Tafnit owns**, pulled once a day in bulk and filtered by shop:

- **Demand Overview**: tire size → monthly demand, sorted descending. Source is a daily Tafnit dump, filtered by `shop_id` before display.
- **Monthly Receipt**: action-by-action counts per month, with optional compare-to-month and CSV / XLS / PDF export. Same source pattern — daily Tafnit dump filtered by shop.

Neither page does any computation on our side beyond the per-shop filter. There is no analytics pipeline. There are no derived metrics. We are a viewer over Tafnit-owned aggregates.

In Phase 1 these are **non-clickable dashboard tiles** with a "coming soon" message — distinct translation keys per tile so wording can differ later. They are visible so the customer sees the surface taking shape, not so they can interact with it.

## 6. Frontend

- **Stack**: React 18 + TypeScript + Vite + Tailwind v4. Routing via `react-router-dom`. **Do not switch to a custom navigation context.**
- **PWA**: installable on Android / iOS, manifest + service worker.
- **i18n**: Hebrew (default, RTL), Russian, Arabic via i18next. Direction switches per locale; do not hardcode `dir="rtl"`.
- **State**: in-flight diagnosis state is held in `sessionStorage`; auth token in `localStorage`.
- **Real-time**: Firestore `onSnapshot` listener subscribes to the shop's signal collection on dashboard mount; the Stock Availability page consumes the same stream filtered to its concern.
- **Demo as scaffolding**: components for the new dashboard surfaces (`StockAvailability`, `DemandOverview`, `MonthlyReceipt`) exist in `tire-center-demo/frontend/src/app/components/`. Port them deliberately — replace `mockApi` with real fetch calls, swap `useNavigation` for `useNavigate`, keep visual structure. The first task on this project after this doc lands is folding the demo's three new screens into this repo as live (Stock Availability) or placeholder (Demand / Receipt) components.

## 7. Backend

- **Stack**: Python 3.11 + FastAPI + Uvicorn on a GCP VM behind nginx. Async Postgres via `asyncpg` with a small connection pool.
- **ERP client**: SOAP via `zeep`, lives in `adapters/erp.py`. Action / reason code tables live in Postgres and are resolved per-call.
- **Carool client**: REST via `httpx`, feature-flagged by the `CAROOL_ENABLED` GCP secret.
- **Firebase Admin SDK**: writes Firestore signal docs on order / state changes. Initialised at startup; falls back to Application Default Credentials when no service-account secret is set.
- **Stateless beyond Postgres + Firestore**: no in-memory user sessions, no per-request caching across requests. JWT carries enough to identify mechanic + shop on every call.
- **Logging**: structured logs to the VM log file; ERP slowness (15 s timeout) is normal and should not be alerted on.

## 8. Internationalization

Three languages: Hebrew (default, RTL), Russian (LTR), Arabic (RTL). Translation keys cover UI strings only — Tafnit-returned strings (shop names, addresses, error messages) come back in their stored language and pass through unchanged.

This document is in English and is not translated.

## 9. Open questions

These are intentionally unresolved. Touch any of them in code → leave a `TODO(b2b)` comment and surface the choice.

1. **Exact field shapes for the four Tafnit endpoints in §5.1** — final shapes will be confirmed during integration week, when Tafnit's side is built against this contract.
2. **Retry-loop parameters for the decline ack** — max attempts, backoff curve, and what to do if the loop gives up (toast the mechanic? leave the card stuck? log and silently dismiss?).
3. **`shop_id` mapping** — when Tafnit pushes a `shop_id` we don't have a row for in our shops table, what happens (provision, reject, log)?
4. **Cancel-search after the mechanic already responded** — Tafnit sends "cancel" on a request the mechanic has already accepted or declined. Treat as a no-op? Roll back the local state? Show the mechanic a heads-up?
5. **Stock Availability page navigation entry points** — only the dashboard tile, or also a settings-menu entry? PWA back-button behavior?
6. **Demand Overview / Monthly Receipt data ingestion** — when phase 2 lands: cron job pulling Tafnit, n8n workflow, or push from Tafnit? Table shape? Column for export-ready vs. raw?
7. **Carool ↔ Stock Availability interaction** — if a mechanic is mid-Carool-session and a stock-availability request lands, how prominent should the prompt be?

## 10. References

- Hebrew tech spec: `מסמך אפיון טכני - מערכת פנצ'ריות קוגול (V2) וממשק נהגים.pdf` (in the user's Downloads).
- Tafnit transport spec: [`./tafnit_spec.md`](./tafnit_spec.md) — **canonical** for SOAP, auth, codes, quirks.
- Sibling driver-app project: [`../TIRE-B2C/`](../TIRE-B2C/) — Module A.
- UI scaffolding for the new dashboard surfaces: [`../tire-center-demo/`](../tire-center-demo/).
