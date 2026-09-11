/**
 * lib/start-sit/toughest-calls.ts
 *
 * This week's toughest start/sit calls: eight to twelve real comparisons for
 * the live week, pre-computed and server-rendered on the empty state of the
 * Who Should I Start page, plus three closest pairs per position for the
 * "Closest calls at {position} this week" lists under each positional
 * heading (docs/seo/who-should-i-start-and-site-seo-plan.md section 2.8).
 *
 * Split in two, per the plan:
 *   - selectToughestCalls: PURE, over plain data. Everything the tests in
 *     toughest-calls.test.ts exercise lives here: the startable cut, the
 *     pairing window, the closeness ordering, the one-appearance-per-player
 *     diversity rule, and the grid size bound.
 *   - loadStartSitToughestCalls / loadStartSitToughestCallsCached: server
 *     only. The read, and the unstable_cache wrapper around it.
 *
 * NO NEW MODEL. A pair's verdict sentence is computeStartSit's verdictLine
 * for exactly those two candidates with startCount = 1 (lib/start-sit/engine.ts),
 * the same function and the same template the board itself prints. This file
 * introduces no scoring of its own beyond the closeness ranking used to pick
 * which pairs are worth showing.
 *
 * WHY THE PROJECTION FIELDS ARE THIN. computeStartSit's verdictLine reads
 * only points, sigma (through confidence) and formatDisplay (see
 * lib/start-sit/reasons.ts buildStartSitVerdictLine): it never reads
 * defenseRankVsPosition or environment. The `reasons` array on the returned
 * StartSitVerdict DOES read those, but this file never asks for `reasons`,
 * only `verdictLine` and `confidence`. So the loader below fetches only what
 * loadAdjustedProjections already returns (points, sigma, floor, ceiling)
 * and leaves the matchup/environment fields on each StartSitProjection at
 * their null defaults, rather than paying for loadDefenseRanks and
 * loadGameEnvironment, whose fields nothing here consumes. `availability` is
 * the one exception: see the SEO-T911 note below.
 *
 * SEO-T911: THE UNIVERSE MUST READ AVAILABILITY. A player ruled out still
 * often carries a nonzero week projection (the source has not zeroed him,
 * see lib/power-pulse/project.ts's own note on the same shape), so a
 * "points !== null" filter alone lets an inactive player win a "toughest
 * call" against someone who is actually playing. Two independent signals say
 * a player cannot suit up, and either one is enough:
 *   - player_weekly_projections.availability === "out" for the live week
 *     (the same field lib/start-sit/load.ts reads for the board itself).
 *   - players.metadata.sleeper.injury_status, case-insensitively, is Out,
 *     IR, PUP or Suspended (TOUGHEST_CALLS_UNAVAILABLE_INJURY_STATUSES
 *     below). This is deliberately narrower than
 *     lib/power-pulse/project.ts's LONG_TERM_INJURY_STATUSES (IR, PUP, NA,
 *     SUS, COV, DNR): that set zeroes a projection's WEIGHT, this one
 *     decides whether a player belongs in the universe at all, and the task
 *     spec names exactly these four designations. NA, SUS-as-abbreviation,
 *     COV and DNR are left out on purpose rather than guessed into a wider
 *     net.
 * The loader adds exactly one query for this (player_weekly_projections,
 * columns player_id and availability only, never a projected_pts_* column,
 * see raw-column-guard.test.ts), and selectToughestCalls does the actual
 * exclusion so it stays testable without a database.
 *
 * PROJECTION SOURCE CONTRACT (lib/start-sit/types.ts). The source is
 * resolved once per (season, week) window, the same way
 * loadAdjustedProjections resolves it for the board. It is part of the cache
 * key (see loadStartSitToughestCallsCached) and is the value threaded into
 * every verdict as `projectionSource`, never a hardcoded word.
 *
 * DEVIATION FROM SECTION 2.8's CACHE KEY. The plan's own key example reads
 * ["start-sit-toughest", season, week, formatSlug, projectionSource]. Task
 * SEO-T911 adds the rankings source: the universe is read from `rankings`
 * for the reader's FORMAT AND SOURCE (a KTC board and an FF Beacon board rank
 * players differently, which changes which pairs are even eligible to be
 * "toughest"), so a value-source flip has to invalidate this cache exactly
 * like a projection-source flip does. The key here is
 * ["start-sit-toughest", season, week, formatSlug, rankingsSource,
 * projectionSource].
 *
 * "RESOLVE OUTSIDE THE CACHED FUNCTION." unstable_cache keys are plain
 * arrays built before the cached closure ever runs, so the projection source
 * has to be known before that call, not discovered inside it.
 * resolveToughestCallsProjectionSource below does exactly the query
 * loadAdjustedProjections would do internally (load settings, then
 * resolveProjectionSourceForWindow), run once up front to build the key. It
 * reads no cookies and nothing user-scoped: format, source and week all
 * arrive as already-resolved arguments from the caller, which is the piece
 * that DOES depend on cookies (resolveFormatSlug / resolveSourceSlug) and
 * therefore has to run outside this module entirely, in whatever page wires
 * this in.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { unstable_cache } from "next/cache";
import type { Database } from "@/lib/database.types";
import { createCachedReadClient } from "@/lib/supabase/server";
import { CACHE_TAGS } from "@/lib/cache-tags";
import { scoringSettingsForFormat } from "@/lib/league-scoring";
import { readSleeperId, sleeperMeta, type PlayerRow } from "@/lib/player-profile";
import { normalizeCandidatePosition, floorCeiling } from "@/lib/start-sit/load";
import {
  loadAdjustedProjections,
  type AdjustedProjectionSummary,
} from "@/lib/projections/read";
import { resolveProjectionSourceForWindow } from "@/lib/projections/source";
import { SLEEPER_SOURCE } from "@/lib/projections/source-constants";
import { loadPowerPulseSettings } from "@/lib/power-pulse/settings";
import { PULSE_POSITIONS } from "@/lib/power-pulse/types";
import { computeStartSit } from "@/lib/start-sit/engine";
import type { StartSitCandidate, StartSitProjection, PulsePosition } from "@/lib/start-sit/types";

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

/**
 * Top N by positional rank, per position: who counts as "startable" for the
 * purposes of this block. Section 2.8's own figures.
 */
