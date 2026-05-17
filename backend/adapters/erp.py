"""
ERP adapter — ALL ERP SOAP calls live here.

This is the single file that changes when the ERP team finalises field names,
method signatures, or authentication details. Routes, DB logic, and JWT
handling are entirely isolated from ERP specifics.

Auth flow (two-step OTP):
  1. request_otp(user_code)       → IsValidUser SOAP call → ERP sends OTP via SMS
  2. verify_login(user_code, otp) → Login SOAP call       → confirms OTP, grants access

Stub status:
  - request_otp / verify_login    → LIVE (call real ERP SOAP)
  - lookup_car                    → LIVE (call real ERP SOAP)
  - get_last_mileage              → LIVE (call real ERP SOAP)
  - submit_diagnosis              → LIVE (call real ERP SOAP)
  - send_query_response           → LIVE (stock-availability ack to Tafnit)
  - request_history_export        → STUB (always returns True)
  Replace stubs with real SOAP calls once the ERP team confirms method signatures.

Implementation note:
  This module talks to the ERP using raw SOAP 1.1 envelopes posted via
  httpx.AsyncClient — no SOAP library, no WSDL fetch. A blocking SOAP
  client would stall the FastAPI event loop under concurrency, so we
  build envelopes by hand and parse responses with xml.etree. The
  endpoint URL is hit directly so the WSDL's port-443 binding (firewall
  only allows 22443) is never consulted.
"""

import html
import os
import xml.etree.ElementTree as ET
from xml.sax.saxutils import escape

import httpx

from logging_utils import log, log_error

# ── SOAP constants ────────────────────────────────────────────────────────────

_ENDPOINT_URL = "https://tet.kogol.co.il:22443/csp/bil/Diagnose.Webservices.cls"
_NAMESPACE    = "http://tempuri.org"
_SOAP_ENV_NS  = "http://schemas.xmlsoap.org/soap/envelope/"
_TIMEOUT_S    = 15.0

_LOCATION_TO_WHEEL = {
    "1": "front-left",
    "2": "front-right",
    "3": "rear-right",
    "4": "rear-left",
    "5": "spare-tire",
    "7": "rear-left-inner",
    "8": "rear-right-inner",
}


# ── httpx client (lazy singleton) ─────────────────────────────────────────────

_client: httpx.AsyncClient | None = None


async def _get_http_client() -> httpx.AsyncClient:
    """
    Return a process-wide httpx.AsyncClient, creating it on first use.

    SSL verification is off by default for the test environment (self-signed
    cert on the ERP server). Set ERP_SSL_VERIFY=true once a valid certificate
    is in place. The endpoint URL can be overridden via ERP_ENDPOINT_URL for
    staging / production targets.

    The client is shared across all calls so connections are pooled and TLS
    handshakes are reused — much faster than spinning up a fresh client per
    call. No lock is needed: FastAPI runs on a single-threaded event loop,
    so the ``if _client is None`` check and the assignment below run
    atomically with respect to other coroutines (no await between them).
    """
    global _client
    if _client is None:
        ssl_verify = os.environ.get("ERP_SSL_VERIFY", "false").lower() == "true"
        _client = httpx.AsyncClient(verify=ssl_verify, timeout=_TIMEOUT_S)
        log("ADAPTER/erp", f"httpx.AsyncClient ready ssl_verify={ssl_verify}")
    return _client


async def close_http_client() -> None:
    """Close the shared httpx client. Call from FastAPI's lifespan shutdown."""
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None
        log("ADAPTER/erp", "httpx.AsyncClient closed")


# ── SOAP envelope builder + response wrapper ─────────────────────────────────

_ENVELOPE_TEMPLATE = (
    '<?xml version="1.0" encoding="utf-8"?>'
    '<soap:Envelope xmlns:soap="{soap_ns}" xmlns:tem="{tem_ns}">'
    '<soap:Body>{body}</soap:Body>'
    '</soap:Envelope>'
)


def _x(value) -> str:
    """XML-escape a value, treating None as empty string."""
    return escape(str(value)) if value is not None else ""


class _SoapResponse:
    """
    Attribute-access wrapper over a parsed SOAP response element.

    Exposes ``response.ReturnCode`` style attribute access on top of a
    parsed SOAP body element by walking the response subtree and returning
    the text of the first descendant whose local tag matches the requested
    attribute name. Returns None when no matching element is found.
    """

    def __init__(self, element: ET.Element) -> None:
        self._element = element

    def __getattr__(self, name: str):
        for child in self._element.iter():
            local = child.tag.rsplit("}", 1)[-1]
            if local == name:
                return child.text
        return None

    def __repr__(self) -> str:
        return ET.tostring(self._element, encoding="unicode")


