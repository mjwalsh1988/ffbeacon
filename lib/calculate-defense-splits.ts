/**
 * Rebuild nfl_defense_vs_position: how generous each NFL defense is to each
 * fantasy position.
 *
 * Why we compute this ourselves rather than trusting the projection feed:
 * Sleeper's weekly projections barely move across a season. Measured on the
 * 2026 slate, a player's best and worst projected week differ by only 2.6% to
 * 5.4%, which means Sleeper is publishing a season average with a rounding
 * error attached rather than a real opponent adjustment. Strength of schedule
 * built on those numbers would rank every team identically.
 *
 * We have what we need to do it properly: player_stats holds 228k regular
 * season rows back to 2020, with `opponent` populated on every one.
 *
 * Method, per (season, position, scoring):
 *   1. For each game, take the fantasy points each player scored against the
 *      defense they faced.
 *   2. Keep only startable performances. A defense is not "generous" because a
 *      practice squad receiver caught one pass against them, so we rank players
 *      within each team-week and keep the top N at each position, N being how
 *      many of that position a normal lineup starts.
 *   3. Average per game faced, compare to the league average, clamp. That is
 *      `points_allowed_per_game` and `multiplier`, the raw measurement.
 *   4. Remove the schedule's fingerprint (see below) to get
 *      `adjusted_points_allowed_per_game` and `adjusted_multiplier`.
 *   5. Shrink to the signal that actually persists, giving `shrunk_multiplier`,
 *      which is the only one of the three that readers apply.
 *
 * WHAT STEPS 4 AND 5 FIXED, AND WHY BOTH WERE NEEDED
 *
 * Step 3 alone was the whole calc until 2026-09-01, and two separate things
 * were wrong with applying its output directly.
 *
 * FIRST, SCHEDULE BIAS. Raw points allowed credits a defense for the offenses
 * it happened to face. A defense that drew the six best offenses in the league
 * looks generous and one that drew the six worst looks stingy, and neither
 * conclusion is about the defense. `lib/projections/adjust.ts` removes exactly
 * that shared component with the standard alternating-ratings iteration, using
 * the offense on the other side of each game, which `metadata->>'team'` carries
 * on 100% of regular season rows back to 2021 (verified 2026-09-01, 32 distinct
 * teams every season). This is the same correction the industry publishes as
 * Ultimate Strength of Schedule or Schedule-Adjusted Fantasy Points Allowed.
 *
 * SECOND, THE SIGNAL BARELY PERSISTS. Measured on this very table on
 * 2026-09-01, the year over year correlation of the raw multiplier from 2024
 * into 2025, all 32 teams, PPR:
 *
 *     DEF 0.319   RB 0.243   TE 0.152   K 0.147   QB 0.107   WR -0.097
 *
 * Published work agrees: 4for4 measured fantasy points allowed at QB 0.27, RB
 * 0.23 and "very little" for receivers, with only 30% of top-five quarterback
 * defenses repeating the following year. We were applying a plus or minus 15%
 * swing to all six positions equally, including one that measured NEGATIVE in
 * our own data. `shrunk_multiplier` pulls each adjusted multiplier back toward
 * 1.0 by that position's own measured reliability and by how many games it was
 * measured over.
 *
 * The clamps were load bearing rather than cosmetic, which is how the problem
 * stayed invisible: 49 of 96 team-defense rows and 17 of 96 tight end rows sat
 * pinned at the 0.80 or 1.25 bound, so the raw ratios were wilder than anything
 * the table ever showed.
 *
 * All three multipliers are stored side by side, the same way
 * player_projection_accuracy keeps `mean_ratio` (what we measured) apart from
 * `shrunk_multiplier` (what we apply). Anyone can re-derive one from the others
 * and check this file's arithmetic against the table.
 *
 * Derived from internal data, so no metadata column. Run after the stats sync.
 */

import { isDefender } from "./site";
import { IDP_PRESETS } from "./idp/scoring-presets";
import { scoreIdpLine } from "./idp/stat-line";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import {
  DEFAULT_POWER_PULSE_SETTINGS,
  mergePowerPulseSettings,
  type PowerPulseSettings,
} from "./power-pulse/default-settings";
import {
  adjustForOpponents,
  clampMultiplier,
  shrinkMultiplier,
  type PositionGame,
} from "./projections/adjust";

type ServiceClient = SupabaseClient<Database>;

const PAGE = 1000;

