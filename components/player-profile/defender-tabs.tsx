/**
 * The defender variant of the profile's Overview and Statistics sections
 * (plan IDP-203 to IDP-206, R-14).
 *
 * Kept apart from overview-tab.tsx and stats-tab.tsx rather than threaded
 * through them as a flag, so an offensive profile renders exactly the code it
 * rendered before this build. The shared pieces (news, injury, bio, depth
 * chart, finishes) are reused; everything that would print an offensive
 * column, a value or a PPR figure is replaced.
 *
 * Premium standard (plan, "every surface that can show a defender"): no
 * offensive column; "No market value" in words, never 0 or "check back";
 * every point figure names its scoring; positions spelled out for a screen
 * reader; nothing hidden on a phone (the stat tables scroll inside a named,
 * focusable frame instead of dropping columns).
 *
 * Async server components.
 */

import { Scale } from "lucide-react";
import { PageBody } from "@/components/app-shell/page-body";
import { Panel } from "@/components/dashboard-panel";
import { QuickNews } from "@/components/player-profile/quick-news";
import { InjuryStatus } from "@/components/player-profile/injury-status";
import { PlayerBioOverview } from "@/components/player-profile/player-bio-overview";
import { DepthChartCard } from "@/components/player-profile/depth-chart-card";
import { LastThreeFinishes } from "@/components/player-profile/positional-finishes";
import {
  DefenderCareerTable,
  DefenderGameLog,
  DefenderScoringProvider,
  DefenderThisWeek,
} from "@/components/player-profile/defender-scoring";
import {
  loadDefenderProfileCached,
  loadDepthChartCached,
  loadLatestArticleCached,
  resolveProfileProjectionSourceCached,
} from "@/lib/player-profile-cache";
import {
  loadReaderIdpLeagues,
  type DefenderProfileData,
  type ReaderIdpLeague,
} from "@/lib/player-profile/defender";
import { buildDefenderSummary } from "@/lib/player-profile/defender-summary";
import { subPositionPhrase } from "@/lib/player-profile/defender-depth";
import { sleeperMeta, type PlayerRow } from "@/lib/player-profile";
import { projectionSourceDisplay } from "@/lib/projections/source-constants";
import { loadSavedSleeperHandle } from "@/lib/sleeper-handle/resolve";
import { createClient } from "@/lib/supabase/server";
import { currentNflSeason } from "@/lib/nfl-season";
import { positionNoun } from "@/lib/site";
import { IDP_PRESET_LABEL, IDP_PRESETS } from "@/lib/idp/scoring-presets";
import { scoreIdpLine } from "@/lib/idp/stat-line";

/** How the stored finishes are ranked. Named beside every finish. */
export const DEFENDER_FINISH_SCORING = IDP_PRESET_LABEL.idp123;

function nameOf(player: PlayerRow): string {
  return player.full_name ?? `${player.first_name ?? ""} ${player.last_name ?? ""}`.trim();
}

/**
 * The season the game log shows: the current one when anything is known about
 * it (a game played or a week projected), otherwise the one before, so a
 * spring visit shows last season's log instead of eighteen empty rows.
 */
async function loadDefenderData(player: PlayerRow): Promise<DefenderProfileData> {
  const source = await resolveProfileProjectionSourceCached();
  const current = Number(currentNflSeason());
  const data = await loadDefenderProfileCached(player, current, source);
  const known = data.weeks.some((w) => w.status === "played" || w.projected !== null);
  if (known) return data;
  return loadDefenderProfileCached(player, current - 1, source);
}

/**
 * The reader's own IDP leagues for the scoring selector (R-16). Per request,
 * never cached across readers, and read through the saved handle only.
 */
async function loadReaderLeagues(season: number): Promise<ReaderIdpLeague[]> {
  try {
    const supabase = await createClient();
    const saved = await loadSavedSleeperHandle(supabase);
    if (!saved?.sleeperUserId) return [];
    return await loadReaderIdpLeagues(supabase, saved.sleeperUserId, season);
  } catch {
    return [];
  }
}

/** The season total the live region announces when the scoring changes. */
function seasonTotalOf(data: DefenderProfileData) {
  const played = data.weeks.filter((w) => w.status === "played");
  if (played.length === 0) return null;
  const line: Record<string, number> = {};
  for (const w of played) {
    for (const [k, v] of Object.entries(w.line)) line[k] = (line[k] ?? 0) + v;
  }
  return { season: data.season, line, games: played.length };
}

/** The market card: a fixed explanation, no chart, no "check back". */
function NoMarketValueCard({ playerName }: { playerName: string }) {
  return (
    <Panel eyebrow="Market" title="No market value" headingLevel={3}>
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-card border border-line bg-surface text-brand-cyan"
        >
          <Scale className="h-4 w-4" />
        </span>
        <p className="text-sm leading-relaxed text-ink-muted">
          No value source prices defensive players, so {playerName} has no trade value or value
          trend. Trades that include him are graded on the other pieces only, and say so.
        </p>
      </div>
    </Panel>
  );
}

