import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowRight, Search } from "lucide-react";
import { MOCK_REJECTION_REASON_EXAMPLE } from "../mockRejectionReason";
import type { VehicleWheelCount } from "../vehicleWheelLayout";
import type { QualityTier } from "../qualityTier";
import { LicensePlate, type PlateType } from "./LicensePlate";

export type RequestStatus = "waiting" | "approved" | "partly-approved" | "declined";

export type WheelApproval = "full" | "puncture-only" | "none";

export interface WheelWork {
  reason: string;
  puncture: boolean;
  balancing: boolean;
  sensor: boolean;
  approval: WheelApproval;
}

export interface OpenRequest {
  id: string;
  /** Business request / case number (digits) — from backend */
  requestNumber: string;
  licensePlate: string;
  plateType: PlateType;
  status: RequestStatus;
  /** When status is `declined` — free text from backend */
  rejectionReason?: string;
  /** Date the request was opened (ISO `YYYY-MM-DD`) — from backend */
  submittedDate: string;
  hasUpdate: boolean;
  frontTireSize: string;
  rearTireSize: string;
  /** Load index + speed rating e.g. 91V — from backend */
  frontTireProfile?: string;
  rearTireProfile?: string;
  /** Tire quality tier — from backend */
  quality?: QualityTier;
  frontAlignment: boolean;
  /** From backend; omit = 4 wheels (or derive from plate in UI) */
  wheelCount?: VehicleWheelCount;
  wheels: Record<string, WheelWork>;
}

/** i18n keys under `status.*` — use with t() */
export const STATUS_LABEL_KEYS: Record<RequestStatus, string> = {
  waiting: "status.waiting",
  approved: "status.approved",
  "partly-approved": "status.partlyApproved",
  declined: "status.declined",
};

export const STATUS_STYLES: Record<RequestStatus, { bg: string; text: string; border: string }> = {
  waiting: {
    bg: "bg-amber-100 dark:bg-amber-900/40",
    text: "text-amber-800 dark:text-amber-300",
    border: "border-amber-300 dark:border-amber-700",
  },
  approved: {
    bg: "bg-green-100 dark:bg-green-900/40",
    text: "text-green-800 dark:text-green-300",
    border: "border-green-300 dark:border-green-700",
  },
  "partly-approved": {
    bg: "bg-blue-100 dark:bg-blue-900/40",
    text: "text-blue-900 dark:text-blue-300",
    border: "border-blue-400 dark:border-blue-700",
  },
  declined: {
    bg: "bg-red-100 dark:bg-red-900/40",
    text: "text-red-800 dark:text-red-300",
    border: "border-red-300 dark:border-red-700",
  },
};