/**
 * The scoring bases we publish splits for. idp123 (Sleeper's default IDP
 * scoring) is the defenders' base and ONLY theirs: a defender has no PPR
 * figure worth reading and an offensive player has no idp123 one, so each
 * cross case scores null and never enters a bucket (plan IDP-118).
 */
export const SCORING_BASES = ["pts_ppr", "pts_half_ppr", "pts_std", "idp123"] as const;
export type ScoringBase = (typeof SCORING_BASES)[number];

const POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF", "DL", "LB", "DB"] as const;
export type Position = (typeof POSITIONS)[number];

/**
 * How many of each position a typical lineup starts league-wide. Used to keep
 * deep-bench performances from diluting a defense's average.
 */
const STARTABLE_PER_TEAM: Record<Position, number> = {
  QB: 1,
  RB: 3,
  WR: 4,
  TE: 2,
  K: 1,
  DEF: 1,
  // Defenders: a defensive front and secondary field more players than an IDP
  // lineup starts, so the cap is the starters an offense typically faces.
  DL: 4,
  LB: 3,
  DB: 4,
};

/** Multiplier bounds. A defense cannot swing a projection more than this. */
const MIN_MULTIPLIER = 0.8;
const MAX_MULTIPLIER = 1.25;

/** Seasons with fewer sampled games than this are not published. */
const MIN_GAMES = 4;

/**
 * How many alternating passes the opponent adjustment makes. Four converges
 * comfortably on a 32 team round robin; see lib/projections/adjust.ts.
 */
const ADJUSTMENT_ITERATIONS = 4;

export type StatRow = {
  player_id: string | null;
  season: number;
  week: number;
  /** The DEFENSE this player faced. */
  opponent: string | null;
  /**
   * The OFFENSE this player played for, read from the preserved Sleeper
   * payload. player_stats has no `team` column, and a player's CURRENT team on
   * `players` is the wrong answer for a historical row: a receiver traded in
   * March would retroactively credit his new team with last season's output.
   */
  offense_team: string | null;
  gp: number | null;
  pts_ppr: number | null;
  pts_half_ppr: number | null;
  pts_std: number | null;
  /** idp123 points from the typed IDP columns. Null for anyone without them. */
  idp123: number | null;
  position: string | null;
};

export type DefenseSplitsResult = {
  seasons: number[];
  rowsWritten: number;
  durationMs: number;
};

/** idp123 from a row's typed IDP columns, or null when it carries none. */
export function idp123FromColumns(row: Record<string, unknown>): number | null {
  const line: Record<string, number> = {};
  let any = false;
  for (const key of Object.keys(IDP_PRESETS.idp123)) {
    const value = row[key];
    const n = typeof value === "number" ? value : value === null || value === undefined ? NaN : Number(value);
    if (Number.isFinite(n)) {
      line[key] = n;
      any = true;
    }
  }
  return any ? scoreIdpLine(line, IDP_PRESETS.idp123) : null;
}

export async function runCalculateDefenseSplits(
  supabase: ServiceClient,
  options: { seasons?: number[] } = {},
): Promise<DefenseSplitsResult> {
  const started = Date.now();

  const settings = await loadSettings(supabase);
  const seasons = options.seasons ?? (await recentSeasons(supabase));
  let rowsWritten = 0;

  // Every season's read starts now and runs at once; the writes below still go
  // season by season in the same order. Each read is the same single keyset
  // stream as before, so its rows arrive in the same order. A read's rejection
  // is held (the no-op catch) until the loop reaches that season, so the
  // seasons before a failed one are written and the ones after are not,
  // exactly as when each read started only after the previous season's writes.
  const pendingReads = seasons.map((season) => {
    const read = loadSeasonStats(supabase, season);
    read.catch(() => {});
    return read;
  });

  for (let index = 0; index < seasons.length; index += 1) {
    const season = seasons[index];
    const rows = await pendingReads[index];
    if (rows.length === 0) {
      console.log(`  ${season}: no stats, skipped`);
      continue;
    }

    for (const scoring of SCORING_BASES) {
      const written = await buildSeasonScoring(supabase, season, scoring, rows, settings);
      rowsWritten += written;
      console.log(`  ${season} ${scoring}: ${written} defense rows`);
    }
  }

  return { seasons, rowsWritten, durationMs: Date.now() - started };
}

