/**
 * A chopped (guillotine) week, framed around the cut line.
 *
 * There is no opponent in a chopped league: the lowest score in the whole
 * league goes out, whoever it was drawn against. So the hero figure is the
 * chance to survive, and the three figures beside it are the week itself: your
 * score, the lowest score among everyone else, and the margin between them.
 * Every figure is one real text node, and a missing one is said in words.
 *
 * Server component. Presentational only. The numbers come from
 * lib/chopped/cut-line.ts.
 */

import { Panel } from "@/components/dashboard-panel";
import { fmtPoints, fmtSigned } from "@/components/league-schedule/format";
import type { ChopWeek } from "@/lib/league-lineups/types";

function survivalWords(chance: number): string {
  const pct = Math.round(chance * 100);
  if (chance > 0 && pct === 0) return "under 1%";
  if (chance < 1 && pct === 100) return "over 99%";
  return `${pct}%`;
}

export function CutLinePanel({
  chop,
  week,
  isFinal,
}: {
  chop: ChopWeek;
  week: number;
  isFinal: boolean;
}) {
  if (chop.alreadyOut) {
    return (
      <Panel eyebrow="The cut line" title={`Week ${week}`} headingLevel={2}>
        <p className="text-sm text-ink-muted">This team was chopped before week {week}.</p>
      </Panel>
    );
  }

  const survived = isFinal && chop.survivalChance !== null ? chop.survivalChance >= 1 : null;

  return (
    <Panel
      id="lineup-cut-line"
      eyebrow="The cut line"
      title={isFinal ? `How week ${week} went` : `Staying above the cut in week ${week}`}
      helper="The lowest score in the league goes out, whoever it played."
      headingLevel={2}
      glow
    >
      <div className="rounded-card border border-line bg-base/50 px-4 py-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-cyan">
          {isFinal ? "Result" : "Chance to survive"}
        </p>
        {isFinal ? (
          <p className="mt-1 font-mono text-4xl font-black leading-none tabular-nums text-ink sm:text-5xl">
            {survived === null ? "Not settled" : survived ? "Survived" : "Chopped"}
          </p>
        ) : chop.survivalChance === null ? (
          <p className="mt-1 text-sm text-ink-muted">No survival chance yet: not enough lineups are projected.</p>
        ) : (
          <p className="mt-1 font-mono text-4xl font-black leading-none tabular-nums text-ink sm:text-5xl">
            {survivalWords(chop.survivalChance)}
          </p>
        )}

        <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <dt className="text-[11px] font-semibold text-ink-subtle">Your score</dt>
            <dd className="font-mono text-2xl font-black tabular-nums text-ink">
              {chop.score === null ? <span className="font-sans text-sm font-normal text-ink-muted">No points yet</span> : fmtPoints(chop.score)}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold text-ink-subtle">
              Lowest score{chop.lowestTeamName ? `, ${chop.lowestTeamName}` : ""}
            </dt>
            <dd className="font-mono text-2xl font-black tabular-nums text-ink">
              {chop.lowestOther === null ? <span className="font-sans text-sm font-normal text-ink-muted">No points yet</span> : fmtPoints(chop.lowestOther)}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold text-ink-subtle">Your margin over it</dt>
            <dd className="font-mono text-2xl font-black tabular-nums text-ink">
              {chop.margin === null ? <span className="font-sans text-sm font-normal text-ink-muted">No margin yet</span> : fmtSigned(chop.margin)}
            </dd>
          </div>
        </dl>
        <p className="mt-3 text-[12px] text-ink-muted">
          {chop.aliveCount} teams were still in going into week {week}.
        </p>
      </div>
    </Panel>
  );
}
