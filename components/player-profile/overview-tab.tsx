/**
 * Overview section (the profile's default). The news, bio, and depth chart take
 * the main column across the full width the rail leaves; the supplementary
 * panels (value trend, last three positional finishes, projected points, recent
 * trades) sit in a right rail that drops below the content under xl.
 *
 * The rail is on the right and second in DOM order because the profile masthead
 * already carries the player's identity, so what is left in it is genuinely
 * secondary and belongs after the main column on a phone. Same arrangement as
 * the League Pulse overview.
 *
 * Loads its own value / trend / trade / article data; positional finishes are
 * passed down from the page so the RPC runs once for both hero and rail.
 * Async server component.
 */

import { PageBody } from "@/components/app-shell/page-body";
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
    <PageBody>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">
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
        <aside
          aria-label="Player highlights"
          // Follows you down the page from xl, the way the League Pulse and
          // draft-room rails do. It runs taller than a viewport on most
          // players, so it scrolls inside itself rather than sticking with
          // its lower panels parked off screen, and it takes focus so that
          // scroll is reachable from the keyboard.
          tabIndex={0}
          className="min-w-0 xl:sticky xl:top-[5.5rem] xl:max-h-[calc(100dvh-7rem)] xl:self-start xl:overflow-y-auto xl:pr-1 beacon-scroll"
        >
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
    </PageBody>
  );
}
