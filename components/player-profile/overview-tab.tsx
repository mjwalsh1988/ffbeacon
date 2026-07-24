/**
 * Overview tab (default). Two-column layout: the main column carries the latest
 * headline and the full player overview grid; the sidebar (overview-only) stacks
 * the value trend chart, last-three positional finishes, and the latest trades.
 * Loads its own value / trend / trade / article data; positional finishes are
 * passed down from the page so the RPC runs once for both hero and sidebar.
 * Async server component.
 */

import { createClient } from "@/lib/supabase/server";
import { QuickNews, type QuickNewsArticle } from "@/components/player-profile/quick-news";
import { InjuryStatus } from "@/components/player-profile/injury-status";
import { PlayerBioOverview } from "@/components/player-profile/player-bio-overview";
import { DepthChartCard } from "@/components/player-profile/depth-chart-card";
import { OverviewSidebar } from "@/components/player-profile/overview-sidebar";
import { findPlayerTrades } from "@/lib/player-trades";
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
} from "@/lib/player-profile-cache";

async function loadLatestArticle(
  supabase: Awaited<ReturnType<typeof createClient>>,
  playerId: string,
): Promise<QuickNewsArticle | null> {
  const { data: links } = await supabase
    .from("article_players")
    .select("article_id")
    .eq("player_id", playerId);
  const ids = (links ?? []).map((l) => l.article_id);
  if (ids.length === 0) return null;
  const { data } = await supabase
    .from("articles")
    .select("title, tl_dr, published_at")
    .in("id", ids)
    .eq("status", "published")
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  return (data as QuickNewsArticle | null) ?? null;
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
  const supabase = await createClient();
  const playerName =
    player.full_name ?? `${player.first_name ?? ""} ${player.last_name ?? ""}`.trim();
  const nowMs = Date.now();

  const [valueSeries, trends, latestValue, trades, article, depthChart, projections] =
    await Promise.all([
      loadValueSeriesCached(player.id, context.formatConfigId, context.valueSourceSlug, 30),
      loadTrendsCached(player.id, context.formatConfigId, context.valueSourceSlug),
      loadLatestValueCached(player.id, context.formatConfigId, context.valueSourceSlug),
      sleeperId ? findPlayerTrades(supabase, sleeperId, { limit: 3 }) : Promise.resolve([]),
      loadLatestArticle(supabase, player.id),
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
