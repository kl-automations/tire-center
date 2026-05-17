import { useEffect, useState, type RefObject } from "react";

/**
 * Detects whether a pinned full-viewport layout's content exceeds the
 * available height. Defaults to `false` (fits) until the first measurement.
 */
export function useViewportFit(
  containerRef: RefObject<HTMLElement | null>,
  enabled = true,
): boolean {
  const [needsScroll, setNeedsScroll] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setNeedsScroll(false);
      return;
    }

    const container = containerRef.current;
    if (!container) return;

    let rafId = 0;

    const measure = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const el = containerRef.current;
        if (!el) return;

        const available = el.clientHeight;
        if (available <= 0) return;

        let contentHeight = 0;
        for (let i = 0; i < el.children.length; i++) {
          const child = el.children[i] as HTMLElement;
          contentHeight += child.scrollHeight;
        }

        setNeedsScroll(contentHeight > available + 1);
      });
    };

    measure();

    const ro = new ResizeObserver(measure);
    ro.observe(container);
    for (let i = 0; i < container.children.length; i++) {
      ro.observe(container.children[i]);
    }

    const mo = new MutationObserver(measure);
    mo.observe(container, { childList: true, subtree: true, attributes: true });

    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
    };
  }, [containerRef, enabled]);

  return needsScroll;
}
