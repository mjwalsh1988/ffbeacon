/**
 * Build the FF Beacon projections and store them.
 *
 * The I/O half. Every judgement lives in lib/projections/, which is pure and
 * unit tested; this file only loads, joins, and writes.
 *
 * WHAT IT LOADS
 *   player_stats                usage and efficiency history, back three seasons
 *   player_weekly_projections   Sleeper's rows for the window, which are both
 *                               the blend partner and the list of weeks that
 *                               exist at all
 *   nfl_game_odds               the published total and spread, as game
 *                               environment
 *   players                     position, team, and the Sleeper id the stored
 *                               row is keyed on
 *
 * WHAT IT WRITES
 *   player_weekly_projections rows with source = 'ffbeacon', in exactly the
 *   same shape as Sleeper's. Same component stat line vocabulary, same
 *   availability taxonomy, same unique key. Every existing reader, every
 *   rescoring path and every league's custom scoring works on them unchanged,
 *   which is the whole reason the schema needed no new table.
 *
 * WHY THE WINDOW IS THE REMAINING SEASON
 *
 * Past weeks have been played. Their projections are a historical record that
 * lib/calculate-projection-accuracy.ts grades, and rewriting one would delete
 * the evidence rather than correct it. This builder only ever touches weeks
 * from the live week forward.
 *
 * FAILURE POSTURE
 *
 * The builder writes nothing when it has nothing to say. No Sleeper rows for
 * the window means no output at all rather than an empty source, because a
 * source that exists but covers nothing would be selected by
 * resolveProjectionSource and then answer every question with silence. That is
 * strictly worse than not existing.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "./database.types";
import {
  currentNflSeason,
  getNflState,
} from "./sleeper";
import { withRetry } from "./supabase/retry";
import {
  DEFAULT_POWER_PULSE_SETTINGS,
  mergePowerPulseSettings,
} from "./power-pulse/default-settings";
import type { ProjectionSettings } from "./projections/default-settings";
import {
  computeBeaconProjections,
  type EngineSubject,
  type SleeperProjectionRow,
} from "./projections/engine";
import { BEACON_SOURCE, SLEEPER_SOURCE } from "./projections/source-constants";
import type { PlayerStatRow } from "./projections/usage";
import {
  isProjectablePosition,
  PROJECTABLE_POSITIONS,
  type GameEnvironment,
  type ProjectionPosition,
  type StatLine,
} from "./projections/types";

type ServiceClient = SupabaseClient<Database>;
type ProjectionInsert = Database["public"]["Tables"]["player_weekly_projections"]["Insert"];

const PAGE = 1000;
const UPSERT_BATCH_SIZE = 500;

/** Last week of the NFL regular season. */
const LAST_WEEK = 18;

/**
 * How many completed seasons of history the usage model reads.
 *
 * Three. The recency ladder already discounts a two-season-old game to a fifth
 * of a current one and anything older to about a twelfth, so a fourth season
 * would add load without moving a number. It is also the same depth
 * nfl_defense_vs_position uses, which keeps the two models reading the same
 * slice of history.
 */
const HISTORY_SEASONS = 3;

export type BeaconProjectionsResult = {
  ok: boolean;
  skipped: boolean;
  reason?: string;
  season: number;
  fromWeek: number;
  toWeek: number;
  /** Rows written with source = 'ffbeacon'. */
  rowsWritten: number;
  /** Rows where our own model actually produced the number. */
  modelled: number;
  /** Rows copied through from Sleeper, by why. */
  mirrored: Record<string, number>;
  /** Sleeper rows the window contained. */
  sleeperRows: number;
  statRows: number;
  oddsRows: number;
  subjects: number;
  modelVersion: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  /** Player-weeks the engine produced but could not write, for want of a sleeper_player_id. See the write loop below. */
  droppedNoSleeperId: number;
  /**
   * Wall-clock ms spent in each named phase (sleeperLoad, subjects, stats,
   * environment, compute, upsert, clearStale), logged once at the end and
   * returned so the cron ledger records it. The build runs against a 300
   * second cron ceiling at 135 seconds; this is how a slow run gets diagnosed
   * without guessing which phase owns the time.
   */
  phaseTimings: Record<string, number>;
};

