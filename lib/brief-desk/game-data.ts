/**
 * Every read behind the game-by-game datasets (./games.ts), for the bundle.
 *
 * Reads, all named-column and paged where they can pass 1000 rows:
 *   nfl_game_lines      the settled line per game (migration 0333), with
 *                       nfl_game_odds as the fallback for a game whose line
 *                       has not been captured yet (its home side and kickoff
 *                       are still right; its numbers may be null)
 *   nfl_teams           names and primary colours
 *   player_stats        the week's offensive lines with the team each player
 *                       played for (metadata.team) and the longest plays, and
 *                       weeks 1 to N for the season reliability lists
 *   players             names, slugs, positions and the Sleeper id for photos
 *   player_weekly_projections, through lib/projections/read.ts
 *                       loadAdjustedProjections ONLY, which resolves the
 *                       projection source itself (CLAUDE.md, Projection Engine
 *                       Source); the card shows rawPoints, the engine's own
 *                       published number before our adjustment
 *   player_value_history the value at the period's start and end per edition
 *                       format, on the source the site resolves per format
 *   league_manager_ledger_cache  the settled week's lineup grades, rolled up
 *                       across leagues and never named
 *
 * Nothing here writes. Nothing here calls Sleeper.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { loadAdjustedProjections } from "@/lib/projections/read";
import { projectionSourceDisplay } from "@/lib/projections/source-constants";
import { SLEEPER_SOURCE } from "@/lib/projections/source";
import { describeSource, getActiveFormats, getAvailableSources, resolveSourceForFormat } from "@/lib/source";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { NFL_ODDS_SOURCE_SLUG } from "@/lib/sync-nfl-odds";
import { eventIdFromMetadata } from "@/lib/sync-nfl-game-lines";
import type { WeekLine } from "./datasets";
import {
  aggregateBenchWeek,
  buildGamePlayerLinesDataset,
  buildProjectionReportDataset,
  buildWeekAwardsDataset,
  buildWeekGamesDataset,
  CARD_POSITIONS,
  type BenchWeekEntry,
  type EditionFormatRef,
  type GameLineInput,
  type GamePlayerInput,
  type GameTeamInput,
  type SeasonGradeInput,
  type ValueMove,
} from "./games";
import type { BundleDataset, BundleWeekResult } from "./types";

type Admin = SupabaseClient<Database>;

const ID_BATCH = 300;

/**
 * A scoring map with no yardage or touchdown key is "unusable" to the league
 * scorer on purpose, so the projection read falls back to the STORED column
 * closestScoringBase picks, and { rec: 1 } picks PPR. Passing null instead
 * picks standard scoring, which is not what a PPR card means.
 */
export const PPR_STORED_SCORING = { rec: 1 } as const;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function loadGameLines(admin: Admin, season: number, seasonType: string, week: number): Promise<GameLineInput[]> {
  const [{ data: settled }, { data: odds }] = await Promise.all([
    admin
      .from("nfl_game_lines")
      .select(
        "espn_event_id, home_team, away_team, kickoff_at, provider, open_home_spread, close_home_spread, open_game_total, close_game_total, home_moneyline, away_moneyline",
      )
      .eq("source", NFL_ODDS_SOURCE_SLUG)
      .eq("season", season)
      .eq("season_type", seasonType)
      .eq("week", week),
    admin
      .from("nfl_game_odds")
      .select("home_team, away_team, kickoff_at, provider, game_total, home_spread, metadata")
      .eq("source", NFL_ODDS_SOURCE_SLUG)
      .eq("season", season)
      .eq("season_type", seasonType)
      .eq("week", week),
  ]);
  const out: GameLineInput[] = (settled ?? []).map((r) => ({
    espn_event_id: r.espn_event_id,
    home_team: r.home_team,
    away_team: r.away_team,
    kickoff_at: r.kickoff_at,
    provider: r.provider,
    open_home_spread: num(r.open_home_spread),
    close_home_spread: num(r.close_home_spread),
    open_game_total: num(r.open_game_total),
    close_game_total: num(r.close_game_total),
    home_moneyline: num(r.home_moneyline),
    away_moneyline: num(r.away_moneyline),
  }));
  const haveHome = new Set(out.map((g) => g.home_team));
  for (const r of odds ?? []) {
    if (haveHome.has(r.home_team)) continue;
    out.push({
      espn_event_id: eventIdFromMetadata(r.metadata),
      home_team: r.home_team,
      away_team: r.away_team,
      kickoff_at: r.kickoff_at,
      provider: r.provider,
      open_home_spread: null,
      close_home_spread: num(r.home_spread),
      open_game_total: null,
      close_game_total: num(r.game_total),
      home_moneyline: null,
      away_moneyline: null,
    });
  }
  return out;
}

