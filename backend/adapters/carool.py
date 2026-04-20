"""
Carool REST adapter — live (not a stub).
Docs: ca-rool.com
All calls require X-API-KEY and X-Page-origin headers (loaded from env).
"""

import os
import httpx

BASE_URL = "https://api.ca-rool.com"  # confirm exact base URL with Carool docs


def _headers() -> dict:
    return {
        "X-API-KEY": os.environ["CAROOL_API_KEY"],
        "X-Page-origin": os.environ["CAROOL_PAGE_ORIGIN"],
    }


async def open_session(license_plate: str, mileage: int | None) -> str:
    """
    Open a new Carool diagnosis session.
    Returns the carool_diagnosis_id string.
    """
    async with httpx.AsyncClient() as client:
        resp = client.post(
            f"{BASE_URL}/ai-diagnoses",
            headers=_headers(),
            json={
                "vehicle": {
                    "license": license_plate,
                    "licenseCountry": "IL",
                    **({"mileage": mileage} if mileage else {}),
                }
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
    """Upload one photo to an existing Carool session."""
    endpoint = f"{BASE_URL}/ai-diagnoses/{carool_id}/{photo_type}-picture"
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            endpoint,
            headers=_headers(),
            files={"file": ("photo.jpg", image_bytes, content_type)},
        )
        resp.raise_for_status()


async def finalize_session(carool_id: str) -> None:
    """Signal Carool that all photos have been uploaded — triggers AI analysis."""
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{BASE_URL}/ai-diagnoses/{carool_id}/uploaded",
            headers=_headers(),
        )
        resp.raise_for_status()