async def _call_soap(method: str, body_inner: str) -> _SoapResponse:
    """
    Send a SOAP 1.1 request to the ERP endpoint and return the parsed result.

    Args:
        method:     SOAP method name (e.g. "IsValidUser"). Used to wrap the
                    body and to build the SOAPAction header.
        body_inner: XML fragment placed inside ``<tem:{method}>...</tem:{method}>``.
                    Caller is responsible for escaping any user-supplied text.

    Returns:
        A _SoapResponse around the inner ``*Response`` element. Field text is
        accessible via attribute access (``result.ReturnCode``).
    """
    endpoint = os.environ.get("ERP_ENDPOINT_URL", _ENDPOINT_URL)
    envelope = _ENVELOPE_TEMPLATE.format(
        soap_ns=_SOAP_ENV_NS,
        tem_ns=_NAMESPACE,
        body=f'<tem:{method}>{body_inner}</tem:{method}>',
    )
    headers = {
        "Content-Type": "text/xml; charset=utf-8",
        "SOAPAction": f'"{_NAMESPACE}/{method}"',
    }

    client = await _get_http_client()
    for attempt in range(1, 3):
        try:
            response = await client.post(
                endpoint,
                content=envelope.encode("utf-8"),
                headers=headers,
            )
            break
        except (httpx.ReadTimeout, httpx.ConnectTimeout) as exc:
            if attempt == 2:
                log_error(
                    "ADAPTER/erp",
                    f"SOAP {method} timeout on attempt 2 (final): {exc}",
                )
                raise
            log(
                "ADAPTER/erp",
                f"SOAP {method} timeout on attempt 1, retrying: {exc}",
            )
    response.raise_for_status()

    root = ET.fromstring(response.text)
    body = root.find(f"{{{_SOAP_ENV_NS}}}Body")
    if body is None or len(body) == 0:
        raise RuntimeError(f"SOAP {method}: malformed response, missing Body")

    fault = body.find(f"{{{_SOAP_ENV_NS}}}Fault")
    if fault is not None:
        # SOAP 1.1 Fault: <faultcode>, <faultstring>
        fault_str = ""
        for child in fault.iter():
            if child.tag.rsplit("}", 1)[-1] == "faultstring" and child.text:
                fault_str = child.text
                break
        raise RuntimeError(f"SOAP {method} fault: {fault_str or 'unknown fault'}")

    return _SoapResponse(body[0])


# ── Auth ─────────────────────────────────────────────────────────────────────

async def request_otp(user_code: str) -> dict:
    """
    Phase 1 of login — call ERP IsValidUser to validate the mechanic and trigger SMS OTP.

    The ERP sends an OTP to the mechanic's registered phone number.
    In test mode (ERP_TEST_MODE=true) the OTP is also returned in
    ReturnMessage so automated tests can proceed without a real phone.

    Args:
        user_code: The mechanic's user code as registered in the ERP system.

    Returns:
        {
            "success": bool,         # True when ReturnCode == "1"
            "otp_debug": str|None,   # OTP value, only set when ERP_TEST_MODE=true
            "erp_shop_id": str|None  # Numeric shop id from AdditionalData (Tafnit scope); None if absent
        }
    """
    body = f"<tem:userCode>{_x(user_code)}</tem:userCode>"
    log("ADAPTER/erp", f"SOAP IsValidUser userCode={user_code}")
    try:
        response = await _call_soap("IsValidUser", body)
    except Exception as e:
        log_error("ADAPTER/erp", f"IsValidUser SOAP call failed for userCode={user_code}: {e}")
        raise
    success = str(response.ReturnCode) == "1"
    log("ADAPTER/erp", f"IsValidUser ReturnCode={response.ReturnCode} success={success}")
    test_mode = os.environ.get("ERP_TEST_MODE", "false").lower() == "true"
    erp_shop_id: str | None = None
    if success:
        ad = response.AdditionalData
        if ad is not None and str(ad).strip():
            erp_shop_id = str(ad).strip()
        else:
            log(
                "ADAPTER/erp",
                f"WARNING: IsValidUser succeeded but AdditionalData missing/empty userCode={user_code}",
            )
    return {
        "success": success,
        "otp_debug": response.ReturnMessage if (success and test_mode) else None,
        "erp_shop_id": erp_shop_id,
    }


