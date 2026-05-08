import { useEffect, useRef, useState } from "react";

/**
 * SessionStorage-backed state hook for "this screen's props".
 *
 * Each route caches the props it was navigated with under a stable key (e.g.
 * `route-order-{orderId}`) so a full page reload can rehydrate the screen
 * exactly where the mechanic left off. The hook returns the same `[value,
 * setValue]` shape as `useState`; every call to the setter is mirrored to
 * `sessionStorage` synchronously.
 *
 * - Returns `null` until the first hydrate (or `setValue` call) so consumers
 *   can distinguish "not loaded yet" from "explicitly empty".
 * - Reading is safe in private-mode/quota-exceeded browsers — both
 *   `getItem` and `setItem` are wrapped in try/catch.
 *
 * @param key   Storage key (e.g. `route-order-abc123`).
 * @param init  Initial value to seed the cache with on first mount when the
 *              key is empty. Optional — pass nothing on resume-from-reload
 *              and the hook returns `null` so the screen can refetch.
 */
export function useScreenCache<T>(
  key: string,
  init?: T,
): [T | null, (value: T) => void] {
  const [value, setValueState] = useState<T | null>(() => {
    try {
      const raw = sessionStorage.getItem(key);
      if (raw) return JSON.parse(raw) as T;
    } catch {}
    if (init !== undefined) {
      try { sessionStorage.setItem(key, JSON.stringify(init)); } catch {}
      return init;
    }
    return null;
  });

  // Track the last key we initialised with so a key change (rare — only on
  // re-navigation to a different :orderId) re-hydrates from storage instead
  // of leaking the previous order's state. `init` is intentionally omitted
  // from the dep list — re-running on every parent re-render would clobber
  // the live state with the now-stale initial value.
  const lastKeyRef = useRef(key);
  useEffect(() => {
    if (lastKeyRef.current === key) return;
    lastKeyRef.current = key;
    try {
      const raw = sessionStorage.getItem(key);
      setValueState(raw ? (JSON.parse(raw) as T) : null);
    } catch {
      setValueState(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const setValue = (next: T) => {
    try { sessionStorage.setItem(key, JSON.stringify(next)); } catch {}
    setValueState(next);
  };

  return [value, setValue];
}
