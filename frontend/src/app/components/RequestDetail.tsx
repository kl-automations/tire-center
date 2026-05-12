import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowRight, Check, Loader2, X as XIcon } from "lucide-react";
import { LicensePlate } from "./LicensePlate";
import {
  STATUS_LABEL_KEYS,
  STATUS_STYLES,
  addDismissedOrderId,
  mapOrdersResponse,
  useCodes,
  type OpenRequest,
  type WheelWork,
} from "./OpenRequests";
import type { ActionCodeItem, ReasonCodeItem } from "./TirePopup";
import { translateQualityTier } from "../qualityTier";
import { usePhoneBackSync } from "../usePhoneBackSync";

type LabeledRow = { label_he?: string | null; label_ar?: string | null; label_ru?: string | null };
function labelFor(item: LabeledRow | undefined, language: string): string {
  if (!item) return "";
  const lang = language?.split("-")[0] ?? "he";
  if (lang === "ar" && item.label_ar && item.label_ar.trim().length > 0) return item.label_ar;
  if (lang === "ru" && item.label_ru && item.label_ru.trim().length > 0) return item.label_ru;
  return item.label_he || "";
}

const WHEEL_POS_KEYS: Record<string, string> = {
  "front-right": "wheels.frontRight",
  "front-left": "wheels.frontLeft",
  "rear-right": "wheels.rearRight",
  "rear-left": "wheels.rearLeft",
  "rear-right-inner": "wheels.rearRightInner",
  "rear-left-inner": "wheels.rearLeftInner",
  "spare-tire": "wheels.spareTire",
};

