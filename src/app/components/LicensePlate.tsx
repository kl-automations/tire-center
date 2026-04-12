export type PlateType = "civilian" | "military" | "police";

interface LicensePlateProps {
  plateNumber: string;
  plateType?: PlateType;
  className?: string;
}

/** Fixed Hebrew suffixes — never translated */
const PLATE_SUFFIX: Record<Exclude<PlateType, "civilian">, string> = {
  military: "\u05E6",
  police: "\u05DE",
};

/** Outer chrome: thin light rim like stamped metal (shared with modal) */
export const LICENSE_PLATE_FRAME_CLASS =
  "rounded-[10px] border-[3px] border-white/95 shadow-[0_4px_14px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.25)]";

export function LicensePlateBlueStrip() {
  return (
    <div className="bg-[#0038b8] h-full flex flex-col items-center justify-center px-2 sm:px-3 gap-1 w-[20%] min-w-[56px] max-w-[76px] shrink-0 border-e border-black/20 shadow-[inset_-2px_0_8px_rgba(0,0,0,0.15)]">
      <div className="bg-white rounded-sm p-0.5 sm:p-1 flex items-center justify-center shadow-sm">
        <svg className="w-6 h-4 sm:w-7 sm:h-5" viewBox="0 0 220 160" xmlns="http://www.w3.org/2000/svg" aria-hidden>
          <rect width="220" height="160" fill="white" />
          <rect width="220" height="53.33" fill="#0038b8" />
          <rect y="106.67" width="220" height="53.33" fill="#0038b8" />
          <polygon
            points="110,53.33 120,73.33 142,73.33 124,86.67 132,106.67 110,93.33 88,106.67 96,86.67 78,73.33 100,73.33"
            fill="#0038b8"
          />
        </svg>
      </div>
      <div className="text-white text-xs sm:text-lg font-black tracking-tight drop-shadow-sm">IL</div>
    </div>
  );
}

function embossedLightText(className: string) {
  return `${className} [text-shadow:0_1px_0_rgba(255,255,255,0.35),0_-1px_2px_rgba(0,0,0,0.5)]`;
}

function stampedDarkText(className: string) {
  return `${className} [text-shadow:0_2px_0_rgba(0,0,0,0.45),0_1px_0_rgba(255,255,255,0.08)]`;
}

function formatPlateDisplay(plateNumber: string, plateType: PlateType): string {
  if (plateType === "civilian") return plateNumber;
  const suf = PLATE_SUFFIX[plateType];
  const n = plateNumber.trim();
  if (!n) return `-${suf}`;
  return `${n}-${suf}`;
}

export function LicensePlate({ plateNumber, plateType = "civilian", className = "" }: LicensePlateProps) {
  const display = formatPlateDisplay(plateNumber, plateType);

  return (
    <div className={className}>
      <div
        className={`${LICENSE_PLATE_FRAME_CLASS} flex items-stretch overflow-hidden w-full`}
        style={{ aspectRatio: "3.8/1" }}
      >
        {plateType === "civilian" && (
          <>
            <LicensePlateBlueStrip />
            <div className="flex-1 min-w-0 bg-gradient-to-b from-[#ffe94a] via-[#f5d20a] to-[#e6bc00] flex items-center justify-center px-2 sm:px-5 border-s border-black/10 shadow-[inset_0_2px_6px_rgba(255,255,255,0.45)]">
              <div
                className={stampedDarkText(
                  "text-center text-xl sm:text-3xl font-black text-neutral-900 tracking-wider tabular-nums"
                )}
                style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}
                dir="ltr"
              >
                {display}
              </div>
            </div>
          </>
        )}

        {plateType === "military" && (
          <div className="flex-1 min-w-0 bg-gradient-to-b from-zinc-800 via-neutral-950 to-black flex items-center justify-center px-3 sm:px-8 shadow-[inset_0_2px_8px_rgba(0,0,0,0.6)]">
            <div
              className={embossedLightText(
                "text-center text-xl sm:text-3xl font-black text-white tracking-wider tabular-nums"
              )}
              style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}
              dir="ltr"
            >
              {display}
            </div>
          </div>
        )}

        {plateType === "police" && (
          <>
            <LicensePlateBlueStrip />
            <div className="flex-1 min-w-0 bg-gradient-to-b from-[#dc2626] via-[#b91c1c] to-[#991b1b] flex items-center justify-center px-2 sm:px-5 border-s border-black/15 shadow-[inset_0_2px_6px_rgba(255,255,255,0.12)]">
              <div
                className={embossedLightText(
                  "text-center text-xl sm:text-3xl font-black text-white tracking-wider tabular-nums"
                )}
                style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}
                dir="ltr"
              >
                {display}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