export async function DefenderOverviewTab({
  player,
  finishesLast3,
}: {
  player: PlayerRow;
  finishesLast3: { season: number; finish: number }[];
}) {
  const playerName = nameOf(player);
  const surname =
    player.last_name && player.last_name.trim() ? player.last_name : playerName.split(" ").slice(-1)[0];

  const [data, depthChart, article] = await Promise.all([
    loadDefenderData(player),
    loadDepthChartCached(player),
    loadLatestArticleCached(player.id),
  ]);
  const leagues = await loadReaderLeagues(data.season);
  const engine = projectionSourceDisplay(data.projectionSource);

  const lastFull = data.seasons.find((s) => s.season < Number(currentNflSeason()) && s.games > 0);
  const summary = buildDefenderSummary({
    playerName,
    playerSurname: surname,
    position: player.position,
    scoringLabel: DEFENDER_FINISH_SCORING,
    lastThreeFinishes: finishesLast3,
    snapShare:
      lastFull && lastFull.avgSnapPct !== null
        ? { season: lastFull.season, pct: lastFull.avgSnapPct }
        : null,
    nextWeek: data.nextWeek?.projected
      ? {
          week: data.nextWeek.week,
          points: scoreIdpLine(data.nextWeek.projected, IDP_PRESETS.idp123),
        }
      : null,
    projectionEngineDisplay: engine,
  });

  const subCode = sleeperMeta(player).depth_chart_position;
  const roomLabel = subPositionPhrase(typeof subCode === "string" ? subCode : null);

  return (
    <PageBody>
      {summary && <p className="mb-6 text-sm leading-relaxed text-ink-muted">{summary}</p>}
      <DefenderScoringProvider leagues={leagues} seasonTotal={seasonTotalOf(data)}>
        <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
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
                roomLabel={roomLabel}
              />
            )}
            <Panel
              eyebrow="Production"
              title={`${data.season} game log`}
              helper="Defensive stat lines week by week, scored as chosen above"
            >
              <DefenderGameLog season={data.season} weeks={data.weeks} playerName={playerName} />
            </Panel>
          </div>
          <aside
            aria-label="Player highlights"
            tabIndex={0}
            className="min-w-0 space-y-5 xl:sticky xl:top-[5.5rem] xl:max-h-[calc(100dvh-7rem)] xl:self-start xl:overflow-y-auto xl:pr-1 beacon-scroll"
          >
            <DefenderThisWeek
              next={data.nextWeek}
              accuracy={data.accuracy}
              playerName={playerName}
              engineDisplay={engine}
            />
            <Panel
              eyebrow="Production"
              title="Positional finishes"
              helper={`Last 3 seasons, ${DEFENDER_FINISH_SCORING}`}
              headingLevel={3}
            >
              <LastThreeFinishes
                position={player.position}
                finishes={finishesLast3}
                emptyLabel={`No ranked seasons among ${positionNoun(player.position, "plural")} yet`}
              />
            </Panel>
            <NoMarketValueCard playerName={playerName} />
          </aside>
        </div>
      </DefenderScoringProvider>
    </PageBody>
  );
}

export async function DefenderStatsTab({ player }: { player: PlayerRow }) {
  const playerName = nameOf(player);
  const data = await loadDefenderData(player);
  const leagues = await loadReaderLeagues(data.season);
  const engine = projectionSourceDisplay(data.projectionSource);
  const noun = positionNoun(player.position, "plural");

  return (
    <PageBody>
      <DefenderScoringProvider leagues={leagues} seasonTotal={seasonTotalOf(data)}>
        <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0 space-y-6">
            <DefenderThisWeek
              next={data.nextWeek}
              accuracy={data.accuracy}
              playerName={playerName}
              engineDisplay={engine}
              headingLevel={2}
            />
            <Panel
              eyebrow="Career"
              title="Season totals"
              helper="Regular season, defensive stats, scored as chosen above"
            >
              <DefenderCareerTable seasons={data.seasons} playerName={playerName} />
            </Panel>
            <Panel
              eyebrow="Production"
              title={`${data.season} game log`}
              helper="Defensive stat lines week by week, scored as chosen above"
            >
              <DefenderGameLog season={data.season} weeks={data.weeks} playerName={playerName} />
            </Panel>
          </div>
          <aside aria-label="Positional finishes" className="min-w-0">
            <Panel
              eyebrow="Production"
              title="Positional finishes"
              helper={`Every season, ranked among ${noun} in ${DEFENDER_FINISH_SCORING}`}
            >
              {data.finishes.length === 0 ? (
                <p className="text-sm text-ink-muted">No ranked seasons among {noun} yet.</p>
              ) : (
                <ol className="space-y-2">
                  {data.finishes.map((f) => (
                    <li
                      key={f.season}
                      className="flex items-center justify-between gap-3 rounded-card border border-line bg-surface/60 px-3 py-2"
                    >
                      <span className="font-mono text-sm font-semibold tabular-nums text-ink">
                        {f.season}
                      </span>
                      <span className="text-sm text-ink-muted">
                        <span className="font-mono font-bold text-ink">
                          {player.position.toUpperCase()}
                          {f.finish}
                        </span>
                        <span className="sr-only"> among {noun}</span>{" "}
                        of {f.playersRanked}, {f.totalPoints.toFixed(0)} points
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </Panel>
          </aside>
        </div>
      </DefenderScoringProvider>
    </PageBody>
  );
}
