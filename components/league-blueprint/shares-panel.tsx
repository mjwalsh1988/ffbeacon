/**
 * Share of the league (plan 9.7): two equal figures on purpose, value share
 * and production share, each with its league rank and a share bar on ONE
 * common scale with the even split marked, so the two bars can be compared
 * with each other and with an average team. The bar fill is one of the
 * places the beacon gradient is allowed.
 */

import { NO_PRODUCTION } from "@/lib/league-blueprint/shares";
import type { BlueprintView, ShareFigure } from "@/lib/league-blueprint/types";
import { rankOf, ROW_SUB, SECONDARY_LABEL } from "./bits";
import { SheetSection } from "./sheet";

function Share({
  label,
  figure,
  teamCount,
  empty,
  scaleMax,
}: {
  label: string;
  figure: ShareFigure;
  teamCount: number;
  empty: string;
  /** The percent at the right end of the track, shared by both bars. */
  scaleMax: number;
}) {
  const even = 100 / Math.max(teamCount, 1);
  const width = figure.pct === null ? 0 : Math.min(100, (figure.pct / scaleMax) * 100);
  const tick = Math.min(100, (even / scaleMax) * 100);
  return (
    <div className="min-w-0 border-t border-line pt-3">
      <p className={SECONDARY_LABEL}>{label}</p>
      {figure.pct === null ? (
        <p className="mt-1 text-sm text-ink-muted">{empty}</p>
      ) : (
        <>
          <p className="mt-1 font-mono text-3xl font-black tabular-nums text-ink sm:text-4xl">
            {figure.pct.toFixed(1)}%<span className="sr-only"> of the league</span>
          </p>
          <p className={ROW_SUB}>{rankOf(figure.rank, teamCount)}</p>
          <div aria-hidden="true" className="relative mt-3 h-2 overflow-hidden rounded-full bg-ink/[0.08]">
            <div className="h-full rounded-full bg-beacon" style={{ width: `${width}%` }} />
            <span className="absolute top-0 h-full w-0.5 bg-ink/60" style={{ left: `${tick}%` }} />
          </div>
          <p className="mt-1.5 text-[11px] text-ink-subtle">
            {figure.pct >= even
              ? `${(figure.pct - even).toFixed(1)} points above an even ${even.toFixed(1)}% share (the mark on the bar).`
              : `${(even - figure.pct).toFixed(1)} points below an even ${even.toFixed(1)}% share (the mark on the bar).`}
          </p>
        </>
      )}
    </div>
  );
}

export function SharesPanel({ view, number }: { view: BlueprintView; number: string }) {
  const T = view.header.teamCount;
  const even = 100 / Math.max(T, 1);
  // The track ends at three even shares or the larger figure, whichever is
  // more, so a dominant roster still fits and an average one sits a third in.
  const scaleMax = Math.max(even * 3, view.shares.value.pct ?? 0, view.shares.production.pct ?? 0);
  return (
    <SheetSection
      id="bp-shares"
      number={number}
      title="Share of the league"
      helper={`How much of the league's total value and scoring this roster holds. An even split is ${even.toFixed(1)}% each across ${T} teams.`}
    >
      <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
        <Share label="Value share" figure={view.shares.value} teamCount={T} empty="No values for this format yet." scaleMax={scaleMax} />
        <Share label="Production share" figure={view.shares.production} teamCount={T} empty={NO_PRODUCTION} scaleMax={scaleMax} />
      </div>
    </SheetSection>
  );
}
