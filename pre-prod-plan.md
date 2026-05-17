# Tire Center — Pre-Production Plan

> Drafted 2026-05-16. Source: production-readiness scan against v1.1.8.
> Update this file as items move from open → in-progress → done. Items that turn out to be stale belong in the "Closed during scan" section, not deleted.

---

## Posture

- **Ship target:** production with 400–600 mechanics initially, scaling to 800–1200.
- **Hosting today:** single GCP VM behind nginx.
- **Hosting near-term:** Cloud Run via Docker. **Prepare for, do not execute** until P2.5.
- **All code touched from now on is written Cloud Run-compatible:** stateless handlers, stdout-based logging, durable queues for any work that outlives a single HTTP response. No new code that writes to local disk or relies on long-running in-process tasks.

## Severity definitions

- **P0** — launch blocker. Cannot ship to production without it.
- **P1** — first-week hardening. Ship without it only if a hotfix path exists and the gap is communicated.
- **P2** — first-month tech debt. Important at scale but not a launch gate.

## How to read each item

Every item below follows the same shape:

- **Why** — the problem in one paragraph.
- **What** — the change in plain English.
- **Files** — exact paths the work touches.
- **Dependencies** — what must land first, or what external party must respond.
- **Acceptance** — observable conditions that mean the item is done.

When an item is picked up for execution, a full task brief is written separately (Context → Files to touch → Exact behavior → Edge cases → Contracts) and the item here is marked in-progress.

---

# P0 — Launch blockers

## P0.1 Inbound webhook IP allowlist

**Why.** The two ERP-facing webhook routes are reachable from the public internet with no app-level auth. Anyone who guesses a `request_id` can POST a forged status payload that flips an order to approved or declined and fires a Firestore signal to the mechanic. The Carool webhook is already protected by an `X-API-KEY` header and is out of scope here.

**What.** Add nginx-level IP allowlists scoped to the two webhook routes. The existing `TODO(b2b): validate X-ERP-Hash` markers in code stay as documentation but the actual protection is network-layer. ERP team is not adding auth to their side; they are comfortable with the symmetric arrangement (we already whitelist them on our outbound calls).

**Files.** `/etc/nginx/sites-enabled/default` on the VM. When Cloud Run lands (P2.5) the equivalent lives in the Cloud Load Balancer's backend service.

**Dependencies.** Tafnit must supply their static egress IP list and a contact for change notifications. Owner: roi.

**Acceptance.**
- A POST to `/api/webhook/erp` from a non-allowlisted IP returns 403 from nginx before reaching uvicorn.
- A POST from a Tafnit IP continues to write rows to Postgres and fire Firestore signals as it does today.
- Same applies to `/api/webhook/stock-availability`.
- The Carool webhook remains reachable from any IP (X-API-KEY auth unchanged).

---

## P0.2 Auth on `/api/internal/*`

**Why.** `/internal/cleanup` deletes declined orders from `open_orders`. `/internal/sync-erp-tables` re-syncs the ERP code tables into Postgres. Both endpoints have zero auth. Any IP that knows the URL can DELETE rows or force ERP load. The existing `TODO` in `backend/routers/internal.py` explicitly flags this as required before go-live.

**What.** A FastAPI dependency that authenticates Google Cloud Scheduler's OIDC ID token. The scheduler attaches `Authorization: Bearer <token>` automatically; the dependency validates the JWT against Google's JWKS, checks the `aud` claim matches the expected endpoint URL, and asserts the `email` claim matches the configured scheduler service account. Shared-secret-header is an acceptable fallback if the OIDC approach is more setup than desired, but OIDC is recommended because there is no secret to leak.

**Files.** New `backend/middleware/internal_auth.py`. Wire as `Depends(...)` on the router in `backend/routers/internal.py`.

**Dependencies.** GCP service account for Cloud Scheduler must be configured with permission to call the endpoint. Existing scheduled jobs (cleanup, sync) need their configuration updated to attach OIDC tokens — Cloud Scheduler console change, not code.

**Acceptance.**
- Unauthenticated POST to `/internal/cleanup` returns 401.
- Cloud Scheduler with the configured service account succeeds and the daily cleanup continues to run.
- The same applies to `/internal/sync-erp-tables`.