function WheelDetailPopup({
  isOpen,
  onClose,
  wheelPosition,
  work,
  actions,
  reasons,
  language,
}: {
  isOpen: boolean;
  onClose: () => void;
  wheelPosition: string;
  work: WheelWork;
  actions: ActionCodeItem[];
  reasons: ReasonCodeItem[];
  language: string;
}) {
  const { t } = useTranslation();
  if (!isOpen) return null;

  const actionByCode = new Map<number, ActionCodeItem>(actions.map((a) => [a.code, a]));
  const reasonByCode = new Map<number, ReasonCodeItem>(reasons.map((r) => [r.code, r]));

  const approvalLabel =
    work.approval === "full"
      ? t("approval.full")
      : work.approval === "puncture-only"
        ? t("approval.punctureOnly")
        : t("approval.none");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-card rounded-2xl shadow-2xl p-6 w-full max-w-lg mx-4 border border-border">
        <button
          onClick={onClose}
          className="absolute top-4 start-4 text-muted-foreground hover:text-foreground transition-colors"
        >
          <XIcon className="w-6 h-6" />
        </button>

        <div className="space-y-5">
          <div className="text-center">
            <h2 className="text-xl font-semibold text-foreground">
              {WHEEL_POS_KEYS[wheelPosition] ? t(WHEEL_POS_KEYS[wheelPosition]) : wheelPosition}
            </h2>
            <div className="mt-2 flex justify-center">
              <span
                className={`inline-block px-3 py-1 rounded-full text-sm font-semibold border ${
                  work.approval === "full"
                    ? "bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300 border-green-300 dark:border-green-700"
                    : work.approval === "puncture-only"
                      ? "bg-orange-100 dark:bg-orange-900/40 text-orange-800 dark:text-orange-300 border-orange-300 dark:border-orange-700"
                      : "bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-300 border-red-300 dark:border-red-700"
                }`}
              >
                {approvalLabel}
              </span>
            </div>
          </div>

          {work.replacementReason && (
            <div className="space-y-2">
              <label className="text-sm font-semibold text-foreground">{t("requestDetail.reason")}</label>
              <div className="w-full px-4 py-3 bg-muted border border-border rounded-lg text-foreground">
                {work.replacementReason}
              </div>
            </div>
          )}

          <div className="space-y-3">
            {work.actions.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center">—</p>
            ) : (
              work.actions.map((action, i) => {
                const actionLabel = labelFor(actionByCode.get(action.code), language);
                const reasonLabel =
                  typeof action.reason === "number"
                    ? labelFor(reasonByCode.get(action.reason), language)
                    : "";
                const targetLabel = action.transferTarget
                  ? WHEEL_POS_KEYS[action.transferTarget]
                    ? t(WHEEL_POS_KEYS[action.transferTarget])
                    : action.transferTarget
                  : "";
                const text = action.transferTarget
                  ? `${actionLabel || t("tirePopup.sectionRelocation")} → ${targetLabel}`
                  : reasonLabel
                    ? `${actionLabel} | ${reasonLabel}`
                    : actionLabel;
                if (!text) return null;
                return (
                  <div
                    key={i}
                    className="flex items-center justify-between bg-background rounded-xl px-4 py-3 border border-border"
                  >
                    <span className="font-semibold text-foreground">{text}</span>
                    <span className="px-3 py-1 rounded-full text-sm font-semibold bg-primary/10 dark:bg-blue-400/15 text-primary dark:text-blue-400">
                      {t("common.yes")}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ConfirmationPopup({
  isOpen,
  onClose,
  onConfirm,
}: {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (notes: string) => void;
}) {
  const { t } = useTranslation();
  const [notes, setNotes] = useState("");

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-card rounded-2xl shadow-2xl p-6 w-full max-w-lg mx-4 border border-border">
        <button
          onClick={onClose}
          className="absolute top-4 start-4 text-muted-foreground hover:text-foreground transition-colors"
        >
          <XIcon className="w-6 h-6" />
        </button>

        <div className="space-y-5">
          <div className="text-center">
            <h2 className="text-xl font-semibold text-foreground">{t("requestDetail.confirmTitle")}</h2>
            <p className="text-sm text-muted-foreground mt-1">
              {t("requestDetail.confirmQuestion")}
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold text-foreground">
              {t("requestDetail.notesLabel")}
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t("requestDetail.notesPlaceholder")}
              rows={4}
              className="w-full px-4 py-3 bg-input-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all resize-none"
            />
          </div>

          <button
            onClick={() => onConfirm(notes)}
            className="w-full bg-green-600 hover:bg-green-700 text-white py-3 rounded-xl transition-colors duration-200 shadow-md hover:shadow-lg font-semibold flex items-center justify-center gap-2"
          >
            <Check className="w-5 h-5" />
            {t("requestDetail.confirmButton")}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Detail screen for a single service order.
 *
 * Shows the full order summary: vehicle info, tyre sizes, quality tier,
 * per-wheel work with approval status badges, front-alignment indicator,
 * and rejection reason (if declined). Each wheel row opens a `WheelDetailPopup`
 * with the full work breakdown.
 *
 * Also provides a "Confirm" action which prompts for optional mechanic notes
 * and marks the order as acknowledged in local storage.
 *
 * Data source: `GET /api/orders/{id}` with a Bearer JWT from `localStorage`.
 * The single-row response is run through `mapOrdersResponse` (the same helper
 * used by the list screen) so both screens share one shape.
 *
 * Navigation: reached from `open-requests` via `{ name: "request-detail", id }`;
 * navigates back to `open-requests` on close or confirm.
 */
export function RequestDetail() {
  const { t, i18n } = useTranslation();
  const codes = useCodes();
  const navigate = useNavigate();
  usePhoneBackSync({ fallback: "/open-requests" });
  const params = useParams<{ id: string }>();
  const [detailWheel, setDetailWheel] = useState<string | null>(null);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [request, setRequest] = useState<OpenRequest | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [notFound, setNotFound] = useState<boolean>(false);

  const id = params.id ?? null;

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setIsLoading(true);
    setNotFound(false);

    (async () => {
      try {
        const token = localStorage.getItem("token");
        const res = await fetch(`/api/orders/${id}`, {
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });
        if (cancelled) return;
        if (res.status === 404) {
          setNotFound(true);
          setRequest(null);
          return;
        }
        if (!res.ok) {
          setRequest(null);
          return;
        }
        const data = await res.json();
        const [mapped] = mapOrdersResponse([data], codes.actions, codes.reasons, i18n.language);
        setRequest(mapped ?? null);
      } catch {
        if (!cancelled) setRequest(null);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id, codes, i18n.language]);

  if (!id) return null;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-muted-foreground animate-spin" />
      </div>
    );
  }

  if (notFound || !request) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground text-lg">{t("common.requestNotFound")}</p>
      </div>
    );
  }

  const statusStyles = STATUS_STYLES[request.status];
  const canConfirm = request.status === "approved" || request.status === "partly-approved";
  const wheels = request.wheels || {};
  const currentWheelWork = detailWheel ? wheels[detailWheel] : null;

  const handleConfirm = (notes: string) => {
    console.log("Request confirmed:", request.id, "Notes:", notes);
    addDismissedOrderId(request.id);
    setShowConfirmation(false);
    navigate("/open-requests");
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="bg-primary p-4 shadow-md">
        <div className="flex items-center justify-between max-w-6xl mx-auto">
          <button
            onClick={() => navigate("/open-requests")}
            className="text-primary-foreground hover:opacity-80 transition-opacity"
          >
            <ArrowRight className="w-6 h-6 ltr:rotate-180" />
          </button>
          <h1 className="text-xl text-primary-foreground font-semibold">{t("requestDetail.title")}</h1>
          <div className="w-6" />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 p-4 pb-8 overflow-y-auto">
        <div className="max-w-6xl mx-auto space-y-6">
          {/* License Plate */}
          <LicensePlate plateNumber={request.licensePlate} plateType={request.plateType} className="w-full max-w-md mx-auto" />

          {/* Status + request number + optional quality */}
          <div className="flex flex-col items-center gap-2">
            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
              <span
                className={`inline-block px-4 py-2 rounded-full text-base font-semibold ${statusStyles.bg} ${statusStyles.text} border ${statusStyles.border}`}
              >
                {t(STATUS_LABEL_KEYS[request.status])}
              </span>
              <span className="text-sm text-muted-foreground tabular-nums">
                {t("common.requestNumberLine", { requestNumber: request.requestNumber })}
              </span>
            </div>
            {request.quality != null && request.quality !== "" && (
              <span className="text-sm text-muted-foreground tabular-nums">
                {t("common.qualityLine", { quality: translateQualityTier(t, request.quality) })}
              </span>
            )}
          </div>

          {request.status === "declined" && request.rejectionReason && (
            <div className="bg-destructive/10 border border-destructive/25 rounded-xl p-4 max-w-2xl mx-auto w-full">
              <p className="text-sm font-semibold text-muted-foreground mb-2">
                {t("declinedRequest.rejectionReason")}
              </p>
              <p className="text-foreground text-base leading-relaxed whitespace-pre-wrap">
                {request.rejectionReason}
              </p>
            </div>
          )}

          {/* Front Alignment */}
          <div className="bg-card rounded-2xl p-6 shadow-md border border-border">
            <div className="flex items-center justify-between">
              <span className="text-lg font-semibold text-foreground">{t("common.frontAlignment")}</span>
              <span
                className={`px-3 py-1 rounded-full text-sm font-semibold ${
                  request.frontAlignment
                    ? "bg-primary/10 dark:bg-blue-400/15 text-primary dark:text-blue-400"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {request.frontAlignment ? t("common.yes") : t("common.no")}
              </span>
            </div>
          </div>

          {/* Confirm Button - only for approved / partly-approved */}
          {canConfirm && (
            <button
              onClick={() => setShowConfirmation(true)}
              className="w-full bg-green-600 hover:bg-green-700 text-white py-4 rounded-xl transition-colors duration-200 shadow-lg hover:shadow-xl font-semibold text-lg flex items-center justify-center gap-2"
            >
              <Check className="w-6 h-6" />
              {t("requestDetail.confirmButton")}
            </button>
          )}
        </div>
      </div>

      {/* Wheel Detail Popup */}
      {currentWheelWork && (
        <WheelDetailPopup
          isOpen={detailWheel !== null}
          onClose={() => setDetailWheel(null)}
          wheelPosition={detailWheel!}
          work={currentWheelWork}
          actions={codes.actions}
          reasons={codes.reasons}
          language={i18n.language}
        />
      )}

      {/* Confirmation Popup */}
      <ConfirmationPopup
        isOpen={showConfirmation}
        onClose={() => setShowConfirmation(false)}
        onConfirm={handleConfirm}
      />
    </div>
  );
}
