import { useEffect, useMemo, useState } from "react";
import { useNavigation } from "../NavigationContext";
import { useTranslation } from "react-i18next";
import { ArrowRight, Loader2, Search } from "lucide-react";
import type { VehicleWheelCount } from "../vehicleWheelLayout";
import type { QualityTier } from "../qualityTier";
import { LicensePlate, type PlateType } from "./LicensePlate";
import type { ActionCodeItem, ReasonCodeItem } from "./TirePopup";

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
 * One action persisted under `open_orders.diagnosis.tires[position]`,
 * preserved verbatim as the numeric ERP codes the backend resolved at
 * submission time. The frontend never hard-codes these values — both
 * `code` and `reason` are looked up against the live `/api/codes`
 * response (`erp_action_codes` / `erp_reason_codes`).
 */
export interface WheelAction {
  /** ERP action code (PK in `erp_action_codes`). */
  code: number;
  /** ERP reason code (PK in `erp_reason_codes`), present for replacement-style actions. */
  reason?: number;
  /** Wheel position the tyre was relocated to, present only when this is a relocation. */
  transferTarget?: string | null;
}

/**
 * All work recorded for a single wheel position during one service visit.
 *
 * This shape lives inside `OpenRequest.wheels` keyed by position string
 * (e.g. `"front-left"`, `"rear-right-inner"`). It is persisted in
 * `open_orders.diagnosis` JSONB and kept in sync with `WheelData` from
 * TirePopup.tsx (which is the edit-time representation).
 *
 * The raw per-action records are kept on `actions`; rendering code looks
 * up labels against the live `/api/codes` response so we never bake any
 * specific ERP code into the UI.
 */
export interface WheelWork {
  /** All actions performed on this wheel, preserved as raw ERP records. */
  actions: WheelAction[];
  /** Manager's approval decision for this wheel, filled after ERP webhook fires. */
  approval: WheelApproval;
  /**
   * Replacement-reason label resolved from the numeric reason code via
   * `/api/codes`. `null` when no replacement-style action was performed
   * or when the reason couldn't be resolved (unknown code / no codes loaded).
   */
  replacementReason?: string | null;
  /** Target wheel position when a tyre was relocated. `null` if not relocated. */
  movedToWheel?: string | null;
  /**
   * Carool AI tyre-condition status for this wheel.
   * Populated after the Carool webhook fires with analysis results.
   */
  caroolStatus?: string | null;
  /** Carool session ID linked to this wheel's photo analysis. */
  caroolId?: string | null;
  /**
   * Per-action approval flags returned by the ERP webhook, keyed by ERP
   * ActionCode as a string (e.g. `"3"`, `"4"`, `"23"`). `true` = approved,
   * `false` = declined, missing key = ERP did not return a decision for
   * that action. Sourced from `erp_response.action_approvals[position]`.
   */
  actionApprovals?: Record<string, boolean>;
}

/**
 * Pick the right localized label out of an `erp_action_codes` /
 * `erp_reason_codes` row. Mirrors the helper of the same name in
 * `TirePopup.tsx` so the read-side and the edit-side render identical
 * text. Falls back to Hebrew when the requested language is missing.
 */
type LabeledRow = { label_he?: string | null; label_ar?: string | null; label_ru?: string | null };
function labelFor(item: LabeledRow | undefined, language: string): string {
  if (!item) return "";
  const lang = language?.split("-")[0] ?? "he";
  if (lang === "ar" && item.label_ar && item.label_ar.trim().length > 0) return item.label_ar;
  if (lang === "ru" && item.label_ru && item.label_ru.trim().length > 0) return item.label_ru;
  return item.label_he || "";
}

export interface OrderCodes {
  actions: ActionCodeItem[];
  reasons: ReasonCodeItem[];
}

/**
 * Fetch the live `/api/codes` table (action + reason codes) once per
 * mount. Public endpoint, no auth header. Returns empty arrays until
 * the request completes; consumers that depend on labels should treat
 * an empty `actions` array as "not loaded yet" rather than "no codes".
 */
