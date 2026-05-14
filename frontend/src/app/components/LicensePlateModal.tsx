import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { TriangleAlert, X } from "lucide-react";
import type { PlateType } from "./LicensePlate";
import { LICENSE_PLATE_FRAME_CLASS, LicensePlateBlueStrip } from "./LicensePlate";

const PLATE_OPTIONS: PlateType[] = ["civilian", "military", "police"];

const PLATE_BG_MAIN: Record<PlateType, string> = {
  civilian:
    "bg-gradient-to-b from-[#ffe94a] via-[#f5d20a] to-[#e6bc00] shadow-[inset_0_2px_6px_rgba(255,255,255,0.45)] border-s border-black/10",
  military:
    "bg-gradient-to-b from-zinc-800 via-neutral-950 to-black shadow-[inset_0_2px_8px_rgba(0,0,0,0.6)]",
  police:
    "bg-gradient-to-b from-[#dc2626] via-[#b91c1c] to-[#991b1b] shadow-[inset_0_2px_6px_rgba(255,255,255,0.12)] border-s border-black/15",
};

const PLATE_TEXT: Record<PlateType, { main: string; placeholder: string; suffixShadow: string }> = {
  civilian: {
    main: "text-neutral-900",
    placeholder: "placeholder:text-neutral-900/35",
    suffixShadow: "",
  },
  military: {
    main: "text-white [text-shadow:0_1px_0_rgba(255,255,255,0.35),0_-1px_2px_rgba(0,0,0,0.5)]",
    placeholder: "placeholder:text-white/35",
    suffixShadow: "[text-shadow:0_1px_0_rgba(255,255,255,0.35),0_-1px_2px_rgba(0,0,0,0.5)]",
  },
  police: {
    main: "text-white [text-shadow:0_1px_0_rgba(255,255,255,0.35),0_-1px_2px_rgba(0,0,0,0.5)]",
    placeholder: "placeholder:text-white/35",
    suffixShadow: "[text-shadow:0_1px_0_rgba(255,255,255,0.35),0_-1px_2px_rgba(0,0,0,0.5)]",
  },
};

const SUFFIX: Record<Exclude<PlateType, "civilian">, string> = {
  military: "\u05E6",
  police: "\u05DE",
};

