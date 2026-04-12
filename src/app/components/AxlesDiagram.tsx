import React from "react";
import { useTranslation } from "react-i18next";
import type { VehicleWheelCount } from "../vehicleWheelLayout";

export type WheelColor = "green" | "orange" | "red" | "default";

function tireGraphicPalette(color: WheelColor): { ink: string; body: string } {
  if (color === "red") {
    return {
      ink: "var(--destructive)",
      body: "color-mix(in srgb, var(--destructive) 18%, white)",
    };
  }
  return { ink: "#000000", body: "#ffffff" };
}

export function TopDownRoadTireGraphic({ className, color = "default" }: { className?: string; color?: WheelColor }) {
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

export function TopDownSpareTireGraphic({ className, color = "default" }: { className?: string; color?: WheelColor }) {
  const { ink, body } = tireGraphicPalette(color);
  return (
    <svg className={className} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="50" cy="50" r="44" fill={body} stroke={ink} strokeWidth="2.25" />
      <circle cx="50" cy="50" r="30" stroke={ink} strokeWidth="1.5" />
      <circle cx="50" cy="50" r="14" stroke={ink} strokeWidth="1.2" />
      {[0, 60, 120, 180, 240, 300].map((deg) => {
        const r = (deg * Math.PI) / 180;
        return (
          <circle key={deg} cx={50 + 21 * Math.cos(r)} cy={50 + 21 * Math.sin(r)} r="2.2" fill={ink} />
        );
      })}
    </svg>
  );
}

interface AxlesDiagramProps {
  onWheelClick: (wheelPosition: string) => void;
  selectedWheel?: string | null;
  affectedWheels?: Set<string>;
  wheelColors?: Record<string, WheelColor>;
  showSpareTire?: boolean;
  wheelCount?: VehicleWheelCount;
}

// Layout constants (% of square container)
const TIRE_W = 14;   // road tire width %
const TIRE_H = 22;   // road tire height %
const SPARE_W = 24;  // spare diameter %

const LEFT_X = 2.5;
const RIGHT_X = 100 - LEFT_X - TIRE_W;    // = 83.5

const FRONT_Y = 4;
const REAR_Y_NO_SPARE = 74 - TIRE_H;      // = 52
const REAR_Y_WITH_SPARE = 62 - TIRE_H;    // = 40

const SPARE_LEFT = (100 - SPARE_W) / 2;   // centered

// Tire center X (for axle lines, % of container)
const TIRE_CX_LEFT = LEFT_X + TIRE_W / 2;   // = 9.5
const TIRE_CX_RIGHT = RIGHT_X + TIRE_W / 2; // = 90.5

// Front tire center Y
const FRONT_CY = FRONT_Y + TIRE_H / 2;      // = 15

function rearCY(showSpare: boolean) {
  const ry = showSpare ? REAR_Y_WITH_SPARE : REAR_Y_NO_SPARE;
  return ry + TIRE_H / 2;
}

function spareCY(showSpare: boolean) {
  const ry = showSpare ? REAR_Y_WITH_SPARE : REAR_Y_NO_SPARE;
  return ry + TIRE_H + 4 + SPARE_W / 2;
}

function getWheelColor(
  id: string,
  selectedWheel: string | null | undefined,
  affectedWheels: Set<string> | undefined,
  wheelColors: Record<string, WheelColor> | undefined
): WheelColor {
  if (wheelColors?.[id] && wheelColors[id] !== "default") return wheelColors[id];
  if (affectedWheels?.has(id)) return "red";
  if (id === selectedWheel) return "green";
  return "default";
}

function hotspotRing(selected: boolean, color: WheelColor): string {
  const base = "absolute inset-0 rounded-xl border-2 transition-all duration-150";
  if (selected) return `${base} border-primary bg-primary/20`;
  switch (color) {
    case "red":    return `${base} border-destructive bg-destructive/10`;
    case "orange": return `${base} border-orange-400 bg-orange-400/10`;
    case "green":  return `${base} border-green-500 bg-green-500/10`;
    default:       return `${base} border-transparent hover:border-border hover:bg-black/5`;
  }
}

export function AxlesDiagram({
  onWheelClick,
  selectedWheel,
  affectedWheels,
  wheelColors,
  showSpareTire = false,
  wheelCount = 4,
}: AxlesDiagramProps) {
  const { t } = useTranslation();
  const is6 = wheelCount === 6;

  const rearY = showSpareTire ? REAR_Y_WITH_SPARE : REAR_Y_NO_SPARE;
  const rearCenterY = rearCY(showSpareTire);
  const spareCenterY = spareCY(showSpareTire);
  const spareTop = rearY + TIRE_H + 4;

  // Inner rear positions for 6-wheel (slightly inset from outer)
  const INNER_W = TIRE_W * 0.85;
  const INNER_LEFT_X = LEFT_X + TIRE_W + 1;
  const INNER_RIGHT_X = RIGHT_X - INNER_W - 1;
  const INNER_TIRE_CX_LEFT = INNER_LEFT_X + INNER_W / 2;
  const INNER_TIRE_CX_RIGHT = INNER_RIGHT_X + INNER_W / 2;

  function tireColor(id: string): WheelColor {
    return getWheelColor(id, selectedWheel, affectedWheels, wheelColors);
  }

  function tireButton(
    id: string,
    style: React.CSSProperties,
    spare?: boolean
  ) {
    const color = tireColor(id);
    const isSelected = selectedWheel === id;
    return (
      <button
        key={id}
        type="button"
        onClick={() => onWheelClick(id)}
        className="absolute p-0 cursor-pointer focus-visible:outline-none"
        style={style}
        aria-label={t(spare ? "wheels.spareTire" : `wheels.${idToLabelKey(id)}`)}
      >
        {spare
          ? <TopDownSpareTireGraphic className="w-full h-full" color={color} />
          : <TopDownRoadTireGraphic className="w-full h-full" color={color} />
        }
        <span className={hotspotRing(isSelected, color)} />
      </button>
    );
  }

  return (
    <div className="relative w-full aspect-square select-none">
      {/* Axle lines SVG overlay */}
      <svg
        viewBox="0 0 100 100"
        className="absolute inset-0 w-full h-full pointer-events-none"
        preserveAspectRatio="none"
      >
        {/* Front axle */}
        <line
          x1={TIRE_CX_LEFT} y1={FRONT_CY}
          x2={TIRE_CX_RIGHT} y2={FRONT_CY}
          style={{ stroke: "var(--border)", strokeWidth: 0.8 }}
        />
        {/* Rear axle */}
        <line
          x1={is6 ? INNER_TIRE_CX_LEFT : TIRE_CX_LEFT} y1={rearCenterY}
          x2={is6 ? INNER_TIRE_CX_RIGHT : TIRE_CX_RIGHT} y2={rearCenterY}
          style={{ stroke: "var(--border)", strokeWidth: 0.8 }}
        />
        {/* Chassis center line */}
        <line
          x1={50} y1={FRONT_CY}
          x2={50} y2={rearCenterY}
          style={{ stroke: "var(--border)", strokeWidth: 0.8 }}
        />
        {/* Spare connector (dashed) */}
        {showSpareTire && (
          <line
            x1={50} y1={rearCenterY}
            x2={50} y2={spareCenterY - SPARE_W / 2}
            style={{ stroke: "var(--border)", strokeWidth: 0.6, strokeDasharray: "2 2" }}
          />
        )}
      </svg>

      {/* Front-left tire */}
      {tireButton("front-left", { left: `${LEFT_X}%`, top: `${FRONT_Y}%`, width: `${TIRE_W}%`, height: `${TIRE_H}%` })}
      {/* Front-right tire */}
      {tireButton("front-right", { left: `${RIGHT_X}%`, top: `${FRONT_Y}%`, width: `${TIRE_W}%`, height: `${TIRE_H}%` })}

      {/* Rear-left tire */}
      {tireButton("rear-left", { left: `${LEFT_X}%`, top: `${rearY}%`, width: `${TIRE_W}%`, height: `${TIRE_H}%` })}
      {/* Rear-right tire */}
      {tireButton("rear-right", { left: `${RIGHT_X}%`, top: `${rearY}%`, width: `${TIRE_W}%`, height: `${TIRE_H}%` })}

      {/* 6-wheel inner rear pair */}
      {is6 && tireButton("rear-left-inner",  { left: `${INNER_LEFT_X}%`,  top: `${rearY}%`, width: `${INNER_W}%`, height: `${TIRE_H}%` })}
      {is6 && tireButton("rear-right-inner", { left: `${INNER_RIGHT_X}%`, top: `${rearY}%`, width: `${INNER_W}%`, height: `${TIRE_H}%` })}

      {/* Spare tire */}
      {showSpareTire && tireButton(
        "spare-tire",
        { left: `${SPARE_LEFT}%`, top: `${spareTop}%`, width: `${SPARE_W}%`, height: `${SPARE_W}%` },
        true
      )}
    </div>
  );
}

function idToLabelKey(id: string): string {
  const map: Record<string, string> = {
    "front-left":       "frontLeft",
    "front-right":      "frontRight",
    "rear-left":        "rearLeft",
    "rear-right":       "rearRight",
    "rear-left-inner":  "rearLeftInner",
    "rear-right-inner": "rearRightInner",
  };
  return map[id] ?? id;
}
