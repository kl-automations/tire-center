import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AlertCircle, ArrowRight, Check, Loader2, X } from "lucide-react";
import { usePhoneBackSync } from "../usePhoneBackSync";
import { attachShopStockAvailabilitySignalsListener } from "../../firebase";

export type StockAvailabilityRequestStatus =
  | "live"
  | "accepted"
  | "declined"
  | "declined_failed";

export type StockAvailabilityRequest = {
  id: string;
  tireSize: string;
  quantity: number;
  status: StockAvailabilityRequestStatus;
  closedReason: "closed" | "cancelled" | null;
};

function parseClosedReason(value: unknown): "closed" | "cancelled" | null {
  if (value === "closed" || value === "cancelled") return value;
  return null;
}

const AUTO_DISMISS_MS = 15_000;

/**
 * Dashboard tile indicator: true when at least one stock request has status `live`.
 * False until the first fetch completes (avoids a flash on load).
 */
export function useStockAvailabilitySummary(): { hasLiveRequests: boolean } {
  const [hasLiveRequests, setHasLiveRequests] = useState(false);
  const initialFetchDoneRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let unsub: (() => void) | null = null;

    const refresh = async () => {
      try {
        const token = localStorage.getItem("token");
        const res = await fetch("/api/stock-availability/requests", {
          headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        });
        if (cancelled) return;
        if (!res.ok) {
          if (!initialFetchDoneRef.current) {
            initialFetchDoneRef.current = true;
            setHasLiveRequests(false);
          }
          return;
        }
        const body = (await res.json()) as {
          requests?: Array<{ status: StockAvailabilityRequestStatus }>;
        };
        if (cancelled) return;
        initialFetchDoneRef.current = true;
        const liveCount = (body.requests ?? []).filter((r) => r.status === "live").length;
        setHasLiveRequests(liveCount > 0);
      } catch {
        if (!cancelled && !initialFetchDoneRef.current) {
          initialFetchDoneRef.current = true;
          setHasLiveRequests(false);
        }
      }
    };

    void refresh();

    void attachShopStockAvailabilitySignalsListener(() => {
      void refresh();
    }).then((fn) => {
      if (cancelled) {
        fn?.();
        return;
      }
      unsub = fn;
    });

    return () => {
      cancelled = true;
      unsub?.();
    };
  }, []);

  return { hasLiveRequests };
}

/**
 * Red-route stock checks from Tafnit (live list, approve/decline, Firestore-driven decline timer).
 *
 * Navigation: from dashboard; back returns to `/dashboard`.
 */
