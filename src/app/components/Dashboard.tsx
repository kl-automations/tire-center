import { useState } from "react";
import { useNavigation } from "../NavigationContext";
import { useTranslation } from "react-i18next";
import { FileText, FolderOpen, History, Menu } from "lucide-react";
import { LicensePlateModal } from "./LicensePlateModal";
import { hasOpenRequestUpdates } from "./OpenRequests";
import { SettingsMenu } from "./SettingsMenu";

export function Dashboard() {
  const { t } = useTranslation();
  const { navigate } = useNavigation();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const hasUnreadUpdates = hasOpenRequestUpdates();

  const handleNewRequest = () => {
    setIsModalOpen(true);
  };

  const handleOpenRequests = () => {
    navigate({ name: "open-requests" });
  };

  const handleHistory = () => {
    navigate({ name: "history" });
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
      <main className="flex-1 bg-background p-6">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl text-foreground mb-8">{t("dashboard.chooseAction")}</h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
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
                <div>
                  <h3 className="text-xl text-card-foreground mb-2">{t("dashboard.openRequests")}</h3>
                  <p className="text-sm text-muted-foreground">{t("dashboard.openRequestsDesc")}</p>
                </div>
              </div>
            </button>

            {/* History Button */}
            <button
              onClick={handleHistory}
              className="bg-card hover:bg-accent border border-border rounded-2xl p-8 shadow-lg hover:shadow-xl transition-all duration-200 group"
            >
              <div className="flex flex-col items-center text-center gap-4">
                <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center group-hover:scale-110 transition-transform">
                  <History className="w-8 h-8 text-muted-foreground" />
                </div>
                <div>
                  <h3 className="text-xl text-card-foreground mb-2">{t("dashboard.history")}</h3>
                  <p className="text-sm text-muted-foreground">{t("dashboard.historyDesc")}</p>
                </div>
              </div>
            </button>
          </div>
        </div>
      </main>

      {/* License Plate Modal */}
      <LicensePlateModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />

      {/* Settings Menu */}
      <SettingsMenu isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
    </div>
  );
}