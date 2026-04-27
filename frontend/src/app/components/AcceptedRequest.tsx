import { useEffect, useState } from "react";
import { useNavigation } from "../NavigationContext";
import { useTranslation } from "react-i18next";
import { ArrowRight } from "lucide-react";
import { AxlesDiagram } from "./AxlesDiagram";
import { LicensePlate } from "./LicensePlate";
import { TirePopup, type WheelData } from "./TirePopup";
import { resolveVehicleWheelCount } from "../vehicleWheelLayout";

function getStoredAffectedWheels(plate: string): Record<string, WheelData> {
  try {
    const raw = sessionStorage.getItem(`affected-wheels-${plate}`);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function storeAffectedWheel(plate: string, wheel: string, data: WheelData) {
  const current = getStoredAffectedWheels(plate);
  current[wheel] = data;
  sessionStorage.setItem(`affected-wheels-${plate}`, JSON.stringify(current));
}

/**
 * Primary service-order screen shown after the ERP accepts a licence-plate lookup.
 *
 * Displays the axle diagram for the vehicle. The mechanic taps each wheel to open
 * `TirePopup` and record the work performed (replacement, repair, relocation, etc.).
 * Optionally launches the Carool AI photo flow via `CaroolCheck`.
 * On completion, submits the diagnosis via `POST /api/diagnosis` and navigates
 * back to `dashboard`.
 *
 * Per-wheel data is persisted in `sessionStorage` (key `affected-wheels-{plate}`)
 * so work is not lost if the user navigates away and returns mid-session.
 *
 * Navigation: reached from `LicensePlateModal` via `{ name: "accepted-request" }`.
 */
export function AcceptedRequest() {
  const { t } = useTranslation();
  const { screen, navigate } = useNavigation();
  if (screen.name !== "accepted-request") return null;
  const {
    plate: licensePlate,
    plateType,
    mileage,
    order_id,
    request_id,
    tireSizes,
    ownershipId,
    lastMileage,
    tireLevel,
    wheelCount: wheelCountHint,
    caroolNeeded,
  } = screen;
  const wheelCount = resolveVehicleWheelCount(
    licensePlate,
    wheelCountHint === 4 || wheelCountHint === 6 ? wheelCountHint : undefined,
  );
  const [spareTire, setSpareTire] = useState(
    () => "spare-tire" in getStoredAffectedWheels(licensePlate)
  );
  const [frontAlignment, setFrontAlignment] = useState(false);
  const [selectedWheel, setSelectedWheel] = useState<string | null>(null);
  const [popupWheel, setPopupWheel] = useState<string | null>(null);
  const [affectedWheels, setAffectedWheels] = useState<Record<string, WheelData>>(
    () => getStoredAffectedWheels(licensePlate)
  );
  const [showSuccess, setShowSuccess] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Default to `true` so the Carool entry points don't flash off and back on
  // before the runtime-config response arrives. The backend gate is the source
  // of truth — the worst case from this default is a single failed request
  // that the gated handlers respond to with `{ skipped: true }`.
  const [caroolEnabled, setCaroolEnabled] = useState(true);

  useEffect(() => {
    navigator.mediaDevices?.getUserMedia({ video: true })
      .then((s) => s.getTracks().forEach((t) => t.stop()))
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/config")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data && typeof data.carool_enabled === "boolean") {
          setCaroolEnabled(data.carool_enabled);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const reportedMileageNum = mileage ? Number(mileage) : null;
  const mileageDiff =
    typeof lastMileage === "number" && reportedMileageNum !== null
      ? lastMileage - reportedMileageNum
      : null;
  const showMileageWarning = mileageDiff !== null && mileageDiff > 0;

  const [editingMileage, setEditingMileage] = useState(false);
  const [mileageInput, setMileageInput] = useState(mileage ?? "");

  const handleWheelClick = (wheelPosition: string) => {
    setSelectedWheel(wheelPosition);
    setPopupWheel(wheelPosition);
  };

  const handlePopupSubmit = (wheel: string, data: WheelData) => {
    storeAffectedWheel(licensePlate, wheel, data);
    setAffectedWheels((prev) => ({ ...prev, [wheel]: data }));
  };

  const handleNavigateToCaroolCheck = (wheel: string) => {
    if (!caroolEnabled || (caroolNeeded != null && caroolNeeded !== 1)) return;
    const noCarool = wheel === "spare-tire" || wheel === "rear-right-inner" || wheel === "rear-left-inner";
    if (!noCarool) {
      navigate({ name: "carool-check", plate: licensePlate, plateType, wheels: [wheel], order_id });
    }
  };

  const NO_CAROOL_WHEELS = new Set(["spare-tire", "rear-right-inner", "rear-left-inner"]);

  const handleSubmitDiagnosis = async () => {
    if (isSubmitting) return;

    if (caroolEnabled && caroolNeeded === 1) {
      const photoDone: string[] = JSON.parse(
        sessionStorage.getItem(`carool-photos-done-${licensePlate}`) || "[]"
      );
      const photoDoneSet = new Set(photoDone);
      const missing = Object.entries(affectedWheels)
        .filter(([wheel, data]) => !NO_CAROOL_WHEELS.has(wheel) && (data.replacementReason !== null || data.puncture))
        .filter(([wheel]) => !photoDoneSet.has(wheel))
        .map(([wheel]) => wheel);
      if (missing.length > 0) {
        alert(t("acceptedRequest.caroolPhotosRequired"));
        return;
      }
    }

    type TireAction = {
      action: "replacement" | "puncture" | "sensor" | "tpms_valve" | "balancing" | "rim_repair" | "relocation";
      reason?: string;
      transfer_target?: string;
    };

    const tires: Record<string, TireAction[]> = {};
    for (const [wheel, data] of Object.entries(affectedWheels)) {
      const actions: TireAction[] = [];
      if (data.replacementReason) actions.push({ action: "replacement", reason: data.replacementReason });
      if (data.puncture) actions.push({ action: "puncture" });
      if (data.sensor) actions.push({ action: "sensor" });
      if (data.tpmsValve) actions.push({ action: "tpms_valve" });
      if (data.balancing) actions.push({ action: "balancing" });
      if (data.rimRepair) actions.push({ action: "rim_repair" });
      if (data.movedToWheel) actions.push({ action: "relocation", transfer_target: data.movedToWheel });
      if (actions.length > 0) tires[wheel] = actions;
    }

    const trimmedMileage = mileageInput.trim();
    const sourceMileage = trimmedMileage || (mileage ?? "");
    const parsed = sourceMileage ? parseInt(sourceMileage, 10) : NaN;
    const parsedMileage = Number.isFinite(parsed) ? parsed : null;

    setIsSubmitting(true);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch("/api/diagnosis", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          order_id,
          mileage_update: parsedMileage,
          front_alignment: frontAlignment,
          tires,
        }),
      });

      if (!res.ok) {
        alert("שגיאה בשליחת האבחון. נסו שוב.");
        return;
      }

      sessionStorage.removeItem(`affected-wheels-${licensePlate}`);
      setShowSuccess(true);
      setTimeout(() => {
        setShowSuccess(false);
        navigate({ name: "dashboard" });
      }, 1500);
    } catch {
      alert("שגיאה בשליחת האבחון. נסו שוב.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSpareTireChange = (enabled: boolean) => {
    setSpareTire(enabled);
    if (!enabled) {
      setAffectedWheels((prev) => {
        if (!("spare-tire" in prev)) return prev;
        const next = { ...prev };
        delete next["spare-tire"];
        sessionStorage.setItem(`affected-wheels-${licensePlate}`, JSON.stringify(next));
        return next;
      });
      setSelectedWheel((s) => (s === "spare-tire" ? null : s));
      setPopupWheel((p) => (p === "spare-tire" ? null : p));
    }
  };

  return (
    <div className="h-screen bg-background flex flex-col relative overflow-hidden" style={{ height: "100dvh" }}>
      {/* Header */}
      <div className="bg-primary px-4 py-2.5 shadow-md">
        <div className="flex items-center justify-between">
          <button
            onClick={() => navigate({ name: "dashboard" })}
            className="text-primary-foreground hover:opacity-80 transition-opacity"
          >
            <ArrowRight className="w-5 h-5" />
          </button>
          <h1 className="text-base text-primary-foreground font-semibold">{t("acceptedRequest.title")}</h1>
          <div className="w-5" />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 px-3 py-2 flex flex-col justify-between overflow-hidden">
        <div className="space-y-2">

          {/* License Plate */}
          <LicensePlate plateNumber={licensePlate} plateType={plateType} className="max-w-[260px] mx-auto" />

          {/* Mileage mismatch warning */}
          {showMileageWarning && (
            <div className="bg-red-50 dark:bg-red-950/40 border border-red-500 rounded-lg px-3 py-2.5">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-red-600 dark:text-red-400 leading-tight">
                    ⚠️ {t("acceptedRequest.mileageWarningTitle")}
                  </p>
                  <p className="text-xs text-red-500 dark:text-red-400 leading-tight mt-1">
                    {t("acceptedRequest.mileageWarningLastReported", { lastMileage: lastMileage!.toLocaleString() })}
                  </p>
                </div>
                {editingMileage ? (
                  <div className="flex gap-1.5 shrink-0">
                    <input
                      type="number"
                      value={mileageInput}
                      onChange={(e) => setMileageInput(e.target.value)}
                      className="w-24 text-xs rounded border border-red-400 bg-white dark:bg-red-950/60 text-foreground px-2 py-1.5 focus:outline-none"
                      dir="ltr"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        navigate({
                          name: "accepted-request",
                          plate: licensePlate,
                          plateType,
                          mileage: mileageInput,
                          order_id,
                          request_id,
                          tireSizes,
                          ownershipId,
                          lastMileage,
                          tireLevel,
                          wheelCount: wheelCountHint,
                          caroolNeeded,
                        })
                      }
                      className="px-2.5 py-1.5 rounded bg-red-500 text-white text-xs font-semibold hover:bg-red-600 transition-colors"
                    >
                      עדכן
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingMileage(false)}
                      className="px-2.5 py-1.5 rounded border border-red-400 text-red-600 dark:text-red-400 text-xs font-semibold hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
                    >
                      ביטול
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setEditingMileage(true)}
                    className="shrink-0 px-3 py-1.5 rounded border border-red-500 text-red-600 dark:text-red-400 text-xs font-semibold hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
                  >
                    {t("acceptedRequest.mileageWarningEditButton")}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Info chips — 2x2 grid */}
          <div className="grid grid-cols-2 gap-1.5">
            {plateType === "civilian" ? (
              <div className="bg-card rounded-lg border border-border px-2 py-1.5 text-center min-w-0">
                <p className="text-[10px] text-muted-foreground leading-tight truncate">{t("acceptedRequest.customerLabel")}</p>
                <p className="text-sm font-semibold text-foreground leading-tight truncate">{ownershipId ?? "—"}</p>
              </div>
            ) : (
              <div />
            )}
            <div className="bg-card rounded-lg border border-border px-2 py-1.5 text-center min-w-0">
              <p className="text-[10px] text-muted-foreground leading-tight truncate">{t("common.requestNumberLabel")}</p>
              <p className="text-sm font-semibold text-foreground tabular-nums leading-tight truncate">{request_id ?? order_id}</p>
            </div>
            <div className="bg-card rounded-lg border border-border px-2 py-1.5 text-center min-w-0">
              <p className="text-[10px] text-muted-foreground leading-tight truncate">{t("acceptedRequest.mileage")}</p>
              <p className="text-sm font-semibold text-foreground tabular-nums leading-tight" dir="ltr">
                {mileage ? `${Number(mileage).toLocaleString()} ${t("acceptedRequest.km")}` : "—"}
              </p>
            </div>
            <div className="bg-card rounded-lg border border-border px-2 py-1.5 text-center min-w-0">
              <p className="text-[10px] text-muted-foreground leading-tight truncate">איכות</p>
              <p className="text-sm font-semibold text-foreground leading-tight truncate">{tireLevel && tireLevel.length > 0 ? tireLevel : "—"}</p>
            </div>
          </div>

          {/* Wheel Selector */}
          <div className="bg-card rounded-xl p-1.5 shadow-md border border-border">
            <p className="text-xs font-semibold text-foreground mb-0.5 text-center">{t("acceptedRequest.selectWheel")}</p>
            <div className="relative mx-auto max-w-[240px]">
              <AxlesDiagram
                onWheelClick={handleWheelClick}
                selectedWheel={selectedWheel}
                affectedWheels={new Set(Object.keys(affectedWheels))}
                showSpareTire={spareTire}
                wheelCount={wheelCount}
              />
              {/* Tire size badges overlaid — top edge (above front tires) and bottom edge (below rear tires) */}
              {tireSizes?.front && (
                <div className="absolute inset-x-0 top-0 flex justify-center pointer-events-none">
                  <TireSizeBadge size={tireSizes.front} />
                </div>
              )}
              {tireSizes?.rear && (
                <div className="absolute inset-x-0 flex justify-center pointer-events-none" style={{ top: "76%" }}>
                  <TireSizeBadge size={tireSizes.rear} />
                </div>
              )}
            </div>
          </div>

          {/* Spare tire + Front Alignment */}
          <div className="bg-card rounded-xl px-4 py-3 shadow-md border border-border space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">{t("common.spareTire")}</span>
              <button
                dir="ltr"
                type="button"
                onClick={() => handleSpareTireChange(!spareTire)}
                className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors duration-300 ${
                  spareTire ? "bg-primary" : "bg-muted"
                }`}
              >
                <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform duration-300 ${spareTire ? "translate-x-[3px]" : "translate-x-[28px]"}`} />
              </button>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">{t("common.frontAlignment")}</span>
              <button
                dir="ltr"
                type="button"
                onClick={() => setFrontAlignment(!frontAlignment)}
                className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors duration-300 ${
                  frontAlignment ? "bg-primary" : "bg-muted"
                }`}
              >
                <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform duration-300 ${frontAlignment ? "translate-x-[3px]" : "translate-x-[28px]"}`} />
              </button>
            </div>
          </div>

        </div>

        {/* Continue Button */}
        <button
          onClick={handleSubmitDiagnosis}
          disabled={isSubmitting}
          className="w-full bg-primary hover:bg-primary/90 text-primary-foreground py-2.5 rounded-xl transition-colors duration-200 shadow-lg font-semibold text-sm mb-1 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isSubmitting ? (
            <span className="inline-flex items-center justify-center gap-2">
              <span className="w-4 h-4 border-2 border-primary-foreground/40 border-t-primary-foreground rounded-full animate-spin" />
              {t("common.continue")}
            </span>
          ) : (
            t("common.continue")
          )}
        </button>
      </div>

      {/* Success confirmation overlay */}
      {showSuccess && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-4 bg-card border border-border rounded-2xl px-10 py-8 shadow-xl">
            <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/40 flex items-center justify-center">
              <svg className="w-9 h-9 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <span className="text-lg font-bold text-foreground">נשלח בהצלחה</span>
          </div>
        </div>
      )}

      <TirePopup
        isOpen={popupWheel !== null}
        onClose={() => setPopupWheel(null)}
        wheelPosition={popupWheel || ""}
        licensePlate={licensePlate}
        onSubmit={handlePopupSubmit}
        onNavigateToCaroolCheck={handleNavigateToCaroolCheck}
        caroolEnabled={caroolEnabled}
        spareTireEnabled={spareTire}
        wheelCount={wheelCount}
        initialData={popupWheel ? affectedWheels[popupWheel] : undefined}
      />
    </div>
  );
}

function TireSizeBadge({ size, profile }: { size: string; profile?: string }) {
  const label = profile ? `${size} · ${profile}` : size;
  return (
    <p className="text-center">
      <span className="text-[10px] font-bold text-foreground bg-muted/90 px-2 py-px rounded-full tabular-nums shadow-sm" dir="ltr">
        {label}
      </span>
    </p>
  );
}
