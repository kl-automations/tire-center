import { useState } from "react";
import { useNavigation } from "../NavigationContext";
import { useTranslation } from "react-i18next";
import { ArrowRight, X as XIcon } from "lucide-react";
import { getDateLocaleForLanguage, useTheme } from "../ThemeContext";
import { CarVisualization, type WheelColor } from "./CarVisualization";
import { LicensePlate } from "./LicensePlate";
import { STATUS_LABEL_KEYS, STATUS_STYLES, type WheelWork } from "./OpenRequests";
import { getHistoryEntry } from "./RequestHistory";
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
            <label className="text-sm font-semibold text-foreground">{t("historyDetail.reason")}</label>
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

export function HistoryDetail() {
  const { t } = useTranslation();
  const { language } = useTheme();
  const dateLocale = getDateLocaleForLanguage(language);
  const { screen, navigate } = useNavigation();
  if (screen.name !== "history-detail") return null;
  const { id } = screen;
  const [selectedWheel, setSelectedWheel] = useState<string | null>(null);
  const [detailWheel, setDetailWheel] = useState<string | null>(null);

  const entry = getHistoryEntry(id || "");

  if (!entry) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground text-lg">{t("common.requestNotFound")}</p>
      </div>
    );
  }

  const statusStyles = STATUS_STYLES[entry.status];
  const wheels = entry.wheels || {};
  const wheelCount = resolveVehicleWheelCount(entry.licensePlate, entry.wheelCount);
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

  const completedDate = new Date(entry.completedDate).toLocaleDateString(dateLocale, {
    day: "numeric",
    month: "numeric",
    year: "numeric",
  });

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="bg-primary p-4 shadow-md">
        <div className="flex items-center justify-between max-w-6xl mx-auto">
          <button
            onClick={() => navigate({ name: "history" })}
            className="text-primary-foreground hover:opacity-80 transition-opacity"
          >
            <ArrowRight className="w-6 h-6" />
          </button>
          <h1 className="text-xl text-primary-foreground font-semibold">{t("historyDetail.title")}</h1>
          <div className="w-6" />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 p-4 pb-8 overflow-y-auto">
        <div className="max-w-6xl mx-auto space-y-6">
          {/* License Plate */}
          <LicensePlate plateNumber={entry.licensePlate} plateType={entry.plateType} className="w-full max-w-md mx-auto" />

          {/* Status + request number + optional quality + date */}
          <div className="flex flex-col items-center gap-3">
            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
              <span
                className={`inline-block px-4 py-2 rounded-full text-base font-semibold ${statusStyles.bg} ${statusStyles.text} border ${statusStyles.border}`}
              >
                {t(STATUS_LABEL_KEYS[entry.status])}
              </span>
              <span className="text-sm text-muted-foreground tabular-nums">
                {t("common.requestNumberLine", { requestNumber: entry.requestNumber })}
              </span>
            </div>
            {entry.quality != null && entry.quality !== "" && (
              <span className="text-sm text-muted-foreground tabular-nums">
                {t("common.qualityLine", { quality: translateQualityTier(t, entry.quality) })}
              </span>
            )}
            <span className="text-sm text-muted-foreground">
              {entry.status === "declined"
                ? t("historyDetail.rejectedOnPrefix")
                : t("historyDetail.completedPrefix")}{" "}
              {completedDate}
            </span>
          </div>

          {entry.status === "declined" && entry.rejectionReason && (
            <div className="bg-destructive/10 border border-destructive/25 rounded-xl p-4 max-w-2xl mx-auto w-full">
              <p className="text-sm font-semibold text-muted-foreground mb-2">
                {t("declinedRequest.rejectionReason")}
              </p>
              <p className="text-foreground text-base leading-relaxed whitespace-pre-wrap">
                {entry.rejectionReason}
              </p>
            </div>
          )}

          {/* Car Visualization */}
          <div className="bg-card rounded-2xl p-6 shadow-md border border-border">
            <h3 className="text-lg font-semibold text-foreground mb-6 text-center">
              {t("historyDetail.wheelsInRequest")}
            </h3>
            <div className="relative w-full max-w-3xl mx-auto">
              <CarVisualization
                onWheelClick={handleWheelClick}
                selectedWheel={selectedWheel}
                wheelColors={wheelColors}
                frontTireSize={entry.frontTireSize}
                rearTireSize={entry.rearTireSize}
                frontTireProfile={entry.frontTireProfile}
                rearTireProfile={entry.rearTireProfile}
                showSpareTire={Boolean(entry.wheels["spare-tire"])}
                wheelCount={wheelCount}
                plateType={entry.plateType}
              />
            </div>
            <p className="text-center text-sm text-muted-foreground mt-4">
              {t("historyDetail.clickWheelHint")}
            </p>
          </div>

          {/* Front Alignment */}
          <div className="bg-card rounded-2xl p-6 shadow-md border border-border">
            <div className="flex items-center justify-between">
              <span className="text-lg font-semibold text-foreground">{t("common.frontAlignment")}</span>
              <span
                className={`px-3 py-1 rounded-full text-sm font-semibold ${
                  entry.frontAlignment
                    ? "bg-primary/10 dark:bg-blue-400/15 text-primary dark:text-blue-400"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {entry.frontAlignment ? t("common.yes") : t("common.no")}
              </span>
            </div>
          </div>

          {/* Notes — only when work was completed (not declined) */}
          {entry.status !== "declined" && entry.notes && (
            <div className="bg-card rounded-2xl p-6 shadow-md border border-border">
              <h3 className="text-lg font-semibold text-foreground mb-2">{t("historyDetail.executionNotes")}</h3>
              <p className="text-foreground">{entry.notes}</p>
            </div>
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
    </div>
  );
}
