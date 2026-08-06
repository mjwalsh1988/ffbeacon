/**
 * Player profile data layer.
 *
 * Central loaders + types shared by every surface of the redesigned player
 * profile (hero, overview sidebar, statistics tab, trades tab, Beacon Brief
 * tab). The profile respects the GLOBAL header source + format selection (unlike
 * a league view, which derives format from Sleeper); source drives value/rank
 * queries, format drives which format_config the values/finishes are read for.
 *
 * Positional finishes are not stored: they come from the
 * get_player_positional_finishes RPC (migration 0118), which ranks a player
 * within their position by summed regular-season fantasy points for a scoring
 * type. Finish depends only on scoring, so it is source-independent.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import {
  resolveSourceForFormat,
  getAvailableSources,
  getActiveFormats,
  describeSource,
  type SourceRegistryRow,
} from "@/lib/source";
import { resolveFormatSlug, resolveSourceSlug } from "@/lib/preferences";
import { lineFromProjection, type StatLine } from "@/components/player-profile/stat-shaping";

type AnySupabase =
  | SupabaseClient<Database>
  | Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>;

/** The three scoring bases we store historical fantasy points for. */
export type ScoringKey = "pts_ppr" | "pts_half_ppr" | "pts_std";

export const SCORING_KEYS: { key: ScoringKey; label: string; short: string }[] = [
  { key: "pts_ppr", label: "PPR", short: "PPR" },
  { key: "pts_half_ppr", label: "Half PPR", short: "Half" },
  { key: "pts_std", label: "Standard", short: "Std" },
];

/** Map a format_configs.scoring_type to the historical points key. */
export function scoringKeyForType(scoringType: string | null | undefined): ScoringKey {
  if (scoringType === "half_ppr") return "pts_half_ppr";
  if (scoringType === "standard") return "pts_std";
  return "pts_ppr";
}

export type PlayerRow = {
  id: string;
  slug: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  position: string;
  team: string | null;
  status: string | null;
  birth_date: string | null;
  height_inches: number | null;
  weight_lbs: number | null;
  college: string | null;
  years_experience: number | null;
  draft_year: number | null;
  draft_round: number | null;
  draft_pick: number | null;
  external_ids: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
};

export type NflTeamRow = {
  abbreviation: string;
  name: string;
  primary_color: string;
  secondary_color: string;
  tertiary_color: string;
  chant: string;
};

export type PlayerContext = {
  formatSlug: string;
  formatConfigId: string | null;
  formatDisplay: string;
  scoringType: string;
  scoringKey: ScoringKey;
  /** Tight-end premium bonus (points per reception) for the active format, 0 when none. */
  tePremiumBonus: number;
  requestedSourceSlug: string | null;
  /** Source resolved for value tables (may fall back from the requested one). */
  valueSourceSlug: string | null;
  valueSourceDisplay: string | null;
  /** Source resolved for the rankings table. */
  rankingsSourceSlug: string | null;
  registry: SourceRegistryRow[];
  registrySlugs: string[];
  /** Present when the requested source could not cover this format. */
  fallbackBanner: { requested: string; actual: string; formatDisplay: string } | null;
};

export type PositionalFinish = {
  season: number;
  scoring: ScoringKey;
  finish: number;
  totalPoints: number;
  playersRanked: number;
};

export type ValuePoint = { t: string; value: number };

/**
 * Resolve the player row plus the global-header source/format context. Returns
 * null when the slug matches no player (caller should notFound()).
 */