export const TOUGHEST_CALLS_STARTABLE_CUT: Record<PulsePosition, number> = {
  QB: 16,
  RB: 30,
  WR: 36,
  TE: 14,
  K: 12,
  DEF: 12,
};

/** The largest single cut above, so the loader's rankings read can bound itself with one number. */
export const TOUGHEST_CALLS_MAX_STARTABLE_CUT = Math.max(
  ...Object.values(TOUGHEST_CALLS_STARTABLE_CUT),
);

/**
 * Each player is paired against the next three below him in his own
 * position, by projected points. A player is never paired against anyone
 * further down than this, however close their points end up being: "next
 * three below" is a window on rank-by-points, not a closeness search over
 * the whole position.
 */
export const TOUGHEST_CALLS_PAIR_WINDOW = 3;

/**
 * Under this absolute points difference, a pair is in the close tier;
 * TOUGHEST_CALLS_MAX_STARTABLE_CUT or greater is not. Every close-tier pair
 * sorts ahead of every pair that misses it, regardless of confidence.
 */
export const TOUGHEST_CALLS_CLOSE_POINTS_THRESHOLD = 2.0;

/** Fewest pairs a healthy grid holds. Not enforced by padding: a thin universe can still return less. */
export const TOUGHEST_CALLS_GRID_MIN = 8;

/** Most pairs the grid ever holds, and the point past which selection stops. */
export const TOUGHEST_CALLS_GRID_MAX = 12;

/** Closest pairs kept per position for the "Closest calls at {position}" lists. */
export const TOUGHEST_CALLS_BY_POSITION_SIZE = 3;

