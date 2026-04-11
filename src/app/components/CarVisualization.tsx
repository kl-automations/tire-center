import React from "react";
import { useTranslation } from "react-i18next";
import type { PlateType } from "./LicensePlate";
import type { VehicleWheelCount } from "../vehicleWheelLayout";

export type WheelColor = "green" | "orange" | "red" | "default";

/** Line art + body fill for tire SVGs — black/white normally, full red treatment when `color === "red"`. */
function tireGraphicPalette(color: WheelColor): { ink: string; body: string } {
  if (color === "red") {
    return {
      ink: "var(--destructive)",
      body: "color-mix(in srgb, var(--destructive) 18%, white)",
    };
  }
  return { ink: "#000000", body: "#ffffff" };
}

interface CarVisualizationProps {
  onWheelClick: (wheelPosition: string) => void;
  selectedWheel?: string | null;
  affectedWheels?: Set<string>;
  wheelColors?: Record<string, WheelColor>;
  frontTireSize: string;
  rearTireSize: string;
  /** Load/speed index e.g. 91V — shown after size when set */
  frontTireProfile?: string;
  rearTireProfile?: string;
  /** When true, a fifth wheel (spare) is shown centered between the axles */
  showSpareTire?: boolean;
  /** 4 = standard; 6 = dual rear with inner wheels (from backend) */
  wheelCount?: VehicleWheelCount;
  /** Reserved for future plate-driven visuals */
  plateType?: PlateType;
}

type RoadHotspot = {
  position: string;
  labelKey: string;
  style: React.CSSProperties;
  round?: boolean;
};

const REAR_ROW = { top: "62.59%", width: "12%", height: "20.6%" } as const;

/** Front + single rear axle (4-wheel) — rear coords match /3.png. */
const ROAD_WHEEL_HOTSPOTS_4: RoadHotspot[] = [
  { position: "front-left", labelKey: "wheels.frontLeft", style: { top: "15.1%", left: "9.3%", width: "12%", height: "20.6%" } },
  { position: "front-right", labelKey: "wheels.frontRight", style: { top: "15.1%", right: "8.9%", width: "12%", height: "20.6%" } },
  { position: "rear-left", labelKey: "wheels.rearLeft", style: { ...REAR_ROW, left: "12.8%" } },
  { position: "rear-right", labelKey: "wheels.rearRight", style: { ...REAR_ROW, right: "9.8%" } },
];

/**
 * 6-wheel: outer pair at the sides; inner pair inboard (same geometry 4-wheel used for rears).
 * Position ids stay tied to semantics (rear-left = outer left, etc.).
 */
const ROAD_WHEEL_HOTSPOTS_6: RoadHotspot[] = [
  { position: "front-left", labelKey: "wheels.frontLeft", style: { top: "15.1%", left: "9.3%", width: "12%", height: "20.6%" } },
  { position: "front-right", labelKey: "wheels.frontRight", style: { top: "15.1%", right: "8.9%", width: "12%", height: "20.6%" } },
  { position: "rear-left", labelKey: "wheels.rearLeft", style: { ...REAR_ROW, left: "-3%" } },
  { position: "rear-right", labelKey: "wheels.rearRight", style: { ...REAR_ROW, right: "-5%" } },
  { position: "rear-left-inner", labelKey: "wheels.rearLeftInner", style: { ...REAR_ROW, left: "12.8%" } },
  { position: "rear-right-inner", labelKey: "wheels.rearRightInner", style: { ...REAR_ROW, right: "9.8%" } },
];

function roadHotspotsFor(wheelCount: VehicleWheelCount): RoadHotspot[] {
  return wheelCount === 6 ? ROAD_WHEEL_HOTSPOTS_6 : ROAD_WHEEL_HOTSPOTS_4;
}

/** Spare — when showSpareTire (SVG below body image in spare area). */
const SPARE_HOTSPOT = {
  position: "spare-tire",
  labelKey: "wheels.spareTire",
  style: { top: "65.38%", left: "35.3%", width: "34%", height: "20.3%" },
  round: true,
} as const;

