/**
 * Share of the league (plan 9.7): two equal figures on purpose, value share
 * and production share, each with its league rank and a share bar. No hero
 * here; the bar fill is one of the places the beacon gradient is allowed.
 */

import { Panel } from "@/components/dashboard-panel";
import { NO_PRODUCTION } from "@/lib/league-blueprint/shares";
import type { BlueprintView, ShareFigure } from "@/lib/league-blueprint/types";
import { INNER_CARD, rankOf, ROW_SUB, SECONDARY_LABEL } from "./bits";

function Share({ label, figure, teamCount, empty }: { label: string; figure: ShareFigure; teamCount: number; empty: string }) {
  // A 1/teamCount share is an average team; the bar is scaled so that sits at
  // a third of the track, leaving room for a dominant roster.
  const scale = Math.max(0.01, 3 / Math.max(teamCount, 1));
  const width = figure.pct === null ? 0 : Math.min(100, (figure.pct / 100 / scale) * 100);
  return (
    <div className={`${INNER_CARD} px-4 py-3`}>
      <p className={SECONDARY_LABEL}>{label}</p>
      {figure.pct === null ? (
        <p className="mt-1 text-sm text-ink-muted">{empty}</p>
      ) : (
        <>
          <p className="mt-1 font-mono text-3xl font-black tabular-nums text-ink">
            {figure.pct.toFixed(1)}%<span className="sr-only"> of the league</span>
          </p>
          <p className={ROW_SUB}>{rankOf(figure.rank, teamCount)}</p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink/[0.07]">
            <div className="h-full rounded-full bg-beacon" style={{ width: `${width}%` }} />
          </div>
        </>
      )}
    </div>
  );
}

export function SharesPanel({ view }: { view: BlueprintView }) {
  const T = view.header.teamCount;
  return (
    <Panel
      id="bp-shares"
      eyebrow="Against the league"
      title="Share of the league"
      helper={`An even split is ${(100 / Math.max(T, 1)).toFixed(1)}% each across ${T} teams.`}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Share label="Value share" figure={view.shares.value} teamCount={T} empty="No values for this format yet." />
        <Share label="Production share" figure={view.shares.production} teamCount={T} empty={NO_PRODUCTION} />
      </div>
    </Panel>
  );
}
