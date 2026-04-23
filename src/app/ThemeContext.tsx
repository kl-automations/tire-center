import { createContext, useContext, useState, useEffect, useLayoutEffect, type ReactNode } from "react";
import i18n from "i18next";

type Theme = "light" | "dark";

/**
 * All languages supported by the app.
 * Must stay in sync with the `resources` map in `i18n.ts`.
 * The array is `as const` so `Language` can be derived as a union of literal codes.
 */
export const APP_LANGUAGES = [
  { code: "he" as const, label: "עברית" },
  { code: "ru" as const, label: "Русский" },
  { code: "ar" as const, label: "العربية" },
] as const;

/**
 * Union of valid language codes supported by the app.
 * Derived from `APP_LANGUAGES` so it stays in sync automatically.
 */
export type Language = (typeof APP_LANGUAGES)[number]["code"];

/**
 * Returns the BCP 47 locale string for the given app language.
 * Used to format dates with `Intl.DateTimeFormat` in a locale-appropriate way.
 *
 * @param language - The current app language from `useTheme()`.
 * @returns A BCP 47 locale string (e.g. `"he-IL"`, `"ru-RU"`, `"ar-SA"`).
 */
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

/**
 * Provides theme (light/dark) and language state to the entire app.
 *
 * Persists selections in `localStorage` so they survive page reloads.
 * Side effects:
 *  - Toggles the `dark` CSS class on `<html>` when the theme changes.
 *  - Sets `document.documentElement.dir` and `.lang` when the language changes.
 *  - Calls `i18n.changeLanguage()` to switch translations.
 *
 * Wrap the root of the app with this provider (done in `App.tsx`).
 */
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

/**
 * Hook that returns the current theme and language state plus setters.
 *
 * Must be called inside a component that is a descendant of `ThemeProvider`.
 *
 * @returns `{ theme, setTheme, toggleTheme, language, setLanguage, dir }`
 *
 * @example
 * const { theme, toggleTheme, language, setLanguage, dir } = useTheme();
 */
export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
