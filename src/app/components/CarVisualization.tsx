import React from "react";

export type WheelColor = "green" | "orange" | "red" | "default";

interface CarVisualizationProps {
  onWheelClick: (wheelPosition: string) => void;
  selectedWheel?: string | null;
  affectedWheels?: Set<string>;
  wheelColors?: Record<string, WheelColor>;
  frontTireSize: string;
  rearTireSize: string;
}

function TireIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 40 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Tire body */}
      <rect x="2" y="2" width="36" height="60" rx="10" fill="currentColor" fillOpacity="0.2" stroke="currentColor" strokeWidth="3" />
      {/* Center groove */}
      <line x1="20" y1="8" x2="20" y2="56" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      {/* Tread grooves - angled left */}
      <line x1="4" y1="14" x2="18" y2="10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="4" y1="24" x2="18" y2="20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="4" y1="34" x2="18" y2="30" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="4" y1="44" x2="18" y2="40" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="4" y1="54" x2="18" y2="50" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      {/* Tread grooves - angled right */}
      <line x1="22" y1="10" x2="36" y2="14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="22" y1="20" x2="36" y2="24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="22" y1="30" x2="36" y2="34" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="22" y1="40" x2="36" y2="44" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="22" y1="50" x2="36" y2="54" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

const COLOR_STYLES: Record<WheelColor, { border: string; icon: string; label: string }> = {
  green: {
    border: "border-green-500 bg-green-50 dark:bg-green-900/30 shadow-md",
    icon: "text-green-600 dark:text-green-400",
    label: "text-green-700 dark:text-green-300",
  },
  orange: {
    border: "border-orange-400 bg-orange-50 dark:bg-orange-900/30 shadow-md",
    icon: "text-orange-500 dark:text-orange-400",
    label: "text-orange-600 dark:text-orange-300",
  },
  red: {
    border: "border-destructive bg-destructive/10 shadow-md",
    icon: "text-destructive",
    label: "text-destructive",
  },
  default: {
    border: "border-border bg-card hover:border-primary/50 hover:bg-muted",
    icon: "text-foreground/70",
    label: "text-muted-foreground",
  },
};

function WheelButton({
  label,
  isSelected,
  color = "default",
  onClick,
}: {
  label: string;
  isSelected: boolean;
  color?: WheelColor;
  onClick: () => void;
}) {
  const styles = isSelected
    ? { border: "border-primary dark:border-blue-400 bg-primary/10 dark:bg-blue-400/15 shadow-md scale-105", icon: "text-primary dark:text-blue-400", label: "text-primary dark:text-blue-400" }
    : COLOR_STYLES[color];

  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center gap-2 px-5 py-4 rounded-2xl border-2 transition-all duration-200 ${styles.border}`}
    >
      <TireIcon className={`w-12 h-12 ${styles.icon}`} />
      <span className={`text-sm font-semibold whitespace-nowrap ${styles.label}`}>
        {label}
      </span>
    </button>
  );
}

export function CarVisualization({
  onWheelClick,
  selectedWheel,
  affectedWheels = new Set(),
  wheelColors = {},
  frontTireSize,
  rearTireSize,
}: CarVisualizationProps) {
  const getColor = (pos: string): WheelColor => {
    if (wheelColors[pos]) return wheelColors[pos];
    if (affectedWheels.has(pos)) return "red";
    return "default";
  };

  return (
    <div className="flex flex-col items-center gap-4 py-2" dir="rtl">
      {/* Front label */}
      <div className="flex flex-col items-center gap-1">
        <span className="text-xs font-semibold text-muted-foreground tracking-widest uppercase">
          ▲ קדמי
        </span>
        <span dir="ltr" className="text-sm font-bold text-foreground bg-muted px-3 py-0.5 rounded-full">
          {frontTireSize}
        </span>
      </div>

      {/* Front wheels */}
      <div className="flex gap-10 justify-center">
        <WheelButton
          label="ימין קדמי"
          isSelected={selectedWheel === "front-right"}
          color={getColor("front-right")}
          onClick={() => onWheelClick("front-right")}
        />
        <WheelButton
          label="שמאל קדמי"
          isSelected={selectedWheel === "front-left"}
          color={getColor("front-left")}
          onClick={() => onWheelClick("front-left")}
        />
      </div>

      {/* Car emoji */}
      <div className="text-7xl leading-none select-none my-1 rotate-90">🚗</div>

      {/* Rear wheels */}
      <div className="flex gap-10 justify-center">
        <WheelButton
          label="ימין אחורי"
          isSelected={selectedWheel === "rear-right"}
          color={getColor("rear-right")}
          onClick={() => onWheelClick("rear-right")}
        />
        <WheelButton
          label="שמאל אחורי"
          isSelected={selectedWheel === "rear-left"}
          color={getColor("rear-left")}
          onClick={() => onWheelClick("rear-left")}
        />
      </div>

      {/* Rear label */}
      <div className="flex flex-col items-center gap-1">
        <span className="text-xs font-semibold text-muted-foreground tracking-widest uppercase">
          ▼ אחורי
        </span>
        <span dir="ltr" className="text-sm font-bold text-foreground bg-muted px-3 py-0.5 rounded-full">
          {rearTireSize}
        </span>
      </div>
    </div>
  );
}
