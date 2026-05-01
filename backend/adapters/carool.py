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

import json
import httpx

from config import CAROOL_API_KEY, CAROOL_BASE_URL, CAROOL_PAGE_ORIGIN
from logging_utils import log, log_error


def _headers() -> dict:
    """
    Build the authentication headers required by every Carool API call.

    Both values are injected at startup by config.py from GCP Secret Manager.
    Raises KeyError at runtime if either env var is missing, making
    misconfiguration immediately visible rather than producing silent 401s.
    """
    return {
        "X-API-KEY": CAROOL_API_KEY,
        "X-Page-origin": CAROOL_PAGE_ORIGIN,
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
    url = f"{CAROOL_BASE_URL}/ai-diagnoses"
    log("ADAPTER/carool", f"open_session order_id={order_id} plate={license_plate} mileage={mileage}")
    log("ADAPTER/carool", f"POST {url}")
    async with httpx.AsyncClient() as client:
        try:
            resp = await client.post(
                url,
                headers=_headers(),
                json={
                    "externalId": order_id,
                    "license": license_plate,
                    "licenseCountry": "IL",
                    "vehicleMileage": mileage or 0,
                },
            )
        except httpx.HTTPError as e:
            log_error("ADAPTER/carool", f"open_session network error for order_id={order_id}: {e}")
            raise
        log("ADAPTER/carool", f"POST {url} -> {resp.status_code}")
        if resp.status_code >= 400:
            log_error("ADAPTER/carool", f"open_session failed: {resp.status_code} {resp.text[:200]}")
        resp.raise_for_status()
        carool_id = str(resp.json()["id"])
        log("ADAPTER/carool", f"open_session success order_id={order_id} carool_id={carool_id}")
        return carool_id


async def upload_photo(
    carool_id: str,
    photo_type: str,   # "sidewall" | "tread"
    image_bytes: bytes,
    content_type: str = "image/jpeg",
    wheel_position: str = "FRONT_LEFT",
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
    endpoint = f"{CAROOL_BASE_URL}/ai-diagnoses/{carool_id}/{photo_type}-picture"
    log(
        "ADAPTER/carool",
        f"upload_photo carool_id={carool_id} type={photo_type} bytes={len(image_bytes)} content_type={content_type}",
    )
    log("ADAPTER/carool", f"POST {endpoint}")
    picture_field = "sidewallPicture" if photo_type == "sidewall" else "treadPicture"
    body_json = json.dumps({"position": wheel_position}).encode("utf-8")
    async with httpx.AsyncClient(timeout=30) as client:
        try:
            resp = await client.post(
                endpoint,
                headers=_headers(),
                files={
                    picture_field: ("photo.jpg", image_bytes, content_type),
                    "body": ("body.json", body_json, "application/json"),
                },
            )
        except httpx.HTTPError as e:
            log_error("ADAPTER/carool", f"upload_photo network error carool_id={carool_id}: {e}")
            raise
        log("ADAPTER/carool", f"POST {endpoint} -> {resp.status_code}")
        if resp.status_code >= 400:
            log_error("ADAPTER/carool", f"upload_photo failed: {resp.status_code} {resp.text[:200]}")
        resp.raise_for_status()
        log("ADAPTER/carool", f"upload_photo success carool_id={carool_id} type={photo_type}")


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
    url = f"{CAROOL_BASE_URL}/ai-diagnoses/{carool_id}/uploaded"
    log("ADAPTER/carool", f"finalize_session carool_id={carool_id}")
    log("ADAPTER/carool", f"POST {url}")
    async with httpx.AsyncClient() as client:
        try:
            resp = await client.post(url, headers=_headers())
        except httpx.HTTPError as e:
            log_error("ADAPTER/carool", f"finalize_session network error carool_id={carool_id}: {e}")
            raise
        log("ADAPTER/carool", f"POST {url} -> {resp.status_code}")
        if resp.status_code >= 400:
            log_error("ADAPTER/carool", f"finalize_session failed: {resp.status_code} {resp.text[:200]}")
        resp.raise_for_status()
        log("ADAPTER/carool", f"finalize_session success carool_id={carool_id}")