export async function loadPlayerAndContext(
  supabase: AnySupabase,
  slug: string,
  params: { formatParam?: string; sourceParam?: string },
): Promise<{ player: PlayerRow; sleeperId: string | null; context: PlayerContext } | null> {
  const db = supabase as SupabaseClient<Database>;

  // One wave: format/source resolution, the player row, the active-format list,
  // and the source registry all in parallel. Folding the active-format list in
  // here (a request-cached fetch shared with SiteHeader) lets us pick the format
  // row in memory instead of a second, slug-keyed round trip, collapsing a whole
  // query wave off the profile's critical path.
  const [formatResolution, sourceResolution, { data: playerRaw }, activeFormats, registry] =
    await Promise.all([
      resolveFormatSlug(db, params.formatParam),
      resolveSourceSlug(db, params.sourceParam),
      db
        .from("players")
        .select(
          "id, slug, first_name, last_name, full_name, position, team, status, birth_date, height_inches, weight_lbs, college, years_experience, draft_year, draft_round, draft_pick, external_ids, metadata",
        )
        .eq("slug", slug)
        .maybeSingle(),
      getActiveFormats(db),
      getAvailableSources(db),
    ]);

  if (!playerRaw) return null;
  const player = playerRaw as unknown as PlayerRow;

  const selectedFormatSlug = formatResolution.slug;
  const requestedSourceSlug = sourceResolution.slug;

  // Active formats only (the format dropdown never offers inactive ones); an
  // unknown/inactive slug resolves to null and falls through to the defaults
  // below, same as a missing format_config row did.
  const formatConfig = activeFormats.find((f) => f.slug === selectedFormatSlug) ?? null;

  const registrySlugs = registry.map((r) => r.slug);
  const formatConfigId = formatConfig?.id ?? null;
  const formatDisplay = formatConfig?.display_name ?? selectedFormatSlug;
  const scoringType = formatConfig?.scoring_type ?? "ppr";
  const tePremiumBonus = Number(formatConfig?.te_premium_bonus ?? 0) || 0;

  const valueResolution = formatConfig
    ? resolveSourceForFormat(registry, "player_value_history", formatConfig.slug, requestedSourceSlug)
    : { source: null, requested: requestedSourceSlug, fellBack: false, availableForFormat: [] };
  const rankingsResolution = formatConfig
    ? resolveSourceForFormat(registry, "rankings", formatConfig.slug, requestedSourceSlug)
    : { source: null, requested: requestedSourceSlug, fellBack: false, availableForFormat: [] };

  const fallbackBanner =
    valueResolution.fellBack && valueResolution.source
      ? {
          requested: describeSource(registry, valueResolution.requested),
          actual: describeSource(registry, valueResolution.source),
          formatDisplay,
        }
      : null;

  const context: PlayerContext = {
    formatSlug: selectedFormatSlug,
    formatConfigId,
    formatDisplay,
    scoringType,
    scoringKey: scoringKeyForType(scoringType),
    tePremiumBonus,
    requestedSourceSlug,
    valueSourceSlug: valueResolution.source,
    valueSourceDisplay: valueResolution.source
      ? describeSource(registry, valueResolution.source)
      : null,
    rankingsSourceSlug: rankingsResolution.source,
    registry,
    registrySlugs,
    fallbackBanner,
  };

  const sleeperId = readSleeperId(player);
  return { player, sleeperId, context };
}

/** Pull the Sleeper id from external_ids, falling back to the slug tail. */
export function readSleeperId(player: Pick<PlayerRow, "external_ids" | "slug">): string | null {
  const ext = player.external_ids as { sleeper?: unknown } | null;
  if (ext && typeof ext.sleeper === "string" && /^\d+$/.test(ext.sleeper)) return ext.sleeper;
  const tail = player.slug.match(/-(\d+)$/)?.[1];
  return tail ?? null;
}

/** The raw Sleeper object we persisted verbatim under metadata.sleeper. */
export function sleeperMeta(player: Pick<PlayerRow, "metadata">): Record<string, unknown> {
  const m = player.metadata as { sleeper?: unknown } | null;
  if (m && m.sleeper && typeof m.sleeper === "object") {
    return m.sleeper as Record<string, unknown>;
  }
  return {};
}

