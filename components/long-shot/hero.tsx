/**
 * The Long Shot hero (plan 18A.5), in place of the house masthead on this one
 * page. It carries the page's only h1. Signed in, the date line names the
 * puzzle's day with a streak chip beside it when there is a streak (the word
 * is always present, never only the flame). Signed out, the date line is a
 * sign-in sentence.
 */

import { Flame } from "lucide-react";
import { LongShotMark } from "./long-shot-mark";
import { STADIUM_LIGHTS } from "./stage";

export function LongShotHero({
  dateLine,
  streak,
}: {
  /** "Puzzle for Saturday, November 7", or the signed-out sentence. */
  dateLine: string;
  streak: number;
}) {
  return (
    <header
      className="relative overflow-hidden rounded-[24px] border border-line bg-surface px-5 py-7 sm:px-8 sm:py-9"
      style={{ backgroundImage: STADIUM_LIGHTS }}
    >
      <div className="pointer-events-none absolute -right-6 -top-4 opacity-[0.06]" aria-hidden="true">
        <LongShotMark size={160} gradientId="ls-hero-ornament" />
      </div>
      <div className="relative">
        <p className="flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-[0.18em] text-brand-cyan">
          <LongShotMark size={28} gradientId="ls-hero-mark" />
          Daily rarity game
        </p>
        <h1 className="mt-3 text-4xl font-black tracking-tight text-ink sm:text-5xl">Long Shot</h1>
        <p className="mt-2 text-lg text-ink-muted">Five prompts. Rare answers win.</p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <p className="text-sm font-medium text-ink">{dateLine}</p>
          {streak > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[#F59E0B]/50 bg-[#F59E0B]/10 px-3 py-1 text-sm font-semibold text-ink">
              <Flame aria-hidden="true" className="h-4 w-4" style={{ color: "#F59E0B" }} />
              {streak} day streak
            </span>
          )}
        </div>
      </div>
    </header>
  );
}
