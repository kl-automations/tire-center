# API Endpoint Specification — Tire Center UI

All communication between the React app and the ERP passes through Supabase Edge Functions acting as a secure proxy.

**Base URL (Edge Functions):** `https://<project>.supabase.co/functions/v1`

> Field names marked with `*` are placeholders — exact names must be confirmed with the ERP team during integration.

---

## Shared Types

```typescript
// Tire position identifiers — used consistently across all endpoints
type TirePosition =
  | "front-right"
  | "front-left"
  | "rear-right"
  | "rear-left"
  | "rear-right-outer"   // 6-wheel vehicles only
  | "rear-right-inner"   // 6-wheel vehicles only
  | "rear-left-outer"    // 6-wheel vehicles only
  | "rear-left-inner"    // 6-wheel vehicles only

// All actions that can appear on a tire
type TireAction =
  | "replacement"
  | "sensor"
  | "tpms-valve"
  | "balancing"
  | "rim-repair"
  | "transfer"

type ReplacementReason = "wear" | "damage" | "fitment"

type ApprovalStatus = "approved" | "declined"
```

---

## Authentication Headers

All endpoints except `/auth` require both headers:

```
Authorization: Bearer <supabase_access_token>
X-ERP-Hash: <erp_hash>
```

The ERP hash is stored on the client after login and attached to every proxied request.

---

## 1. Authentication

### `POST /auth`

Validates user credentials against the ERP. On success, creates or retrieves the Supabase user session and returns both the Supabase session and the ERP hash.

**No auth headers required.**

#### Request
```json
{
  "username": "mech01",
  "password": "••••••••"
}
```

#### Response — Approved `200 OK`
```json
{
  "approved": true,
  "erp_hash": "a3f9c2d1e8b74056...",
  "tire_center_id": "hertz-tlv-01",
  "session": {
    "access_token": "<supabase_jwt>",
    "refresh_token": "<supabase_refresh_token>",
    "expires_at": null
  }
}
```

#### Response — Rejected `401 Unauthorized`
```json
{
  "approved": false
}
```

#### Notes
- The `erp_hash` must be stored in `localStorage` by the client and included as `X-ERP-Hash` on all subsequent requests
- The `tire_center_id` is embedded in the Supabase JWT claims — clients do not need to store it separately
- Session has no expiry; it remains valid until explicit logout

---

## 2. Car Lookup (Open Report)

### `POST /car`

Sends a license plate and mileage to the ERP. ERP returns whether the vehicle is recognized and, if so, its full tire configuration.

#### Request
```json
{
  "license_plate": "123-45-678",
  "mileage": 87450
}
```

> `tire_center_id` is NOT sent by the client — the Edge Function reads it from the JWT and adds it to the ERP call.

#### Response — Vehicle recognized `200 OK`
```json
{
  "recognized": true,
  "request_id": "req_a1b2c3d4",
  "ownership_id": "HERTZ",
  "tire_level": "premium",
  "wheel_count": 4,
  "tire_sizes": {
    "front": {
      "size": "205/55R16",
      "profile": "summer"
    },
    "rear": {
      "size": "205/55R16",
      "profile": "summer"
    }
  },
  "needs_carool": false,
  "last_mileage": 84200
}
```

#### Response — Vehicle not recognized `200 OK`
```json
{
  "recognized": false
}
```

> When `recognized: false`, the user can still proceed — the app opens a blank order with no pre-filled car data.

#### Response — Error `400 / 500`
```json
{
  "error": "invalid_plate"
}
```

#### Notes
- `tire_level` maps to the app's `QualityTier` type: `"chinese" | "upgraded" | "premium"`
- `wheel_count` is `4` or `6`
- `request_id` returned here is the ERP's identifier for this service visit; it must be stored in `open_orders` and included in the diagnosis submission

---

## 3. Diagnosis Submission

### `POST /diagnosis`

Sends the completed per-tire diagnosis to the ERP. ERP acknowledges receipt; approval/rejection arrives later via webhook.

#### Request
```json
{
  "request_id": "req_a1b2c3d4",
  "mileage_update": 87450,
  "front_alignment": true,
  "tires": {
    "front-right": [
      {
        "action": "replacement",
        "reason": "wear",
        "carool_status": "available",
        "carool_id": "crl_009"
      },
      {
        "action": "balancing"
      }
    ],
    "front-left": [
      {
        "action": "tpms-valve"
      }
    ],
    "rear-right": [
      {
        "action": "sensor"
      }
    ],
    "rear-left": [
      {
        "action": "transfer",
        "transfer_target": "rear-right"
      }
    ]
  }
}
```

