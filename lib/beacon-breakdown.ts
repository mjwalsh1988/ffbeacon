/**
 * Beacon Breakdown data + computation layer.
 *
 * Powers the head-to-head player comparison tool at /tools/beacon-breakdown.
 * Unlike the player profile (which resolves format/source per player), a
 * breakdown compares TWO players on ONE shared, resolved (format, source) pair,
 * so the resolver work happens once here and both players are read against it.
 *
 * Everything the tool renders is backed by real data we already store:
 *   - FF Beacon value           -> player_value_history
 *   - overall / position rank   -> rankings
 *   - tier                      -> rankings.tier
 *   - value trend + volatility  -> player_value_trends
 *   - recent production         -> player_positional_finishes
 *   - opportunity / role        -> Sleeper depth_chart_order
 *   - injury designation        -> players.metadata.sleeper.injury_status
 *   - age                       -> players.birth_date
 *   - rest-of-season projection -> player_weekly_projections, through the
 *                                  Power Pulse projection model
 *   - beat rate / consistency   -> player_projection_accuracy
 *   - matchup difficulty        -> nfl_defense_vs_position
 *   - draft market              -> player_market_latest
 *
 * THE ONE RULE THAT MATTERS. The headline meter is a weighted average of the
 * rows in the table below it, not a separate calculation. See lib/breakdown/
 * metrics.ts for the registry both are built from, and lib/breakdown/edge.ts for
 * the composite. Rows that are blends of other rows are displayed but never
 * scored, so nothing is counted twice.
 *
 * QUERY SHAPE. Every read here takes both player ids at once. The tool used to
 * fire three queries per player; with projections, reliability, and market data
 * added, a per-player shape would have meant twenty-odd round trips on a page
 * that has to feel instant.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { resolveFormatSlug, resolveSourceSlug } from "@/lib/preferences";
import {
  getActiveFormats,
  getAvailableSources,
  resolveSourceForFormat,
  describeSource,
} from "@/lib/source";
import {
  recentFinishesForScoring,
  depthRoleLabel,
  readSleeperId,
  sleeperMeta,
  scoringKeyForType,
  type ScoringKey,
  type PositionalFinish,
  type PlayerRow,
} from "@/lib/player-profile";
import { BEACON_SOURCE_SLUG } from "@/components/beacon-value-icon";
import { computeAgeDecimal } from "@/lib/player-age";
import { computeEdge, visibleRows } from "@/lib/breakdown/edge";
import { buildTakeaways, buildVerdict, resolveLensEdges } from "@/lib/breakdown/verdict";
import { DEFAULT_LENS, type LensId } from "@/lib/breakdown/types";
import type { LeagueImpact, MetricSide } from "@/lib/breakdown/metrics";
import type {
  BeaconEdge,
  BreakdownExtras,
  BreakdownPlayer,
  BreakdownRow,
  Takeaway,
} from "@/lib/breakdown/types";

type AnySupabase =
  | SupabaseClient<Database>
  | Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>;

export type {
  BeaconEdge,
  BreakdownExtras,
  BreakdownMarket,
  BreakdownPlayer,
  BreakdownProjection,
  BreakdownReliability,
  BreakdownRow,
  BreakdownSlot,
  EdgeContribution,
  EdgeLabel,
  EdgeWinner,
  Lens,
  LensId,
  ProjectedWeekPoint,
  ReliabilityWeek,
  Takeaway,
} from "@/lib/breakdown/types";
export { LENSES, DEFAULT_LENS, isLensId } from "@/lib/breakdown/types";
export type { LeagueImpact } from "@/lib/breakdown/metrics";

export type BreakdownContext = {
  formatSlug: string;
  formatDisplay: string;
  formatConfigId: string | null;
  scoringKey: ScoringKey;
  /** Format shape, so downstream reads can pick the matching ADP flavour. */
  isDynasty: boolean;
  isSuperflex: boolean;
  sourceSlug: string | null;
  sourceDisplay: string | null;
  valueIsBeacon: boolean;
  /** Present when the requested source could not cover this format. */
  fallbackBanner: { requested: string; actual: string; formatDisplay: string } | null;
};

export type BreakdownResult = {
  a: BreakdownPlayer;
  b: BreakdownPlayer;
  rows: BreakdownRow[];
  edge: BeaconEdge;
  takeaways: Takeaway[];
  verdict: string;
  lens: LensId;
  context: BreakdownContext;
};

/** A player option returned when a slug is unknown. */
export type BreakdownLookup =
  | { ok: true; result: BreakdownResult }
  | { ok: false; missing: string[] };

const PLAYER_SELECT =
  "id, slug, first_name, last_name, full_name, position, team, status, birth_date, external_ids, metadata, years_experience";

