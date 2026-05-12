import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowRight, Loader2 } from "lucide-react";
import { AxlesDiagram } from "./AxlesDiagram";
import { LicensePlate, type PlateType } from "./LicensePlate";
import { TirePopup, REPLACEMENT_ACTION_CODES, type ActionCodeItem, type ReasonCodeItem, type WheelData } from "./TirePopup";
import { resolveVehicleWheelCount } from "../vehicleWheelLayout";
import { useScreenCache } from "../useScreenCache";
import { usePhoneBackSync } from "../usePhoneBackSync";
import { ConfirmModal } from "./ConfirmModal";
import { useToast } from "./Toast";

/** Wire-shape of one entry in `DiagnosisRequest.tires[wheel]`. */
type DiagnosisTireAction = {
  action: number;
  reason?: number;
  transfer_target?: string;
};

interface OrderCache {
  plate: string;
  plateType: PlateType;
  mileage?: string;
  request_id?: string;
  carModel?: string;
  lastMileage?: number | null;
  tireSizes?: { front: string; rear: string };
  ownershipId?: string;
  tireLevel?: string | null;
  wheelCount?: number | null;
  caroolNeeded?: number | null;
  existingLines?: Array<{ wheel: string; action: number; reason: number }>;
  frontAlignment: boolean;
  /** Tracks the order_id alongside the cache entry so we can pass it through. */
  order_id: string;
}