---

## P0.3 Remove `otp_debug` from auth response

**Why.** `RequestCodeResponse` exposes the raw OTP value in the response body when `ERP_TEST_MODE=true`. If that env var ever ends up set in production — deploy misconfig, copy from a `.env.example`, GCP secret typo — every login response carries the OTP, visible in DevTools, Cloud Logging request bodies, and any logging proxy. That defeats SMS-OTP entirely. Real login works without this flag and the dev-only convenience is no longer needed.

**What.** Delete the `otp_debug` field from `RequestCodeResponse`. Remove the env-var handling in the ERP adapter that populates it. Remove any frontend references to the field. Remove the `ERP_TEST_MODE` env var from any configuration documents.

**Files.** `backend/models/schemas.py:23-36`. `backend/adapters/erp.py` (search `otp_debug` / `ERP_TEST_MODE`). Sweep frontend for `otp_debug` references.

**Dependencies.** None.

**Acceptance.**
- `/api/auth/request-code` response payload contains only `success`, regardless of any env config.
- No references to `ERP_TEST_MODE` remain in backend source.

---

## P0.4 JWT TTL 30 days + frontend 401 → `/login`

**Why.** Today's `TOKEN_TTL_DAYS = 180` means a leaked token grants six months of access. With persistent mechanic logins on shared workshop devices, that exposure is too long. User wants automatic logout on expiry, currently nothing redirects on 401.

**What.** Backend: set `TOKEN_TTL_DAYS = 30` in `routers/auth.py`. Cookie `max_age` updates by the existing multiplication. Frontend: introduce a single fetch wrapper used by every API call; on any 401 it clears `localStorage.token` and navigates to `/login`. Migrate every existing direct `fetch("/api/...")` call to use the wrapper so the behavior is uniform.

**Files.** `backend/routers/auth.py:36` (and the cookie `max_age` derivation). New `frontend/src/app/apiClient.ts`. Sweep `frontend/src/app/components/*.tsx` for direct `fetch("/api/...")` and migrate.

**Dependencies.** None.

**Acceptance.**
- A fresh login issues a token with `exp` 30 days in the future and a cookie with matching `max_age`.
- Pointing a deliberately stale token at any protected route triggers a 401 from the backend and a redirect to `/login` in the browser.
- Every authenticated network call in the app uses the new wrapper.

---

## P0.5 Durable stock-availability ack retry

**Why.** The retry loop for Tafnit's SendQueryResponse ack lives in `asyncio.create_task(_ack_tafnit_with_retry(...))` in `backend/routers/stock_availability.py`. It runs up to 30 attempts with backoff capped at 60 seconds, so up to ~30 minutes per ack. On any uvicorn restart (deploy, OOM, today) or Cloud Run scale-down (tomorrow), the task dies silently. The row stays at `declined` instead of progressing to `declined_acked` or `declined_failed`, and the mechanic's UI never gets the resolution signal. This is a correctness issue today and a hard incompatibility with Cloud Run.

**What.** Move the retry out of in-process tasks into a durable queue. Two acceptable options:

- **Option A — Cloud Tasks (recommended).** Create a queue named `stock-availability-acks`. The approve/decline endpoints enqueue one task per ack with `apply_id`, `tire_shop_code`, `tafnit_response`, `shop_id`, `erp_hash`, `erp_shop_id`, `request_id`. Cloud Tasks dispatches to a new authenticated internal route (`POST /api/internal/stock-ack`) that performs one SendQueryResponse attempt. Cloud Tasks owns retry; configure `maxAttempts=30` and an exponential backoff matching the current curve. The handler returns 200 on transport success or any SOAP/HTTP-body response (anything that completed). It returns a retriable 5xx only on transport failures.
- **Option B — DB-backed outbox.** New `stock_ack_outbox` table with columns for the ack parameters and `next_attempt_at` / `attempts`. A worker (FastAPI background task at startup, or a separate Cloud Run job) polls every few seconds. Heavier, more failure modes, but no Cloud Tasks dependency.

