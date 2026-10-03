import "server-only";

/**
 * What each Season Pulse page asks for, assembled from the reads in ./load.ts
 * and the pure builders beside it.
 *
 * ONE CONTEXT, RESOLVED ONCE. `resolveSeasonPulseContext` answers the four
 * things every page needs before it can draw anything: which season and week
 * it is, which scoring the reader is on, and which projection engine is in
 * force. Every function below takes that context, so two sections of one page
 * can never disagree about any of them.
 *
 * FORMAT, AND WHY NO VALUE SOURCE. The reader's format comes through the
 * ordinary preference chain (CLAUDE.md, Source and Format Sync): URL, saved
 * preference, cookie, default. Only its scoring half changes a number here.
 * These pages show points scored and points projected, never a market value,
 * so there is no value source to resolve and the header's source toggle has
 * nothing to change.
 *
 * EVERYTHING BELOW THE CONTEXT IS CACHED on exactly what it depends on. The
 * context itself reads the request (cookies, the signed-in reader), so it is
 * not, and the pages that call it are dynamic.
 */

import { CACHE_TAGS, CACHE_TTL } from "@/lib/cache-tags";
import { createClient } from "@/lib/supabase/server";
import { getActiveFormats } from "@/lib/source";
import { resolveFormatSlug } from "@/lib/preferences";
import { resolveSeasonClock } from "@/lib/start-sit/clock";
import { currentProjectionSourceCached } from "@/lib/projections/current-source";
import { projectionSourceDisplay } from "@/lib/projections/source-constants";
import { buildWeekGamesDataset, type GameTeamInput } from "@/lib/brief-desk/games";
import type { BundleWeekResult } from "@/lib/brief-desk/types";
import { buildSeasonBoard, scoringFor } from "./board";
import {
  buildDefenseGrid,
  buildPreview,
  buildTeamRecords,
  rankTotals,
  teamNickname,
  type FinalInput,
} from "./games";
import {
  cached,
  loadDefenseSplitsCached,
  loadGameLinesCached,
  loadPlayerRefsCached,
  loadSeasonFinalsCached,
  loadSeasonProjectionsCached,
  loadSeasonRows,
  loadTeamsCached,
  loadWeekRecapsCached,
  loadWeekRowsCached,
  loadWeekScheduleCached,
  loadWeekWeatherCached,
  type TeamInfo,
} from "./load";
import {
  SPOTLIGHT_POSITIONS,
  buildProjectionReport,
  buildWeekPerformances,
  buildWeekSpotlights,
  gradeWeeks,
} from "./week-report";
import { lastCompletedWeek, throughWeek } from "./weeks";
import type {
  DefenseVsPositionRow,
  GameResult,
  PlayerRef,
  ProjectionReport,
  SeasonBoard,
  SeasonScoring,
  TeamRecord,
  TeamSide,
  UpcomingGame,
  WeekPerformance,
  WeekSpotlights,
} from "./types";

export type SeasonPulseContext = {
  /** Null before any projection season is stored. Every page then says so. */
  season: number | null;
  /** The live week, 1 to 19. 19 once the regular season is over. */
  currentWeek: number;
  /** The last week there can be a stat row for. */
  throughWeek: number;
  /** The newest week every game of has been played. */
  lastCompletedWeek: number;
  scoring: SeasonScoring;
  formatName: string;
  /** The projection source slug in force for the season so far. */
  projectionSource: string;
  /**
   * The cache key part for anything holding a projection: the source for the
   * season so far AND the source for the live week, which are resolved over
   * different windows and can differ (lib/season-pulse/load.ts).
   */
  projectionKey: string;
};

export async function resolveSeasonPulseContext(params: {
  format?: string | string[];
}): Promise<SeasonPulseContext> {
  const supabase = await createClient();
  const [formatResolution, formats, clock] = await Promise.all([
    resolveFormatSlug(supabase, params.format),
    getActiveFormats(supabase),
    resolveSeasonClock(supabase),
  ]);
  const format = formats.find((f) => f.slug === formatResolution.slug) ?? formats.find((f) => f.is_default) ?? null;
  const scoring = scoringFor({
    scoring_type: format?.scoring_type ?? "ppr",
    te_premium_bonus: format?.te_premium_bonus ?? null,
  });
  const through = throughWeek(clock.currentWeek);
  const projectionSource =
    clock.season !== null && through >= 1
      ? await currentProjectionSourceCached({ season: clock.season, fromWeek: 1, toWeek: through })
      : await currentProjectionSourceCached();
  const liveSource =
    clock.season !== null && clock.currentWeek >= 1 && clock.currentWeek <= through
      ? await currentProjectionSourceCached({
          season: clock.season,
          fromWeek: clock.currentWeek,
          toWeek: clock.currentWeek,
        })
      : projectionSource;

  return {
    season: clock.season,
    currentWeek: clock.currentWeek,
    throughWeek: through,
    lastCompletedWeek: lastCompletedWeek(clock.currentWeek),
    scoring,
    formatName: format?.display_name ?? scoring.label,
    projectionSource,
    projectionKey: `${projectionSource}|${liveSource}`,
  };
}

