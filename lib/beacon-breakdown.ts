/**
 * Beacon Breakdown data + computation layer.
 *
 * Powers the head-to-head player comparison tool at /tools/who-should-i-start.
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
import { computeEdge, computeGroupEdge, visibleRows } from "@/lib/breakdown/edge";
import { buildTakeaways, buildVerdict, resolveLensEdges } from "@/lib/breakdown/verdict";
import { DEFAULT_LENS, LENSES, type LensId } from "@/lib/breakdown/types";
import type { LeagueImpact, MetricSide } from "@/lib/breakdown/metrics";
import type {
  BeaconEdge,
  BreakdownExtras,
  BreakdownGroup,
  BreakdownPlayer,
  BreakdownRow,
  GroupEdge,
  Takeaway,
} from "@/lib/breakdown/types";
import { loadBreakdownExtras, type ExtrasSubject } from "@/lib/breakdown/load-extras";
import {
  DEFAULT_POWER_PULSE_SETTINGS,
  type PowerPulseSettings,
} from "@/lib/power-pulse/default-settings";
import { MIN_START_SIT_PLAYERS, MAX_START_SIT_PLAYERS } from "@/lib/start-sit/types";

type AnySupabase =
  | SupabaseClient<Database>
  | Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>;

export type {
  BeaconEdge,
  BreakdownExtras,
  BreakdownGroup,
  BreakdownMarket,
  BreakdownPlayer,
  BreakdownProjection,
  BreakdownReliability,
  BreakdownRow,
  BreakdownSlot,
  EdgeContribution,
  EdgeLabel,
  EdgeWinner,
  GroupEdge,
  GroupEdgeContribution,
  GroupEdgeSide,
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

export type LoadBreakdownPairParams = {
  formatParam?: string;
  sourceParam?: string;
  lens?: LensId;
};

/** @deprecated Name kept for anything still importing the old pair-only type. */
export type LoadBreakdownParams = LoadBreakdownPairParams;

type LoadBreakdownCoreParams = {
  formatParam?: string;
  sourceParam?: string;
};

/** Everything loadBreakdownCore resolves once, shared by the pair and group loaders. */
type BreakdownCoreLookup =
  | {
      ok: true;
      sides: BreakdownPlayer[];
      context: BreakdownContext;
      /**
       * Points added per projected reception in a TE-premium format, for the
       * extras loader's ExtrasContext. Deliberately not on BreakdownContext:
       * loadBreakdownPair's result.context must stay byte-for-byte what it was
       * before this field existed, since BEAM and the OG route depend on it.
       */
      tePremiumPerReception: number;
    }
  | { ok: false; missing: string[] };

/**
 * Resolve the shared (format, source) context and load every side's core
 * fields (value, rank, trend, recent finish, team color, age, injury) in one
 * wave. Slugs that match no active player come back in `missing` so the
 * caller can render a friendly "player not found" state.
 *
 * Extras (projections, reliability, market) are NOT loaded here. For the pair
 * loader they belong to tabs behind their own Suspense boundaries, so the
 * meter and the matchup header can paint without waiting on them. The group
 * loader below loads them itself, since the background tabs it feeds have no
 * separate Suspense boundary of their own to defer into.
 */
async function loadBreakdownCore(
  supabase: AnySupabase,
  slugs: string[],
  params: LoadBreakdownCoreParams,
): Promise<BreakdownCoreLookup> {
  const db = supabase as SupabaseClient<Database>;

  // One wave. The active-format list is a request-cached fetch shared with
  // SiteHeader, so folding it in here lets us pick the format row in memory
  // instead of firing a second, slug-keyed round trip once the resolver has
  // answered. That collapses a whole serialized query wave off the critical
  // path, the same way the player profile does it.
  const [formatResolution, sourceResolution, { data: playerRows }, registry, activeFormats] =
    await Promise.all([
      resolveFormatSlug(db, params.formatParam),
      resolveSourceSlug(db, params.sourceParam),
      db.from("players").select(PLAYER_SELECT).in("slug", slugs),
      getAvailableSources(db),
      getActiveFormats(db),
    ]);

  const bySlug = new Map<string, PlayerRow>();
  for (const row of (playerRows ?? []) as unknown as PlayerRow[]) {
    bySlug.set(row.slug, row);
  }
  const missing = slugs.filter((s) => !bySlug.has(s));
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

  // Slugs, in the caller's order, so sides[i] always corresponds to slugs[i].
  const rows = slugs.map((s) => bySlug.get(s)!);
  const playerIds = rows.map((r) => r.id);
  const teamAbbrs = [...new Set(rows.map((r) => r.team).filter((t): t is string => Boolean(t)))];

  // One wave for everything every side needs, run in parallel regardless of
  // how many sides there are: N players cost one round trip per read, not N.
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

  const sides = rows.map(buildPlayer);
  const valueIsBeacon = valueSource === BEACON_SOURCE_SLUG;

  return {
    ok: true,
    sides,
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
    tePremiumPerReception: formatConfig?.te_premium_bonus ?? 0,
  };
}

