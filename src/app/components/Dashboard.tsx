import { useState } from "react";
import { useNavigation } from "../NavigationContext";
import { useTranslation } from "react-i18next";
import { FileText, FolderOpen, History, Menu } from "lucide-react";
import { LicensePlateModal } from "./LicensePlateModal";
import { ExportHistoryModal } from "./ExportHistoryModal";
import { getOpenRequestStatusCounts, hasOpenRequestUpdates } from "./OpenRequests";
import { SettingsMenu } from "./SettingsMenu";

export function Dashboard() {
  const { t } = useTranslation();
  const { navigate } = useNavigation();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isExportHistoryOpen, setIsExportHistoryOpen] = useState(false);
  const hasUnreadUpdates = hasOpenRequestUpdates();
  const openRequestCounts = getOpenRequestStatusCounts();

  const handleNewRequest = () => {
    setIsModalOpen(true);
  };

  const handleOpenRequests = () => {
    navigate({ name: "open-requests" });
  };

  return (
    <div className="size-full flex flex-col">
      {/* Header */}
      <header className="bg-primary text-primary-foreground px-6 py-4 shadow-md">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-12 h-12 rounded-full bg-white/20">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="24"
                height="24"
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
            <div>
              <h1 className="text-2xl">{t("dashboard.title")}</h1>
              <p className="text-sm text-primary-foreground/80">{t("dashboard.subtitle")}</p>
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
      <main className="flex-1 bg-background p-6 flex flex-col min-h-0">
        <div className="max-w-4xl mx-auto w-full flex flex-col flex-1">
          <h2 className="text-2xl text-foreground mb-8">{t("dashboard.chooseAction")}</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* New Request Button */}
            <button
              onClick={handleNewRequest}
              className="bg-card hover:bg-accent border border-border rounded-2xl p-8 shadow-lg hover:shadow-xl transition-all duration-200 group"
            >
              <div className="flex flex-col items-center text-center gap-4">
                <div className="w-16 h-16 rounded-full bg-primary flex items-center justify-center group-hover:scale-110 transition-transform">
                  <FileText className="w-8 h-8 text-primary-foreground" />
                </div>
                <div>
                  <h3 className="text-xl text-card-foreground mb-2">{t("dashboard.newRequest")}</h3>
                  <p className="text-sm text-muted-foreground">{t("dashboard.newRequestDesc")}</p>
                </div>
              </div>
            </button>

            {/* Open Requests Button with Notification */}
            <button
              onClick={handleOpenRequests}
              className="bg-card hover:bg-accent border border-border rounded-2xl p-8 shadow-lg hover:shadow-xl transition-all duration-200 group relative"
            >
              {hasUnreadUpdates && (
                <div className="absolute top-4 start-4 flex items-center gap-1">
                  <span className="relative flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
                  </span>
                </div>
              )}
              <div className="flex flex-col items-center text-center gap-4">
                <div className="w-16 h-16 rounded-full bg-secondary flex items-center justify-center group-hover:scale-110 transition-transform">
                  <FolderOpen className="w-8 h-8 text-secondary-foreground" />
                </div>
                <div className="w-full">
                  <h3 className="text-xl text-card-foreground mb-2">{t("dashboard.openRequests")}</h3>
                  <p className="text-sm text-muted-foreground">{t("dashboard.openRequestsDesc")}</p>
                  <div className="mt-4 grid grid-cols-3 gap-2 w-full max-w-xs mx-auto">
                    <div className="rounded-xl border-2 border-green-300 dark:border-green-700 bg-green-100 dark:bg-green-900/40 py-2 px-1 text-center">
                      <div className="text-lg font-bold tabular-nums leading-none text-green-800 dark:text-green-300">
                        {openRequestCounts.approved}
                      </div>
                      <div className="text-[10px] font-semibold mt-1 leading-tight text-green-800 dark:text-green-300">
                        {t("status.approved")}
                      </div>
                    </div>
                    <div className="rounded-xl border-2 border-amber-300 dark:border-amber-700 bg-amber-100 dark:bg-amber-900/40 py-2 px-1 text-center">
                      <div className="text-lg font-bold tabular-nums leading-none text-amber-800 dark:text-amber-300">
                        {openRequestCounts.waiting}
                      </div>
                      <div className="text-[10px] font-semibold mt-1 leading-tight text-amber-800 dark:text-amber-300">
                        {t("status.waiting")}
                      </div>
                    </div>
                    <div className="rounded-xl border-2 border-red-300 dark:border-red-700 bg-red-100 dark:bg-red-900/40 py-2 px-1 text-center">
                      <div className="text-lg font-bold tabular-nums leading-none text-red-800 dark:text-red-300">
                        {openRequestCounts.declined}
                      </div>
                      <div className="text-[10px] font-semibold mt-1 leading-tight text-red-800 dark:text-red-300">
                        {t("status.declined")}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </button>

          </div>

          <div className="mt-auto pt-12 flex justify-center">
            <button
              type="button"
              onClick={() => setIsExportHistoryOpen(true)}
              className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground border border-border/60 bg-muted/30 hover:bg-muted/50 rounded-full px-4 py-2 transition-colors"
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
  );
}