The give-up path (after 30 transport failures → row flips to `declined_failed`, Firestore signal fires) must be preserved exactly.

**Files.** `backend/routers/stock_availability.py:32-117` (delete the in-process retry, replace with enqueue). New `backend/adapters/cloud_tasks.py` if Option A. New internal route handler. The give-up path needs a new home — either in the task handler's final-attempt branch or in the worker's max-attempts branch.

**Dependencies.** P0.2 (the new internal route handler must be protected). For Option A: Cloud Tasks queue provisioned in GCP, service account permission to enqueue.

**Acceptance.**
- The approve/decline endpoints return in under 100ms regardless of Tafnit's responsiveness.
- Killing uvicorn (or, in Cloud Run, forcing a scale-down) mid-retry does not lose pending acks — they continue when the next instance picks up.
- The decline-failed give-up path still flips the row to `declined_failed` and fires the Firestore signal after 30 transport failures.

---

# P1 — First week

## P1.1 Send-then-update Carool flow

**Why.** Today's Carool path defers the ERP submission until the Carool webhook fires — the order sits in `pending_carool` until then. If Carool is slow (their AI analysis can take minutes), the ERP receives nothing in the meantime. User wants the ERP to receive the mechanic's diagnosis immediately, then receive an update once Carool returns its prediction.

**What.** `POST /api/diagnosis/draft` becomes a real ERP submit — it calls `_submit_to_erp` immediately and flips status to `waiting`. The Carool webhook handler, when it arrives, merges the prediction (see P1.2) and fires a follow-up SOAP call that updates the existing `ApplyId`'s lines on the Tafnit side.

**Files.** `backend/routers/diagnosis.py:435-497` (draft handler — now does what direct submit does plus a status marker indicating Carool is still pending). `backend/routers/webhooks.py:535-557` (Carool webhook — now triggers an update call instead of a first submit). `backend/adapters/erp.py` (add the update method).

**Dependencies — blocks this item.** ERP team must confirm whether `SendDiagnose` upserts lines on an existing `ApplyId`, or whether a different SOAP method is required for the follow-up. The user's intuition that "we do this all the time when re-entering the plate" describes `Apply` returning `ReturnCode=2`, which is a read, not an update. Need an authoritative answer before implementation.

**Acceptance.**
- Mechanic taps submit; the ERP receives the diagnosis within seconds, independent of Carool latency.
- A Carool webhook arriving N minutes later triggers a second SOAP call that updates the same order's lines with the prediction, without creating duplicate lines.
- If Carool never fires its webhook, the order remains in `waiting` indefinitely without manual intervention.

---

## P1.2 Carool prediction into Remarks on replacement lines

**Why.** Today, `_submit_to_erp` tries to merge per-wheel Carool prediction into the ERP payload by appending `{"carool_prediction": ...}` to each wheel's action list. The SOAP serializer in `backend/adapters/erp.py` then iterates actions and skips entries without an `action` key — so the prediction is silently dropped. The data never reaches Tafnit. User wants v1 to carry the prediction inside the Remarks field of each replacement line (ActionCode=3); a v2 eventually moves to a dedicated CaRoolPrediction element once Tafnit extends the WSDL.

**What — v1.** For each DiagnosisLine the serializer builds where ActionCode equals 3, look up the per-wheel Carool prediction (by mapping the wheel position through `_ERP_WHEEL_TO_CAROOL`) and serialize it into the line's `<tem:Remarks>` text. Use a compact, deterministic format — JSON is fine for machine parseability on Tafnit's side; if a Hebrew human-readable summary is preferred, the user picks the wording. Lines with other ActionCodes are untouched. Remove the dead append-and-drop logic in `_submit_to_erp`.

**What — v2 (deferred).** When Tafnit confirms a WSDL extension for a dedicated `<tem:CaRoolPrediction>` element on `DiagnosisLine`, the serializer migrates the data into that element and the Remarks-carrier becomes a fallback or is removed.

**Files.** `backend/routers/diagnosis.py:267-284` (delete the dead merge). `backend/adapters/erp.py:494-511` (the SOAP serializer — inject prediction into Remarks when action_code equals 3 and a per-wheel prediction exists).