export type BeaconProjectionsOptions = {
  season?: number;
  fromWeek?: number;
  toWeek?: number;
};

export async function runBuildBeaconProjections(
  supabase: ServiceClient,
  opts: BeaconProjectionsOptions = {},
): Promise<BeaconProjectionsResult> {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  const timings: Record<string, number> = {};
  const timed = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
    const t0 = Date.now();
    const out = await fn();
    timings[label] = Date.now() - t0;
    return out;
  };

  const settings = await loadProjectionSettings(supabase);

  let season = opts.season ?? null;
  let fromWeek = opts.fromWeek ?? null;
  if (season === null || fromWeek === null) {
    const state = await getNflState();
    if (season === null) {
      const fromState = Number(state?.league_season ?? state?.season);
      season =
        Number.isFinite(fromState) && fromState > 2000
          ? fromState
          : Number(currentNflSeason());
    }
    if (fromWeek === null) {
      const stateSeason = Number(state?.season);
      const live = state?.season_type === "regular" && stateSeason === season;
      fromWeek = live ? Math.max(1, state?.week ?? 1) : 1;
    }
  }
  const toWeek = opts.toWeek ?? LAST_WEEK;

  const finish = (
    partial: Pick<
      BeaconProjectionsResult,
      | "skipped"
      | "reason"
      | "rowsWritten"
      | "modelled"
      | "mirrored"
      | "sleeperRows"
      | "statRows"
      | "oddsRows"
      | "subjects"
      | "droppedNoSleeperId"
    >,
  ): BeaconProjectionsResult => {
    const finished = Date.now();
    return {
      ok: true,
      season: season as number,
      fromWeek: fromWeek as number,
      toWeek,
      modelVersion: settings.modelVersion,
      startedAt,
      finishedAt: new Date(finished).toISOString(),
      durationMs: finished - started,
      // A shallow copy taken at return time, so a caller cannot mutate the
      // closure's own timings object through the returned result.
      phaseTimings: { ...timings },
      ...partial,
    };
  };

  const empty = {
    rowsWritten: 0,
    modelled: 0,
    mirrored: {},
    sleeperRows: 0,
    statRows: 0,
    oddsRows: 0,
    subjects: 0,
    droppedNoSleeperId: 0,
  };

  if ((fromWeek as number) > toWeek) {
    return finish({
      skipped: true,
      reason: `no weeks to build (fromWeek=${fromWeek} > toWeek=${toWeek})`,
      ...empty,
    });
  }

  const sleeperRows = await timed("sleeperLoad", () =>
    loadSleeperProjections(supabase, season as number, fromWeek as number, toWeek),
  );
  if (sleeperRows.length === 0) {
    // Nothing to mirror and nothing to blend against. Writing an empty
    // ffbeacon source would be worse than writing none: resolveProjectionSource
    // would select it and every reader would then see a season with no weeks.
    return finish({
      skipped: true,
      reason: `no sleeper projections stored for ${season} weeks ${fromWeek} to ${toWeek}`,
      ...empty,
    });
  }

  const playerIds = Array.from(
    new Set(sleeperRows.map((r) => r.playerId).filter((id): id is string => !!id)),
  );
  const subjects = await timed("subjects", () => loadSubjects(supabase, playerIds));
  const historySeasons = historyWindow(season as number);
  const stats = await timed("stats", () => loadStats(supabase, historySeasons, playerIds));
  const environment = await timed("environment", () =>
    loadEnvironment(supabase, season as number, fromWeek as number, toWeek),
  );

  const latestWeek = latestStatWeek(stats, season as number);

  const computeStart = Date.now();
  const result = computeBeaconProjections({
    season: season as number,
    currentSeason: season as number,
    latestWeek,
    stats,
    subjects,
    sleeper: indexByPlayerWeek(sleeperRows),
    environment,
    settings,
  });
  timings.compute = Date.now() - computeStart;

  const nowIso = new Date().toISOString();
  const inserts: ProjectionInsert[] = [];

  // p.sleeperPlayerId is already the authoritative id off the Sleeper row
  // being mirrored, falling back to players.external_ids.sleeper (see
  // toProjection in lib/projections/engine.ts and the comment on
  // SleeperProjectionRow.sleeperPlayerId). Both sides of that fallback are
  // resolved inside the engine now; a row that still has neither is counted
  // and logged rather than dropped silently, because before this both sides
  // of that fallback were the SAME players-table mapping, so a missing or
  // drifted external_ids.sleeper dropped the player-week with no evidence at
  // all that it happened.
  let droppedNoSleeperId = 0;
  for (const p of result.projections) {
    const sleeperId = p.sleeperPlayerId;
    if (!sleeperId) {
      droppedNoSleeperId += 1;
      console.warn(
        `  beacon projections: dropped ${p.playerId} week ${p.week} (season ${season}), ` +
          `no sleeper_player_id from the mirrored row or players.external_ids.sleeper`,
      );
      continue;
    }
    inserts.push({
      source: BEACON_SOURCE,
      season: season as number,
      season_type: "regular",
      week: p.week,
      sleeper_player_id: sleeperId,
      player_id: p.playerId,
      projected_pts_ppr: p.pointsPpr,
      projected_pts_half_ppr: p.pointsHalfPpr,
      projected_pts_std: p.pointsStd,
      availability: p.availability,
      injury_status: null,
      opponent: p.opponent,
      team: p.team,
      game_id: null,
      stat_line: (p.statLine ?? null) as unknown as Json,
      // Derived from internal data rather than received from a source, so this
      // is provenance rather than a preserved payload: which model version and
      // how much of the number is actually ours. A reader who finds a figure
      // surprising can tell at a glance whether we claimed it or Sleeper did.
      metadata: {
        model_version: settings.modelVersion,
        blend_weight: p.blendWeight,
        position: p.position,
        built_at: nowIso,
      } as unknown as Json,
      generated_at: nowIso,
      updated_at: nowIso,
    });
  }

  const upsertStart = Date.now();
  for (let i = 0; i < inserts.length; i += UPSERT_BATCH_SIZE) {
    const chunk = inserts.slice(i, i + UPSERT_BATCH_SIZE);
    await withRetry(
      async () => {
        const { error } = await supabase
          .from("player_weekly_projections")
          .upsert(chunk, {
            onConflict: "source,season_type,season,week,sleeper_player_id",
            ignoreDuplicates: false,
          });
        if (error) throw error;
      },
      { label: `beacon projections upsert ${season} wk${inserts[i]?.week}` },
    );
  }
  timings.upsert = Date.now() - upsertStart;

  // Anything this run did not touch inside the window is a row that no longer
  // has a Sleeper counterpart. Cleared rather than left, for the same reason
  // the Sleeper sync sweeps: an upsert can only correct a row the input still
  // mentions, and a player dropped from the feed would otherwise keep a
  // forward-looking projection forever. Guarded on having written something, so
  // one failed run cannot erase a good build.
  const clearStart = Date.now();
  let cleared = 0;
  if (inserts.length > 0) {
    const { data: clearedRows, error: clearError } = await withRetry(
      async () =>
        await supabase
          .from("player_weekly_projections")
          .delete()
          .eq("source", BEACON_SOURCE)
          .eq("season", season as number)
          .eq("season_type", "regular")
          .gte("week", fromWeek as number)
          .lte("week", toWeek)
          .lt("updated_at", nowIso)
          .select("id"),
      { label: `beacon projections clear-stale ${season}` },
    );
    if (clearError) throw clearError;
    cleared = clearedRows?.length ?? 0;
  }
  timings.clearStale = Date.now() - clearStart;

  const timingSummary = Object.entries(timings)
    .map(([label, ms]) => `${label}=${ms}ms`)
    .join(" ");
  console.log(
    `  beacon projections ${season} wk${fromWeek}-${toWeek}: ${inserts.length} written ` +
      `(${result.modelled} modelled, ${cleared} stale cleared, ${droppedNoSleeperId} dropped) from ${sleeperRows.length} sleeper rows, ` +
      `${stats.length} stat rows, ${environment.size} environments [${timingSummary}]`,
  );

  return finish({
    skipped: false,
    rowsWritten: inserts.length,
    modelled: result.modelled,
    mirrored: result.mirrored as unknown as Record<string, number>,
    sleeperRows: sleeperRows.length,
    statRows: stats.length,
    oddsRows: environment.size,
    droppedNoSleeperId,
    subjects: subjects.length,
  });
}

