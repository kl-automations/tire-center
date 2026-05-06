"""
ERP connectivity sanity check — run this directly on the whitelisted VM
before starting the full server to confirm SOAP auth works end-to-end.

Calls the same `request_otp` / `verify_login` functions the production
app uses (raw SOAP via httpx), so a successful run proves the adapter,
the endpoint URL, the SSL config, and the firewall whitelist are all
working together.

Usage:
    pip install httpx
    ERP_TEST_MODE=true python test_erp_connection.py

    # Override defaults via env vars if needed:
    ERP_TEST_USER=MAAYAN ERP_TEST_MODE=true python test_erp_connection.py
"""

import asyncio
import os
import sys

# Force test mode on so the adapter surfaces the OTP in `otp_debug` and
# this script can complete the second step without a real phone. Done
# before the adapter is imported because the adapter reads the env var.
os.environ.setdefault("ERP_TEST_MODE", "true")

from adapters.erp import close_http_client, request_otp, verify_login

TEST_USER = os.environ.get("ERP_TEST_USER", "MAAYAN")


async def _run_checks() -> None:
    print(f"[1] Calling request_otp(user_code='{TEST_USER}') ...")
    result = await request_otp(TEST_USER)
    print(f"    success   : {result['success']}")
    print(f"    otp_debug : {result['otp_debug']}")

    if not result["success"]:
        print("FAIL — ERP rejected the user code.")
        sys.exit(1)
    if not result["otp_debug"]:
        print("FAIL — otp_debug is empty (set ERP_TEST_MODE=true).")
        sys.exit(1)

    otp = result["otp_debug"]
    print(f"\n[2] Calling verify_login(user_code='{TEST_USER}', otp='{otp}') ...")
    login = await verify_login(TEST_USER, otp)
    print(f"    success : {login['success']}")
    print(f"    message : {login['message']}")

    if not login["success"]:
        print("FAIL — Login rejected.")
        sys.exit(1)

    print("\nSUCCESS — two-step auth works.")


async def main() -> None:
    # The adapter's httpx.AsyncClient is bound to the running loop, so its
    # close() must happen in this same loop — not in a fresh asyncio.run().
    try:
        await _run_checks()
    finally:
        await close_http_client()


if __name__ == "__main__":
    asyncio.run(main())
