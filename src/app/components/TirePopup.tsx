import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import * as XLSX from "xlsx";
import { getRoadWheelPositions, type VehicleWheelCount } from "../vehicleWheelLayout";

export type TireIssueMode = "replacement" | "repair" | "relocation";

export interface WheelData {
  mode: TireIssueMode;
  reason: string;
  puncture: boolean;
  balancing: boolean;
  sensor: boolean;
  movedToWheel: string | null;
}

interface TirePopupProps {
  isOpen: boolean;
  onClose: () => void;
  wheelPosition: string;
  licensePlate: string;
  onSubmit: (wheelPosition: string, data: WheelData) => void;
  onNavigateToCaroolCheck: () => void;
  /** Include spare tire in relocation targets (must match CarVisualization spare) */
  spareTireEnabled?: boolean;
  /** From backend; mock uses plate `123456` → 6 */
  wheelCount?: VehicleWheelCount;
}

const WHEEL_POS_KEYS: Record<string, string> = {
  "front-right": "wheels.frontRight",
  "front-left": "wheels.frontLeft",
  "rear-right": "wheels.rearRight",
  "rear-left": "wheels.rearLeft",
  "rear-right-inner": "wheels.rearRightInner",
  "rear-left-inner": "wheels.rearLeftInner",
  "spare-tire": "wheels.spareTire",
};

function allWheelPositions(includeSpare: boolean, wheelCount: VehicleWheelCount): string[] {
  const road = getRoadWheelPositions(wheelCount);
  return includeSpare ? [...road, "spare-tire"] : road;
}

function otherWheelPositions(
  current: string,
  spareTireEnabled: boolean,
  wheelCount: VehicleWheelCount
): string[] {
  return allWheelPositions(spareTireEnabled, wheelCount).filter((w) => w !== current);
}

const MODE_KEYS_ALL: TireIssueMode[] = ["replacement", "repair", "relocation"];

function modeKeysForWheel(wheelPosition: string): TireIssueMode[] {
  if (wheelPosition === "spare-tire") {
    return ["replacement", "repair"];
  }
  return MODE_KEYS_ALL;
}

const SUBTITLE_BY_MODE: Record<TireIssueMode, string> = {
  replacement: "tirePopup.subtitleReplacement",
  repair: "tirePopup.subtitleRepair",
  relocation: "tirePopup.subtitleRelocation",
};

function useReasons() {
  const [reasons, setReasons] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/סיבות.xlsx")
      .then((res) => res.arrayBuffer())
      .then((buffer) => {
        const workbook = XLSX.read(buffer, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows: string[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        const values = rows.slice(1).map((row) => row[0]).filter(Boolean);
        setReasons(values);
      })
      .catch((err) => {
        console.error("Failed to load reasons:", err);
        setReasons([]);
      })
      .finally(() => setLoading(false));
  }, []);

  return { reasons, loading };
}

