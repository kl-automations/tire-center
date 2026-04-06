import { createContext, useContext, useState, useEffect, useLayoutEffect, type ReactNode } from "react";
import i18n from "i18next";

type Theme = "light" | "dark";
export type Language = "he" | "en" | "ar";

/** BCP 47 locale for Date formatting — matches app language from ThemeContext */
export function getDateLocaleForLanguage(language: Language): string {
  switch (language) {
    case "he":
      return "he-IL";
    case "en":
      return "en-US";
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
    if (stored === "he" || stored === "en" || stored === "ar") return stored;
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
    i18n.changeLanguage(l);
  };

  const dir = language === "en" ? "ltr" : "rtl";

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
