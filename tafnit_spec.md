# Tafnit ERP — Integration Spec

This document describes how Tafnit communicates — the transport layer, envelope structure, auth pattern, data conventions, and webhook shape. Its purpose is to give a new backend enough context to integrate with Tafnit correctly from day one, without needing to reverse-engineer their patterns through trial and error.

---

## 1. Transport

| Property | Value |
|---|---|
| Protocol | HTTPS |
| Port | **22443** (non-standard — not 443) |
| Base URL | `https://tet.kogol.co.il:22443/csp/bil/Diagnose.Webservices.cls` |
| SOAP version | 1.1 |
| SSL cert | Self-signed on the test environment — SSL verification must be disabled for dev |
| Timeout | 15 seconds is safe; ERP calls can be slow |

**Critical:** The WSDL advertises port 443, but the actual service only listens on **22443**. Always hit the endpoint URL directly — never derive it from the WSDL port binding.

---

## 2. SOAP Envelope Structure

Every call follows standard SOAP 1.1. Namespace is `http://tempuri.org`.

```xml
<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope
  xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:tem="http://tempuri.org">
  <soap:Body>
    <tem:MethodName>
      <!-- method parameters here -->
    </tem:MethodName>
  </soap:Body>
</soap:Envelope>
```

**Required HTTP headers on every request:**
```
Content-Type: text/xml; charset=utf-8
SOAPAction: "http://tempuri.org/MethodName"
```

**Do not use a SOAP library that fetches the WSDL at startup** — the WSDL is on port 443 which is firewalled. Build envelopes by hand and parse responses with an XML library.

---

## 3. Auth Pattern

Tafnit uses a **two-step OTP login**, after which a session hash (`erp_hash`) is stored and sent as the `password` field on every subsequent call.

### Step 1 — Request OTP: `IsValidUser`
```xml
<tem:userCode>SHOP_ID</tem:userCode>
```
Tafnit sends an OTP SMS to the user's registered phone. Returns `ReturnCode=1` on success.

### Step 2 — Verify OTP: `Login`
```xml
<tem:userCode>SHOP_ID</tem:userCode>
<tem:password>OTP_CODE</tem:password>
```
Returns `ReturnCode=1` on success. The `password` confirmed here becomes the `erp_hash` used in all future calls for this session.

### Authenticated calls
Every subsequent method call includes:
```xml
<tem:userCode>SHOP_ID</tem:userCode>
<tem:password>ERP_HASH</tem:password>
```
There is no Bearer token or API key — credentials are always passed inline in the SOAP body.

---

## 4. ReturnCode Convention

Tafnit uses a `ReturnCode` field in every response. The values are **strings, not integers**.

| ReturnCode | Meaning |
|---|---|
| `"1"` | Success / accepted |
| `"2"` | Entity already exists (e.g. an open request already exists for this vehicle) — treat as success in most cases |
| `"0"` | Failure — check `ReturnMessage` for the reason |
| anything else | Treat as failure |

`ReturnMessage` carries human-readable error text when `ReturnCode != "1"`. On some methods it carries a data value (see `GetLastMileage` below).

---

## 5. SOAP Methods (Outbound — We Call Tafnit)

### `Apply` — Open a service order / look up a vehicle

```xml
<tem:userCode>SHOP_ID</tem:userCode>
<tem:password>ERP_HASH</tem:password>
<tem:CarNumber>LICENSE_PLATE</tem:CarNumber>
<tem:KM>50000</tem:KM>
```

**Response fields:**

| Field | Type | Notes |
|---|---|---|
| `ReturnCode` | string | `"1"` = new order, `"2"` = existing order already open |
| `ApplyId` | string | ERP's reference ID for this service visit — store this, it's used in all subsequent calls |
| `CarModel` | string | Vehicle make/model |
| `Company` | string | Ownership / fleet company |
| `LastMileage` | string (int) | Last odometer reading on file |
| `FrontTireSize` | string | e.g. `"215/65R17"` |
| `RearTireSize` | string | |
| `TireLevel` | string (int) | Tyre quality tier |
| `WheelCount` | string (int) | Number of road wheels (4 or 6) |
| `CaroolNeeded` | string bool | `"true"` / `"false"` — whether AI photo analysis is required |
| `DiagnosisLines` | XML children | Present when `ReturnCode="2"` — existing open diagnosis lines for this visit |

**When `ReturnCode="2"`**, the response includes existing `DiagnosisLine` children inside a `DiagnosisLines` element. Each line has:
- `ActionCode` (int)
- `ReasonCode` (int)
- `TireLocation` (int — see location codes below)

