import { useRef, useState } from "react";
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

export function CaroolCheck() {
  const { t } = useTranslation();
  const { screen, navigate } = useNavigation();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [wheelIndex, setWheelIndex] = useState(0);
  const [photoStep, setPhotoStep] = useState<PhotoStep>("sidewall");
  const [preview, setPreview] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);

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

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPreview(url);
    // Reset so the same step can be retaken
    e.target.value = "";
  };

  const handleTakePhoto = () => {
    fileInputRef.current?.click();
  };

  const handleRetake = () => {
    if (preview) { URL.revokeObjectURL(preview); setPreview(null); }
    fileInputRef.current?.click();
  };

  const handleApprove = () => {
    if (preview) { URL.revokeObjectURL(preview); setPreview(null); }

    if (photoStep === "sidewall") {
      setPhotoStep("tread");
    } else if (!isLastWheel) {
      setPhotoStep("sidewall");
      setWheelIndex((i) => i + 1);
    } else {
      setShowDone(true);
      setTimeout(() => navigate({ name: "accepted-request", plate, plateType }), 1500);
    }
  };

  const handleBack = () => {
    if (preview) {
      URL.revokeObjectURL(preview);
      setPreview(null);
    } else {
      navigate({ name: "accepted-request", plate, plateType });
    }
  };

  return (
    <div className="h-screen bg-background flex flex-col" style={{ height: "100dvh" }}>

      {/* Hidden native camera input — rear camera, environment facing */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Header */}
      <div className="bg-primary shrink-0">
        <div className="flex items-center justify-between px-4 py-3">
          <button onClick={handleBack} className="text-primary-foreground hover:opacity-75 transition-opacity p-1">
            <ArrowRight className="w-6 h-6" />
          </button>
          <div className="text-center">
            <p className="text-primary-foreground font-semibold text-sm leading-tight">{wheelLabel}</p>
            <p className="text-primary-foreground/70 text-xs mt-0.5">{stepLabel}</p>
          </div>
          <p className="text-primary-foreground/60 text-xs tabular-nums">{completedSteps + 1}/{totalSteps}</p>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col min-h-0">

        {/* PREVIEW state */}
        {preview ? (
          <>
            <div className="flex-1 min-h-0 bg-black flex items-center justify-center overflow-hidden">
              <img src={preview} alt="" className="w-full h-full object-contain" />
            </div>
            <div className="shrink-0 bg-background border-t border-border p-4 flex gap-3">
              <button
                onClick={handleRetake}
                className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-xl border-2 border-border text-foreground font-semibold text-base active:opacity-70 transition-opacity"
              >
                <RotateCcw className="w-5 h-5" />
                {t("caroolCheck.retake")}
              </button>
              <button
                onClick={handleApprove}
                className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-xl bg-primary text-primary-foreground font-semibold text-base active:opacity-70 transition-opacity"
              >
                <Check className="w-5 h-5" />
                {t("caroolCheck.approve")}
              </button>
            </div>
          </>
        ) : (

          /* CAPTURE state */
          <>
            {/* Mask guide */}
            <div className="flex-1 min-h-0 flex items-center justify-center bg-muted/30 p-8">
              {photoStep === "sidewall" ? (
                <ReferenceMask className="w-full max-w-[280px]" />
              ) : (
                <WearMask className="w-3/5 max-w-[200px]" />
              )}
            </div>

            {/* Progress + button */}
            <div className="shrink-0 bg-background border-t border-border px-4 pt-4 pb-8 space-y-4">
              {/* Progress dots */}
              <div className="flex justify-center items-center gap-2">
                {Array.from({ length: totalSteps }).map((_, i) => (
                  <div
                    key={i}
                    className={`rounded-full transition-all duration-200 ${
                      i < completedSteps
                        ? "w-2 h-2 bg-primary/50"
                        : i === completedSteps
                        ? "w-3 h-3 bg-primary"
                        : "w-2 h-2 bg-muted-foreground/30"
                    }`}
                  />
                ))}
              </div>
              <button
                onClick={handleTakePhoto}
                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground py-4 rounded-xl font-semibold text-base shadow-md transition-colors"
              >
                {t("caroolCheck.capture")}
              </button>
            </div>
          </>
        )}
      </div>

      {/* Done overlay */}
      {showDone && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-background/80 backdrop-blur-sm">
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