**Dependencies.** None for v1. v2 depends on Tafnit's WSDL extension.

**Acceptance.**
- A diagnosis with Carool results in the order's `diagnosis.carool_result` and an ActionCode=3 line for a wheel that has a matching prediction produces a SOAP envelope whose `<tem:Remarks>` for that line contains the prediction payload.
- Non-replacement action lines (puncture, repair, relocation, balancing, etc.) carry no Carool data in Remarks.
- The current "merge then drop" code path is removed.

---

## P1.3 Cancel-after-accept → declined with reason + per-card unread badge

**Why.** Today, when Tafnit sends `ActionType=8` or `9` for a row that the mechanic has already accepted, the backend just stamps `closed_reason='cancelled'` (or `'closed'`) and leaves status at `accepted`. The mechanic sees the cancellation only if they navigate to `/stock-availability` and read the small notice on the accepted card. The dashboard tile shows no badge because the badge only fires for `live` rows. User wants the cancellation to behave like a status change: row flips to `declined`, reason text states the cancellation in Hebrew (`ההזמנה בוטלה`), and the mechanic sees a per-card unread indicator that clears when they tap the card. Live-row deletion behavior for non-accepted rows is correct as-is and should not change.

**What — backend.** In the stock-availability webhook handler, on `ActionType=8` or `9` for accepted rows, set `status='declined'` and `closed_reason='cancelled'` (or `'closed'`), and emit a Firestore signal that indicates an update needs mechanic attention. Decline-by-mechanic rows are not touched (the mechanic already saw them; nothing changed). Live rows: keep current delete behavior.

**What — frontend.** Persist an `unread` set client-side (localStorage keyed by `request_id`, or a Firestore-stored last-seen map) of cancelled-after-accept rows that the mechanic has not yet tapped. The dashboard Stock Availability tile shows the existing red dot when there is anything in the unread set, in addition to live rows. The Stock Availability page renders the cancelled-after-accept rows in the declined section with the Hebrew reason text. Tapping a card clears that card's entry from the unread set, which removes the dashboard tile dot once the set is empty.

**Files.** `backend/routers/webhooks.py:392-426` (the ActionType=8/9 branches). `frontend/src/app/components/StockAvailability.tsx` (status mapping, unread set, tap handler). `frontend/src/app/components/Dashboard.tsx:155-160` (tile badge sources include the unread set). `frontend/src/locales/he.json` (and `ar.json`, `ru.json`) for the cancellation reason text.

**Dependencies.** None.

**Acceptance.**
- A row the mechanic accepted, then Tafnit cancelled, appears on the Stock Availability page in the declined section with the cancellation reason visible.
- The dashboard Stock Availability tile shows the red dot while the cancelled row is unread.
- Tapping the card clears its unread state; the dashboard dot disappears once the unread set is empty.
- Live (not-yet-actioned) rows continue to delete on `ActionType=8/9` as today.
- Decline-by-mechanic rows are not affected by inbound cancellations.

---

## P1.4 Deploy Firestore rules to production project

**Why.** `firestore.rules` in the repo is correct (read scoped by `request.auth.token.shop_id` for orders, `erp_shop_id` for stock availability; writes denied). The `TODO(b2b)` marker is a reminder to actually deploy and verify them in the Firebase console — without the deploy, default rules may be more permissive than intended.

**What.** Run `firebase deploy --only firestore:rules` from the repo root. Open the Firebase console for the production project and verify the deployed rules match the file. Confirm that the custom token minted in `routers/auth.py:218-221` always carries `erp_shop_id` in production (user confirmed all live users have it).

**Files.** `firestore.rules` (no change).

**Dependencies.** Firebase CLI logged in with access to the production project.

**Acceptance.**
- Console shows the rules matching the committed file.
- A test read against `orders/{some_other_shop}/updates/...` from a signed-in mechanic of a different shop is denied.

---

## P1.5 Structured stdout logging (Cloud Run prep)