const mono = { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" as const };

type SubmitToCarOptions = {
  lastMileageHint?: number | null;
};

interface LicensePlateModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Modal for entering a vehicle licence plate to open a new service order.
 *
 * Accepts: plate number (free text), plate type (civilian/military/police),
 * and current mileage. On submit, calls `POST /api/car` with a Bearer JWT
 * read from `localStorage` ("token").
 *
 * On ERP approval (`recognized === true`), navigates to `{ name: "accepted-request" }`.
 * On ERP rejection or network error, navigates to `{ name: "declined-request" }`
 * with the server-provided error detail (or a generic fallback) as `reason`.
 *
 * @param isOpen  - Controls modal visibility.
 * @param onClose - Callback invoked when the modal is dismissed.
 */
export function LicensePlateModal({ isOpen, onClose }: LicensePlateModalProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [licensePlate, setLicensePlate] = useState("");
  const [plateType, setPlateType] = useState<PlateType>("civilian");
  const [mileage, setMileage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Last mileage on file from the ERP, fetched in the background on LP-blur.
  // `null` covers all "skip validation" cases: no history (ERP ReturnCode='1'),
  // network/ERP error, response not yet returned, or no LP-blur fired yet.
  const [lastMileage, setLastMileage] = useState<number | null>(null);
  const [showMileagePopup, setShowMileagePopup] = useState(false);
  const [mileageWarningMessage, setMileageWarningMessage] = useState("");
  // Track the in-flight request (plate it was issued for + its AbortController)
  // so a stale response from a previous LP doesn't overwrite a fresh one, and
  // so changing the LP cancels the obsolete request before kicking a new one.
  const lastMileageRequestRef = useRef<{ plate: string; controller: AbortController } | null>(null);

  // Clean up any in-flight request if the modal is unmounted mid-fetch.
  useEffect(() => {
    return () => {
      if (lastMileageRequestRef.current) {
        lastMileageRequestRef.current.controller.abort();
        lastMileageRequestRef.current = null;
      }
    };
  }, []);

  const fetchLastMileage = (plate: string) => {
    if (!plate) return;

    if (lastMileageRequestRef.current) {
      lastMileageRequestRef.current.controller.abort();
    }

    // Reset to the "pending / unknown" state for the duration of the fetch.
    // Without this, a re-blur on the same LP would keep the previous response
    // visible to the validator until the new one lands — which is wrong if
    // the underlying value has been invalidated for any reason. Pending is
    // treated as skip-validation, matching the spec.
    setLastMileage(null);

    const controller = new AbortController();
    lastMileageRequestRef.current = { plate, controller };

    const token = localStorage.getItem("token");
    fetch("/api/car/last-mileage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ license_plate: plate }),
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { last_mileage?: number | null } | null) => {
        // Stale-response guard: another blur (or LP edit) has happened since
        // we issued this request, so its result is no longer relevant.
        if (lastMileageRequestRef.current?.plate !== plate) return;
        const lastMileageValue =
          data && typeof data.last_mileage === "number" ? data.last_mileage : null;
        setLastMileage(lastMileageValue);
      })
      .catch(() => {
        // Spec: any failure (timeout, ERP error) silently skips validation.
        // No state change needed — `lastMileage` stays null and the submit
        // path treats null as "no history, allow submission".
      });
  };

  const handleLicensePlateBlur = () => {
    const plate = licensePlate.trim();
    if (!plate) return;
    fetchLastMileage(plate);
  };

  // Mobile fallback: tapping straight from the LP input into the mileage
  // input doesn't reliably fire LP-blur before mileage receives focus, so
  // we re-trigger the fetch here. The ref guard skips the call when LP-blur
  // has already kicked off (or completed) a request for the same plate.
  const handleMileageFocus = () => {
    const plate = licensePlate.trim();
    if (!plate || lastMileageRequestRef.current?.plate === plate) return;
    fetchLastMileage(plate);
  };

  const submitToCar = async (
    plate: string,
    parsedMileage: number | null,
    trimmedMileage: string,
    options: SubmitToCarOptions = {},
  ) => {
    const { lastMileageHint = null } = options;
    const genericFallback = t("licensePlateModal.genericCarLookupError");

    setIsSubmitting(true);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch("/api/car", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          license_plate: plate,
          mileage: parsedMileage,
          last_mileage_hint: lastMileageHint,
          plate_type: plateType,
        }),
      });

      type CarLookupResponse = {
        recognized?: boolean;
        detail?: string;
        order_id?: string;
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
      };
      let data: CarLookupResponse | null = null;
      try {
        data = (await res.json()) as CarLookupResponse;
      } catch {
        data = null;
      }

      if (res.ok && data?.recognized === true) {
        const orderId = data.order_id ?? "";
        // Seed the screen cache with all of the ERP-supplied props so the
        // AcceptedRequest screen can hydrate synchronously on mount and
        // — critically — survives a full page reload via sessionStorage.
        const cachePayload = {
          plate: licensePlate,
          plateType,
          mileage: trimmedMileage,
          order_id: orderId,
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
        try {
          sessionStorage.setItem(`route-order-${orderId}`, JSON.stringify(cachePayload));
        } catch {}
        navigate(`/order/${encodeURIComponent(orderId)}`);
      } else {
        const reason =
          (data && typeof data.detail === "string" && data.detail) || genericFallback;
        // Synthetic "declined" key — there's no real order_id, so we use a
        // stable per-plate slug. Reload would reopen the same declined view.
        const slug = `np-${encodeURIComponent(licensePlate)}`;
        try {
          sessionStorage.setItem(
            `route-declined-${slug}`,
            JSON.stringify({ plate: licensePlate, plateType, reason }),
          );
        } catch {}
        navigate(`/order/${slug}/declined`);
      }
      onClose();
    } catch {
      const slug = `np-${encodeURIComponent(licensePlate)}`;
      try {
        sessionStorage.setItem(
          `route-declined-${slug}`,
          JSON.stringify({ plate: licensePlate, plateType, reason: genericFallback }),
        );
      } catch {}
      navigate(`/order/${slug}/declined`);
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleContinue = async () => {
    const plate = licensePlate.trim();
    if (!plate || isSubmitting) return;

    const trimmedMileage = mileage.trim();
    const parsedMileage = trimmedMileage ? parseInt(trimmedMileage, 10) : null;

    // Last-mileage check (spec): warn — but don't block — when the entered
    // mileage is below the last value on file. The mechanic can correct it
    // or proceed anyway via the popup. Number.isFinite guards against
    // parseInt returning NaN, which would otherwise sneak past the
    // `!== null` check and silently skip the warning (NaN < anything is
    // always false).
    if (
      lastMileage !== null &&
      parsedMileage !== null &&
      Number.isFinite(parsedMileage) &&
      parsedMileage < lastMileage
    ) {
      setMileageWarningMessage(t("licensePlateModal.warningMileageBelowLast"));
      setShowMileagePopup(true);
      return;
    }

    await submitToCar(plate, parsedMileage, trimmedMileage, { lastMileageHint: null });
  };

  const handleProceedAnyway = async () => {
    const plate = licensePlate.trim();
    if (!plate || isSubmitting) return;
    const trimmedMileage = mileage.trim();
    const parsedMileage = trimmedMileage ? parseInt(trimmedMileage, 10) : null;
    setShowMileagePopup(false);
    await submitToCar(plate, parsedMileage, trimmedMileage, { lastMileageHint: lastMileage });
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.toUpperCase().slice(0, 8);
    setLicensePlate(value);
    // Editing the LP invalidates any previously fetched value — cancel the
    // in-flight request and drop the cached result so it doesn't linger
    // across vehicles.
    if (lastMileageRequestRef.current) {
      lastMileageRequestRef.current.controller.abort();
      lastMileageRequestRef.current = null;
    }
    setLastMileage(null);
  };

  const handleMileageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setMileage(e.target.value);
  };

  if (!isOpen) return null;

  const bgMain = PLATE_BG_MAIN[plateType];
  const text = PLATE_TEXT[plateType];

  return (
    <>
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      <div className="relative bg-card rounded-2xl shadow-2xl p-8 w-full max-w-2xl mx-4 border border-border">
        <button
          onClick={onClose}
          className="absolute top-4 start-4 text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="w-6 h-6" />
        </button>

        <div className="text-center space-y-6">
          <div>
            <h2 className="text-2xl text-foreground mb-2">{t("licensePlateModal.title")}</h2>
            <p className="text-muted-foreground">{t("licensePlateModal.subtitle")}</p>
          </div>

          <div className="flex justify-center gap-3 flex-wrap">
            {PLATE_OPTIONS.map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => setPlateType(opt)}
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200 border-2 ${
                  plateType === opt
                    ? "border-primary bg-primary text-primary-foreground shadow-md"
                    : "border-border bg-card text-foreground hover:border-primary/50"
                }`}
              >
                {t(`plateType.${opt}`)}
              </button>
            ))}
          </div>

          <div className="flex justify-center px-4">
            <div className="w-full max-w-lg">
              <div
                className={`${LICENSE_PLATE_FRAME_CLASS} flex items-stretch overflow-hidden w-full transition-colors duration-200`}
                style={{ aspectRatio: "3.8/1" }}
              >
                {plateType === "civilian" && (
                  <>
                    <LicensePlateBlueStrip />
                    <div
                      className={`flex-1 min-w-0 flex items-center justify-center px-2 sm:px-5 ${bgMain}`}
                    >
                      <input
                        type="text"
                        value={licensePlate}
                        onChange={handleInputChange}
                        onBlur={handleLicensePlateBlur}
                        placeholder="12-345-67"
                        className={`w-full min-w-0 bg-transparent text-center text-2xl sm:text-4xl font-black outline-none ${text.main} ${text.placeholder} tracking-widest tabular-nums [text-shadow:0_2px_0_rgba(0,0,0,0.12),0_1px_0_rgba(255,255,255,0.08)]`}
                        style={mono}
                        dir="ltr"
                        inputMode="numeric"
                        autoFocus
                      />
                    </div>
                  </>
                )}

                {plateType === "military" && (
                  <div className={`flex-1 flex items-center justify-center px-2 sm:px-4 min-w-0 ${bgMain}`}>
                    <div className="flex items-center justify-center gap-1 sm:gap-2 w-full max-w-full" dir="ltr">
                      <input
                        type="text"
                        value={licensePlate}
                        onChange={handleInputChange}
                        onBlur={handleLicensePlateBlur}
                        placeholder="123456"
                        className={`min-w-0 flex-1 bg-transparent text-end text-2xl sm:text-4xl font-black outline-none ${text.main} ${text.placeholder} tracking-widest tabular-nums`}
                        style={mono}
                        inputMode="numeric"
                        autoFocus
                      />
                      <span
                        className={`shrink-0 text-2xl sm:text-4xl font-black text-white tabular-nums ${text.suffixShadow}`}
                        style={mono}
                      >
                        -{SUFFIX.military}
                      </span>
                    </div>
                  </div>
                )}

                {plateType === "police" && (
                  <>
                    <LicensePlateBlueStrip />
                    <div
                      className={`flex-1 min-w-0 flex items-center justify-center px-2 sm:px-4 ${bgMain}`}
                    >
                      <div className="flex items-center justify-center gap-1 sm:gap-2 w-full max-w-full" dir="ltr">
                        <input
                          type="text"
                          value={licensePlate}
                          onChange={handleInputChange}
                          onBlur={handleLicensePlateBlur}
                          placeholder="12-345"
                          className={`min-w-0 flex-1 bg-transparent text-end text-2xl sm:text-4xl font-black outline-none ${text.main} ${text.placeholder} tracking-widest tabular-nums`}
                          style={mono}
                          inputMode="numeric"
                          autoFocus
                        />
                        <span
                          className={`shrink-0 text-2xl sm:text-4xl font-black text-white tabular-nums ${text.suffixShadow}`}
                          style={mono}
                        >
                          -{SUFFIX.police}
                        </span>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Mileage input */}
          <div className="flex items-center gap-3 rounded-xl px-4 py-3 bg-muted/50">
            <label className="text-sm font-medium text-foreground shrink-0">
              {t("acceptedRequest.mileage")}
            </label>
            <input
              type="number"
              inputMode="numeric"
              value={mileage}
              onFocus={handleMileageFocus}
              onChange={handleMileageChange}
              placeholder="0"
              className="flex-1 min-w-0 text-center rounded-lg border border-border bg-input-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <span className="text-sm text-muted-foreground shrink-0">{t("acceptedRequest.km")}</span>
          </div>

          <button
            type="button"
            onClick={handleContinue}
            disabled={!licensePlate.trim() || !mileage.trim() || isSubmitting}
            className="w-full bg-primary hover:bg-secondary text-primary-foreground py-3 rounded-lg transition-colors duration-200 shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-primary"
          >
            {isSubmitting ? (
              <span className="inline-flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-primary-foreground/40 border-t-primary-foreground rounded-full animate-spin" />
                {t("common.loading")}
              </span>
            ) : (
              t("common.continue")
            )}
          </button>
        </div>
      </div>
    </div>

    {showMileagePopup && (
      <div className="fixed inset-0 z-[60] flex items-center justify-center">
        <div
          className="absolute inset-0 bg-black/60"
          onClick={() => setShowMileagePopup(false)}
        />
        <div
          role="alertdialog"
          aria-modal="true"
          className="relative bg-card rounded-2xl shadow-2xl p-8 w-full max-w-md mx-4 border border-border text-center"
        >
          <div className="flex justify-center mb-4">
            <TriangleAlert className="w-16 h-16 text-amber-500" strokeWidth={2} />
          </div>
          <h3 className="text-2xl font-bold text-foreground mb-3">
            {t("licensePlateModal.mileageAttentionTitle")}
          </h3>
          <div className="space-y-1 mb-6">
            <p className="text-foreground">
              {mileageWarningMessage}
            </p>
            <p className="text-foreground">
              {t("licensePlateModal.mileageVerifyHint")}
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              type="button"
              onClick={() => setShowMileagePopup(false)}
              className="flex-1 bg-primary hover:bg-secondary text-primary-foreground py-3 rounded-lg transition-colors duration-200 shadow-md hover:shadow-lg"
            >
              {t("licensePlateModal.updateMileage")}
            </button>
            <button
              type="button"
              onClick={handleProceedAnyway}
              disabled={isSubmitting}
              className="flex-1 border border-border bg-card hover:bg-muted text-foreground py-3 rounded-lg transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <span className="inline-flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-foreground/40 border-t-foreground rounded-full animate-spin" />
                  {t("common.loading")}
                </span>
              ) : (
                t("licensePlateModal.proceedAnyway")
              )}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