/* ---------- Shared helpers ---------- */

function scoringOf(base: string, tePremium: number): SeasonScoring {
  return scoringFor({
    scoring_type: base === "pts_ppr" ? "ppr" : base === "pts_half_ppr" ? "half_ppr" : "standard",
    te_premium_bonus: tePremium,
  });
}

function refMap(refs: readonly PlayerRef[]): Map<string, PlayerRef> {
  return new Map(refs.map((r) => [r.id, r]));
}

/* ---------- The leaders board ---------- */

async function buildBoard(
  season: number,
  through: number,
  completed: number,
  base: string,
  tePremium: number,
): Promise<SeasonBoard> {
  const [rows, refs] = await Promise.all([loadSeasonRows(season, through), loadPlayerRefsCached(season, through)]);
  return buildSeasonBoard({
    season,
    throughWeek: through,
    lastCompletedWeek: completed,
    scoring: scoringOf(base, tePremium),
    rows,
    players: refMap(refs),
    computedAt: new Date().toISOString(),
  });
}

const loadBoardCached = cached("season-pulse-board", buildBoard, {
  revalidate: CACHE_TTL.daily,
  tags: [CACHE_TAGS.playerStats, CACHE_TAGS.playerDepth],
});

/** Every player's season to date, ranked at his position. Null before a season exists. */
export async function loadSeasonBoard(context: SeasonPulseContext): Promise<SeasonBoard | null> {
  if (context.season === null || context.throughWeek < 1) return null;
  return loadBoardCached(
    context.season,
    context.throughWeek,
    context.lastCompletedWeek,
    context.scoring.base,
    context.scoring.tePremium,
  );
}

/* ---------- One week's performances ---------- */

export type WeekReport = {
  spotlights: WeekSpotlights;
  /** The engine the projections beside each performance came from. */
  projectionSourceName: string;
};

async function buildWeekReport(
  season: number,
  week: number,
  through: number,
  currentWeek: number,
  base: string,
  tePremium: number,
  sourceKey: string,
): Promise<{ performances: WeekPerformance[]; sourceName: string }> {
  const scoring = scoringOf(base, tePremium);
  const [rows, refs, projections] = await Promise.all([
    loadWeekRowsCached(season, week),
    loadPlayerRefsCached(season, through),
    loadSeasonProjectionsCached(season, through, currentWeek, base, tePremium, sourceKey),
  ]);
  const projected = new Map<string, number>();
  for (const [playerId, weeks] of Object.entries(projections.raw)) {
    const value = weeks[week - 1];
    if (value !== null && value !== undefined) projected.set(playerId, value);
  }
  return {
    performances: buildWeekPerformances({ week, scoring, rows, players: refMap(refs), projected }),
    // The live week is read on its own window and can be another engine's.
    sourceName: projectionSourceDisplay(week === currentWeek ? projections.liveSource : projections.source),
  };
}

const loadWeekPerformancesCached = cached("season-pulse-week-performances", buildWeekReport, {
  revalidate: CACHE_TTL.hourly,
  tags: [CACHE_TAGS.playerStats, CACHE_TAGS.playerProjections],
});

function weekPerformances(context: SeasonPulseContext, week: number) {
  return loadWeekPerformancesCached(
    context.season as number,
    week,
    context.throughWeek,
    context.currentWeek,
    context.scoring.base,
    context.scoring.tePremium,
    context.projectionKey,
  );
}

/** The spotlights and top scorers for one week. Null when the week has no rows. */
export async function loadWeekReport(context: SeasonPulseContext, week: number): Promise<WeekReport | null> {
  if (context.season === null || week < 1 || week > context.throughWeek) return null;
  const { performances, sourceName } = await weekPerformances(context, week);
  if (performances.length === 0) return null;
  return { spotlights: buildWeekSpotlights(week, performances), projectionSourceName: sourceName };
}

/* ---------- The projection report ---------- */