export function useCodes(): OrderCodes {
  const [codes, setCodes] = useState<OrderCodes>({ actions: [], reasons: [] });
  useEffect(() => {
    let cancelled = false;
    fetch("/api/codes")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setCodes({
          actions: Array.isArray(data.actions) ? data.actions : [],
          reasons: Array.isArray(data.reasons) ? data.reasons : [],
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return codes;
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
  t: (key: string, opts?: Record<string, unknown>) => string,
  actions: ActionCodeItem[],
  reasons: ReasonCodeItem[],
  language: string,
): { text: string; approved: boolean | null }[] {
  const items: { text: string; approved: boolean | null }[] = [];

  if (request.frontAlignment) {
    const isWaiting = request.status === "waiting";
    items.push({
      text: t("common.frontAlignment"),
      approved: isWaiting ? null : request.status === "approved" || request.status === "partly-approved",
    });
  }

  // Build the lookup tables from the live `/api/codes` response. Empty
  // arrays just mean codes haven't loaded yet — every lookup will miss
  // and the loop below skips actions whose label can't be resolved.
  const actionByCode = new Map<number, ActionCodeItem>(actions.map((a) => [a.code, a]));
  const reasonByCode = new Map<number, ReasonCodeItem>(reasons.map((r) => [r.code, r]));
  const replacementActionCodes = new Set(reasons.map((r) => r.linked_action_code));

  for (const [pos, work] of Object.entries(request.wheels)) {
    const wheelLabel = WHEEL_POS_KEYS[pos] ? t(WHEEL_POS_KEYS[pos]) : pos;

    // Look up the per-action decision the ERP returned for this wheel.
    // While the order is still `waiting`, we deliberately skip the lookup
    // and surface `null` so the UI shows the muted "no decision yet" style
    // instead of a stale or guessed approval flag.
    const actionApproved = (actionCode: number): boolean | null => {
      if (request.status === "waiting") return null;
      const val = work.actionApprovals?.[String(actionCode)];
      return typeof val === "boolean" ? val : null;
    };

    for (const action of work.actions) {
      const approved = actionApproved(action.code);
      const actionLabel = labelFor(actionByCode.get(action.code), language);

      // Relocation lines carry a `transferTarget` and render with the
      // arrow-to-target suffix. Fall back to the i18n relocation header
      // when the action label hasn't loaded yet so the row never shows
      // a blank prefix.
      if (action.transferTarget) {
        const targetLabel = WHEEL_POS_KEYS[action.transferTarget]
          ? t(WHEEL_POS_KEYS[action.transferTarget])
          : action.transferTarget;
        const prefix = actionLabel || t("tirePopup.sectionRelocation");
        items.push({
          text: `${wheelLabel} | ${prefix} → ${targetLabel}`,
          approved,
        });
        continue;
      }

      // Replacement-style action: append the resolved reason label, plus
      // the optional Carool status/id suffix carried over from before.
      if (replacementActionCodes.has(action.code)) {
        const reasonLabel =
          typeof action.reason === "number"
            ? labelFor(reasonByCode.get(action.reason), language)
            : "";
        const caroolPart = work.caroolId
          ? ` | ${[work.caroolStatus, work.caroolId].filter(Boolean).join(" ")}`
          : "";
        if (!actionLabel && !reasonLabel) continue;
        const text = reasonLabel
          ? `${wheelLabel} | ${actionLabel} | ${reasonLabel}${caroolPart}`
          : `${wheelLabel} | ${actionLabel}${caroolPart}`;
        items.push({ text, approved });
        continue;
      }

      // Plain action — the DB label is the line's body. Skip silently
      // if codes haven't loaded yet (re-render with codes will fill it).
      if (!actionLabel) continue;
      items.push({ text: `${wheelLabel} | ${actionLabel}`, approved });
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

/**
 * Single action entry as stored in `open_orders.diagnosis.tires[position]`.
 *
 * `action` and `reason` are numeric ERP codes — the backend resolves the
 * original string labels submitted by the frontend to integer codes from
 * `erp_action_codes` / `erp_reason_codes` before persisting (see
 * `_normalize_tires_actions` in `backend/routers/diagnosis.py`).
 */
type RawAction = {
  action?: number;
  reason?: number;
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
      action_approvals?: Record<string, Record<string, boolean>>;
    } | null;
  } | null;
};

/**
 * Map the raw `GET /api/orders` response (or a single-row response wrapped in
 * an array) into the `OpenRequest[]` shape used by the UI.
 *
 * `actions` and `reasons` are the live `/api/codes` rows — passed in so the
 * function can stay outside React. The function uses them to:
 *   1. Identify which action codes are "replacement-style" (any code with at
 *      least one linked reason in `erp_reason_codes`).
 *   2. Resolve the persisted reason code into a human-readable label
 *      (`replacementReason`) in the requested `language`.
 *
 * No ERP code is hard-coded here — every code/label decision is driven by
 * the DB tables. When `actions`/`reasons` are still loading (empty arrays),
 * each `WheelWork` is built with `replacementReason: null` and the raw codes
 * preserved on `actions[]`, so a re-render after `/api/codes` resolves can
 * fill in the labels correctly.
 *
 * `hasUpdate` is initialised to `false`; the caller is responsible for
 * comparing statuses against a previously-seen snapshot and flipping it on.
 */
export function mapOrdersResponse(
  raw: unknown[],
  reasons: ReasonCodeItem[],
  language: string,
): OpenRequest[] {
  // An action is "replacement-style" iff at least one reason is linked to
  // it in erp_reason_codes. Mirrors TirePopup's `actionCodeToReasons` /
  // `reasonedActions` logic so edit and read sides agree on which actions
  // require a reason.
  const replacementActionCodes = new Set(reasons.map((r) => r.linked_action_code));
  const reasonByCode = new Map<number, ReasonCodeItem>(reasons.map((r) => [r.code, r]));

  const rows = Array.isArray(raw) ? raw : [];
  return rows.map((item) => {
    const row = (item ?? {}) as RawOrderRow;
    const tires = row.diagnosis?.tires ?? {};
    const erpWheels = row.diagnosis?.erp_response?.wheels ?? {};
    const erpActionApprovals = row.diagnosis?.erp_response?.action_approvals ?? {};

    const wheels: Record<string, WheelWork> = {};
    for (const [position, rawActions] of Object.entries(tires)) {
      const list: RawAction[] = Array.isArray(rawActions) ? rawActions : [];
      const wheelActions: WheelAction[] = list
        .filter((a): a is RawAction & { action: number } => !!a && typeof a.action === "number")
        .map((a) => ({
          code: a.action,
          reason: typeof a.reason === "number" ? a.reason : undefined,
          transferTarget: a.transfer_target ?? null,
        }));

      // Pick the first replacement-style action and resolve its reason code
      // to a localized label. Multiple replacements per wheel are unusual
      // but harmless — the rendered list still shows every action.
      const replacement = wheelActions.find(
        (a) => replacementActionCodes.has(a.code) && typeof a.reason === "number",
      );
      const replacementReason =
        replacement && typeof replacement.reason === "number"
          ? labelFor(reasonByCode.get(replacement.reason), language) || null
          : null;

      // Relocation is identified by `transfer_target` presence, not by action
      // code — `transfer_target` is set authoritatively at submission time by
      // AcceptedRequest and is unambiguous regardless of what code the DB holds.
      const relocation = wheelActions.find((a) => !!a.transferTarget);

      wheels[position] = {
        actions: wheelActions,
        approval: (erpWheels[position] ?? "none") as WheelApproval,
        replacementReason,
        movedToWheel: relocation?.transferTarget ?? null,
        actionApprovals: erpActionApprovals[position],
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
  const { i18n } = useTranslation();
  const codes = useCodes();
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
        const mapped = mapOrdersResponse(
          data?.orders ?? [],
          codes.reasons,
          i18n.language,
        );
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
  }, [codes, i18n.language]);

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
  const { t, i18n } = useTranslation();
  const codes = useCodes();
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
        const mapped = mapOrdersResponse(
          data?.orders ?? [],
          codes.reasons,
          i18n.language,
        );

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
  }, [codes, i18n.language]);

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
              const lineItems = isExpanded
                ? buildLineItems(request, t, codes.actions, codes.reasons, i18n.language)
                : [];
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