/**
 * Single top-down body image for every vehicle — 4- and 6-wheel use the same asset and layout;
 * only the clickable tire list adds inner rear positions when `wheelCount === 6`.
 */
export const CAR_TOPDOWN_BODY_IMAGE_SRC = "/3.png";

function formatTireSizeLine(size: string, profile?: string): string {
  const p = profile?.trim();
  return p ? `${size} · ${p}` : size;
}

/** Top-down road tire — line-art tread; fills each hotspot cell. */
function TopDownRoadTireGraphic({ className, color = "default" }: { className?: string; color?: WheelColor }) {
  const { ink, body } = tireGraphicPalette(color);
  return (
    <svg className={className} viewBox="0 0 64 100" fill="none" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none">
      <rect x="3" y="3" width="58" height="94" rx="11" fill={body} stroke={ink} strokeWidth="2.25" />
      <line x1="32" y1="9" x2="32" y2="91" stroke={ink} strokeWidth="1.5" strokeLinecap="round" />
      {[16, 24, 32, 40, 48, 56, 64, 72, 80].map((y) => (
        <React.Fragment key={y}>
          <line x1="7" y1={y} x2="22" y2={y - 3} stroke={ink} strokeWidth="1.2" strokeLinecap="round" />
          <line x1="42" y1={y - 3} x2="57" y2={y} stroke={ink} strokeWidth="1.2" strokeLinecap="round" />
        </React.Fragment>
      ))}
    </svg>
  );
}

/** Spare wheel face (top-down). */
function TopDownSpareTireGraphic({ className, color = "default" }: { className?: string; color?: WheelColor }) {
  const { ink, body } = tireGraphicPalette(color);
  return (
    <svg className={className} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="50" cy="50" r="44" fill={body} stroke={ink} strokeWidth="2.25" />
      <circle cx="50" cy="50" r="30" stroke={ink} strokeWidth="1.5" />
      <circle cx="50" cy="50" r="14" stroke={ink} strokeWidth="1.2" />
      {[0, 60, 120, 180, 240, 300].map((deg) => {
        const r = (deg * Math.PI) / 180;
        return (
          <circle
            key={deg}
            cx={50 + 21 * Math.cos(r)}
            cy={50 + 21 * Math.sin(r)}
            r="2.2"
            fill={ink}
          />
        );
      })}
    </svg>
  );
}

/** Short badge on diagram for dual-rear 6-wheel (outer vs inner pair). */
function dualRearBadgeKey(position: string): "carVisualization.dualRearOuter" | "carVisualization.dualRearInner" | null {
  if (position === "rear-left" || position === "rear-right") return "carVisualization.dualRearOuter";
  if (position === "rear-left-inner" || position === "rear-right-inner") return "carVisualization.dualRearInner";
  return null;
}

function hotspotButtonClass(isSelected: boolean, color: WheelColor): string {
  const base =
    "absolute z-[15] p-0 cursor-pointer transition-all duration-200 focus-visible:outline-none border border-transparent";

  if (isSelected) {
    return `${base} bg-black/30 border-black/40`;
  }
  switch (color) {
    case "green":
      return `${base} bg-green-500/30 border-green-500/50`;
    case "orange":
      return `${base} bg-orange-400/30 border-orange-400/50`;
    case "red":
      return `${base} bg-destructive/30 border-destructive/50`;
    default:
      return `${base} hover:bg-black/10`;
  }
}

