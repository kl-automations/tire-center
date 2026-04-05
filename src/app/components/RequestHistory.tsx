import { useState, useMemo } from "react";
import { useNavigate } from "react-router";
import { ArrowRight, Search } from "lucide-react";
import { LicensePlate } from "./LicensePlate";
import { STATUS_CONFIG, type RequestStatus, type WheelWork } from "./OpenRequests";

interface HistoryEntry {
  id: string;
  licensePlate: string;
  status: RequestStatus;
  completedDate: string;
  frontTireSize: string;
  rearTireSize: string;
  frontAlignment: boolean;
  wheels: Record<string, WheelWork>;
  notes?: string;
}

const MOCK_HISTORY: HistoryEntry[] = [
  {
    id: "h1",
    licensePlate: "33-444-55",
    status: "approved",
    completedDate: "2026-04-03",
    frontTireSize: "205/55R16",
    rearTireSize: "205/55R16",
    frontAlignment: true,
    wheels: {
      "front-left": { reason: "סיבה 1", puncture: true, balancing: true, sensor: false, approval: "full" },
      "front-right": { reason: "סיבה 2", puncture: false, balancing: true, sensor: false, approval: "full" },
    },
    notes: "הוחלפו 2 צמיגים קדמיים",
  },
  {
    id: "h2",
    licensePlate: "66-777-88",
    status: "partly-approved",
    completedDate: "2026-04-02",
    frontTireSize: "225/45R17",
    rearTireSize: "225/45R17",
    frontAlignment: false,
    wheels: {
      "rear-left": { reason: "סיבה 4", puncture: true, balancing: false, sensor: true, approval: "puncture-only" },
      "rear-right": { reason: "סיבה 3", puncture: false, balancing: true, sensor: false, approval: "full" },
    },
    notes: "תוקן תקר אחורי שמאל, הוחלף אחורי ימין",
  },
  {
    id: "h3",
    licensePlate: "12-345-67",
    status: "approved",
    completedDate: "2026-03-28",
    frontTireSize: "205/55R16",
    rearTireSize: "205/55R16",
    frontAlignment: false,
    wheels: {
      "front-left": { reason: "סיבה 0", puncture: false, balancing: true, sensor: false, approval: "full" },
    },
  },
  {
    id: "h4",
    licensePlate: "99-111-22",
    status: "declined",
    completedDate: "2026-03-25",
    frontTireSize: "195/65R15",
    rearTireSize: "195/65R15",
    frontAlignment: false,
    wheels: {
      "front-right": { reason: "סיבה 6", puncture: true, balancing: true, sensor: true, approval: "none" },
    },
  },
  {
    id: "h5",
    licensePlate: "44-555-66",
    status: "approved",
    completedDate: "2026-03-20",
    frontTireSize: "215/60R16",
    rearTireSize: "215/60R16",
    frontAlignment: true,
    wheels: {
      "front-left": { reason: "סיבה 2", puncture: false, balancing: true, sensor: false, approval: "full" },
      "rear-right": { reason: "סיבה 1", puncture: true, balancing: false, sensor: true, approval: "full" },
    },
    notes: "עבודה מלאה בוצעה",
  },
  {
    id: "h6",
    licensePlate: "77-888-99",
    status: "partly-approved",
    completedDate: "2026-03-15",
    frontTireSize: "205/55R16",
    rearTireSize: "225/45R17",
    frontAlignment: false,
    wheels: {
      "front-left": { reason: "סיבה 5", puncture: true, balancing: true, sensor: false, approval: "full" },
      "rear-left": { reason: "סיבה 3", puncture: true, balancing: false, sensor: false, approval: "none" },
    },
  },
  {
    id: "h7",
    licensePlate: "55-123-88",
    status: "approved",
    completedDate: "2026-03-10",
    frontTireSize: "195/65R15",
    rearTireSize: "195/65R15",
    frontAlignment: true,
    wheels: {
      "front-right": { reason: "סיבה 0", puncture: false, balancing: true, sensor: true, approval: "full" },
      "rear-left": { reason: "סיבה 4", puncture: true, balancing: true, sensor: false, approval: "full" },
    },
    notes: "4 צמיגים + איזון",
  },
];

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("he-IL", { day: "numeric", month: "numeric", year: "numeric" });
}

export function RequestHistory() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const filtered = useMemo(() => {
    return MOCK_HISTORY.filter((entry) => {
      if (searchQuery && !entry.licensePlate.includes(searchQuery)) return false;
      if (dateFrom && entry.completedDate < dateFrom) return false;
      if (dateTo && entry.completedDate > dateTo) return false;
      return true;
    });
  }, [searchQuery, dateFrom, dateTo]);

  return (
    <div className="min-h-screen bg-background flex flex-col" dir="rtl">
      {/* Header */}
      <div className="bg-primary p-4 shadow-md">
        <div className="flex items-center justify-between max-w-6xl mx-auto">
          <button
            onClick={() => navigate("/dashboard")}
            className="text-primary-foreground hover:opacity-80 transition-opacity"
          >
            <ArrowRight className="w-6 h-6" />
          </button>
          <h1 className="text-xl text-primary-foreground font-semibold">היסטוריית פניות</h1>
          <div className="w-6" />
        </div>
      </div>

      {/* Filters */}
      <div className="bg-card border-b border-border p-4 shadow-sm">
        <div className="max-w-2xl mx-auto space-y-3">
          {/* Search */}
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="חפש לפי מספר רישוי..."
              className="w-full pr-10 pl-4 py-3 bg-input-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
            />
          </div>

          {/* Date filters */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-xs font-semibold text-muted-foreground mb-1 block">מתאריך</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-full px-3 py-2 bg-input-background border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
              />
            </div>
            <div className="flex-1">
              <label className="text-xs font-semibold text-muted-foreground mb-1 block">עד תאריך</label>
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
            <p className="text-center text-muted-foreground py-12">לא נמצאו פניות</p>
          ) : (
            filtered.map((entry) => {
              const config = STATUS_CONFIG[entry.status];
              return (
                <button
                  key={entry.id}
                  onClick={() => navigate(`/history/detail/${entry.id}`)}
                  className="w-full bg-card rounded-2xl p-5 shadow-md border border-border space-y-3 hover:shadow-lg hover:border-primary/30 transition-all duration-200 text-right"
                >
                  <LicensePlate plateNumber={entry.licensePlate} className="w-full max-w-xs mx-auto" />
                  <div className="flex items-center justify-center gap-3">
                    <span
                      className={`inline-block px-3 py-1 rounded-full text-sm font-semibold ${config.bg} ${config.text} border ${config.border}`}
                    >
                      {config.label}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {formatDate(entry.completedDate)}
                    </span>
                  </div>
                  {entry.notes && (
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
