/**
 * The league-wide figures the page opens with.
 *
 * One hero and two secondaries, per the section pattern in
 * docs/completed/team-blueprint/team-blueprint-plan.md section 10. The hero is
 * the figure a reader repeats to their league chat; everything below it is the
 * evidence for it.
 *
 * WHY THESE AND NOT A SCORE. There is no composite here, on purpose, for the
 * reason given in lib/manager-ledger/engine.ts. What a league wants to know is
 * how much has been thrown away, at three scales: whole games, total points,
 * and the share of what was available.
 *
 * BEST BALL. The lineup sets itself, so there is nothing thrown away to count.
 * The tiles say so in one line and show the season's scope instead.
 *
 * A NULL IS PRINTED AS WORDS, NEVER AS A ZERO. `averageEfficiency` comes back
 * null in a league with too few finished weeks for anyone to be ranked.
 */

import { CalendarCheck, Percent, TrendingDown, Users } from "lucide-react";
import type { LedgerHeadline } from "@/lib/manager-ledger/leaders";
import type { LedgerWords } from "./format";

const HERO = "font-mono font-black tabular-nums leading-none text-4xl sm:text-5xl";
const SECONDARY = "font-mono text-2xl font-black tabular-nums";

function Tile({
  icon: Icon,
  label,
  value,
  detail,
  accent,
  hero = false,
}: {
  icon: typeof Percent;
  label: string;
  /** The figure, one text node including its unit. */
  value: string;
  detail: string;
  accent: string;
  hero?: boolean;
}) {
  return (
    <div
      className={`rounded-card border bg-surface p-4 ${
        hero ? "border-line-accent sm:col-span-2" : "border-line"
      }`}
    >
      <div className="flex items-center gap-2">
        <Icon aria-hidden="true" className={`h-4 w-4 shrink-0 ${accent}`} />
        <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-subtle">
          {label}
        </h3>
      </div>
      <p className={`mt-2 ${hero ? HERO : SECONDARY} ${accent}`}>{value}</p>
      <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">{detail}</p>
    </div>
  );
}

export function LedgerHeadlineTiles({
  headline,
  teamCount,
  words,
}: {
  headline: LedgerHeadline;
  teamCount: number;
  words: LedgerWords;
}) {
  const weeksText = `${headline.gradedWeeks} finished week${headline.gradedWeeks === 1 ? "" : "s"}`;

  if (!words.gradesLineups) {
    return (
      <div className="grid gap-3 sm:grid-cols-4">
        <Tile
          hero
          icon={CalendarCheck}
          accent="text-brand-cyan"
          label="Finished weeks"
          value={String(headline.gradedWeeks)}
          detail="Best ball sets every lineup itself, so this page grades waivers, trades and the draft."
        />
        <Tile
          icon={Users}
          accent="text-brand-purple"
          label="Teams"
          value={String(teamCount)}
          detail="Every team in the league, graded on the same moves."
        />
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-4">
      <Tile
        hero
        icon={TrendingDown}
        accent="text-brand-purple"
        label={words.winsLeftLabel}
        value={String(headline.winsLeftOnBench)}
        detail={
          words.chopped
            ? `Weeks below the cut line that the team's own bench would have survived, in ${weeksText}.`
            : `Losses across ${teamCount} teams that the loser's own bench would have won, in ${weeksText}.`
        }
      />
      <Tile
        icon={CalendarCheck}
        accent="text-rose-300"
        label="Points left behind"
        value={headline.pointsLeft.toFixed(1)}
        detail="Every point left on a bench here, added up."
      />
      <Tile
        icon={Percent}
        accent="text-brand-cyan"
        label="Average started"
        value={
          headline.averageEfficiency === null
            ? "Not ranked yet"
            : `${Math.round(headline.averageEfficiency * 100)}%`
        }
        detail={
          headline.averageEfficiency === null
            ? "No team has enough finished weeks to rank yet."
            : "The share of their roster's points the average manager started."
        }
      />
    </div>
  );
}
