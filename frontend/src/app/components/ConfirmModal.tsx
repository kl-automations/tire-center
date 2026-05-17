import { useRef } from "react";
import { useViewportFit } from "../useViewportFit";

interface ConfirmModalProps {
  open: boolean;
  title: string;
  subtitle?: string;
  primaryLabel: string;
  destructiveLabel: string;
  onPrimary: () => void;
  onDestructive: () => void;
}

/**
 * Full-screen overlay confirmation modal used as the discard-changes prompt
 * when the mechanic tries to leave a partly-filled diagnosis.
 *
 * Two-button layout: the primary button keeps the user on the screen,
 * the destructive button is the "leave and discard" action. RTL-safe and
 * themed via the same Tailwind tokens used elsewhere — no Radix Dialog
 * dependency.
 */
export function ConfirmModal({
  open,
  title,
  subtitle,
  primaryLabel,
  destructiveLabel,
  onPrimary,
  onDestructive,
}: ConfirmModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const needsScroll = useViewportFit(panelRef, open);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center px-4 overflow-y-auto">
      <div className="absolute inset-0 bg-black/50" onClick={onPrimary} />
      <div
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        className={`relative bg-card rounded-2xl shadow-2xl w-full max-w-sm border border-border p-6 text-center space-y-5 my-4 ${
          needsScroll ? "max-h-[calc(100dvh-2rem)] overflow-y-auto" : ""
        }`}
      >
        <div className="space-y-2">
          <h3 className="text-xl font-bold text-foreground leading-tight">{title}</h3>
          {subtitle && (
            <p className="text-base text-muted-foreground leading-snug">{subtitle}</p>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={onPrimary}
            className="w-full bg-primary hover:bg-primary/90 text-primary-foreground py-3 rounded-xl font-semibold transition-colors"
          >
            {primaryLabel}
          </button>
          <button
            type="button"
            onClick={onDestructive}
            className="w-full bg-card hover:bg-muted text-destructive border border-destructive/40 py-3 rounded-xl font-semibold transition-colors"
          >
            {destructiveLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