const MOCK_REQUESTS: OpenRequest[] = [
  {
    id: "1",
    requestNumber: "10048201",
    licensePlate: "12-345-67",
    plateType: "civilian",
    status: "waiting",
    hasUpdate: false,
    submittedDate: "2026-04-01",
    frontTireSize: "205/55R16",
    rearTireSize: "205/55R16",
    frontTireProfile: "91V",
    rearTireProfile: "91V",
    quality: "chinese",
    frontAlignment: false,
    wheels: {
      "front-left": { reason: "סיבה 1", puncture: true, balancing: false, sensor: false, approval: "none" },
      "rear-right": { reason: "סיבה 3", puncture: false, balancing: true, sensor: false, approval: "none" },
    },
  },
  {
    id: "2",
    requestNumber: "10048202",
    licensePlate: "98-765-43",
    plateType: "military",
    status: "approved",
    hasUpdate: true,
    submittedDate: "2026-04-02",
    frontTireSize: "225/45R17",
    rearTireSize: "255/40R17",
    frontTireProfile: "94W",
    rearTireProfile: "99Y",
    frontAlignment: true,
    wheels: {
      "front-left": { reason: "סיבה 2", puncture: false, balancing: true, sensor: true, approval: "full" },
      "front-right": { reason: "סיבה 0", puncture: true, balancing: false, sensor: false, approval: "full" },
    },
  },
  {
    id: "3",
    requestNumber: "10048203",
    licensePlate: "55-123-88",
    plateType: "police",
    status: "partly-approved",
    hasUpdate: true,
    submittedDate: "2026-04-03",
    frontTireSize: "195/65R15",
    rearTireSize: "195/65R15",
    frontTireProfile: "91H",
    rearTireProfile: "91H",
    frontAlignment: false,
    wheels: {
      "front-right": { reason: "סיבה 4", puncture: true, balancing: true, sensor: false, approval: "full" },
      "rear-left": { reason: "סיבה 1", puncture: true, balancing: false, sensor: true, approval: "puncture-only" },
      "rear-right": { reason: "סיבה 5", puncture: false, balancing: true, sensor: false, approval: "none" },
    },
  },
  {
    id: "4",
    requestNumber: "10048204",
    licensePlate: "11-222-33",
    plateType: "civilian",
    status: "declined",
    rejectionReason: MOCK_REJECTION_REASON_EXAMPLE,
    hasUpdate: false,
    submittedDate: "2026-04-04",
    frontTireSize: "205/55R16",
    rearTireSize: "225/45R17",
    frontTireProfile: "91V",
    rearTireProfile: "94W",
    quality: "upgraded",
    frontAlignment: false,
    wheels: {
      "front-left": { reason: "סיבה 6", puncture: true, balancing: true, sensor: true, approval: "none" },
    },
  },
  {
    id: "5",
    requestNumber: "10048205",
    licensePlate: "77-888-99",
    plateType: "military",
    status: "waiting",
    hasUpdate: true,
    submittedDate: "2026-04-05",
    frontTireSize: "215/60R16",
    rearTireSize: "215/60R16",
    frontTireProfile: "96H",
    rearTireProfile: "96H",
    frontAlignment: true,
    wheels: {
      "front-left": { reason: "סיבה 0", puncture: false, balancing: true, sensor: false, approval: "none" },
      "rear-left": { reason: "סיבה 2", puncture: true, balancing: false, sensor: true, approval: "none" },
    },
  },
  {
    id: "6",
    requestNumber: "10048206",
    licensePlate: "123456",
    plateType: "civilian",
    status: "waiting",
    hasUpdate: true,
    submittedDate: "2026-04-06",
    frontTireSize: "235/75R17",
    rearTireSize: "235/75R17",
    frontTireProfile: "104S",
    rearTireProfile: "104S",
    quality: "premium",
    frontAlignment: false,
    wheelCount: 6,
    wheels: {
      "front-right": { reason: "סיבה 1", puncture: false, balancing: true, sensor: false, approval: "none" },
      "rear-right-inner": { reason: "סיבה 7", puncture: true, balancing: false, sensor: false, approval: "none" },
      "rear-left-inner": { reason: "סיבה 8", puncture: false, balancing: true, sensor: true, approval: "none" },
    },
  },
];

export function getStoredRequests(): OpenRequest[] {
  try {
    const raw = sessionStorage.getItem("open-requests");
    if (!raw) return MOCK_REQUESTS;
    const parsed: OpenRequest[] = JSON.parse(raw);
    if (parsed.length > 0 && typeof parsed[0].requestNumber !== "string") {
      sessionStorage.removeItem("open-requests");
      return MOCK_REQUESTS;
    }
    if (parsed.length > 0 && typeof parsed[0].submittedDate !== "string") {
      sessionStorage.removeItem("open-requests");
      return MOCK_REQUESTS;
    }
    if (
      parsed.length > 0 &&
      (!parsed[0].wheels ||
        (parsed[0].wheels &&
          Object.values(parsed[0].wheels)[0] &&
          "approved" in Object.values(parsed[0].wheels)[0]))
    ) {
      sessionStorage.removeItem("open-requests");
      return MOCK_REQUESTS;
    }
    return parsed;
  } catch {
    return MOCK_REQUESTS;
  }
}

