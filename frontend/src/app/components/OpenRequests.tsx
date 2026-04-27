import { useEffect, useMemo, useState } from "react";
import { useNavigation } from "../NavigationContext";
import { useTranslation } from "react-i18next";
import { ArrowRight, Loader2, Search } from "lucide-react";
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
export type RequestStatus = "open" | "waiting" | "approved" | "partly-approved" | "declined";

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
  open: "status.open",
  waiting: "status.waiting",
  approved: "status.approved",
  "partly-approved": "status.partlyApproved",
  declined: "status.declined",
};

export const STATUS_STYLES: Record<RequestStatus, { bg: string; text: string; border: string }> = {
  open: {
    bg: "bg-gray-100 dark:bg-gray-800/40",
    text: "text-gray-700 dark:text-gray-300",
    border: "border-gray-300 dark:border-gray-600",
  },
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

/**
 * SessionStorage key for the list of order IDs the mechanic has dismissed
 * locally (approved/declined orders they've acknowledged). The backend still
 * returns these orders until they're cleaned up server-side, so we filter
 * them out client-side after each fetch.
 */
const DISMISSED_KEY = "dismissed-order-ids";

/**
 * Read the JSON array of dismissed order IDs from `sessionStorage`. Returns
 * an empty array on missing key or parse error.
 */
export function getDismissedOrderIds(): string[] {
  try {
    const raw = sessionStorage.getItem(DISMISSED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Append `id` to the dismissed-order-ids list (deduplicated) and persist to
 * `sessionStorage`. Used when the mechanic confirms an approved/declined
 * order so it disappears from the list until the next session.
 */
export function addDismissedOrderId(id: string): void {
  const ids = getDismissedOrderIds();
  if (!ids.includes(id)) {
    ids.push(id);
    sessionStorage.setItem(DISMISSED_KEY, JSON.stringify(ids));
  }
}

/**
 * SessionStorage key for the snapshot of (orderId → status) the mechanic has
 * already viewed on the Open Requests screen. Lifted out of an in-memory ref
 * so the Dashboard summary hook agrees with the list screen on what counts as
 * an "update".
 */
const SEEN_STATUSES_KEY = "seen-order-statuses";

/** Read the persisted (orderId → status) seen-snapshot. Empty on missing/bad JSON. */
function getSeenStatuses(): Record<string, RequestStatus> {
  try {
    const raw = sessionStorage.getItem(SEEN_STATUSES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, RequestStatus>;
  } catch {
    return {};
  }
}

/** Persist the seen-snapshot. Only called from the Open Requests screen, which
 *  is where the mechanic actually views the order list. */
function setSeenStatuses(map: Record<string, RequestStatus>): void {
  sessionStorage.setItem(SEEN_STATUSES_KEY, JSON.stringify(map));
}

/** Single action entry as stored in `open_orders.diagnosis.tires[position]`. */
type RawAction = {
  action?: string;
  reason?: string;
  transfer_target?: string | null;
};

/** Shape of a single row from `GET /api/orders` / `GET /api/orders/{id}`. */
type RawOrderRow = {
  id?: string;
  request_id?: string | number;
  license_plate?: string;
  plate_type?: string;
  status?: string;
  created_at?: string;
  car_data?: {
    FrontTireSize?: string;
    RearTireSize?: string;
  } | null;
  diagnosis?: {
    front_alignment?: boolean;
    tires?: Record<string, RawAction[]> | null;
    erp_response?: {
      wheels?: Record<string, WheelApproval>;
    } | null;
  } | null;
};

/**
 * Map the raw `GET /api/orders` response (or a single-row response wrapped in
 * an array) into the `OpenRequest[]` shape used by the UI.
 *
 * `hasUpdate` is initialised to `false`; the caller is responsible for
 * comparing statuses against a previously-seen snapshot and flipping it on.
 */
export function mapOrdersResponse(raw: unknown[]): OpenRequest[] {
  const rows = Array.isArray(raw) ? raw : [];
  return rows.map((item) => {
    const row = (item ?? {}) as RawOrderRow;
    const tires = row.diagnosis?.tires ?? {};
    const erpWheels = row.diagnosis?.erp_response?.wheels ?? {};

    const wheels: Record<string, WheelWork> = {};
    for (const [position, actions] of Object.entries(tires)) {
      const list: RawAction[] = Array.isArray(actions) ? actions : [];
      const replacement = list.find((a) => a?.action === "replacement");
      const relocation = list.find((a) => a?.action === "relocation");
      const replacementReason =
        (replacement?.reason as "wear" | "damage" | "fitment" | undefined) ?? null;

      wheels[position] = {
        reason: replacementReason ?? "",
        puncture: list.some((a) => a?.action === "puncture"),
        balancing: list.some((a) => a?.action === "balancing"),
        sensor: list.some((a) => a?.action === "sensor"),
        tpmsValve: list.some((a) => a?.action === "tpms_valve"),
        rimRepair: list.some((a) => a?.action === "rim_repair"),
        replacementReason,
        movedToWheel: relocation?.transfer_target ?? null,
        approval: (erpWheels[position] ?? "none") as WheelApproval,
      };
    }

    return {
      id: String(row.id ?? ""),
      requestNumber: String(row.request_id ?? row.id ?? ""),
      licensePlate: row.license_plate ?? "",
      plateType: ((row.plate_type as PlateType | undefined) ?? "civilian") as PlateType,
      status: ((row.status as RequestStatus | undefined) ?? "waiting") as RequestStatus,
      submittedDate: row.created_at?.slice(0, 10) ?? "",
      hasUpdate: false,
      frontTireSize: row.car_data?.FrontTireSize ?? "",
      rearTireSize: row.car_data?.RearTireSize ?? "",
      frontAlignment: row.diagnosis?.front_alignment ?? false,
      wheels,
    };
  });
}

/**
 * @deprecated Order data is now fetched live from `GET /api/orders`. This
 * stub exists only so legacy imports keep compiling; it always returns `[]`.
 */
export function getStoredRequests(): OpenRequest[] {
  return [];
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

/**
 * @deprecated Synchronous helper kept only for backwards compatibility — it
 * cannot reach the live API. Use {@link useOrdersSummary} instead, which
 * polls `GET /api/orders` and returns counts reactively.
 */
export function getOpenRequestStatusCounts() {
  return countOpenRequestStatuses(getStoredRequests());
}

/**
 * @deprecated Synchronous helper kept only for backwards compatibility — it
 * cannot reach the live API. Use {@link useOrdersSummary} instead, which
 * exposes `hasUnread` reactively.
 */
export function hasOpenRequestUpdates(): boolean {
  const requests = getStoredRequests();
  return requests.some((r) => r.hasUpdate);
}

interface UseOrdersSummaryResult {
  /** Status counts (approved + partly-approved grouped under `approved`). */
  counts: { approved: number; waiting: number; declined: number };
  /** True when at least one order has a non-waiting status the mechanic
   *  hasn't yet viewed on the Open Requests screen. */
  hasUnread: boolean;
  /** True until the first fetch completes. */
  isLoading: boolean;
}

/**
 * Polls `GET /api/orders` every 30 seconds and exposes a lightweight summary
 * suitable for the dashboard badge + counts. The seen-statuses snapshot is
 * read from `sessionStorage` but never written here — only the Open Requests
 * screen marks orders as seen, so badges persist on the Dashboard until the
 * mechanic actually opens the list.
 */
export function useOrdersSummary(): UseOrdersSummaryResult {
  const [orders, setOrders] = useState<OpenRequest[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const token = localStorage.getItem("token");
        const res = await fetch("/api/orders", {
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });
        if (!res.ok) return;
        const data = await res.json();
        const mapped = mapOrdersResponse(data?.orders ?? []);
        const dismissed = new Set(getDismissedOrderIds());
        const visible = mapped.filter((r) => !dismissed.has(r.id));
        if (!cancelled) {
          setOrders(visible);
          setIsLoading(false);
        }
      } catch {
        if (!cancelled) setIsLoading(false);
      }
    };

    void load();
    const interval = setInterval(() => void load(), 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return useMemo(() => {
    const seen = getSeenStatuses();
    const hasUnread = orders.some(
      (r) => r.status !== "waiting" && seen[r.id] !== r.status
    );
    return {
      counts: countOpenRequestStatuses(orders),
      hasUnread,
      isLoading,
    };
  }, [orders, isLoading]);
}

type StatusFilter = "approved" | "waiting" | "declined";

/**
 * List screen showing all open service orders for the authenticated shop.
 *
 * Features: search by plate / request number, filter by status, expandable
 * inline detail rows, and swipe-to-delete (confirmed via long-press/swipe).
 * Status badges update in real time via Firestore `onSnapshot` (not yet wired).
 *
 * Data source: `GET /api/orders` (Bearer JWT from `localStorage`), polled
 * every 30 seconds. Locally-dismissed orders are filtered out via the
 * `dismissed-order-ids` `sessionStorage` key.
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

  const [requests, setRequests] = useState<OpenRequest[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const token = localStorage.getItem("token");
        const res = await fetch("/api/orders", {
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });
        if (!res.ok) return;
        const data = await res.json();
        const mapped = mapOrdersResponse(data?.orders ?? []);

        const dismissed = new Set(getDismissedOrderIds());
        const visible = mapped.filter((r) => !dismissed.has(r.id));

        // Compare each order's status to the persisted seen-snapshot; flip
        // `hasUpdate` on for any non-waiting status the mechanic hasn't seen.
        // Then refresh the snapshot — this screen is where orders get
        // "viewed", so the Dashboard badge clears once the user lands here.
        const seen = getSeenStatuses();
        const withUpdates = visible.map((r) => ({
          ...r,
          hasUpdate: r.status !== "waiting" && seen[r.id] !== r.status,
        }));

        const nextSeen: Record<string, RequestStatus> = {};
        for (const r of withUpdates) nextSeen[r.id] = r.status;
        setSeenStatuses(nextSeen);

        if (!cancelled) {
          setRequests(withUpdates);
          setIsLoading(false);
        }
      } catch {
        if (!cancelled) setIsLoading(false);
      }
    };

    void load();
    const interval = setInterval(() => void load(), 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const dismissRequest = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    addDismissedOrderId(id);
    setRequests((prev) => prev.filter((r) => r.id !== id));
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
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-8 h-8 text-muted-foreground animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
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
