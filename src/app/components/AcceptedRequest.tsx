import { useState } from "react";
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

  const handleWheelClick = (wheelPosition: string) => {
    setSelectedWheel(wheelPosition);
    setPopupWheel(wheelPosition);
  };

  const handlePopupSubmit = (wheel: string, data: WheelData) => {
    storeAffectedWheel(licensePlate, wheel, data);
    setAffectedWheels((prev) => ({ ...prev, [wheel]: data }));
  };

  const handleNavigateToCaroolCheck = () => {
    navigate({ name: "carool-check", plate: licensePlate, plateType });
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
    <div className="min-h-screen bg-background flex flex-col">
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
      <div className="flex-1 px-3 py-2 overflow-y-auto">
        <div className="space-y-2">

          {/* License Plate */}
          <LicensePlate plateNumber={licensePlate} plateType={plateType} className="max-w-[260px] mx-auto" />

          {/* Info chips — single row */}
          <div className="flex gap-1.5">
            {plateType === "civilian" && (
              <div className="flex-1 bg-card rounded-lg border border-border px-1.5 py-1 text-center min-w-0">
                <p className="text-[9px] text-muted-foreground leading-tight truncate">{t("acceptedRequest.customerLabel")}</p>
                <p className="text-xs font-semibold text-foreground leading-tight truncate">{getCustomerNameForPlate(licensePlate)}</p>
              </div>
            )}
            {plateType === "civilian" && (
              <div className="flex-1 bg-card rounded-lg border border-border px-1.5 py-1 text-center min-w-0">
                <p className="text-[9px] text-muted-foreground leading-tight truncate">{t("common.requestNumberLabel")}</p>
                <p className="text-xs font-semibold text-foreground tabular-nums leading-tight truncate">{getRequestNumberForPlate(licensePlate)}</p>
              </div>
            )}
            {plateType === "civilian" && (
              <div className="flex-1 bg-card rounded-lg border border-border px-1.5 py-1 text-center min-w-0">
                <p className="text-[9px] text-muted-foreground leading-tight truncate">{t("common.qualityLabel")}</p>
                <p className="text-xs font-semibold text-foreground leading-tight truncate">{translateQualityTier(t, getQualityTierForPlate(licensePlate))}</p>
              </div>
            )}
            {mileage && (
              <div className="flex-1 bg-card rounded-lg border border-border px-1.5 py-1 text-center min-w-0">
                <p className="text-[9px] text-muted-foreground leading-tight truncate">{t("acceptedRequest.mileage")}</p>
                <p className="text-xs font-semibold text-foreground tabular-nums leading-tight" dir="ltr">{Number(mileage).toLocaleString()} {t("acceptedRequest.km")}</p>
              </div>
            )}
          </div>

          {/* Wheel Selector */}
          <div className="bg-card rounded-xl p-2 shadow-md border border-border">
            <p className="text-xs font-semibold text-foreground mb-1 text-center">{t("acceptedRequest.selectWheel")}</p>
            <TireSizeBadge size="205/55R16" profile={getFrontTireProfileForPlate(licensePlate)} />
            <div className="max-w-[210px] mx-auto">
              <AxlesDiagram
                onWheelClick={handleWheelClick}
                selectedWheel={selectedWheel}
                affectedWheels={new Set(Object.keys(affectedWheels))}
                showSpareTire={spareTire}
                wheelCount={wheelCount}
              />
            </div>
            <TireSizeBadge size="225/45R17" profile={getRearTireProfileForPlate(licensePlate)} />
          </div>

          {/* Spare tire + Front Alignment */}
          <div className="bg-card rounded-xl px-3 py-2 shadow-md border border-border space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-foreground">{t("common.spareTire")}</span>
              <button
                dir="ltr"
                type="button"
                onClick={() => handleSpareTireChange(!spareTire)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-300 ${
                  spareTire ? "bg-primary" : "bg-muted"
                }`}
              >
                <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform duration-300 ${spareTire ? "translate-x-[3px]" : "translate-x-[27px]"}`} />
              </button>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-foreground">{t("common.frontAlignment")}</span>
              <button
                dir="ltr"
                type="button"
                onClick={() => setFrontAlignment(!frontAlignment)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-300 ${
                  frontAlignment ? "bg-primary" : "bg-muted"
                }`}
              >
                <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform duration-300 ${frontAlignment ? "translate-x-[3px]" : "translate-x-[27px]"}`} />
              </button>
            </div>
          </div>

          {/* Continue Button */}
          <button
            onClick={() => navigate({ name: "dashboard" })}
            className="w-full bg-primary hover:bg-primary/90 text-primary-foreground py-2.5 rounded-xl transition-colors duration-200 shadow-lg font-semibold text-sm"
          >
            {t("common.continue")}
          </button>
        </div>
      </div>

      <TirePopup
        isOpen={popupWheel !== null}
        onClose={() => setPopupWheel(null)}
        wheelPosition={popupWheel || ""}
        licensePlate={licensePlate}
        onSubmit={handlePopupSubmit}
        onNavigateToCaroolCheck={handleNavigateToCaroolCheck}
        spareTireEnabled={spareTire}
        wheelCount={wheelCount}
      />
    </div>
  );
}

function TireSizeBadge({ size, profile }: { size: string; profile?: string }) {
  const label = profile ? `${size} · ${profile}` : size;
  return (
    <p className="text-center my-1">
      <span className="text-xs font-bold text-foreground bg-muted px-3 py-0.5 rounded-full tabular-nums" dir="ltr">
        {label}
      </span>
    </p>
  );
}
