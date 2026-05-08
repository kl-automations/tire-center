import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";

/**
 * Mirrors MemoryRouter navigation onto the browser history so that the
 * Android/iOS system back button fires popstate. Visible URL never changes.
 *
 * onBack: return true to intercept (block default back navigation),
 *         false/undefined to let it proceed.
 */
export function usePhoneBackSync(onBack?: (e: PopStateEvent) => boolean | void) {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    history.pushState({ k: location.key }, "", window.location.pathname);
  }, [location.key]);

  useEffect(() => {
    const handler = (e: PopStateEvent) => {
      if (onBack?.(e)) {
        history.pushState({ k: location.key }, "", window.location.pathname);
        return;
      }
      navigate(-1);
    };
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, [onBack, navigate, location.key]);
}
