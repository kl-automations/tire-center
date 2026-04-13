# Backend Plan — Tire Center UI

## Overview

The backend has two responsibilities:
1. **ERP Proxy** — securely forward the three outbound calls to the ERP and expose one inbound webhook for the ERP to push status updates
2. **Open Orders Store** — persist in-progress orders across devices and sessions, with live updates via Supabase Realtime

The ERP is the source of truth for all business data. Supabase holds only transient open order state.

---

## Tech Stack

| Layer | Technology | Reason |
|---|---|---|
| Frontend hosting | Vercel (free tier) | Zero-config Vite/React deployment, auto-deploys from GitHub |
| Backend functions | Supabase Edge Functions (Deno) | Co-located with DB, free tier sufficient, TypeScript-native |
| Database | Supabase PostgreSQL | Open orders table, RLS for multi-tenant isolation |
| Realtime | Supabase Realtime | Live order status updates pushed to all connected devices |
| Auth | Supabase Auth | Session management; ERP validates credentials, Supabase manages the session |
| Scheduled jobs | pg_cron (built into Supabase) | Midnight cleanup of declined orders |

---

## Environments

Two isolated environments, each is a separate Supabase project + Vercel deployment:

### Development (`tire-center-dev`)
- Used by developers only
- Contains fake/test data
- Safe to break, experiment freely
- Points to a separate Supabase project with its own database
- Configured via `.env.development`

### Production (`tire-center-prod`)
- The live app used by actual tire centers
- Never experiment here
- Configured via `.env.production` (secrets stored in Vercel environment variables, never committed to git)

**Environment variables (per environment):**
```
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=   # server-side only, never exposed to browser
ERP_BASE_URL=                 # ERP API base URL
# No separate webhook secret needed — ERP authenticates via the same hash issued at login
```

---

## Authentication & Session Design

### Flow

```
User enters username + password
        │
        ▼
POST /api/auth  (Edge Function)
        │
        ├──► Forward credentials to ERP /auth
        │
        │    ERP returns: { approved: true, hash: "abc123", tire_center_id: "hertz-tlv-01" }
        │    or:          { approved: false }
        │
        ├── On approval:
        │     1. Upsert Supabase Auth user  (email = username@internal, not visible to user)
        │     2. Embed tire_center_id in user JWT custom claims
        │     3. Return Supabase session token + ERP hash to frontend
        │
        └── On rejection: return 401
```

### Session Storage
- **Supabase session token** — managed automatically by `@supabase/supabase-js`, persisted in localStorage (frontend)
- **ERP hash** — stored in **both** localStorage (client, for outbound calls) **and** in Supabase user `app_metadata` (server-side, for inbound webhook validation)
- **tire_center_id** — embedded in the Supabase JWT claims, no need to store separately

The hash must be stored server-side because the ERP includes it when calling the webhook — the Edge Function validates it against the stored value to authenticate inbound requests without a separate shared secret.

### Session Expiry & Logout
- Supabase session: configured to never expire (refresh token rotation enabled, no hard expiry)
- ERP hash: no expiry — treated as valid until the user manually logs out
- **On logout:**
  1. Call `supabase.auth.signOut()` — invalidates the Supabase session server-side
  2. Delete `erp_hash` from localStorage
  3. Redirect to login screen
- **Risk note:** If a device is stolen while logged in, the ERP hash cannot be remotely invalidated (the ERP has no logout endpoint). Mitigation: recommend users log out on shared devices. This is an acceptable risk for this use case.

---

## Multi-Tenant & Multi-Device Architecture

### Shared Queue per Tire Center
All users belonging to the same tire center see and share the same order queue. Identity is at the `tire_center_id` level, not the individual user level.

```
User A (mechanic)  ─┐
User B (mechanic)  ─┼──► tire_center_id: "hertz-tlv-01" ──► shared open_orders rows
User C (manager)   ─┘

User D (different tire center) ──► tire_center_id: "hertz-jlm-02" ──► their own rows only
```

### Row Level Security (RLS)
Enforced at the database level — no application-layer bug can leak cross-tenant data.

```sql
-- Users can only access rows belonging to their tire_center_id
CREATE POLICY "tire_center_isolation" ON open_orders
  USING (
    tire_center_id = (auth.jwt() -> 'app_metadata' ->> 'tire_center_id')
  );
```

