/**
 * Locked signal slots: one row per paid hint tier showing how many clues
 * are still hidden, what the next reveal costs, and how many purchases are
 * left (plan section 21). Display only; the purchase buttons that turn
 * these rows into buy actions land in SS-T026.
 */

import { Lock } from "lucide-react";
import type { SignalTierKey } from "@/lib/signal-scout/scoring";
import { TIER_DISPLAY_NAMES } from "./clue-grid";

const TIER_ORDER: SignalTierKey[] = ["weak", "clear", "ping", "scan"];

export interface LockedSlotsProps {
  lockedCounts: Record<SignalTierKey, number>;
  purchasesRemaining: Record<SignalTierKey, number>;
  tierCosts: Record<SignalTierKey, number>;
}

export function LockedSlots({ lockedCounts, purchasesRemaining, tierCosts }: LockedSlotsProps) {
  return (
    <section aria-labelledby="locked-signals-heading" className="mt-6">
      <h4 id="locked-signals-heading" className="text-sm font-semibold text-ink">
        Locked signals
      </h4>
      <ul role="list" className="mt-3 space-y-2">
        {TIER_ORDER.map((tier) => {
          const locked = lockedCounts[tier];
          const remaining = purchasesRemaining[tier];
          const cost = tierCosts[tier];
          const tierName = TIER_DISPLAY_NAMES[tier];
          const exhausted = locked === 0;
          const noBuysLeft = remaining === 0;
          const disabled = exhausted || noBuysLeft;
          const reason = exhausted ? "Tier exhausted" : noBuysLeft ? "No buys left" : null;

          return (
            <li
              key={tier}
              aria-label={`${tierName}: ${cost} points per reveal, ${locked} clues locked, ${remaining} buys left${
                reason ? `, ${reason}` : ""
              }`}
              className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-card border border-line bg-base/50 px-3 py-2.5 ${
                disabled ? "text-ink-subtle" : "text-ink"
              }`}
            >
              <Lock aria-hidden="true" className="h-4 w-4 shrink-0" />
              <span className="text-sm font-semibold">{tierName}</span>
              <span className="text-xs uppercase tracking-wide text-ink-subtle">Signal Locked</span>
              <span className="text-sm">{locked} clues locked</span>
              <span className="font-mono text-sm tabular-nums">{cost} pts per reveal</span>
              <span className="text-sm">{remaining} buys left</span>
              {reason && (
                <span className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                  {reason}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
