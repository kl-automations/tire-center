import { useMemo, useState } from "react";
import { useNavigation } from "../NavigationContext";
import { useTranslation } from "react-i18next";
import { ArrowRight, Search } from "lucide-react";
import { MOCK_REJECTION_REASON_EXAMPLE } from "../mockRejectionReason";
import type { VehicleWheelCount } from "../vehicleWheelLayout";
import type { QualityTier } from "../qualityTier";
import { LicensePlate, type PlateType } from "./LicensePlate";

/**
 * Lifecycle status of a service order.
 *
 * - `waiting`        — diagnosis submitted; pending manager approval in the ERP.
 * - `approved`       — all requested work approved by the manager.
 * - `partly-approved`— some wheels/actions approved, others declined.
 * - `declined`       — entire order declined; shown in red, cleaned up nightly.
 *
 * Mirrors `open_orders.status` in the database.
 */
export type RequestStatus = "waiting" | "approved" | "partly-approved" | "declined";

/**
 * Per-wheel approval decision returned by the ERP after the manager reviews
 * a submitted diagnosis.
 *
 * - `full`          — full replacement/repair approved.
 * - `puncture-only` — only puncture repair approved (not full replacement).
 * - `none`          — no work approved for this wheel.
 */
export type WheelApproval = "full" | "puncture-only" | "none";

/**
 * All work recorded for a single wheel position during one service visit.
 *
 * This shape lives inside `OpenRequest.wheels` keyed by position string
 * (e.g. `"front-left"`, `"rear-right-inner"`).
 * It is persisted in `open_orders.diagnosis` JSONB and kept in sync with
 * `WheelData` from TirePopup.tsx (which is the edit-time representation).
 */
export interface WheelWork {
  /** Human-readable summary of the work performed on this wheel. */
  reason: string;
  /** Whether a puncture repair was performed. */
  puncture: boolean;
  /** Whether wheel balancing was performed. */
  balancing: boolean;
  /** Whether a TPMS sensor was replaced. */
  sensor: boolean;
  /** Manager's approval decision for this wheel, filled after ERP webhook fires. */
  approval: WheelApproval;
  /** Reason for tyre replacement. `null` when no replacement was done. */
  replacementReason?: "wear" | "damage" | "fitment" | null;
  /** Whether a TPMS valve was replaced (separate from the sensor itself). */
  tpmsValve?: boolean;
  /** Whether rim repair was performed. */
  rimRepair?: boolean;
  /** Target wheel position when a tyre was relocated. `null` if not relocated. */
  movedToWheel?: string | null;
  /**
   * Carool AI tyre-condition status for this wheel.
   * Populated after the Carool webhook fires with analysis results.
   */
  caroolStatus?: string | null;
  /** Carool session ID linked to this wheel's photo analysis. */
  caroolId?: string | null;
}

/**
 * A single open service order as displayed in the Open Requests screen.
 *
 * This is the primary UI data model. It mirrors `open_orders` DB columns
 * plus denormalised tyre and wheel data that currently comes from mock data
 * but will be sourced from `GET /api/orders` once the frontend is wired.
 *
 * All fields marked "from backend" will be populated from the API response.
 * Fields without that note are derived or set client-side in the interim.
 */
