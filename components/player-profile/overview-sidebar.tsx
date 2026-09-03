/**
 * Overview sidebar: three stacked panels shown only on the default overview tab.
 * Order (top to bottom): value trend chart, last three positional finishes, and
 * the latest few trades involving the player (minimal, ungraded). Server
 * component; the chart within is the only client piece.
 */

import { ArrowLeftRight } from "lucide-react";
import { Panel } from "@/components/dashboard-panel";
import { TrendChip } from "@/components/trend-chip";
import { ValueTrendChart } from "@/components/player-profile/value-trend-chart";
import { LastThreeFinishes } from "@/components/player-profile/positional-finishes";
import { ProjectionOutlook } from "@/components/player-profile/projection-outlook";
import { MiniTrade } from "@/components/player-profile/mini-trade";
import type {
  PositionalFinish,
  ProjectionSummary,
  TrendsRow,
  ValuePoint,
} from "@/lib/player-profile";
import type { PlayerTrade } from "@/lib/player-trades";

export function OverviewSidebar({
  valuePoints,
  windowed,
  latestValue,
  trends,
  sourceDisplay,
  formatDisplay,
  position,
  scoringLabel,
  finishes,
  projectionSummary,
  projectionSourceLabel = "Sleeper",
  tePremiumBonus = 0,
  trades,
  focusSleeperId,
  nowMs,
}: {
  valuePoints: ValuePoint[];
  windowed: boolean;
  latestValue: number | null;
  trends: TrendsRow | null;
  sourceDisplay: string | null;
  formatDisplay: string;
  position: string;
  scoringLabel: string;
  finishes: PositionalFinish[];
  projectionSummary: ProjectionSummary;
  /**
   * Whose projections the outlook panel is showing, resolved server side.
   *
   * `sourceDisplay` above is a different thing entirely: it is the VALUE
   * source (KTC, FantasyCalc), which the reader picks. This one is the
   * PROJECTION engine, which an admin switches. Naming them apart matters,
   * because they appear two panels from each other.
   */
  projectionSourceLabel?: string;
  tePremiumBonus?: number;
  trades: PlayerTrade[];
  focusSleeperId: string;
  nowMs: number;
}) {
  const hasProjections =
    projectionSummary.season != null &&
    (projectionSummary.nextGame != null || projectionSummary.upcomingWeeks > 0);
  return (
    <div className="space-y-5">
      {/* 1. Value trend */}
      <Panel
        eyebrow="Market"
        title="Value trend"
        helper={`${formatDisplay}${sourceDisplay ? `, ${sourceDisplay}` : ""}`}
        headingLevel={3}
        glow
      >
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
              Current value
            </p>
            <p className="mt-0.5 font-mono text-3xl font-bold tabular-nums text-brand-purple">
              {latestValue != null ? latestValue.toLocaleString() : "No value"}
            </p>
          </div>
          {trends?.show_trend_30d && (
            <TrendChip
              direction={trends.trend_30d as "up" | "down" | "stable" | null}
              delta={trends.change_30d}
              deltaPct={trends.change_30d_pct}
              windowLabel="30-day"
            />
          )}
        </div>
        <ValueTrendChart
          points={valuePoints}
          sourceDisplay={sourceDisplay}
          formatDisplay={formatDisplay}
          windowed={windowed}
        />
      </Panel>

      {/* 2. Positional finishes */}
      <Panel
        eyebrow="Production"
        title="Positional finishes"
        helper={`Last 3 seasons, ${scoringLabel} scoring`}
        headingLevel={3}
      >
        <LastThreeFinishes position={position} finishes={finishes} />
      </Panel>

      {/* 3. Projected outlook (only when we hold projections) */}
      {hasProjections && (
        <Panel
          eyebrow="Outlook"
          title="Projected points"
          helper={`${projectionSourceLabel} projections, ${scoringLabel} scoring`}
          headingLevel={3}
        >
          <ProjectionOutlook
            summary={projectionSummary}
            scoringLabel={scoringLabel}
            tePremiumBonus={tePremiumBonus}
          />
        </Panel>
      )}

      {/* 4. Recent trades */}
      <Panel
        eyebrow="Market"
        title="Recent trades"
        helper="Across synced leagues"
        headingLevel={3}
      >
        {trades.length > 0 ? (
          <div className="space-y-2.5">
            {trades.map((t) => (
              <MiniTrade key={`${t.leagueRowId}-${t.transactionId}`} trade={t} focusSleeperId={focusSleeperId} nowMs={nowMs} />
            ))}
          </div>
        ) : (
          <div className="flex items-start gap-3 rounded-card border border-dashed border-line bg-base/40 p-4">
            <span
              aria-hidden="true"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-card border border-line bg-surface text-brand-cyan"
            >
              <ArrowLeftRight className="h-4 w-4" />
            </span>
            <p className="text-sm leading-relaxed text-ink-muted">
              No trades in our system include this player yet.
            </p>
          </div>
        )}
      </Panel>
    </div>
  );
}
