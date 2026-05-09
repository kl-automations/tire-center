"""
Pydantic request/response models for the Tire Center API.

These models serve as both the API contract (FastAPI validates all incoming
JSON against them) and the OpenAPI schema source (FastAPI serialises them
into /openapi.json, which powers Swagger UI at /docs and the Mintlify site).
"""

from pydantic import BaseModel, ConfigDict, Field
from typing import Any


# ---------- Auth ----------

class RequestCodeRequest(BaseModel):
    """Request body for the first step of login: sending an OTP to the user."""

    userCode: str = Field(
        description="The mechanic's unique user code as registered in the ERP system."
    )


class RequestCodeResponse(BaseModel):
    """Response returned after a one-time-password has been dispatched via the ERP."""

    success: bool = Field(
        description="True when the ERP accepted the code and dispatched an OTP SMS."
    )
    otp_debug: str | None = Field(
        default=None,
        description=(
            "The raw OTP value, returned only when ERP_TEST_MODE=true. "
            "Never populated in production."
        ),
    )


class VerifyOtpRequest(BaseModel):
    """Request body for the second step of login: verifying the OTP."""

    userCode: str = Field(
        description="The same user code supplied in the first login step."
    )
    otp: str = Field(
        description="The one-time password received by the mechanic via SMS."
    )


class VerifyOtpResponse(BaseModel):
    """Response returned on successful OTP verification."""

    success: bool = Field(description="True when the OTP matched and the JWT was issued.")
    token: str = Field(
        description=(
            "Signed JWT (HS256, 12-hour TTL). Payload contains "
            "{ shop_id, erp_hash, exp }. Must be sent as "
            "'Authorization: Bearer <token>' on all protected endpoints."
        )
    )


class FirebaseCustomTokenResponse(BaseModel):
    """Short-lived Firebase Auth custom token for Firestore client listeners."""

    custom_token: str = Field(description="Pass to Firebase JS signInWithCustomToken.")
    shop_id: str = Field(
        description="Shop scope matching Firestore path orders/{shop_id}/updates/*."
    )


# ---------- Car lookup ----------

class CarLookupRequest(BaseModel):
    """Request body for opening a new service order via a licence-plate lookup."""

    license_plate: str = Field(
        description="The vehicle licence plate number (e.g. '12-345-67'). Any format accepted by the ERP."
    )
    mileage: int | None = Field(
        default=None,
        description="Current odometer reading in kilometres, as entered by the mechanic. Optional.",
    )
    last_mileage_hint: int | None = Field(
        default=None,
        description=(
            "Last mileage value already shown to the mechanic by the pre-check flow. "
            "Used to safely override Apply KM when entered mileage is lower."
        ),
    )


class LastMileageRequest(BaseModel):
    """Request body for the LP-blur pre-check that fetches a vehicle's last recorded mileage."""

    license_plate: str = Field(
        description=(
            "The vehicle licence plate number to look up in the ERP's mileage "
            "history. Any format accepted by the ERP."
        )
    )


class LastMileageResponse(BaseModel):
    """Response returned by the last-mileage pre-check endpoint."""

    last_mileage: int | None = Field(
        default=None,
        description=(
            "Last odometer reading on file in km, or null when the ERP has no "
            "history for this vehicle (ReturnCode='1'). The frontend skips "
            "validation entirely when this is null."
        ),
    )
    max_mileage: int | None = Field(
        default=None,
        description="Maximum allowed mileage for this vehicle. Null means no limit.",
    )


class ActionCodeItem(BaseModel):
    """One ERP action code row as exposed to the frontend."""

    code: int
    label_he: str | None = ""
    label_ar: str | None = ""
    label_ru: str | None = ""


class ReasonCodeItem(BaseModel):
    """One ERP reason code row as exposed to the frontend."""

    code: int
    label_he: str | None = ""
    label_ar: str | None = ""
    label_ru: str | None = ""
    linked_action_code: int


class CodesResponse(BaseModel):
    """Response shape for GET /api/codes."""

    actions: list[ActionCodeItem]
    reasons: list[ReasonCodeItem]


# ---------- Carool ----------

class CaroolSessionRequest(BaseModel):
    """Request body for opening a Carool AI photo-analysis session."""

    order_id: str = Field(
        description="UUID of the open_orders row to associate the Carool session with."
    )


class CaroolSessionResponse(BaseModel):
    """Response returned after a Carool session has been created."""

    carool_id: str = Field(
        description="The Carool platform's identifier for this analysis session. Used in subsequent photo and finalize calls."
    )


class CaroolFinalizeRequest(BaseModel):
    """Request body for finalising a Carool AI session after all photos have been uploaded."""

    order_id: str = Field(
        description="UUID of the open_orders row whose Carool session should be finalised."
    )


# ---------- Diagnosis ----------