export interface OpenRequest {
  /** UUID matching `open_orders.id` — from backend. */
  id: string;
  /** Business request / case number (digits) — from backend. */
  requestNumber: string;
  /** Vehicle licence plate string — from backend. */
  licensePlate: string;
  /** Plate type (civilian, military, police) — from backend. */
  plateType: PlateType;
  /** Current lifecycle status — from backend, updated via Firestore signals. */
  status: RequestStatus;
  /** Free-text reason shown when `status === "declined"` — from backend. */
  rejectionReason?: string;
  /** ISO date the order was opened (`YYYY-MM-DD`) — from backend. */
  submittedDate: string;
  /** True when the order status changed since the mechanic last viewed it. */
  hasUpdate: boolean;
  /** Front-axle tyre size string (e.g. `"205/55R16"`) — from backend. */
  frontTireSize: string;
  /** Rear-axle tyre size string (e.g. `"225/45R17"`) — from backend. */
  rearTireSize: string;
  /** Front tyre load index + speed rating (e.g. `"91V"`) — from backend. */
  frontTireProfile?: string;
  /** Rear tyre load index + speed rating (e.g. `"94W"`) — from backend. */
  rearTireProfile?: string;
  /** Tyre quality tier selected for this order — from backend. */
  quality?: QualityTier;
  /** Whether front-axle wheel alignment was performed during this visit. */
  frontAlignment: boolean;
  /**
   * Total number of road wheels on this vehicle.
   * Defaults to 4 when omitted; 6 for heavy vehicles — from backend or
   * derived from the licence plate via `getVehicleWheelCountFromPlate`.
   */
  wheelCount?: VehicleWheelCount;
  /**
   * Per-wheel work record keyed by wheel position string.
   * Keys: `"front-left"`, `"front-right"`, `"rear-left"`, `"rear-right"`,
   *       `"rear-left-inner"`, `"rear-right-inner"`, `"spare-tire"`.
   */
  wheels: Record<string, WheelWork>;
}

/**
 * Maps each `RequestStatus` to its i18n translation key (under the `status.*` namespace).
 * Use with `t(STATUS_LABEL_KEYS[status])` to get the localised label.
 */
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

const WHEEL_POS_KEYS: Record<string, string> = {
  "front-right": "wheels.frontRight",
  "front-left": "wheels.frontLeft",
  "rear-right": "wheels.rearRight",
  "rear-left": "wheels.rearLeft",
  "rear-right-inner": "wheels.rearRightInner",
  "rear-left-inner": "wheels.rearLeftInner",
  "spare-tire": "wheels.spareTire",
};

function buildLineItems(
  request: OpenRequest,
  t: (key: string, opts?: Record<string, unknown>) => string
): { text: string; approved: boolean | null }[] {
  const items: { text: string; approved: boolean | null }[] = [];

  if (request.frontAlignment) {
    const isWaiting = request.status === "waiting";
    items.push({
      text: t("common.frontAlignment"),
      approved: isWaiting ? null : request.status === "approved" || request.status === "partly-approved",
    });
  }

  for (const [pos, work] of Object.entries(request.wheels)) {
    const wheelLabel = WHEEL_POS_KEYS[pos] ? t(WHEEL_POS_KEYS[pos]) : pos;

    const actionApproved = (action: string): boolean => {
      if (work.approval === "full") return true;
      if (work.approval === "puncture-only") return action === "puncture";
      return false;
    };

    if (work.replacementReason) {
      const reasonText = t(`tirePopup.replacementReason.${work.replacementReason}`);
      const caroolPart = work.caroolId ? ` | ${[work.caroolStatus, work.caroolId].filter(Boolean).join(" ")}` : "";
      items.push({
        text: `${wheelLabel} | ${t("tirePopup.sectionReplacement")} | ${reasonText}${caroolPart}`,
        approved: actionApproved("replacement"),
      });
    } else if (work.reason) {
      // legacy reason without explicit replacementReason — skip (shown per-action below)
    }

    if (work.puncture) {
      items.push({ text: `${wheelLabel} | ${t("services.puncture")}`, approved: actionApproved("puncture") });
    }
    if (work.sensor) {
      items.push({ text: `${wheelLabel} | ${t("services.sensor")}`, approved: actionApproved("sensor") });
    }
    if (work.tpmsValve) {
      items.push({ text: `${wheelLabel} | ${t("services.tpmsValve")}`, approved: actionApproved("tpmsValve") });
    }
    if (work.balancing) {
      items.push({ text: `${wheelLabel} | ${t("services.balancing")}`, approved: actionApproved("balancing") });
    }
    if (work.rimRepair) {
      items.push({ text: `${wheelLabel} | ${t("services.rimRepair")}`, approved: actionApproved("rimRepair") });
    }
    if (work.movedToWheel) {
      const targetLabel = WHEEL_POS_KEYS[work.movedToWheel] ? t(WHEEL_POS_KEYS[work.movedToWheel]) : work.movedToWheel;
      items.push({ text: `${wheelLabel} | ${t("tirePopup.sectionRelocation")} → ${targetLabel}`, approved: actionApproved("relocation") });
    }
  }

  return items;
}

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

