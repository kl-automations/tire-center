import { createContext, useContext, useState, useEffect, useLayoutEffect, type ReactNode } from "react";
import i18n from "i18next";

type Theme = "light" | "dark";

/** Must match `resources` in `i18n.ts` */
export const APP_LANGUAGES = [
  { code: "he" as const, label: "עברית" },
  { code: "ru" as const, label: "Русский" },
  { code: "ar" as const, label: "العربية" },
] as const;

export type Language = (typeof APP_LANGUAGES)[number]["code"];

/** BCP 47 locale for Date formatting — matches app language from ThemeContext */
export function getDateLocaleForLanguage(language: Language): string {
  switch (language) {
    case "he":
      return "he-IL";
    case "ru":
      return "ru-RU";
    case "ar":
      return "ar-SA";
    default:
      return "he-IL";
  }
}

interface ThemeContextValue {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
  language: Language;
  setLanguage: (l: Language) => void;
  dir: "rtl" | "ltr";
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function getStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem("theme");
    if (stored === "dark" || stored === "light") return stored;
  } catch {}
  return "light";
}

function getStoredLanguage(): Language {
  try {
    const stored = localStorage.getItem("language");
    if (stored === "he" || stored === "ru" || stored === "ar") return stored;
    if (stored === "en") return "he";
  } catch {}
  return "he";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(getStoredTheme);
  const [language, setLanguageState] = useState<Language>(getStoredLanguage);

  const setTheme = (t: Theme) => {
    setThemeState(t);
    localStorage.setItem("theme", t);
  };

  const toggleTheme = () => {
    setTheme(theme === "light" ? "dark" : "light");
  };

  const setLanguage = (l: Language) => {
    setLanguageState(l);
    localStorage.setItem("language", l);
  };

  const dir = language === "ru" ? "ltr" : "rtl";

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
  }, [theme]);

  useLayoutEffect(() => {
    document.documentElement.dir = dir;
    document.documentElement.lang = language;
  }, [language, dir]);

  useEffect(() => {
    void i18n.changeLanguage(language);
  }, [language]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme, language, setLanguage, dir }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
