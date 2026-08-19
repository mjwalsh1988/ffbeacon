/**
 * Statistics section (server). The weekly projections, career totals by season,
 * and the weekly game log take the main column across the full width the rail
 * leaves; the condensed positional finishes (season cards, one per year, each
 * stacking the three scoring finishes) sit in a right rail that drops below the
 * tables under xl.
 *
 * The finishes used to lead the layout from the left. They are context for the
 * tables rather than the point of the section, so they now follow them in DOM
 * order too, which is also what a phone should read first. Same arrangement as
 * the League Pulse overview.
 *
 * Points are read on the server from the metadata jsonb and passed down as plain
 * GameRows so the client table needs no server imports.
 */

import { PageBody } from "@/components/app-shell/page-body";
import { Panel } from "@/components/dashboard-panel";
import { SeasonFinishesRail } from "@/components/player-profile/positional-finishes";
import { WeeklyStats } from "@/components/player-profile/weekly-stats";
import { WeeklyProjections } from "@/components/player-profile/weekly-projections";
import {
  aggregateSeasons,
  statColumns,
  StatScroll,
  beatRateOverSeason,
  weekHasElapsed,
  computeStatAccuracy,
  lineFromGame,
  type WeeklyGameRow,
  type AccuracyPoint,
  type BeatRate,
  type BeatRateWeek,
  type StatAccuracy,
  type StatAccuracyWeek,
} from "@/components/player-profile/stat-shaping";
import { getNflState, type SleeperNflState } from "@/lib/sleeper";
import {
  effectiveProjectedPoints,
  summarizeProjections,
  pointsFromProjectedSet,
  activePointsFromStatRow,
  type PlayerRow,
  type ScoringKey,
} from "@/lib/player-profile";
import {
  loadPositionalFinishesCached,
  loadWeeklyStatsCached,
  loadWeeklyProjectionsCached,
  loadProjectionsMapCached,
} from "@/lib/player-profile-cache";