export function TirePopup({
  isOpen,
  onClose,
  wheelPosition,
  licensePlate,
  onSubmit,
  onNavigateToCaroolCheck,
  spareTireEnabled = false,
  wheelCount = 4,
}: TirePopupProps) {
  const { t } = useTranslation();
  const { reasons, loading } = useReasons();
  const [mode, setMode] = useState<TireIssueMode>("replacement");
  const [selectedReason, setSelectedReason] = useState<string | null>(null);
  const [puncture, setPuncture] = useState(false);
  const [balancing, setBalancing] = useState(false);
  const [sensor, setSensor] = useState(false);
  const [movedToWheel, setMovedToWheel] = useState<string | null>(null);

  const resetState = useCallback(() => {
    setMode("replacement");
    setSelectedReason(null);
    setPuncture(false);
    setBalancing(false);
    setSensor(false);
    setMovedToWheel(null);
  }, []);

  useEffect(() => {
    if (isOpen) {
      resetState();
    }
  }, [isOpen, wheelPosition, resetState]);

  const handleClose = () => {
    resetState();
    onClose();
  };

  const canContinue =
    mode === "replacement"
      ? Boolean(selectedReason) && !loading
      : mode === "repair"
        ? puncture || balancing || sensor
        : Boolean(movedToWheel);

  const handleContinue = () => {
    if (!canContinue) return;

    onSubmit(wheelPosition, {
      mode,
      reason: mode === "replacement" ? selectedReason || "" : "",
      puncture: mode === "repair" ? puncture : false,
      balancing: mode === "repair" ? balancing : false,
      sensor: mode === "repair" ? sensor : false,
      movedToWheel: mode === "relocation" ? movedToWheel : null,
    });
    resetState();
    onClose();
    onNavigateToCaroolCheck();
  };

  if (!isOpen) return null;

  const title = WHEEL_POS_KEYS[wheelPosition] ? t(WHEEL_POS_KEYS[wheelPosition]) : wheelPosition;
  const relocationTargets = otherWheelPositions(wheelPosition, spareTireEnabled, wheelCount);
  const modeKeys = modeKeysForWheel(wheelPosition);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={handleClose} />

      <div className="relative bg-card rounded-2xl shadow-2xl p-6 w-full max-w-lg mx-4 border border-border">
        <button
          type="button"
          onClick={handleClose}
          className="absolute top-4 start-4 text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="w-6 h-6" />
        </button>

        <div className="space-y-6">
          <div className="text-center">
            <h2 className="text-xl font-semibold text-foreground">{title}</h2>
            <p className="text-sm text-muted-foreground mt-1">{t(SUBTITLE_BY_MODE[mode])}</p>
          </div>

          <div className="space-y-2">
            <span className="text-sm font-semibold text-foreground block text-center">{t("tirePopup.issueType")}</span>
            <div
              className={`grid grid-cols-1 gap-2 ${modeKeys.length === 2 ? "sm:grid-cols-2" : "sm:grid-cols-3"}`}
            >
              {modeKeys.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`rounded-xl px-3 py-2.5 text-sm font-semibold border-2 transition-all ${
                    mode === m
                      ? "border-primary bg-primary text-primary-foreground shadow-md"
                      : "border-border bg-background text-foreground hover:border-primary/50"
                  }`}
                >
                  {t(`tirePopup.mode.${m}`)}
                </button>
              ))}
            </div>
          </div>

          {mode === "replacement" && (
            <div className="space-y-2">
              <label className="text-sm font-semibold text-foreground">{t("tirePopup.reasonLabel")}</label>
              {loading ? (
                <div className="text-sm text-muted-foreground text-center py-3">{t("tirePopup.loadingReasons")}</div>
              ) : (
                <select
                  value={selectedReason || ""}
                  onChange={(e) => setSelectedReason(e.target.value || null)}
                  className="w-full px-4 py-3 bg-input-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-ring dark:focus:ring-blue-400 focus:border-transparent transition-all [&>option]:bg-card [&>option]:text-foreground"
                >
                  <option value="">{t("tirePopup.selectReason")}</option>
                  {reasons.map((reason) => (
                    <option key={reason} value={reason}>
                      {reason}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {mode === "repair" && (
            <div className="space-y-3">
              <ToggleRow label={t("services.puncture")} value={puncture} onChange={setPuncture} />
              <ToggleRow label={t("services.sensor")} value={sensor} onChange={setSensor} />
              <ToggleRow label={t("services.balancing")} value={balancing} onChange={setBalancing} />
            </div>
          )}

          {mode === "relocation" && (
            <div className="space-y-2">
              <label className="text-sm font-semibold text-foreground">{t("tirePopup.movedToLabel")}</label>
              <select
                value={movedToWheel || ""}
                onChange={(e) => setMovedToWheel(e.target.value || null)}
                className="w-full px-4 py-3 bg-input-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-ring dark:focus:ring-blue-400 focus:border-transparent transition-all [&>option]:bg-card [&>option]:text-foreground"
              >
                <option value="">{t("tirePopup.selectTargetWheel")}</option>
                {relocationTargets.map((pos) => (
                  <option key={pos} value={pos}>
                    {WHEEL_POS_KEYS[pos] ? t(WHEEL_POS_KEYS[pos]) : pos}
                  </option>
                ))}
              </select>
            </div>
          )}

          <button
            type="button"
            onClick={handleContinue}
            disabled={!canContinue}
            className="w-full bg-primary hover:bg-primary/90 text-primary-foreground py-3 rounded-xl transition-colors duration-200 shadow-md hover:shadow-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-primary"
          >
            {t("tirePopup.continueToCheck")}
          </button>
        </div>
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between bg-background rounded-xl px-4 py-3 border border-border">
      <span className="font-semibold text-foreground">{label}</span>
      <button
        dir="ltr"
        type="button"
        onClick={() => onChange(!value)}
        className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors duration-300 ${
          value ? "bg-primary dark:bg-blue-500" : "bg-muted"
        }`}
      >
        <span
          className={`inline-block h-6 w-6 rounded-full bg-white shadow-md transition-transform duration-300 ${
            value ? "translate-x-[4px]" : "translate-x-[30px]"
          }`}
        />
      </button>
    </div>
  );
}