/** Same rules as the status filters on this screen (approved includes partly-approved). */
export function countOpenRequestStatuses(requests: OpenRequest[]): {
  approved: number;
  waiting: number;
  declined: number;
} {
  return {
    approved: requests.filter((r) => r.status === "approved" || r.status === "partly-approved").length,
    waiting: requests.filter((r) => r.status === "waiting").length,
    declined: requests.filter((r) => r.status === "declined").length,
  };
}

export function getOpenRequestStatusCounts() {
  return countOpenRequestStatuses(getStoredRequests());
}

function markAllSeen(requests: OpenRequest[]): OpenRequest[] {
  return requests.map((r) => ({ ...r, hasUpdate: false }));
}

export function hasOpenRequestUpdates(): boolean {
  const requests = getStoredRequests();
  return requests.some((r) => r.hasUpdate);
}

type StatusFilter = "approved" | "waiting" | "declined";

/**
 * List screen showing all open service orders for the authenticated shop.
 *
 * Features: search by plate / request number, filter by status, expandable
 * inline detail rows, and swipe-to-delete (confirmed via long-press/swipe).
 * Status badges update in real time via Firestore `onSnapshot` (not yet wired).
 *
 * Data source: currently `sessionStorage` + `MOCK_REQUESTS` fallback.
 * Replace with `GET /api/orders` once the frontend API client is built
 * (see backend-plan.md Phase 6, task F3/F5).
 *
 * Navigation: reached from `dashboard`; navigates to `{ name: "request-detail" }`
 * on row tap.
 */