/**
 * Sleeper injury_status values (players.metadata.sleeper.injury_status,
 * verbatim) that mean a player cannot play at all this week. Compared
 * uppercase and trimmed, the same normalisation
 * lib/power-pulse/project.ts's injuryMultiplier already applies to this
 * field. See the SEO-T911 header note for why this list is narrower than
 * that file's LONG_TERM_INJURY_STATUSES.
 */
export const TOUGHEST_CALLS_UNAVAILABLE_INJURY_STATUSES = new Set([
  "OUT",
  "IR",
  "PUP",
  "SUSPENDED",
]);

/** 6 hours. Section 2.8's own figure. */
export const TOUGHEST_CALLS_REVALIDATE_SECONDS = 6 * 60 * 60;

/* ------------------------------------------------------------------ */
/* Pure selector types                                                 */
/* ------------------------------------------------------------------ */

/** One player, as a toughest-calls pair names them. */
export type ToughestCallsPlayer = {
  slug: string;
  name: string;
  position: PulsePosition;
  team: string | null;
  sleeperId: string | null;
};

/** One toughest call: a and b, with a always the side computeStartSit would start. */
export type ToughestCallsPair = {
  a: ToughestCallsPlayer;
  b: ToughestCallsPlayer;
  week: number;
  pointsA: number;
  pointsB: number;
  /** P(a outscores b); null when either side's sigma is missing. */
  confidence: number | null;
  /** computeStartSit's verdictLine for [a, b] at startCount 1. Same sentence the board prints. */
  verdict: string;
};

/** One universe player, before the startable cut and the pairing. */
export type ToughestCallsUniversePlayer = {
  candidate: StartSitCandidate;
  projection: StartSitProjection;
  /** rankings.position_rank for the reader's format and rankings source. Drives the startable cut only. */
  positionRank: number;
};

export type SelectToughestCallsInput = {
  universe: ToughestCallsUniversePlayer[];
  week: number;
  season: number;
  formatDisplay: string;
  projectionSource: string;
};

export type ToughestCallsResult = {
  /** 8 to 12 pairs, at most one appearance per player, at least one pair per position that has one. */
  grid: ToughestCallsPair[];
  /** Every PULSE_POSITIONS key, each holding up to TOUGHEST_CALLS_BY_POSITION_SIZE pairs (possibly none). */
  byPosition: Record<PulsePosition, ToughestCallsPair[]>;
};

/* ------------------------------------------------------------------ */
/* Pure selector                                                       */
/* ------------------------------------------------------------------ */

function toPlayer(candidate: StartSitCandidate): ToughestCallsPlayer {
  return {
    slug: candidate.slug,
    name: candidate.name,
    position: candidate.position,
    team: candidate.team,
    sleeperId: candidate.sleeperId,
  };
}

/**
 * One pair's verdict, via computeStartSit at startCount 1. Null only when
 * computeStartSit produces no starter for either side, which cannot happen
 * for two candidates who both already passed the "has points" filter below,
 * but the check is kept rather than asserted past.
 */
function buildPair(
  x: ToughestCallsUniversePlayer,
  y: ToughestCallsUniversePlayer,
  week: number,
  season: number,
  formatDisplay: string,
  projectionSource: string,
): ToughestCallsPair | null {
  const verdict = computeStartSit({
    candidates: [x.candidate, y.candidate],
    projections: {
      [x.candidate.playerId]: x.projection,
      [y.candidate.playerId]: y.projection,
    },
    startCount: 1,
    week,
    season,
    formatDisplay,
    projectionSource,
  });

  const starterId = verdict.starters[0];
  const benchId = verdict.bench[0];
  if (!starterId || !benchId) return null;

  const starter = starterId === x.candidate.playerId ? x : y;
  const bench = benchId === x.candidate.playerId ? x : y;
  if (starter.projection.points === null || bench.projection.points === null) return null;

  return {
    a: toPlayer(starter.candidate),
    b: toPlayer(bench.candidate),
    week,
    pointsA: starter.projection.points,
    pointsB: bench.projection.points,
    confidence: verdict.confidence,
    verdict: verdict.verdictLine,
  };
}

