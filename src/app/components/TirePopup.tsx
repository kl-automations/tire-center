import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { X } from "lucide-react";
import * as XLSX from "xlsx";

export interface WheelData {
  reason: string;
  puncture: boolean;
  balancing: boolean;
  sensor: boolean;
}

interface TirePopupProps {
  isOpen: boolean;
  onClose: () => void;
  wheelPosition: string;
  licensePlate: string;
  onSubmit: (wheelPosition: string, data: WheelData) => void;
}

const WHEEL_LABELS: Record<string, string> = {
  "front-right": "ימין קדמי",
  "front-left": "שמאל קדמי",
  "rear-right": "ימין אחורי",
  "rear-left": "שמאל אחורי",
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
        // Skip header row, take first column values
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

export function TirePopup({ isOpen, onClose, wheelPosition, licensePlate, onSubmit }: TirePopupProps) {
  const navigate = useNavigate();
  const { reasons, loading } = useReasons();
  const [selectedReason, setSelectedReason] = useState<string | null>(null);
  const [puncture, setPuncture] = useState(false);
  const [balancing, setBalancing] = useState(false);
  const [sensor, setSensor] = useState(false);

  const resetState = () => {
    setSelectedReason(null);
    setPuncture(false);
    setBalancing(false);
    setSensor(false);
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  const handleContinue = () => {
    onSubmit(wheelPosition, {
      reason: selectedReason || "",
      puncture,
      balancing,
      sensor,
    });
    const params = new URLSearchParams({
      plate: licensePlate,
      wheel: wheelPosition,
    });
    navigate(`/carool-check?${params.toString()}`);
    resetState();
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" dir="rtl">
      <div className="absolute inset-0 bg-black/50" onClick={handleClose} />

      <div className="relative bg-card rounded-2xl shadow-2xl p-6 w-full max-w-lg mx-4 border border-border">
        <button
          onClick={handleClose}
          className="absolute top-4 left-4 text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="w-6 h-6" />
        </button>

        <div className="space-y-6">
          {/* Title */}
          <div className="text-center">
            <h2 className="text-xl font-semibold text-foreground">
              {WHEEL_LABELS[wheelPosition] || wheelPosition}
            </h2>
            <p className="text-sm text-muted-foreground mt-1">בחר סיבה ופעולות</p>
          </div>

          {/* Reason selector */}
          <div className="space-y-2">
            <label className="text-sm font-semibold text-foreground">סיבה להחלפה / תיקון</label>
            {loading ? (
              <div className="text-sm text-muted-foreground text-center py-3">טוען סיבות...</div>
            ) : (
              <select
                value={selectedReason || ""}
                onChange={(e) => setSelectedReason(e.target.value || null)}
                className="w-full px-4 py-3 bg-input-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-ring dark:focus:ring-blue-400 focus:border-transparent transition-all [&>option]:bg-card [&>option]:text-foreground"
              >
                <option value="">בחר סיבה...</option>
                {reasons.map((reason) => (
                  <option key={reason} value={reason}>
                    {reason}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Toggle switches */}
          <div className="space-y-3">
            <ToggleRow label="תקר" value={puncture} onChange={setPuncture} />
            <ToggleRow label="איזון" value={balancing} onChange={setBalancing} />
            <ToggleRow label="חיישן" value={sensor} onChange={setSensor} />
          </div>

          {/* Continue button */}
          <button
            onClick={handleContinue}
            disabled={!selectedReason}
            className="w-full bg-primary hover:bg-primary/90 text-primary-foreground py-3 rounded-xl transition-colors duration-200 shadow-md hover:shadow-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-primary"
          >
            המשך לבדיקה עם קרול
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