type StatExtra = {
  player_id: string;
  team: string | null;
  gp: number | null;
  pass_lng: number | null;
  rush_lng: number | null;
  rec_lng: number | null;
};

async function loadStatExtras(admin: Admin, season: number, seasonType: string, week: number): Promise<Map<string, StatExtra>> {
  const rows = await fetchAllRows<StatExtra>("brief desk game extras", (from, to) =>
    admin
      .from("player_stats")
      .select("player_id, team:metadata->>team, gp, pass_lng, rush_lng, rec_lng")
      .eq("season", season)
      .eq("season_type", seasonType)
      .eq("week", week)
      .order("player_id", { ascending: true })
      .range(from, to) as unknown as PromiseLike<{ data: StatExtra[] | null; error: { message: string } | null }>,
  );
  return new Map(rows.map((r) => [r.player_id, r]));
}

type PlayerRow = {
  id: string;
  slug: string;
  full_name: string | null;
  first_name: string;
  last_name: string;
  position: string | null;
  team: string | null;
  external_ids: unknown;
};

async function loadPlayerRows(admin: Admin, ids: string[]): Promise<Map<string, PlayerRow>> {
  const out = new Map<string, PlayerRow>();
  for (const batch of chunk([...new Set(ids)], ID_BATCH)) {
    const { data } = await admin
      .from("players")
      .select("id, slug, full_name, first_name, last_name, position, team, external_ids")
      .in("id", batch);
    for (const p of data ?? []) out.set(p.id, p as PlayerRow);
  }
  return out;
}

function sleeperIdOf(externalIds: unknown): string | null {
  const v = (externalIds as { sleeper?: unknown } | null)?.sleeper;
  const text = typeof v === "number" ? String(v) : typeof v === "string" ? v : "";
  return /^[0-9A-Za-z]{1,12}$/.test(text) ? text : null;
}

function nameOf(p: PlayerRow): string {
  return p.full_name ?? `${p.first_name} ${p.last_name}`.trim();
}

/** Per player per edition format, the value at the period's start and end. */
async function loadValueMoves(
  admin: Admin,
  playerIds: string[],
  formatSlugs: readonly string[],
  periodStart: string,
  periodEnd: string,
): Promise<{ moves: Map<string, Record<string, ValueMove>>; formats: EditionFormatRef[] }> {
  const [formats, registry] = await Promise.all([getActiveFormats(admin), getAvailableSources(admin)]);
  const moves = new Map<string, Record<string, ValueMove>>();
  const refs: EditionFormatRef[] = [];
  // A week of slack before the start finds the last value on or before it even
  // when a nightly sync skipped a day.
  const windowStart = new Date(new Date(periodStart).getTime() - 7 * 86_400_000).toISOString();
  for (const slug of formatSlugs) {
    const format = formats.find((f) => f.slug === slug);
    if (!format) continue;
    const resolved = resolveSourceForFormat(registry, "player_value_history", slug, null);
    refs.push({ slug, display: format.display_name, sourceDisplay: resolved.source ? describeSource(registry, resolved.source) : null });
    if (!resolved.source) continue;
    const source = resolved.source;
    for (const batch of chunk(playerIds, ID_BATCH)) {
      const rows = await fetchAllRows<{ player_id: string; value: number; captured_at: string }>("brief desk value moves", (from, to) =>
        admin
          .from("player_value_history")
          .select("player_id, value, captured_at")
          .eq("format_config_id", format.id)
          .eq("source", source)
          .in("player_id", batch)
          .gte("captured_at", windowStart)
          .lte("captured_at", periodEnd)
          .order("player_id", { ascending: true })
          .order("captured_at", { ascending: true })
          .range(from, to),
      );
      const startMs = new Date(periodStart).getTime();
      for (const r of rows) {
        const entry = moves.get(r.player_id) ?? {};
        const move = entry[slug] ?? { start: null, end: null };
        // Rows arrive oldest first, so the last write on each side wins.
        if (new Date(r.captured_at).getTime() <= startMs) move.start = Number(r.value);
        move.end = Number(r.value);
        entry[slug] = move;
        moves.set(r.player_id, entry);
      }
    }
  }
  return { moves, formats: refs };
}

