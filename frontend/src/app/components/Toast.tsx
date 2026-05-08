import { useEffect, useState, useCallback } from "react";

interface ToastState {
  id: number;
  message: string;
}

/**
 * Lightweight RTL-safe toast manager with a single in-flight toast.
 *
 * `useToast()` returns a `showToast(message)` function plus the current
 * `<Toast />` element to render. The toast pins to the bottom-centre of
 * the viewport, fades in/out via Tailwind transitions, and auto-dismisses
 * after 2 seconds. No external library — keeps the bundle slim.
 */
export function useToast(): { showToast: (msg: string) => void; toast: React.ReactNode } {
  const [state, setState] = useState<ToastState | null>(null);

  useEffect(() => {
    if (!state) return;
    const id = window.setTimeout(() => setState(null), 2000);
    return () => window.clearTimeout(id);
  }, [state]);

  const showToast = useCallback((message: string) => {
    setState({ id: Date.now(), message });
  }, []);

  const toast = state ? (
    <div
      key={state.id}
      role="status"
      aria-live="polite"
      className="fixed bottom-8 inset-x-0 z-[80] flex justify-center pointer-events-none px-4"
    >
      <div className="bg-foreground text-background text-sm font-semibold px-4 py-2.5 rounded-full shadow-lg max-w-xs text-center">
        {state.message}
      </div>
    </div>
  ) : null;

  return { showToast, toast };
}