/**
 * True when either the projection's own availability read or the player's
 * Sleeper injury designation says he cannot play this week. See the
 * SEO-T911 header note.
 */
function isUnavailable(entry: ToughestCallsUniversePlayer): boolean {
  if (entry.projection.availability === "out") return true;
  const status = entry.candidate.injuryStatus;
  if (!status) return false;
  return TOUGHEST_CALLS_UNAVAILABLE_INJURY_STATUSES.has(status.trim().toUpperCase());
}

/** 0 (close, under the threshold) or 1 (not). Every tier-0 pair outranks every tier-1 pair. */
function closenessTier(pair: ToughestCallsPair): 0 | 1 {
  return Math.abs(pair.pointsA - pair.pointsB) < TOUGHEST_CALLS_CLOSE_POINTS_THRESHOLD ? 0 : 1;
}

/** Distance from a coin flip. A null confidence (unmeasured) is always the least close. */
function confidenceDistance(pair: ToughestCallsPair): number {
  return pair.confidence === null ? Number.POSITIVE_INFINITY : Math.abs(pair.confidence - 0.5);
}

/** a.slug then b.slug, purely for a total, deterministic order when every other key ties. */
function pairKey(pair: ToughestCallsPair): string {
  return `${pair.a.slug}|${pair.b.slug}`;
}

/**
 * Closest first: tier (points diff under the threshold beats over it), then
 * confidence nearest 0.5, then the raw points difference, then a's slug then
 * b's slug. The last two steps exist only to make the order total and
 * reproducible; every board-visible ranking is decided by the first two.
 */
export function comparePairsByCloseness(x: ToughestCallsPair, y: ToughestCallsPair): number {
  const tierDiff = closenessTier(x) - closenessTier(y);
  if (tierDiff !== 0) return tierDiff;

  const confDiff = confidenceDistance(x) - confidenceDistance(y);
  if (confDiff !== 0) return confDiff;

  const rawDiff = Math.abs(x.pointsA - x.pointsB) - Math.abs(y.pointsA - y.pointsB);
  if (rawDiff !== 0) return rawDiff;

  const xKey = pairKey(x);
  const yKey = pairKey(y);
  if (xKey === yKey) return 0;
  return xKey < yKey ? -1 : 1;
}

/**
 * Descending by projected points; ties by slug ascending. This is the order
 * pairing walks: player i is paired against i+1..i+TOUGHEST_CALLS_PAIR_WINDOW
 * in THIS order, never against anyone this sort put further down.
 */
function comparePointsDescending(a: ToughestCallsUniversePlayer, b: ToughestCallsUniversePlayer): number {
  const pa = a.projection.points as number;
  const pb = b.projection.points as number;
  if (pa !== pb) return pb - pa;
  return a.candidate.slug.localeCompare(b.candidate.slug);
}

/**
 * The whole toughest-calls computation, from plain data. PURE: no database,
 * no React, no "server-only".
 *
 * Steps: filter the universe to the startable cut, to players who have a
 * real points figure for the week, and to players who are actually
 * available to play (SEO-T911, isUnavailable above); group by position and
 * order by points;
 * pair each player against the next TOUGHEST_CALLS_PAIR_WINDOW below him;
 * take the three closest per position for byPosition; build the grid by
 * guaranteeing one pair per position that has any, then filling the
 * remaining slots (up to TOUGHEST_CALLS_GRID_MAX) with the next-closest
 * pairs anywhere, never reusing a player already on the grid.
 */
