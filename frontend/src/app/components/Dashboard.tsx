import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { FileText, FolderOpen, History, Menu } from "lucide-react";
import { LicensePlateModal } from "./LicensePlateModal";
import { ExportHistoryModal } from "./ExportHistoryModal";
import { useOrdersSummary } from "./OpenRequests";
import { SettingsMenu } from "./SettingsMenu";
import { usePhoneBackSync } from "../usePhoneBackSync";
import { useToast } from "./Toast";

/**
 * Main hub screen shown after a successful login.
 *
 * Provides four primary actions:
 *  - New service order (opens `LicensePlateModal`)
 *  - Open requests (navigates to `open-requests` with an update badge if new statuses exist)
 *  - Export history (opens `ExportHistoryModal`)
 *  - Settings (opens `SettingsMenu` overlay)
 *
 * Navigation: reached from `login` on success; navigates to `open-requests`,
 * `accepted-request`, or `declined-request` via child modals.
 */
export function Dashboard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isExportHistoryOpen, setIsExportHistoryOpen] = useState(false);
  const { counts: openRequestCounts, hasUnread: hasUnreadUpdates } = useOrdersSummary();
  const { showToast, toast } = useToast();
  const lastBackRef = useRef(0);

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

  return (
    <>
    <div className="size-full flex flex-col min-h-0">
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
              <h1 className="text-lg sm:text-2xl leading-tight truncate">{t("dashboard.title")}</h1>
              <p className="text-xs sm:text-sm text-primary-foreground/80 leading-snug truncate">
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
      <main className="flex-1 min-h-0 bg-background px-4 py-3 sm:p-6 flex flex-col">
        <div className="max-w-4xl mx-auto w-full flex flex-col flex-1 min-h-0 justify-between gap-2">
          <div className="min-h-0 flex flex-col gap-2 sm:gap-3 flex-1 overflow-y-auto overscroll-contain">
            <h2 className="text-lg sm:text-2xl text-foreground shrink-0 leading-tight">
              {t("dashboard.chooseAction")}
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4 min-h-0 flex-1 md:min-h-0 auto-rows-fr">
            {/* New Request Button */}
            <button
              onClick={handleNewRequest}
              className="bg-card hover:bg-accent border border-border rounded-2xl p-4 sm:p-6 md:p-8 shadow-md hover:shadow-lg transition-all duration-200 group min-h-0 flex flex-col"
            >
              <div className="flex flex-col items-center justify-center text-center gap-2 sm:gap-3 flex-1 min-h-0 py-1">
                <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-primary flex items-center justify-center group-hover:scale-105 transition-transform shrink-0">
                  <FileText className="w-7 h-7 sm:w-8 sm:h-8 text-primary-foreground" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-lg sm:text-xl text-card-foreground mb-1">{t("dashboard.newRequest")}</h3>
                  <p className="text-xs sm:text-sm text-muted-foreground leading-snug">{t("dashboard.newRequestDesc")}</p>
                </div>
              </div>
            </button>

            {/* Open Requests Button with Notification */}
            <button
              onClick={handleOpenRequests}
              className="bg-card hover:bg-accent border border-border rounded-2xl p-4 sm:p-6 md:p-8 shadow-md hover:shadow-lg transition-all duration-200 group relative min-h-0 flex flex-col"
            >
              {hasUnreadUpdates && (
                <div className="absolute top-3 start-3 sm:top-4 sm:start-4 flex items-center gap-1">
                  <span className="relative flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
                  </span>
                </div>
              )}
              <div className="flex flex-col items-center justify-center text-center gap-2 sm:gap-3 flex-1 min-h-0 w-full py-1">
                <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-secondary flex items-center justify-center group-hover:scale-105 transition-transform shrink-0">
                  <FolderOpen className="w-7 h-7 sm:w-8 sm:h-8 text-secondary-foreground" />
                </div>
                <div className="w-full min-w-0">
                  <h3 className="text-lg sm:text-xl text-card-foreground mb-1">{t("dashboard.openRequests")}</h3>
                  <p className="text-xs sm:text-sm text-muted-foreground leading-snug">{t("dashboard.openRequestsDesc")}</p>
                  <div className="mt-2 sm:mt-3 grid grid-cols-3 gap-1.5 sm:gap-2 w-full max-w-[11rem] sm:max-w-xs mx-auto">
                    <div className="rounded-lg sm:rounded-xl border-2 border-green-300 dark:border-green-700 bg-green-100 dark:bg-green-900/40 py-1.5 px-0.5 sm:py-2 sm:px-1 text-center">
                      <div className="text-base sm:text-lg font-bold tabular-nums leading-none text-green-800 dark:text-green-300">
                        {openRequestCounts.approved}
                      </div>
                      <div className="text-[9px] sm:text-[10px] font-semibold mt-0.5 sm:mt-1 leading-tight text-green-800 dark:text-green-300">
                        {t("status.approved")}
                      </div>
                    </div>
                    <div className="rounded-lg sm:rounded-xl border-2 border-amber-300 dark:border-amber-700 bg-amber-100 dark:bg-amber-900/40 py-1.5 px-0.5 sm:py-2 sm:px-1 text-center">
                      <div className="text-base sm:text-lg font-bold tabular-nums leading-none text-amber-800 dark:text-amber-300">
                        {openRequestCounts.waiting}
                      </div>
                      <div className="text-[9px] sm:text-[10px] font-semibold mt-0.5 sm:mt-1 leading-tight text-amber-800 dark:text-amber-300">
                        {t("status.waiting")}
                      </div>
                    </div>
                    <div className="rounded-lg sm:rounded-xl border-2 border-red-300 dark:border-red-700 bg-red-100 dark:bg-red-900/40 py-1.5 px-0.5 sm:py-2 sm:px-1 text-center">
                      <div className="text-base sm:text-lg font-bold tabular-nums leading-none text-red-800 dark:text-red-300">
                        {openRequestCounts.declined}
                      </div>
                      <div className="text-[9px] sm:text-[10px] font-semibold mt-0.5 sm:mt-1 leading-tight text-red-800 dark:text-red-300">
                        {t("status.declined")}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </button>

            </div>
          </div>

          <div className="flex justify-center shrink-0 pt-1 pb-0.5">
            <button
              type="button"
              onClick={() => setIsExportHistoryOpen(true)}
              className="inline-flex items-center gap-2 text-xs sm:text-sm text-muted-foreground hover:text-foreground border border-border/60 bg-muted/30 hover:bg-muted/50 rounded-full px-3 py-1.5 sm:px-4 sm:py-2 transition-colors"
            >
              <History className="w-4 h-4 opacity-80" aria-hidden />
              {t("dashboard.exportHistory")}
            </button>
          </div>
        </div>
      </main>

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