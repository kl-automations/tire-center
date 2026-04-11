import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowRight, Check, X as XIcon } from "lucide-react";
import { CarVisualization, type WheelColor } from "./CarVisualization";
import { LicensePlate } from "./LicensePlate";
import {
  getStoredRequests,
  storeRequests,
  STATUS_LABEL_KEYS,
  STATUS_STYLES,
  type OpenRequest,
  type WheelWork,
} from "./OpenRequests";
import { resolveVehicleWheelCount } from "../vehicleWheelLayout";
import { translateQualityTier } from "../qualityTier";

const WHEEL_POS_KEYS: Record<string, string> = {
  "front-right": "wheels.frontRight",
  "front-left": "wheels.frontLeft",
  "rear-right": "wheels.rearRight",
  "rear-left": "wheels.rearLeft",
  "rear-right-inner": "wheels.rearRightInner",
  "rear-left-inner": "wheels.rearLeftInner",
  "spare-tire": "wheels.spareTire",
};

function WheelDetailPopup({
  isOpen,
  onClose,
  wheelPosition,
  work,
}: {
  isOpen: boolean;
  onClose: () => void;
  wheelPosition: string;
  work: WheelWork;
}) {
  const { t } = useTranslation();
  if (!isOpen) return null;

  const services = [
    { labelKey: "services.puncture" as const, active: work.puncture },
    { labelKey: "services.balancing" as const, active: work.balancing },
    { labelKey: "services.sensor" as const, active: work.sensor },
  ];

  const approvalLabel =
    work.approval === "full"
      ? t("approval.full")
      : work.approval === "puncture-only"
        ? t("approval.punctureOnly")
        : t("approval.none");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-card rounded-2xl shadow-2xl p-6 w-full max-w-lg mx-4 border border-border">
        <button
          onClick={onClose}
          className="absolute top-4 start-4 text-muted-foreground hover:text-foreground transition-colors"
        >
          <XIcon className="w-6 h-6" />
        </button>

        <div className="space-y-5">
          <div className="text-center">
            <h2 className="text-xl font-semibold text-foreground">
              {WHEEL_POS_KEYS[wheelPosition] ? t(WHEEL_POS_KEYS[wheelPosition]) : wheelPosition}
            </h2>
            <div className="mt-2 flex justify-center">
              <span
                className={`inline-block px-3 py-1 rounded-full text-sm font-semibold border ${
                  work.approval === "full"
                    ? "bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300 border-green-300 dark:border-green-700"
                    : work.approval === "puncture-only"
                      ? "bg-orange-100 dark:bg-orange-900/40 text-orange-800 dark:text-orange-300 border-orange-300 dark:border-orange-700"
                      : "bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-300 border-red-300 dark:border-red-700"
                }`}
              >
                {approvalLabel}
              </span>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold text-foreground">{t("requestDetail.reason")}</label>
            <div className="w-full px-4 py-3 bg-muted border border-border rounded-lg text-foreground">
              {work.reason}
            </div>
          </div>

          <div className="space-y-3">
            {services.map((s) => (
              <div
                key={s.labelKey}
                className="flex items-center justify-between bg-background rounded-xl px-4 py-3 border border-border"
              >
                <span className="font-semibold text-foreground">{t(s.labelKey)}</span>
                <span
                  className={`px-3 py-1 rounded-full text-sm font-semibold ${
                    s.active
                      ? "bg-primary/10 dark:bg-blue-400/15 text-primary dark:text-blue-400"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {s.active ? t("common.yes") : t("common.no")}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ConfirmationPopup({
  isOpen,
  onClose,
  onConfirm,
}: {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (notes: string) => void;
}) {
  const { t } = useTranslation();
  const [notes, setNotes] = useState("");

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-card rounded-2xl shadow-2xl p-6 w-full max-w-lg mx-4 border border-border">
        <button
          onClick={onClose}
          className="absolute top-4 start-4 text-muted-foreground hover:text-foreground transition-colors"
        >
          <XIcon className="w-6 h-6" />
        </button>

        <div className="space-y-5">
          <div className="text-center">
            <h2 className="text-xl font-semibold text-foreground">{t("requestDetail.confirmTitle")}</h2>
            <p className="text-sm text-muted-foreground mt-1">
              {t("requestDetail.confirmQuestion")}
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold text-foreground">
              {t("requestDetail.notesLabel")}
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t("requestDetail.notesPlaceholder")}
              rows={4}
              className="w-full px-4 py-3 bg-input-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all resize-none"
            />
          </div>

          <button
            onClick={() => onConfirm(notes)}
            className="w-full bg-green-600 hover:bg-green-700 text-white py-3 rounded-xl transition-colors duration-200 shadow-md hover:shadow-lg font-semibold flex items-center justify-center gap-2"
          >
            <Check className="w-5 h-5" />
            {t("requestDetail.confirmButton")}
          </button>
        </div>
      </div>
    </div>
  );
}

export function RequestDetail() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [selectedWheel, setSelectedWheel] = useState<string | null>(null);
  const [detailWheel, setDetailWheel] = useState<string | null>(null);
  const [showConfirmation, setShowConfirmation] = useState(false);

  const requests = getStoredRequests();
  const request = requests.find((r) => r.id === id);

  if (!request) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground text-lg">{t("common.requestNotFound")}</p>
      </div>
    );
  }

  const statusStyles = STATUS_STYLES[request.status];
  const canConfirm = request.status === "approved" || request.status === "partly-approved";
  const wheels = request.wheels || {};
  const wheelCount = resolveVehicleWheelCount(request.licensePlate, request.wheelCount);
  const wheelColors: Record<string, WheelColor> = {};
  for (const [pos, work] of Object.entries(wheels)) {
    if (work.approval === "full") wheelColors[pos] = "green";
    else if (work.approval === "puncture-only") wheelColors[pos] = "orange";
    else wheelColors[pos] = "red";
  }
  const currentWheelWork = detailWheel ? wheels[detailWheel] : null;

  const handleWheelClick = (wheelPosition: string) => {
    setSelectedWheel(wheelPosition);
    if (wheels[wheelPosition]) {
      setDetailWheel(wheelPosition);
    }
  };

  const handleConfirm = (notes: string) => {
    console.log("Request confirmed:", request.id, "Notes:", notes);
    const updated = requests.filter((r) => r.id !== request.id);
    storeRequests(updated);
    setShowConfirmation(false);
    navigate("/open-requests");
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="bg-primary p-4 shadow-md">
        <div className="flex items-center justify-between max-w-6xl mx-auto">
          <button
            onClick={() => navigate("/open-requests")}
            className="text-primary-foreground hover:opacity-80 transition-opacity"
          >
            <ArrowRight className="w-6 h-6" />
          </button>
          <h1 className="text-xl text-primary-foreground font-semibold">{t("requestDetail.title")}</h1>
          <div className="w-6" />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 p-4 pb-8 overflow-y-auto">
        <div className="max-w-6xl mx-auto space-y-6">
          {/* License Plate */}
          <LicensePlate plateNumber={request.licensePlate} plateType={request.plateType} className="w-full max-w-md mx-auto" />

          {/* Status + request number + optional quality */}
          <div className="flex flex-col items-center gap-2">
            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
              <span
                className={`inline-block px-4 py-2 rounded-full text-base font-semibold ${statusStyles.bg} ${statusStyles.text} border ${statusStyles.border}`}
              >
                {t(STATUS_LABEL_KEYS[request.status])}
              </span>
              <span className="text-sm text-muted-foreground tabular-nums">
                {t("common.requestNumberLine", { requestNumber: request.requestNumber })}
              </span>
            </div>
            {request.quality != null && request.quality !== "" && (
              <span className="text-sm text-muted-foreground tabular-nums">
                {t("common.qualityLine", { quality: translateQualityTier(t, request.quality) })}
              </span>
            )}
          </div>

          {request.status === "declined" && request.rejectionReason && (
            <div className="bg-destructive/10 border border-destructive/25 rounded-xl p-4 max-w-2xl mx-auto w-full">
              <p className="text-sm font-semibold text-muted-foreground mb-2">
                {t("declinedRequest.rejectionReason")}
              </p>
              <p className="text-foreground text-base leading-relaxed whitespace-pre-wrap">
                {request.rejectionReason}
              </p>
            </div>
          )}

          {/* Car Visualization */}
          <div className="bg-card rounded-2xl p-6 shadow-md border border-border">
            <h3 className="text-lg font-semibold text-foreground mb-6 text-center">
              {t("requestDetail.wheelsInRequest")}
            </h3>
            <div className="relative w-full max-w-3xl mx-auto">
              <CarVisualization
                onWheelClick={handleWheelClick}
                selectedWheel={selectedWheel}
                wheelColors={wheelColors}
                frontTireSize={request.frontTireSize}
                rearTireSize={request.rearTireSize}
                frontTireProfile={request.frontTireProfile}
                rearTireProfile={request.rearTireProfile}
                showSpareTire={Boolean(wheels["spare-tire"])}
                wheelCount={wheelCount}
                plateType={request.plateType}
              />
            </div>
            <p className="text-center text-sm text-muted-foreground mt-4">
              {t("requestDetail.clickWheelHint")}
            </p>
          </div>

          {/* Front Alignment */}
          <div className="bg-card rounded-2xl p-6 shadow-md border border-border">
            <div className="flex items-center justify-between">
              <span className="text-lg font-semibold text-foreground">{t("common.frontAlignment")}</span>
              <span
                className={`px-3 py-1 rounded-full text-sm font-semibold ${
                  request.frontAlignment
                    ? "bg-primary/10 dark:bg-blue-400/15 text-primary dark:text-blue-400"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {request.frontAlignment ? t("common.yes") : t("common.no")}
              </span>
            </div>
          </div>

          {/* Confirm Button - only for approved / partly-approved */}
          {canConfirm && (
            <button
              onClick={() => setShowConfirmation(true)}
              className="w-full bg-green-600 hover:bg-green-700 text-white py-4 rounded-xl transition-colors duration-200 shadow-lg hover:shadow-xl font-semibold text-lg flex items-center justify-center gap-2"
            >
              <Check className="w-6 h-6" />
              {t("requestDetail.confirmButton")}
            </button>
          )}
        </div>
      </div>

      {/* Wheel Detail Popup */}
      {currentWheelWork && (
        <WheelDetailPopup
          isOpen={detailWheel !== null}
          onClose={() => setDetailWheel(null)}
          wheelPosition={detailWheel!}
          work={currentWheelWork}
        />
      )}

      {/* Confirmation Popup */}
      <ConfirmationPopup
        isOpen={showConfirmation}
        onClose={() => setShowConfirmation(false)}
        onConfirm={handleConfirm}
      />
    </div>
  );
}