/** nfl_teams row for a team abbreviation (brand colors + chant). Null if none. */
export async function loadTeamRow(
  supabase: AnySupabase,
  team: string | null | undefined,
): Promise<NflTeamRow | null> {
  if (!team) return null;
  const db = supabase as SupabaseClient<Database>;
  const { data } = await db
    .from("nfl_teams")
    .select("abbreviation, name, primary_color, secondary_color, tertiary_color, chant")
    .eq("abbreviation", team)
    .maybeSingle();
  return (data as NflTeamRow | null) ?? null;
}

/**
 * Positional finishes from the nightly-rebuilt player_positional_finishes cache
 * (migration 0142, populated by rebuild_positional_finishes()). Returns one entry
 * per (season, scoring). Pass seasons to limit; omit for every season the player
 * has stats. This is a single indexed SELECT: the heavy rank-the-whole-position
 * aggregation now runs once nightly, not live on every profile load. The
 * get_player_positional_finishes RPC remains the source of truth / parity oracle
 * behind the rebuild.
 */
export async function loadPositionalFinishes(
  supabase: AnySupabase,
  playerId: string,
  seasons?: number[],
): Promise<PositionalFinish[]> {
  const db = supabase as SupabaseClient<Database>;
  let query = db
    .from("player_positional_finishes")
    .select("season, scoring, finish, total_points, players_ranked")
    .eq("player_id", playerId);
  if (seasons && seasons.length > 0) {
    query = query.in("season", seasons);
  }
  const { data, error } = await query;
  if (error || !data) return [];
  return data.map((r) => ({
    season: Number(r.season),
    scoring: String(r.scoring) as ScoringKey,
    finish: Number(r.finish),
    totalPoints: Number(r.total_points),
    playersRanked: Number(r.players_ranked),
  }));
}

/**
 * The most recent `count` seasons of finishes for a single scoring key, newest
 * first. Used by the hero (last 3 finishes for the active format's scoring).
 */
export function recentFinishesForScoring(
  finishes: PositionalFinish[],
  scoringKey: ScoringKey,
  count: number,
): PositionalFinish[] {
  return finishes
    .filter((f) => f.scoring === scoringKey)
    .sort((a, b) => b.season - a.season)
    .slice(0, count);
}

/**
 * Value series for the profile chart. Prefers the last `days` days for the
 * resolved (format, source); if that yields fewer than 2 points, widens to the
 * most recent points regardless of age so the chart still shows whatever history
 * exists. Points honor formula_offset (the market series), per the value-read
 * audit. Ascending by time.
 */
export async function loadValueSeries(
  supabase: AnySupabase,
  playerId: string,
  formatConfigId: string | null,
  source: string | null,
  days = 30,
): Promise<{ points: ValuePoint[]; windowed: boolean }> {
  if (!formatConfigId || !source) return { points: [], windowed: false };
  const db = supabase as SupabaseClient<Database>;
  const sinceIso = new Date(Date.now() - days * 86_400_000).toISOString();

  const base = () =>
    db
      .from("player_value_history")
      .select("value, formula_offset, captured_at")
      .eq("player_id", playerId)
      .eq("format_config_id", formatConfigId)
      .eq("source", source);

  const { data: windowRows } = await base()
    .gte("captured_at", sinceIso)
    .order("captured_at", { ascending: true });

  let rows = windowRows ?? [];
  let windowed = true;
  if (rows.length < 2) {
    const { data: recent } = await base()
      .order("captured_at", { ascending: false })
      .limit(days);
    rows = (recent ?? []).slice().reverse();
    windowed = false;
  }

  const points: ValuePoint[] = rows.map((r) => ({
    t: r.captured_at as string,
    value: Number(r.value) - Number(r.formula_offset ?? 0),
  }));
  return { points, windowed };
}

export type TrendsRow = {
  current_value: number | null;
  change_7d: number | null;
  change_7d_pct: number | null;
  change_30d: number | null;
  change_30d_pct: number | null;
  change_90d: number | null;
  change_90d_pct: number | null;
  trend_7d: string | null;
  trend_30d: string | null;
  high_30d: number | null;
  low_30d: number | null;
  volatility_30d: number | null;
  rank_change_7d: number | null;
  rank_change_30d: number | null;
  rank_change_90d: number | null;
  data_points_30d: number | null;
  show_trend_7d: boolean | null;
  show_trend_30d: boolean | null;
  show_trend_90d: boolean | null;
};