class TireAction(BaseModel):
    """A single action performed on one tyre during a service visit."""

    action: int | str = Field(
        description=(
            "ERP action code integer. Legacy string action IDs are also accepted "
            "for backward compatibility."
        )
    )
    reason: int | str | None = Field(
        default=None,
        description=(
            "ERP reason code integer when applicable. Legacy string reason IDs "
            "are accepted for backward compatibility."
        ),
    )
    transfer_target: str | None = Field(
        default=None,
        description=(
            "Wheel position the tyre is being moved to when action='relocation'. "
            "E.g. 'rear-left'. Null for all other actions."
        ),
    )


class DiagnosisRequest(BaseModel):
    """
    Full diagnosis payload submitted by the mechanic at the end of a service visit.

    Sent to POST /api/diagnosis. The backend validates ownership, persists the
    data in open_orders.diagnosis (JSONB), sets status='waiting', and forwards
    the payload to the ERP via SOAP.
    """

    order_id: str = Field(
        description="UUID of the open_orders row being diagnosed."
    )
    mileage_update: int | None = Field(
        default=None,
        description="Updated odometer reading in km if the mechanic corrected the value.",
    )
    front_alignment: bool = Field(
        default=False,
        description="True when front-axle wheel alignment was performed during this visit.",
    )
    tires: dict[str, list[TireAction]] = Field(
        default={},
        description=(
            "Map of wheel position to the list of actions performed on that tyre. "
            "Keys are position strings such as 'front-left', 'front-right', "
            "'rear-left', 'rear-right'. Each value is an ordered list of TireAction objects."
        ),
    )


# ---------- History ----------

class HistoryRequest(BaseModel):
    """Request body for triggering a history-export email via the ERP."""

    date_from: str = Field(
        description="Start of the export date range, inclusive. ISO-8601 date string (YYYY-MM-DD)."
    )
    date_to: str = Field(
        description="End of the export date range, inclusive. ISO-8601 date string (YYYY-MM-DD)."
    )
    email: str = Field(
        description="Email address to which the ERP should send the exported report."
    )


# ---------- Webhooks ----------

class ErpDiagnoseItem(BaseModel):
    """
    A single per-line approval decision in the ERP webhook payload.

    The ERP returns one item per (action × location) line that the mechanic
    originally submitted, plus an additional line for front-alignment when
    applicable (Action='2', Location='6').
    """
    model_config = ConfigDict(extra="ignore")

    Action: str = Field(
        description=(
            "ERP action code as a string. Known values: '3'=wear, '23'=damage, "
            "'25'=fitment, '4'=puncture, '2'=front_alignment."
        )
    )
    Location: str = Field(
        description=(
            "ERP tyre-location code as a string. '1'=front-left, '2'=front-right, "
            "'3'=rear-right, '4'=rear-left, '5'=spare-tire, '6'=no-location "
            "(front-alignment), '7'=rear-left-inner, '8'=rear-right-inner."
        )
    )
    Remarks: str = Field(
        default="",
        description="Free-text remarks supplied by the garage manager. Optional.",
    )
    Confirmed: str = Field(
        description="Approval flag as a string. '1' = approved, '0' = declined."
    )


class ErpWebhookPayload(BaseModel):
    """
    Inbound payload sent by the ERP when an order's approval status changes.

    The ERP fires this webhook after the garage manager approves or declines
    a submitted diagnosis. The backend computes per-wheel approval, the
    overall status, and front-alignment confirmation, then updates open_orders
    and writes a Firestore signal so the browser receives a live status update.
    """

    request_id: str = Field(
        description=(
            "The ERP's own reference ID for the service visit. Stored in "
            "open_orders.request_id as text and used directly for lookups."
        )
    )
    DiagnoseData: list[ErpDiagnoseItem] = Field(
        description=(
            "Per-line approval decisions, one item per (action × location) line "
            "the mechanic originally submitted, plus an optional front-alignment "
            "line (Action='2', Location='6')."
        )
    )


class CaroolWebhookPayload(BaseModel):
    """
    Inbound payload sent by Carool when an AI photo-analysis session is complete.

    Carool fires this webhook asynchronously after the session was finalised.
    The backend merges the analysis results into open_orders.diagnosis JSONB.
    """

    externalId: str = Field(
        description="Carool's session ID, matching open_orders.carool_diagnosis_id."
    )
    dateAnalysis: str | None = Field(
        default=None,
        description="ISO-8601 datetime string marking when Carool completed its analysis.",
    )
    vehicle: dict[str, Any] = Field(
        default={},
        description="Carool's vehicle-level metadata (make, model, year, etc.).",
    )
    prediction: dict[str, Any] = Field(
        default={},
        description="Carool's tyre-condition predictions keyed by wheel position.",
    )
    recommendations: list[Any] = Field(
        default=[],
        description="Carool's ordered list of recommended actions per tyre.",
    )
