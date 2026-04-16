import { useEffect, useState } from "react";
import { useNavigation } from "../NavigationContext";
import { useTranslation } from "react-i18next";
import { ArrowRight } from "lucide-react";
import { AxlesDiagram } from "./AxlesDiagram";
import { LicensePlate, type PlateType } from "./LicensePlate";
import { TirePopup, type WheelData } from "./TirePopup";
import { resolveVehicleWheelCount } from "../vehicleWheelLayout";
import { type QualityTier, translateQualityTier } from "../qualityTier";

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

/** Car rental / fleet provider name for civilian plates — replace with API later */
function getCustomerNameForPlate(_plate: string): string {
  return "Hertz";
}

/** Request / case number (digits) — replace with API later */
function getRequestNumberForPlate(_plate: string): string {
  return "10048239";
}

/** Load index + speed rating e.g. 91V — replace with API later */
function getFrontTireProfileForPlate(_plate: string): string {
  return "91V";
}

function getRearTireProfileForPlate(_plate: string): string {
  return "94W";
}

/** Quality tier — one of סיני / משודרג / פרימיום; replace with API later */
function getQualityTierForPlate(_plate: string): QualityTier {
  return "premium";
}

/** Last recorded mileage on file — replace with API later. Returns null if no history. */
function getLastRecordedMileage(plate: string): number | null {
  if (plate === "12345") return 120000;
  return null;
}

export function AcceptedRequest() {
  const { t } = useTranslation();
  const { screen, navigate } = useNavigation();
  if (screen.name !== "accepted-request") return null;
  const { plate: licensePlate, plateType, mileage } = screen;
  const wheelCount = resolveVehicleWheelCount(licensePlate, undefined);
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

  useEffect(() => {
    navigator.mediaDevices?.getUserMedia({ video: true })
      .then((s) => s.getTracks().forEach((t) => t.stop()))
      .catch(() => {});
  }, []);

  const lastMileage = getLastRecordedMileage(licensePlate);
  const reportedMileageNum = mileage ? Number(mileage) : null;
  const mileageDiff =
    lastMileage !== null && reportedMileageNum !== null
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

  const handleNavigateToCaroolCheck = () => {
    // Read from sessionStorage — affectedWheels React state may still be stale
    // at this point because setAffectedWheels is async.
    navigate({ name: "carool-check", plate: licensePlate, plateType, wheels: Object.keys(getStoredAffectedWheels(licensePlate)) });
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
                      onClick={() => navigate({ name: "accepted-request", plate: licensePlate, plateType, mileage: mileageInput })}
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

          {/* Info chips — single row */}
          <div className="flex gap-1.5">
            {plateType === "civilian" && (
              <div className="flex-1 bg-card rounded-lg border border-border px-2 py-1.5 text-center min-w-0">
                <p className="text-[10px] text-muted-foreground leading-tight truncate">{t("acceptedRequest.customerLabel")}</p>
                <p className="text-sm font-semibold text-foreground leading-tight truncate">{getCustomerNameForPlate(licensePlate)}</p>
              </div>
            )}
            <div className="flex-1 bg-card rounded-lg border border-border px-2 py-1.5 text-center min-w-0">
              <p className="text-[10px] text-muted-foreground leading-tight truncate">{t("common.requestNumberLabel")}</p>
              <p className="text-sm font-semibold text-foreground tabular-nums leading-tight truncate">{getRequestNumberForPlate(licensePlate)}</p>
            </div>
            <div className="flex-1 bg-card rounded-lg border border-border px-2 py-1.5 text-center min-w-0">
              <p className="text-[10px] text-muted-foreground leading-tight truncate">{t("common.qualityLabel")}</p>
              <p className="text-sm font-semibold text-foreground leading-tight truncate">{translateQualityTier(t, getQualityTierForPlate(licensePlate))}</p>
            </div>
            {mileage && (
              <div className="flex-1 bg-card rounded-lg border border-border px-2 py-1.5 text-center min-w-0">
                <p className="text-[10px] text-muted-foreground leading-tight truncate">{t("acceptedRequest.mileage")}</p>
                <p className="text-sm font-semibold text-foreground tabular-nums leading-tight" dir="ltr">{Number(mileage).toLocaleString()} {t("acceptedRequest.km")}</p>
              </div>
            )}
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
              <div className="absolute inset-x-0 top-0 flex justify-center pointer-events-none">
                <TireSizeBadge size="205/55R16" profile={getFrontTireProfileForPlate(licensePlate)} />
              </div>
              <div className="absolute inset-x-0 flex justify-center pointer-events-none" style={{ top: "76%" }}>
                <TireSizeBadge size="225/45R17" profile={getRearTireProfileForPlate(licensePlate)} />
              </div>
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
          onClick={() => {
            setShowSuccess(true);
            setTimeout(() => {
              setShowSuccess(false);
              navigate({ name: "dashboard" });
            }, 1500);
          }}
          className="w-full bg-primary hover:bg-primary/90 text-primary-foreground py-2.5 rounded-xl transition-colors duration-200 shadow-lg font-semibold text-sm mb-1"
        >
          {t("common.continue")}
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