async def verify_login(user_code: str, otp: str) -> dict:
    """
    Phase 2 of login — call ERP Login to verify the OTP and complete authentication.

    Args:
        user_code: The mechanic's user code (same value used in request_otp).
        otp:       The one-time password received via SMS.

    Returns:
        {
            "success": bool,  # True when ReturnCode == "1"
            "message": str    # ERP ReturnMessage (error text on failure)
        }
    """
    body = (
        f"<tem:userCode>{_x(user_code)}</tem:userCode>"
        f"<tem:password>{_x(otp)}</tem:password>"
    )
    log("ADAPTER/erp", f"SOAP Login userCode={user_code}")
    try:
        response = await _call_soap("Login", body)
    except Exception as e:
        log_error("ADAPTER/erp", f"Login SOAP call failed for userCode={user_code}: {e}")
        raise
    success = str(response.ReturnCode) == "1"
    log("ADAPTER/erp", f"Login ReturnCode={response.ReturnCode} success={success}")
    return {
        "success": success,
        "message": response.ReturnMessage,
    }


# ── Car lookup ───────────────────────────────────────────────────────────────

async def lookup_car(
    license_plate: str,
    mileage: int | None,
    shop_id: str,
    erp_hash: str,
    override_km: int | None = None,
) -> dict:
    """
    Look up a vehicle by licence plate and return ERP car + tyre data.

    Calls the ERP Apply SOAP method with the shop credentials (userCode /
    password) pulled from the JWT, plus the vehicle plate (CarNumber) and
    current mileage (KM, defaults to 0 when not provided).

    Args:
        license_plate: Vehicle plate string in any format accepted by the ERP.
        mileage:       Current odometer reading in km (optional).
        shop_id:       The authenticated shop's ID from the JWT (sent as userCode).
        erp_hash:      The ERP session hash from the JWT (sent as password).

    Returns:
        dict with at minimum:
            recognized (bool), request_id (str), ownership_id (str),
            tire_level (int|None), wheel_count (int|None), tire_sizes (dict),
            carool_needed (int, 0 or 1), last_mileage (int|None),
            front_alignment (bool)
    """
    km = override_km if override_km is not None else (mileage if mileage else 0)
    body = (
        f"<tem:userCode>{_x(shop_id)}</tem:userCode>"
        f"<tem:password>{_x(erp_hash)}</tem:password>"
        f"<tem:CarNumber>{_x(license_plate)}</tem:CarNumber>"
        f"<tem:KM>{int(km)}</tem:KM>"
    )
    log(
        "ADAPTER/erp",
        f"SOAP Apply shop_id={shop_id} CarNumber={license_plate} KM={km}",
    )
    try:
        response = await _call_soap("Apply", body)
    except Exception as e:
        log_error("ADAPTER/erp", f"Apply SOAP call failed plate={license_plate}: {e}")
        raise
    log("ADAPTER/erp", f"Apply ReturnCode={response.ReturnCode} ApplyId={response.ApplyId}")
    log("ADAPTER/erp", f"Apply raw response: {response}")
    existing_lines: list[dict] = []
    front_alignment = False
    for line in response._element.iter():
        tag = line.tag.rsplit("}", 1)[-1]
        if tag == "DiagnosisLine":
            action = None
            reason = 0
            location = None
            for child in line:
                child_tag = child.tag.rsplit("}", 1)[-1]
                if child_tag == "ActionCode" and child.text:
                    action = int(child.text)
                elif child_tag == "ReasonCode" and child.text:
                    reason = int(child.text)
                elif child_tag == "TireLocation" and child.text:
                    location = child.text.strip()
            wheel = _LOCATION_TO_WHEEL.get(location)
            if action and wheel:
                existing_lines.append({"wheel": wheel, "action": action, "reason": reason})
            elif action and location == str(_NO_LOCATION_CODE):
                front_alignment = True
    return {
        "recognized": str(response.ReturnCode) in ("1", "2"),
        "request_id": response.ApplyId,
        "ownership_id": html.unescape(str(response.Company or "")),
        "car_model": response.CarModel,
        "last_mileage": int(response.LastMileage) if response.LastMileage else None,
        "tire_sizes": {
            "front": response.FrontTireSize,
            "rear": response.RearTireSize,
        },
        "erp_message": response.ReturnMessage,
        "tire_level": int(response.TireLevel) if response.TireLevel else None,
        "wheel_count": int(response.WheelCount) if response.WheelCount else None,
        "carool_needed": 1 if str(response.CaroolNeeded).lower() == "true" else 0,
        "existing_lines": existing_lines,
        "front_alignment": front_alignment,
    }