**Why.** Today `~/uvicorn.log` is appended forever on the VM. With 800–1200 mechanics generating verbose per-request logs, it fills the disk. Cloud Run does not have a persistent disk — anything written to a file is lost on scale-down. Solving both with one change: emit logs as one-line JSON to stdout. On the VM, redirect stdout to `~/uvicorn.log` (existing setup unchanged). On Cloud Run, Cloud Logging captures stdout automatically with no client integration.

**What.** Replace the current `log()` / `log_error()` helpers in `backend/logging_utils.py` with structured JSON-line output (timestamp, level, module, message, optional fields). Keep the function signatures so call sites don't change. Add `logrotate` on the VM as a stopgap so the redirected file doesn't grow unbounded between now and the Cloud Run cutover (one config file, hourly rotation if needed, keeps 7 days).

**Files.** `backend/logging_utils.py`. New `/etc/logrotate.d/tire-center` on the VM.

**Dependencies.** None.

**Acceptance.**
- Every backend log line is valid JSON parseable by `jq`.
- On the VM, `~/uvicorn.log` continues to receive the same data, now JSON-formatted, and `logrotate` keeps 7 days.
- On Cloud Run (after P2.5), Cloud Logging shows the same lines with structured fields queryable in the console.

---

# P2 — First month

## P2.1 Frontend dashboard re-fetch on mount + foreground

**Why.** Firestore signal writes in `backend/routers/webhooks.py:_firestore_signal` are fire-and-forget — exceptions are swallowed so a Firestore outage never breaks the webhook. The cost is that the mechanic's UI never receives the missed signal and sits on a stale view until they manually refresh. The cheapest robust solution is to make the frontend treat Postgres as the source of truth on every dashboard entry: re-fetch `/api/orders` and `/api/stock-availability/requests` on dashboard mount and on app foreground events.

**What.** Add a `visibilitychange` listener on the dashboard component that calls the existing fetch hooks whenever the app returns to foreground. The mount-time fetch already exists. Verify the same pattern applies to any other route where stale data is consequential (Open Requests list, in-flight order screen).

**Files.** `frontend/src/app/components/Dashboard.tsx`. The hooks in `StockAvailability.tsx` and `OpenRequests.tsx` already expose refresh functions or self-fetch; make sure they re-run on foreground.

**Dependencies.** None.

**Acceptance.**
- Disabling network or stopping the Firebase listener mid-session and then bringing the app back to foreground refreshes the dashboard tiles within ~1 second.
- The same applies to the Stock Availability and Open Requests pages.

---

## P2.2 Move `pending_logins` into `schema.sql`

**Why.** `routers/auth.py:43-71` runs `CREATE TABLE IF NOT EXISTS pending_logins ...` on every login. Functionally fine, but indicates there is no migration system. With production traffic, schema changes need a real story.

**What.** Move the `pending_logins` DDL into `backend/db/schema.sql`. Remove the lazy create from `_cache_pending_login`. Note in a follow-up that a real migrations tool (alembic, sqitch, etc.) should be introduced before any non-trivial schema evolution.

**Files.** `backend/db/schema.sql`. `backend/routers/auth.py:43-71`.

**Dependencies.** Run the new DDL on the production database once before deploying the code that depends on it.

**Acceptance.**
- `schema.sql` contains the `pending_logins` table definition.
- `routers/auth.py` no longer issues `CREATE TABLE IF NOT EXISTS`.
- Login flow continues to work end-to-end.

---

## P2.3 Move `erp_hash` from per-order column to shops table

**Why.** `open_orders.erp_hash` stores the per-shop session hash on every order row. The hash is the same for every order at a given shop in the same session; copying it onto each order makes credential rotation a multi-row update and means a DB read of any order leaks the active session. The right shape is a `shops` table keyed by `erp_shop_id`, with `erp_hash` and `last_login_at` columns. Order rows read the hash from the shops table at webhook time instead of carrying it.

**What.** Add a `shops` table to `schema.sql` (or migrate the existing one if it already exists — verify against the production DB). On successful login, upsert the row with the latest `erp_hash`. In webhook handlers (specifically `webhooks.py:518-526` and any other site that reads `erp_hash` from `open_orders`), look it up from `shops` by `erp_shop_id`. Drop the `erp_hash` column from `open_orders` once all readers are migrated.