#### Field reference
| Field | Type | Required | Description |
|---|---|---|---|
| `request_id` | string | yes | ERP request ID from car lookup |
| `mileage_update` | number | no | Updated mileage if changed since lookup |
| `front_alignment` | boolean | yes | Whether front alignment was performed |
| `tires` | object | yes | Map of tire position → array of actions |
| `action` | TireAction | yes | The work performed on that tire |
| `reason` | ReplacementReason | only for `replacement` | Why the tire was replaced |
| `carool_status` | string | only for `replacement` | Carool availability status |
| `carool_id` | string | only for `replacement` with carool | Carool unit identifier |
| `transfer_target` | TirePosition | only for `transfer` | Destination position |

#### Response — `200 OK`
```json
{
  "ack": true
}
```

#### Response — Error `400`
```json
{
  "error": "invalid_request_id"
}
```

#### Notes
- A tire position can have **multiple simultaneous actions** (e.g. replacement + balancing)
- `front_alignment` applies to the axle, not individual tires — sent once at the top level
- After a successful ack, the frontend sets the order status to `"waiting"` (pending ERP approval)

---

## 4. History Export

### `POST /history`

Requests the ERP to compile and email a historical report for the tire center.

#### Request
```json
{
  "date_from": "2025-01-01",
  "date_to": "2025-03-31",
  "email": "manager@hertz-tlv.co.il"
}
```

> `tire_center_id` is injected by the Edge Function from the JWT.

#### Response — `200 OK`
```json
{
  "ack": true
}
```

#### Notes
- The ERP sends the history directly to the provided email — no file passes through our system
- No further action required from the app after receiving `ack`

---

## 5. Inbound Webhook — Order Status Update

### `POST /webhook/order-status`

**Called by the ERP** when an order has been reviewed and approved or declined. The app never polls for status — all updates arrive through this endpoint.

#### Security
The ERP authenticates itself using the same hash mechanism as the frontend. Every webhook request must include:
```
X-ERP-Hash: <hash>
```
The hash was issued by the ERP at login and is stored server-side in Supabase. The Edge Function:
1. Looks up the hash in the `users` table
2. Confirms it belongs to the same `tire_center_id` that owns the `request_id` in the payload
3. Rejects with `401` if either check fails

No separate shared secret is needed — the ERP already holds the hashes it issued.

#### Request (sent by ERP)
```json
{
  "request_id": "req_a1b2c3d4",
  "status": "partly-approved",
  "front_alignment": "approved",
  "tires": {
    "front-right": {
      "replacement": "approved",
      "balancing": "approved"
    },
    "front-left": {
      "tpms-valve": "approved"
    },
    "rear-right": {
      "sensor": "declined"
    },
    "rear-left": {
      "transfer": "approved"
    }
  }
}
```

#### Field reference
| Field | Type | Description |
|---|---|---|
| `request_id` | string | Must match an existing `open_orders.id` |
| `status` | `"approved" \| "partly-approved" \| "declined"` | Overall order status |
| `front_alignment` | `ApprovalStatus` | Approval for alignment, if it was requested |
| `tires` | object | Map of tire position → map of action → approval status |

#### Response — `200 OK`
```json
{ "ack": true }
```

#### Response — Invalid hash or unknown request ID — `401`
```json
{ "error": "unauthorized" }
```

#### What happens after the webhook fires
1. Edge Function validates the hash and confirms it owns the `request_id`
2. Updates the matching `open_orders` row in Supabase (status + per-action approvals inside `diagnosis` JSONB)
3. Sets `declined_at` timestamp if `status === "declined"`
4. Supabase Realtime broadcasts the row change to all connected devices for that `tire_center_id`
5. All open browser tabs update the order status live with no user action required

---

## Open Questions for ERP Team

These must be resolved before integration begins:

| # | Question | Impact |
|---|---|---|
| 1 | What are the exact field names in ERP request/response bodies? | All proxy functions |
| 2 | What format is the `Authorization` header the ERP expects? (`Bearer <hash>`, custom header, etc.) | All proxy functions |
| 3 | What HTTP error codes and error body format does the ERP use? | Error handling in Edge Functions |
| 4 | Does the ERP retry webhook calls on non-200 responses? How many times, with what backoff? | Webhook reliability |
| 5 | What is the `tire_level` / `ownership_id` enum set from the ERP? | Car lookup response mapping |
| 6 | Does the login response include `tire_center_id`, or must it be pre-configured? | Auth flow |
| 7 | Does the ERP send a `carool_id` back on lookup, or only on diagnosis submission? | Carool flow |
| 8 | What is the ERP's base URL and any security requirements for inbound calls (IP allowlist, mTLS, API key, etc.)? | Network connectivity + ERP proxy security |