export function storeRequests(requests: OpenRequest[]) {
  sessionStorage.setItem("open-requests", JSON.stringify(requests));
}

function markAllSeen(requests: OpenRequest[]): OpenRequest[] {
  return requests.map((r) => ({ ...r, hasUpdate: false }));
}

export function hasOpenRequestUpdates(): boolean {
  const requests = getStoredRequests();
  return requests.some((r) => r.hasUpdate);
}

export function OpenRequests() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const requests = getStoredRequests();

  // Mark all as seen when viewing the page
  const seenRequests = markAllSeen(requests);
  storeRequests(seenRequests);

  const filtered = useMemo(() => {
    return seenRequests.filter((request) => {
      if (searchQuery) {
        const q = searchQuery.trim();
        const plateMatch = request.licensePlate.includes(q);
        const idMatch = request.requestNumber.includes(q);
        const reasonMatch = request.rejectionReason?.includes(q) ?? false;
        if (!plateMatch && !idMatch && !reasonMatch) return false;
      }
      if (dateFrom && request.submittedDate < dateFrom) return false;
      if (dateTo && request.submittedDate > dateTo) return false;
      return true;
    });
  }, [seenRequests, searchQuery, dateFrom, dateTo]);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="bg-primary p-4 shadow-md">
        <div className="flex items-center justify-between max-w-6xl mx-auto">
          <button
            onClick={() => navigate("/dashboard")}
            className="text-primary-foreground hover:opacity-80 transition-opacity"
          >
            <ArrowRight className="w-6 h-6" />
          </button>
          <h1 className="text-xl text-primary-foreground font-semibold">{t("openRequests.title")}</h1>
          <div className="w-6" />
        </div>
      </div>

      {/* Filters */}
      <div className="bg-card border-b border-border p-4 shadow-sm">
        <div className="max-w-2xl mx-auto space-y-3">
          <div className="relative">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("openRequests.searchPlaceholder")}
              className="w-full ps-10 pe-4 py-3 bg-input-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
            />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-xs font-semibold text-muted-foreground mb-1 block">{t("openRequests.dateFrom")}</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-full px-3 py-2 bg-input-background border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
              />
            </div>
            <div className="flex-1">
              <label className="text-xs font-semibold text-muted-foreground mb-1 block">{t("openRequests.dateTo")}</label>
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
            <p className="text-center text-muted-foreground py-12">{t("openRequests.empty")}</p>
          ) : (
            filtered.map((request) => {
              const styles = STATUS_STYLES[request.status];
              return (
                <button
                  key={request.id}
                  onClick={() => navigate(`/request/detail/${request.id}`)}
                  className="w-full bg-card rounded-2xl p-5 shadow-md border border-border space-y-3 hover:shadow-lg hover:border-primary/30 transition-all duration-200 text-start"
                >
                  <LicensePlate plateNumber={request.licensePlate} plateType={request.plateType} className="w-full max-w-xs mx-auto" />
                  <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2">
                    <span
                      className={`inline-block px-3 py-1 rounded-full text-sm font-semibold ${styles.bg} ${styles.text} border ${styles.border}`}
                    >
                      {t(STATUS_LABEL_KEYS[request.status])}
                    </span>
                    <span className="text-sm text-muted-foreground tabular-nums">
                      {t("common.requestNumberLine", { requestNumber: request.requestNumber })}
                    </span>
                  </div>
                  {request.status === "declined" && request.rejectionReason && (
                    <div className="w-full rounded-xl border border-destructive/25 bg-destructive/5 px-3 py-3 text-start">
                      <p className="text-xs font-semibold text-muted-foreground mb-1.5">
                        {t("declinedRequest.rejectionReason")}
                      </p>
                      <p className="text-sm text-foreground leading-snug line-clamp-4">{request.rejectionReason}</p>
                    </div>
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