**Files.** `backend/db/schema.sql`. `backend/routers/auth.py` (write to shops on verify). `backend/routers/webhooks.py:512-526` (read from shops in Carool webhook submit). Sweep any other reader of `open_orders.erp_hash`.

**Dependencies.** Backfill `shops` from existing `open_orders.erp_hash` data before the column drop.

**Acceptance.**
- A fresh login writes the hash to `shops`, not `open_orders`.
- All webhook paths that need `erp_hash` read it from `shops`.
- `open_orders.erp_hash` is dropped from the schema.
- A rotation (re-login) updates one row and is immediately visible to every in-flight order at that shop.

---

## P2.4 Critical-path integration tests + CI gate

**Why.** The only test file in the repo is `backend/test_erp_connection.py`, a connectivity smoke check. No frontend tests, no integration tests, no CI gate. At this scale, regressions on the diagnosis → ERP → webhook → status-flip cycle or the stock-availability state machine will hit production silently.

**What.** A minimum viable test suite focused on the highest-risk paths. Targets, written with pytest + httpx for backend and Vitest + React Testing Library for frontend:

- **Auth round trip.** Request-code → mock ERP OTP → verify → JWT issued with correct claims (shop_id, erp_hash, erp_shop_id, exp). Cookie set with right flags.
- **JWT expiry.** A token whose `exp` is in the past produces 401 on any protected route.
- **Stock availability state machine.** Live insert via webhook → mechanic approve → ack queue/task enqueued with correct params → Firestore signal `accepted_acked`. Same for decline. Transport-failure path through 30 attempts → `declined_failed` status + signal.
- **ERP webhook.** Approval payload flips status to approved; mixed payload flips to partly-approved; missing line is treated as declined.
- **Carool webhook.** Results posted → `diagnosis.carool_result` updated → `_submit_to_erp` invoked → status `waiting`.
- **Diagnosis direct submit.** Full payload → SOAP serializer receives the right shape → status `waiting`.
- **JSONB coercion edge cases.** `_coerce_jsonb` handles dict, string, None, malformed.
- **Frontend.** Login flow form validation + OTP submission. Stock Availability card renders correctly across all five statuses including the new cancelled-after-accept state. Order screen happy path. RTL/LTR direction switching.

Add a GitHub Actions (or equivalent) workflow that runs both suites on every PR and blocks merge on failure.

**Files.** New `backend/tests/` directory. New `frontend/src/__tests__/` (or co-located `*.test.tsx`). New CI config in `.github/workflows/` (or platform-equivalent).

**Dependencies.** Decision on CI platform (GitHub Actions vs Cloud Build vs other).

**Acceptance.**
- All listed tests run in CI on every PR and pass on `main`.
- Merging a PR with failing tests is blocked.

---

## P2.5 Cloud Run migration

**Why.** Single-VM topology is a single point of failure and a hard scale ceiling. Cloud Run gives autoscaling, managed TLS via Cloud Load Balancer, and zero-touch deploys. By the time this item is picked up, the codebase should be Cloud Run-ready (logs to stdout from P1.5, durable ack queue from P0.5, no in-process state).

**What.** Containerize the backend with a Dockerfile. Configure Cloud Run service with appropriate memory, concurrency, and min-instances settings (min-instances ≥ 1 to avoid cold-start lag on webhook traffic). Provision Cloud SQL for Postgres (or migrate the existing VM database) and connect via Cloud SQL Auth Proxy with a pooled client (asyncpg pool sized per max-instances × concurrency to stay under Postgres `max_connections`). Migrate secrets (already in Secret Manager) to be mounted as env vars in the Cloud Run service. Move the inbound webhook IP allowlist (P0.1) to the Cloud Load Balancer's backend service. Cut over DNS to the load balancer. Decommission nginx and the VM.

**Files.** New `backend/Dockerfile`. New `cloudbuild.yaml` or equivalent. Update `quick-tools.md` with the new deploy commands (or replace it entirely with a Cloud Run reference).

**Dependencies.** P0.5 (the in-process retry must already be queued, otherwise Cloud Run breaks correctness). P1.5 (stdout logging must already be in place). All P0 items completed and validated on the VM first.

