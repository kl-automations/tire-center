import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowRight, Check, X } from "lucide-react";
import { usePhoneBackSync } from "../usePhoneBackSync";
import { attachShopStockAvailabilitySignalsListener } from "../../firebase";

export type StockAvailabilityRequestStatus = "live" | "accepted" | "declined";

export type StockAvailabilityRequest = {
  id: string;
  tireSize: string;
  quantity: number;
  status: StockAvailabilityRequestStatus;
};

const AUTO_DISMISS_MS = 15_000;

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

  const [requests, setRequests] = useState<StockAvailabilityRequest[]>([]);

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
      }>;
    };
    const mapped: StockAvailabilityRequest[] = (body.requests ?? []).map((r) => ({
      id: r.request_id,
      tireSize: r.tire_size,
      quantity: Number(r.quantity ?? 2),
      status: r.status,
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
    void fetchRequests().catch((err) => {
      console.warn("[stock-availability] initial fetch failed", err);
    });

    void attachShopStockAvailabilitySignalsListener((changes) => {
      void fetchRequests().catch((err) => {
        console.warn("[stock-availability] refresh after signal failed", err);
      });
      for (const { requestId, status } of changes) {
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
    const token = localStorage.getItem("token");
    let snapshot: StockAvailabilityRequest[] = [];
    setRequests((prev) => {
      snapshot = [...prev];
      return prev.map((r) => (r.id === id ? { ...r, status: "accepted" as const } : r));
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
  };

  const handleDecline = async (id: string) => {
    const token = localStorage.getItem("token");
    let snapshot: StockAvailabilityRequest[] = [];
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
  };

  return (
    <div className="h-screen bg-background flex flex-col" style={{ height: "100dvh" }}>
      <div className="bg-primary p-4 shadow-md shrink-0">
        <div className="flex items-center justify-between max-w-4xl mx-auto">
          <button
            type="button"
            onClick={() => navigate("/dashboard")}
            className="text-primary-foreground hover:opacity-80 transition-opacity"
          >
            <ArrowRight className="w-6 h-6" />
          </button>
          <h1 className="text-xl text-primary-foreground font-semibold">{t("stockAvailability.title")}</h1>
          <div className="w-6" />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 pb-8">
        <div className="max-w-2xl mx-auto space-y-6">
          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-foreground">{t("stockAvailability.liveSection")}</h2>
            {liveRequests.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("stockAvailability.emptyLive")}</p>
            ) : (
              liveRequests.map((request) => (
                <RequestCard
                  key={request.id}
                  request={request}
                  loading={false}
                  onApprove={() => void handleApprove(request.id)}
                  onDecline={() => void handleDecline(request.id)}
                  onDismiss={() => dismissDeclined(request.id)}
                />
              ))
            )}
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-foreground">{t("stockAvailability.acceptedSection")}</h2>
            {acceptedRequests.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("stockAvailability.emptyAccepted")}</p>
            ) : (
              acceptedRequests.map((request) => (
                <RequestCard
                  key={request.id}
                  request={request}
                  loading={false}
                  onApprove={() => {}}
                  onDecline={() => {}}
                  onDismiss={() => dismissDeclined(request.id)} // no-op in practice: no X on accepted cards; same handler as live for symmetry
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
}: {
  request: StockAvailabilityRequest;
  loading: boolean;
  onApprove: () => void;
  onDecline: () => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const isAccepted = request.status === "accepted";
  const isDeclined = request.status === "declined";

  return (
    <article className="relative bg-card border border-border rounded-2xl p-4 shadow-md space-y-3">
      {isDeclined && (
        <button
          type="button"
          onClick={onDismiss}
          disabled={loading}
          className="absolute top-3 start-3 z-10 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          aria-label={t("stockAvailability.dismiss")}
        >
          <X className="w-4 h-4" />
        </button>
      )}

      <div className="space-y-1 text-sm">
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

      {!isAccepted && !isDeclined && (
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onApprove}
            disabled={loading}
            className="bg-green-600 hover:bg-green-700 text-white font-semibold py-2 rounded-lg transition-colors disabled:opacity-50"
          >
            {t("stockAvailability.approve")}
          </button>
          <button
            type="button"
            onClick={onDecline}
            disabled={loading}
            className="bg-red-600 hover:bg-red-700 text-white font-semibold py-2 rounded-lg transition-colors disabled:opacity-50"
          >
            {t("stockAvailability.cancel")}
          </button>
        </div>
      )}

      {isAccepted && (
        <p className="inline-flex items-center gap-1 text-sm font-semibold text-green-700 dark:text-green-300">
          <Check className="w-4 h-4" />
          {t("stockAvailability.acceptedLabel")}
        </p>
      )}

      {isDeclined && (
        <p className="text-sm font-semibold text-red-700 dark:text-red-300">{t("stockAvailability.declinedLabel")}</p>
      )}
    </article>
  );
}