export async function StatsTab({
  player,
  scoringKey,
  scoringLabel,
  tePremiumBonus = 0,
}: {
  player: PlayerRow;
  scoringKey: ScoringKey;
  scoringLabel: string;
  tePremiumBonus?: number;
}) {
  const [finishes, weeklyRaw, projections, projMap, nflState] = await Promise.all([
    loadPositionalFinishesCached(player.id),
    loadWeeklyStatsCached(player.id),
    loadWeeklyProjectionsCached(player.id),
    loadProjectionsMapCached(player.id),
    getNflState(),
  ]);
  // Upcoming weeks become clickable cards; points carry any TE premium already.
  const upcomingProjections = projections.rows.filter((r) => !r.played);
  const hasProjections = upcomingProjections.length > 0;
  const projectionCards = upcomingProjections.map((r) => ({
    week: r.week,
    opponent: r.opponent,
    team: r.team,
    points: effectiveProjectedPoints(r, scoringKey, tePremiumBonus),
    stats: r.stats,
  }));
  const projectionSummary = summarizeProjections(projections, scoringKey, tePremiumBonus);

  // Enrich each played week with actual + projected points in the active scoring
  // (TE premium applied to both). pts_ppr stays the career baseline; pts_active
  // and proj_active drive the weekly game log and the accuracy charts.
  const gameRows: WeeklyGameRow[] = weeklyRaw.map((r) => ({
    season: r.season,
    week: r.week,
    opponent: r.opponent,
    snap_pct: r.snap_pct,
    gp: r.gp,
    pass_cmp: r.pass_cmp ?? 0,
    pass_att: r.pass_att ?? 0,
    pass_yd: r.pass_yd ?? 0,
    pass_td: r.pass_td ?? 0,
    pass_int: r.pass_int ?? 0,
    rush_att: r.rush_att ?? 0,
    rush_yd: r.rush_yd ?? 0,
    rush_td: r.rush_td ?? 0,
    rec: r.rec ?? 0,
    rec_tgt: r.rec_tgt ?? 0,
    rec_yd: r.rec_yd ?? 0,
    rec_td: r.rec_td ?? 0,
    pts_ppr: r.pts_ppr ?? 0,
    pts_active: activePointsFromStatRow(r, r.rec, scoringKey, tePremiumBonus),
    proj_active: pointsFromProjectedSet(
      projMap.get(`${r.season}-${r.week}`),
      scoringKey,
      tePremiumBonus,
    ),
    proj_line: projMap.get(`${r.season}-${r.week}`)?.line ?? null,
  }));
  const seasonAggs = aggregateSeasons(gameRows);
  const cols = statColumns(player.position);

  // Weekly rows grouped by season for the client picker.
  const rowsBySeason: Record<number, WeeklyGameRow[]> = {};
  for (const r of gameRows) {
    (rowsBySeason[r.season] ??= []).push(r);
  }
  const weeklySeasons = Object.keys(rowsBySeason)
    .map(Number)
    .sort((a, b) => b - a);

  // Accuracy series for the projections section: ALWAYS the current projection
  // season (2026). The projection line spans every week; the actual line fills in
  // per week as games are played (null until then), so pre-kickoff it shows the
  // projection alone.
  const actualByKey = new Map<string, number>();
  for (const r of gameRows) {
    if ((r.gp ?? 0) > 0) actualByKey.set(`${r.season}-${r.week}`, r.pts_active);
  }
  const currentSeason = projections.season;
  const currentSeasonAccuracy: AccuracyPoint[] =
    currentSeason == null
      ? []
      : projections.rows
          .slice()
          .sort((a, b) => a.week - b.week)
          .map((row) => ({
            week: row.week,
            opponent: row.opponent,
            projected: effectiveProjectedPoints(row, scoringKey, tePremiumBonus),
            actual: actualByKey.get(`${currentSeason}-${row.week}`) ?? null,
            prior: actualByKey.get(`${currentSeason - 1}-${row.week}`) ?? null,
          }));

  // Season-wide beat rate: the denominator is every week the player's team has
  // already played (one gameRow per team game, byes excluded because they have no
  // row), not just the weeks the player suited up for. Each week pairs its
  // projection (null once Sleeper stops projecting an injured player) with the
  // actual (null when the player did not play), so a missed week counts as a miss
  // and the rate reflects the full season. Future weeks have no gameRow yet, so
  // an in-progress season is never diluted by games that have not happened.
  // Keyed by season for the game-log picker; the current projection season
  // doubles as the projections card's rate.
  const live = liveWindow(nflState, currentSeason ?? weeklySeasons[0] ?? 0);
  const beatWeeksBySeason = new Map<number, BeatRateWeek[]>();
  for (const r of gameRows) {
    const played = (r.gp ?? 0) > 0;
    const projected = pointsFromProjectedSet(
      projMap.get(`${r.season}-${r.week}`),
      scoringKey,
      tePremiumBonus,
    );
    const actual = played ? r.pts_active : null;
    const elapsed = weekHasElapsed(r.season, r.week, live) || played;
    let weeks = beatWeeksBySeason.get(r.season);
    if (!weeks) {
      weeks = [];
      beatWeeksBySeason.set(r.season, weeks);
    }
    weeks.push({ projected, actual, elapsed });
  }
  const beatRateBySeason: Record<number, BeatRate> = {};
  for (const [s, weeks] of beatWeeksBySeason) {
    const rate = beatRateOverSeason(weeks);
    if (rate) beatRateBySeason[s] = rate;
  }
  const projectionBeatRate =
    currentSeason != null ? (beatRateBySeason[currentSeason] ?? null) : null;

  // Per-stat accuracy per season: for each season, roll the weeks the player
  // actually played (with their projected component line) into how often each
  // individual stat met/beat projection and the average differential. Only played
  // weeks feed this (an unplayed week has no actual to compare); the helper drops
  // stats the position never earns and weeks that carried no real projection for a
  // stat, so the breakdown reflects genuine expectations. Precomputed here so the
  // client tables receive plain, serializable rows.
  const statAccuracyBySeason: Record<number, StatAccuracy[]> = {};
  for (const [s, rows] of Object.entries(rowsBySeason)) {
    const weeks: StatAccuracyWeek[] = rows
      .filter((r) => (r.gp ?? 0) > 0)
      .map((r) => ({ actual: lineFromGame(r), projected: r.proj_line }));
    const acc = computeStatAccuracy(weeks, player.position);
    if (acc.length > 0) statAccuracyBySeason[Number(s)] = acc;
  }
  const currentSeasonStatAccuracy =
    currentSeason != null ? (statAccuracyBySeason[currentSeason] ?? []) : [];

  return (
    <PageBody>
      {/* grid-cols-1 caps the mobile track at the viewport; min-w-0 on each column
          lets it shrink below its content so inner tables/charts stay contained
          (scroll within) instead of forcing the whole page horizontally wide. */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        {/* Main column: projections, career, weekly game log */}
        <div className="min-w-0 space-y-6">
          {/* Weekly projections: distinct card-based outlook, not a stat table. */}
          {hasProjections && (
            <WeeklyProjections
              cards={projectionCards}
              position={player.position}
              scoringLabel={scoringLabel}
              season={projections.season}
              totalPoints={projectionSummary.totalPoints}
              perGame={projectionSummary.perGame}
              upcomingWeeks={projectionSummary.upcomingWeeks}
              seasonStarted={projectionSummary.seasonStarted}
              tePremiumBonus={tePremiumBonus}
              accuracyPoints={currentSeasonAccuracy}
              beatRate={projectionBeatRate}
              statAccuracy={currentSeasonStatAccuracy}
            />
          )}

          {/* Career by season */}
          <Panel
            eyebrow="Production"
            title="Career by season"
            helper="Regular-season totals. PPR points shown for a consistent baseline."
            bodyClassName="p-0"
          >
            {seasonAggs.length > 0 ? (
              <StatScroll caption={`Career regular-season totals by year`}>
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="text-left text-[11px] uppercase tracking-wider text-ink-subtle">
                    <tr className="border-b border-line">
                      <th scope="col" className="px-4 py-2.5 font-semibold">
                        Season
                      </th>
                      <th scope="col" className="px-4 py-2.5 text-right font-semibold">
                        G
                      </th>
                      {cols.map((c) => (
                        <th key={c.label} scope="col" className="px-4 py-2.5 text-right font-semibold">
                          {c.label}
                        </th>
                      ))}
                      <th scope="col" className="px-4 py-2.5 text-right font-semibold">
                        PPR
                      </th>
                      <th scope="col" className="px-4 py-2.5 text-right font-semibold">
                        PPR/G
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {seasonAggs.map((s) => {
                      const ppg = s.games > 0 ? s.line.pts_ppr / s.games : null;
                      return (
                        <tr key={s.season} className="hover:bg-surface">
                          <th
                            scope="row"
                            className="whitespace-nowrap px-4 py-2.5 text-left font-mono font-medium text-ink"
                          >
                            {s.season}
                          </th>
                          <td className="px-4 py-2.5 text-right font-mono tabular-nums text-ink-muted">
                            {s.games}
                          </td>
                          {cols.map((c) => (
                            <td
                              key={c.label}
                              className="px-4 py-2.5 text-right font-mono tabular-nums text-ink-muted"
                            >
                              {c.get(s.line)}
                            </td>
                          ))}
                          <td className="px-4 py-2.5 text-right font-mono tabular-nums text-ink">
                            {s.line.pts_ppr.toFixed(1)}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono font-semibold tabular-nums text-brand-cyan">
                            {ppg !== null ? ppg.toFixed(1) : "-"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </StatScroll>
            ) : (
              <p className="px-4 py-6 text-sm text-ink-muted sm:px-5">
                No statistical history on file for this player.
              </p>
            )}
          </Panel>

          {/* Weekly game log with season picker + projection accuracy chart */}
          <Panel
            eyebrow="Game log"
            title="Weekly stats"
            helper="Week by week, earliest to latest. Choose a season to view actuals against projection."
          >
            {weeklySeasons.length > 0 ? (
              <WeeklyStats
                position={player.position}
                rowsBySeason={rowsBySeason}
                seasons={weeklySeasons}
                scoringLabel={scoringLabel}
                beatRateBySeason={beatRateBySeason}
                statAccuracyBySeason={statAccuracyBySeason}
              />
            ) : (
              <p className="text-sm text-ink-muted">No weekly stat lines on file yet.</p>
            )}
          </Panel>
        </div>

        {/* Right rail: condensed positional finishes */}
        <aside
          aria-label="Positional finishes by season"
          // Sticky from xl, scrolling inside itself: a long career puts one
          // card per season in here and that outgrows a viewport. See the
          // matching rail on the overview section.
          tabIndex={0}
          className="min-w-0 xl:sticky xl:top-[5.5rem] xl:max-h-[calc(100dvh-7rem)] xl:self-start xl:overflow-y-auto xl:pr-1 beacon-scroll"
        >
          <Panel
            eyebrow="Production"
            title="Positional finishes"
            helper="Season-end rank within position, per scoring format."
          >
            <SeasonFinishesRail position={player.position} finishes={finishes} />
          </Panel>
        </aside>
      </div>
    </PageBody>
  );
}

/**
 * Translate the live Sleeper NFL state into the (season, lastCompletedWeek)
 * window the beat-rate elapsed check needs. During the regular season only weeks
 * before the current one are complete; once the season reaches the post/off
 * phase every regular week (through 18) is done; the preseason has none. When
 * Sleeper is unreachable we return a window with lastCompletedWeek -1 for the
 * fallback season, so completed prior seasons still count fully and the current
 * season leans on per-week played evidence rather than penalizing missed weeks
 * we cannot confirm have elapsed.
 */
function liveWindow(
  state: SleeperNflState | null,
  fallbackSeason: number,
): { season: number; lastCompletedWeek: number } {
  if (!state) return { season: fallbackSeason, lastCompletedWeek: -1 };
  const season = Number(state.season);
  const type = state.season_type;
  const lastCompletedWeek =
    type === "post" || type === "off"
      ? 18
      : type === "pre"
        ? 0
        : Math.max(0, Number(state.week) - 1);
  return {
    season: Number.isFinite(season) ? season : fallbackSeason,
    lastCompletedWeek,
  };
}
