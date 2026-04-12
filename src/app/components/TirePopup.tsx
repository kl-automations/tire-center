import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight } from "lucide-react";
import { getRoadWheelPositions, type VehicleWheelCount } from "../vehicleWheelLayout";

export type TireIssueMode = "replacement" | "repair" | "relocation";
export type ReplacementReason = "wear" | "damage" | "fitment";

export interface WheelData {
  // Replacement
  replacementReason: ReplacementReason | null;
  // Repair switches
  sensor: boolean;
  tpmsValve: boolean;
  balancing: boolean;
  rimRepair: boolean;
  puncture: boolean;        // disabled when replacementReason is set
  // Relocation
  movedToWheel: string | null;
  // Legacy fields kept for RequestDetail / HistoryDetail display
  mode: TireIssueMode;
  reason: string;
}

interface TirePopupProps {
  isOpen: boolean;
  onClose: () => void;
  wheelPosition: string;
  licensePlate: string;
  onSubmit: (wheelPosition: string, data: WheelData) => void;
  onNavigateToCaroolCheck: () => void;
  spareTireEnabled?: boolean;
  wheelCount?: VehicleWheelCount;
}

const WHEEL_POS_KEYS: Record<string, string> = {
  "front-right":      "wheels.frontRight",
  "front-left":       "wheels.frontLeft",
  "rear-right":       "wheels.rearRight",
  "rear-left":        "wheels.rearLeft",
  "rear-right-inner": "wheels.rearRightInner",
  "rear-left-inner":  "wheels.rearLeftInner",
  "spare-tire":       "wheels.spareTire",
};

const REPLACEMENT_REASONS: ReplacementReason[] = ["wear", "damage", "fitment"];

function otherWheelPositions(
  current: string,
  spareTireEnabled: boolean,
  wheelCount: VehicleWheelCount
): string[] {
  const road = getRoadWheelPositions(wheelCount);
  const all = spareTireEnabled ? [...road, "spare-tire"] : road;
  return all.filter((w) => w !== current);
}