The `tire_center_id` is embedded in the user's JWT `app_metadata` at login time by the Edge Function using the service role key.

### Live Multi-Device Updates (Realtime)
When any row in `open_orders` changes (e.g. ERP pushes an approval via webhook), all connected devices for that tire center receive the update instantly via WebSocket — no polling, no refresh needed.

Frontend subscription (scoped to the current tire center automatically via RLS):
```typescript
supabase
  .channel('open_orders_changes')
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'open_orders'
  }, (payload) => {
    // update UI state with payload.new
  })
  .subscribe()
```

---

## Database Schema

### `open_orders` table

```sql
CREATE TABLE open_orders (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tire_center_id   text NOT NULL,
  license_plate    text NOT NULL,
  plate_type       text NOT NULL,                    -- 'civilian' | 'military' | 'police'
  mileage          integer,
  car_data         jsonb,                            -- full ERP response from car lookup
  diagnosis        jsonb,                            -- Record<string, WheelWork> from frontend types
  status           text NOT NULL DEFAULT 'waiting',  -- 'waiting' | 'approved' | 'partly-approved' | 'declined'
  declined_at      timestamptz,                      -- set when status becomes 'declined'
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE open_orders ENABLE ROW LEVEL SECURITY;

-- Isolation policy
CREATE POLICY "tire_center_isolation" ON open_orders
  USING (tire_center_id = (auth.jwt() -> 'app_metadata' ->> 'tire_center_id'));

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON open_orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

### Indexes
```sql
CREATE INDEX idx_open_orders_tire_center ON open_orders (tire_center_id);
CREATE INDEX idx_open_orders_status      ON open_orders (status);
CREATE INDEX idx_open_orders_declined_at ON open_orders (declined_at) WHERE declined_at IS NOT NULL;
```

---

## Edge Functions (API Endpoints)

All functions are deployed as Supabase Edge Functions (Deno/TypeScript). The frontend calls them via the Supabase client or direct fetch.

### `POST /api/auth`
**Purpose:** Proxy login to ERP, create/update Supabase user, return session

**Request:**
```typescript
{ username: string, password: string }
```

**Logic:**
1. Forward to ERP auth endpoint
2. If rejected → return `401`
3. If approved:
   - Use service role key to upsert Supabase user (`email = username@internal`)
   - Set `tire_center_id` in user `app_metadata`
   - Generate and return a Supabase session (access token + refresh token)
   - Return `erp_hash` alongside the session

**Response:**
```typescript
{
  session: SupabaseSession,
  erp_hash: string,
  tire_center_id: string
}
```

---

### `POST /api/car`
**Purpose:** Look up car data from ERP by license plate

**Request:**
```typescript
{
  license_plate: string,
  mileage: number
}
```

**Auth:** Requires valid Supabase JWT + ERP hash in headers

**Logic:**
1. Validate Supabase JWT (middleware)
2. Extract `tire_center_id` from JWT claims
3. Forward `{ tire_center_id, license_plate, mileage }` to ERP
4. Return ERP response as-is

**Response:** Car data object from ERP (tire sizes, wheel count, carool status, etc.)

---

### `POST /api/diagnosis`
**Purpose:** Submit completed diagnosis to ERP

**Request:**
```typescript
{
  request_id: string,       // open_orders.id
  mileage_update?: number,
  front_alignment: boolean,
  wheels: Record<string, {
    action: string,
    reason?: string,
    carool_status?: string,
    carool_id?: string
  }>
}
```

**Auth:** Requires valid Supabase JWT + ERP hash

**Logic:**
1. Validate Supabase JWT
2. Confirm `request_id` exists and belongs to caller's `tire_center_id` (prevents spoofing)
3. Forward diagnosis to ERP
4. On `200 OK` from ERP: update `open_orders.status = 'waiting'` (awaiting ERP approval)
5. Return ack to frontend

---

### `POST /api/history`
**Purpose:** Request historical export from ERP (ERP emails it directly)

**Request:**
```typescript
{
  date_from: string,   // ISO date
  date_to: string,
  email: string
}
```

**Auth:** Requires valid Supabase JWT + ERP hash

**Logic:**
1. Validate JWT, extract `tire_center_id`
2. Forward `{ tire_center_id, date_from, date_to, email }` to ERP
3. Return ack

---

### `POST /api/webhook/order-status`  ← ERP calls this
**Purpose:** Receive status updates pushed by ERP when an order is approved/declined

**Security:**
- ERP must include header: `X-Webhook-Secret: <shared_secret>`
- Edge Function validates the hash against the value stored in Supabase `app_metadata` for that user
- The `request_id` in the payload must exist in `open_orders` (double validation)
- If either check fails → return `401`, log the attempt

**Request (from ERP):**
```typescript
{
  request_id: string,
  status: 'approved' | 'partly-approved' | 'declined',
  wheels: Record<string, {
    approved: boolean
  }>,
  front_alignment_approved?: boolean
}
```

**Logic:**
1. Validate `X-Webhook-Secret` header
2. Look up `request_id` in `open_orders` (using service role key to bypass RLS)
3. Update row: `status`, per-wheel approvals inside `diagnosis` jsonb, `declined_at` if applicable
4. Supabase Realtime automatically pushes the change to all subscribed clients
5. Return `200 OK` to ERP

---

## Order Lifecycle & Cleanup

### Status Flow
```
[created] waiting ──► [diagnosis submitted] waiting ──► [ERP webhook] approved
                                                      └──► partly-approved
                                                      └──► declined
