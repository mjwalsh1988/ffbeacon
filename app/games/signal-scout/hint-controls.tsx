/**
 * Buy-a-hint controls: one button per paid signal tier (plan sections 7, 13,
 * 21). Presentational only. The API call and the burn-confirmation dialog
 * both live in signal-scout-client.tsx; this component only reports which
 * tier was clicked via onBuy.
 *
 * ABSORBED THE LOCKED SIGNALS SECTION: there used to be a second, display-only
 * "Locked signals" list above this one, four more rows restating the tier
 * name, the cost, the buys left, and the disabled reason that these buttons
 * already show. The one thing it had that these buttons did not was the
 * locked-clue count, so that folded in here as "x signals left" and the
 * section is gone. See signalsLeft below for why that is a min() rather than
 * either raw count.
 */

import { Flame } from "lucide-react";
import type { SignalTierKey } from "@/lib/signal-scout/scoring";
import { TIER_DISPLAY_NAMES } from "./clue-grid";

const TIER_ORDER: SignalTierKey[] = ["weak", "clear", "ping", "scan"];

export interface HintControlsProps {
  score: number;
  burned: boolean;
  lockedCounts: Record<SignalTierKey, number>;
  purchasesRemaining: Record<SignalTierKey, number>;
  tierCosts: Record<SignalTierKey, number>;
  pendingTier: SignalTierKey | null;
  onBuy: (tier: SignalTierKey) => void;
}

function tierButtonClasses(warning: boolean) {
  const base =
    "flex min-h-11 w-full flex-col items-start gap-1 rounded-card border px-3 py-2.5 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:cursor-not-allowed disabled:opacity-60";
  return warning
    ? `${base} border-signal-warning/60 text-signal-warning hover:border-signal-warning`
    : `${base} border-line bg-surface text-ink hover:border-brand-cyan/60 hover:text-brand-cyan`;
}

export function HintControls({
  score,
  burned,
  lockedCounts,
  purchasesRemaining,
  tierCosts,
  pendingTier,
  onBuy,
}: HintControlsProps) {
  return (
    <section aria-labelledby="hint-controls-heading" className="mt-6">
      <h4 id="hint-controls-heading" className="text-sm font-semibold text-ink">
        Buy a hint
      </h4>
      <ul role="list" className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {TIER_ORDER.map((tier) => {
          const tierName = TIER_DISPLAY_NAMES[tier];
          const cost = tierCosts[tier];
          const locked = lockedCounts[tier];
          const remaining = purchasesRemaining[tier];
          const exhausted = locked === 0;
          const limitReached = remaining === 0;
          const isPending = pendingTier === tier;
          // A purchase in flight for a DIFFERENT tier disables this button too,
          // so a screen reader user can't fire a second concurrent purchase
          // while the first is still resolving (the click would otherwise
          // silently no-op, which reads as broken rather than busy).
          const otherPending = pendingTier !== null && !isPending;

          // Two independent limits gate a tier: how many of its clues are
          // still hidden (lockedCounts) and how many buys the round's frozen
          // tier cap still allows (purchasesRemaining). Neither alone tells
          // the player what they want to know, so what actually gets shown is
          // how many more hints this tier can still yield, which is whichever
          // limit runs out first. It hits 0 exactly when the tier is either
          // exhausted or capped out, and the status line below names which.
          const signalsLeft = Math.min(locked, remaining);
          const signalsLeftText = `${signalsLeft} signal${signalsLeft === 1 ? "" : "s"} left`;

          const disabledReason = burned
            ? "Hints locked"
            : exhausted
              ? "Tier exhausted"
              : limitReached
                ? "Limit reached"
                : null;
          const disabled = Boolean(disabledReason) || isPending || otherPending;
          const isBurnWarning =
            !disabledReason && !isPending && !otherPending && score > 0 && cost >= score;

          const statusLine = isPending
            ? "Revealing..."
            : isBurnWarning
              ? "Burns out signal"
              : disabledReason;

          // Spelled out on every button rather than only the burn-warning one,
          // so the announcement never depends on how a screen reader chooses
          // to pronounce "pts", and so the count that used to live in the
          // Locked signals list is still spoken now that the list is gone.
          // Leads with the tier name, which is the button's visible label, to
          // keep label-in-name intact.
          const ariaLabel = [
            tierName,
            `${cost} points per reveal`,
            signalsLeftText,
            isBurnWarning
              ? "Warning: this costs your whole remaining signal. Buying it burns your score to zero."
              : null,
            isPending ? "Revealing" : disabledReason,
          ]
            .filter(Boolean)
            .join(", ");

          return (
            <li key={tier}>
              <button
                type="button"
                onClick={() => onBuy(tier)}
                disabled={disabled}
                aria-disabled={disabledReason ? true : undefined}
                aria-busy={isPending}
                aria-label={ariaLabel}
                className={tierButtonClasses(isBurnWarning)}
              >
                <span className="flex w-full items-center justify-between gap-2">
                  <span className="text-sm font-semibold">{tierName}</span>
                  {isBurnWarning && <Flame aria-hidden="true" className="h-4 w-4 shrink-0" />}
                </span>
                {/* Wraps rather than squeezing: at the 4-across desktop
                    layout these two barely share a line, so they drop to
                    stacked lines instead of colliding. */}
                <span className="flex w-full flex-wrap items-center justify-between gap-x-2 gap-y-0.5">
                  <span className="font-mono text-xs tabular-nums text-ink-subtle">{cost} pts</span>
                  <span className="text-[10px] text-ink-subtle">{signalsLeftText}</span>
                </span>
                {statusLine && (
                  <span className="text-xs font-semibold uppercase tracking-wide">{statusLine}</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-xs text-ink-subtle">
        Every hint costs score. Overreach and the signal burns out.
      </p>
    </section>
  );
}
