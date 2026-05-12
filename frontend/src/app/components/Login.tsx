import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Sun, Moon, Globe, ArrowRight } from "lucide-react";
import { APP_LANGUAGES, type Language, useTheme } from "../ThemeContext";
import { usePhoneBackSync } from "../usePhoneBackSync";
import { useToast } from "./Toast";

type Step = "userCode" | "code";

/**
 * Two-step login screen for mechanics.
 *
 * Step 1: The mechanic enters their user code → calls `POST /api/auth/request-code`.
 * Step 2: The mechanic enters the OTP received via SMS → calls `POST /api/auth/verify`.
 * On success, the JWT is stored in `localStorage` and the app navigates to `dashboard`.
 *
 * Also renders the language selector and theme toggle (accessible before login).
 *
 * Navigation: entry point — navigates to `{ name: "dashboard" }` on success.
 */
export function Login() {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>("userCode");
  const [userCode, setUserCode] = useState("");
  const [code, setCode] = useState("");
  const [userCodeError, setUserCodeError] = useState(false);
  const [codeError, setCodeError] = useState(false);
  const [langMenuOpen, setLangMenuOpen] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState<number>(0);
  const [now, setNow] = useState<number>(Date.now());
  const langMenuRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { theme, toggleTheme, language, setLanguage } = useTheme();
  const { showToast, toast } = useToast();
  const lastBackRef = useRef(0);

  // Root screen back-press: first press shows a toast; second within 2s uses
  // `passthrough` so we do not call MemoryRouter `navigate(-1)` (a no-op on
  // the entry route) and the host can handle back (PWA exit on Android).
  // Verify on a real installed PWA — see usePhoneBackSync `PhoneBackResult`.
  usePhoneBackSync({
    onBack: () => {
      if (Date.now() - lastBackRef.current < 2000) return "passthrough";
      lastBackRef.current = Date.now();
      showToast(t("common.pressAgainToExit"));
      return true;
    },
  });

  useEffect(() => {
    if (cooldownUntil <= Date.now()) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [cooldownUntil]);

  useEffect(() => {
    if (!langMenuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (langMenuRef.current && !langMenuRef.current.contains(e.target as Node)) {
        setLangMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLangMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [langMenuOpen]);

  const handleUserCodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (Date.now() < cooldownUntil) return;
    setUserCodeError(false);
    try {
      const res = await fetch("/api/auth/request-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userCode }),
      });
      if (res.status === 400) {
        setUserCodeError(true);
        setCooldownUntil(Date.now() + 15000);
        return;
      }
      if (!res.ok) {
        setUserCodeError(true);
        setCooldownUntil(Date.now() + 15000);
        return;
      }
      setStep("code");
      setCooldownUntil(Date.now() + 15000);
    } catch {
      setUserCodeError(true);
      setCooldownUntil(Date.now() + 15000);
    }
  };

  const handleCodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCodeError(false);
    try {
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userCode, otp: code }),
      });
      if (res.status === 401) {
        setCodeError(true);
        return;
      }
      if (!res.ok) {
        setCodeError(true);
        return;
      }
      const data: { token: string } = await res.json();
      localStorage.setItem("token", data.token);
      navigate("/dashboard", { replace: true });
    } catch {
      setCodeError(true);
    }
  };

  const handleBackToUserCode = () => {
    setStep("userCode");
    setCode("");
    setCodeError(false);
  };

  const cooldownActive = Date.now() < cooldownUntil;
  const cooldownSeconds = Math.ceil((cooldownUntil - now) / 1000);

  return (
    <>
    <div className="min-h-screen flex items-center justify-center relative">
      {/* Top bar controls */}
      <div className="absolute top-4 start-4 flex items-center gap-2">
        <button
          onClick={toggleTheme}
          className="flex items-center justify-center w-10 h-10 rounded-full bg-card border border-border shadow-sm hover:bg-muted transition-colors"
          title={theme === "dark" ? t("common.lightMode") : t("common.darkMode")}
        >
          {theme === "dark" ? <Sun className="w-5 h-5 text-foreground" /> : <Moon className="w-5 h-5 text-foreground" />}
        </button>
        <div className="relative" ref={langMenuRef}>
          <button
            type="button"
            onClick={() => setLangMenuOpen((o) => !o)}
            className="flex items-center justify-center gap-1 h-10 px-3 rounded-full bg-card border border-border shadow-sm hover:bg-muted transition-colors"
            title={t("login.changeLanguage")}
            aria-label={t("login.changeLanguage")}
            aria-expanded={langMenuOpen}
            aria-haspopup="listbox"
          >
            <Globe className="w-4 h-4 text-foreground" aria-hidden />
            <span className="text-sm font-bold text-foreground tabular-nums">{t(`login.langAbbrev.${language}`)}</span>
          </button>
          {langMenuOpen && (
            <ul
              role="listbox"
              className="absolute top-full start-0 mt-1 z-50 flex flex-col gap-1 p-1 rounded-2xl bg-card border border-border shadow-lg min-w-full"
              aria-label={t("login.changeLanguage")}
            >
              {APP_LANGUAGES.map((opt) => (
                <li key={opt.code} role="none">
                  <button
                    type="button"
                    role="option"
                    aria-selected={language === opt.code}
                    onClick={() => {
                      setLanguage(opt.code);
                      setLangMenuOpen(false);
                    }}
                    className={`flex w-full items-center justify-center gap-1 h-10 px-3 rounded-full text-sm font-bold transition-colors border ${
                      language === opt.code
                        ? "bg-muted border-primary/40 text-foreground"
                        : "border-transparent hover:bg-muted text-foreground"
                    }`}
                  >
                    <Globe className="w-4 h-4 shrink-0 opacity-90" aria-hidden />
                    <span className="tabular-nums">{t(`login.langAbbrev.${opt.code}`)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="w-full max-w-md px-6">
        {/* Logo/Header Section */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-primary mb-4">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="48"
              height="48"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <circle cx="12" cy="12" r="6" />
              <circle cx="12" cy="12" r="2" />
            </svg>
          </div>
          <h1 className="text-3xl text-foreground mb-2">{t("login.title")}</h1>
          <p className="text-muted-foreground">
            {step === "userCode" ? t("login.subtitleUserCode") : t("login.subtitleCode")}
          </p>
        </div>

        {/* Form Card */}
        <div className="bg-card rounded-2xl shadow-xl p-8 border border-border">
          {step === "userCode" ? (
            <form onSubmit={handleUserCodeSubmit} className="space-y-6">
              <div className="space-y-2">
                <label htmlFor="userCode" className="block text-card-foreground">
                  {t("login.userCodeLabel")}
                </label>
                <input
                  id="userCode"
                  type="text"
                  value={userCode}
                  onChange={(e) => {
                    setUserCode(e.target.value);
                    setUserCodeError(false);
                    setCooldownUntil(0);
                  }}
                  className={`w-full px-4 py-3 bg-input-background border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all ${
                    userCodeError ? "border-red-500" : "border-border"
                  }`}
                  placeholder={t("login.userCodePlaceholder")}
                  required
                  autoComplete="username"
                  autoCapitalize="characters"
                />
                {userCodeError && (
                  <p className="text-red-500 text-sm mt-1">{t("login.userCodeError")}</p>
                )}
              </div>
              <button
                type="submit"
                disabled={cooldownActive}
                className="w-full bg-primary hover:bg-secondary text-primary-foreground py-3 rounded-lg transition-colors duration-200 shadow-md hover:shadow-lg"
              >
                {cooldownActive ? `${cooldownSeconds}s` : t("login.submitUserCode")}
              </button>
            </form>
          ) : (
            <form onSubmit={handleCodeSubmit} className="space-y-6">
              <div className="space-y-2">
                <label htmlFor="code" className="block text-card-foreground">
                  {t("login.codeLabel")}
                </label>
                <input
                  id="code"
                  type="text"
                  inputMode="numeric"
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value);
                    setCodeError(false);
                  }}
                  className={`w-full px-4 py-3 bg-input-background border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all tracking-widest text-center text-lg ${
                    codeError ? "border-red-500" : "border-border"
                  }`}
                  placeholder={t("login.codePlaceholder")}
                  required
                  autoComplete="one-time-code"
                />
                {codeError && (
                  <p className="text-red-500 text-sm mt-1">{t("login.codeError")}</p>
                )}
              </div>
              <button
                type="submit"
                className="w-full bg-primary hover:bg-secondary text-primary-foreground py-3 rounded-lg transition-colors duration-200 shadow-md hover:shadow-lg"
              >
                {t("login.submitCode")}
              </button>
              <button
                type="button"
                onClick={handleBackToUserCode}
                className="w-full flex items-center justify-center gap-2 text-muted-foreground hover:text-foreground transition-colors text-sm"
              >
                <ArrowRight className="w-4 h-4 ltr:rotate-180" />
                {t("login.backToUserCode")}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
    {toast}
    </>
  );
}
