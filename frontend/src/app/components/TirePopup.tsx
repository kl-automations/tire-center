import { useState, useEffect, useCallback, useMemo } from "react";
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
  selectedActionCodes: number[];
  selectedReasonCodes: number[];
  reasonActionMap: Record<number, number>;
  movedToWheel: string | null;
  mode: TireIssueMode;
  reason: string;
}

export interface ActionCodeItem {
  code: number;
  label_he?: string;
  label_ar?: string;
  label_ru?: string;
}

export interface ReasonCodeItem {
  code: number;
  linked_action_code: number;
  label_he?: string;
  label_ar?: string;
  label_ru?: string;
}

interface TirePopupProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * Called when the mechanic taps the in-popup ← arrow. Receives the
   * popup's current dirty state so the parent can decide whether to show
   * the discard-confirm modal or close the popup outright. `dirty` mirrors
   * what `onDirtyChange` reports for this popup instance.
   */
  onAttemptClose?: (dirty: boolean) => void;
  /**
   * Notifies the parent whenever the popup's dirty state changes, so a
   * single shared back-press handler in `AcceptedRequest` can decide
   * whether to show the discard-confirm modal. Avoids attaching a second
   * `usePhoneBackSync` listener inside the popup, which would otherwise
   * accumulate phantom history states every time the popup opens.
   */
  onDirtyChange?: (dirty: boolean) => void;
  wheelPosition: string;
  licensePlate: string;
  onSubmit: (wheelPosition: string, data: WheelData) => void;
  onNavigateToCaroolCheck: (wheel: string) => void;
  /**
   * When `false`, the continue button submits the wheel data and closes the
   * popup without navigating to the Carool photo flow. Defaults to `true`.
   */
  caroolEnabled?: boolean;
  spareTireEnabled?: boolean;
  wheelCount?: VehicleWheelCount;
  initialData?: WheelData;
  actions: ActionCodeItem[];
  reasons: ReasonCodeItem[];
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
  onAttemptClose,
  onDirtyChange,
  wheelPosition,
  onSubmit,
  onNavigateToCaroolCheck,
  caroolEnabled = true,
  spareTireEnabled = false,
  wheelCount = 4,
  initialData,
  actions,
  reasons,
}: TirePopupProps) {
  const { t, i18n } = useTranslation();

  const [selectedActionCodes, setSelectedActionCodes] = useState<number[]>([]);
  const [selectedReasonCodes, setSelectedReasonCodes] = useState<number[]>([]);
  const [reasonActionMap, setReasonActionMap] = useState<Record<number, number>>({});
  const [movedToWheel, setMovedToWheel] = useState<string | null>(null);

  const reset = useCallback(() => {
    setSelectedActionCodes(initialData?.selectedActionCodes ?? []);
    setSelectedReasonCodes(initialData?.selectedReasonCodes ?? []);
    setReasonActionMap(initialData?.reasonActionMap ?? {});
    setMovedToWheel(initialData?.movedToWheel ?? null);
  }, [initialData]);

  useEffect(() => {
    if (isOpen) reset();
  }, [isOpen, wheelPosition, reset]);

  // Compare current popup state to the initialData snapshot to know if the
  // user has touched anything since opening; drives the discard-confirm
  // modal when they try to back out. The boolean is reported up to the
  // parent via `onDirtyChange` so a single shared back-press handler can
  // decide what to do.
  const isDirty = useMemo(() => {
    if (!isOpen) return false;
    const initActions = (initialData?.selectedActionCodes ?? []).slice().sort();
    const curActions = selectedActionCodes.slice().sort();
    if (initActions.join(",") !== curActions.join(",")) return true;
    const initReasons = (initialData?.selectedReasonCodes ?? []).slice().sort();
    const curReasons = selectedReasonCodes.slice().sort();
    if (initReasons.join(",") !== curReasons.join(",")) return true;
    if ((initialData?.movedToWheel ?? null) !== movedToWheel) return true;
    const initMap = JSON.stringify(initialData?.reasonActionMap ?? {});
    const curMap = JSON.stringify(reasonActionMap);
    if (initMap !== curMap) return true;
    return false;
  }, [isOpen, initialData, selectedActionCodes, selectedReasonCodes, reasonActionMap, movedToWheel]);

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  const handleHeaderBack = () => {
    onAttemptClose?.(isDirty);
  };

  if (!isOpen) return null;

  const canContinue =
    selectedActionCodes.length > 0 ||
    selectedReasonCodes.length > 0 ||
    movedToWheel !== null;

  const handleContinue = () => {
    if (!canContinue) return;
    const mode: TireIssueMode = selectedReasonCodes.length > 0
      ? "replacement"
      : movedToWheel
        ? "relocation"
        : "repair";

    onSubmit(wheelPosition, {
      selectedActionCodes,
      selectedReasonCodes,
      reasonActionMap,
      movedToWheel,
      mode,
      reason: "",
    });
    reset();
    onClose();
    if (caroolEnabled) {
      onNavigateToCaroolCheck(wheelPosition);
    }
  };

  const title = WHEEL_POS_KEYS[wheelPosition] ? t(WHEEL_POS_KEYS[wheelPosition]) : wheelPosition;
  const relocationTargets = otherWheelPositions(wheelPosition, spareTireEnabled, wheelCount);
  const actionCodeToReasons = new Map<number, ReasonCodeItem[]>();
  for (const reason of reasons) {
    if (!actionCodeToReasons.has(reason.linked_action_code)) {
      actionCodeToReasons.set(reason.linked_action_code, []);
    }
    actionCodeToReasons.get(reason.linked_action_code)?.push(reason);
  }
  const displayActions = actions.filter((action) => action.code !== 6 && action.code !== 2);
  const reasonedActions = displayActions.filter((action) => (actionCodeToReasons.get(action.code)?.length ?? 0) > 0);
  const toggleActions = displayActions.filter((action) => (actionCodeToReasons.get(action.code)?.length ?? 0) === 0);
  const labelFor = (item: { label_he?: string; label_ar?: string; label_ru?: string }) => {
    const language = i18n.language?.split("-")[0] ?? "he";
    if (language === "ar" && item.label_ar && item.label_ar.trim().length > 0) return item.label_ar;
    if (language === "ru" && item.label_ru && item.label_ru.trim().length > 0) return item.label_ru;
    return item.label_he || "";
  };

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      {/* Header */}
      <div className="bg-primary px-4 py-2.5 shadow-md shrink-0">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={handleHeaderBack}
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

        {reasonedActions.map((action) => (
          <section key={action.code}>
            <SectionLabel>{labelFor(action)}</SectionLabel>
            <div className="grid grid-cols-3 gap-2 mt-2">
              {(actionCodeToReasons.get(action.code) ?? []).map((reason) => {
                const active = selectedReasonCodes.includes(reason.code);
                return (
                  <button
                    key={reason.code}
                    type="button"
                    onClick={() => {
                      setSelectedReasonCodes((prev) =>
                        prev.includes(reason.code) ? prev.filter((code) => code !== reason.code) : [...prev, reason.code]
                      );
                      setSelectedActionCodes((prev) =>
                        prev.includes(action.code) ? prev : [...prev, action.code]
                      );
                      setReasonActionMap((prev) => ({ ...prev, [reason.code]: action.code }));
                    }}
                    className={`py-2.5 rounded-xl text-sm font-semibold border-2 transition-all duration-150 ${
                      active
                        ? "border-primary bg-primary text-primary-foreground shadow-sm"
                        : "border-border bg-card text-foreground hover:border-primary/50"
                    }`}
                  >
                    {labelFor(reason)}
                  </button>
                );
              })}
            </div>
          </section>
        ))}

        <section>
          <SectionLabel>{t("tirePopup.sectionRepair")}</SectionLabel>
          <div className="flex flex-col gap-2 mt-2">
            {toggleActions.map((action) => (
              <button
                key={action.code}
                type="button"
                onClick={() =>
                  setSelectedActionCodes((prev) =>
                    prev.includes(action.code)
                      ? prev.filter((code) => code !== action.code)
                      : [...prev, action.code]
                  )
                }
                className={`py-2.5 rounded-xl text-sm font-semibold border-2 transition-all duration-150 ${
                  selectedActionCodes.includes(action.code)
                    ? "border-primary bg-primary text-primary-foreground shadow-sm"
                    : "border-border bg-card text-foreground hover:border-primary/50"
                }`}
              >
                {labelFor(action)}
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
          {caroolEnabled ? t("tirePopup.continueToCheck") : t("common.continue")}
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

