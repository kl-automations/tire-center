import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { X, Send, Check } from "lucide-react";

type Period = "1m" | "3m" | "6m";

function isValidEmail(value: string) {
  const v = value.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

export function ExportHistoryModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [period, setPeriod] = useState<Period | null>(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const canExport = isValidEmail(email) && period !== null;

  const handleExport = () => {
    if (!canExport) return;
    // Mock send — in production this would call the backend
    setSent(true);
    setTimeout(() => {
      setSent(false);
      setEmail("");
      setPeriod(null);
      onClose();
    }, 2000);
  };

  const handleClose = () => {
    setEmail("");
    setPeriod(null);
    setSent(false);
    onClose();
  };

  const PERIODS: { key: Period; label: string }[] = [
    { key: "1m", label: t("exportHistory.period1month") },
    { key: "3m", label: t("exportHistory.period3months") },
    { key: "6m", label: t("exportHistory.period6months") },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={handleClose} />
      <div className="relative bg-card rounded-t-2xl sm:rounded-2xl shadow-2xl p-6 w-full max-w-md mx-0 sm:mx-4 border border-border">
        {/* Close */}
        <button
          onClick={handleClose}
          className="absolute top-4 start-4 text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="space-y-5">
          {/* Title */}
          <h2 className="text-lg font-semibold text-foreground text-center">
            {t("exportHistory.title")}
          </h2>

          {/* Explanation */}
          <p className="text-sm text-muted-foreground text-center leading-relaxed bg-muted/60 rounded-xl px-4 py-3">
            {t("exportHistory.explanation")}
          </p>

          {/* Email */}
          <div className="space-y-1.5">
            <label className="text-sm font-semibold text-foreground block">
              {t("exportHistory.emailLabel")}
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("exportHistory.emailPlaceholder")}
              className="w-full px-4 py-3 bg-input-background border border-border rounded-xl text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
              dir="ltr"
            />
          </div>

          {/* Period selector */}
          <div className="space-y-1.5">
            <label className="text-sm font-semibold text-foreground block">
              {t("exportHistory.periodLabel")}
            </label>
            <div className="flex flex-wrap gap-2">
              {PERIODS.map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setPeriod(key)}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-semibold border-2 transition-all duration-150 ${
                    period === key
                      ? "bg-primary border-primary text-primary-foreground"
                      : "bg-background border-border text-foreground hover:border-primary/50"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Export button */}
          <button
            onClick={handleExport}
            disabled={!canExport || sent}
            className={`w-full py-3 rounded-xl font-semibold flex items-center justify-center gap-2 transition-all duration-200 ${
              sent
                ? "bg-green-600 text-white"
                : canExport
                  ? "bg-primary hover:bg-primary/90 text-primary-foreground shadow-md hover:shadow-lg"
                  : "bg-muted text-muted-foreground cursor-not-allowed"
            }`}
          >
            {sent ? (
              <>
                <Check className="w-5 h-5" />
                {t("exportHistory.sent")}
              </>
            ) : (
              <>
                <Send className="w-5 h-5" />
                {t("exportHistory.exportButton")}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
