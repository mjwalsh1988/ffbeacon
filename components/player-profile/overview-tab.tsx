/**
 * Overview tab (default). Two-column layout: the main column carries the latest
 * headline and the full player overview grid; the sidebar (overview-only) stacks
 * the value trend chart, last-three positional finishes, and the latest trades.
 * Loads its own value / trend / trade / article data; positional finishes are
 * passed down from the page so the RPC runs once for both hero and sidebar.
 * Async server component.
 */

import { QuickNews } from "@/components/player-profile/quick-news";
import { InjuryStatus } from "@/components/player-profile/injury-status";
import { PlayerBioOverview } from "@/components/player-profile/player-bio-overview";
import { DepthChartCard } from "@/components/player-profile/depth-chart-card";
import { OverviewSidebar } from "@/components/player-profile/overview-sidebar";
import {
  summarizeProjections,
  SCORING_KEYS,
  type PlayerContext,
  type PlayerRow,
  type PositionalFinish,
} from "@/lib/player-profile";
import {
  loadValueSeriesCached,
  loadTrendsCached,
  loadLatestValueCached,
  loadDepthChartCached,
  loadWeeklyProjectionsCached,
  loadLatestArticleCached,
  findPlayerTradesCached,
} from "@/lib/player-profile-cache";

export async function OverviewTab({
  player,
  sleeperId,
  context,
  finishesLast3,
}: {
  player: PlayerRow;
  sleeperId: string | null;
  context: PlayerContext;
  finishesLast3: PositionalFinish[];
}) {
  const playerName =
    player.full_name ?? `${player.first_name ?? ""} ${player.last_name ?? ""}`.trim();
  const nowMs = Date.now();

  // Every read here is cached (lib/player-profile-cache.ts), so a reader clicking
  // through profiles is not re-running the whole waterfall per click.
  const [valueSeries, trends, latestValue, trades, article, depthChart, projections] =
    await Promise.all([
      loadValueSeriesCached(player.id, context.formatConfigId, context.valueSourceSlug, 30),
      loadTrendsCached(player.id, context.formatConfigId, context.valueSourceSlug),
      loadLatestValueCached(player.id, context.formatConfigId, context.valueSourceSlug),
      sleeperId ? findPlayerTradesCached(sleeperId, 3) : Promise.resolve([]),
      loadLatestArticleCached(player.id),
      loadDepthChartCached(player),
      loadWeeklyProjectionsCached(player.id),
    ]);

  const scoringLabel =
    SCORING_KEYS.find((s) => s.key === context.scoringKey)?.label ?? "PPR";
  const tePremiumBonus = player.position === "TE" ? context.tePremiumBonus : 0;
  const projectionSummary = summarizeProjections(
    projections,
    context.scoringKey,
    tePremiumBonus,
  );

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <QuickNews article={article} playerName={playerName} />
          <InjuryStatus player={player} playerName={playerName} />
          <PlayerBioOverview player={player} />
          {depthChart && (
            <DepthChartCard
              room={depthChart.room}
              viewedRole={depthChart.viewedRole}
              position={player.position}
              playerName={playerName}
            />
          )}
        </div>
        <aside aria-label="Player highlights" className="lg:col-span-1">
          <OverviewSidebar
            valuePoints={valueSeries.points}
            windowed={valueSeries.windowed}
            latestValue={latestValue}
            trends={trends}
            sourceDisplay={context.valueSourceDisplay}
            formatDisplay={context.formatDisplay}
            position={player.position}
            scoringLabel={scoringLabel}
            finishes={finishesLast3}
            projectionSummary={projectionSummary}
            tePremiumBonus={tePremiumBonus}
            trades={trades}
            focusSleeperId={sleeperId ?? ""}
            nowMs={nowMs}
          />
        </aside>
      </div>
    </div>
  );
}
