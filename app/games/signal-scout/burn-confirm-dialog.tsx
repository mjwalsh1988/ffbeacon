"use client";

/**
 * Burn-confirmation dialog (plan section 13, decision 10): the server
 * rejects a hint purchase whose cost meets or exceeds the current score with
 * burn_confirmation_required unless the request carries confirmBurn: true.
 * This sheet is the explicit confirmation step that produces that flag.
 *
 * Built on SlideUpDialog, whose auto-focus targets the FIRST focusable
 * element inside its own sheet content (its overlay close button lives
 * outside that scope, see components/slide-up-dialog.tsx). "Keep my signal"
 * is rendered before "Burn it and reveal the clue" in the DOM specifically
 * so the safe, non-destructive choice receives initial focus.
 */

import { Flame } from "lucide-react";
import { SlideUpDialog } from "@/components/slide-up-dialog";
import type { SignalTierKey } from "@/lib/signal-scout/scoring";
import { TIER_DISPLAY_NAMES } from "./clue-grid";

export interface BurnConfirmDialogProps {
  open: boolean;
  tier: SignalTierKey | null;
  cost: number;
  score: number;
  pending: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function BurnConfirmDialog({
  open,
  tier,
  cost,
  score,
  pending,
  onConfirm,
  onClose,
}: BurnConfirmDialogProps) {
  const tierName = tier ? TIER_DISPLAY_NAMES[tier] : "";

  return (
    <SlideUpDialog open={open} onClose={onClose} label="Confirm signal burnout">
      <div className="p-5 sm:p-6">
        <h3 className="text-lg font-semibold tracking-tight text-ink">Burn out your signal?</h3>
        <p className="mt-2 text-sm text-ink-muted">
          This {tierName} hint costs {cost} points and you only have {score}. Buying it will burn
          out your signal. You can still solve the round, but it cannot score and your Signal
          Streak will reset.
        </p>
        <div className="mt-4 flex items-start gap-2 rounded-card border border-signal-warning/40 bg-signal-warning/10 px-3 py-2.5 text-sm text-signal-warning">
          <Flame aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
          <span>No points can be earned after burnout.</span>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-11 flex-1 items-center justify-center rounded-card border border-line bg-surface px-5 py-3 text-sm font-medium text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            Keep my signal
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            aria-busy={pending}
            className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-card bg-signal-warning px-5 py-3 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:cursor-wait disabled:opacity-60"
          >
            {pending ? "Burning..." : "Burn it and reveal the clue"}
          </button>
        </div>
      </div>
    </SlideUpDialog>
  );
}