async def get_last_mileage(
    license_plate: str,
    shop_id: str,
    erp_hash: str,
) -> dict:
    """
    Fetch the last recorded odometer reading for a vehicle from the ERP.

    Calls the ERP GetLastMileage SOAP method using the same auth pattern as
    every other ERP call in this adapter: shop credentials (userCode /
    password) pulled from the JWT, plus the vehicle plate (CarNumber).

    Used by the LP-blur pre-check so the frontend can warn the mechanic
    when the value they're about to enter is below the last value the ERP
    has on file. Distinct from the LastMileage value returned by Apply,
    which is only available after a full vehicle lookup has completed.

    The ERP packs the mileage value into ReturnMessage (not a dedicated
    LastMileage element) and uses ReturnCode="1" for success — same
    convention as Apply / IsValidUser / Login. Any other ReturnCode is
    treated as "no history on record" and the frontend skips the
    comparison entirely.

    Args:
        license_plate: Vehicle plate string (CarNumber).
        shop_id:       The authenticated shop's ID from the JWT (userCode).
        erp_hash:      The ERP session hash from the JWT (password).

    Returns:
        {
            "last_mileage": int | None,
            "max_mileage": int | None,
        }
        The ERP-returned mileage values when ReturnCode == "1", otherwise nulls.
    """
    body = (
        f"<tem:userCode>{_x(shop_id)}</tem:userCode>"
        f"<tem:password>{_x(erp_hash)}</tem:password>"
        f"<tem:CarNumber>{_x(license_plate)}</tem:CarNumber>"
    )
    log(
        "ADAPTER/erp",
        f"SOAP GetLastMileage shop_id={shop_id} CarNumber={license_plate}",
    )
    try:
        response = await _call_soap("GetLastMileage", body)
    except Exception as e:
        log_error(
            "ADAPTER/erp",
            f"GetLastMileage SOAP call failed plate={license_plate}: {e}",
        )
        raise
    log(
        "ADAPTER/erp",
        f"GetLastMileage ReturnCode={response.ReturnCode} ReturnMessage={response.ReturnMessage}",
    )
    if str(response.ReturnCode) == "1":
        max_mileage_raw = response.AdditionalData
        max_mileage = (
            int(max_mileage_raw)
            if max_mileage_raw and max_mileage_raw.strip().isdigit()
            else None
        )
        return {
            "last_mileage": int(response.ReturnMessage) if response.ReturnMessage else None,
            "max_mileage": max_mileage,
        }
    return {
        "last_mileage": None,
        "max_mileage": None,
    }


# ── Diagnosis ────────────────────────────────────────────────────────────────

_TIRE_LOCATION_CODE: dict[str, int] = {
    "front-left":        1,
    "front-right":       2,
    "rear-right":        3,
    "rear-left":         4,
    "spare-tire":        5,
    "rear-left-inner":   7,
    "rear-right-inner":  8,
}
_NO_LOCATION_CODE = 6


def _diagnosis_line_xml(line: dict) -> str:
    """Serialise one DiagnosisLine dict into its <tem:DiagnosisLine> XML fragment."""
    return (
        "<tem:DiagnosisLine>"
        f"<tem:ActionCode>{int(line['ActionCode'])}</tem:ActionCode>"
        f"<tem:ReasonCode>{int(line['ReasonCode'])}</tem:ReasonCode>"
        f"<tem:TireLocation>{int(line['TireLocation'])}</tem:TireLocation>"
        f"<tem:CaRoolStatus>{_x(line['CaRoolStatus'])}</tem:CaRoolStatus>"
        f"<tem:CaRoolId>{_x(line['CaRoolId'])}</tem:CaRoolId>"
        f"<tem:Remarks>{_x(line['Remarks'])}</tem:Remarks>"
        f"<tem:IsApproved>{'true' if line['IsApproved'] else 'false'}</tem:IsApproved>"
        "</tem:DiagnosisLine>"
    )


