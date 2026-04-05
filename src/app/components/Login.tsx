import { useState } from "react";
import { useNavigate } from "react-router";
import { Sun, Moon, Globe } from "lucide-react";
import { useTheme } from "../ThemeContext";

const LANG_LABELS: Record<string, string> = { he: "עב", en: "EN", ar: "عر" };
const LANG_ORDER = ["he", "en", "ar"] as const;

export function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const navigate = useNavigate();
  const { theme, toggleTheme, language, setLanguage } = useTheme();

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    console.log("Login attempt:", { username, password });
    navigate("/dashboard");
  };

  const cycleLanguage = () => {
    const idx = LANG_ORDER.indexOf(language);
    setLanguage(LANG_ORDER[(idx + 1) % LANG_ORDER.length]);
  };

  return (
    <div className="size-full flex items-center justify-center relative" dir="rtl">
      {/* Top bar controls */}
      <div className="absolute top-4 left-4 flex items-center gap-2">
        <button
          onClick={toggleTheme}
          className="flex items-center justify-center w-10 h-10 rounded-full bg-card border border-border shadow-sm hover:bg-muted transition-colors"
          title={theme === "dark" ? "מצב בהיר" : "מצב כהה"}
        >
          {theme === "dark" ? <Sun className="w-5 h-5 text-foreground" /> : <Moon className="w-5 h-5 text-foreground" />}
        </button>
        <button
          onClick={cycleLanguage}
          className="flex items-center justify-center gap-1 h-10 px-3 rounded-full bg-card border border-border shadow-sm hover:bg-muted transition-colors"
          title="שנה שפה"
        >
          <Globe className="w-4 h-4 text-foreground" />
          <span className="text-sm font-bold text-foreground">{LANG_LABELS[language]}</span>
        </button>
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
          <h1 className="text-3xl text-foreground mb-2">מרכז צמיגים</h1>
          <p className="text-muted-foreground">התחבר למערכת Kogol</p>
        </div>

        {/* Login Form Card */}
        <div className="bg-card rounded-2xl shadow-xl p-8 border border-border">
          <form onSubmit={handleLogin} className="space-y-6">
            {/* Username Field */}
            <div className="space-y-2">
              <label htmlFor="username" className="block text-card-foreground">
                שם משתמש
              </label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-4 py-3 bg-input-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                placeholder="הזן שם משתמש"
                required
              />
            </div>

            {/* Password Field */}
            <div className="space-y-2">
              <label htmlFor="password" className="block text-card-foreground">
                סיסמא
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 bg-input-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                placeholder="הזן סיסמא"
                required
              />
            </div>

            {/* Login Button */}
            <button
              type="submit"
              className="w-full bg-primary hover:bg-secondary text-primary-foreground py-3 rounded-lg transition-colors duration-200 shadow-md hover:shadow-lg"
            >
              התחבר
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
