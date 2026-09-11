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
  resolveProfileProjectionSourceCached,
  loadLatestArticleCached,
  findPlayerTradesCached,
} from "@/lib/player-profile-cache";
import { projectionSourceDisplay } from "@/lib/projections/source-constants";
import { createClient } from "@/lib/supabase/server";
import { buildPlayerSummary } from "@/lib/player-profile/summary";

/**
 * Position rank from the resolved (format, source)'s current rankings row
 * (SEO-T972). Not already loaded anywhere on the profile: the overview sidebar
 * shows value and its trend but never the current rank, so this is one new,
 * single-row, indexed read (mirrors the same lookup lib/beam/capabilities/
 * player-rank.ts does for the same table). The rankings table can resolve a
 * different source than the value tables for a given format, so it reads
 * context.rankingsSourceSlug rather than context.valueSourceSlug.
 */
async function loadPositionRank(
  supabase: Awaited<ReturnType<typeof createClient>>,
  playerId: string,
  formatConfigId: string | null,
  source: string | null,
): Promise<number | null> {
  if (!formatConfigId || !source) return null;
  const { data } = await supabase
    .from("rankings")
    .select("position_rank")
    .eq("player_id", playerId)
    .eq("format_config_id", formatConfigId)
    .eq("source", source)
    .is("week", null)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.position_rank ?? null;
}

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
  const playerSurname =
    player.last_name && player.last_name.trim().length > 0
      ? player.last_name
      : playerName.split(" ").slice(-1)[0] || playerName;
  const nowMs = Date.now();

  // Every read here is cached (lib/player-profile-cache.ts), so a reader clicking
  // through profiles is not re-running the whole waterfall per click.
  // Resolved before the wave, because it is part of the projection read's cache
  // key. See lib/player-profile-cache.ts.
  const projectionSource = await resolveProfileProjectionSourceCached();
  const supabase = await createClient();

  const [valueSeries, trends, latestValue, trades, article, depthChart, projections, positionRank] =
    await Promise.all([
      loadValueSeriesCached(player.id, context.formatConfigId, context.valueSourceSlug, 30),
      loadTrendsCached(player.id, context.formatConfigId, context.valueSourceSlug),
      loadLatestValueCached(player.id, context.formatConfigId, context.valueSourceSlug),
      sleeperId ? findPlayerTradesCached(sleeperId, 3) : Promise.resolve([]),
      loadLatestArticleCached(player.id),
      loadDepthChartCached(player),
      loadWeeklyProjectionsCached(player.id, projectionSource),
      loadPositionRank(supabase, player.id, context.formatConfigId, context.rankingsSourceSlug),
    ]);

  const scoringLabel =
    SCORING_KEYS.find((s) => s.key === context.scoringKey)?.label ?? "PPR";
  const tePremiumBonus = player.position === "TE" ? context.tePremiumBonus : 0;
  const projectionSummary = summarizeProjections(
    projections,
    context.scoringKey,
    tePremiumBonus,
  );

  // SEO-T972: a deterministic factual summary, not generated prose. Gate the
  // trend clause the same way the trend chip does (show_trend_30d) so a thin
  // history never reads as momentum here either.
  const summary = buildPlayerSummary({
    playerName,
    playerSurname,
    position: player.position,
    formatDisplay: context.formatDisplay,
    positionRank,
    trendDirection: trends?.show_trend_30d ? (trends.trend_30d as "up" | "down" | "stable" | null) : null,
    trendPct: trends?.change_30d_pct ?? null,
    nextProjectionWeek: projectionSummary.nextGame?.week ?? null,
    nextProjectionPoints: projectionSummary.nextGamePoints,
    projectionEngineDisplay: projectionSourceDisplay(projectionSource),
    lastThreeFinishes: finishesLast3.map((f) => ({ season: f.season, finish: f.finish })),
  });

  return (
    <PageBody>
      {summary && (
        <p className="mb-6 text-sm leading-relaxed text-ink-muted">{summary}</p>
      )}
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
            projectionSourceLabel={projectionSourceDisplay(projectionSource)}
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