async def submit_diagnosis(
    request_id: str,
    payload: dict,
    shop_id: str,
    erp_hash: str,
) -> bool:
    """
    Forward a completed service diagnosis to the ERP via SendDiagnose SOAP.

    Translates the per-wheel action payload into the ERP's flat DiagnosisLine
    shape. Each (wheel × action) becomes a line; ActionCode / ReasonCode are
    expected to already be resolved by the router.

    On ERP acceptance the caller sets open_orders.status = 'waiting'.
    The ERP will later fire POST /api/webhook/erp with the approval decision.

    Args:
        request_id: ERP's own reference ID for the service visit (from open_orders).
        payload:    Full diagnosis dict (see routers/diagnosis.py for shape).
        shop_id:    The authenticated shop's ID from the JWT (sent as userCode).
        erp_hash:   ERP session hash used as the auth header for SOAP calls.

    Returns:
        True if the ERP accepted the submission, False otherwise.
    """
    carool_id = payload.get("carool_id") or ""
    carool_status = "1" if payload.get("carool_id") else "0"

    lines: list[dict] = []
    for wheel, actions in payload["tires"].items():
        location_code = _TIRE_LOCATION_CODE.get(wheel, _NO_LOCATION_CODE)
        for action in actions:
            action_code = action.get("action")
            if action_code is None:
                continue
            reason_code = action.get("reason") or 0
            remarks = action.get("remarks") or ""
            lines.append({
                "ActionCode":   int(action_code),
                "ReasonCode":   int(reason_code),
                "TireLocation": location_code,
                "CaRoolStatus": carool_status,
                "CaRoolId":     carool_id,
                "Remarks":      remarks,
                "IsApproved":   False,
            })

    if payload.get("front_alignment_code"):
        lines.append({
            "ActionCode":   int(payload["front_alignment_code"]),
            "ReasonCode":   0,
            "TireLocation": _NO_LOCATION_CODE,
            "CaRoolStatus": "0",
            "CaRoolId":     "",
            "Remarks":      "",
            "IsApproved":   False,
        })

    last_mileage = int(payload.get("mileage") or 0)
    diagnosis_xml = (
        "<tem:Diagnosis>"
        f"<tem:UserMileage>{last_mileage}</tem:UserMileage>"
        "<tem:DiagnosisLines>"
        + "".join(_diagnosis_line_xml(line) for line in lines)
        + "</tem:DiagnosisLines>"
        "</tem:Diagnosis>"
    )
    body = (
        f"<tem:userCode>{_x(shop_id)}</tem:userCode>"
        f"<tem:password>{_x(erp_hash)}</tem:password>"
        f"<tem:CarNumber>{_x(payload['license_plate'])}</tem:CarNumber>"
        f"<tem:ApplyId>{int(request_id)}</tem:ApplyId>"
        + diagnosis_xml
    )

    log(
        "ADAPTER/erp",
        f"SOAP SendDiagnose shop_id={shop_id} request_id={request_id} plate={payload['license_plate']} lines={len(lines)}",
    )
    try:
        response = await _call_soap("SendDiagnose", body)
    except Exception as e:
        log_error("ADAPTER/erp", f"SendDiagnose SOAP call failed request_id={request_id}: {e}")
        raise
    accepted = str(response.ReturnCode) == "1"
    log("ADAPTER/erp", f"SendDiagnose ReturnCode={response.ReturnCode} accepted={accepted}")
    log("ADAPTER/erp", f"SendDiagnose raw response: {response}")
    return accepted


async def send_query_response(
    apply_id: int,
    tire_shop_code: int,
    response: int,
    shop_id: str,
    erp_hash: str,
) -> str | None:
    """
    Ack a stock-availability query to Tafnit via SendQueryResponse SOAP.

    Auth matches every other ERP call: JWT ``shop_id`` as userCode,
    ``erp_hash`` as password. ``Response`` is 1 (approve) or 2 (decline).

    Returns the ReturnCode string for logging, or None if absent.
    Transport / SOAP-layer exceptions propagate for the caller's retry loop.
    """
    body = (
        f"<tem:userCode>{_x(shop_id)}</tem:userCode>"
        f"<tem:password>{_x(erp_hash)}</tem:password>"
        f"<tem:ApplyId>{int(apply_id)}</tem:ApplyId>"
        f"<tem:TireShopCode>{int(tire_shop_code)}</tem:TireShopCode>"
        f"<tem:Response>{int(response)}</tem:Response>"
    )
    log(
        "ADAPTER/erp",
        f"SOAP SendQueryResponse shop_id={shop_id} ApplyId={apply_id} TireShopCode={tire_shop_code} Response={response}",
    )
    # TODO(b2b): Verify SOAP method name, namespace, and parameter names with Tafnit during
    # integration week — outbound stock-availability ack shapes are open (see b2b-context.md §9, item 1).
    soap_response = await _call_soap("SendQueryResponse", body)
    rc = soap_response.ReturnCode
    log("ADAPTER/erp", f"SendQueryResponse ReturnCode={rc}")
    return str(rc) if rc is not None else None


