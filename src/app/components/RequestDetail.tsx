import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { ArrowRight, Check, X as XIcon } from "lucide-react";
import { CarVisualization, type WheelColor } from "./CarVisualization";
import { LicensePlate } from "./LicensePlate";
import {
  getStoredRequests,
  storeRequests,
  STATUS_CONFIG,
  type OpenRequest,
  type WheelWork,
} from "./OpenRequests";

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

function ConfirmationPopup({
  isOpen,
  onClose,
  onConfirm,
}: {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (notes: string) => void;
}) {
  const [notes, setNotes] = useState("");

  if (!isOpen) return null;

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
            <h2 className="text-xl font-semibold text-foreground">אישור ביצוע</h2>
            <p className="text-sm text-muted-foreground mt-1">
              האם לאשר את סיום העבודה על פנייה זו?
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold text-foreground">
              הערות (אופציונלי)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="פרט את העבודה שבוצעה..."
              rows={4}
              className="w-full px-4 py-3 bg-input-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all resize-none"
            />
          </div>

          <button
            onClick={() => onConfirm(notes)}
            className="w-full bg-green-600 hover:bg-green-700 text-white py-3 rounded-xl transition-colors duration-200 shadow-md hover:shadow-lg font-semibold flex items-center justify-center gap-2"
          >
            <Check className="w-5 h-5" />
            אישור ביצוע
          </button>
        </div>
      </div>
    </div>
  );
}

export function RequestDetail() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [selectedWheel, setSelectedWheel] = useState<string | null>(null);
  const [detailWheel, setDetailWheel] = useState<string | null>(null);
  const [showConfirmation, setShowConfirmation] = useState(false);

  const requests = getStoredRequests();
  const request = requests.find((r) => r.id === id);

  if (!request) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center" dir="rtl">
        <p className="text-muted-foreground text-lg">פנייה לא נמצאה</p>
      </div>
    );
  }

  const statusConfig = STATUS_CONFIG[request.status];
  const canConfirm = request.status === "approved" || request.status === "partly-approved";
  const wheels = request.wheels || {};
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

  const handleConfirm = (notes: string) => {
    console.log("Request confirmed:", request.id, "Notes:", notes);
    const updated = requests.filter((r) => r.id !== request.id);
    storeRequests(updated);
    setShowConfirmation(false);
    navigate("/open-requests");
  };

  return (
    <div className="min-h-screen bg-background flex flex-col" dir="rtl">
      {/* Header */}
      <div className="bg-primary p-4 shadow-md">
        <div className="flex items-center justify-between max-w-6xl mx-auto">
          <button
            onClick={() => navigate("/open-requests")}
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
          <LicensePlate plateNumber={request.licensePlate} className="w-full max-w-md mx-auto" />

          {/* Status Badge */}
          <div className="flex justify-center">
            <span
              className={`inline-block px-4 py-2 rounded-full text-base font-semibold ${statusConfig.bg} ${statusConfig.text} border ${statusConfig.border}`}
            >
              {statusConfig.label}
            </span>
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
                frontTireSize={request.frontTireSize}
                rearTireSize={request.rearTireSize}
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
                  request.frontAlignment
                    ? "bg-primary/10 dark:bg-blue-400/15 text-primary dark:text-blue-400"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {request.frontAlignment ? "כן" : "לא"}
              </span>
            </div>
          </div>

          {/* Confirm Button - only for approved / partly-approved */}
          {canConfirm && (
            <button
              onClick={() => setShowConfirmation(true)}
              className="w-full bg-green-600 hover:bg-green-700 text-white py-4 rounded-xl transition-colors duration-200 shadow-lg hover:shadow-xl font-semibold text-lg flex items-center justify-center gap-2"
            >
              <Check className="w-6 h-6" />
              אישור ביצוע
            </button>
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

      {/* Confirmation Popup */}
      <ConfirmationPopup
        isOpen={showConfirmation}
        onClose={() => setShowConfirmation(false)}
        onConfirm={handleConfirm}
      />
    </div>
  );
}
