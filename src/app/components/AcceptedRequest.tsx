import { useState } from "react";
import { useNavigation } from "../NavigationContext";
import { useTranslation } from "react-i18next";
import { ArrowRight } from "lucide-react";
import { CarVisualization } from "./CarVisualization";
import { LicensePlate, type PlateType } from "./LicensePlate";
import { TirePopup, type WheelData } from "./TirePopup";
import { resolveVehicleWheelCount, type VehicleWheelCount } from "../vehicleWheelLayout";
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
  const { plate: licensePlate, plateType } = screen;
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
      <div className="bg-primary p-4 shadow-md">
        <div className="flex items-center justify-between max-w-6xl mx-auto">
          <button
            onClick={() => navigate({ name: "dashboard" })}
            className="text-primary-foreground hover:opacity-80 transition-opacity"
          >
            <ArrowRight className="w-6 h-6" />
          </button>
          <h1 className="text-xl text-primary-foreground font-semibold">{t("acceptedRequest.title")}</h1>
          <div className="w-6" /> {/* Spacer for alignment */}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 p-4 pb-8 overflow-y-auto">
        <div className="max-w-6xl mx-auto space-y-6">
          {/* License Plate Display */}
          <div className="space-y-4">
            <LicensePlate plateNumber={licensePlate} plateType={plateType} className="w-full max-w-md mx-auto" />
            {plateType === "civilian" && (
              <div className="w-full max-w-lg mx-auto rounded-2xl border border-border bg-card px-6 py-4 shadow-sm space-y-2">
                <p
                  className="text-center text-xl sm:text-2xl font-semibold text-foreground"
                  aria-live="polite"
                >
                  {t("acceptedRequest.identified", {
                    customerName: getCustomerNameForPlate(licensePlate),
                  })}
                </p>
                <p className="text-center text-sm text-muted-foreground tabular-nums">
                  {t("common.requestNumberLine", {
                    requestNumber: getRequestNumberForPlate(licensePlate),
                  })}
                </p>
                <p className="text-center text-sm text-muted-foreground tabular-nums">
                  {t("common.qualityLine", {
                    quality: translateQualityTier(t, getQualityTierForPlate(licensePlate)),
                  })}
                </p>
              </div>
            )}
          </div>

          {/* Car View with Clickable Wheels */}
          <div className="bg-card rounded-2xl p-6 shadow-md border border-border">
            <h3 className="text-lg font-semibold text-foreground mb-6 text-center">{t("acceptedRequest.selectWheel")}</h3>
            
            {/* Responsive SVG Car Visualization */}
            <div className="relative w-full max-w-3xl mx-auto">
              <CarVisualization
                onWheelClick={handleWheelClick}
                selectedWheel={selectedWheel}
                affectedWheels={new Set(Object.keys(affectedWheels))}
                frontTireSize="205/55R16"
                rearTireSize="225/45R17"
                frontTireProfile={getFrontTireProfileForPlate(licensePlate)}
                rearTireProfile={getRearTireProfileForPlate(licensePlate)}
                showSpareTire={spareTire}
                wheelCount={wheelCount}
                plateType={plateType}
              />
            </div>
          </div>

          {/* Spare tire switch */}
          <div className="bg-card rounded-2xl p-6 shadow-md border border-border">
            <div className="flex items-center justify-between">
              <span className="text-lg font-semibold text-foreground">{t("common.spareTire")}</span>
              <button
                dir="ltr"
                type="button"
                onClick={() => handleSpareTireChange(!spareTire)}
                className={`relative inline-flex h-10 w-20 items-center rounded-full transition-colors duration-300 ${
                  spareTire ? "bg-primary dark:bg-blue-500" : "bg-muted"
                }`}
              >
                <span
                  className={`inline-block h-8 w-8 rounded-full bg-white shadow-lg transition-transform duration-300 ${
                    spareTire ? "translate-x-[4px]" : "translate-x-[44px]"
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Front Alignment Switch */}
          <div className="bg-card rounded-2xl p-6 shadow-md border border-border">
            <div className="flex items-center justify-between">
              <span className="text-lg font-semibold text-foreground">{t("common.frontAlignment")}</span>
              <button
                dir="ltr"
                onClick={() => setFrontAlignment(!frontAlignment)}
                className={`relative inline-flex h-10 w-20 items-center rounded-full transition-colors duration-300 ${
                  frontAlignment ? 'bg-primary dark:bg-blue-500' : 'bg-muted'
                }`}
              >
                <span
                  className={`inline-block h-8 w-8 rounded-full bg-white shadow-lg transition-transform duration-300 ${
                    frontAlignment ? 'translate-x-[4px]' : 'translate-x-[44px]'
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Continue Button */}
          <button
            onClick={() => navigate({ name: "dashboard" })}
            className="w-full bg-primary hover:bg-primary/90 text-primary-foreground py-4 rounded-xl transition-colors duration-200 shadow-lg hover:shadow-xl font-semibold text-lg"
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