"""
ERP connectivity sanity check — run this directly on the whitelisted VM
before starting the full server to confirm SOAP auth works end-to-end.

Usage:
    pip install zeep requests
    python test_erp_connection.py

    # Override defaults via env vars if needed:
    ERP_TEST_USER=MAAYAN python test_erp_connection.py
"""

import os
import sys
import requests
from zeep import Client
from zeep.transports import Transport

WSDL_URL     = os.environ.get("ERP_WSDL_URL",     "https://tet.kogol.co.il:22443/csp/bil/Diagnose.Webservices.cls?WSDL")
ENDPOINT_URL = os.environ.get("ERP_ENDPOINT_URL",  "https://tet.kogol.co.il:22443/csp/bil/Diagnose.Webservices.cls")
BINDING_NAME = "{http://tempuri.org}DiagnoseWebservicesSoap"
TEST_USER    = os.environ.get("ERP_TEST_USER", "MAAYAN")


def build_service():
    print(f"[1] Loading WSDL from {WSDL_URL} ...")
    session = requests.Session()
    session.verify = False  # test env uses a self-signed cert
    transport = Transport(session=session)
    client = Client(wsdl=WSDL_URL, transport=transport)

    # Override the port-443 address declared in the WSDL
    service = client.create_service(BINDING_NAME, ENDPOINT_URL)
    print(f"    Endpoint overridden to: {ENDPOINT_URL}")
    return service


def test_request_otp(service):
    print(f"\n[2] Calling IsValidUser(userCode='{TEST_USER}') ...")
    response = service.IsValidUser(userCode=TEST_USER)
    print(f"    ReturnCode    : {response.ReturnCode}")
    print(f"    ReturnMessage : {response.ReturnMessage}")

    if str(response.ReturnCode) != "1":
        print("FAIL — ERP rejected the user code.")
        sys.exit(1)

    otp = response.ReturnMessage
    print(f"    OTP (test env): {otp}")
    return otp


def test_verify_login(service, otp):
    print(f"\n[3] Calling Login(userCode='{TEST_USER}', password='{otp}') ...")
    response = service.Login(userCode=TEST_USER, password=otp)
    print(f"    ReturnCode    : {response.ReturnCode}")
    print(f"    ReturnMessage : {response.ReturnMessage}")

    if str(response.ReturnCode) != "1":
        print("FAIL — Login rejected.")
        sys.exit(1)

    print("\nSUCCESS — two-step auth works.")


if __name__ == "__main__":
    import urllib3
    urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

    service = build_service()
    otp = test_request_otp(service)
    test_verify_login(service, otp)
