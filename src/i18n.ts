import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import he from "./locales/he.json";
import ru from "./locales/ru.json";
import ar from "./locales/ar.json";

i18n.use(initReactI18next).init({
  resources: {
    he: { translation: he },
    ru: { translation: ru },
    ar: { translation: ar },
  },
  lng: localStorage.getItem("language") || "he",
  fallbackLng: "he",
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