export function OpenRequests() {
  const { t } = useTranslation();
  const { navigate } = useNavigation();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Mark all as seen on mount and keep as reactive state so deletions re-render
  const [requests, setRequests] = useState<OpenRequest[]>(() => {
    const r = markAllSeen(getStoredRequests());
    storeRequests(r);
    return r;
  });

  const dismissRequest = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = requests.filter((r) => r.id !== id);
    storeRequests(updated);
    setRequests(updated);
    setExpandedId(null);
  };

  const counts = useMemo(() => countOpenRequestStatuses(requests), [requests]);

  const filtered = useMemo(() => {
    return requests.filter((request) => {
      if (searchQuery) {
        const q = searchQuery.trim();
        const plateMatch = request.licensePlate.includes(q);
        const idMatch = request.requestNumber.includes(q);
        const reasonMatch = request.rejectionReason?.includes(q) ?? false;
        if (!plateMatch && !idMatch && !reasonMatch) return false;
      }
      if (statusFilter === "approved" && request.status !== "approved" && request.status !== "partly-approved") return false;
      if (statusFilter === "waiting" && request.status !== "waiting") return false;
      if (statusFilter === "declined" && request.status !== "declined") return false;
      return true;
    });
  }, [requests, searchQuery, statusFilter]);

  return (
    <div className="h-screen bg-background flex flex-col" style={{ height: "100dvh" }}>
      {/* Header */}
      <div className="bg-primary p-4 shadow-md shrink-0">
        <div className="flex items-center justify-between max-w-6xl mx-auto">
          <button
            onClick={() => navigate({ name: "dashboard" })}
            className="text-primary-foreground hover:opacity-80 transition-opacity"
          >
            <ArrowRight className="w-6 h-6" />
          </button>
          <h1 className="text-xl text-primary-foreground font-semibold">{t("openRequests.title")}</h1>
          <div className="w-6" />
        </div>
      </div>

      {/* Filters */}
      <div className="bg-card border-b border-border p-4 shadow-sm shrink-0">
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
            <button
              onClick={() => setStatusFilter(statusFilter === "approved" ? null : "approved")}
              className={`flex-1 rounded-xl border-2 py-2 px-2 text-center transition-all duration-150 ${
                statusFilter === "approved"
                  ? "bg-green-500 border-green-600 text-white"
                  : "bg-green-100 dark:bg-green-900/40 border-green-300 dark:border-green-700 text-green-800 dark:text-green-300"
              }`}
            >
              <div className="text-2xl font-bold tabular-nums leading-none">{counts.approved}</div>
              <div className="text-[11px] font-semibold mt-0.5 leading-tight">{t("status.approved")}</div>
            </button>
            <button
              onClick={() => setStatusFilter(statusFilter === "waiting" ? null : "waiting")}
              className={`flex-1 rounded-xl border-2 py-2 px-2 text-center transition-all duration-150 ${
                statusFilter === "waiting"
                  ? "bg-amber-500 border-amber-600 text-white"
                  : "bg-amber-100 dark:bg-amber-900/40 border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-300"
              }`}
            >
              <div className="text-2xl font-bold tabular-nums leading-none">{counts.waiting}</div>
              <div className="text-[11px] font-semibold mt-0.5 leading-tight">{t("status.waiting")}</div>
            </button>
            <button
              onClick={() => setStatusFilter(statusFilter === "declined" ? null : "declined")}
              className={`flex-1 rounded-xl border-2 py-2 px-2 text-center transition-all duration-150 ${
                statusFilter === "declined"
                  ? "bg-red-500 border-red-600 text-white"
                  : "bg-red-100 dark:bg-red-900/40 border-red-300 dark:border-red-700 text-red-800 dark:text-red-300"
              }`}
            >
              <div className="text-2xl font-bold tabular-nums leading-none">{counts.declined}</div>
              <div className="text-[11px] font-semibold mt-0.5 leading-tight">{t("status.declined")}</div>
            </button>
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
              const isExpanded = expandedId === request.id;
              const lineItems = isExpanded ? buildLineItems(request, t) : [];
              return (
                <div
                  key={request.id}
                  onClick={() => setExpandedId(isExpanded ? null : request.id)}
                  className="w-full bg-card rounded-2xl p-5 shadow-md border border-border space-y-3 cursor-pointer hover:shadow-lg hover:border-primary/30 transition-all duration-200 text-start select-none"
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
                  {isExpanded && (
                    <div className="pt-3 border-t border-border space-y-2" onClick={(e) => e.stopPropagation()}>
                      {lineItems.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-1">—</p>
                      ) : (
                        lineItems.map((item, i) => (
                          <div key={i} className="flex items-center justify-between gap-3">
                            <span
                              className={`text-sm leading-snug ${
                                item.approved === true
                                  ? "text-green-700 dark:text-green-400"
                                  : item.approved === false
                                    ? "text-red-700 dark:text-red-400"
                                    : "text-muted-foreground"
                              }`}
                            >
                              {item.text}
                            </span>
                            {item.approved !== null && (
                              <span
                                className={`text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0 border ${
                                  item.approved
                                    ? "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400 border-green-300 dark:border-green-700"
                                    : "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400 border-red-300 dark:border-red-700"
                                }`}
                              >
                                {item.approved ? t("approval.full") : t("approval.none")}
                              </span>
                            )}
                          </div>
                        ))
                      )}
                      {/* Action button */}
                      {(request.status === "approved" || request.status === "partly-approved") && (
                        <button
                          onClick={(e) => dismissRequest(request.id, e)}
                          className="w-full mt-3 bg-green-600 hover:bg-green-700 active:bg-green-800 text-white font-semibold py-3 rounded-xl transition-colors duration-150 shadow-sm"
                        >
                          {t("openRequests.dismissApproved")}
                        </button>
                      )}
                      {request.status === "declined" && (
                        <button
                          onClick={(e) => dismissRequest(request.id, e)}
                          className="w-full mt-3 bg-red-600 hover:bg-red-700 active:bg-red-800 text-white font-semibold py-3 rounded-xl transition-colors duration-150 shadow-sm"
                        >
                          {t("openRequests.dismissDeclined")}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
