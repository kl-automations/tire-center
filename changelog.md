# Changelog

> This file is the living state of the project. Every coder session must update it before closing — mark completed items done, move items between sections, update the state summary. PM sessions read it at the start to understand current context before producing briefs.

---

## Current version: v1.1.8

---

## Project state (summary)

Stock Availability (Phase 1) is live and end-to-end functional — Tafnit is sending webhooks, mechanics can approve and decline, retry loop and 15s auto-dismiss are wired. Dashboard has all three new tiles (Stock Availability live, Demand Overview and Monthly Receipt as placeholders).

Carool flow is functional but has three known issues that need to be addressed (see In Progress below).

---

## In progress

- **Carool: ERP submission must wait for Carool webhook** — currently `POST /api/carool/finalize` and `POST /api/diagnosis` are independent, so ERP can be called before Carool results arrive. The correct flow is to block ERP submission until the Carool webhook fires for the specific order. Blocked by test environment not firing real webhooks.
- **Carool: results not included in ERP diagnosis submission** — when sending to ERP, only `CaRoolId` and `CaRoolStatus` are sent per line. The full `carool_result` from `open_orders.diagnosis` is not forwarded. Pending confirmation from ERP team on whether they need the full prediction data or just the reference.
- **ERP: ReasonCode field not correctly separated** — WSDL was updated to have a separate `ReasonCode` field alongside `ActionCode` on each `DiagnosisLine`. Backend is not yet sending the right values in the right fields.

---

## Backlog

_(Items queued but not started — update this section as tasks are assigned)_

---

## Recently completed

- **Viewport-fit revert + scroll fallback** — Restored HEAD no-scroll layout structure and compact spatial sizing (padding, gaps, touch targets, diagram max-width) on Dashboard, AcceptedRequest, TirePopup, ConfirmModal, DeclinedRequest, LicensePlateModal, and CaroolCheck while keeping the mobile font-size readability bumps from the sizing pass. Added `useViewportFit` hook: per-screen measurement via ResizeObserver and `visualViewport` resize; when content exceeds `100dvh` (e.g. Samsung Internet persistent bottom chrome), pinned screens switch to `overflow-y-auto` without clipping submit buttons. CaroolCheck excluded (camera overlay layout).
- **Login: OTP SMS chip DOM sync (Brief 9)** — 250ms poll on OTP step reads `input.value` into React state when Chrome’s heuristic SMS chip fills the DOM without firing `onChange`; keeps controlled input in sync until Tafnit origin-bound SMS enables Web OTP as primary path.
- **Login: strip user-code whitespace + Web OTP API (Brief 8)** — user code input strips all `\s` on change/paste; OTP step registers `navigator.credentials.get` with SMS transport (abort on leave), auto-fills and submits when code field still empty. Android silent fill needs Tafnit SMS origin suffix (follow-up with Tafnit).
- **Dashboard cleanup (Brief 7)** — removed "Choose Action" h2; `100dvh` column with pinned footer for Export History pill; `dashboard.title` aligned to index.html ("מרכז שירות קוגול" / service-center wording in ar/ru); removed unused `chooseAction` locale keys
- **Order screen: pin header + submit, scroll middle (Brief 6)** — `AcceptedRequest` uses three-section layout (`shrink-0` header, `flex-1 min-h-0 overflow-y-auto` middle, pinned submit); wheel diagram `max-w-[200px]`, tighter card padding; no other route pages matched the old `justify-between` pattern
- **Dashboard: remove stat badges, shrink tile heights (Brief 5)** — removed approved/waiting/declined stat boxes from Open Requests tile (green dot only); mobile `min-h` back to 96px on all five tiles; Brief 3 text/icon sizes unchanged
- **Polish pass (Brief 4)** — SOAP first-attempt timeout logs at INFO with retry wording; Carool wheel/step labels reduced; Dashboard Open Requests badge labels and OpenRequests filter chip labels bumped to `text-sm`; Stock Availability card `min-h` aligned to 200px
- **Mobile-only sizing pass** — bumped mobile-default Tailwind text, padding, touch targets, and card heights across dashboard, list screens, login, modals, Carool controls, and order flow; Open Requests stat badges visible on mobile; desktop `sm:` breakpoints unchanged
- **Stock Availability: retry give-up manual dismiss** — after 30 transport failures on decline ack, row moves to `declined_failed`, Firestore signals mechanic; manual dismiss endpoint closes row; error UI with `ack_failed_message`
- **Open requests: tire quality in expanded row** — `useCodes()` loads `tire_levels` from `/api/codes`; expanded inline detail shows ERP tire-level description from `car_data.TireLevel`. Removed unused `RequestDetail` screen and `/open-requests/:id` route. `car.py`: inlined `asyncio.create_task` for stock auto-approve (removed sync wrapper).
- **Stock Availability: auto-approve on car lookup** — `POST /api/car` success (reuse, request_id match, fresh insert) accepts live stock requests for that plate at the shop, signals Firestore, and acks Tafnit (Response=1) in the background
- Stock Availability page — full Phase 1 flow live (inbound webhook, approve, decline with retry loop, 15s auto-dismiss, Firestore signals, Tafnit ack)
- Dashboard three-tile layout — Stock Availability live, Demand Overview and Monthly Receipt as non-clickable placeholders with coming-soon copy
- Quality tier translation fix
- Diagnosis and webhooks bug fixes

---

## Known issues

- See "In progress" for Carool issues.
- Open questions (contracts, edge cases not yet resolved) are tracked in `b2b-context.md` §9 — touch any of them in code and leave a `TODO(b2b)` comment.