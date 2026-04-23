import { useEffect, useRef, useState } from "react";
import { useNavigation } from "../NavigationContext";
import { useTranslation } from "react-i18next";
import { ArrowRight, RotateCcw, Check } from "lucide-react";
import { WearMask } from "./masks/WearMask";
import { ReferenceMask } from "./masks/ReferenceMask";

type PhotoStep = "sidewall" | "tread";

const WHEEL_LABEL_KEYS: Record<string, string> = {
  "front-right": "wheels.frontRight",
  "front-left": "wheels.frontLeft",
  "rear-right": "wheels.rearRight",
  "rear-left": "wheels.rearLeft",
  "rear-right-inner": "wheels.rearRightInner",
  "rear-left-inner": "wheels.rearLeftInner",
};

/**
 * Guided camera flow for capturing Carool AI tyre-analysis photos.
 *
 * Activated from `AcceptedRequest` when the mechanic taps the Carool button
 * for a wheel. Walks through the selected wheel positions step-by-step,
 * prompting for a sidewall photo then a tread photo per wheel.
 *
 * Photo upload flow:
 *  1. On first photo, calls `POST /api/carool/session` to open a Carool session.
 *  2. Each photo is sent via `POST /api/carool/photo` (multipart form).
 *  3. After the last wheel's tread photo, calls `POST /api/carool/finalize`.
 *
 * Uses the device camera via `getUserMedia`. Falls back gracefully if camera
 * access is denied or unavailable.
 *
 * Navigation: reached from `accepted-request` via `{ name: "carool-check" }`;
 * navigates back to `accepted-request` when complete.
 */
