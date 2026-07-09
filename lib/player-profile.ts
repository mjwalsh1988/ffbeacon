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
  describeSource,
  type SourceRegistryRow,
} from "@/lib/source";
import { resolveFormatSlug, resolveSourceSlug } from "@/lib/preferences";

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

  const [formatResolution, sourceResolution, { data: playerRaw }] = await Promise.all([
    resolveFormatSlug(db, params.formatParam),
    resolveSourceSlug(db, params.sourceParam),
    db
      .from("players")
      .select(
        "id, slug, first_name, last_name, full_name, position, team, status, birth_date, height_inches, weight_lbs, college, years_experience, draft_year, draft_round, draft_pick, external_ids, metadata",
      )
      .eq("slug", slug)
      .maybeSingle(),
  ]);

  if (!playerRaw) return null;
  const player = playerRaw as unknown as PlayerRow;

  const selectedFormatSlug = formatResolution.slug;
  const requestedSourceSlug = sourceResolution.slug;

  const [{ data: formatConfig }, registry] = await Promise.all([
    db
      .from("format_configs")
      .select("id, slug, display_name, scoring_type")
      .eq("slug", selectedFormatSlug)
      .maybeSingle(),
    getAvailableSources(db),
  ]);

  const registrySlugs = registry.map((r) => r.slug);
  const formatConfigId = formatConfig?.id ?? null;
  const formatDisplay = formatConfig?.display_name ?? selectedFormatSlug;
  const scoringType = formatConfig?.scoring_type ?? "ppr";

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
 * Positional finishes via the RPC. Returns one entry per (season, scoring).
 * Pass seasons to limit; omit for every season the player has stats.
 */
export async function loadPositionalFinishes(
  supabase: AnySupabase,
  playerId: string,
  seasons?: number[],
): Promise<PositionalFinish[]> {
  const db = supabase as SupabaseClient<Database>;
  const { data, error } = await db.rpc("get_player_positional_finishes", {
    p_player_id: playerId,
    p_seasons: seasons,
  });
  if (error || !data) return [];
  return (data as Array<Record<string, unknown>>).map((r) => ({
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
      "current_value, change_7d, change_7d_pct, change_30d, change_30d_pct, change_90d, change_90d_pct, trend_7d, trend_30d, high_30d, low_30d, data_points_30d, show_trend_7d, show_trend_30d, show_trend_90d",
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
  metadata: unknown;
};

/** Every regular-season weekly stat row for the player, newest first. */
export async function loadWeeklyStats(
  supabase: AnySupabase,
  playerId: string,
): Promise<WeeklyStatRow[]> {
  const db = supabase as SupabaseClient<Database>;
  const { data } = await db
    .from("player_stats")
    .select(
      "season, week, opponent, snap_pct, gp, pass_cmp, pass_att, pass_yd, pass_td, pass_int, rush_att, rush_yd, rush_td, rec, rec_tgt, rec_yd, rec_td, metadata",
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
