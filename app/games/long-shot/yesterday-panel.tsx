/**
 * Yesterday (plan 10.4 and 18A.11): the reader's settled day, or, when the
 * settle run has not landed, the base total and a sentence saying so.
 * Omitted entirely when there is no completed attempt for yesterday.
 */

import { LoneSignalBadge } from "@/components/long-shot/lone-signal-badge";
import { SettledStamp } from "@/components/long-shot/settled-stamp";
import type { YesterdayDto } from "@/lib/long-shot/types";

export function YesterdayPanel({ yesterday }: { yesterday: YesterdayDto }) {
  const y = yesterday;
  return (
    <section aria-labelledby="ls-yesterday" className="relative rounded-[20px] border border-line bg-surface p-5 sm:p-6">
      <div className="absolute right-4 top-4">
        <SettledStamp settled={y.settled} />
      </div>
      <p className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-brand-cyan">Yesterday</p>
      <h2 id="ls-yesterday" className="mt-1 pr-28 text-lg font-bold text-ink">
        {y.settled ? "Your settled day" : "Your day, not yet settled"}
      </h2>
      <div className="mt-4 flex flex-wrap items-end gap-6">
        <div>
          <p className="text-4xl font-black leading-none tracking-tight tabular-nums text-ink">
            {y.settled ? y.totalPoints : y.basePoints}
            <span className="sr-only"> points</span>
          </p>
          <p className="mt-2 text-xs uppercase tracking-[0.18em] text-ink-subtle">{y.settled ? "Total" : "Base total"}</p>
        </div>
        {y.rank !== null && (
          <div>
            <p className="text-4xl font-black leading-none tracking-tight tabular-nums text-ink">
              #{y.rank}
              <span className="sr-only"> on the daily board</span>
            </p>
            <p className="mt-2 text-xs uppercase tracking-[0.18em] text-ink-subtle">Final rank</p>
          </div>
        )}
      </div>
      {y.settled ? (
        y.bonusPoints > 0 ? (
          <div className="mt-4">
            <LoneSignalBadge label={`Lone Signal, +${y.bonusPoints}`} />
            <ul className="mt-3 space-y-2 text-sm text-ink-muted">
              {y.loneSignalPrompts.map((p, i) => (
                <li key={i}>
                  <span className="font-semibold text-ink">{p.playerName}</span> for &quot;{p.promptText}&quot;
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="mt-4 text-sm text-ink-muted">No Lone Signal bonus that day.</p>
        )
      ) : (
        <p className="mt-4 text-sm text-ink-muted">Lone Signal bonuses for this day are not settled yet.</p>
      )}
    </section>
  );
}
