import { useState } from "react";
import { useNavigation } from "../NavigationContext";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import type { PlateType } from "./LicensePlate";
import { LICENSE_PLATE_FRAME_CLASS, LicensePlateBlueStrip } from "./LicensePlate";

const PLATE_OPTIONS: PlateType[] = ["civilian", "military", "police"];

const PLATE_BG_MAIN: Record<PlateType, string> = {
  civilian:
    "bg-gradient-to-b from-[#ffe94a] via-[#f5d20a] to-[#e6bc00] shadow-[inset_0_2px_6px_rgba(255,255,255,0.45)] border-s border-black/10",
  military:
    "bg-gradient-to-b from-zinc-800 via-neutral-950 to-black shadow-[inset_0_2px_8px_rgba(0,0,0,0.6)]",
  police:
    "bg-gradient-to-b from-[#dc2626] via-[#b91c1c] to-[#991b1b] shadow-[inset_0_2px_6px_rgba(255,255,255,0.12)] border-s border-black/15",
};

const PLATE_TEXT: Record<PlateType, { main: string; placeholder: string; suffixShadow: string }> = {
  civilian: {
    main: "text-neutral-900",
    placeholder: "placeholder:text-neutral-900/35",
    suffixShadow: "",
  },
  military: {
    main: "text-white [text-shadow:0_1px_0_rgba(255,255,255,0.35),0_-1px_2px_rgba(0,0,0,0.5)]",
    placeholder: "placeholder:text-white/35",
    suffixShadow: "[text-shadow:0_1px_0_rgba(255,255,255,0.35),0_-1px_2px_rgba(0,0,0,0.5)]",
  },
  police: {
    main: "text-white [text-shadow:0_1px_0_rgba(255,255,255,0.35),0_-1px_2px_rgba(0,0,0,0.5)]",
    placeholder: "placeholder:text-white/35",
    suffixShadow: "[text-shadow:0_1px_0_rgba(255,255,255,0.35),0_-1px_2px_rgba(0,0,0,0.5)]",
  },
};

const SUFFIX: Record<Exclude<PlateType, "civilian">, string> = {
  military: "\u05E6",
  police: "\u05DE",
};