/** The settled week's lineup grades across every league that has one. */
async function loadBenchWeek(admin: Admin, season: number, week: number): Promise<BenchWeekEntry[]> {
  type LedgerRow = { league_id: string; weeks: unknown };
  const rows = await fetchAllRows<LedgerRow>("brief desk bench week", (from, to) =>
    admin
      .from("league_manager_ledger_cache")
      .select("league_id, weeks")
      .eq("season", season)
      .order("id", { ascending: true })
      .range(from, to),
  );
  const out: BenchWeekEntry[] = [];
  for (const r of rows) {
    if (!Array.isArray(r.weeks)) continue;
    for (const w of r.weeks as Array<Record<string, unknown>>) {
      if (num(w.week) !== week) continue;
      const left = num(w.pointsLeft);
      if (left === null) continue;
      const miss = w.biggestMiss as Record<string, unknown> | null | undefined;
      const gain = num(miss?.gain);
      out.push({
        leagueId: r.league_id,
        pointsLeft: left,
        outcome: typeof w.outcome === "string" ? w.outcome : null,
        bestLineupOutcome: typeof w.bestLineupOutcome === "string" ? w.bestLineupOutcome : null,
        // An empty slot carries no outPlayerId; only a real benching counts.
        biggestMiss:
          miss &&
          gain !== null &&
          typeof miss.inName === "string" &&
          typeof miss.outName === "string" &&
          typeof miss.outPlayerId === "string" &&
          miss.outPlayerId.length > 0
            ? { gain, inName: miss.inName, outName: miss.outName, inPoints: num(miss.inPoints) ?? 0, outPoints: num(miss.outPoints) ?? 0 }
            : null,
      });
    }
  }
  return out;
}

export interface GameDatasetsInput {
  season: number;
  seasonType: "regular" | "post";
  week: number;
  periodStart: string;
  periodEnd: string;
  /** The bundle's week lines (offense and defense), already loaded. */
  lines: WeekLine[];
  /** The bundle's derived finals. */
  results: Map<string, BundleWeekResult>;
  /** The two edition format slugs; the first is the dynasty format. */
  formatSlugs: readonly string[];
  computedAt: string;
}

export interface GameIndexEntry {
  game_key: string;
  away: string;
  home: string;
  recap_url: string | null;
  /** Player ids on this game's card, for the fun-stat check. */
  player_ids: string[];
}

export interface GameDatasetsResult {
  datasets: Record<string, BundleDataset>;
  index: GameIndexEntry[];
  projectionSource: string;
}

/**
 * The four game datasets plus an index of games for the desk run, or null
 * datasets when the week has no finished game the line table knows about.
 */
