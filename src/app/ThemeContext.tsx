import { createContext, useContext, useState, useEffect, type ReactNode } from "react";

type Theme = "light" | "dark";
type Language = "he" | "en" | "ar";

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