// ---------------------------------------------------------------------------
// loading
// ---------------------------------------------------------------------------

async function loadProjectionSettings(
  supabase: ServiceClient,
): Promise<ProjectionSettings> {
  try {
    const { data } = await supabase
      .from("league_power_pulse_settings")
      .select("settings")
      .eq("id", "global")
      .maybeSingle();
    if (data?.settings) {
      return mergePowerPulseSettings(data.settings).beaconProjections;
    }
  } catch {
    // A missing settings row is the fresh-database case, not a failure.
  }
  return DEFAULT_POWER_PULSE_SETTINGS.beaconProjections;
}

/** The completed seasons the usage model reads, plus the live one. */
function historyWindow(season: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < HISTORY_SEASONS; i++) out.push(season - i);
  return out;
}

async function loadSleeperProjections(
  supabase: ServiceClient,
  season: number,
  fromWeek: number,
  toWeek: number,
): Promise<SleeperProjectionRow[]> {
  const out: SleeperProjectionRow[] = [];
  let cursor: string | null = null;
  for (;;) {
    let q = supabase
      .from("player_weekly_projections")
      .select(
        "id, player_id, sleeper_player_id, week, opponent, team, stat_line, availability, projected_pts_ppr, projected_pts_half_ppr, projected_pts_std",
      )
      .eq("source", SLEEPER_SOURCE)
      .eq("season", season)
      .eq("season_type", "regular")
      .gte("week", fromWeek)
      .lte("week", toWeek)
      .not("player_id", "is", null)
      .order("id", { ascending: true })
      .limit(PAGE);
    if (cursor !== null) q = q.gt("id", cursor);
    const { data, error } = await q;
    if (error) throw new Error(`beacon projections sleeper load failed: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data) {
      if (!row.player_id) continue;
      out.push({
        playerId: row.player_id,
        // The AUTHORITATIVE id: this row's own sleeper_player_id, straight
        // off the Sleeper row being mirrored. See the comment on
        // SleeperProjectionRow.sleeperPlayerId in lib/projections/engine.ts.
        sleeperPlayerId: row.sleeper_player_id,
        week: Number(row.week),
        statLine: (row.stat_line as StatLine | null) ?? null,
        team: row.team,
        opponent: row.opponent,
        availability: row.availability,
        // Carried verbatim and anchored on rather than re-derived. See the
        // comment on SleeperProjectionRow.points: Sleeper's published total is
        // not the canonical dot product of its own stat line, and a kicker's
        // line does not dot-product to anything at all under skill scoring.
        points: {
          ppr: numOrNull(row.projected_pts_ppr),
          halfPpr: numOrNull(row.projected_pts_half_ppr),
          std: numOrNull(row.projected_pts_std),
        },
      });
    }
    cursor = data[data.length - 1].id;
    if (data.length < PAGE) break;
  }
  return out;
}

async function loadSubjects(
  supabase: ServiceClient,
  playerIds: string[],
): Promise<EngineSubject[]> {
  const out: EngineSubject[] = [];
  const CHUNK = 300;
  for (let i = 0; i < playerIds.length; i += CHUNK) {
    const chunk = playerIds.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("players")
      .select("id, position, team, external_ids")
      .in("id", chunk);
    if (error) throw new Error(`beacon projections subject load failed: ${error.message}`);
    for (const row of data ?? []) {
      const external = (row.external_ids ?? {}) as Record<string, unknown>;
      const sleeperId = external.sleeper;
      out.push({
        playerId: row.id,
        sleeperPlayerId: typeof sleeperId === "string" ? sleeperId : "",
        position: row.position ?? "",
        team: row.team,
      });
    }
  }
  return out;
}

async function loadStats(
  supabase: ServiceClient,
  seasons: number[],
  playerIds: string[],
): Promise<PlayerStatRow[]> {
  const out: PlayerStatRow[] = [];
  if (seasons.length === 0) return out;

  // NOT filtered to the rostered players. The usage model needs a team's WHOLE
  // offense to build a denominator: a receiver's target share is his targets
  // over his team's targets, and dropping the team-mates nobody projects would
  // inflate every share left standing. `playerIds` is used only to decide which
  // players get a position lookup, not to narrow the stat read.
  void playerIds;

  // THE POSITION FILTER RUNS IN THE QUERY, NOT IN JAVASCRIPT.
  //
  // Measured on 2026-09-01: this phase was 130 of the build's 160 seconds, 81%
  // of the whole run, and every other phase combined was under 30. The cause
  // was that the read fetched EVERY position and discarded about 70% of the
  // rows here in the loop below, so it paged roughly 81 times across the wire
  // to keep 24 pages' worth of data.
  //
  // `players!inner(position)` pushes that filter into Postgres. The behaviour
  // is IDENTICAL: the discarded rows were exactly the non-projectable ones, and
  // they contributed nothing to a team denominator either, because team
  // offensive snaps is a MAX over the same projectable set and the target,
  // carry and attempt sums are all zero on a lineman or a defender. This is a
  // change of where the filter runs, not of what survives it.
  //
  // The JavaScript guard below is deliberately kept as a belt-and-braces check
  // rather than deleted, so a future change to the join cannot silently admit a
  // position the model has no business projecting.
  const projectable = [...PROJECTABLE_POSITIONS];

  // ONE SEASON AT A TIME, AND THE REASON IS THE INDEX.
  //
  // The walk orders by id so pages cannot skip or duplicate rows. Migration
  // 0242 added (season, season_type, id) so that ordering comes free off an
  // index, but a btree can only supply an ordering when the LEADING columns are
  // equalities. A single query asking for three seasons at once does not give
  // it one equality on season, so Postgres would fall back to walking the
  // primary key and
  // filtering season row by row, which is exactly the plan that cost 5.2
  // seconds a page and 119 of this build's 140 seconds.
  //
  // Three equality-scoped walks are therefore strictly cheaper than one walk
  // over three seasons, which is the opposite of the usual intuition about
  // round trips and is worth stating so nobody helpfully merges them back.
  for (const season of seasons) {
    await loadSeasonStatRows(supabase, season, projectable, out);
  }
  return out;
}

/** One season's worth of the stat read. See the comment at the call site. */
async function loadSeasonStatRows(
  supabase: ServiceClient,
  season: number,
  projectable: string[],
  out: PlayerStatRow[],
): Promise<void> {
  let cursor: string | null = null;
  for (;;) {
    let q = supabase
      .from("player_stats")
      .select(
        "id, player_id, season, week, gp, off_snp, rec_tgt, rec, rec_yd, rec_td, rush_att, rush_yd, rush_td, rush_rz_att, pass_att, pass_cmp, pass_yd, pass_td, pass_int, fum_lost, offense_team:metadata->>team, players!inner(position)",
      )
      .eq("season", season)
      .eq("season_type", "regular")
      .not("player_id", "is", null)
      .in("players.position", projectable)
      .order("id", { ascending: true })
      .limit(PAGE);
    if (cursor !== null) q = q.gt("id", cursor);
    const { data, error } = await q;
    if (error) throw new Error(`beacon projections stat load failed: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data) {
      if (!row.player_id) continue;
      const joined = (row as unknown as { players?: { position?: string } | null }).players;
      const position = joined?.position;
      if (!isProjectablePosition(position)) continue;
      const offense = (row as unknown as { offense_team?: string | null }).offense_team;
      out.push({
        playerId: row.player_id,
        position: (position ?? "").toUpperCase() as ProjectionPosition,
        team: typeof offense === "string" && offense.length > 0 ? offense : null,
        season: Number(row.season),
        week: Number(row.week),
        gp: num(row.gp),
        offSnaps: row.off_snp === null ? null : num(row.off_snp),
        targets: row.rec_tgt === null ? null : num(row.rec_tgt),
        receptions: num(row.rec),
        recYards: num(row.rec_yd),
        recTds: num(row.rec_td),
        carries: num(row.rush_att),
        rushYards: num(row.rush_yd),
        rushTds: num(row.rush_td),
        rushRedZoneAttempts: num(row.rush_rz_att),
        passAttempts: num(row.pass_att),
        passCompletions: num(row.pass_cmp),
        passYards: num(row.pass_yd),
        passTds: num(row.pass_td),
        interceptions: num(row.pass_int),
        fumblesLost: num(row.fum_lost),
      });
    }
    cursor = data[data.length - 1].id;
    if (data.length < PAGE) break;
  }
}

