import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { ArrowRight, X as XIcon } from "lucide-react";
import { CarVisualization, type WheelColor } from "./CarVisualization";
import { LicensePlate } from "./LicensePlate";
import { STATUS_CONFIG, type WheelWork } from "./OpenRequests";
import { getHistoryEntry } from "./RequestHistory";

const WHEEL_LABELS: Record<string, string> = {
  "front-right": "ימין קדמי",
  "front-left": "שמאל קדמי",
  "rear-right": "ימין אחורי",
  "rear-left": "שמאל אחורי",
};

function WheelDetailPopup({
  isOpen,
  onClose,
  wheelPosition,
  work,
}: {
  isOpen: boolean;
  onClose: () => void;
  wheelPosition: string;
  work: WheelWork;
}) {
  if (!isOpen) return null;

  const services = [
    { label: "תקר", active: work.puncture },
    { label: "איזון", active: work.balancing },
    { label: "חיישן", active: work.sensor },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" dir="rtl">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-card rounded-2xl shadow-2xl p-6 w-full max-w-lg mx-4 border border-border">
        <button
          onClick={onClose}
          className="absolute top-4 left-4 text-muted-foreground hover:text-foreground transition-colors"
        >
          <XIcon className="w-6 h-6" />
        </button>

        <div className="space-y-5">
          <div className="text-center">
            <h2 className="text-xl font-semibold text-foreground">
              {WHEEL_LABELS[wheelPosition] || wheelPosition}
            </h2>
            <div className="mt-2 flex justify-center">
              <span
                className={`inline-block px-3 py-1 rounded-full text-sm font-semibold border ${
                  work.approval === "full"
                    ? "bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300 border-green-300 dark:border-green-700"
                    : work.approval === "puncture-only"
                      ? "bg-orange-100 dark:bg-orange-900/40 text-orange-800 dark:text-orange-300 border-orange-300 dark:border-orange-700"
                      : "bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-300 border-red-300 dark:border-red-700"
                }`}
              >
                {work.approval === "full"
                  ? "מאושר"
                  : work.approval === "puncture-only"
                    ? "תיקון תקר בלבד"
                    : "לא מאושר"}
              </span>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold text-foreground">סיבה</label>
            <div className="w-full px-4 py-3 bg-muted border border-border rounded-lg text-foreground">
              {work.reason}
            </div>
          </div>

          <div className="space-y-3">
            {services.map((s) => (
              <div
                key={s.label}
                className="flex items-center justify-between bg-background rounded-xl px-4 py-3 border border-border"
              >
                <span className="font-semibold text-foreground">{s.label}</span>
                <span
                  className={`px-3 py-1 rounded-full text-sm font-semibold ${
                    s.active
                      ? "bg-primary/10 dark:bg-blue-400/15 text-primary dark:text-blue-400"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {s.active ? "כן" : "לא"}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function HistoryDetail() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [selectedWheel, setSelectedWheel] = useState<string | null>(null);
  const [detailWheel, setDetailWheel] = useState<string | null>(null);

  const entry = getHistoryEntry(id || "");

  if (!entry) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center" dir="rtl">
        <p className="text-muted-foreground text-lg">פנייה לא נמצאה</p>
      </div>
    );
  }

  const statusConfig = STATUS_CONFIG[entry.status];
  const wheels = entry.wheels || {};
  const wheelColors: Record<string, WheelColor> = {};
  for (const [pos, work] of Object.entries(wheels)) {
    if (work.approval === "full") wheelColors[pos] = "green";
    else if (work.approval === "puncture-only") wheelColors[pos] = "orange";
    else wheelColors[pos] = "red";
  }
  const currentWheelWork = detailWheel ? wheels[detailWheel] : null;

  const handleWheelClick = (wheelPosition: string) => {
    setSelectedWheel(wheelPosition);
    if (wheels[wheelPosition]) {
      setDetailWheel(wheelPosition);
    }
  };

  const completedDate = new Date(entry.completedDate).toLocaleDateString("he-IL", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
  });

  return (
    <div className="min-h-screen bg-background flex flex-col" dir="rtl">
      {/* Header */}
      <div className="bg-primary p-4 shadow-md">
        <div className="flex items-center justify-between max-w-6xl mx-auto">
          <button
            onClick={() => navigate("/history")}
            className="text-primary-foreground hover:opacity-80 transition-opacity"
          >
            <ArrowRight className="w-6 h-6" />
          </button>
          <h1 className="text-xl text-primary-foreground font-semibold">פרטי פנייה</h1>
          <div className="w-6" />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 p-4 pb-8 overflow-y-auto">
        <div className="max-w-6xl mx-auto space-y-6">
          {/* License Plate */}
          <LicensePlate plateNumber={entry.licensePlate} className="w-full max-w-md mx-auto" />

          {/* Status + Date */}
          <div className="flex flex-col items-center gap-2">
            <span
              className={`inline-block px-4 py-2 rounded-full text-base font-semibold ${statusConfig.bg} ${statusConfig.text} border ${statusConfig.border}`}
            >
              {statusConfig.label}
            </span>
            <span className="text-sm text-muted-foreground">הושלם: {completedDate}</span>
          </div>

          {/* Car Visualization */}
          <div className="bg-card rounded-2xl p-6 shadow-md border border-border">
            <h3 className="text-lg font-semibold text-foreground mb-6 text-center">
              גלגלים בפנייה
            </h3>
            <div className="relative w-full max-w-3xl mx-auto">
              <CarVisualization
                onWheelClick={handleWheelClick}
                selectedWheel={selectedWheel}
                wheelColors={wheelColors}
                frontTireSize={entry.frontTireSize}
                rearTireSize={entry.rearTireSize}
              />
            </div>
            <p className="text-center text-sm text-muted-foreground mt-4">
              לחץ על גלגל מסומן לצפייה בפרטים
            </p>
          </div>

          {/* Front Alignment */}
          <div className="bg-card rounded-2xl p-6 shadow-md border border-border">
            <div className="flex items-center justify-between">
              <span className="text-lg font-semibold text-foreground">כיוון פרונט</span>
              <span
                className={`px-3 py-1 rounded-full text-sm font-semibold ${
                  entry.frontAlignment
                    ? "bg-primary/10 dark:bg-blue-400/15 text-primary dark:text-blue-400"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {entry.frontAlignment ? "כן" : "לא"}
              </span>
            </div>
          </div>

          {/* Notes */}
          {entry.notes && (
            <div className="bg-card rounded-2xl p-6 shadow-md border border-border">
              <h3 className="text-lg font-semibold text-foreground mb-2">הערות ביצוע</h3>
              <p className="text-foreground">{entry.notes}</p>
            </div>
          )}
        </div>
      </div>

      {/* Wheel Detail Popup */}
      {currentWheelWork && (
        <WheelDetailPopup
          isOpen={detailWheel !== null}
          onClose={() => setDetailWheel(null)}
          wheelPosition={detailWheel!}
          work={currentWheelWork}
        />
      )}
    </div>
  );
}