export function TirePopup({
  isOpen,
  onClose,
  wheelPosition,
  onSubmit,
  onNavigateToCaroolCheck,
  spareTireEnabled = false,
  wheelCount = 4,
}: TirePopupProps) {
  const { t } = useTranslation();

  const [replacementReason, setReplacementReason] = useState<ReplacementReason | null>(null);
  const [sensor, setSensor] = useState(false);
  const [tpmsValve, setTpmsValve] = useState(false);
  const [balancing, setBalancing] = useState(false);
  const [rimRepair, setRimRepair] = useState(false);
  const [puncture, setPuncture] = useState(false);
  const [movedToWheel, setMovedToWheel] = useState<string | null>(null);

  const reset = useCallback(() => {
    setReplacementReason(null);
    setSensor(false);
    setTpmsValve(false);
    setBalancing(false);
    setRimRepair(false);
    setPuncture(false);
    setMovedToWheel(null);
  }, []);

  useEffect(() => {
    if (isOpen) reset();
  }, [isOpen, wheelPosition, reset]);

  if (!isOpen) return null;

  const hasReplacement = replacementReason !== null;
  const effectivePuncture = puncture && !hasReplacement;

  const canContinue =
    hasReplacement ||
    sensor || tpmsValve || balancing || rimRepair || effectivePuncture ||
    movedToWheel !== null;

  const handleContinue = () => {
    if (!canContinue) return;
    const mode: TireIssueMode = hasReplacement
      ? "replacement"
      : movedToWheel
        ? "relocation"
        : "repair";

    onSubmit(wheelPosition, {
      replacementReason,
      sensor,
      tpmsValve,
      balancing,
      rimRepair,
      puncture: effectivePuncture,
      movedToWheel,
      mode,
      reason: replacementReason ?? "",
    });
    reset();
    onClose();
    onNavigateToCaroolCheck();
  };

  const title = WHEEL_POS_KEYS[wheelPosition] ? t(WHEEL_POS_KEYS[wheelPosition]) : wheelPosition;
  const relocationTargets = otherWheelPositions(wheelPosition, spareTireEnabled, wheelCount);

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      {/* Header */}
      <div className="bg-primary px-4 py-2.5 shadow-md shrink-0">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="text-primary-foreground hover:opacity-80 transition-opacity"
          >
            <ArrowRight className="w-5 h-5" />
          </button>
          <h1 className="text-base text-primary-foreground font-semibold">{title}</h1>
          <div className="w-5" />
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">

        {/* החלפה */}
        <section>
          <SectionLabel>{t("tirePopup.sectionReplacement")}</SectionLabel>
          <div className="grid grid-cols-3 gap-2 mt-2">
            {REPLACEMENT_REASONS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setReplacementReason(replacementReason === r ? null : r)}
                className={`py-2.5 rounded-xl text-sm font-semibold border-2 transition-all duration-150 ${
                  replacementReason === r
                    ? "border-primary bg-primary text-primary-foreground shadow-sm"
                    : "border-border bg-card text-foreground hover:border-primary/50"
                }`}
              >
                {t(`tirePopup.replacementReason.${r}`)}
              </button>
            ))}
          </div>
        </section>

        {/* תיקון */}
        <section>
          <SectionLabel>{t("tirePopup.sectionRepair")}</SectionLabel>
          <div className="mt-2 space-y-1.5">
            <ToggleRow label={t("services.sensor")}   value={sensor}    onChange={setSensor} />
            <ToggleRow label={t("services.tpmsValve")} value={tpmsValve} onChange={setTpmsValve} />
            <ToggleRow label={t("services.balancing")} value={balancing} onChange={setBalancing} />
            <ToggleRow label={t("services.rimRepair")} value={rimRepair} onChange={setRimRepair} />
            <ToggleRow
              label={t("services.puncture")}
              value={effectivePuncture}
              onChange={setPuncture}
              disabled={hasReplacement}
            />
          </div>
        </section>

        {/* העברה — not available for spare tire */}
        {wheelPosition !== "spare-tire" && (
          <section>
            <SectionLabel>{t("tirePopup.sectionRelocation")}</SectionLabel>
            <div className="mt-2 flex flex-wrap gap-2">
              {relocationTargets.map((pos) => (
                <button
                  key={pos}
                  type="button"
                  onClick={() => setMovedToWheel(movedToWheel === pos ? null : pos)}
                  className={`px-4 py-2 rounded-xl text-sm font-semibold border-2 transition-all duration-150 ${
                    movedToWheel === pos
                      ? "border-primary bg-primary text-primary-foreground shadow-sm"
                      : "border-border bg-card text-foreground hover:border-primary/50"
                  }`}
                >
                  {WHEEL_POS_KEYS[pos] ? t(WHEEL_POS_KEYS[pos]) : pos}
                </button>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* Continue button */}
      <div className="shrink-0 px-4 pb-5 pt-2 border-t border-border bg-background">
        <button
          type="button"
          onClick={handleContinue}
          disabled={!canContinue}
          className="w-full bg-primary hover:bg-primary/90 text-primary-foreground py-3 rounded-xl font-semibold transition-colors duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {t("tirePopup.continueToCheck")}
        </button>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-sm font-bold text-foreground">{children}</span>
      <div className="flex-1 h-px bg-border" />
    </div>
  );
}

function ToggleRow({
  label,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between bg-card rounded-xl px-3 py-2.5 border border-border transition-opacity ${disabled ? "opacity-35" : ""}`}>
      <span className="text-sm font-medium text-foreground">{label}</span>
      <button
        dir="ltr"
        type="button"
        onClick={() => !disabled && onChange(!value)}
        disabled={disabled}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-300 ${
          value ? "bg-primary" : "bg-muted"
        }`}
      >
        <span
          className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform duration-300 ${
            value ? "translate-x-[3px]" : "translate-x-[27px]"
          }`}
        />
      </button>
    </div>
  );
}