**Acceptance.**
- Production traffic served by Cloud Run.
- `gcloud run deploy` is the deploy command; SSH-based deploy is gone.
- A deploy does not lose any in-flight stock-availability acks.
- Cloud Logging shows structured logs with the same fields as on the VM.

---

## P2.6 Export History orphan cleanup

**Why.** The Export History pill on the dashboard footer is already visually disabled with the "coming soon" badge — that part is done. What remains: the `ExportHistoryModal` component is still imported and rendered with `isOpen={isExportHistoryOpen}` state, and the backend stub `request_history_export` in `backend/adapters/erp.py:679-708` still returns True. If any code path reaches the modal or the endpoint, the user gets a silent success that is actually a no-op. Tidy up.

**What.** Remove the modal import and state from `Dashboard.tsx`. Either delete `ExportHistoryModal.tsx` entirely or leave it for the eventual phase-2 implementation but make sure no current code references it. On the backend, change `request_history_export` to return False (or raise NotImplementedError) so any stray caller fails visibly.

**Files.** `frontend/src/app/components/Dashboard.tsx`. `frontend/src/app/components/ExportHistoryModal.tsx` (delete or leave dormant). `backend/adapters/erp.py:679-708`. Any router that calls into the stub.

**Dependencies.** None.

**Acceptance.**
- No frontend code path opens `ExportHistoryModal` in the current build.
- Calling the backend export endpoint returns a recognizable not-implemented response, not a fake success.

---

# Open coordination items

These block the items above and need an external response or decision before code work can start.

- **Tafnit egress IP list** for P0.1. Owner: roi to obtain from Tafnit's ops contact.
- **ERP team confirmation** on SOAP update semantics for P1.1. Question: does `SendDiagnose` upsert lines on an existing `ApplyId`, or is there a separate update SOAP method? Without this, the send-then-update flow cannot be designed.
- **ERP team WSDL extension** for P1.2 v2 (option iii — dedicated `<tem:CaRoolPrediction>` element). Defer until Tafnit confirms.
- **CI platform decision** for P2.4. GitHub Actions, Cloud Build, or other.
- **Cloud Run cutover timing** for P2.5. Confirmed direction is "prepare for, do not execute yet" — decision on the actual cutover date pending.

---

# Closed during scan (verified, no action needed)

Items that surfaced during the audit and turned out to be already addressed in code, or rendered non-issues by user clarification:

- **CHANGELOG #3 (ReasonCode separate field).** Already wired in `backend/adapters/erp.py:454-457`. The CHANGELOG entry is stale.
- **b2b-context §9 #1 (stock-availability webhook shapes).** Fully implemented in `StockAvailabilityWebhookPayload` and the dispatch in `webhooks.py:309-432`.
- **b2b-context §9 #2 (decline-ack retry parameters).** 30 attempts, exponential backoff, `declined_failed` path, manual dismiss endpoint — all live in `stock_availability.py:17-105`.
- **b2b-context §9 #3 (unknown shop_id).** Trusted from Tafnit; 20-minute cancel/delete window self-cleans ghost rows.
- **b2b-context §9 #5 (navigation entry points).** Dashboard tile only, dashboard is always the back target. No settings-menu entry.
- **b2b-context §9 #7 (Carool ↔ Stock Availability collision).** Non-issue given the 20-minute Tafnit cancel window and the per-card unread indicator (P1.3) — mechanic sees the badge when they return to the dashboard.
- **TODO at `erp.py:583` (SendQueryResponse method name).** Implemented and in production use; the TODO is a marker for integration-week verification with Tafnit.
- **TODO at `firestore.rules:3` (rules confirmation).** Promoted to P1.4.
- **Login rate limiting.** Persistent sessions mean low login volume; ERP already rate-limits on its side.
- **Carool session timeout.** Superseded by P1.1 (send-then-update). The mechanic is no longer blocked on Carool latency.
- **`shops` table fallback for `erp_shop_id`.** Effectively dead code given the "all live users have erp_shop_id in JWT" guarantee. Leave as defense-in-depth or remove during P2.3.
