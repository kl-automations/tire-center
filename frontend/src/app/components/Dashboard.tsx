import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { BarChart3, Boxes, Calculator, FileText, FolderOpen, History, Menu } from "lucide-react";
import { LicensePlateModal } from "./LicensePlateModal";
import { ExportHistoryModal } from "./ExportHistoryModal";
import { useOrdersSummary } from "./OpenRequests";
import { useStockAvailabilitySummary } from "./StockAvailability";
import { SettingsMenu } from "./SettingsMenu";
import { usePhoneBackSync } from "../usePhoneBackSync";
import { useViewportFit } from "../useViewportFit";
import { useToast } from "./Toast";

/**
 * Main hub after login: five dashboard tiles (new order, open requests, stock availability,
 * plus two phase‑2 placeholders), export history, and settings. Phase‑2 tiles are visual only.
 *
 * Navigation: from `login`; child flows go to order / open-request routes via modals and tiles.
 */
export function Dashboard() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isExportHistoryOpen, setIsExportHistoryOpen] = useState(false);
  const { hasUnread: hasUnreadUpdates } = useOrdersSummary();
  const { hasLiveRequests } = useStockAvailabilitySummary();
  const { showToast, toast } = useToast();
  const lastBackRef = useRef(0);
  const layoutRef = useRef<HTMLDivElement>(null);
  const needsScroll = useViewportFit(layoutRef);

  // Same root back pattern as Login — second press within 2s is `passthrough`
  // so Android can exit the installed PWA. Confirm on device.
  usePhoneBackSync({
    onBack: () => {
      if (Date.now() - lastBackRef.current < 2000) return "passthrough";
      lastBackRef.current = Date.now();
      showToast(t("common.pressAgainToExit"));
      return true;
    },
  });

  const handleNewRequest = () => {
    setIsModalOpen(true);
  };

  const handleOpenRequests = () => {
    navigate("/open-requests");
  };

  const handleStockAvailability = () => {
    navigate("/stock-availability");
  };

  const language = i18n.language?.split("-")[0] ?? "he";
  const tileDirection = language === "he" || language === "ar" ? "rtl" : "ltr";

  return (
    <>
    <div
      ref={layoutRef}
      className={`h-screen bg-background flex flex-col min-h-0 ${needsScroll ? "overflow-y-auto" : "overflow-hidden"}`}
      style={{ height: "100dvh" }}
    >
      {/* Header */}
      <header className="bg-primary text-primary-foreground px-4 py-3 sm:px-6 sm:py-4 shadow-md shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <div className="flex shrink-0 items-center justify-center w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-white/20">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <circle cx="12" cy="12" r="6" />
                <circle cx="12" cy="12" r="2" />
              </svg>
            </div>
            <div className="min-w-0">
              <h1 className="text-2xl sm:text-2xl leading-tight truncate">{t("dashboard.title")}</h1>
              <p className="text-sm sm:text-sm text-primary-foreground/80 leading-snug truncate">
                {t("dashboard.subtitle")}
              </p>
            </div>
          </div>
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="flex items-center justify-center w-10 h-10 rounded-full bg-white/20 hover:bg-white/30 transition-colors"
          >
            <Menu className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main
        className={`flex-1 min-h-0 bg-background px-4 py-3 sm:p-6 flex flex-col ${
          needsScroll ? "overflow-y-auto overscroll-contain" : "overflow-hidden"
        }`}
      >
        <div className="max-w-4xl mx-auto w-full flex flex-col flex-1 min-h-0">
          <div
            className={`grid grid-cols-1 md:grid-cols-2 gap-2 sm:gap-4 min-h-0 flex-1 ${
              needsScroll ? "" : "auto-rows-fr"
            }`}
          >
              <button
                type="button"
                onClick={handleNewRequest}
                className="bg-card hover:bg-accent border border-border rounded-2xl p-2.5 sm:p-6 shadow-md hover:shadow-lg transition-all duration-200 group min-h-[96px] sm:min-h-0 flex flex-col"
              >
                <div
                  dir={tileDirection}
                  className="flex flex-row items-center justify-start text-start gap-2 sm:gap-4 flex-1 min-h-0 py-0.5 sm:py-1"
                >
                  <div className="w-10 h-10 sm:w-16 sm:h-16 rounded-full bg-primary flex items-center justify-center group-hover:scale-105 transition-transform shrink-0">
                    <FileText className="w-5 h-5 sm:w-8 sm:h-8 text-primary-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-xl sm:text-xl text-card-foreground mb-0.5 sm:mb-1 leading-tight">
                      {t("dashboard.newRequest")}
                    </h3>
                    <p className="text-base sm:text-sm text-muted-foreground leading-snug">{t("dashboard.newRequestDesc")}</p>
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={handleOpenRequests}
                className="bg-card hover:bg-accent border border-border rounded-2xl p-2.5 sm:p-6 shadow-md hover:shadow-lg transition-all duration-200 group relative min-h-[96px] sm:min-h-0 flex flex-col"
              >
                {hasUnreadUpdates && (
                  <div className="absolute top-3 start-3 sm:top-4 sm:start-4 flex items-center gap-1">
                    <span className="relative flex h-3 w-3">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
                    </span>
                  </div>
                )}
                <div
                  dir={tileDirection}
                  className="flex flex-row items-center justify-start text-start gap-2 sm:gap-4 flex-1 min-h-0 w-full py-0.5 sm:py-1"
                >
                  <div className="w-10 h-10 sm:w-16 sm:h-16 rounded-full bg-secondary flex items-center justify-center group-hover:scale-105 transition-transform shrink-0">
                    <FolderOpen className="w-5 h-5 sm:w-8 sm:h-8 text-secondary-foreground" />
                  </div>
                  <div className="w-full min-w-0 flex-1">
                    <h3 className="text-xl sm:text-xl text-card-foreground mb-0.5 sm:mb-1 leading-tight">
                      {t("dashboard.openRequests")}
                    </h3>
                    <p className="text-base sm:text-sm text-muted-foreground leading-snug">{t("dashboard.openRequestsDesc")}</p>
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={handleStockAvailability}
                className="bg-card hover:bg-accent border border-border rounded-2xl p-2.5 sm:p-6 shadow-md hover:shadow-lg transition-all duration-200 group relative min-h-[96px] sm:min-h-0 flex flex-col"
              >
                {hasLiveRequests && (
                  <span
                    className="absolute top-3 start-3 sm:top-4 sm:start-4 h-3 w-3 rounded-full bg-red-500"
                    aria-hidden
                  />
                )}
                <div
                  dir={tileDirection}
                  className="flex flex-row items-center justify-start text-start gap-2 sm:gap-4 flex-1 min-h-0 py-0.5 sm:py-1"
                >
                  <div className="w-10 h-10 sm:w-16 sm:h-16 rounded-full bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center transition-transform shrink-0">
                    <Boxes className="w-5 h-5 sm:w-8 sm:h-8 text-indigo-700 dark:text-indigo-300" />
                  </div>
                  <div className="w-full min-w-0 flex-1">
                    <h3 className="text-xl sm:text-xl text-card-foreground mb-0.5 sm:mb-1 leading-tight">
                      {t("dashboard.stockAvailability")}
                    </h3>
                    <p className="text-base sm:text-sm text-muted-foreground leading-snug">{t("dashboard.stockAvailabilityDesc")}</p>
                  </div>
                </div>
              </button>

              <div className="relative rounded-2xl min-h-[96px] sm:min-h-0 opacity-60 pointer-events-none select-none">
                <span className="absolute top-2 end-2 z-10 rounded-full bg-muted px-2 py-0.5 text-[10px] sm:text-xs font-semibold text-muted-foreground border border-border">
                  {t("common.comingSoon")}
                </span>
                <div className="bg-card border border-border rounded-2xl p-2.5 sm:p-6 shadow-md h-full flex flex-col">
                  <div
                    dir={tileDirection}
                    className="flex flex-row items-center justify-start text-start gap-2 sm:gap-4 flex-1 min-h-0 py-0.5 sm:py-1"
                  >
                    <div className="w-10 h-10 sm:w-16 sm:h-16 rounded-full bg-violet-100 dark:bg-violet-900/40 flex items-center justify-center shrink-0">
                      <BarChart3 className="w-5 h-5 sm:w-8 sm:h-8 text-violet-700 dark:text-violet-300" />
                    </div>
                    <div className="w-full min-w-0 flex-1">
                      <h3 className="text-xl sm:text-xl text-card-foreground mb-0.5 sm:mb-1 leading-tight">{t("dashboard.demandData")}</h3>
                      <p className="text-base sm:text-sm text-muted-foreground leading-snug">{t("dashboard.demandDataDesc")}</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="relative rounded-2xl min-h-[96px] sm:min-h-0 opacity-60 pointer-events-none select-none">
                <span className="absolute top-2 end-2 z-10 rounded-full bg-muted px-2 py-0.5 text-[10px] sm:text-xs font-semibold text-muted-foreground border border-border">
                  {t("common.comingSoon")}
                </span>
                <div className="bg-card border border-border rounded-2xl p-2.5 sm:p-6 shadow-md h-full flex flex-col">
                  <div
                    dir={tileDirection}
                    className="flex flex-row items-center justify-start text-start gap-2 sm:gap-4 flex-1 min-h-0 py-0.5 sm:py-1"
                  >
                    <div className="w-10 h-10 sm:w-16 sm:h-16 rounded-full bg-cyan-100 dark:bg-cyan-900/40 flex items-center justify-center shrink-0">
                      <Calculator className="w-5 h-5 sm:w-8 sm:h-8 text-cyan-700 dark:text-cyan-300" />
                    </div>
                    <div className="w-full min-w-0 flex-1">
                      <h3 className="text-xl sm:text-xl text-card-foreground mb-0.5 sm:mb-1 leading-tight">
                        {t("dashboard.monthlyReconciliation")}
                      </h3>
                      <p className="text-base sm:text-sm text-muted-foreground leading-snug">{t("dashboard.monthlyReconciliationDesc")}</p>
                    </div>
                  </div>
                </div>
              </div>
          </div>
        </div>
      </main>

      <footer className="shrink-0 bg-background px-4 pt-1 pb-3 sm:px-6 sm:pb-4">
        <div className="max-w-4xl mx-auto flex justify-center">
          <div className="relative">
            <span className="absolute -top-2.5 -end-2 z-10 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground border border-border">
              {t("common.comingSoon")}
            </span>
            <button
              type="button"
              disabled
              className="inline-flex items-center gap-2 text-xs sm:text-sm text-muted-foreground border border-border/60 bg-muted/30 rounded-full px-3 py-1.5 sm:px-4 sm:py-2 opacity-60 cursor-not-allowed"
            >
              <History className="w-4 h-4 opacity-80" aria-hidden />
              {t("dashboard.exportHistory")}
            </button>
          </div>
        </div>
      </footer>

      {/* License Plate Modal */}
      <LicensePlateModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />

      {/* Settings Menu */}
      <SettingsMenu isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />

      <ExportHistoryModal
        isOpen={isExportHistoryOpen}
        onClose={() => setIsExportHistoryOpen(false)}
      />
    </div>
    {toast}
    </>
  );
}