export function selectToughestCalls(input: SelectToughestCallsInput): ToughestCallsResult {
  const { universe, week, season, formatDisplay, projectionSource } = input;

  const eligible = universe.filter(
    (entry) =>
      entry.projection.points !== null &&
      entry.positionRank <= TOUGHEST_CALLS_STARTABLE_CUT[entry.candidate.position] &&
      !isUnavailable(entry),
  );

  const grouped = new Map<PulsePosition, ToughestCallsUniversePlayer[]>();
  for (const position of PULSE_POSITIONS) grouped.set(position, []);
  for (const entry of eligible) {
    grouped.get(entry.candidate.position)!.push(entry);
  }
  for (const list of grouped.values()) {
    list.sort(comparePointsDescending);
  }

  const pairsByPosition = new Map<PulsePosition, ToughestCallsPair[]>();
  for (const position of PULSE_POSITIONS) {
    const list = grouped.get(position)!;
    const pairs: ToughestCallsPair[] = [];
    for (let i = 0; i < list.length; i += 1) {
      for (let offset = 1; offset <= TOUGHEST_CALLS_PAIR_WINDOW; offset += 1) {
        const j = i + offset;
        if (j >= list.length) break;
        const pair = buildPair(list[i], list[j], week, season, formatDisplay, projectionSource);
        if (pair) pairs.push(pair);
      }
    }
    pairs.sort(comparePairsByCloseness);
    pairsByPosition.set(position, pairs);
  }

  const byPosition = {} as Record<PulsePosition, ToughestCallsPair[]>;
  for (const position of PULSE_POSITIONS) {
    byPosition[position] = pairsByPosition.get(position)!.slice(0, TOUGHEST_CALLS_BY_POSITION_SIZE);
  }

  const usedSlugs = new Set<string>();
  const grid: ToughestCallsPair[] = [];

  // Pass 1: guarantee one pair per position that has any, in a fixed order.
  for (const position of PULSE_POSITIONS) {
    const pairs = pairsByPosition.get(position)!;
    const pick = pairs.find((p) => !usedSlugs.has(p.a.slug) && !usedSlugs.has(p.b.slug));
    if (pick) {
      grid.push(pick);
      usedSlugs.add(pick.a.slug);
      usedSlugs.add(pick.b.slug);
    }
  }

  // Pass 2: fill the remainder, globally closest first, skipping anyone already on the grid.
  const allPairs = PULSE_POSITIONS.flatMap((position) => pairsByPosition.get(position)!);
  allPairs.sort(comparePairsByCloseness);
  for (const pair of allPairs) {
    if (grid.length >= TOUGHEST_CALLS_GRID_MAX) break;
    if (usedSlugs.has(pair.a.slug) || usedSlugs.has(pair.b.slug)) continue;
    grid.push(pair);
    usedSlugs.add(pair.a.slug);
    usedSlugs.add(pair.b.slug);
  }

  grid.sort(comparePairsByCloseness);

  return { grid, byPosition };
}

/* ------------------------------------------------------------------ */
/* Server loader                                                       */
/* ------------------------------------------------------------------ */

type AnySupabase =
  | SupabaseClient<Database>
  | Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>;

type JoinedPlayerRow = Pick<
  PlayerRow,
  "id" | "slug" | "first_name" | "last_name" | "full_name" | "position" | "team" | "external_ids" | "metadata"
>;

type RankingRow = {
  position_rank: number;
  players: JoinedPlayerRow;
};