export async function loadGameDatasets(admin: Admin, input: GameDatasetsInput): Promise<GameDatasetsResult> {
  const { season, seasonType, week, computedAt } = input;
  const [gameLines, teamRows, extras] = await Promise.all([
    loadGameLines(admin, season, seasonType, week),
    admin.from("nfl_teams").select("abbreviation, name, primary_color"),
    loadStatExtras(admin, season, seasonType, week),
  ]);
  const teams = new Map<string, GameTeamInput>(
    (teamRows.data ?? []).map((t) => [t.abbreviation, { abbreviation: t.abbreviation, name: t.name, primary_color: t.primary_color }]),
  );
  const weekGames = buildWeekGamesDataset({ season, week, lines: gameLines, results: input.results, teams, computedAt });
  if (weekGames.rows.length === 0) return { datasets: {}, index: [], projectionSource: SLEEPER_SOURCE };

  const gameByTeam = new Map<string, string>();
  for (const g of weekGames.rows) {
    gameByTeam.set(String(g.away), String(g.game_key));
    gameByTeam.set(String(g.home), String(g.game_key));
  }

  // Candidates: every offensive line from a team that played in a carded game.
  const lineIds = input.lines.map((l) => l.player_id);
  const players = await loadPlayerRows(admin, lineIds);
  const candidates = input.lines.filter((l) => {
    const p = players.get(l.player_id);
    const team = extras.get(l.player_id)?.team?.toUpperCase();
    return p && (CARD_POSITIONS as readonly string[]).includes((p.position ?? "").toUpperCase()) && team && gameByTeam.has(team);
  });
  const candidateIds = candidates.map((l) => l.player_id);
  const positionByPlayer = new Map(candidateIds.map((id) => [id, (players.get(id)!.position ?? "").toUpperCase()]));

  // Weeks 1..N in one read: this week's projection for the card, the earlier
  // weeks for the season lists. The read resolves its own source.
  const projections = await loadAdjustedProjections({
    supabase: admin,
    playerIds: candidateIds,
    season,
    fromWeek: 1,
    toWeek: week,
    scoringSettings: { ...PPR_STORED_SCORING },
    positionByPlayer,
    currentWeek: week,
  });
  const projectionDisplay = projectionSourceDisplay(projections.source);

  const { moves, formats } = await loadValueMoves(admin, candidateIds, input.formatSlugs, input.periodStart, input.periodEnd);

  const gamePlayers: GamePlayerInput[] = candidates.map((line) => {
    const p = players.get(line.player_id)!;
    const extra = extras.get(line.player_id);
    const proj = projections.byPlayer.get(line.player_id)?.byWeek.get(week)?.rawPoints ?? null;
    return {
      player_id: line.player_id,
      name: nameOf(p),
      slug: p.slug,
      position: p.position,
      team: extra?.team?.toUpperCase() ?? null,
      sleeper_id: sleeperIdOf(p.external_ids),
      line: { ...line, pass_lng: extra?.pass_lng ?? null, rush_lng: extra?.rush_lng ?? null, rec_lng: extra?.rec_lng ?? null, gp: extra?.gp ?? null },
      projected: proj,
      values: moves.get(line.player_id) ?? {},
    };
  });
  const playerLines = buildGamePlayerLinesDataset({
    week,
    gameByTeam,
    players: gamePlayers,
    formats,
    projectionDisplay,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    computedAt,
  });

  // Season grading: actual PPR for weeks 1..N for the same players.
  type SeasonStat = { player_id: string; week: number; pts_ppr: number | null; gp: number | null };
  const seasonStats: SeasonStat[] = [];
  for (const batch of chunk(candidateIds, ID_BATCH)) {
    const rows = await fetchAllRows<SeasonStat>("brief desk season grades", (from, to) =>
      admin
        .from("player_stats")
        .select("player_id, week, pts_ppr, gp")
        .eq("season", season)
        .eq("season_type", seasonType)
        .lte("week", week)
        .in("player_id", batch)
        .order("player_id", { ascending: true })
        .order("week", { ascending: true })
        .range(from, to),
    );
    seasonStats.push(...rows);
  }
  const actualBy = new Map<string, number>();
  for (const s of seasonStats) {
    if ((s.gp ?? 0) > 0 && s.pts_ppr !== null) actualBy.set(`${s.player_id}:${s.week}`, Number(s.pts_ppr));
  }
  const season_: SeasonGradeInput[] = [];
  const weekRows: Array<{ position: string; projected: number; actual: number }> = [];
  for (const id of candidateIds) {
    const p = players.get(id)!;
    const byWeek = projections.byPlayer.get(id)?.byWeek;
    const weeks: SeasonGradeInput["weeks"] = [];
    for (let w = 1; w <= week; w++) {
      const projected = byWeek?.get(w)?.rawPoints ?? null;
      const actual = actualBy.get(`${id}:${w}`);
      if (projected === null || projected <= 0 || actual === undefined) continue;
      weeks.push({ week: w, projected, actual });
      if (w === week) weekRows.push({ position: (p.position ?? "").toUpperCase(), projected, actual });
    }
    season_.push({
      player_id: id,
      name: nameOf(p),
      slug: p.slug,
      position: p.position,
      team: extras.get(id)?.team?.toUpperCase() ?? p.team,
      sleeper_id: sleeperIdOf(p.external_ids),
      weeks,
    });
  }
  const projectionReport = buildProjectionReportDataset({ week, weekRows, season: season_, projectionDisplay, computedAt });

  const bench = aggregateBenchWeek(await loadBenchWeek(admin, season, week));
  const dynasty = formats[0] ?? null;
  const awards = buildWeekAwardsDataset({
    week,
    games: weekGames,
    playerLines,
    dynastySlug: dynasty?.slug ?? null,
    dynastyDisplay: dynasty?.display ?? null,
    bench,
    projectionDisplay,
    computedAt,
  });

  const index: GameIndexEntry[] = weekGames.rows.map((g) => ({
    game_key: String(g.game_key),
    away: String(g.away),
    home: String(g.home),
    recap_url: typeof g.recap_url === "string" ? g.recap_url : null,
    player_ids: playerLines.rows.filter((r) => r.game_key === g.game_key).map((r) => String(r.player_id)),
  }));

  return {
    datasets: {
      week_games: weekGames,
      game_player_lines: playerLines,
      week_awards: awards,
      projection_report: projectionReport,
    },
    index,
    projectionSource: projections.source,
  };
}
