"""
ERP adapter — ALL ERP SOAP calls live here.

Auth flow (two-step):
  1. request_otp(user_code)  → IsValidUser SOAP call  → triggers SMS; returns OTP in test env
  2. verify_login(user_code, otp) → Login SOAP call    → confirms OTP, grants access

CRITICAL: The WSDL advertises port 443, but the firewall only allows port 22443.
          _get_client() creates the service with the corrected endpoint URL after
          loading the WSDL, overriding the binding address.

Subsequent ERP calls (lookup_car, submit_diagnosis, etc.) are still stubs —
replace them with zeep calls once the relevant SOAP methods are confirmed.
"""

import os
import functools
import requests
from zeep import Client
from zeep.transports import Transport

# ── SOAP client (lazy singleton) ─────────────────────────────────────────────

_WSDL_URL     = "https://tet.kogol.co.il:22443/csp/bil/Diagnose.Webservices.cls?WSDL"
_ENDPOINT_URL = "https://tet.kogol.co.il:22443/csp/bil/Diagnose.Webservices.cls"
_BINDING_NAME = "{http://tempuri.org}DiagnoseWebservicesSoap"


@functools.lru_cache(maxsize=1)
def _get_client():
    """
    Build the zeep service once and cache it.
    SSL verification is disabled for the test environment (self-signed cert).
    Set ERP_SSL_VERIFY=true in production when a valid cert is in place.
    """
    ssl_verify = os.environ.get("ERP_SSL_VERIFY", "false").lower() == "true"
    session = requests.Session()
    session.verify = ssl_verify
    transport = Transport(session=session)

    wsdl = os.environ.get("ERP_WSDL_URL", _WSDL_URL)
    endpoint = os.environ.get("ERP_ENDPOINT_URL", _ENDPOINT_URL)

    client = Client(wsdl=wsdl, transport=transport)
    # Override the port-443 address the WSDL declares — firewall requires 22443
    return client.create_service(_BINDING_NAME, endpoint)


# ── Auth ─────────────────────────────────────────────────────────────────────

async def request_otp(user_code: str) -> dict:
    """
    Phase 1 — call IsValidUser.
    ERP sends an SMS to the mechanic; in test env the OTP is in ReturnMessage.
    Returns {"success": bool, "otp_debug": str | None}
    otp_debug is only populated when ERP_TEST_MODE=true.
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
    Phase 2 — call Login.
    Returns {"success": bool, "message": str}
    """
    service = _get_client()
    response = service.Login(userCode=user_code, password=otp)
    return {
        "success": str(response.ReturnCode) == "1",
        "message": response.ReturnMessage,
    }


async def lookup_car(
    license_plate: str,
    mileage: int | None,
    shop_id: str,
    erp_hash: str,
) -> dict:
    """
    Look up a vehicle by plate in the ERP.
    Returns car data + tire config. Sets recognized=False if plate is unknown.
    """
    # TODO: replace stub — SOAP method TBD (GetCarData?)
    return {
        "recognized": True,
        "request_id": f"req_stub_{license_plate.replace('-', '')}",
        "ownership_id": "HERTZ",
        "tire_level": "premium",
        "wheel_count": 4,
        "tire_sizes": {
            "front": {"size": "205/55R16", "profile": "91V"},
            "rear":  {"size": "225/45R17", "profile": "94W"},
        },
        "carool_needed": True,
        "last_mileage": (mileage - 3000) if mileage else None,
    }


async def submit_diagnosis(
    request_id: str,
    payload: dict,
    erp_hash: str,
) -> bool:
    """Submit the full diagnosis (wheel actions, alignment, Carool ID) to ERP."""
    # TODO: replace stub — SOAP method TBD (SubmitDiagnosis?)
    return True


async def request_history_export(
    shop_id: str,
    date_from: str,
    date_to: str,
    email: str,
    erp_hash: str,
) -> bool:
    """Ask ERP to email a history report for the given period."""
    # TODO: replace stub — SOAP method TBD
    return True