function playerDisplayName(row: JoinedPlayerRow): string {
  const full = row.full_name?.trim();
  if (full) return full;
  const combined = `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim();
  return combined.length > 0 ? combined : row.slug;
}

/** Mirrors lib/start-sit/load.ts's private injuryStatusFrom: not exported there, so duplicated here. */
function injuryStatusFrom(row: JoinedPlayerRow): string | null {
  const meta = sleeperMeta(row);
  const raw = meta.injury_status;
  return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : null;
}

export type ToughestCallsFormat = {
  slug: string;
  display: string;
  scoring_type: string;
  te_premium_bonus: number | null;
};

export type LoadStartSitToughestCallsParams = {
  supabase: AnySupabase;
  formatConfigId: string;
  format: ToughestCallsFormat;
  /** The `rankings` source for the reader's value source (KTC, FF Beacon, ...). */
  rankingsSource: string;
  season: number;
  /** The live week. Toughest calls are always about the live week, never a future one the board's own picker offers. */
  week: number;
};

export type LoadStartSitToughestCallsResult = {
  result: ToughestCallsResult;
  projectionSource: string;
};

/**
 * The uncached read: the startable universe from `rankings` (current, week
 * null, freshest generated_at is implicit in there being exactly one
 * current row per player per format/source), one loadAdjustedProjections
 * call for the whole universe at once, then selectToughestCalls.
 *
 * ONE loadAdjustedProjections CALL. Every candidate the rankings read
 * produces is projected together in a single call, so this file needs no
 * allow-list entry in lib/projections/source-guard.test.ts or
 * lib/projections/raw-column-guard.test.ts: it never calls loadProjections
 * or loadAccuracy directly, and it never selects a projected_pts_* column.
 */
export async function loadStartSitToughestCalls(
  params: LoadStartSitToughestCallsParams,
): Promise<LoadStartSitToughestCallsResult> {
  const db = params.supabase as SupabaseClient<Database>;
  const { formatConfigId, format, rankingsSource, season, week } = params;

  // Bounded by the largest single positional cut. Ordered ascending by
  // position_rank so every position's cut is satisfied by one query; a
  // position with a smaller cut than 36 just carries a few extra rows this
  // file filters back out in selectToughestCalls (the pure startable-cut
  // step), which is where that filter is meant to be testable from anyway.
  const { data } = await db
    .from("rankings")
    .select(
      "position_rank, players!inner(id, slug, first_name, last_name, full_name, position, team, external_ids, metadata)",
    )
    .eq("format_config_id", formatConfigId)
    .eq("source", rankingsSource)
    .is("week", null)
    .lte("position_rank", TOUGHEST_CALLS_MAX_STARTABLE_CUT)
    .order("position_rank")
    .limit(1000);

  const candidates: StartSitCandidate[] = [];
  const positionRankByPlayer = new Map<string, number>();

  for (const row of (data ?? []) as unknown as RankingRow[]) {
    const player = row.players;
    const position = normalizeCandidatePosition(player.position);
    if (!position) continue; // outside QB/RB/WR/TE/K/DEF; not evaluated here.
    if (positionRankByPlayer.has(player.id)) continue; // one row per player expected; defensive dedupe.

    candidates.push({
      playerId: player.id,
      slug: player.slug,
      sleeperId: readSleeperId(player),
      name: playerDisplayName(player),
      position,
      team: player.team,
      injuryStatus: injuryStatusFrom(player),
    });
    positionRankByPlayer.set(player.id, row.position_rank);
  }

  const scoringSettings = scoringSettingsForFormat(format);
  const playerIds = candidates.map((c) => c.playerId);
  const positionByPlayer = new Map(candidates.map((c) => [c.playerId, c.position]));
  const injuryByPlayer = new Map(candidates.map((c) => [c.playerId, c.injuryStatus]));

  let projectionSource = SLEEPER_SOURCE;
  let byPlayer = new Map<string, AdjustedProjectionSummary>();
  if (playerIds.length > 0) {
    const adjusted = await loadAdjustedProjections({
      supabase: db,
      playerIds,
      season,
      fromWeek: week,
      toWeek: week,
      scoringSettings,
      positionByPlayer,
      injuryByPlayer,
      currentWeek: week,
    });
    projectionSource = adjusted.source;
    byPlayer = adjusted.byPlayer;
  }

  // The one extra query SEO-T911 adds: which of these players the SOURCE
  // itself has marked unable to play the live week. Columns are player_id
  // and availability only, never a projected_pts_* column (see the header
  // note and raw-column-guard.test.ts). Keyed on the SAME resolved
  // projectionSource loadAdjustedProjections just used, matching the
  // pattern lib/start-sit/load.ts's own availability read follows.
  const availabilityByPlayer = new Map<string, "projected" | "out">();
  if (playerIds.length > 0) {
    const { data: availabilityRows } = await db
      .from("player_weekly_projections")
      .select("player_id, availability")
      .eq("season", season)
      .eq("season_type", "regular")
      .eq("week", week)
      .eq("source", projectionSource)
      .in("player_id", playerIds);
    for (const row of availabilityRows ?? []) {
      if (!row.player_id) continue;
      availabilityByPlayer.set(row.player_id, row.availability === "out" ? "out" : "projected");
    }
  }

  const universe: ToughestCallsUniversePlayer[] = candidates.map((candidate) => {
    const summary = byPlayer.get(candidate.playerId);
    const weekData = summary?.byWeek.get(week);
    const points = weekData?.points ?? null;
    const sigma = weekData?.sigma ?? null;
    const { floor, ceiling } = floorCeiling(points, sigma);

    const projection: StartSitProjection = {
      playerId: candidate.playerId,
      week,
      points,
      rawPoints: weekData?.rawPoints ?? null,
      sigma,
      floor,
      ceiling,
      opponent: weekData?.opponent ?? null,
      opponentMultiplier: weekData?.opponentMultiplier ?? null,
      // Not read by verdictLine/confidence (see the header note); left at
      // the absent defaults rather than paying for the extra reads.
      defenseRankVsPosition: null,
      beatRate: weekData?.beatRate ?? null,
      availabilityRate: weekData?.availabilityRate ?? null,
      weeksGraded: weekData?.weeksPlayed ?? 0,
      environment: null,
      environmentTier: null,
      onBye: false,
      availability: availabilityByPlayer.get(candidate.playerId) ?? null,
    };

    return {
      candidate,
      projection,
      positionRank: positionRankByPlayer.get(candidate.playerId) ?? Number.MAX_SAFE_INTEGER,
    };
  });

  const result = selectToughestCalls({
    universe,
    week,
    season,
    formatDisplay: format.display,
    projectionSource,
  });

  return { result, projectionSource };
}

/* ------------------------------------------------------------------ */
/* Cached wrapper                                                      */
/* ------------------------------------------------------------------ */

/**
 * The projection source for one (season, week) window, resolved the same
 * way loadAdjustedProjections resolves it, but run BEFORE the cache key is
 * built rather than inside the cached closure (see the header note). No
 * cookies: settings and coverage are both plain, RLS-public reads.
 */
async function resolveToughestCallsProjectionSource(
  supabase: SupabaseClient<Database>,
  season: number,
  week: number,
): Promise<string> {
  const settings = await loadPowerPulseSettings(supabase);
  return resolveProjectionSourceForWindow({
    supabase,
    season,
    fromWeek: week,
    toWeek: week,
    settings: settings.beaconProjections,
  });
}

export type LoadStartSitToughestCallsCachedParams = {
  /**
   * Used only to resolve the projection source ahead of the cache key
   * (see resolveToughestCallsProjectionSource); the cached compute itself
   * always reads through its own cookie-less client, matching
   * lib/rankings-board.ts and lib/faab/player-list.ts.
   */
  supabase: SupabaseClient<Database>;
  formatConfigId: string;
  format: ToughestCallsFormat;
  rankingsSource: string;
  season: number;
  week: number;
};

/**
 * Cached wrapper. Key: ["start-sit-toughest", season, week, formatSlug,
 * rankingsSource, projectionSource] (see the DEVIATION note above for why
 * rankingsSource is in the key), revalidate 6 hours, tagged
 * CACHE_TAGS.playerProjections so the nightly projection sync and any
 * injury-driven re-sync revalidate it.
 */
export async function loadStartSitToughestCallsCached(
  params: LoadStartSitToughestCallsCachedParams,
): Promise<ToughestCallsResult> {
  const { supabase, formatConfigId, format, rankingsSource, season, week } = params;

  const projectionSource = await resolveToughestCallsProjectionSource(supabase, season, week);

  return unstable_cache(
    async () => {
      const cached = createCachedReadClient();
      const { result } = await loadStartSitToughestCalls({
        supabase: cached,
        formatConfigId,
        format,
        rankingsSource,
        season,
        week,
      });
      return result;
    },
    ["start-sit-toughest", String(season), String(week), format.slug, rankingsSource, projectionSource],
    {
      revalidate: TOUGHEST_CALLS_REVALIDATE_SECONDS,
      tags: [CACHE_TAGS.playerProjections],
    },
  )();
}