/**
 * The two-player Beacon Breakdown: resolve the shared (format, source)
 * context, load both players, and compute the composite for the requested
 * lens through computeEdge. This is the ORIGINAL loadBreakdown, kept under a
 * new name and unchanged in behavior: BEAM's player.compare.verdict capability
 * and the pair OG share-image route both depend on this exact shape and must
 * see byte-for-byte the same result they always have.
 */
export async function loadBreakdownPair(
  supabase: AnySupabase,
  slugA: string,
  slugB: string,
  params: LoadBreakdownPairParams,
): Promise<BreakdownLookup> {
  const lens = params.lens ?? DEFAULT_LENS;
  const core = await loadBreakdownCore(supabase, [slugA, slugB], params);
  if (!core.ok) return { ok: false, missing: core.missing };

  const [a, b] = core.sides;
  const result = assembleBreakdown({
    a,
    b,
    extrasA: EMPTY_EXTRAS,
    extrasB: EMPTY_EXTRAS,
    leagueA: null,
    leagueB: null,
    lens,
    valueIsBeacon: core.context.valueIsBeacon,
    context: core.context,
  });

  return { ok: true, result };
}

export type LoadBreakdownGroupParams = {
  formatParam?: string;
  sourceParam?: string;
  /**
   * Service-role-only settings the extras loader needs for its projection
   * pass. Read once by the caller with an admin client and handed down, the
   * same split load-extras.ts documents; omitted, the projection engine's own
   * code defaults apply.
   */
  pulseSettings?: PowerPulseSettings;
};

/** Everything the background tabs need for a group of two to eight players. */
export type BreakdownGroupResult = {
  group: BreakdownGroup;
  /** Projections, reliability, and market, keyed by player id. */
  extras: Map<string, BreakdownExtras>;
  context: BreakdownContext;
};

export type BreakdownGroupLookup =
  | { ok: true; result: BreakdownGroupResult }
  | { ok: false; missing: string[] };

/**
 * The N-sided Beacon Breakdown (two to eight players) behind the Who Should I
 * Start background tabs. Loads every side's core fields AND its extras
 * (projections, reliability, market) in this one call, then computes the
 * composite for all three lenses at once through computeGroupEdge, because
 * the lens switch lives in the Head to head tab's own client state rather
 * than the URL and so cannot round-trip to the server on a flip.
 *
 * Unlike loadBreakdownPair, extras are loaded here rather than left to a tab's
 * own Suspense boundary: the group tabs (Projections, Reliability, Market)
 * read the same bundle the Head to head tab's composite is built from, so a
 * second, later-arriving read can never disagree with the numbers the meter
 * already showed.
 *
 * No league mode: the "Your lineup" tab's per-league numbers are resolved
 * separately (calculateLeagueImpact takes the candidate list directly), so
 * every side here carries `league: null` into computeGroupEdge, exactly as
 * loadBreakdownPair's plain (non-league) path does for computeEdge.
 */
export async function loadBreakdown(
  supabase: AnySupabase,
  slugs: string[],
  params: LoadBreakdownGroupParams,
): Promise<BreakdownGroupLookup> {
  if (slugs.length < MIN_START_SIT_PLAYERS || slugs.length > MAX_START_SIT_PLAYERS) {
    throw new Error(
      `loadBreakdown expects ${MIN_START_SIT_PLAYERS} to ${MAX_START_SIT_PLAYERS} slugs, got ${slugs.length}`,
    );
  }

  const core = await loadBreakdownCore(supabase, slugs, params);
  if (!core.ok) return { ok: false, missing: core.missing };

  const { sides, context, tePremiumPerReception } = core;

  const extrasSubjects: ExtrasSubject[] = sides.map((s) => ({
    id: s.id,
    position: s.position,
    team: s.team,
    injuryStatus: s.injuryStatus,
    overallRank: s.overallRank,
  }));

  const rawExtras = await loadBreakdownExtras(
    supabase,
    extrasSubjects,
    {
      scoringKey: context.scoringKey,
      formatConfigId: context.formatConfigId,
      valueSource: context.sourceSlug,
      isDynasty: context.isDynasty,
      isSuperflex: context.isSuperflex,
      tePremiumPerReception,
    },
    params.pulseSettings ?? DEFAULT_POWER_PULSE_SETTINGS,
  );

  const extras = new Map<string, BreakdownExtras>(
    sides.map((s) => [s.id, mergeMarket(s, rawExtras.get(s.id) ?? EMPTY_EXTRAS)]),
  );

  const metricSides: MetricSide[] = sides.map((player) => ({
    player,
    extras: extras.get(player.id) ?? EMPTY_EXTRAS,
    league: null,
  }));

  const edges = Object.fromEntries(
    LENSES.map((lens) => [lens.id, computeGroupEdge(metricSides, lens.id)]),
  ) as Record<LensId, GroupEdge>;

  return {
    ok: true,
    result: {
      group: { sides, edges },
      extras,
      context,
    },
  };
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