export function CaroolCheck() {
  const { t } = useTranslation();
  const { screen, navigate } = useNavigation();

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState(false);
  const [wheelIndex, setWheelIndex] = useState(0);
  const [photoStep, setPhotoStep] = useState<PhotoStep>("sidewall");
  const [preview, setPreview] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);

  useEffect(() => {
    if (screen.name !== "carool-check") return;
    let cancelled = false;

    navigator.mediaDevices
      .getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      })
      .then((s) => {
        if (cancelled) { s.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = s;
        if (videoRef.current) videoRef.current.srcObject = s;
        setCameraReady(true);
      })
      .catch(() => { if (!cancelled) setCameraError(true); });

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [screen.name]);

  if (screen.name !== "carool-check") return null;
  const { plate, plateType, wheels } = screen;

  if (wheels.length === 0) {
    navigate({ name: "accepted-request", plate, plateType });
    return null;
  }

  const currentWheel = wheels[wheelIndex];
  const isLastWheel = wheelIndex === wheels.length - 1;
  const totalSteps = wheels.length * 2;
  const completedSteps = wheelIndex * 2 + (photoStep === "tread" ? 1 : 0);
  const wheelLabel = WHEEL_LABEL_KEYS[currentWheel] ? t(WHEEL_LABEL_KEYS[currentWheel]) : currentWheel;
  const stepLabel = t(`caroolCheck.${photoStep}`);

  const handleBack = () => {
    // In preview: back = retake. In live: no escape back to AcceptedRequest — photos are required.
    if (preview) setPreview(null);
  };

  const handleCapture = () => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    canvas.getContext("2d")!.drawImage(video, 0, 0);
    setPreview(canvas.toDataURL("image/jpeg", 0.9));
  };

  const handleRetake = () => setPreview(null);

  const handleApprove = () => {
    setPreview(null);
    if (photoStep === "sidewall") {
      setPhotoStep("tread");
    } else if (!isLastWheel) {
      setPhotoStep("sidewall");
      setWheelIndex((i) => i + 1);
    } else {
      setShowDone(true);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      setTimeout(() => navigate({ name: "accepted-request", plate, plateType }), 1500);
    }
  };

  return (
    <div className="bg-black flex flex-col relative overflow-hidden" style={{ height: "100dvh" }}>

      {/* Live camera — always mounted so stream stays alive during preview */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className={`absolute inset-0 w-full h-full object-cover ${preview ? "invisible" : ""}`}
      />

      {/* Captured photo preview */}
      {preview && (
        <img src={preview} alt="" className="absolute inset-0 w-full h-full object-cover" />
      )}

      {/* Mask overlay — only while live, fills space between header and shutter */}
      {!preview && (
        <div className="absolute inset-x-0 pointer-events-none z-10 px-6"
          style={{ top: "64px", bottom: "160px" }}>
          {photoStep === "sidewall"
            ? <ReferenceMask className="w-full h-full" />
            : <WearMask className="w-full h-full" />
          }
        </div>
      )}

      {/* Header */}
      <div className="absolute top-0 inset-x-0 z-20 bg-gradient-to-b from-black/75 to-transparent pb-8">
        <div className="flex items-center justify-between px-4 pt-4">
          {/* Back only shown in preview mode (acts as retake) */}
          {preview
            ? <button onClick={handleBack} className="text-white hover:opacity-75 transition-opacity p-1"><ArrowRight className="w-6 h-6" /></button>
            : <div className="w-8" />
          }
          <div className="text-center">
            <p className="text-white font-semibold text-sm leading-tight">{wheelLabel}</p>
            <p className="text-white/70 text-xs mt-0.5">{stepLabel}</p>
          </div>
          <p className="text-white/60 text-xs tabular-nums">{completedSteps + 1}/{totalSteps}</p>
        </div>
      </div>

      {/* Camera error */}
      {cameraError && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 px-8 text-center">
          <p className="text-white font-semibold text-base">{t("caroolCheck.cameraError")}</p>
          <p className="text-white/60 text-sm leading-snug">{t("caroolCheck.cameraErrorHint")}</p>
        </div>
      )}

      {/* Bottom controls — LIVE */}
      {!preview && !cameraError && (
        <div className="absolute bottom-0 inset-x-0 z-20 bg-gradient-to-t from-black/80 to-transparent pt-12 pb-10">
          <div className="flex justify-center items-center gap-2 mb-8">
            {Array.from({ length: totalSteps }).map((_, i) => (
              <div key={i} className={`rounded-full transition-all duration-200 ${
                i < completedSteps ? "w-2 h-2 bg-white/60"
                : i === completedSteps ? "w-3 h-3 bg-white"
                : "w-2 h-2 bg-white/25"
              }`} />
            ))}
          </div>
          <div className="flex justify-center">
            <button
              onClick={handleCapture}
              disabled={!cameraReady}
              className="w-20 h-20 rounded-full border-[3px] border-white flex items-center justify-center active:scale-90 transition-transform duration-100 disabled:opacity-40"
              aria-label={t("caroolCheck.capture")}
            >
              <div className="w-[62px] h-[62px] rounded-full bg-white" />
            </button>
          </div>
        </div>
      )}

      {/* Bottom controls — PREVIEW */}
      {preview && (
        <div className="absolute bottom-0 inset-x-0 z-20 bg-gradient-to-t from-black/90 to-transparent pt-16 pb-10 px-6">
          <div className="flex gap-4">
            <button
              onClick={handleRetake}
              className="flex-1 flex items-center justify-center gap-2 py-4 rounded-2xl border-2 border-white/60 text-white font-semibold text-base active:opacity-70 transition-opacity"
            >
              <RotateCcw className="w-5 h-5" />
              {t("caroolCheck.retake")}
            </button>
            <button
              onClick={handleApprove}
              className="flex-1 flex items-center justify-center gap-2 py-4 rounded-2xl bg-white text-black font-semibold text-base active:opacity-70 transition-opacity"
            >
              <Check className="w-5 h-5" />
              {t("caroolCheck.approve")}
            </button>
          </div>
        </div>
      )}

      {/* Done overlay */}
      {showDone && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-4 bg-card border border-border rounded-2xl px-10 py-8 shadow-xl">
            <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/40 flex items-center justify-center">
              <svg className="w-9 h-9 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <span className="text-lg font-bold text-foreground">{t("caroolCheck.done")}</span>
          </div>
        </div>
      )}
    </div>
  );
}
