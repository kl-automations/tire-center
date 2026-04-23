import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight } from "lucide-react";
import { getRoadWheelPositions, type VehicleWheelCount } from "../vehicleWheelLayout";

/**
 * The primary action being performed on a tyre during a service visit.
 *
 * - `replacement` — tyre is being replaced (requires a `ReplacementReason`).
 * - `repair`      — tyre stays on the vehicle; one or more repairs are applied.
 * - `relocation`  — tyre is physically moved to a different wheel position.
 */
export type TireIssueMode = "replacement" | "repair" | "relocation";

/**
 * The reason a tyre is being replaced.
 *
 * - `wear`    — tyre has reached end of its service life (tread depth).
 * - `damage`  — tyre has sustained physical damage (cut, bulge, etc.).
 * - `fitment` — tyre is the wrong size or type for the vehicle.
 */
export type ReplacementReason = "wear" | "damage" | "fitment";

/**
 * All work data captured for a single wheel by the `TirePopup` form.
 *
 * This is the edit-time shape — the mechanic fills it in during the
 * `AcceptedRequest` screen. On submission it is converted to `WheelWork`
 * (in OpenRequests.tsx) which is the read/display shape.
 * Both shapes are persisted in `open_orders.diagnosis` JSONB.
 */
export interface WheelData {
  /** Reason for tyre replacement. `null` when the tyre is not being replaced. */
  replacementReason: ReplacementReason | null;
  /** Whether a TPMS sensor is being replaced. */
  sensor: boolean;
  /** Whether a TPMS valve stem is being replaced. */
  tpmsValve: boolean;
  /** Whether wheel balancing is being performed. */
  balancing: boolean;
  /** Whether rim repair is being performed. */
  rimRepair: boolean;
  /** Whether a puncture repair is being performed. Disabled when `replacementReason` is set. */
  puncture: boolean;
  /** Target wheel position when relocating a tyre. `null` if not relocating. */
  movedToWheel: string | null;
  /** Primary action mode; drives which UI section is expanded in TirePopup. */
  mode: TireIssueMode;
  /** Human-readable summary of the work, used in RequestDetail / history display. */
  reason: string;
}

interface TirePopupProps {
  isOpen: boolean;
  onClose: () => void;
  wheelPosition: string;
  licensePlate: string;
  onSubmit: (wheelPosition: string, data: WheelData) => void;
  onNavigateToCaroolCheck: (wheel: string) => void;
  spareTireEnabled?: boolean;
  wheelCount?: VehicleWheelCount;
  initialData?: WheelData;
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

/**
 * Bottom-sheet popup for recording all work performed on a single wheel.
 *
 * Opened by tapping a wheel in `AxlesDiagram` during the `AcceptedRequest` flow.
 * The mechanic selects the primary action (`TireIssueMode`) and fills in the
 * relevant fields (replacement reason, repair toggles, or relocation target).
 * A "Carool photo" button navigates to `CaroolCheck` for AI tyre analysis.
 *
 * On submit, calls `onSubmit(wheelPosition, WheelData)` so `AcceptedRequest`
 * can persist the data to `sessionStorage`.
 *
 * @param isOpen                   - Controls popup visibility.
 * @param onClose                  - Callback when the popup is dismissed without saving.
 * @param wheelPosition            - The wheel being edited (e.g. `"front-left"`).
 * @param licensePlate             - Used to compute available relocation targets.
 * @param onSubmit                 - Called with the completed `WheelData` on save.
 * @param onNavigateToCaroolCheck  - Called when the mechanic taps the Carool camera button.
 * @param spareTireEnabled         - Whether the spare tyre is a valid relocation target.
 * @param wheelCount               - Total road wheels; controls relocation target list.
 * @param initialData              - Pre-fill form from previously saved `WheelData`.
 */
export function TirePopup({
  isOpen,
  onClose,
  wheelPosition,
  onSubmit,
  onNavigateToCaroolCheck,
  spareTireEnabled = false,
  wheelCount = 4,
  initialData,
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
    setReplacementReason(initialData?.replacementReason ?? null);
    setSensor(initialData?.sensor ?? false);
    setTpmsValve(initialData?.tpmsValve ?? false);
    setBalancing(initialData?.balancing ?? false);
    setRimRepair(initialData?.rimRepair ?? false);
    setPuncture(initialData?.puncture ?? false);
    setMovedToWheel(initialData?.movedToWheel ?? null);
  }, [initialData]);

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
    onNavigateToCaroolCheck(wheelPosition);
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
          <div className="flex flex-col gap-2 mt-2">
            {([
              { key: "sensor",    label: t("services.sensor"),    value: sensor,    set: setSensor },
              { key: "tpmsValve", label: t("services.tpmsValve"), value: tpmsValve, set: setTpmsValve },
              { key: "balancing", label: t("services.balancing"), value: balancing, set: setBalancing },
              { key: "rimRepair", label: t("services.rimRepair"), value: rimRepair, set: setRimRepair },
              { key: "puncture",  label: t("services.puncture"),  value: effectivePuncture, set: setPuncture, disabled: hasReplacement },
            ] as const).map(({ key, label, value, set, disabled }) => (
              <button
                key={key}
                type="button"
                disabled={disabled}
                onClick={() => !disabled && set(!value)}
                className={`py-2.5 rounded-xl text-sm font-semibold border-2 transition-all duration-150 ${
                  disabled
                    ? "opacity-35 border-border bg-card text-foreground cursor-not-allowed"
                    : value
                      ? "border-primary bg-primary text-primary-foreground shadow-sm"
                      : "border-border bg-card text-foreground hover:border-primary/50"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </section>

        {/* העברה — not available for spare tire */}
        {wheelPosition !== "spare-tire" && (
          <section>
            <SectionLabel>{t("tirePopup.sectionRelocation")}</SectionLabel>
            <div className="mt-2 grid grid-cols-3 gap-2">
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

