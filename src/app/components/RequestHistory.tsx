import { useState, useMemo } from "react";
import { useNavigation } from "../NavigationContext";
import { useTranslation } from "react-i18next";
import { ArrowRight, Search } from "lucide-react";
import { getDateLocaleForLanguage, useTheme } from "../ThemeContext";
import { MOCK_REJECTION_REASON_EXAMPLE } from "../mockRejectionReason";
import { LicensePlate, type PlateType } from "./LicensePlate";
import { STATUS_LABEL_KEYS, STATUS_STYLES, type RequestStatus, type WheelWork } from "./OpenRequests";
import type { VehicleWheelCount } from "../vehicleWheelLayout";
import type { QualityTier } from "../qualityTier";

export interface HistoryEntry {
  id: string;
  /** Business request / case number (digits) — from backend */
  requestNumber: string;
  licensePlate: string;
  plateType: PlateType;
  status: RequestStatus;
  /** When status is `declined` — free text from backend */
  rejectionReason?: string;
  completedDate: string;
  frontTireSize: string;
  rearTireSize: string;
  frontTireProfile?: string;
  rearTireProfile?: string;
  quality?: QualityTier;
  frontAlignment: boolean;
  wheelCount?: VehicleWheelCount;
  wheels: Record<string, WheelWork>;
  notes?: string;
}

const MOCK_HISTORY: HistoryEntry[] = [
  {
    id: "h1",
    requestNumber: "30120401",
    licensePlate: "33-444-55",
    plateType: "civilian",
    status: "approved",
    completedDate: "2026-04-03",
    frontTireSize: "205/55R16",
    rearTireSize: "205/55R16",
    frontTireProfile: "91V",
    rearTireProfile: "91V",
    quality: "premium",
    frontAlignment: true,
    wheels: {
      "front-left": { reason: "סיבה 1", puncture: true, balancing: true, sensor: false, approval: "full" },
      "front-right": { reason: "סיבה 2", puncture: false, balancing: true, sensor: false, approval: "full" },
    },
    notes: "הוחלפו 2 צמיגים קדמיים",
  },
  {
    id: "h2",
    requestNumber: "30120402",
    licensePlate: "66-777-88",
    plateType: "military",
    status: "partly-approved",
    completedDate: "2026-04-02",
    frontTireSize: "225/45R17",
    rearTireSize: "225/45R17",
    frontTireProfile: "94W",
    rearTireProfile: "94W",
    frontAlignment: false,
    wheels: {
      "rear-left": { reason: "סיבה 4", puncture: true, balancing: false, sensor: true, approval: "puncture-only" },
      "rear-right": { reason: "סיבה 3", puncture: false, balancing: true, sensor: false, approval: "full" },
    },
    notes: "תוקן תקר אחורי שמאל, הוחלף אחורי ימין",
  },
  {
    id: "h3",
    requestNumber: "30120403",
    licensePlate: "12-345-67",
    plateType: "civilian",
    status: "approved",
    completedDate: "2026-03-28",
    frontTireSize: "205/55R16",
    rearTireSize: "205/55R16",
    frontTireProfile: "91V",
    rearTireProfile: "91V",
    quality: "premium",
    frontAlignment: false,
    wheels: {
      "front-left": { reason: "סיבה 0", puncture: false, balancing: true, sensor: false, approval: "full" },
    },
  },
  {
    id: "h4",
    requestNumber: "30120404",
    licensePlate: "99-111-22",
    plateType: "police",
    status: "declined",
    rejectionReason: MOCK_REJECTION_REASON_EXAMPLE,
    completedDate: "2026-03-25",
    frontTireSize: "195/65R15",
    rearTireSize: "195/65R15",
    frontTireProfile: "91H",
    rearTireProfile: "91H",
    frontAlignment: false,
    wheels: {
      "front-right": { reason: "סיבה 6", puncture: true, balancing: true, sensor: true, approval: "none" },
    },
  },
  {
    id: "h5",
    requestNumber: "30120405",
    licensePlate: "44-555-66",
    plateType: "civilian",
    status: "approved",
    completedDate: "2026-03-20",
    frontTireSize: "215/60R16",
    rearTireSize: "215/60R16",
    frontTireProfile: "96H",
    rearTireProfile: "96H",
    quality: "upgraded",
    frontAlignment: true,
    wheels: {
      "front-left": { reason: "סיבה 2", puncture: false, balancing: true, sensor: false, approval: "full" },
      "rear-right": { reason: "סיבה 1", puncture: true, balancing: false, sensor: true, approval: "full" },
    },
    notes: "עבודה מלאה בוצעה",
  },
  {
    id: "h6",
    requestNumber: "30120406",
    licensePlate: "77-888-99",
    plateType: "military",
    status: "partly-approved",
    completedDate: "2026-03-15",
    frontTireSize: "205/55R16",
    rearTireSize: "225/45R17",
    frontTireProfile: "91V",
    rearTireProfile: "94W",
    frontAlignment: false,
    wheels: {
      "front-left": { reason: "סיבה 5", puncture: true, balancing: true, sensor: false, approval: "full" },
      "rear-left": { reason: "סיבה 3", puncture: true, balancing: false, sensor: false, approval: "none" },
    },
  },
  {
    id: "h7",
    requestNumber: "30120407",
    licensePlate: "55-123-88",
    plateType: "police",
    status: "approved",
    completedDate: "2026-03-10",
    frontTireSize: "195/65R15",
    rearTireSize: "195/65R15",
    frontTireProfile: "91H",
    rearTireProfile: "91H",
    frontAlignment: true,
    wheels: {
      "front-right": { reason: "סיבה 0", puncture: false, balancing: true, sensor: true, approval: "full" },
      "rear-left": { reason: "סיבה 4", puncture: true, balancing: true, sensor: false, approval: "full" },
    },
    notes: "4 צמיגים + איזון",
  },
  {
    id: "h8",
    requestNumber: "30120408",
    licensePlate: "123456",
    plateType: "civilian",
    status: "approved",
    completedDate: "2026-04-06",
    frontTireSize: "235/75R17",
    rearTireSize: "235/75R17",
    frontTireProfile: "104S",
    rearTireProfile: "104S",
    quality: "premium",
    frontAlignment: false,
    wheelCount: 6,
    wheels: {
      "rear-right-inner": { reason: "סיבה 9", puncture: true, balancing: false, sensor: false, approval: "full" },
      "rear-left": { reason: "סיבה 2", puncture: false, balancing: true, sensor: false, approval: "full" },
    },
    notes: "משאית 6 גלגלים — תיקון פנימי ימני",
  },
];