function getStoredAffectedWheels(orderId: string): Record<string, WheelData> {
  try {
    const raw = sessionStorage.getItem(`affected-wheels-${orderId}`);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function storeAffectedWheel(orderId: string, wheel: string, data: WheelData) {
  const current = getStoredAffectedWheels(orderId);
  current[wheel] = data;
  sessionStorage.setItem(`affected-wheels-${orderId}`, JSON.stringify(current));
}

/**
 * Map a single `existing_lines` array (from ERP) into the `WheelData` shape
 * the popup uses. Replicated outside the component so it can run during the
 * initial state factory rather than waiting for an effect.
 */
function existingLinesToAffectedWheels(
  lines: Array<{ wheel: string; action: number; reason: number }>,
): Record<string, WheelData> {
  const restored: Record<string, WheelData> = {};
  for (const line of lines) {
    if (!restored[line.wheel]) {
      restored[line.wheel] = {
        selectedActionCodes: [],
        selectedReasonCodes: [],
        reasonActionMap: {},
        movedToWheel: null,
        mode: "repair",
        reason: "",
      };
    }
    const data = restored[line.wheel];
    if (line.reason > 0) {
      data.selectedReasonCodes.push(line.reason);
      data.selectedActionCodes.push(line.action);
      data.reasonActionMap[line.reason] = line.action;
      data.mode = "replacement";
    } else {
      data.selectedActionCodes.push(line.action);
    }
  }
  return restored;
}

/**
 * Normalise the response from `GET /api/order/:order_id` into the same
 * `OrderCache` shape that `LicensePlateModal` writes on a fresh lookup.
 *
 * The backend reuses the row-fetch shape from `POST /api/car`, so we read
 * the same field names but flatten them out here.
 */
function buildCacheFromOrderResponse(
  data: {
    order_id?: string;
    license_plate?: string;
    plate_type?: string;
    mileage?: number | null;
    request_id?: string;
    car_model?: string;
    last_mileage?: number | null;
    tire_sizes?: { front?: string; rear?: string };
    ownership_id?: string;
    tire_level?: string | null;
    wheel_count?: number | null;
    carool_needed?: number | null;
    existing_lines?: Array<{ wheel: string; action: number; reason: number }>;
    front_alignment?: boolean;
  },
  fallbackOrderId: string,
): OrderCache {
  return {
    plate: data.license_plate ?? "",
    plateType: ((data.plate_type as PlateType) ?? "civilian") as PlateType,
    mileage: typeof data.mileage === "number" ? String(data.mileage) : "",
    order_id: data.order_id ?? fallbackOrderId,
    request_id: data.request_id,
    carModel: data.car_model,
    lastMileage: typeof data.last_mileage === "number" ? data.last_mileage : null,
    tireSizes: {
      front: data.tire_sizes?.front ?? "",
      rear: data.tire_sizes?.rear ?? "",
    },
    ownershipId: data.ownership_id,
    tireLevel: data.tire_level ?? null,
    wheelCount: typeof data.wheel_count === "number" ? data.wheel_count : null,
    caroolNeeded: typeof data.carool_needed === "number" ? data.carool_needed : null,
    existingLines: Array.isArray(data.existing_lines) ? data.existing_lines : [],
    frontAlignment: data.front_alignment === true,
  };
}

/**
 * Primary service-order screen shown after the ERP accepts a licence-plate lookup.
 *
 * Displays the axle diagram for the vehicle. The mechanic taps each wheel to open
 * `TirePopup` and record the work performed (replacement, repair, relocation, etc.).
 * Optionally launches the Carool AI photo flow via `CaroolCheck`.
 * On completion, submits the diagnosis via `POST /api/diagnosis` (or the staged
 * `/api/diagnosis/draft` + `/api/carool/finalize` pair when Carool is active —
 * the ERP submission then happens server-side from the Carool webhook) and
 * navigates back to `/dashboard`.
 *
 * Per-wheel data is persisted in `sessionStorage` (key `affected-wheels-{orderId}`)
 * and ERP-supplied props in `route-order-{orderId}` so a full page reload
 * restores the screen exactly where the mechanic left off.
 */
export function AcceptedRequest() {
  const { t } = useTranslation();
  const { showToast, toast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const params = useParams<{ orderId: string }>();
  const orderId = params.orderId ?? "";
  const [cache, setCache] = useScreenCache<OrderCache>(`route-order-${orderId}`);

  const [refetching, setRefetching] = useState<boolean>(!cache);
  const [refetchFailed, setRefetchFailed] = useState(false);

  // Refetch the cache from the backend on a fresh reload that lost the
  // sessionStorage entry. The ERP cannot transition state during the
  // open→waiting window (that transition is itself triggered by us), so a
  // pure cache replay is enough.
  useEffect(() => {
    if (cache || !orderId) return;
    let cancelled = false;
    (async () => {
      try {
        const token = localStorage.getItem("token");
        const res = await fetch(`/api/order/${encodeURIComponent(orderId)}`, {
          headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        });
        if (cancelled) return;
        if (res.status === 410) {
          // Order has moved past the editable lifecycle — go look
          // at it on the appropriate result screen.
          navigate("/open-requests", { replace: true });
          return;
        }
        if (!res.ok) {
          setRefetchFailed(true);
          return;
        }
        const data = await res.json();
        const built = buildCacheFromOrderResponse(data, orderId);
        setCache(built);
      } catch {
        if (!cancelled) setRefetchFailed(true);
      } finally {
        if (!cancelled) setRefetching(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orderId, cache, navigate, setCache]);

  // Codes are pure server data — refetch every mount, keeping them out of
  // the screen cache (per spec).
  const [actionCodes, setActionCodes] = useState<ActionCodeItem[]>([]);
  const [reasonCodes, setReasonCodes] = useState<ReasonCodeItem[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/codes")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setActionCodes(Array.isArray(data.actions) ? data.actions : []);
        setReasonCodes(Array.isArray(data.reasons) ? data.reasons : []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Default to `true` so the Carool entry points don't flash off and back on
  // before the runtime-config response arrives. The backend gate is the
  // source of truth — the worst case from this default is a single failed
  // request that the gated handlers respond to with `{ skipped: true }`.
  const [caroolEnabled, setCaroolEnabled] = useState(true);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/config")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data && typeof data.carool_enabled === "boolean") {
          setCaroolEnabled(data.carool_enabled);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Camera permission warm-up: once per browser tab session — avoids
  // re-prompts on react-router remounts (independent of Carool API flag).
  useEffect(() => {
    if (!cache) return;
    try {
      if (sessionStorage.getItem("camPrimed")) return;
    } catch {
      return;
    }
    navigator.mediaDevices?.getUserMedia({ video: true })
      .then((s) => {
        try {
          sessionStorage.setItem("camPrimed", "1");
        } catch {}
        s.getTracks().forEach((t) => t.stop());
      })
      .catch(() => {});
  }, [cache]);

  const [selectedWheel, setSelectedWheel] = useState<string | null>(null);
  const [popupWheel, setPopupWheel] = useState<string | null>(null);
  const [popupDirty, setPopupDirty] = useState(false);
  const [popupDiscardConfirm, setPopupDiscardConfirm] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  const licensePlate = cache?.plate ?? "";

  const [affectedWheels, setAffectedWheels] = useState<Record<string, WheelData>>(
    () => (orderId ? getStoredAffectedWheels(orderId) : {}),
  );
  // Merge ERP/DB existing lines with sessionStorage: stored wins per wheel so
  // partial stale session data cannot hide server pre-fills or desync the photo gate.
  useEffect(() => {
    if (!orderId || !cache) return;
    const stored = getStoredAffectedWheels(orderId);
    const lines = cache.existingLines ?? [];
    if (lines.length === 0 && Object.keys(stored).length === 0) return;
    const fromErp = existingLinesToAffectedWheels(lines);
    const merged = { ...fromErp, ...stored };
    setAffectedWheels(merged);
    setSpareTire("spare-tire" in merged);
    sessionStorage.setItem(`affected-wheels-${orderId}`, JSON.stringify(merged));
  }, [cache, orderId]);

  const [spareTire, setSpareTire] = useState<boolean>(() =>
    orderId ? "spare-tire" in getStoredAffectedWheels(orderId) : false,
  );
  useEffect(() => {
    if (!orderId) return;
    setSpareTire("spare-tire" in getStoredAffectedWheels(orderId));
  }, [orderId]);

  const wheelCount = resolveVehicleWheelCount(
    licensePlate,
    cache?.wheelCount === 4 || cache?.wheelCount === 6 ? cache.wheelCount : undefined,
  );

  const frontAlignment = cache?.frontAlignment ?? false;

  // Dirty = mechanic has touched at least one wheel. Drives the discard
  // confirmation modal both for the in-UI ← arrow and the system back.
  const isDirty = Object.keys(affectedWheels).length > 0;

  const closePopup = () => {
    setPopupWheel(null);
    setPopupDirty(false);
    setPopupDiscardConfirm(false);
  };

  // Single shared back-press handler for everything on this route. Order
  // of precedence: popup modal > popup itself > order modal > order dirty
  // > default navigate(-1).
  usePhoneBackSync({
    fallback: "/dashboard",
    onBack: () => {
      if (popupDiscardConfirm) {
        setPopupDiscardConfirm(false);
        return true;
      }
      if (popupWheel) {
        if (popupDirty) {
          setPopupDiscardConfirm(true);
        } else {
          closePopup();
        }
        return true;
      }
      if (showDiscardConfirm) {
        setShowDiscardConfirm(false);
        return true;
      }
      if (isDirty) {
        setShowDiscardConfirm(true);
        return true;
      }
      return false;
    },
  });

  const setFrontAlignment = (value: boolean) => {
    if (!cache) return;
    setCache({ ...cache, frontAlignment: value });
  };

  const handleWheelClick = (wheelPosition: string) => {
    setSelectedWheel(wheelPosition);
    setPopupWheel(wheelPosition);
  };

  const handlePopupSubmit = (wheel: string, data: WheelData) => {
    storeAffectedWheel(orderId, wheel, data);
    if (
      !data.selectedActionCodes.some((c) =>
        (REPLACEMENT_ACTION_CODES as readonly number[]).includes(c),
      )
    ) {
      try {
        sessionStorage.removeItem(`route-carool-${orderId}-${wheel}`);
      } catch {}
    }
    setAffectedWheels((prev) => ({ ...prev, [wheel]: data }));
  };

  const handleNavigateToCaroolCheck = (wheel: string) => {
    if (!cache) return;
    const noCarool = wheel === "spare-tire" || wheel === "rear-right-inner" || wheel === "rear-left-inner";
    if (noCarool) return;
    const wheelData = getStoredAffectedWheels(orderId)[wheel];
    const needsPhoto = !!wheelData?.selectedActionCodes.some((c) =>
      (REPLACEMENT_ACTION_CODES as readonly number[]).includes(c),
    );
    if (!needsPhoto) return;
    try {
      sessionStorage.setItem(
        `route-carool-${orderId}-${wheel}`,
        JSON.stringify({ plate: cache.plate, plateType: cache.plateType }),
      );
    } catch {}
    navigate(`/order/${encodeURIComponent(orderId)}/carool/${encodeURIComponent(wheel)}`);
  };

  const NO_CAROOL_WHEELS = new Set(["spare-tire", "rear-right-inner", "rear-left-inner"]);

  const goBackToDashboard = () => {
    if (location.key === "default") {
      navigate("/dashboard", { replace: true });
    } else {
      navigate(-1);
    }
  };

  const handleHeaderBack = () => {
    if (isDirty) {
      setShowDiscardConfirm(true);
      return;
    }
    goBackToDashboard();
  };

  const handleDiscardAndLeave = () => {
    setShowDiscardConfirm(false);
    try {
      if (orderId) {
        sessionStorage.removeItem(`affected-wheels-${orderId}`);
        sessionStorage.removeItem(`carool-photos-done-${orderId}`);
      }
      sessionStorage.removeItem(`route-order-${orderId}`);
    } catch {}
    setAffectedWheels({});
    goBackToDashboard();
  };

  const handleSpareTireChange = (enabled: boolean) => {
    setSpareTire(enabled);
    if (!enabled) {
      setAffectedWheels((prev) => {
        if (!("spare-tire" in prev)) return prev;
        const next = { ...prev };
        delete next["spare-tire"];
        sessionStorage.setItem(`affected-wheels-${orderId}`, JSON.stringify(next));
        return next;
      });
      setSelectedWheel((s) => (s === "spare-tire" ? null : s));
      setPopupWheel((p) => (p === "spare-tire" ? null : p));
    }
  };

  const handleSubmitDiagnosis = async () => {
    if (isSubmitting || !cache) return;

    const photoDone: string[] = JSON.parse(
      sessionStorage.getItem(`carool-photos-done-${orderId}`) || "[]",
    );
    const photoDoneSet = new Set(photoDone);
    const missing = Object.entries(affectedWheels)
      .filter(
        ([wheel, data]) =>
          !NO_CAROOL_WHEELS.has(wheel) &&
          data.selectedActionCodes.some((c) => (REPLACEMENT_ACTION_CODES as readonly number[]).includes(c)),
      )
      .filter(([wheel]) => !photoDoneSet.has(wheel))
      .map(([wheel]) => wheel);
    if (missing.length > 0) {
      showToast(t("acceptedRequest.caroolPhotosRequired"));
      return;
    }

    const tires: Record<string, DiagnosisTireAction[]> = {};
    for (const [wheel, data] of Object.entries(affectedWheels)) {
      const actions: DiagnosisTireAction[] = [];
      const reasonBackedActionCodes = new Set(
        data.selectedReasonCodes
          .map((reasonCode) => data.reasonActionMap[reasonCode])
          .filter((actionCode): actionCode is number => typeof actionCode === "number"),
      );
      for (const actionCode of data.selectedActionCodes) {
        if (reasonBackedActionCodes.has(actionCode)) continue;
        actions.push({ action: actionCode });
      }
      for (const reasonCode of data.selectedReasonCodes) {
        const actionCode = data.reasonActionMap[reasonCode];
        if (typeof actionCode === "number") {
          actions.push({ action: actionCode, reason: reasonCode });
        }
      }
      if (data.movedToWheel) {
        actions.push({ action: 2, transfer_target: data.movedToWheel });
      }
      if (actions.length > 0) tires[wheel] = actions;
    }

    const sourceMileage = cache.mileage ?? "";
    const parsed = sourceMileage ? parseInt(sourceMileage, 10) : NaN;
    const parsedMileage = Number.isFinite(parsed) ? parsed : null;

    const diagnosisPayload = {
      order_id: orderId,
      mileage_update: parsedMileage,
      front_alignment: frontAlignment,
      tires,
    };
    const token = localStorage.getItem("token");
    const jsonHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };

    setIsSubmitting(true);
    try {
      // Carool-active path: stage the mechanic's inputs and kick off Carool's
      // async analysis. The Carool webhook merges the AI results into the
      // order and submits to the ERP server-side; the dashboard / open
      // requests list will surface the new status whenever the mechanic
      // returns. Frontend is fire-and-forget — no spinner, no watchdog.
      if (caroolEnabled) {
        const draftRes = await fetch("/api/diagnosis/draft", {
          method: "POST",
          headers: jsonHeaders,
          body: JSON.stringify(diagnosisPayload),
        });
        if (!draftRes.ok) {
          showToast(t("acceptedRequest.diagnosisError"));
          return;
        }

        // Finalize happens in CaroolCheck after photo capture completes.
        // Fall through to the shared success path below.
      } else {
        // Direct ERP submission path — Carool disabled.
        const res = await fetch("/api/diagnosis", {
          method: "POST",
          headers: jsonHeaders,
          body: JSON.stringify(diagnosisPayload),
        });
        if (!res.ok) {
          showToast(t("acceptedRequest.diagnosisError"));
          return;
        }
      }

      try {
        sessionStorage.removeItem(`carool-photos-done-${orderId}`);
        sessionStorage.removeItem(`affected-wheels-${orderId}`);
        sessionStorage.removeItem(`route-order-${orderId}`);
      } catch {}
      setShowSuccess(true);
      setTimeout(() => {
        setShowSuccess(false);
        navigate("/dashboard", { replace: true });
      }, 1500);
    } catch {
      showToast(t("acceptedRequest.diagnosisError"));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (refetching) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-muted-foreground animate-spin" />
      </div>
    );
  }
  if (refetchFailed || !cache) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="text-center space-y-4">
          <p className="text-muted-foreground">{t("common.requestNotFound")}</p>
          <button
            onClick={() => navigate("/dashboard", { replace: true })}
            className="bg-primary text-primary-foreground px-4 py-2 rounded-lg"
          >
            {t("declinedRequest.backHome")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-background flex flex-col relative overflow-hidden" style={{ height: "100dvh" }}>
      {/* Header */}
      <div className="bg-primary px-4 py-2.5 shadow-md">
        <div className="flex items-center justify-between">
          <button
            onClick={handleHeaderBack}
            className="text-primary-foreground hover:opacity-80 transition-opacity"
          >
            <ArrowRight className="w-5 h-5 ltr:rotate-180" />
          </button>
          <h1 className="text-base text-primary-foreground font-semibold">{t("acceptedRequest.title")}</h1>
          <div className="w-5" />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 px-3 py-2 flex flex-col justify-between overflow-hidden">
        <div className="space-y-2">

          {/* License Plate */}
          <LicensePlate plateNumber={licensePlate} plateType={cache.plateType} className="max-w-[260px] mx-auto" />

          {/* Info chips — 2x2 grid */}
          <div className="grid grid-cols-2 gap-1.5">
            {cache.plateType === "civilian" ? (
              <div className="bg-card rounded-lg border border-border px-2 py-1.5 text-center min-w-0">
                <p className="text-[10px] text-muted-foreground leading-tight truncate">{t("acceptedRequest.customerLabel")}</p>
                <p className="text-sm font-semibold text-foreground leading-tight truncate">{cache.ownershipId ?? "—"}</p>
              </div>
            ) : (
              <div />
            )}
            <div className="bg-card rounded-lg border border-border px-2 py-1.5 text-center min-w-0">
              <p className="text-[10px] text-muted-foreground leading-tight truncate">{t("common.requestNumberLabel")}</p>
              <p className="text-sm font-semibold text-foreground tabular-nums leading-tight truncate">{cache.request_id ?? orderId}</p>
            </div>
            <div className="bg-card rounded-lg border border-border px-2 py-1.5 text-center min-w-0">
              <p className="text-[10px] text-muted-foreground leading-tight truncate">{t("acceptedRequest.mileage")}</p>
              <p className="text-sm font-semibold text-foreground tabular-nums leading-tight" dir="ltr">
                {cache.mileage ? `${Number(cache.mileage).toLocaleString()} ${t("acceptedRequest.km")}` : "—"}
              </p>
            </div>
            <div className="bg-card rounded-lg border border-border px-2 py-1.5 text-center min-w-0">
              <p className="text-[10px] text-muted-foreground leading-tight truncate">{t("common.qualityLabel")}</p>
              <p className="text-sm font-semibold text-foreground leading-tight truncate">{cache.tireLevel && cache.tireLevel.length > 0 ? cache.tireLevel : "—"}</p>
            </div>
          </div>

          {/* Wheel Selector */}
          <div className="bg-card rounded-xl p-1.5 shadow-md border border-border">
            <p className="text-xs font-semibold text-foreground mb-0.5 text-center">{t("acceptedRequest.selectWheel")}</p>
            <div className="relative mx-auto max-w-[240px]">
              <AxlesDiagram
                onWheelClick={handleWheelClick}
                selectedWheel={selectedWheel}
                affectedWheels={new Set(Object.keys(affectedWheels))}
                showSpareTire={spareTire}
                wheelCount={wheelCount}
              />
              {/* Tire size badges overlaid — top edge (above front tires) and bottom edge (below rear tires) */}
              {cache.tireSizes?.front && (
                <div className="absolute inset-x-0 top-0 flex justify-center pointer-events-none">
                  <TireSizeBadge size={cache.tireSizes.front} />
                </div>
              )}
              {cache.tireSizes?.rear && (
                <div className="absolute inset-x-0 flex justify-center pointer-events-none" style={{ top: "76%" }}>
                  <TireSizeBadge size={cache.tireSizes.rear} />
                </div>
              )}
            </div>
          </div>

          {/* Spare tire + Front Alignment */}
          <div className="bg-card rounded-xl px-4 py-3 shadow-md border border-border space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">{t("common.spareTire")}</span>
              <button
                dir="ltr"
                type="button"
                onClick={() => handleSpareTireChange(!spareTire)}
                className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors duration-300 ${
                  spareTire ? "bg-primary" : "bg-muted"
                }`}
              >
                <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform duration-300 ${spareTire ? "translate-x-[3px]" : "translate-x-[28px]"}`} />
              </button>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">{t("common.frontAlignment")}</span>
              <button
                dir="ltr"
                type="button"
                onClick={() => setFrontAlignment(!frontAlignment)}
                className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors duration-300 ${
                  frontAlignment ? "bg-primary" : "bg-muted"
                }`}
              >
                <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform duration-300 ${frontAlignment ? "translate-x-[3px]" : "translate-x-[28px]"}`} />
              </button>
            </div>
          </div>

        </div>

        {/* Continue Button */}
        <button
          onClick={handleSubmitDiagnosis}
          disabled={isSubmitting}
          className="w-full bg-primary hover:bg-primary/90 text-primary-foreground py-2.5 rounded-xl transition-colors duration-200 shadow-lg font-semibold text-sm mb-1 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isSubmitting ? (
            <span className="inline-flex items-center justify-center gap-2">
              <span className="w-4 h-4 border-2 border-primary-foreground/40 border-t-primary-foreground rounded-full animate-spin" />
              {t("common.continue")}
            </span>
          ) : (
            t("common.continue")
          )}
        </button>
      </div>

      {/* Success confirmation overlay */}
      {showSuccess && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-4 bg-card border border-border rounded-2xl px-10 py-8 shadow-xl">
            <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/40 flex items-center justify-center">
              <svg className="w-9 h-9 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <span className="text-lg font-bold text-foreground">{t("acceptedRequest.sentSuccess")}</span>
          </div>
        </div>
      )}

      <TirePopup
        isOpen={popupWheel !== null}
        onClose={closePopup}
        onAttemptClose={(dirty) => {
          if (dirty) setPopupDiscardConfirm(true);
          else closePopup();
        }}
        onDirtyChange={setPopupDirty}
        wheelPosition={popupWheel || ""}
        licensePlate={licensePlate}
        onSubmit={handlePopupSubmit}
        onNavigateToCaroolCheck={handleNavigateToCaroolCheck}
        spareTireEnabled={spareTire}
        wheelCount={wheelCount}
        initialData={popupWheel ? affectedWheels[popupWheel] : undefined}
        actions={actionCodes}
        reasons={reasonCodes}
      />

      <ConfirmModal
        open={popupDiscardConfirm}
        title={t("confirmLeave.title")}
        subtitle={t("confirmLeave.subtitle")}
        primaryLabel={t("confirmLeave.continue")}
        destructiveLabel={t("confirmLeave.discard")}
        onPrimary={() => setPopupDiscardConfirm(false)}
        onDestructive={closePopup}
      />

      <ConfirmModal
        open={showDiscardConfirm}
        title={t("confirmLeaveOrder.title")}
        subtitle={t("confirmLeaveOrder.subtitle")}
        primaryLabel={t("confirmLeaveOrder.continue")}
        destructiveLabel={t("confirmLeaveOrder.discard")}
        onPrimary={() => setShowDiscardConfirm(false)}
        onDestructive={handleDiscardAndLeave}
      />
      {toast}
    </div>
  );
}

function TireSizeBadge({ size, profile }: { size: string; profile?: string }) {
  const label = profile ? `${size} · ${profile}` : size;
  return (
    <p className="text-center">
      <span className="text-[10px] font-bold text-foreground bg-muted/90 px-2 py-px rounded-full tabular-nums shadow-sm" dir="ltr">
        {label}
      </span>
    </p>
  );
}