async function buildReport(
  season: number,
  completed: number,
  through: number,
  currentWeek: number,
  base: string,
  tePremium: number,
  sourceKey: string,
): Promise<ProjectionReport | null> {
  if (completed < 1) return null;
  const scoring = scoringOf(base, tePremium);
  const [rows, refs, projections] = await Promise.all([
    loadSeasonRows(season, completed),
    loadPlayerRefsCached(season, through),
    loadSeasonProjectionsCached(season, through, currentWeek, base, tePremium, sourceKey),
  ]);
  const projected = new Map<string, number>();
  for (const [playerId, weeks] of Object.entries(projections.raw)) {
    weeks.forEach((value, index) => {
      if (value !== null && index < completed) projected.set(`${playerId}|${index + 1}`, value);
    });
  }
  const players = refMap(refs);
  const graded = gradeWeeks(rows, scoring, players, projected, completed);
  if (graded.length === 0) return null;
  return buildProjectionReport(graded, players, projectionSourceDisplay(projections.source));
}

const loadProjectionReportCached = cached("season-pulse-projection-report", buildReport, {
  revalidate: CACHE_TTL.hourly,
  tags: [CACHE_TAGS.playerStats, CACHE_TAGS.playerProjections],
});

/**
 * How the projection has done over the completed weeks of the season. Null
 * until a week has been played and graded.
 */
export async function loadProjectionReport(context: SeasonPulseContext): Promise<ProjectionReport | null> {
  if (context.season === null) return null;
  return loadProjectionReportCached(
    context.season,
    context.lastCompletedWeek,
    context.throughWeek,
    context.currentWeek,
    context.scoring.base,
    context.scoring.tePremium,
    context.projectionKey,
  );
}

/* ---------- Teams, records, points allowed ---------- */

function teamSide(
  code: string,
  teams: ReadonlyMap<string, TeamInfo>,
  score: number | null,
  implied: number | null,
): TeamSide {
  const info = teams.get(code);
  const name = info?.name ?? code;
  return { code, name, nickname: teamNickname(name), color: info?.color ?? null, score, implied };
}

async function teamMap(): Promise<Map<string, TeamInfo>> {
  return new Map((await loadTeamsCached()).map((t) => [t.code, t]));
}

/** Every team's record and scoring across the games played so far. */
export async function loadTeamRecords(context: SeasonPulseContext): Promise<TeamRecord[]> {
  if (context.season === null || context.throughWeek < 1) return [];
  const [finals, teams] = await Promise.all([
    loadSeasonFinalsCached(context.season, context.throughWeek),
    teamMap(),
  ]);
  return buildTeamRecords(finals, new Map([...teams].map(([code, t]) => [code, t.name])));
}

/** Fantasy points allowed per game by each defense to each position. */
export async function loadDefenseGrid(context: SeasonPulseContext): Promise<DefenseVsPositionRow[]> {
  if (context.season === null) return [];
  const [splits, teams] = await Promise.all([
    loadDefenseSplitsCached(context.season, context.scoring.base),
    teamMap(),
  ]);
  return buildDefenseGrid(splits, new Map([...teams].map(([code, t]) => [code, t.name])));
}

/* ---------- Results ---------- */

/** The best fantasy lines of a game. */
const TOP_LINES_PER_GAME = 3;

function finalsOfWeek(finals: readonly FinalInput[], week: number): Map<string, BundleWeekResult> {
  const out = new Map<string, BundleWeekResult>();
  for (const f of finals) {
    if (f.week !== week) continue;
    out.set(f.team, {
      opponent: f.opponent,
      points_for: f.pointsFor,
      points_against: f.pointsAgainst,
      outcome: f.pointsFor > f.pointsAgainst ? "W" : f.pointsFor < f.pointsAgainst ? "L" : "T",
      game_date: null,
    });
  }
  return out;
}

/**
 * The finished games of one week, newest data first: the final, how the line
 * fared, the best fantasy lines in the reader's scoring and, when the Beacon
 * Brief has published that week, the desk's headline with a link to its recap.
 *
 * Built on the Brief's own `buildWeekGamesDataset`, so a final and a cover on
 * this page are the same figures the edition printed.
 */
