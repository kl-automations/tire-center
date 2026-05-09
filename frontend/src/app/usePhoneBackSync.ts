import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";

/** `true` = stay on screen (re-push history). `false` = not handled → MemoryRouter `navigate(-1)` / fallback. `"passthrough"` = do nothing so the host can handle back (e.g. Android PWA exit on Login/Dashboard). */
export type PhoneBackResult = boolean | "passthrough";

interface PhoneBackSyncOptions {
  /** Return `true` to consume the back press. */
  onBack?: (e: PopStateEvent) => PhoneBackResult | void;
  /**
   * Path to navigate to when `navigate(-1)` would be a no-op (MemoryRouter
   * at its initial entry — `location.key === "default"`). Without this,
   * system back on a freshly-reloaded screen does nothing.
   */
  fallback?: string;
}

export function usePhoneBackSync(opts?: PhoneBackSyncOptions) {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    history.pushState({ k: location.key }, "", window.location.pathname);
  }, [location.key]);

  useEffect(() => {
    const handler = (e: PopStateEvent) => {
      const decision = opts?.onBack?.(e);
      if (decision === true) {
        history.pushState({ k: location.key }, "", window.location.pathname);
        return;
      }
      if (decision === "passthrough") {
        return;
      }
      if (location.key === "default" && opts?.fallback) {
        navigate(opts.fallback, { replace: true });
        return;
      }
      navigate(-1);
    };
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, [opts, navigate, location.key]);
}