/** Top-down car + tires — identical shell for 4- and 6-wheel; `wheelCount` only extends road hotspots. */
function VehicleTopDownDiagram({
  onWheelClick,
  selectedWheel,
  getColor,
  showSpareTire,
  wheelCount,
}: {
  onWheelClick: (wheelPosition: string) => void;
  selectedWheel?: string | null;
  getColor: (pos: string) => WheelColor;
  showSpareTire: boolean;
  wheelCount: VehicleWheelCount;
}) {
  const { t } = useTranslation();

  React.useEffect(() => {
    const img = new Image();
    img.src = CAR_TOPDOWN_BODY_IMAGE_SRC;
  }, []);

  const roadHotspots = roadHotspotsFor(wheelCount);
  const hotspots = showSpareTire ? [...roadHotspots, SPARE_HOTSPOT] : roadHotspots;

  return (
    <div className="relative w-full max-w-md mx-auto aspect-[1600/2686] select-none">
      <div className="absolute inset-0 bg-background">
        {/* Tire vectors — under body overlay */}
        {roadHotspots.map(({ position, style }) => (
          <div
            key={`tire-${position}`}
            className="pointer-events-none absolute z-[1]"
            style={style}
          >
            <TopDownRoadTireGraphic className="h-full w-full" color={getColor(position)} />
          </div>
        ))}

        <img
          src={CAR_TOPDOWN_BODY_IMAGE_SRC}
          alt=""
          className="absolute inset-0 z-[5] h-full w-full object-contain pointer-events-none"
          draggable={false}
        />

        {wheelCount === 6 &&
          roadHotspots.map(({ position, style }) => {
            const badgeKey = dualRearBadgeKey(position);
            if (!badgeKey) return null;
            return (
              <div
                key={`dual-badge-${position}`}
                className="pointer-events-none absolute z-[12] flex items-end justify-center pb-1"
                style={style}
              >
                <span
                  className="max-w-[min(100%,5.5rem)] text-center text-[9px] sm:text-[10px] font-bold leading-tight px-1.5 py-0.5 rounded-md bg-background/95 text-foreground border border-border/80 shadow-sm backdrop-blur-[2px]"
                  aria-hidden
                >
                  {t(badgeKey)}
                </span>
              </div>
            );
          })}

        {showSpareTire && (
          <div
            className="pointer-events-none absolute z-[10] overflow-hidden rounded-full"
            style={SPARE_HOTSPOT.style}
          >
            <TopDownSpareTireGraphic className="h-full w-full" color={getColor("spare-tire")} />
          </div>
        )}

        {hotspots.map(({ position, labelKey, style, round }) => (
          <button
            key={position}
            type="button"
            style={style}
            onClick={() => onWheelClick(position)}
            className={`${hotspotButtonClass(selectedWheel === position, getColor(position))} ${round ? "rounded-full" : "rounded-xl"}`}
            aria-label={t(labelKey)}
          />
        ))}
      </div>
    </div>
  );
}

export function CarVisualization({
  onWheelClick,
  selectedWheel,
  affectedWheels = new Set(),
  wheelColors = {},
  frontTireSize,
  rearTireSize,
  frontTireProfile,
  rearTireProfile,
  showSpareTire = false,
  wheelCount = 4,
  plateType = "civilian",
}: CarVisualizationProps) {
  const { t } = useTranslation();
  const getColor = (pos: string): WheelColor => {
    if (wheelColors[pos]) return wheelColors[pos];
    if (affectedWheels.has(pos)) return "red";
    return "default";
  };

  return (
    <div className="flex flex-col items-center gap-4 py-2">
      {/* Front label */}
      <div className="flex flex-col items-center gap-1">
        <span className="text-xs font-semibold text-muted-foreground tracking-widest uppercase">
          {t("carVisualization.front")}
        </span>
        <span dir="ltr" className="text-sm font-bold text-foreground bg-muted px-3 py-0.5 rounded-full">
          {formatTireSizeLine(frontTireSize, frontTireProfile)}
        </span>
      </div>

      <VehicleTopDownDiagram
        onWheelClick={onWheelClick}
        selectedWheel={selectedWheel}
        getColor={getColor}
        showSpareTire={showSpareTire}
        wheelCount={wheelCount}
      />

      {/* Rear label */}
      <div className="flex flex-col items-center gap-1">
        <span className="text-xs font-semibold text-muted-foreground tracking-widest uppercase">
          {t("carVisualization.rear")}
        </span>
        <span dir="ltr" className="text-sm font-bold text-foreground bg-muted px-3 py-0.5 rounded-full">
          {formatTireSizeLine(rearTireSize, rearTireProfile)}
        </span>
      </div>
    </div>
  );
}
