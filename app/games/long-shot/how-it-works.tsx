/**
 * How it works (plan 5.1): the short version, beside the game. Every number
 * comes from live settings. Each tier's word sits beside its color and points.
 */

import { TierChip } from "@/components/long-shot/tier-chip";
import { TIERS, type LongShotSettings } from "@/lib/long-shot/types";

export function HowItWorks({ settings, headingId = "ls-how-it-works" }: { settings: LongShotSettings; headingId?: string }) {
  return (
    <section aria-labelledby={headingId} className="rounded-[20px] border border-line bg-surface p-5 sm:p-6">
      <h2 id={headingId} className="text-lg font-bold text-ink">
        How it works
      </h2>
      <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-ink-muted">
        <li>Five prompts, the same for everyone, new every day at midnight Eastern.</li>
        <li>Name one player who fits each prompt. In Hurry-Up you have {settings.timer.seconds} seconds.</li>
        <li>The fewer of our leagues roster your answer, the more it scores.</li>
      </ol>
      <ul className="mt-4 space-y-2" aria-label="Tiers and points">
        {[...TIERS].reverse().map((t) => (
          <li key={t} className="flex min-h-9 items-center justify-between gap-3 text-sm">
            <TierChip tier={t} size="sm" />
            <span className="font-mono font-bold tabular-nums text-ink">
              {settings.tiers.points[t]}
              <span className="sr-only"> points</span>
            </span>
          </li>
        ))}
        <li className="flex min-h-9 items-center justify-between gap-3 text-sm">
          <TierChip tier={null} size="sm" />
          <span className="font-mono font-bold tabular-nums text-ink">
            0<span className="sr-only"> points</span>
          </span>
        </li>
      </ul>
    </section>
  );
}