function formatDate(dateStr: string, locale: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString(locale, { day: "numeric", month: "numeric", year: "numeric" });
}

export function RequestHistory() {
  const { t } = useTranslation();
  const { language } = useTheme();
  const dateLocale = getDateLocaleForLanguage(language);
  const { navigate } = useNavigation();
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const filtered = useMemo(() => {
    return MOCK_HISTORY.filter((entry) => {
      if (searchQuery) {
        const q = searchQuery.trim();
        const plateMatch = entry.licensePlate.includes(q);
        const idMatch = entry.requestNumber.includes(q);
        if (!plateMatch && !idMatch) return false;
      }
      if (dateFrom && entry.completedDate < dateFrom) return false;
      if (dateTo && entry.completedDate > dateTo) return false;
      return true;
    });
  }, [searchQuery, dateFrom, dateTo]);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="bg-primary p-4 shadow-md">
        <div className="flex items-center justify-between max-w-6xl mx-auto">
          <button
            onClick={() => navigate({ name: "dashboard" })}
            className="text-primary-foreground hover:opacity-80 transition-opacity"
          >
            <ArrowRight className="w-6 h-6" />
          </button>
          <h1 className="text-xl text-primary-foreground font-semibold">{t("history.title")}</h1>
          <div className="w-6" />
        </div>
      </div>

      {/* Filters */}
      <div className="bg-card border-b border-border p-4 shadow-sm">
        <div className="max-w-2xl mx-auto space-y-3">
          {/* Search */}
          <div className="relative">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("history.searchPlaceholder")}
              className="w-full ps-10 pe-4 py-3 bg-input-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
            />
          </div>

          {/* Date filters */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-xs font-semibold text-muted-foreground mb-1 block">{t("history.dateFrom")}</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-full px-3 py-2 bg-input-background border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
              />
            </div>
            <div className="flex-1">
              <label className="text-xs font-semibold text-muted-foreground mb-1 block">{t("history.dateTo")}</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-full px-3 py-2 bg-input-background border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 p-4 pb-8 overflow-y-auto">
        <div className="max-w-2xl mx-auto space-y-4">
          {filtered.length === 0 ? (
            <p className="text-center text-muted-foreground py-12">{t("history.empty")}</p>
          ) : (
            filtered.map((entry) => {
              const styles = STATUS_STYLES[entry.status];
              return (
                <button
                  key={entry.id}
                  onClick={() => navigate({ name: "history-detail", id: entry.id })}
                  className="w-full bg-card rounded-2xl p-5 shadow-md border border-border space-y-3 hover:shadow-lg hover:border-primary/30 transition-all duration-200 text-start"
                >
                  <LicensePlate plateNumber={entry.licensePlate} plateType={entry.plateType} className="w-full max-w-xs mx-auto" />
                  <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2">
                    <span
                      className={`inline-block px-3 py-1 rounded-full text-sm font-semibold ${styles.bg} ${styles.text} border ${styles.border}`}
                    >
                      {t(STATUS_LABEL_KEYS[entry.status])}
                    </span>
                    <span className="text-sm text-muted-foreground tabular-nums">
                      {t("common.requestNumberLine", { requestNumber: entry.requestNumber })}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {formatDate(entry.completedDate, dateLocale)}
                    </span>
                  </div>
                  {entry.status === "declined" && entry.rejectionReason && (
                    <p className="text-sm text-foreground text-center leading-snug line-clamp-2 px-1">
                      {entry.rejectionReason}
                    </p>
                  )}
                  {entry.status !== "declined" && entry.notes && (
                    <p className="text-sm text-muted-foreground text-center truncate">
                      {entry.notes}
                    </p>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

export function getHistoryEntry(id: string): HistoryEntry | undefined {
  return MOCK_HISTORY.find((e) => e.id === id);
}