/** Age in whole years from an ISO birth date, or null. */
function computeAge(birthDate: string | null): number | null {
  if (!birthDate) return null;
  const parts = birthDate.split("-").map((p) => parseInt(p, 10));
  if (parts.length !== 3 || parts.some((p) => Number.isNaN(p))) return null;
  const [y, m, d] = parts;
  const now = new Date();
  let age = now.getUTCFullYear() - y;
  const beforeBirthday =
    now.getUTCMonth() + 1 < m || (now.getUTCMonth() + 1 === m && now.getUTCDate() < d);
  if (beforeBirthday) age -= 1;
  return age >= 0 && age < 80 ? age : null;
}

function normalizeTrend(dir: string | null): "up" | "down" | "stable" | null {
  if (dir === "up" || dir === "down" || dir === "stable") return dir;
  return null;
}

function intOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string") {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Sleeper's injury designation, or null when the player is healthy. */
function injuryStatusFor(row: PlayerRow): string | null {
  const meta = sleeperMeta(row);
  const raw = meta.injury_status;
  return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : null;
}

/** The empty extras bundle, so a metric side is always well-formed. */
export const EMPTY_EXTRAS: BreakdownExtras = {
  projection: null,
  reliability: null,
  market: null,
};

/* ------------------------------------------------------------------ */
/* Batched loaders. Both players, one query each.                      */
/* ------------------------------------------------------------------ */

/** Latest published value per player for the resolved format + source. */
async function loadValues(
  db: SupabaseClient<Database>,
  playerIds: string[],
  formatConfigId: string | null,
  source: string | null,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!formatConfigId || !source || playerIds.length === 0) return out;

  // Newest first, so the first row seen per player is the current one. Bounded
  // by a generous cap rather than paged: two players cannot have enough same-day
  // history to matter, and the order guarantees the newest lands first.
  const { data } = await db
    .from("player_value_history")
    .select("player_id, value, captured_at")
    .eq("format_config_id", formatConfigId)
    .eq("source", source)
    .in("player_id", playerIds)
    .order("captured_at", { ascending: false })
    .limit(200);

  for (const row of data ?? []) {
    if (!row.player_id || out.has(row.player_id)) continue;
    out.set(row.player_id, Number(row.value));
  }
  return out;
}

type TrendRecord = {
  currentValue: number | null;
  change7d: number | null;
  change30d: number | null;
  change30dPct: number | null;
  change90dPct: number | null;
  trend30d: string | null;
  high30d: number | null;
  low30d: number | null;
  volatility30d: number | null;
  rankChange30d: number | null;
};

async function loadTrendsPair(
  db: SupabaseClient<Database>,
  playerIds: string[],
  formatConfigId: string | null,
  source: string | null,
): Promise<Map<string, TrendRecord>> {
  const out = new Map<string, TrendRecord>();
  if (!formatConfigId || !source || playerIds.length === 0) return out;

  const { data } = await db
    .from("player_value_trends")
    .select(
      "player_id, current_value, change_7d, change_30d, change_30d_pct, change_90d_pct, trend_30d, high_30d, low_30d, volatility_30d, rank_change_30d",
    )
    .eq("format_config_id", formatConfigId)
    .eq("source", source)
    .in("player_id", playerIds);

  for (const row of data ?? []) {
    out.set(row.player_id, {
      currentValue: numOrNull(row.current_value),
      change7d: numOrNull(row.change_7d),
      change30d: numOrNull(row.change_30d),
      change30dPct: numOrNull(row.change_30d_pct),
      change90dPct: numOrNull(row.change_90d_pct),
      trend30d: row.trend_30d,
      high30d: numOrNull(row.high_30d),
      low30d: numOrNull(row.low_30d),
      volatility30d: numOrNull(row.volatility_30d),
      rankChange30d: numOrNull(row.rank_change_30d),
    });
  }
  return out;
}