export async function loadWeekResults(context: SeasonPulseContext, week: number): Promise<GameResult[]> {
  if (context.season === null || week < 1 || week > context.throughWeek) return [];
  const season = context.season;
  const [finals, lines, teams, recaps, report] = await Promise.all([
    loadSeasonFinalsCached(season, context.throughWeek),
    loadGameLinesCached(season, week),
    teamMap(),
    // A failed recap read costs the headline, never the results.
    loadWeekRecapsCached(season, week).catch(() => null),
    weekPerformances(context, week),
  ]);

  const gameTeams = new Map<string, GameTeamInput>(
    [...teams].map(([code, t]) => [code, { abbreviation: code, name: t.name, primary_color: t.color }]),
  );
  const dataset = buildWeekGamesDataset({
    season,
    week,
    lines,
    results: finalsOfWeek(finals, week),
    teams: gameTeams,
    computedAt: new Date().toISOString(),
  });

  const numberOrNull = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const textOrNull = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : null);

  return dataset.rows.map((g): GameResult => {
    const away = String(g.away);
    const home = String(g.home);
    const key = String(g.game_key);
    const recap = recaps?.games[key] ?? null;
    const topLines = report.performances
      .filter((p) => SPOTLIGHT_POSITIONS.includes(p.position) && (p.gameTeam === away || p.gameTeam === home))
      .sort((a, b) => b.points - a.points)
      .slice(0, TOP_LINES_PER_GAME);
    const totalResult = textOrNull(g.total_result);
    return {
      gameKey: key,
      week,
      kickoffAt: textOrNull(g.kickoff_at),
      away: teamSide(away, teams, numberOrNull(g.away_score), numberOrNull(g.away_implied)),
      home: teamSide(home, teams, numberOrNull(g.home_score), numberOrNull(g.home_implied)),
      winner: textOrNull(g.winner),
      spreadText: textOrNull(g.spread_text),
      coverText: textOrNull(g.cover_text),
      total: numberOrNull(g.close_total),
      totalResult: totalResult === "over" || totalResult === "under" || totalResult === "push" ? totalResult : null,
      topLines,
      recapHeadline: recap?.headline ?? null,
      recapTeaser: recap?.teaser ?? null,
      recapHref: recap && recaps ? `/brief/${recaps.slug}#game-${key.toLowerCase()}` : null,
    };
  });
}

/* ---------- Upcoming games ---------- */

/** The players projected to score the most in a game, both teams. */
const TO_WATCH_PER_GAME = 4;

/**
 * The games of a week that have no final yet, each with its forecast, its
 * written preview and the players projected to score the most.
 *
 * A game drops out of this list when both of its finals exist, so on a Friday
 * the Thursday game is a result and the other fifteen are still here.
 */
export async function loadUpcomingGames(context: SeasonPulseContext, week: number): Promise<UpcomingGame[]> {
  if (context.season === null || week < 1 || week !== context.currentWeek || week > context.throughWeek) return [];
  const season = context.season;
  const [schedule, weather, teams, finals, refs, projections, grid] = await Promise.all([
    loadWeekScheduleCached(season, week),
    loadWeekWeatherCached(season, week),
    teamMap(),
    loadSeasonFinalsCached(season, context.throughWeek),
    loadPlayerRefsCached(season, context.throughWeek),
    loadSeasonProjectionsCached(
      season,
      context.throughWeek,
      context.currentWeek,
      context.scoring.base,
      context.scoring.tePremium,
      context.projectionKey,
    ),
    loadDefenseGrid(context),
  ]);

  const played = new Set(finals.filter((f) => f.week === week).map((f) => f.team));
  const games = schedule.filter((g) => !(played.has(g.home) && played.has(g.away)));
  const totals = rankTotals(schedule);
  const defense = new Map(grid.map((row) => [row.team, row]));

  const projectedByTeam = new Map<string, (PlayerRef & { projected: number })[]>();
  for (const ref of refs) {
    const projected = projections.live[ref.id];
    if (!ref.team || projected === undefined || projected <= 0 || !SPOTLIGHT_POSITIONS.includes(ref.position)) continue;
    projectedByTeam.set(ref.team, [...(projectedByTeam.get(ref.team) ?? []), { ...ref, projected }]);
  }

  return games.map((g): UpcomingGame => {
    const away = teamSide(g.away, teams, null, g.awayImplied);
    const home = teamSide(g.home, teams, null, g.homeImplied);
    const gameWeather = weather[g.home] ?? null;
    const toWatch = [...(projectedByTeam.get(g.away) ?? []), ...(projectedByTeam.get(g.home) ?? [])]
      .sort((a, b) => b.projected - a.projected)
      .slice(0, TO_WATCH_PER_GAME)
      .map((p) => ({ ...p, gameTeam: p.team }));
    return {
      gameKey: `${g.away}-${g.home}`,
      week,
      kickoffAt: g.kickoffAt,
      away,
      home,
      homeSpread: g.homeSpread,
      total: g.total,
      venue: gameWeather?.stadium ?? g.venue,
      weather: gameWeather,
      projectedBy: projectionSourceDisplay(projections.liveSource),
      toWatch,
      preview: buildPreview({
        week,
        away,
        home,
        homeSpread: g.homeSpread,
        total: g.total,
        totalRank: totals.byHome.get(g.home) ?? null,
        rankedGames: totals.ranked,
        defense,
        // The card draws the forecast in its own weather block.
        weather: null,
      }),
    };
  });
}