/** Pre-computed value trends (up/down chips) for the resolved format + source. */
export async function loadTrends(
  supabase: AnySupabase,
  playerId: string,
  formatConfigId: string | null,
  source: string | null,
): Promise<TrendsRow | null> {
  if (!formatConfigId || !source) return null;
  const db = supabase as SupabaseClient<Database>;
  const { data } = await db
    .from("player_value_trends")
    .select(
      "current_value, change_7d, change_7d_pct, change_30d, change_30d_pct, change_90d, change_90d_pct, trend_7d, trend_30d, high_30d, low_30d, volatility_30d, rank_change_7d, rank_change_30d, rank_change_90d, data_points_30d, show_trend_7d, show_trend_30d, show_trend_90d",
    )
    .eq("player_id", playerId)
    .eq("format_config_id", formatConfigId)
    .eq("source", source)
    .maybeSingle();
  return (data as TrendsRow | null) ?? null;
}

/** Latest published market value for the resolved format + source. */
export async function loadLatestValue(
  supabase: AnySupabase,
  playerId: string,
  formatConfigId: string | null,
  source: string | null,
): Promise<number | null> {
  if (!formatConfigId || !source) return null;
  const db = supabase as SupabaseClient<Database>;
  const { data } = await db
    .from("player_value_history")
    .select("value")
    .eq("player_id", playerId)
    .eq("format_config_id", formatConfigId)
    .eq("source", source)
    .order("captured_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? Number((data as { value: number }).value) : null;
}

// ---------- weekly stats shaping ----------

export type WeeklyStatRow = {
  season: number;
  week: number;
  opponent: string | null;
  snap_pct: number | null;
  gp: number | null;
  pass_cmp: number | null;
  pass_att: number | null;
  pass_yd: number | null;
  pass_td: number | null;
  pass_int: number | null;
  rush_att: number | null;
  rush_yd: number | null;
  rush_td: number | null;
  rec: number | null;
  rec_tgt: number | null;
  rec_yd: number | null;
  rec_td: number | null;
  /** Denormalized fantasy points (migration 0141). Read these instead of parsing
   *  metadata; NULL when Sleeper never published that base, so coalesce to 0. */
  pts_ppr: number | null;
  pts_half_ppr: number | null;
  pts_std: number | null;
  /** Raw source payload. Optional here because the profile weekly-stats read no
   *  longer selects it (the pts_* columns replaced the jsonb parse); callers that
   *  still need the raw object select it explicitly (see signal-scout). */
  metadata?: unknown;
};

/** Read a fantasy-points base off the denormalized stat columns, NULL-safe (0
 *  when the column is NULL). Mirrors readPoints() but with no jsonb parse. */
export function pointsFromStatRow(
  row: Pick<WeeklyStatRow, "pts_ppr" | "pts_half_ppr" | "pts_std">,
  key: ScoringKey,
): number {
  const v =
    key === "pts_half_ppr" ? row.pts_half_ppr : key === "pts_std" ? row.pts_std : row.pts_ppr;
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** Active-scoring actual points from the denormalized columns, plus any TE
 *  premium on the real receptions. Column-based analogue of
 *  actualPointsForScoring (which still reads metadata for other callers/tests). */
export function activePointsFromStatRow(
  row: Pick<WeeklyStatRow, "pts_ppr" | "pts_half_ppr" | "pts_std">,
  actualReceptions: number | null,
  key: ScoringKey,
  tepBonusPerReception = 0,
): number {
  return pointsFromStatRow(row, key) + tepBonusPerReception * (actualReceptions ?? 0);
}

/** Every regular-season weekly stat row for the player, newest first. Selects the
 *  denormalized pts_* columns instead of the heavy metadata jsonb. */
export async function loadWeeklyStats(
  supabase: AnySupabase,
  playerId: string,
): Promise<WeeklyStatRow[]> {
  const db = supabase as SupabaseClient<Database>;
  const { data } = await db
    .from("player_stats")
    .select(
      "season, week, opponent, snap_pct, gp, pass_cmp, pass_att, pass_yd, pass_td, pass_int, rush_att, rush_yd, rush_td, rec, rec_tgt, rec_yd, rec_td, pts_ppr, pts_half_ppr, pts_std",
    )
    .eq("player_id", playerId)
    .eq("season_type", "regular")
    .order("season", { ascending: false })
    .order("week", { ascending: false });
  return (data ?? []) as WeeklyStatRow[];
}

/** Read a fantasy-points key out of a weekly row's metadata jsonb.
 *
 * Rows synced from api.sleeper.com nest the raw stat map under `.stats`; older
 * rows stored the flat stat object directly. Prefer the nested map, falling
 * back to the top level so both shapes read correctly. */
export function readPoints(metadata: unknown, key: ScoringKey): number {
  if (metadata && typeof metadata === "object") {
    const obj = metadata as Record<string, unknown>;
    const stats =
      obj.stats && typeof obj.stats === "object" ? (obj.stats as Record<string, unknown>) : obj;
    const v = stats[key];
    const num = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : 0;
    return Number.isFinite(num) ? num : 0;
  }
  return 0;
}

// ---------- weekly projections ----------

export type WeeklyProjectionRow = {
  season: number;
  week: number;
  opponent: string | null;
  team: string | null;
  /** Projected points per scoring base. Null when Sleeper did not publish it. */
  ppr: number | null;
  half_ppr: number | null;
  std: number | null;
  /** The raw projected stat map (pass/rush/rec components) for detail columns. */
  stats: Record<string, unknown> | null;
  /** True when a real stat line already exists for this (season, week). */
  played: boolean;
};

export type PlayerProjections = {
  /** The latest season we hold projections for, or null when none exist. */
  season: number | null;
  /** All weekly rows for that season, ascending by week. */
  rows: WeeklyProjectionRow[];
  /** True once at least one projected week has been played (regular season live). */
  seasonStarted: boolean;
};

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Map the active scoring key to a base projected-points value on a projection row. */
export function projectedPointsForScoring(
  row: WeeklyProjectionRow,
  key: ScoringKey,
): number | null {
  if (key === "pts_half_ppr") return row.half_ppr;
  if (key === "pts_std") return row.std;
  return row.ppr;
}

/** Projected receptions for a week, read from the raw stat_line (0 when absent). */
function projectedReceptions(stats: Record<string, unknown> | null): number {
  const v = stats?.["rec"];
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * Projected points for the active scoring, plus a tight-end premium when the
 * format carries one. TEP adds `tepBonusPerReception` points for every projected
 * reception. The caller passes 0 for non-TEP formats or non-TE players, so the
 * base projection is returned unchanged in every other case. Null base (Sleeper
 * did not publish this scoring) stays null; the premium never invents points.
 */
export function effectiveProjectedPoints(
  row: WeeklyProjectionRow,
  key: ScoringKey,
  tepBonusPerReception = 0,
): number | null {
  const base = projectedPointsForScoring(row, key);
  if (base == null) return null;
  if (!tepBonusPerReception) return base;
  return base + tepBonusPerReception * projectedReceptions(row.stats);
}

/**
 * Weekly point projections for the player's latest projected season (Sleeper,
 * regular season). Loads every stored week ascending, then marks each week
 * `played` by checking player_stats for a real game (gp > 0). Numeric columns
 * come back from PostgREST as strings, so they are coerced here. Empty when the
 * player has no projections on file (deep bench / non-fantasy players).
 */
export async function loadWeeklyProjections(
  supabase: AnySupabase,
  playerId: string,
): Promise<PlayerProjections> {
  const db = supabase as SupabaseClient<Database>;
  const { data } = await db
    .from("player_weekly_projections")
    .select(
      "season, week, opponent, team, projected_pts_ppr, projected_pts_half_ppr, projected_pts_std, stat_line",
    )
    .eq("player_id", playerId)
    .eq("season_type", "regular")
    .order("season", { ascending: false })
    .order("week", { ascending: true });

  const all = data ?? [];
  if (all.length === 0) return { season: null, rows: [], seasonStarted: false };

  const season = Number(all[0].season);
  const seasonRows = all.filter((r) => Number(r.season) === season);

  const { data: statWeeks } = await db
    .from("player_stats")
    .select("week, gp")
    .eq("player_id", playerId)
    .eq("season", season)
    .eq("season_type", "regular");

  const playedWeeks = new Set<number>();
  for (const s of statWeeks ?? []) {
    const gp = Number((s as { gp: unknown }).gp);
    if (Number.isFinite(gp) && gp > 0) playedWeeks.add(Number((s as { week: unknown }).week));
  }

  const rows: WeeklyProjectionRow[] = seasonRows.map((r) => ({
    season: Number(r.season),
    week: Number(r.week),
    opponent: r.opponent ?? null,
    team: r.team ?? null,
    ppr: numOrNull(r.projected_pts_ppr),
    half_ppr: numOrNull(r.projected_pts_half_ppr),
    std: numOrNull(r.projected_pts_std),
    stats: (r.stat_line as Record<string, unknown> | null) ?? null,
    played: playedWeeks.has(Number(r.week)),
  }));

  return { season, rows, seasonStarted: rows.some((r) => r.played) };
}

export type ProjectionSummary = {
  season: number | null;
  /** True once the season is underway (some weeks played). */
  seasonStarted: boolean;
  /** Upcoming (unplayed) weeks with a projection for the active scoring. */
  upcomingWeeks: number;
  /** Summed projected points across the upcoming weeks, active scoring. */
  totalPoints: number;
  /** Average projected points per upcoming week, or null when none remain. */
  perGame: number | null;
  /** The soonest unplayed week's projection row, or null. */
  nextGame: WeeklyProjectionRow | null;
  /** The soonest unplayed week's projected points for the active scoring. */
  nextGamePoints: number | null;
};

/**
 * Roll the upcoming (unplayed) weeks into a season outlook for the active
 * scoring. In the off-season every week is upcoming, so totalPoints is the full
 * projected season; once games are played it becomes the rest-of-season outlook.
 * `tepBonusPerReception` applies a tight-end premium to every week and the
 * roll-up (0 leaves the base projections untouched).
 */
export function summarizeProjections(
  proj: PlayerProjections,
  key: ScoringKey,
  tepBonusPerReception = 0,
): ProjectionSummary {
  const upcoming = proj.rows.filter(
    (r) => !r.played && effectiveProjectedPoints(r, key, tepBonusPerReception) != null,
  );
  let total = 0;
  for (const r of upcoming) total += effectiveProjectedPoints(r, key, tepBonusPerReception) ?? 0;
  const nextGame = upcoming[0] ?? null;
  return {
    season: proj.season,
    seasonStarted: proj.seasonStarted,
    upcomingWeeks: upcoming.length,
    totalPoints: total,
    perGame: upcoming.length > 0 ? total / upcoming.length : null,
    nextGame,
    nextGamePoints: nextGame
      ? effectiveProjectedPoints(nextGame, key, tepBonusPerReception)
      : null,
  };
}

// ---------- projected vs actual ----------

/** Projected points per scoring base for one week, plus projected receptions and
 *  the full projected component stat line (targets, yards, TDs, etc.) used by the
 *  per-stat beat/miss comparison. */
export type ProjectedPointsSet = {
  ppr: number | null;
  half_ppr: number | null;
  std: number | null;
  rec: number;
  line: StatLine;
};

/**
 * Every stored weekly projection for the player, keyed by `${season}-${week}`,
 * across ALL seasons (nightly upcoming rows plus the historical backfill). Used
 * to overlay the projection line on played weeks in the statistics tab. Numeric
 * columns arrive as strings from PostgREST, so they are coerced here.
 */
export async function loadProjectionsMap(
  supabase: AnySupabase,
  playerId: string,
): Promise<Map<string, ProjectedPointsSet>> {
  const db = supabase as SupabaseClient<Database>;
  const { data } = await db
    .from("player_weekly_projections")
    .select(
      "season, week, projected_pts_ppr, projected_pts_half_ppr, projected_pts_std, stat_line",
    )
    .eq("player_id", playerId)
    .eq("season_type", "regular");

  const map = new Map<string, ProjectedPointsSet>();
  for (const r of data ?? []) {
    const line = lineFromProjection((r.stat_line as Record<string, unknown> | null) ?? null);
    map.set(`${Number(r.season)}-${Number(r.week)}`, {
      ppr: numOrNull(r.projected_pts_ppr),
      half_ppr: numOrNull(r.projected_pts_half_ppr),
      std: numOrNull(r.projected_pts_std),
      rec: line.rec,
      line,
    });
  }
  return map;
}

/** Projected points for the active scoring from a set, with any TE premium. Only
 *  the point bases and projected receptions are needed, so the parameter is
 *  narrowed (the full projected stat line is irrelevant to the points math). */
export function pointsFromProjectedSet(
  set: Pick<ProjectedPointsSet, "ppr" | "half_ppr" | "std" | "rec"> | undefined | null,
  key: ScoringKey,
  tepBonusPerReception = 0,
): number | null {
  if (!set) return null;
  const base = key === "pts_half_ppr" ? set.half_ppr : key === "pts_std" ? set.std : set.ppr;
  if (base == null) return null;
  return base + tepBonusPerReception * set.rec;
}

/**
 * Actual fantasy points for the active scoring from a weekly stat row's metadata,
 * with any TE premium applied to the real receptions. Mirrors
 * pointsFromProjectedSet so projected and actual lines are computed identically.
 */
export function actualPointsForScoring(
  metadata: unknown,
  actualReceptions: number | null,
  key: ScoringKey,
  tepBonusPerReception = 0,
): number {
  const base = readPoints(metadata, key);
  return base + tepBonusPerReception * (actualReceptions ?? 0);
}

// ---------- depth chart ----------

export type DepthChartEntry = {
  slug: string;
  name: string;
  sleeperId: string | null;
  order: number | null;
  injuryStatus: string | null;
  isViewed: boolean;
  role: string | null;
};

function intOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Plain-language role for a player's spot in the position depth chart, from
 * Sleeper's team-wide depth_chart_order (1 = top of the room). Each position has
 * its own ladder:
 *   QB : Starter (1),   Backup (2),   Dart Throw (3+)
 *   RB : Starter (1),   Handcuff (2), Depth Piece (3+)
 *   WR : Starter (1-2), Depth Piece (3), Dart Throw (4+)
 *   TE : Starter (1),   Backup (2),   Dart Throw (3+)
 *   K  : Starter (1),   Backup (2),   Dart Throw (3+)
 *   DEF: no role (team defenses are not depth-charted this way)
 */
export function depthRoleLabel(position: string, order: number | null): string | null {
  if (order == null) return null;
  const pos = (position || "").toUpperCase();
  if (pos === "DEF" || pos === "DST") return null;
  if (pos === "QB") return order === 1 ? "Starter" : order === 2 ? "Backup" : "Dart Throw";
  if (pos === "RB") return order === 1 ? "Starter" : order === 2 ? "Handcuff" : "Depth Piece";
  if (pos === "WR") return order <= 2 ? "Starter" : order === 3 ? "Depth Piece" : "Dart Throw";
  if (pos === "TE" || pos === "K")
    return order === 1 ? "Starter" : order === 2 ? "Backup" : "Dart Throw";
  return order === 1 ? "Starter" : order === 2 ? "Backup" : "Dart Throw";
}

/** The viewed player's own depth-chart role, from their Sleeper metadata. */
export function depthRoleForPlayer(
  player: Pick<PlayerRow, "position" | "metadata">,
): string | null {
  const meta = sleeperMeta(player);
  return depthRoleLabel(player.position, intOrNull(meta.depth_chart_order));
}

/**
 * The team depth chart for the player's position, ordered by Sleeper's
 * depth_chart_order (starter first, search_rank as tiebreak). Returns null when
 * no teammate at the position is charted, so the caller hides the card rather
 * than showing an empty one. The viewed player is always included and flagged;
 * if only they are charted, the room is just them plus their role.
 */
export async function loadDepthChart(
  supabase: AnySupabase,
  player: Pick<PlayerRow, "slug" | "team" | "position">,
): Promise<{ room: DepthChartEntry[]; viewedRole: string | null } | null> {
  if (!player.team) return null;
  const db = supabase as SupabaseClient<Database>;
  const { data } = await db
    .from("players")
    .select("slug, full_name, first_name, last_name, external_ids, metadata")
    .eq("team", player.team)
    .eq("position", player.position);

  const entries = (data ?? []).map((r) => {
    const row = r as unknown as Pick<
      PlayerRow,
      "slug" | "full_name" | "first_name" | "last_name" | "external_ids" | "metadata"
    >;
    const meta = sleeperMeta(row);
    return {
      slug: row.slug,
      name: row.full_name ?? (`${row.first_name ?? ""} ${row.last_name ?? ""}`.trim() || row.slug),
      sleeperId: readSleeperId(row),
      order: intOrNull(meta.depth_chart_order),
      searchRank: intOrNull(meta.search_rank) ?? Number.MAX_SAFE_INTEGER,
      injuryStatus: typeof meta.injury_status === "string" ? meta.injury_status : null,
      isViewed: row.slug === player.slug,
    };
  });

  const charted = entries.filter((e) => e.order != null);
  if (charted.length === 0) return null;
  charted.sort((a, b) => (a.order! - b.order!) || a.searchRank - b.searchRank);

  let room = charted;
  if (!charted.some((e) => e.isViewed)) {
    const viewed = entries.find((e) => e.isViewed);
    if (viewed) room = [...charted, viewed];
  }

  const CAP = 8;
  if (room.length > CAP) {
    const capped = room.slice(0, CAP);
    if (!capped.some((e) => e.isViewed)) {
      const viewed = room.find((e) => e.isViewed);
      if (viewed) capped[CAP - 1] = viewed;
    }
    room = capped;
  }

  const roomOut: DepthChartEntry[] = room.map((e) => ({
    slug: e.slug,
    name: e.name,
    sleeperId: e.sleeperId,
    order: e.order,
    injuryStatus: e.injuryStatus,
    isViewed: e.isViewed,
    role: depthRoleLabel(player.position, e.order),
  }));
  return { room: roomOut, viewedRole: roomOut.find((e) => e.isViewed)?.role ?? null };
}

/* ---------------------------------------------------------------- news ---- */

export type LatestArticle = {
  title: string;
  tl_dr: string | null;
  published_at: string | null;
};

/**
 * The single most recent published article that mentions this player, for the
 * overview's news teaser. Two hops because article_players is a join table:
 * collect the article ids, then read the newest published one.
 *
 * Lives here rather than beside the component so lib/player-profile-cache.ts can
 * wrap it, which is what keeps it off the hot path of every profile view.
 */
export async function loadLatestArticle(
  supabase: AnySupabase,
  playerId: string,
): Promise<LatestArticle | null> {
  const db = supabase as SupabaseClient<Database>;
  const { data: links } = await db
    .from("article_players")
    .select("article_id")
    .eq("player_id", playerId);
  const ids = (links ?? []).map((l) => l.article_id);
  if (ids.length === 0) return null;
  const { data } = await db
    .from("articles")
    .select("title, tl_dr, published_at")
    .in("id", ids)
    .eq("status", "published")
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  return (data as LatestArticle | null) ?? null;
}
