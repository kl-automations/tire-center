"""
ERP connectivity sanity check.
Calls IsValidUser("TEST") and verifies the response is "123456".
"""

from zeep import Client

WSDL_URL = "http://194.90.92.189/csp/bil/Diagnose.Webservices.cls?WSDL"
TEST_USERNAME = "TEST"
EXPECTED_PASSWORD = "123456"


def main():
    print(f"Connecting to WSDL: {WSDL_URL}")
    client = Client(WSDL_URL)

    print(f"Calling IsValidUser('{TEST_USERNAME}')...")
    result = client.service.IsValidUser(TEST_USERNAME)

    print(f"Response: {result!r}")

    if result == EXPECTED_PASSWORD:
        print("SUCCESS — response matches expected password.")
    else:
        print(f"UNEXPECTED — got {result!r}, expected {EXPECTED_PASSWORD!r}")


if __name__ == "__main__":
    main()
