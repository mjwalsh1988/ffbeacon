"use client";

/**
 * Skip-confirmation dialog. Skipping ends the round with no score and resets
 * the Signal Streak, and nothing server-side asks twice, so the confirmation
 * has to happen here or a misclick silently costs the player their streak.
 *
 * Built on SlideUpDialog, which already gives the house modal behavior this
 * needs with no per-caller work: slides up from the bottom on mobile, centers
 * on desktop.
 *
 * Mirrors burn-confirm-dialog.tsx, the game's other destructive confirmation,
 * including its focus rule: SlideUpDialog auto-focuses the FIRST focusable
 * element inside its sheet content, so "Keep scouting" is rendered before
 * "Skip this round" in the DOM specifically so the safe, non-destructive
 * choice receives initial focus. Do not reorder these two buttons.
 */

import { OctagonX } from "lucide-react";
import { SlideUpDialog } from "@/components/slide-up-dialog";

export interface SkipConfirmDialogProps {
  open: boolean;
  pending: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function SkipConfirmDialog({ open, pending, onConfirm, onClose }: SkipConfirmDialogProps) {
  return (
    <SlideUpDialog open={open} onClose={onClose} label="Confirm skipping this round">
      <div className="p-5 sm:p-6">
        <h3 className="text-lg font-semibold tracking-tight text-ink">Skip this round?</h3>
        <p className="mt-2 text-sm text-ink-muted">
          The round ends right here. The player is revealed, you bank no points, and your Signal
          Streak resets to zero.
        </p>
        <div className="mt-4 flex items-start gap-2 rounded-card border border-signal-danger/40 bg-signal-danger/10 px-3 py-2.5 text-sm text-signal-danger">
          <OctagonX aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
          <span>This cannot be undone.</span>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-11 flex-1 items-center justify-center rounded-card border border-line bg-surface px-5 py-3 text-sm font-medium text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            Keep scouting
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            aria-busy={pending}
            className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-card bg-signal-danger px-5 py-3 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:cursor-wait disabled:opacity-60"
          >
            {pending ? "Skipping..." : "Skip this round"}
          </button>
        </div>
      </div>
    </SlideUpDialog>
  );
}