async function loadSettings(supabase: ServiceClient): Promise<PowerPulseSettings> {
  try {
    const { data } = await supabase
      .from("league_power_pulse_settings")
      .select("settings")
      .eq("id", "global")
      .maybeSingle();
    if (data?.settings) return mergePowerPulseSettings(data.settings);
  } catch {
    // Fall through to defaults. A missing settings row is the fresh-database
    // case, not a failure, and the code defaults are a complete document.
  }
  return DEFAULT_POWER_PULSE_SETTINGS;
}

/**
 * The last three seasons that have stats.
 *
 * Deliberately picked from the DATA rather than from the clock, so the first
 * week of a new season starts producing rows for it on its own. Readers ask for
 * the current season first through `defenseSeasonsFor` in
 * lib/projections/defense-seasons.ts, and the sample-size shrink in
 * `shrunk_multiplier` is what makes a three-game season safe to read: it
 * contributes at 3/(3+priorGames) strength rather than being trusted whole or
 * ignored until some arbitrary game count.
 */
/**
 * The newest regular season we hold stats for, and the two before it.
 *
 * A FAILED read throws. It used to fall through to the calendar year, which
 * rebuilt the wrong three seasons and let recordCronRun mark the run a
 * success. Only an EMPTY table (a fresh database) uses the calendar fallback.
 */
export async function recentSeasons(supabase: ServiceClient): Promise<number[]> {
  const { data, error } = await supabase
    .from("player_stats")
    .select("season")
    .eq("season_type", "regular")
    .order("season", { ascending: false })
    .limit(1);
  if (error) throw new Error(`defense splits season lookup failed: ${error.message}`);
  const latest = data?.[0]?.season ? Number(data[0].season) : new Date().getFullYear() - 1;
  return [latest, latest - 1, latest - 2];
}

export async function loadSeasonStats(supabase: ServiceClient, season: number): Promise<StatRow[]> {
  const out: StatRow[] = [];
  // Keyset paging (id > last), not offset: the typed IDP columns make every page
  // wider, and a deep offset over a 50,000-row season is what times out.
  for (let lastId = ""; ; ) {
    // `offense_team:metadata->>team` pulls one key out of the preserved Sleeper
    // payload rather than the whole object. Selecting `metadata` outright would
    // drag roughly a kilobyte of stat lines per row across 40,000 rows a season
    // to read a three character team code.
    const { data, error } = await supabase
      .from("player_stats")
      .select(
        "id, player_id, season, week, opponent, offense_team:metadata->>team, gp, pts_ppr, pts_half_ppr, pts_std, idp_tkl_solo, idp_tkl_ast, idp_tkl_loss, idp_sack, idp_qb_hit, idp_pass_def, idp_ff, idp_fum_rec, idp_safe, idp_blk_kick, idp_int, idp_def_td, players(position)",
      )
      .eq("season", season)
      .eq("season_type", "regular")
      .gt("id", lastId || "00000000-0000-0000-0000-000000000000")
      .order("id", { ascending: true })
      .limit(PAGE);
    if (error) throw new Error(`defense splits stat load failed: ${error.message}`);
    if (!data || data.length === 0) break;
    lastId = data[data.length - 1].id;
    for (const row of data) {
      const joined = (row as unknown as { players?: { position?: string } | null }).players;
      const offense = (row as unknown as { offense_team?: string | null }).offense_team;
      out.push({
        player_id: row.player_id,
        season: Number(row.season),
        week: Number(row.week),
        opponent: row.opponent,
        offense_team: typeof offense === "string" && offense.length > 0 ? offense : null,
        gp: row.gp === null ? null : Number(row.gp),
        pts_ppr: row.pts_ppr === null ? null : Number(row.pts_ppr),
        pts_half_ppr: row.pts_half_ppr === null ? null : Number(row.pts_half_ppr),
        pts_std: row.pts_std === null ? null : Number(row.pts_std),
        idp123: idp123FromColumns(row as unknown as Record<string, unknown>),
        position: joined?.position ?? null,
      });
    }
    if (data.length < PAGE) break;
  }
  return out;
}

/**
 * One performance's points under one base. A defender is scored on idp123 and
 * nothing else; an offensive player on the three PPR bases and never idp123.
 * For a defender row, `opponent` is the OFFENSE he faced, so the bucket this
 * lands in reads "what this offense gives up to linebackers", which is exactly
 * the key lib/power-pulse/project.ts looks up for him.
 */
