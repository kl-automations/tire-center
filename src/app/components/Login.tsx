import { useEffect, useRef, useState } from "react";
import { useNavigation } from "../NavigationContext";
import { useTranslation } from "react-i18next";
import { Sun, Moon, Globe, ArrowLeft } from "lucide-react";
import { APP_LANGUAGES, type Language, useTheme } from "../ThemeContext";

/** Short labels for the language pill */
const LANG_ABBREV: Record<Language, string> = {
  he: "עב",
  ru: "РУ",
  ar: "عر",
};

type Step = "email" | "code";

export function Login() {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [emailError, setEmailError] = useState(false);
  const [codeError, setCodeError] = useState(false);
  const [langMenuOpen, setLangMenuOpen] = useState(false);
  const langMenuRef = useRef<HTMLDivElement>(null);
  const { navigate } = useNavigation();
  const { theme, toggleTheme, language, setLanguage } = useTheme();

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

  const handleEmailSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setEmailError(false);
    if (email === "roi.krn@gmail.com") {
      setEmailError(true);
      return;
    }
    // TODO: call ERP to validate email and trigger SMS code
    setStep("code");
  };

  const handleCodeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setCodeError(false);
    if (email === "memlamed2004@gmail.com") {
      setCodeError(true);
      return;
    }
    // TODO: call ERP to verify the code
    navigate({ name: "dashboard" });
  };

  const handleBackToEmail = () => {
    setStep("email");
    setCode("");
    setCodeError(false);
  };

  return (
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
            <span className="text-sm font-bold text-foreground tabular-nums">{LANG_ABBREV[language]}</span>
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
                    <span className="tabular-nums">{LANG_ABBREV[opt.code]}</span>
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
            {step === "email" ? t("login.subtitleEmail") : t("login.subtitleCode")}
          </p>
        </div>

        {/* Form Card */}
        <div className="bg-card rounded-2xl shadow-xl p-8 border border-border">
          {step === "email" ? (
            <form onSubmit={handleEmailSubmit} className="space-y-6">
              <div className="space-y-2">
                <label htmlFor="email" className="block text-card-foreground">
                  {t("login.emailLabel")}
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setEmailError(false);
                  }}
                  className={`w-full px-4 py-3 bg-input-background border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all ${
                    emailError ? "border-red-500" : "border-border"
                  }`}
                  placeholder={t("login.emailPlaceholder")}
                  required
                  autoComplete="email"
                />
                {emailError && (
                  <p className="text-red-500 text-sm mt-1">{t("login.emailError")}</p>
                )}
              </div>
              <button
                type="submit"
                className="w-full bg-primary hover:bg-secondary text-primary-foreground py-3 rounded-lg transition-colors duration-200 shadow-md hover:shadow-lg"
              >
                {t("login.submitEmail")}
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
                onClick={handleBackToEmail}
                className="w-full flex items-center justify-center gap-2 text-muted-foreground hover:text-foreground transition-colors text-sm"
              >
                <ArrowLeft className="w-4 h-4" />
                {t("login.backToEmail")}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