def _local_xml_tag(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _parse_table_codes(
    response: _SoapResponse,
    *,
    parse_linked_action: bool = False,
) -> list[dict]:
    """
    Walk the SOAP response subtree for TableCode rows; each row exposes Code and
    Description text. When parse_linked_action is True (reason table), also
    reads LinkedActionCode / LinkActionCode / ActionLinkCode if present.
    """
    rows: list[dict] = []
    for el in response._element.iter():
        if _local_xml_tag(el.tag) != "TableCode":
            continue
        code_val: int | None = None
        desc_val = ""
        linked: int | None = None
        for child in el.iter():
            if child is el:
                continue
            ln = _local_xml_tag(child.tag)
            txt = (child.text or "").strip()
            if ln == "Code" and txt:
                try:
                    code_val = int(txt)
                except ValueError:
                    code_val = None
            elif ln == "Description":
                desc_val = html.unescape(txt)
            elif parse_linked_action and ln in (
                "LinkedActionCode",
                "LinkActionCode",
                "ActionLinkCode",
            ) and txt:
                try:
                    linked = int(txt)
                except ValueError:
                    linked = None
        if code_val is None:
            continue
        row: dict = {"code": code_val, "description": desc_val}
        if parse_linked_action:
            row["linked_action_code"] = linked
        rows.append(row)
    return rows


async def get_action_table() -> list[dict]:
    """Fetch ERP action codes. No auth required."""
    response = await _call_soap("GetActionTable", "")
    rows = _parse_table_codes(response, parse_linked_action=False)
    log("ADAPTER/erp", f"GetActionTable rows={len(rows)}")
    return rows


async def get_reason_table() -> list[dict]:
    """Fetch ERP reason codes. No auth required.

    Each item includes linked_action_code when the ERP returns it; otherwise None.
    """
    response = await _call_soap("GetReasonTable", "")
    rows = _parse_table_codes(response, parse_linked_action=True)
    log("ADAPTER/erp", f"GetReasonTable rows={len(rows)}")
    return rows


async def get_tire_level_table() -> list[dict]:
    """Fetch tire quality level codes. No auth required."""
    response = await _call_soap("GetTireLevelTable", "")
    rows = _parse_table_codes(response, parse_linked_action=False)
    log("ADAPTER/erp", f"GetTireLevelTable rows={len(rows)}")
    return rows


async def get_tire_location_table() -> list[dict]:
    """Fetch tire location codes. No auth required."""
    response = await _call_soap("GetTireLocationTable", "")
    rows = _parse_table_codes(response, parse_linked_action=False)
    log("ADAPTER/erp", f"GetTireLocationTable rows={len(rows)}")
    return rows


# ── History export ────────────────────────────────────────────────────────────

async def request_history_export(
    shop_id: str,
    date_from: str,
    date_to: str,
    email: str,
    erp_hash: str,
) -> bool:
    """
    Ask the ERP to generate and email a service-history report for the shop.

    STUB — replace with a real SOAP call once the ERP team confirms the
    method name and date-format expectations (ISO-8601 YYYY-MM-DD assumed).
    The ERP generates the report asynchronously; there is no webhook callback.

    Args:
        shop_id:   The authenticated shop's ID.
        date_from: Start date, inclusive (ISO-8601: YYYY-MM-DD).
        date_to:   End date, inclusive (ISO-8601: YYYY-MM-DD).
        email:     Recipient email address for the exported report.
        erp_hash:  ERP session hash used as the auth header for SOAP calls.

    Returns:
        True if the ERP accepted the export request, False otherwise.
    """
    log(
        "ADAPTER/erp",
        f"request_history_export STUB shop_id={shop_id} from={date_from} to={date_to} email={email}",
    )
    # TODO: replace stub — SOAP method TBD
    return True
