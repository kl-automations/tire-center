"""
Carool REST adapter — live (not a stub).

Carool is an AI tyre-analysis platform. The mechanic photographs each tyre
(sidewall + tread) during the AcceptedRequest screen; these images are
forwarded to Carool who returns per-tyre condition predictions asynchronously
via a webhook to POST /api/webhook/carool.

API docs: ca-rool.com
Auth:     X-API-KEY and X-Page-origin headers loaded from GCP Secret Manager
          via config.py (CAROOL_API_KEY, CAROOL_PAGE_ORIGIN).

Known bug (open_session):
    The original implementation called `client.post(...)` without `await`
    inside an async function, meaning the HTTP request silently never fired
    (the coroutine was discarded). This has been corrected — all httpx calls
    now use `await client.post(...)`.
"""

import os
import httpx

BASE_URL = "https://api.ca-rool.com"  # confirm exact base URL with Carool team


def _headers() -> dict:
    """
    Build the authentication headers required by every Carool API call.

    Both values are injected at startup by config.py from GCP Secret Manager.
    Raises KeyError at runtime if either env var is missing, making
    misconfiguration immediately visible rather than producing silent 401s.
    """
    return {
        "X-API-KEY": os.environ["CAROOL_API_KEY"],
        "X-Page-origin": os.environ["CAROOL_PAGE_ORIGIN"],
    }


async def open_session(order_id: str, license_plate: str, mileage: int | None) -> str:
    """
    Open a new Carool AI diagnosis session for a vehicle.

    Calls POST /ai-diagnoses with the vehicle's licence plate (and optional
    mileage). Carool returns a session ID which must be supplied to all
    subsequent upload_photo and finalize_session calls.

    Args:
        order_id:      Our internal order ID, sent as `externalId`. Carool
                       echoes this value back in the webhook payload so we can
                       match the async analysis result to the originating order.
        license_plate: Vehicle plate in any format; licenseCountry is hardcoded
                       to "IL" (Israel) for this deployment.
        mileage:       Current odometer reading in km, if available.

    Returns:
        The Carool session ID string (stored in open_orders.carool_diagnosis_id).

    Raises:
        httpx.HTTPStatusError: Carool returned a non-2xx response.
    """
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{BASE_URL}/ai-diagnoses",
            headers=_headers(),
            json={
                "externalId": order_id,
                "vehicle": {
                    "license": license_plate,
                    "licenseCountry": "IL",
                    **({"mileage": mileage} if mileage else {}),
                },
            },
        )
        resp.raise_for_status()
        return str(resp.json()["id"])


async def upload_photo(
    carool_id: str,
    photo_type: str,   # "sidewall" | "tread"
    image_bytes: bytes,
    content_type: str = "image/jpeg",
) -> None:
    """
    Upload a single tyre photo to an existing Carool session.

    Calls POST /ai-diagnoses/{carool_id}/{photo_type}-picture with the image
    as a multipart/form-data file upload. A 30-second timeout is set because
    mobile photo uploads may be slow on a shop's Wi-Fi.

    Args:
        carool_id:    The Carool session ID returned by open_session.
        photo_type:   Either "sidewall" or "tread" — determines the API path.
        image_bytes:  Raw image bytes read from the uploaded file.
        content_type: MIME type of the image (default "image/jpeg").

    Raises:
        httpx.HTTPStatusError: Carool returned a non-2xx response.
    """
    endpoint = f"{BASE_URL}/ai-diagnoses/{carool_id}/{photo_type}-picture"
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            endpoint,
            headers=_headers(),
            files={"file": ("photo.jpg", image_bytes, content_type)},
        )
        resp.raise_for_status()


async def finalize_session(carool_id: str) -> None:
    """
    Signal Carool that all photos have been uploaded and analysis should begin.

    Calls POST /ai-diagnoses/{carool_id}/uploaded. After this, Carool processes
    the images asynchronously (typically seconds to a few minutes) and fires a
    webhook to POST /api/webhook/carool with the analysis results.

    Args:
        carool_id: The Carool session ID returned by open_session.

    Raises:
        httpx.HTTPStatusError: Carool returned a non-2xx response.
    """
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{BASE_URL}/ai-diagnoses/{carool_id}/uploaded",
            headers=_headers(),
        )
        resp.raise_for_status()
