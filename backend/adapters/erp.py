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
  - submit_diagnosis              → LIVE (call real ERP SOAP)
  - request_history_export        → STUB (always returns True)
  Replace stubs with real SOAP calls once the ERP team confirms method signatures.

CRITICAL port note:
  The WSDL advertises port 443, but the firewall only allows port 22443.
  _get_client() loads the WSDL then overrides the binding address to use 22443.
"""

import os
import functools
import requests
from zeep import Client
from zeep.transports import Transport

import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# ── SOAP client constants ─────────────────────────────────────────────────────

_WSDL_URL     = "https://tet.kogol.co.il:22443/csp/bil/Diagnose.Webservices.cls?WSDL"
_ENDPOINT_URL = "https://tet.kogol.co.il:22443/csp/bil/Diagnose.Webservices.cls"
_BINDING_NAME = "{http://tempuri.org}DiagnoseWebservicesSoap"


# ── SOAP client (lazy singleton) ─────────────────────────────────────────────

@functools.lru_cache(maxsize=1)
def _get_client():
    """
    Build and cache the zeep SOAP service (singleton via lru_cache).

    SSL verification is disabled for the test environment (self-signed cert on
    the ERP server). Set ERP_SSL_VERIFY=true once a valid certificate is in place.

    The WSDL endpoint URLs can be overridden via environment variables
    ERP_WSDL_URL and ERP_ENDPOINT_URL for staging / production targets.

    Returns:
        A zeep service proxy bound to the ERP SOAP endpoint.
    """
    ssl_verify = os.environ.get("ERP_SSL_VERIFY", "false").lower() == "true"
    session = requests.Session()
    session.verify = ssl_verify
    transport = Transport(session=session)

    wsdl = os.environ.get("ERP_WSDL_URL", _WSDL_URL)
    endpoint = os.environ.get("ERP_ENDPOINT_URL", _ENDPOINT_URL)

    client = Client(wsdl=wsdl, transport=transport)
    # Override the port-443 address declared in the WSDL — firewall requires 22443
    return client.create_service(_BINDING_NAME, endpoint)


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
            "success": bool,       # True when ReturnCode == "1"
            "otp_debug": str|None  # OTP value, only set when ERP_TEST_MODE=true
        }
    """
    service = _get_client()
    response = service.IsValidUser(userCode=user_code)
    success = str(response.ReturnCode) == "1"
    test_mode = os.environ.get("ERP_TEST_MODE", "false").lower() == "true"
    return {
        "success": success,
        "otp_debug": response.ReturnMessage if (success and test_mode) else None,
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
    service = _get_client()
    response = service.Login(userCode=user_code, password=otp)
    return {
        "success": str(response.ReturnCode) == "1",
        "message": response.ReturnMessage,
    }


# ── Car lookup ───────────────────────────────────────────────────────────────

async def lookup_car(
    license_plate: str,
    mileage: int | None,
    shop_id: str,
    erp_hash: str,
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
            tire_level (str), wheel_count (int), tire_sizes (dict),
            carool_needed (bool), last_mileage (int|None)
    """
    service = _get_client()
    response = service.Apply(
        userCode=shop_id,
        password=erp_hash,
        CarNumber=license_plate,
        KM=mileage if mileage else 0,
    )
    print(f"[erp.Apply] raw response: {response}")
    return {
        "recognized": str(response.ReturnCode) == "1",
        "request_id": response.ApplyId,
        "ownership_id": response.Company,
        "car_model": response.CarModel,
        "last_mileage": response.LastMileage,
        "tire_sizes": {
            "front": response.FrontTireSize,
            "rear": response.RearTireSize,
        },
        "erp_message": response.ReturnMessage,
        "tire_level": None,
        "wheel_count": None,
        "carool_needed": None,
    }


# ── Diagnosis ────────────────────────────────────────────────────────────────

# Hardcoded until erp_action_codes / erp_tire_locations DB tables are wired in.
# To replace: query by frontend_action+frontend_reason (or wheel_position) and return erp_code.
_REASON_CODE: dict[str, int] = {
    "wear":    3,
    "damage":  23,
    "fitment": 25,
    "puncture": 4,
}
_FRONT_ALIGNMENT_CODE = 2

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


async def submit_diagnosis(
    request_id: str,
    payload: dict,
    shop_id: str,
    erp_hash: str,
) -> bool:
    """
    Forward a completed service diagnosis to the ERP via SendDiagnose SOAP.

    Translates the frontend per-wheel action payload into the ERP's flat
    DiagnosisLine shape: each (wheel × action) becomes a single line with
    ActionCode + TireLocation pulled from the lookup tables. Sensor /
    balancing / rim-repair / relocation / TPMS-valve actions have no ERP
    code yet and are silently skipped. Front-alignment, when set, becomes
    a final line with TireLocation = 6 (no-location).

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
            kind = action.get("action")
            if kind == "replacement" and action.get("reason"):
                action_code = _REASON_CODE[action["reason"]]
                remarks = action.get("reason") or ""
            elif kind == "puncture":
                action_code = _REASON_CODE["puncture"]
                remarks = action.get("reason") or ""
            else:
                continue
            lines.append({
                "ActionCode":   action_code,
                "TireLocation": location_code,
                "CaRoolStatus": carool_status,
                "CaRoolId":     carool_id,
                "Remarks":      remarks,
                "IsApproved":   False,
            })

    if payload.get("front_alignment"):
        lines.append({
            "ActionCode":   _FRONT_ALIGNMENT_CODE,
            "TireLocation": _NO_LOCATION_CODE,
            "CaRoolStatus": "0",
            "CaRoolId":     "",
            "Remarks":      "",
            "IsApproved":   False,
        })

    diagnosis_dict = {
        "LastMileage":     payload.get("mileage") or 0,
        "DiagnosisLines":  {"DiagnosisLine": lines},
    }

    service = _get_client()
    response = service.SendDiagnose(
        userCode=shop_id,
        password=erp_hash,
        CarNumber=payload["license_plate"],
        ApplyId=int(request_id),
        Diagnosis=diagnosis_dict,
    )
    print(f"[erp.SendDiagnose] raw response: {response}")
    return str(response.ReturnCode) == "1"


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
    # TODO: replace stub — SOAP method TBD
    return True