export function StockAvailability() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  usePhoneBackSync({ fallback: "/dashboard" });

  const declineTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const requestsRef = useRef<StockAvailabilityRequest[]>([]);
  const actionInFlightRef = useRef(false);

  const [requests, setRequests] = useState<StockAvailabilityRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingId, setPendingId] = useState<string | null>(null);

  useEffect(() => {
    requestsRef.current = requests;
  }, [requests]);

  const fetchRequests = useCallback(async () => {
    const token = localStorage.getItem("token");
    const res = await fetch("/api/stock-availability/requests", {
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
    if (!res.ok) {
      throw new Error(`fetch failed: ${res.status}`);
    }
    const body = (await res.json()) as {
      requests?: Array<{
        request_id: string;
        tire_size: string;
        quantity: number;
        status: StockAvailabilityRequestStatus;
        closed_reason?: string | null;
      }>;
    };
    const mapped: StockAvailabilityRequest[] = (body.requests ?? []).map((r) => ({
      id: r.request_id,
      tireSize: r.tire_size,
      quantity: Number(r.quantity ?? 2),
      status: r.status,
      closedReason: parseClosedReason(r.closed_reason),
    }));
    setRequests((prev) => {
      const declinedLocal = prev.filter((r) => r.status === "declined");
      const incomingIds = new Set(mapped.map((r) => r.id));
      return [...mapped, ...declinedLocal.filter((r) => !incomingIds.has(r.id))];
    });
  }, []);

  const dismissDeclined = useCallback((id: string) => {
    const pending = declineTimersRef.current[id];
    if (pending) {
      clearTimeout(pending);
      delete declineTimersRef.current[id];
    }
    setRequests((prev) => prev.filter((r) => r.id !== id));
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unsub: (() => void) | null = null;
    void (async () => {
      try {
        await fetchRequests();
      } catch (err) {
        console.warn("[stock-availability] initial fetch failed", err);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    void attachShopStockAvailabilitySignalsListener((changes) => {
      void fetchRequests().catch((err) => {
        console.warn("[stock-availability] refresh after signal failed", err);
      });
      for (const { requestId, status } of changes) {
        if (status === "deleted") {
          dismissDeclined(requestId);
          continue;
        }
        if (status === "declined_failed") {
          setRequests((prev) => {
            const idx = prev.findIndex((r) => r.id === requestId);
            if (idx < 0) return prev;
            const next = [...prev];
            next[idx] = { ...next[idx], status: "declined_failed" };
            return next;
          });
          continue;
        }
        if (status !== "declined_acked" || declineTimersRef.current[requestId]) continue;
        const row = requestsRef.current.find((r) => r.id === requestId);
        if (row?.status !== "declined") continue;
        declineTimersRef.current[requestId] = setTimeout(
          () => dismissDeclined(requestId),
          AUTO_DISMISS_MS,
        );
      }
    }).then((fn) => {
      if (cancelled) {
        fn?.();
        return;
      }
      unsub = fn;
    });

    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [fetchRequests, dismissDeclined]);

  useEffect(() => {
    return () => {
      for (const timer of Object.values(declineTimersRef.current)) {
        clearTimeout(timer);
      }
      declineTimersRef.current = {};
    };
  }, []);

  const liveRequests = useMemo(() => requests.filter((r) => r.status !== "accepted"), [requests]);
  const acceptedRequests = useMemo(() => requests.filter((r) => r.status === "accepted"), [requests]);

  const handleApprove = async (id: string) => {
    if (pendingId || actionInFlightRef.current) return;
    actionInFlightRef.current = true;
    setPendingId(id);
    const token = localStorage.getItem("token");
    let snapshot: StockAvailabilityRequest[] = [];
    try {
      setRequests((prev) => {
        snapshot = [...prev];
        return prev.map((r) =>
          r.id === id ? { ...r, status: "accepted" as const, closedReason: null } : r,
        );
      });
      try {
        const res = await fetch(`/api/stock-availability/requests/${encodeURIComponent(id)}/approve`, {
          method: "POST",
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            "Content-Type": "application/json",
          },
        });
        if (!res.ok) {
          setRequests(snapshot);
          console.warn("[stock-availability] approve failed", res.status);
        }
      } catch (e) {
        setRequests(snapshot);
        console.warn("[stock-availability] approve failed", e);
      }
    } finally {
      actionInFlightRef.current = false;
      setPendingId(null);
    }
  };

  const handleDismissFailed = async (id: string) => {
    if (pendingId || actionInFlightRef.current) return;
    actionInFlightRef.current = true;
    setPendingId(id);
    const token = localStorage.getItem("token");
    try {
      const res = await fetch(
        `/api/stock-availability/requests/${encodeURIComponent(id)}/dismiss`,
        {
          method: "POST",
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            "Content-Type": "application/json",
          },
        },
      );
      if (res.ok) {
        dismissDeclined(id);
      } else {
        console.warn("[stock-availability] dismiss failed", res.status);
      }
    } catch (e) {
      console.warn("[stock-availability] dismiss failed", e);
    } finally {
      actionInFlightRef.current = false;
      setPendingId(null);
    }
  };

  const handleDecline = async (id: string) => {
    if (pendingId || actionInFlightRef.current) return;
    actionInFlightRef.current = true;
    setPendingId(id);
    const token = localStorage.getItem("token");
    let snapshot: StockAvailabilityRequest[] = [];
    try {
      setRequests((prev) => {
        snapshot = [...prev];
        return prev.map((r) => (r.id === id ? { ...r, status: "declined" as const } : r));
      });
      try {
        const res = await fetch(`/api/stock-availability/requests/${encodeURIComponent(id)}/decline`, {
          method: "POST",
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            "Content-Type": "application/json",
          },
        });
        if (!res.ok) {
          setRequests(snapshot);
          console.warn("[stock-availability] decline failed", res.status);
        }
      } catch (e) {
        setRequests(snapshot);
        console.warn("[stock-availability] decline failed", e);
      }
    } finally {
      actionInFlightRef.current = false;
      setPendingId(null);
    }
  };

  return (
    <div className="h-screen bg-background flex flex-col" style={{ height: "100dvh" }}>
      <div className="bg-primary p-4 shadow-md shrink-0">
        <div className="flex items-center justify-between max-w-4xl mx-auto">
          <button
            type="button"
            onClick={() => navigate("/dashboard")}
            className="flex items-center justify-center w-11 h-11 -ms-1 text-primary-foreground hover:opacity-80 transition-opacity"
          >
            <ArrowRight className="w-6 h-6 ltr:rotate-180" />
          </button>
          <h1 className="text-2xl text-primary-foreground font-semibold">{t("stockAvailability.title")}</h1>
          <div className="w-11" />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 pb-8">
        <div className="max-w-2xl mx-auto space-y-6">
          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-foreground">{t("stockAvailability.liveSection")}</h2>
            {liveRequests.length === 0 ? (
              isLoading ? (
                <div className="flex items-center gap-3 text-base text-muted-foreground" aria-busy="true">
                  <Loader2 className="w-5 h-5 animate-spin shrink-0" aria-hidden />
                  <span>{t("common.loading")}</span>
                </div>
              ) : (
                <p className="text-base text-muted-foreground">{t("stockAvailability.emptyLive")}</p>
              )
            ) : (
              liveRequests.map((request) => (
                <RequestCard
                  key={request.id}
                  request={request}
                  loading={pendingId === request.id}
                  onApprove={() => void handleApprove(request.id)}
                  onDecline={() => void handleDecline(request.id)}
                  onDismiss={() => dismissDeclined(request.id)}
                  onDismissFailed={() => void handleDismissFailed(request.id)}
                />
              ))
            )}
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold text-foreground">{t("stockAvailability.acceptedSection")}</h2>
            {acceptedRequests.length === 0 ? (
              <p className="text-base text-muted-foreground">{t("stockAvailability.emptyAccepted")}</p>
            ) : (
              acceptedRequests.map((request) => (
                <RequestCard
                  key={request.id}
                  request={request}
                  loading={pendingId === request.id}
                  onApprove={() => {}}
                  onDecline={() => {}}
                  onDismiss={() => dismissDeclined(request.id)}
                  onDismissFailed={() => void handleDismissFailed(request.id)}
                />
              ))
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function RequestCard({
  request,
  loading,
  onApprove,
  onDecline,
  onDismiss,
  onDismissFailed,
}: {
  request: StockAvailabilityRequest;
  loading: boolean;
  onApprove: () => void;
  onDecline: () => void;
  onDismiss: () => void;
  onDismissFailed: () => void;
}) {
  const { t } = useTranslation();
  const isAccepted = request.status === "accepted";
  const isDeclined = request.status === "declined";
  const isDeclinedFailed = request.status === "declined_failed";

  return (
    <article
      className={`relative bg-card border rounded-2xl p-6 shadow-md space-y-4 min-h-[200px] ${
        isDeclinedFailed ? "border-amber-500 dark:border-amber-600" : "border-border"
      }`}
    >
      {(isDeclined || isDeclinedFailed) && (
        <button
          type="button"
          onClick={isDeclinedFailed ? onDismissFailed : onDismiss}
          disabled={loading}
          className="absolute top-2 start-2 z-10 flex items-center justify-center w-10 h-10 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          aria-label={t("stockAvailability.dismiss")}
        >
          <X className="w-5 h-5" />
        </button>
      )}

      <div className="space-y-2 text-base">
        <p className="text-foreground">
          <span className="font-semibold">{t("stockAvailability.requestId")}:</span> {request.id}
        </p>
        <p className="text-foreground">
          <span className="font-semibold">{t("stockAvailability.tireSize")}:</span> {request.tireSize}
        </p>
        <p className="text-foreground">
          <span className="font-semibold">{t("stockAvailability.quantity")}:</span> {request.quantity}
        </p>
      </div>

      {!isAccepted && !isDeclined && !isDeclinedFailed && (
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={onApprove}
            disabled={loading}
            className="bg-green-600 hover:bg-green-700 text-white font-semibold py-3.5 rounded-lg transition-colors disabled:opacity-50"
          >
            {t("stockAvailability.approve")}
          </button>
          <button
            type="button"
            onClick={onDecline}
            disabled={loading}
            className="bg-red-600 hover:bg-red-700 text-white font-semibold py-3.5 rounded-lg transition-colors disabled:opacity-50"
          >
            {t("stockAvailability.cancel")}
          </button>
        </div>
      )}

      {isAccepted && (
        <div className="space-y-1">
          <p className="inline-flex items-center gap-2 text-base font-semibold text-green-700 dark:text-green-300">
            <Check className="w-5 h-5" />
            {t("stockAvailability.acceptedLabel")}
          </p>
          {request.closedReason === "closed" && (
            <p className="text-base text-muted-foreground">{t("stockAvailability.closedNotice")}</p>
          )}
          {request.closedReason === "cancelled" && (
            <p className="text-base text-muted-foreground">{t("stockAvailability.cancelledNotice")}</p>
          )}
        </div>
      )}

      {isDeclined && (
        <p className="text-base font-semibold text-red-700 dark:text-red-300">{t("stockAvailability.declinedLabel")}</p>
      )}

      {isDeclinedFailed && (
        <div className="flex items-start gap-3 text-base font-semibold text-amber-800 dark:text-amber-200">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" aria-hidden />
          <p>{t("stockAvailability.ack_failed_message")}</p>
        </div>
      )}
    </article>
  );
}