async function loadPositions(
  supabase: ServiceClient,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("players")
      .select("id, position")
      // Ordered, matching lib/draft-tracker/board.ts and
      // lib/power-pulse/load.ts: without a stable sort Postgres can return a
      // different order per page, and a paged range walk over an unordered
      // query can then silently skip or duplicate rows.
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`beacon projections position load failed: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data) out.set(row.id, row.position);
    if (data.length < PAGE) break;
  }
  return out;
}

/**
 * Game environment per (team, week), from both sides of every published line.
 *
 * A game with no odds row simply has no entry, and `environmentEffect` treats a
 * missing entry as no adjustment rather than as a neutral game. That
 * distinction is the whole reason this returns a sparse map rather than filling
 * in defaults.
 */
async function loadEnvironment(
  supabase: ServiceClient,
  season: number,
  fromWeek: number,
  toWeek: number,
): Promise<Map<string, GameEnvironment>> {
  const out = new Map<string, GameEnvironment>();
  const { data, error } = await supabase
    .from("nfl_game_odds")
    .select(
      "week, home_team, away_team, home_implied_total, away_implied_total, home_spread",
    )
    .eq("season", season)
    .eq("season_type", "regular")
    .gte("week", fromWeek)
    .lte("week", toWeek);
  if (error) throw new Error(`beacon projections odds load failed: ${error.message}`);

  for (const row of data ?? []) {
    const week = Number(row.week);
    const homeSpread = row.home_spread === null ? null : Number(row.home_spread);
    out.set(`${row.home_team}|${week}`, {
      team: row.home_team,
      opponent: row.away_team,
      impliedTotal:
        row.home_implied_total === null ? null : Number(row.home_implied_total),
      spread: homeSpread,
    });
    out.set(`${row.away_team}|${week}`, {
      team: row.away_team,
      opponent: row.home_team,
      impliedTotal:
        row.away_implied_total === null ? null : Number(row.away_implied_total),
      // The away side's spread is the negation of the home side's, so a home
      // favourite (negative) makes the away team an underdog (positive). Doing
      // this here rather than storing a second column keeps one published
      // number as one stored number.
      spread: homeSpread === null ? null : -homeSpread,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function indexByPlayerWeek(
  rows: readonly SleeperProjectionRow[],
): Map<string, SleeperProjectionRow> {
  const out = new Map<string, SleeperProjectionRow>();
  for (const row of rows) out.set(`${row.playerId}|${row.week}`, row);
  return out;
}

/**
 * The newest week of the live season that has stats.
 *
 * Drives the within-season recency decay. Falls back to 0 in the preseason,
 * which makes every current-season game weightless because there are none.
 */
function latestStatWeek(rows: readonly PlayerStatRow[], season: number): number {
  let latest = 0;
  for (const row of rows) {
    if (row.season !== season) continue;
    if (row.week > latest) latest = row.week;
  }
  return latest;
}

function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * A stored numeric that keeps its null.
 *
 * Distinct from `num` on purpose. A projected point total of null means the
 * source has no opinion, and coercing it to 0 would assert one.
 */
function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