export function pointsFor(
  row: Pick<StatRow, "position" | "pts_ppr" | "pts_half_ppr" | "pts_std" | "idp123">,
  scoring: ScoringBase,
): number | null {
  const defender = isDefender(row.position);
  if (scoring === "idp123") {
    if (!defender) return null;
    return row.idp123 === null || !Number.isFinite(row.idp123) ? null : row.idp123;
  }
  if (defender) return null;
  const value =
    scoring === "pts_half_ppr" ? row.pts_half_ppr : scoring === "pts_std" ? row.pts_std : row.pts_ppr;
  return value === null || !Number.isFinite(value) ? null : value;
}

/**
 * Group performances by (opposing team, week, position), the key every split is
 * built from. Pure, exported for the tests.
 */
export function groupPerformances(
  rows: StatRow[],
  scoring: ScoringBase,
): Map<string, { points: number[]; offense: string | null }> {
  const byGame = new Map<string, { points: number[]; offense: string | null }>();
  for (const row of rows) {
    if (!row.opponent || !row.position) continue;
    const position = row.position.toUpperCase() as Position;
    if (!POSITIONS.includes(position)) continue;
    if (!row.gp || row.gp <= 0) continue;
    const points = pointsFor(row, scoring);
    if (points === null) continue;

    const key = `${row.opponent}|${row.week}|${position}`;
    const bucket = byGame.get(key) ?? { points: [], offense: null };
    bucket.points.push(points);
    if (bucket.offense === null && row.offense_team) bucket.offense = row.offense_team;
    byGame.set(key, bucket);
  }
  return byGame;
}

/** One defense's figures at one position for one season, before any shrink. */
export type DefenseSplit = {
  team: string;
  position: Position;
  perGame: number;
  adjustedPerGame: number;
  average: number;
  multiplier: number;
  adjustedMultiplier: number;
  games: number;
};

/**
 * The raw and opponent-adjusted multiplier for every defense at every position
 * under one scoring base. Pure, and exported so the reliability calibration
 * (scripts/backtest-idp-accuracy.ts) measures exactly the figures this file
 * stores rather than a copy of the arithmetic. The shrink and the rank are
 * applied by the caller, because the shrink reads the very reliability the
 * calibration is measuring.
 */
export function computeSeasonSplits(rows: StatRow[], scoring: ScoringBase): DefenseSplit[] {
  // Group performances by (defense, week, position) so we can keep only the
  // startable ones per game. The offense is carried alongside, because every
  // row in one bucket comes from the single team that played that defense in
  // that week, so the first non-null value describes the whole bucket.
  const byGame = groupPerformances(rows, scoring);

  // Sum the startable performances each defense allowed per game, and keep the
  // per-game record rather than only the running total. The opponent adjustment
  // needs the individual games, because "who did you play" is exactly the
  // information a season total has already thrown away.
  type Accum = { total: number; games: number };
  const byDefense = new Map<string, Accum>();
  const gamesByPosition = new Map<Position, PositionGame[]>();

  for (const [key, bucket] of byGame) {
    const [team, weekRaw, position] = key.split("|");
    const cap = STARTABLE_PER_TEAM[position as Position] ?? 3;
    const top = bucket.points.sort((a, b) => b - a).slice(0, cap);
    const total = top.reduce((sum, p) => sum + p, 0);

    const defenseKey = `${team}|${position}`;
    const accum = byDefense.get(defenseKey) ?? { total: 0, games: 0 };
    accum.total += total;
    accum.games += 1;
    byDefense.set(defenseKey, accum);

    // A bucket with no offense on it cannot take part in the adjustment: we
    // would be normalising by an unknown opponent. It still counts toward the
    // RAW allowance above, because "how many points did this defense give up"
    // is answerable without knowing who scored them. Measured 2026-09-01, this
    // path is empty for every season from 2021 on, but a future ingestion gap
    // must degrade rather than silently drop games from one side of the ledger.
    if (!bucket.offense) continue;
    const list = gamesByPosition.get(position as Position) ?? [];
    list.push({
      defense: team,
      offense: bucket.offense,
      week: Number(weekRaw),
      points: total,
    });
    gamesByPosition.set(position as Position, list);
  }

  // League average per position, from the raw per-game allowances.
  const perPosition = new Map<Position, number[]>();
  for (const [key, accum] of byDefense) {
    if (accum.games < MIN_GAMES) continue;
    const position = key.split("|")[1] as Position;
    const perGame = accum.total / accum.games;
    const list = perPosition.get(position) ?? [];
    list.push(perGame);
    perPosition.set(position, list);
  }

  const averages = new Map<Position, number>();
  for (const [position, values] of perPosition) {
    const sum = values.reduce((a, b) => a + b, 0);
    averages.set(position, values.length > 0 ? sum / values.length : 0);
  }

  // The opponent adjustment, once per position over that position's own games.
  const adjustedByPosition = new Map<Position, ReturnType<typeof adjustForOpponents>>();
  for (const [position, games] of gamesByPosition) {
    adjustedByPosition.set(
      position,
      adjustForOpponents(games, { iterations: ADJUSTMENT_ITERATIONS }),
    );
  }

  const splits: DefenseSplit[] = [];
  for (const [key, accum] of byDefense) {
    if (accum.games < MIN_GAMES) continue;
    const [team, positionRaw] = key.split("|");
    const position = positionRaw as Position;
    const average = averages.get(position) ?? 0;
    if (average <= 0) continue;

    const perGame = accum.total / accum.games;
    const multiplier = clampMultiplier(perGame / average, MIN_MULTIPLIER, MAX_MULTIPLIER);

    // The adjusted pair. A position whose adjustment could not run, or a team
    // absent from it, falls back to the raw figures rather than to neutral: we
    // still know what this defense allowed, we just could not separate its own
    // part from its schedule's.
    const adjusted = adjustedByPosition.get(position);
    const rating = adjusted?.defense.get(team) ?? null;
    const adjustedPerGame =
      rating && Number.isFinite(rating.adjustedPerGame) ? rating.adjustedPerGame : perGame;
    const adjustedBase =
      adjusted && adjusted.leagueAverage > 0 ? adjusted.leagueAverage : average;
    const adjustedMultiplier = clampMultiplier(
      adjustedPerGame / adjustedBase,
      MIN_MULTIPLIER,
      MAX_MULTIPLIER,
    );

    splits.push({
      team,
      position,
      perGame,
      adjustedPerGame,
      average,
      multiplier,
      adjustedMultiplier,
      games: accum.games,
    });
  }
  return splits;
}

