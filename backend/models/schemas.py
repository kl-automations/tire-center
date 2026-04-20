from pydantic import BaseModel
from typing import Any


# ---------- Auth ----------

class RequestCodeRequest(BaseModel):
    userCode: str

class RequestCodeResponse(BaseModel):
    success: bool
    otp_debug: str | None = None   # populated only when ERP_TEST_MODE=true

class VerifyOtpRequest(BaseModel):
    userCode: str
    otp: str

class VerifyOtpResponse(BaseModel):
    success: bool
    token: str


# ---------- Car lookup ----------

class CarLookupRequest(BaseModel):
    license_plate: str
    mileage: int | None = None


# ---------- Carool ----------

class CaroolSessionRequest(BaseModel):
    order_id: str

class CaroolSessionResponse(BaseModel):
    carool_id: str

class CaroolFinalizeRequest(BaseModel):
    order_id: str


# ---------- Diagnosis ----------

class TireAction(BaseModel):
    action: str
    reason: str | None = None
    transfer_target: str | None = None

class DiagnosisRequest(BaseModel):
    order_id: str
    mileage_update: int | None = None
    front_alignment: bool = False
    tires: dict[str, list[TireAction]] = {}


# ---------- History ----------

class HistoryRequest(BaseModel):
    date_from: str
    date_to: str
    email: str


# ---------- Webhooks ----------

class ErpWebhookPayload(BaseModel):
    request_id: str
    status: str
    front_alignment: str | None = None
    tires: dict[str, Any] = {}

class CaroolWebhookPayload(BaseModel):
    externalId: str
    dateAnalysis: str | None = None
    vehicle: dict[str, Any] = {}
    prediction: dict[str, Any] = {}
    recommendations: list[Any] = []