```

### Cleanup Rules
- **Declined orders where `declined_at < 16:00` on that day** → automatically deleted at `00:00`
- **All other orders** (approved, partly-approved, pending, or declined after 16:00) → deleted only via the manual "close" button in the UI

### Scheduled Job (pg_cron)
Runs at midnight every day inside the Supabase database:

```sql
SELECT cron.schedule(
  'cleanup-declined-orders',
  '0 0 * * *',   -- every day at 00:00
  $$
    DELETE FROM open_orders
    WHERE
      status = 'declined'
      AND declined_at::date = CURRENT_DATE - INTERVAL '1 day'
      AND declined_at::time < '16:00:00';
  $$
);
```

No external cron service needed — pg_cron is built into Supabase.

---

## Frontend Integration Points

Changes needed in the existing React app once backend is ready:

| Current (mock) | Replace with |
|---|---|
| Hardcoded `MOCK_REQUESTS` in `OpenRequests.tsx` | Supabase query on `open_orders` table |
| `sessionStorage` for open requests | Supabase real-time subscription |
| Login form does nothing | Calls `POST /api/auth`, stores session + erp_hash |
| License plate lookup does nothing | Calls `POST /api/car`, writes result to `open_orders` |
| Diagnosis submit does nothing | Calls `POST /api/diagnosis` |
| History export modal does nothing | Calls `POST /api/history` |
| No live status updates | Realtime subscription updates order status in place |

### Frontend API Client Structure
```
src/
└── lib/
    ├── supabase.ts          # Supabase client init (reads env vars)
    ├── api/
    │   ├── auth.ts          # login(), logout()
    │   ├── car.ts           # lookupCar()
    │   ├── diagnosis.ts     # submitDiagnosis()
    │   └── history.ts       # exportHistory()
    └── hooks/
        └── useOpenOrders.ts # Supabase query + realtime subscription combined
```

---

## Open Questions (to resolve with ERP team)

These do not block frontend development but must be resolved before ERP integration:

1. **ERP base URL and auth header format** — does the hash go in `Authorization: Bearer <hash>` or a custom header?
2. **Exact request/response payload shapes** — field names, date formats, error codes
3. **ERP webhook retry behavior** — if our webhook returns a non-200, will the ERP retry? How many times?
4. **Shared webhook secret value** — agree on this with ERP team and store in both systems before go-live
5. **Does the ERP return `tire_center_id` in the login response?** — if not, it must be pre-configured or the login must be adjusted

---

## Implementation Order

1. **Supabase project setup** — create dev project, apply schema, enable RLS, enable Realtime on `open_orders`
2. **Auth Edge Function** — unblocks everything else; can be tested with a mock ERP response
3. **Frontend auth integration** — replace login mock with real call, store session
4. **Supabase client + `useOpenOrders` hook** — replace mock data with real DB reads + realtime
5. **Car lookup Edge Function + frontend** — license plate flow end-to-end
6. **Diagnosis Edge Function + frontend** — submission flow end-to-end
7. **Webhook Edge Function** — implement and test with a manual POST before ERP is ready
8. **History export Edge Function + frontend** — simplest integration
9. **pg_cron cleanup job** — schedule and verify
10. **Production environment setup** — mirror dev config in prod, set env vars in Vercel
