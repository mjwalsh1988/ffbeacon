/**
 * Projected outlook card (overview sidebar). Forward-looking counterpart to the
 * positional-finishes card: the soonest upcoming week's projected points plus a
 * rest-of-season (or full-season, pre-kickoff) point and per-game roll-up, all
 * in the active scoring format. Presentational server component; the caller
 * resolves the summary against the global format/source context and only renders
 * this when projections exist.
 */

import { StatReadout } from "@/components/dashboard-panel";
import type { ProjectionSummary } from "@/lib/player-profile";

function fmtPts(v: number | null): string {
  return v != null ? v.toFixed(1) : "-";
}

export function ProjectionOutlook({
  summary,
  scoringLabel,
  tePremiumBonus = 0,
}: {
  summary: ProjectionSummary;
  scoringLabel: string;
  /** Points added per projected reception for a TE-premium format (0 otherwise). */
  tePremiumBonus?: number;
}) {
  const ng = summary.nextGame;
  const totalLabel = summary.seasonStarted ? "Rest of season" : "Full season";

  if (!summary.season || (!ng && summary.upcomingWeeks === 0)) {
    return (
      <p className="text-sm text-ink-muted">
        No upcoming projections on file for this player.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {ng && (
        <div className="rounded-card border border-line bg-base/50 px-3 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
            Next game
            <span className="ml-1 normal-case tracking-normal text-ink-muted">
              Week {ng.week}
              {ng.opponent ? ` vs ${ng.opponent}` : ""}
            </span>
          </p>
          <p className="mt-0.5 font-mono text-3xl font-bold tabular-nums text-brand-cyan">
            {fmtPts(summary.nextGamePoints)}
          </p>
          <p className="text-[11px] text-ink-subtle">
            projected {scoringLabel} points
          </p>
        </div>
      )}

      <dl className="grid grid-cols-2 gap-2">
        <StatReadout
          label={`${totalLabel} pts`}
          value={summary.totalPoints.toFixed(1)}
          accent="purple"
        />
        <StatReadout
          label="Per game"
          value={summary.perGame != null ? summary.perGame.toFixed(1) : "-"}
          accent="cyan"
        />
      </dl>

      <p className="text-[11px] leading-relaxed text-ink-subtle">
        {summary.upcomingWeeks} projected {summary.upcomingWeeks === 1 ? "week" : "weeks"}{" "}
        remaining in {summary.season}, {scoringLabel} scoring.
        {tePremiumBonus > 0 && (
          <> Includes a +{tePremiumBonus} per reception tight end premium.</>
        )}
      </p>
    </div>
  );
}