const mono = { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" as const };

interface LicensePlateModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Modal for entering a vehicle licence plate to open a new service order.
 *
 * Accepts: plate number (free text), plate type (civilian/military/police),
 * and current mileage. On submit, calls `POST /api/car` (currently mocked
 * via hardcoded demo routing: plate `12345678` → declined, others → accepted).
 *
 * On ERP approval, navigates to `{ name: "accepted-request" }`.
 * On ERP rejection, navigates to `{ name: "declined-request" }`.
 *
 * @param isOpen  - Controls modal visibility.
 * @param onClose - Callback invoked when the modal is dismissed.
 */
export function LicensePlateModal({ isOpen, onClose }: LicensePlateModalProps) {
  const { t } = useTranslation();
  const { navigate } = useNavigation();
  const [licensePlate, setLicensePlate] = useState("");
  const [plateType, setPlateType] = useState<PlateType>("civilian");
  const [mileage, setMileage] = useState("");

  const handleContinue = () => {
    if (licensePlate.trim()) {
      if (licensePlate === "12345678") {
        navigate({ name: "declined-request", plate: licensePlate, plateType, reason: "קיימת פנייה פתוחה עבור רכב זה" });
      } else {
        navigate({ name: "accepted-request", plate: licensePlate, plateType, mileage: mileage.trim() });
      }
      onClose();
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.toUpperCase().slice(0, 8);
    setLicensePlate(value);
  };

  if (!isOpen) return null;

  const bgMain = PLATE_BG_MAIN[plateType];
  const text = PLATE_TEXT[plateType];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      <div className="relative bg-card rounded-2xl shadow-2xl p-8 w-full max-w-2xl mx-4 border border-border">
        <button
          onClick={onClose}
          className="absolute top-4 start-4 text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="w-6 h-6" />
        </button>

        <div className="text-center space-y-6">
          <div>
            <h2 className="text-2xl text-foreground mb-2">{t("licensePlateModal.title")}</h2>
            <p className="text-muted-foreground">{t("licensePlateModal.subtitle")}</p>
          </div>

          <div className="flex justify-center gap-3 flex-wrap">
            {PLATE_OPTIONS.map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => setPlateType(opt)}
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200 border-2 ${
                  plateType === opt
                    ? "border-primary bg-primary text-primary-foreground shadow-md"
                    : "border-border bg-card text-foreground hover:border-primary/50"
                }`}
              >
                {t(`plateType.${opt}`)}
              </button>
            ))}
          </div>

          <div className="flex justify-center px-4">
            <div className="w-full max-w-lg">
              <div
                className={`${LICENSE_PLATE_FRAME_CLASS} flex items-stretch overflow-hidden w-full transition-colors duration-200`}
                style={{ aspectRatio: "3.8/1" }}
              >
                {plateType === "civilian" && (
                  <>
                    <LicensePlateBlueStrip />
                    <div
                      className={`flex-1 min-w-0 flex items-center justify-center px-2 sm:px-5 ${bgMain}`}
                    >
                      <input
                        type="text"
                        value={licensePlate}
                        onChange={handleInputChange}
                        placeholder="12-345-67"
                        className={`w-full min-w-0 bg-transparent text-center text-2xl sm:text-4xl font-black outline-none ${text.main} ${text.placeholder} tracking-widest tabular-nums [text-shadow:0_2px_0_rgba(0,0,0,0.12),0_1px_0_rgba(255,255,255,0.08)]`}
                        style={mono}
                        dir="ltr"
                        inputMode="numeric"
                        autoFocus
                      />
                    </div>
                  </>
                )}

                {plateType === "military" && (
                  <div className={`flex-1 flex items-center justify-center px-2 sm:px-4 min-w-0 ${bgMain}`}>
                    <div className="flex items-center justify-center gap-1 sm:gap-2 w-full max-w-full" dir="ltr">
                      <input
                        type="text"
                        value={licensePlate}
                        onChange={handleInputChange}
                        placeholder="123456"
                        className={`min-w-0 flex-1 bg-transparent text-end text-2xl sm:text-4xl font-black outline-none ${text.main} ${text.placeholder} tracking-widest tabular-nums`}
                        style={mono}
                        inputMode="numeric"
                        autoFocus
                      />
                      <span
                        className={`shrink-0 text-2xl sm:text-4xl font-black text-white tabular-nums ${text.suffixShadow}`}
                        style={mono}
                      >
                        -{SUFFIX.military}
                      </span>
                    </div>
                  </div>
                )}

                {plateType === "police" && (
                  <>
                    <LicensePlateBlueStrip />
                    <div
                      className={`flex-1 min-w-0 flex items-center justify-center px-2 sm:px-4 ${bgMain}`}
                    >
                      <div className="flex items-center justify-center gap-1 sm:gap-2 w-full max-w-full" dir="ltr">
                        <input
                          type="text"
                          value={licensePlate}
                          onChange={handleInputChange}
                          placeholder="12-345"
                          className={`min-w-0 flex-1 bg-transparent text-end text-2xl sm:text-4xl font-black outline-none ${text.main} ${text.placeholder} tracking-widest tabular-nums`}
                          style={mono}
                          inputMode="numeric"
                          autoFocus
                        />
                        <span
                          className={`shrink-0 text-2xl sm:text-4xl font-black text-white tabular-nums ${text.suffixShadow}`}
                          style={mono}
                        >
                          -{SUFFIX.police}
                        </span>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Mileage input */}
          <div className="flex items-center gap-3 bg-muted/50 rounded-xl px-4 py-3">
            <label className="text-sm font-medium text-foreground shrink-0">
              {t("acceptedRequest.mileage")}
            </label>
            <input
              type="number"
              inputMode="numeric"
              value={mileage}
              onChange={(e) => setMileage(e.target.value)}
              placeholder="0"
              className="flex-1 min-w-0 text-center rounded-lg border border-border bg-input-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <span className="text-sm text-muted-foreground shrink-0">{t("acceptedRequest.km")}</span>
          </div>

          <button
            type="button"
            onClick={handleContinue}
            disabled={!licensePlate.trim() || !mileage.trim()}
            className="w-full bg-primary hover:bg-secondary text-primary-foreground py-3 rounded-lg transition-colors duration-200 shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-primary"
          >
            {t("common.continue")}
          </button>
        </div>
      </div>
    </div>
  );
}