async function buildSeasonScoring(
  supabase: ServiceClient,
  season: number,
  scoring: ScoringBase,
  rows: StatRow[],
  settings: PowerPulseSettings,
): Promise<number> {
  const inserts: Database["public"]["Tables"]["nfl_defense_vs_position"]["Insert"][] = [];
  const rankPool = new Map<Position, Array<{ team: string; perGame: number }>>();
  const computedAt = new Date().toISOString();

  for (const split of computeSeasonSplits(rows, scoring)) {
    const { team, position, perGame, adjustedPerGame, average, multiplier, adjustedMultiplier } =
      split;
    const shrunk = shrinkMultiplier({
      adjustedMultiplier,
      gamesSampled: split.games,
      positionReliability: settings.opponent.positionReliability[position] ?? 0,
      priorGames: settings.opponent.priorGames,
      min: MIN_MULTIPLIER,
      max: MAX_MULTIPLIER,
    });

    // Ranked on the ADJUSTED figure, because the rank is shown to readers as
    // "most generous to this position" and the raw order answers a question
    // nobody asked, namely which defense had the easiest schedule.
    const pool = rankPool.get(position) ?? [];
    pool.push({ team, perGame: adjustedPerGame });
    rankPool.set(position, pool);

    inserts.push({
      team,
      season,
      position,
      scoring,
      points_allowed_per_game: round(perGame, 3),
      adjusted_points_allowed_per_game: round(adjustedPerGame, 3),
      league_average: round(average, 3),
      multiplier: round(multiplier, 4),
      adjusted_multiplier: round(adjustedMultiplier, 4),
      shrunk_multiplier: round(shrunk, 4),
      generosity_rank: null,
      games_sampled: split.games,
      computed_at: computedAt,
    });
  }

  // Rank 1 = most generous to the position.
  const rankByKey = new Map<string, number>();
  for (const [position, pool] of rankPool) {
    pool.sort((a, b) => b.perGame - a.perGame);
    pool.forEach((entry, i) => rankByKey.set(`${entry.team}|${position}`, i + 1));
  }
  for (const insert of inserts) {
    insert.generosity_rank = rankByKey.get(`${insert.team}|${insert.position}`) ?? null;
  }

  if (inserts.length === 0) return 0;

  const CHUNK = 500;
  for (let i = 0; i < inserts.length; i += CHUNK) {
    const { error } = await supabase
      .from("nfl_defense_vs_position")
      .upsert(inserts.slice(i, i + CHUNK), { onConflict: "team,season,position,scoring" });
    if (error) throw new Error(`nfl_defense_vs_position upsert failed: ${error.message}`);
  }
  return inserts.length;
}

function round(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}