async function loadFinishesPair(
  db: SupabaseClient<Database>,
  playerIds: string[],
): Promise<Map<string, PositionalFinish[]>> {
  const out = new Map<string, PositionalFinish[]>();
  if (playerIds.length === 0) return out;

  const { data } = await db
    .from("player_positional_finishes")
    .select("player_id, season, scoring, finish, total_points, players_ranked")
    .in("player_id", playerIds);

  for (const row of data ?? []) {
    const list = out.get(row.player_id) ?? [];
    list.push({
      season: Number(row.season),
      scoring: String(row.scoring) as ScoringKey,
      finish: Number(row.finish),
      totalPoints: Number(row.total_points),
      playersRanked: Number(row.players_ranked),
    });
    out.set(row.player_id, list);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Orchestration                                                       */
/* ------------------------------------------------------------------ */

export type LoadBreakdownParams = {
  formatParam?: string;
  sourceParam?: string;
  lens?: LensId;
};

/**
 * Resolve the shared (format, source) context, load both players, and compute
 * the composite for the requested lens. Slugs that match no active player come
 * back in `missing` so the page can render a friendly "player not found" state.
 *
 * Extras (projections, reliability, market) are NOT loaded here. They belong to
 * tabs behind their own Suspense boundaries, so the meter and the matchup header
 * can paint without waiting on them. `applyExtras` folds them in afterwards.
 */
export async function loadBreakdown(
  supabase: AnySupabase,
  slugA: string,
  slugB: string,
  params: LoadBreakdownParams,
): Promise<BreakdownLookup> {
  const db = supabase as SupabaseClient<Database>;
  const lens = params.lens ?? DEFAULT_LENS;

  // One wave. The active-format list is a request-cached fetch shared with
  // SiteHeader, so folding it in here lets us pick the format row in memory
  // instead of firing a second, slug-keyed round trip once the resolver has
  // answered. That collapses a whole serialized query wave off the critical
  // path, the same way the player profile does it.
  const [formatResolution, sourceResolution, { data: playerRows }, registry, activeFormats] =
    await Promise.all([
      resolveFormatSlug(db, params.formatParam),
      resolveSourceSlug(db, params.sourceParam),
      db.from("players").select(PLAYER_SELECT).in("slug", [slugA, slugB]),
      getAvailableSources(db),
      getActiveFormats(db),
    ]);

  const bySlug = new Map<string, PlayerRow>();
  for (const row of (playerRows ?? []) as unknown as PlayerRow[]) {
    bySlug.set(row.slug, row);
  }
  const missing = [slugA, slugB].filter((s) => !bySlug.has(s));
  if (missing.length > 0) return { ok: false, missing };

  // Active formats only. The format dropdown never offers an inactive one, and
  // an unknown slug falls through to a null config, which degrades to "no
  // values for this format" rather than throwing.
  const formatConfig = activeFormats.find((f) => f.slug === formatResolution.slug) ?? null;

  const formatConfigId = formatConfig?.id ?? null;
  const formatDisplay = formatConfig?.display_name ?? formatResolution.slug;
  const scoringKey = scoringKeyForType(formatConfig?.scoring_type);
  const isDynasty = formatConfig?.league_type === "dynasty";
  const isSuperflex = Boolean(formatConfig?.is_superflex);
  const requestedSource = sourceResolution.slug;

  const valueResolution = formatConfig
    ? resolveSourceForFormat(registry, "player_value_history", formatConfig.slug, requestedSource)
    : { source: null, requested: requestedSource, fellBack: false, availableForFormat: [] };
  const rankingsResolution = formatConfig
    ? resolveSourceForFormat(registry, "rankings", formatConfig.slug, requestedSource)
    : { source: null, requested: requestedSource, fellBack: false, availableForFormat: [] };

  const valueSource = valueResolution.source;
  const rankingsSource = rankingsResolution.source;

  const fallbackBanner =
    valueResolution.fellBack && valueResolution.source
      ? {
          requested: describeSource(registry, valueResolution.requested),
          actual: describeSource(registry, valueResolution.source),
          formatDisplay,
        }
      : null;

  const rowA = bySlug.get(slugA)!;
  const rowB = bySlug.get(slugB)!;
  const playerIds = [rowA.id, rowB.id];
  const teamAbbrs = [rowA.team, rowB.team].filter((t): t is string => Boolean(t));

  // One wave for everything the core comparison needs.
  const [teamRowsRes, rankRowsRes, values, trends, finishes] = await Promise.all([
    teamAbbrs.length > 0
      ? db.from("nfl_teams").select("abbreviation, primary_color").in("abbreviation", teamAbbrs)
      : Promise.resolve({ data: [] as { abbreviation: string; primary_color: string | null }[] }),
    formatConfigId && rankingsSource
      ? db
          .from("rankings")
          .select("player_id, overall_rank, position_rank, tier, generated_at")
          .eq("format_config_id", formatConfigId)
          .eq("source", rankingsSource)
          .is("week", null)
          .in("player_id", playerIds)
          .order("generated_at", { ascending: false })
      : Promise.resolve({ data: [] as never[] }),
    loadValues(db, playerIds, formatConfigId, valueSource),
    loadTrendsPair(db, playerIds, formatConfigId, valueSource),
    loadFinishesPair(db, playerIds),
  ]);

  const teamColors = new Map<string, string>();
  for (const t of teamRowsRes.data ?? []) {
    if (t.primary_color) teamColors.set(t.abbreviation, t.primary_color);
  }

  const rankByPlayer = new Map<
    string,
    { overall: number | null; position: number | null; tier: number | null }
  >();
  for (const r of (rankRowsRes.data ?? []) as Array<{
    player_id: string;
    overall_rank: number | null;
    position_rank: number | null;
    tier: number | null;
  }>) {
    if (rankByPlayer.has(r.player_id)) continue;
    rankByPlayer.set(r.player_id, {
      overall: r.overall_rank ?? null,
      position: r.position_rank ?? null,
      tier: r.tier ?? null,
    });
  }

  function buildPlayer(row: PlayerRow): BreakdownPlayer {
    const trend = trends.get(row.id) ?? null;
    const rank = rankByPlayer.get(row.id);
    const recent = recentFinishesForScoring(finishes.get(row.id) ?? [], scoringKey, 3);
    const meta = sleeperMeta(row);
    const depthOrder = intOrNull(meta.depth_chart_order);

    return {
      slug: row.slug,
      id: row.id,
      name: row.full_name ?? `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim(),
      position: row.position,
      team: row.team,
      teamPrimary: row.team ? (teamColors.get(row.team) ?? null) : null,
      sleeperId: readSleeperId(row),
      age: computeAge(row.birth_date),
      ageDecimal: computeAgeDecimal(row.birth_date),
      yearsExperience: row.years_experience ?? null,
      injuryStatus: injuryStatusFor(row),
      value: values.get(row.id) ?? trend?.currentValue ?? null,
      overallRank: rank?.overall ?? null,
      positionRank: rank?.position ?? null,
      tier: rank?.tier ?? null,
      change7d: trend?.change7d ?? null,
      change30d: trend?.change30d ?? null,
      change30dPct: trend?.change30dPct ?? null,
      change90dPct: trend?.change90dPct ?? null,
      trend30d: normalizeTrend(trend?.trend30d ?? null),
      volatility30d: trend?.volatility30d ?? null,
      high30d: trend?.high30d ?? null,
      low30d: trend?.low30d ?? null,
      rankChange30d: trend?.rankChange30d ?? null,
      latestFinish: recent[0] ?? null,
      recentFinishes: recent,
      depthRole: depthRoleLabel(row.position, depthOrder),
      depthOrder,
    };
  }

  const a = buildPlayer(rowA);
  const b = buildPlayer(rowB);
  const valueIsBeacon = valueSource === BEACON_SOURCE_SLUG;

  const result = assembleBreakdown({
    a,
    b,
    extrasA: EMPTY_EXTRAS,
    extrasB: EMPTY_EXTRAS,
    leagueA: null,
    leagueB: null,
    lens,
    valueIsBeacon,
    context: {
      formatSlug: formatResolution.slug,
      formatDisplay,
      formatConfigId,
      scoringKey,
      isDynasty,
      isSuperflex,
      sourceSlug: valueSource,
      sourceDisplay: valueSource ? describeSource(registry, valueSource) : null,
      valueIsBeacon,
      fallbackBanner,
    },
  });

  return { ok: true, result };
}

/**
 * Build the rows, meter, takeaways, and verdict from two fully-shaped sides.
 *
 * Exported because the extras and league-mode paths recompute the same thing
 * with richer inputs, and it must be the SAME assembly: a league-aware verdict
 * that used different code from the public one would be a second opinion, not a
 * better-informed one.
 */
export function assembleBreakdown(input: {
  a: BreakdownPlayer;
  b: BreakdownPlayer;
  extrasA: BreakdownExtras;
  extrasB: BreakdownExtras;
  leagueA: LeagueImpact | null;
  leagueB: LeagueImpact | null;
  lens: LensId;
  valueIsBeacon: boolean;
  context: BreakdownContext;
}): BreakdownResult {
  const sideA: MetricSide = { player: input.a, extras: input.extrasA, league: input.leagueA };
  const sideB: MetricSide = { player: input.b, extras: input.extrasB, league: input.leagueB };

  const { edge, rows } = computeEdge(sideA, sideB, input.lens, input.valueIsBeacon);

  // The takeaways and the verdict both need the dynasty and win-now composites.
  // Resolved once here (and reused when one of them IS the active lens) so the
  // full metric set is evaluated at most three times per render instead of five.
  const lenses = resolveLensEdges(sideA, sideB, { lens: input.lens, edge });

  return {
    a: input.a,
    b: input.b,
    rows: visibleRows(rows),
    edge,
    takeaways: buildTakeaways(sideA, sideB, lenses),
    verdict: buildVerdict(sideA, sideB, edge, input.lens, lenses),
    lens: input.lens,
    context: input.context,
  };
}

/** Fold the market fields that live on the player into the market bundle. */
export function mergeMarket(
  player: BreakdownPlayer,
  extras: BreakdownExtras,
): BreakdownExtras {
  if (!extras.market) return extras;
  return {
    ...extras,
    market: {
      ...extras.market,
      high30d: player.high30d,
      low30d: player.low30d,
      volatility30d: player.volatility30d,
      rankChange30d: player.rankChange30d,
      change90dPct: player.change90dPct,
    },
  };
}
