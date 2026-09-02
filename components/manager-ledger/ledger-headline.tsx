/**
 * The three league-wide figures the page opens with.
 *
 * Big numbers, because these are the ones a reader repeats to their league
 * chat. Everything below them is the evidence for them.
 *
 * WHY THESE THREE AND NOT A SCORE. There is no composite here, on purpose, for
 * the reason given in lib/manager-ledger/engine.ts. What a league wants to know
 * is how much has been thrown away, and these are the three honest answers at
 * three scales: whole games, total points, and the share of what was available.
 *
 * A NULL IS PRINTED AS A REASON, NEVER AS A ZERO. `averageEfficiency` comes
 * back null in a league with too few finished weeks for anyone to be ranked,
 * and a big bold 0% would be a confident statement of something false.
 */

import { CalendarCheck, Percent, TrendingDown } from "lucide-react";
import type { LedgerHeadline } from "@/lib/manager-ledger/leaders";

function Tile({
  icon: Icon,
  label,
  value,
  unit,
  detail,
  accent,
}: {
  icon: typeof Percent;
  label: string;
  value: string;
  unit?: string;
  detail: string;
  accent: string;
}) {
  return (
    <div className="rounded-card border border-line bg-surface p-4">
      <div className="flex items-center gap-2">
        <Icon aria-hidden="true" className={`h-4 w-4 shrink-0 ${accent}`} />
        <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-subtle">
          {label}
        </h3>
      </div>
      <p className={`mt-2 font-mono text-3xl font-extrabold tabular-nums ${accent}`}>
        {value}
        {unit ? (
          <span className="ml-1 font-sans text-sm font-semibold text-ink-muted">{unit}</span>
        ) : null}
      </p>
      <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">{detail}</p>
    </div>
  );
}

export function LedgerHeadlineTiles({
  headline,
  teamCount,
}: {
  headline: LedgerHeadline;
  teamCount: number;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Tile
        icon={TrendingDown}
        accent="text-brand-purple"
        label="Wins left behind"
        value={String(headline.winsLeftOnBench)}
        detail={`Losses across ${teamCount} teams that the loser's own bench would have won, in ${headline.gradedWeeks} finished week${headline.gradedWeeks === 1 ? "" : "s"}.`}
      />
      <Tile
        icon={CalendarCheck}
        accent="text-rose-300"
        label="Points left behind"
        value={headline.pointsLeft.toFixed(1)}
        detail="Every point left on a bench in this league, added up."
      />
      <Tile
        icon={Percent}
        accent="text-brand-cyan"
        label="League average started"
        value={
          headline.averageEfficiency === null
            ? "Not yet"
            : `${Math.round(headline.averageEfficiency * 100)}`
        }
        unit={headline.averageEfficiency === null ? undefined : "%"}
        detail={
          headline.averageEfficiency === null
            ? "No team has enough finished weeks to rank yet."
            : "What the average manager here started, out of what they had."
        }
      />
    </div>
  );
}