---

### `GetLastMileage` — Fetch last odometer reading (pre-check)

```xml
<tem:userCode>SHOP_ID</tem:userCode>
<tem:password>ERP_HASH</tem:password>
<tem:CarNumber>LICENSE_PLATE</tem:CarNumber>
```

**Quirk:** The mileage value is returned in `ReturnMessage`, not in a dedicated field.

| Field | Notes |
|---|---|
| `ReturnCode` | `"1"` = has history, anything else = no history on file |
| `ReturnMessage` | The last mileage value as a string integer (e.g. `"100000"`) |
| `AdditionalData` | Maximum allowed mileage for this vehicle — null means no limit |

---

### `SendDiagnose` — Submit completed diagnosis

This is the most complex call. It sends a flat list of `DiagnosisLine` elements inside a `Diagnosis` wrapper.

```xml
<tem:userCode>SHOP_ID</tem:userCode>
<tem:password>ERP_HASH</tem:password>
<tem:CarNumber>LICENSE_PLATE</tem:CarNumber>
<tem:ApplyId>99911510</tem:ApplyId>
<tem:Diagnosis>
  <tem:UserMileage>50000</tem:UserMileage>
  <tem:DiagnosisLines>
    <tem:DiagnosisLine>
      <tem:ActionCode>3</tem:ActionCode>
      <tem:ReasonCode>30</tem:ReasonCode>
      <tem:TireLocation>1</tem:TireLocation>
      <tem:CaRoolStatus>0</tem:CaRoolStatus>
      <tem:CaRoolId></tem:CaRoolId>
      <tem:Remarks></tem:Remarks>
      <tem:IsApproved>false</tem:IsApproved>
    </tem:DiagnosisLine>
    <!-- one element per (wheel × action) -->
  </tem:DiagnosisLines>
</tem:Diagnosis>
```

**DiagnosisLine fields:**

| Field | Type | Notes |
|---|---|---|
| `ActionCode` | int | ERP action code (see codes section below) |
| `ReasonCode` | int | ERP reason code, `0` when not applicable |
| `TireLocation` | int | Wheel position code (see location codes below) |
| `CaRoolStatus` | string | `"1"` if a Carool AI session exists, `"0"` otherwise |
| `CaRoolId` | string | Carool session ID, empty string when not applicable |
| `Remarks` | string | Free-text note per line (e.g. mileage override annotation) |
| `IsApproved` | bool string | Always `false` when submitting — approval comes back via webhook |

**Field name gotcha:** The mileage field inside `<Diagnosis>` is `<UserMileage>`, not `<LastMileage>`. Using the wrong name causes the ERP to silently ignore the value.

**Response:** Only `ReturnCode`. `"1"` = accepted.

---

### `SendQueryResponse` — Stock-availability mechanic response (**proposed / unconfirmed**)

> **Status:** Method name, namespace, and parameter names are **not yet confirmed** by Tafnit — treat as a working proposal until integration week (see open questions in `b2b-context.md` §9).

Mechanic approve/decline for a red-route stock query is acked with this outbound SOAP call. Auth matches every other authenticated method: `userCode` / `password` from the session (`shop_id` + `erp_hash`).

**Proposed request body:**

| XML element | Type | Notes |
|---|---|---|
| `userCode` | string | Shop / mechanic id (same as other calls) |
| `password` | string | `erp_hash` from `Login` |
| `ApplyId` | int | Numeric form of the inbound stock webhook `RequestId` |
| `TireShopCode` | int | Numeric shop scope — same value as `IsValidUser` → `AdditionalData` (`erp_shop_id` in our JWT) |
| `Response` | int | `1` = approve (in stock), `2` = decline |

**ReturnCode:** The response includes the usual `ReturnCode` string field; log it for ops visibility.

**Ack semantics in this codebase:** Any completed HTTP round-trip counts as “acked” for UI follow-up (Firestore `*_acked` signals). **Do not** branch retry logic on `ReturnCode`. **Only** transport-layer failures (`httpx` request errors — connection, timeout, etc.) trigger backoff retries. A SOAP fault or HTTP error **body** still counts as a received response for that rule-set.

---

## 6. Inbound Webhook (Tafnit Calls Us)

After the garage manager approves or declines a diagnosis in the ERP, Tafnit fires a `POST` to our backend. This is a **JSON webhook**, not SOAP.

### Endpoint we expose:
```
POST /api/webhook/erp
Content-Type: application/json
```

### Payload shape:
```json
{
  "request_id": "99911510",
  "DiagnoseData": [
    {
      "Action": "3",
      "Reason": "30",
      "Location": "1",
      "Remarks": "optional free text",
      "Confirmed": "1"
    }
  ]
}
```

