import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { X, Sun, Moon, LogOut, User, Globe } from "lucide-react";
import { APP_LANGUAGES, useTheme } from "../ThemeContext";

interface SettingsMenuProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Slide-in settings overlay accessible from the Dashboard.
 *
 * Provides: theme toggle (light/dark), language switcher, current user code
 * display, and logout (clears `localStorage` and navigates to `login`).
 *
 * @param isOpen  - Controls overlay visibility.
 * @param onClose - Callback invoked when the overlay is dismissed.
 */
export function SettingsMenu({ isOpen, onClose }: SettingsMenuProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { theme, toggleTheme, language, setLanguage } = useTheme();

  const userCode = (() => {
    const token = localStorage.getItem("token");
    if (!token) return "—";
    try {
      const [, payload] = token.split(".");
      if (!payload) return "—";
      const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
      const { shop_id } = JSON.parse(atob(normalized)) as { shop_id?: string };
      return shop_id ?? "—";
    } catch {
      return "—";
    }
  })();

  const handleSignOut = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("userCode");
    // Clear any in-progress route caches so a stale session doesn't bleed
    // into the next mechanic's login.
    try {
      sessionStorage.clear();
    } catch {}
    onClose();
    navigate("/", { replace: true });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      <div className="absolute top-0 end-0 h-full w-full max-w-sm bg-card shadow-2xl border-s border-border flex flex-col animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground">{t("settings.title")}</h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {/* Account */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              <User className="w-4 h-4" />
              <span>{t("settings.account")}</span>
            </div>
            <div className="bg-background rounded-xl p-4 border border-border">
              <p className="font-semibold text-foreground">{t("settings.connectedUser")}</p>
              <p className="text-sm text-muted-foreground">{userCode}</p>
            </div>
          </div>

          {/* Dark/Light Mode */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              {theme === "dark" ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
              <span>{t("settings.displayMode")}</span>
            </div>
            <div className="bg-background rounded-xl border border-border overflow-hidden">
              <button
                onClick={() => { toggleTheme(); }}
                className="w-full flex items-center justify-between px-4 py-3"
              >
                <span className="font-semibold text-foreground">
                  {theme === "dark" ? t("common.darkMode") : t("common.lightMode")}
                </span>
                <div
                  dir="ltr"
                  className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors duration-300 ${
                    theme === "dark" ? "bg-blue-500" : "bg-muted"
                  }`}
                >
                  <span
                    className={`inline-block h-6 w-6 rounded-full bg-white shadow-md transition-transform duration-300 ${
                      theme === "dark" ? "translate-x-[4px]" : "translate-x-[30px]"
                    }`}
                  />
                </div>
              </button>
            </div>
          </div>

          {/* Language */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              <Globe className="w-4 h-4" />
              <span>{t("settings.language")}</span>
            </div>
            <div className="bg-background rounded-xl border border-border overflow-hidden divide-y divide-border">
              {APP_LANGUAGES.map((opt) => (
                <button
                  key={opt.code}
                  onClick={() => setLanguage(opt.code)}
                  className={`w-full flex items-center justify-between px-4 py-3 transition-colors ${
                    language === opt.code
                      ? "bg-primary/10 dark:bg-blue-400/15"
                      : "hover:bg-muted"
                  }`}
                >
                  <span className={`font-semibold ${language === opt.code ? "text-primary dark:text-blue-400" : "text-foreground"}`}>
                    {opt.label}
                  </span>
                  {language === opt.code && (
                    <span className="w-2.5 h-2.5 rounded-full bg-primary dark:bg-blue-400" />
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Sign Out */}
        <div className="p-5 border-t border-border">
          <button
            onClick={handleSignOut}
            className="w-full flex items-center justify-center gap-2 bg-destructive hover:bg-destructive/90 text-destructive-foreground py-3 rounded-xl transition-colors duration-200 font-semibold"
          >
            <LogOut className="w-5 h-5" />
            {t("settings.signOut")}
          </button>
        </div>
      </div>
    </div>
  );
}