**Field notes:**

| Field | Type | Notes |
|---|---|---|
| `request_id` | string | Matches the `ApplyId` from the `Apply` call — always a string even though it looks like a number |
| `Action` | string | ERP action code as string |
| `Reason` | string | ERP reason code as string, `"0"` when not applicable |
| `Location` | string | Wheel position code as string (see location codes below) |
| `Remarks` | string | Manager's free-text note |
| `Confirmed` | string | `"1"` = approved, `"0"` = declined |

**Critical:**
- `request_id` is always a **string** — do not type it as int in your schema or Pydantic will reject valid payloads
- `DiagnoseData` contains **only the lines the manager acted on** — lines not present were not approved. Treat any submitted line absent from the response as declined
- The ERP may send non-UTF-8 bytes in `Remarks` — decode with `errors='replace'`
- The ERP may include extra fields in `DiagnoseData` items — use `extra='ignore'` in your schema

### Deriving overall status from the webhook:
Cross-reference `DiagnoseData` against what was originally submitted:
- All submitted lines confirmed → `approved`
- All submitted lines declined or absent → `declined`
- Mix → `partly-approved`

Always respond with `HTTP 200`. The ERP does not retry on 200; non-200 responses may cause repeated delivery.

---

## 7. Location Codes (Wheel Positions)

| ERP Code | Wheel Position |
|---|---|
| `1` | front-left |
| `2` | front-right |
| `3` | rear-right |
| `4` | rear-left |
| `5` | spare-tire |
| `6` | no location (used for front alignment) |
| `7` | rear-left-inner (heavy vehicles) |
| `8` | rear-right-inner (heavy vehicles) |

Location `6` is a special value meaning "no specific wheel" — used exclusively for the front-alignment line in `SendDiagnose` and the corresponding webhook response.

---

## 8. Action & Reason Codes

Codes are integers in outbound SOAP calls and string integers in inbound webhook fields. The canonical list lives in the `erp_action_codes` and `erp_reason_codes` database tables — do not hardcode them. As of the current integration the live values are:

**Actions:**

| Code | Meaning (Hebrew) |
|---|---|
| 1 | תיקון תקר — Puncture repair |
| 2 | העברה — Tyre relocation |
| 3 | החלפת צמיג — Tyre replacement |
| 5 | יישור ג'אנט — Rim straightening |
| 6 | כיוון פרונט — Front alignment |
| 7 | איזון גלגלים — Wheel balancing |
| 8 | שסתום — Valve |
| 9 | חיישן — TPMS sensor |

**Reasons** (all currently linked to action 3 — replacement):

| Code | Meaning |
|---|---|
| 30 | בלאי — Wear |
| 40 | נזק — Damage |
| 50 | התאמה — Fitment/size |

Tafnit may add or change codes. Always sync from `GetActionTable` / `GetReasonTable` SOAP methods rather than hardcoding.

---

## 9. Encoding & XML Escaping

- All SOAP envelopes must be UTF-8 encoded
- User-supplied values embedded in XML must be XML-escaped (`&` → `&amp;`, `<` → `&lt;`, etc.)
- When parsing inbound webhook bodies, decode with `errors='replace'` — Tafnit sometimes sends non-UTF-8 bytes in free-text fields like `Remarks`

---

## 10. Known Quirks & Things That Will Break Without This Knowledge

1. **Port 22443** — not 443. Every HTTPS client config must specify the port explicitly.
2. **WSDL is unreachable at runtime** — do not fetch it on startup; build envelopes manually.
3. **`ReturnCode` is always a string** — never compare `== 1` (int); always `== "1"` (string).
4. **`ReturnCode="2"` is success** — an existing open order must be accepted and its existing lines surfaced to the user, not treated as an error.
5. **`request_id` in the webhook is a string** — even though it looks numeric (`"99911510"`). Typing it as `int` in a Pydantic schema will reject valid payloads.
6. **`UserMileage` not `LastMileage`** — the mileage field inside `SendDiagnose > Diagnosis` is named `UserMileage`. `LastMileage` is silently ignored.
7. **`GetLastMileage` returns mileage in `ReturnMessage`** — not in a dedicated element.
8. **Absent webhook lines = declined** — the ERP only echoes back lines that were acted on. Missing lines must be treated as declined by the receiving backend.
9. **`IsApproved` is always `false` on submission** — approval is a manager action that comes back via webhook only.
10. **SSL cert is self-signed** on test environment — disable SSL verification for dev, enable for production once a valid cert is in place.
