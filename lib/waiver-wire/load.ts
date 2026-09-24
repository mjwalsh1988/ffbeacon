/**
 * Every read the waiver board makes, and nothing else.
 *
 * The pure half of this feature is `opportunity.ts`, `reasons.ts`, `bid.ts` and
 * `weeks.ts`. This file fetches and assembles; it makes no modelling decision
 * of its own.
 *
 * NO SLEEPER REQUEST EVER. This is a public, indexable, unauthenticated page,
 * and an external fetch on its critical path is an outage waiting for a
 * Tuesday. Everything it needs is already stored by a sync that runs on its own
 * schedule: rankings, value trends, weekly projections, stats, and the roster
 * rates migration 0292 builds. "What week is it" comes from
 * `lib/start-sit/clock.ts`, which answers the same question from the same
 * tables without leaving the database.
 *
 * NO RAW PROJECTION COLUMN. Points come through
 * `lib/projections/read.ts loadAdjustedProjections`, which resolves the engine,
 * applies the matchup and reliability adjustments, and reports which source it
 * used. `lib/projections/raw-column-guard.test.ts` fails the suite if anything
 * here reaches for `projected_pts_*` directly, and it is right to.
 *
 * THE READ IS FOUR WAVES AND THE SHAPE IS DELIBERATE:
 *
 *   1. The clock, the format row, the source registry and the settings, all
 *      independent of each other.
 *   2. The ranked universe and the season's roster rates. These decide WHO is
 *      on the board, and nothing downstream can start without them.
 *   3. Projections for the shortlist plus the depth needed to find replacement
 *      level, and the recent stat lines. Both keyed on the same player set.
 *   4. Assembly, which is arithmetic.
 *
 * CACHING. The whole board is memoized per (season, week, format, source). It
 * is identical for every visitor on that key and the data behind it moves at
 * most nightly, so the Tuesday-morning crowd shares one computation. The cache
 * carries the projection source in its key for the same reason every other
 * surface does: a flip that took a day to show up would be worse than no flip.
 */

import { unstable_cache } from "next/cache";
import { createCachedReadClient } from "@/lib/supabase/server";
import { fetchAllRows, fetchAllRowsInChunks } from "@/lib/supabase/fetch-all";
import { CACHE_TAGS, CACHE_TTL } from "@/lib/cache-tags";
import { resolveSeasonClock } from "@/lib/start-sit/clock";
import { loadAdjustedProjections } from "@/lib/projections/read";
import { projectionSourceDisplay } from "@/lib/projections/source-constants";
import { closestScoringBase, scoringSettingsForFormat } from "@/lib/league-scoring";
import { loadRankedUniverseCached } from "@/lib/faab/player-list";
import { replacementRankFor } from "@/lib/faab/manual";
import type { FaabPoolEntry, FaabSettings } from "@/lib/faab/types";
import { buildOpportunity, opportunitySwing, type StatLine } from "./opportunity";
import { boardScore, buildReason } from "./reasons";
import {
  AVAILABILITY_CEILING_PCT,
  STANDARD_LEAGUE,
  boardBid,
  replacementPoints,
} from "./bid";
import {
  BOARD_POSITIONS,
  type BoardEmptyReason,
  type BoardPosition,
  type BoardRow,
  type RosterRate,
  type WaiverBoard,
} from "./types";

/**
 * How many candidates we take the trouble to project.
 *
 * The ranked universe is up to 2,000 players and most of them are rostered
 * everywhere or have no NFL job. Projecting all of them to publish 40 would be
 * paying for 1,960 answers nobody reads. 160 is comfortably past the depth any
 * board displays and leaves room for the ones a bye week knocks out.
 */
const CANDIDATE_LIMIT = 160;

/**
 * How deep the position curve goes.
 *
 * Replacement level for a running back in a twelve-team league sits around the
 * 34th best, so the curve has to see at least that far at every position. The
 * top 320 overall covers it several times over at every position Sleeper
 * projects, and it is the same set for every board so it costs one read.
 */
const CURVE_DEPTH = 320;

/** How many weeks of stat lines the opportunity read looks back over. */
const OPPORTUNITY_LOOKBACK = 6;

type FormatRow = {
  id: string;
  slug: string;
  display_name: string;
  scoring_type: string | null;
  te_premium_bonus: number | null;
};

type RosterRateRow = {
  sleeper_player_id: string;
  player_id: string | null;
  leagues_rostered: number;
  leagues_total: number;
  dynasty_rostered: number;
  dynasty_total: number;
  redraft_rostered: number;
  redraft_total: number;
  computed_at: string;
};

function pct(part: number, whole: number): number | null {
  if (!Number.isFinite(whole) || whole <= 0) return null;
  return Math.round((part / whole) * 1000) / 10;
}

function toRosterRate(row: RosterRateRow): RosterRate {
  return {
    rostered: row.leagues_rostered,
    total: row.leagues_total,
    pct: pct(row.leagues_rostered, row.leagues_total),
    dynastyRostered: row.dynasty_rostered,
    dynastyTotal: row.dynasty_total,
    dynastyPct: pct(row.dynasty_rostered, row.dynasty_total),
    redraftRostered: row.redraft_rostered,
    redraftTotal: row.redraft_total,
    redraftPct: pct(row.redraft_rostered, row.redraft_total),
  };
}

function isBoardPosition(value: string): value is BoardPosition {
  return (BOARD_POSITIONS as readonly string[]).includes(value);
}

function numeric(value: unknown): number | null {
  if (value == null) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Every roster-rate row for a season, paged. About 2,400 rows in practice.
 * A failed page returns nothing (the "no roster rates" board), never a
 * partial set: a missing row reads as "rostered nowhere".
 */
async function loadRosterRates(
  supabase: ReturnType<typeof createCachedReadClient>,
  season: number,
): Promise<RosterRateRow[]> {
  try {
    const rows = await fetchAllRows("waiver board roster rates", (from, to) =>
      supabase
        .from("player_roster_rates")
        .select(
          "sleeper_player_id, player_id, leagues_rostered, leagues_total, dynasty_rostered, dynasty_total, redraft_rostered, redraft_total, computed_at",
        )
        .eq("season", season)
        // (season, sleeper_player_id) is the primary key.
        .order("sleeper_player_id", { ascending: true })
        .range(from, to),
    );
    return rows as unknown as RosterRateRow[];
  } catch (error) {
    console.error("[waiver-wire] roster rates read failed", error);
    return [];
  }
}

/**
 * The stat lines behind the opportunity column, for one set of players.
 *
 * `scoringBase` picks which stored points column is read, so a PPR board and a
 * standard board quote the points that league would actually have scored. The
 * same routing `lib/start-sit` uses, for the same reason.
 */
async function loadStatLines(
  supabase: ReturnType<typeof createCachedReadClient>,
  params: {
    playerIds: string[];
    season: number;
    fromWeek: number;
    toWeek: number;
    scoringBase: "pts_ppr" | "pts_half_ppr" | "pts_std";
  },
): Promise<Map<string, StatLine[]>> {
  const byPlayer = new Map<string, StatLine[]>();
  if (params.playerIds.length === 0 || params.toWeek < params.fromWeek) return byPlayer;

  const columns = `player_id, week, rec_tgt, rush_att, off_snp, tm_off_snp, gp, ${params.scoringBase}`;

  // Chunked and paged. A failed chunk empties the whole map rather than
  // leaving some players with stat lines and others silently without.
  let rows: Record<string, unknown>[];
  try {
    rows = (await fetchAllRowsInChunks("waiver board stat lines", params.playerIds, (chunk, from, to) =>
      supabase
        .from("player_stats")
        .select(columns)
        .eq("season", params.season)
        .eq("season_type", "regular")
        .gte("week", params.fromWeek)
        .lte("week", params.toWeek)
        .in("player_id", chunk)
        .order("id", { ascending: true })
        .range(from, to),
    )) as unknown as Record<string, unknown>[];
  } catch (error) {
    console.error("[waiver-wire] stat lines read failed", error);
    return byPlayer;
  }

  for (const raw of rows) {
    const playerId = String(raw.player_id);
    const line: StatLine = {
      week: Number(raw.week),
      targets: numeric(raw.rec_tgt),
      carries: numeric(raw.rush_att),
      offSnaps: numeric(raw.off_snp),
      teamOffSnaps: numeric(raw.tm_off_snp),
      points: numeric(raw[params.scoringBase]),
      gamesPlayed: numeric(raw.gp),
    };
    const list = byPlayer.get(playerId);
    if (list) list.push(line);
    else byPlayer.set(playerId, [line]);
  }

  return byPlayer;
}

function emptyBoard(
  season: number,
  week: number,
  currentWeek: number,
  reason: BoardEmptyReason,
  assumptions: WaiverBoard["assumptions"],
): WaiverBoard {
  return {
    season,
    week,
    currentWeek,
    rows: [],
    assumptions,
    rosterRatesComputedAt: null,
    emptyReason: reason,
  };
}

export type LoadBoardParams = {
  week: number;
  /** The reader's resolved format, already through the preference chain. */
  format: FormatRow;
  /** The reader's resolved rankings/value source slug and its display name. */
  sourceSlug: string;
  sourceName: string;
  settings: FaabSettings;
};

async function loadWaiverBoardUncached(params: LoadBoardParams): Promise<WaiverBoard> {
  const supabase = createCachedReadClient();
  const { week, format, sourceSlug, sourceName, settings } = params;

  const scoringSettings = scoringSettingsForFormat({
    scoring_type: format.scoring_type ?? "ppr",
    te_premium_bonus: format.te_premium_bonus,
  });
  const scoringBase = closestScoringBase(scoringSettings);

  const baseAssumptions: WaiverBoard["assumptions"] = {
    teams: STANDARD_LEAGUE.teams,
    offensiveStarters: STANDARD_LEAGUE.offensiveStarters,
    budget: STANDARD_LEAGUE.budget,
    formatName: format.display_name,
    sourceName,
    projectionSourceName: projectionSourceDisplay(null),
    availabilityCeilingPct: AVAILABILITY_CEILING_PCT,
  };

  /* ---- Wave 1: where the season is. ---- */
  const clock = await resolveSeasonClock(supabase);
  if (clock.season == null) {
    return emptyBoard(0, week, 1, "no-season", baseAssumptions);
  }
  const season = clock.season;
  const currentWeek = clock.currentWeek;

  /* ---- Wave 2: who could be on the board at all. ---- */
  const [universe, rateRows] = await Promise.all([
    loadRankedUniverseCached({ formatConfigId: format.id, source: sourceSlug }),
    loadRosterRates(supabase, season),
  ]);

  if (universe.length === 0) {
    return emptyBoard(season, week, currentWeek, "no-rankings", baseAssumptions);
  }
  if (rateRows.length === 0) {
    return emptyBoard(season, week, currentWeek, "no-roster-rates", baseAssumptions);
  }

  const ratesBySleeperId = new Map(rateRows.map((r) => [r.sleeper_player_id, r]));
  const rosterRatesComputedAt =
    rateRows.reduce<string | null>(
      (best, r) => (best == null || r.computed_at > best ? r.computed_at : best),
      null,
    ) ?? null;

  // The shortlist: ranked, at a position we can project, and not already gone.
  //
  // A player with NO roster-rate row is treated as available rather than
  // skipped. He is rostered in none of our leagues, which is the strongest
  // availability signal there is; the row is absent precisely because the
  // aggregate had nothing to count.
  const candidates = universe
    .filter((p) => isBoardPosition(p.position))
    .filter((p) => {
      if (!p.sleeperId) return false;
      const rate = ratesBySleeperId.get(p.sleeperId);
      if (!rate) return true;
      const share = pct(rate.leagues_rostered, rate.leagues_total);
      return share == null || share < AVAILABILITY_CEILING_PCT;
    })
    .slice(0, CANDIDATE_LIMIT);

  if (candidates.length === 0) {
    return emptyBoard(season, week, currentWeek, "no-rankings", {
      ...baseAssumptions,
      projectionSourceName: projectionSourceDisplay(null),
    });
  }

  /* ---- Wave 3: what they project for, and what they have been doing. ---- */
  // The curve set is the top of the board regardless of availability: finding
  // the last STARTABLE player at a position means looking at the players who
  // are started, nearly all of whom are rostered everywhere.
  const curveSet = universe.filter((p) => isBoardPosition(p.position)).slice(0, CURVE_DEPTH);
  const projectionTargets = new Map<string, string>();
  for (const p of [...curveSet, ...candidates]) {
    projectionTargets.set(p.playerId, p.position);
  }

  const lookbackFrom = Math.max(1, week - OPPORTUNITY_LOOKBACK);
  const [projections, statLines] = await Promise.all([
    loadAdjustedProjections({
      supabase,
      playerIds: [...projectionTargets.keys()],
      season,
      fromWeek: week,
      toWeek: week,
      scoringSettings,
      positionByPlayer: projectionTargets,
      currentWeek,
    }),
    loadStatLines(supabase, {
      playerIds: candidates.map((c) => c.playerId),
      season,
      fromWeek: lookbackFrom,
      toWeek: Math.max(lookbackFrom, week - 1),
      scoringBase,
    }),
  ]);

  const assumptions: WaiverBoard["assumptions"] = {
    ...baseAssumptions,
    projectionSourceName: projectionSourceDisplay(projections.source),
  };

  // The value read. One row per (player, format, source) rather than one per
  // nightly snapshot, which is what the pre-calc table is for.
  const valueById = new Map<string, number>();
  const candidateIds = candidates.map((c) => c.playerId);
  for (let i = 0; i < candidateIds.length; i += 200) {
    const { data } = await supabase
      .from("player_value_trends")
      .select("player_id, current_value")
      .eq("format_config_id", format.id)
      .eq("source", sourceSlug)
      .in("player_id", candidateIds.slice(i, i + 200));
    for (const row of data ?? []) {
      const v = numeric((row as { current_value: unknown }).current_value);
      if (v != null) valueById.set(String((row as { player_id: string }).player_id), v);
    }
  }

  /* ---- Wave 4: assembly. ---- */

  // Replacement level, one number per position, read off the curve set's own
  // projections for this week.
  const curveByPosition = new Map<BoardPosition, number[]>();
  for (const p of curveSet) {
    const summary = projections.byPlayer.get(p.playerId);
    const points = summary?.byWeek.get(week)?.points;
    if (typeof points !== "number") continue;
    const position = p.position as BoardPosition;
    const list = curveByPosition.get(position);
    if (list) list.push(points);
    else curveByPosition.set(position, [points]);
  }
  const replacementByPosition = new Map<BoardPosition, number | null>();
  for (const position of BOARD_POSITIONS) {
    const curve = (curveByPosition.get(position) ?? []).sort((a, b) => b - a);
    const rank = replacementRankFor(
      position,
      STANDARD_LEAGUE.teams,
      STANDARD_LEAGUE.offensiveStarters,
      settings.manualReplacement,
    );
    replacementByPosition.set(position, replacementPoints(curve, rank));
  }

  // The pool the bid engine locates replacement and elite VALUE against. It is
  // the ranked universe with its values attached, which is the same pool the
  // calculator passes, so the two price a player identically.
  const poolValues = new Map<string, number>();
  for (let i = 0; i < Math.min(universe.length, CURVE_DEPTH * 2); i += 200) {
    const slice = universe.slice(i, i + 200).map((p) => p.playerId);
    const { data } = await supabase
      .from("player_value_trends")
      .select("player_id, current_value")
      .eq("format_config_id", format.id)
      .eq("source", sourceSlug)
      .in("player_id", slice);
    for (const row of data ?? []) {
      const v = numeric((row as { current_value: unknown }).current_value);
      if (v != null) poolValues.set(String((row as { player_id: string }).player_id), v);
    }
  }
  const playerPool: FaabPoolEntry[] = universe
    .slice(0, CURVE_DEPTH * 2)
    .map((p) => ({ overallRank: p.overallRank, value: poolValues.get(p.playerId) ?? null }));

  const isPast = week < currentWeek;
  const rows: BoardRow[] = [];

  for (const candidate of candidates) {
    const position = candidate.position as BoardPosition;
    const summary = projections.byPlayer.get(candidate.playerId);
    const adjusted = summary?.byWeek.get(week) ?? null;

    const opportunity = buildOpportunity(
      statLines.get(candidate.playerId) ?? [],
      week,
    );

    const replacement = replacementByPosition.get(position) ?? null;
    const pointsAboveReplacement =
      adjusted && replacement != null
        ? Math.round((adjusted.points - replacement) * 10) / 10
        : null;

    const value = valueById.get(candidate.playerId) ?? null;
    const rateRow = candidate.sleeperId
      ? ratesBySleeperId.get(candidate.sleeperId)
      : undefined;
    const rosterRate = rateRow ? toRosterRate(rateRow) : null;

    const row: BoardRow = {
      playerId: candidate.playerId,
      slug: candidate.slug,
      sleeperId: candidate.sleeperId,
      name: candidate.name,
      position,
      team: candidate.team,
      overallRank: candidate.overallRank,
      positionRank: candidate.positionRank,
      value,
      rosterRate,
      opportunity,
      projection: adjusted
        ? {
            points: Math.round(adjusted.points * 10) / 10,
            rawPoints: Math.round(adjusted.rawPoints * 10) / 10,
            opponent: adjusted.opponent,
            beatRate: adjusted.beatRate,
          }
        : null,
      pointsAboveReplacement,
      bid: boardBid({
        overallRank: candidate.overallRank,
        positionRank: candidate.positionRank,
        value,
        settings,
        playerPool,
      }),
      reason: buildReason({
        position,
        opportunity,
        rosterRate,
        projectedPoints: adjusted ? Math.round(adjusted.points * 10) / 10 : null,
        pointsAboveReplacement,
        opponent: adjusted?.opponent ?? null,
        isPast,
      }),
      score: boardScore({
        position,
        pointsAboveReplacement,
        projectedPoints: adjusted?.points ?? null,
        opportunitySwing: opportunitySwing(opportunity),
        rosterPct: rosterRate?.pct ?? null,
      }),
    };

    rows.push(row);
  }

  rows.sort((a, b) => b.score - a.score || a.overallRank - b.overallRank);

  // Everybody scored the "no evidence" floor. That is not a board, and
  // publishing it as one would put forty names under a heading promising
  // measured advice with nothing measured behind them.
  const anyEvidence = rows.some((r) => r.projection != null);
  if (!anyEvidence) {
    return emptyBoard(season, week, currentWeek, "no-projections", assumptions);
  }

  return {
    season,
    week,
    currentWeek,
    rows,
    assumptions,
    rosterRatesComputedAt,
    emptyReason: null,
  };
}

/**
 * The board, memoized per (season is implied by the key's week, format, source,
 * week).
 *
 * The season is not in the key because the clock resolves it inside, and two
 * seasons cannot be live at the same moment. The projection engine is not in
 * the key either, deliberately and unusually: it is resolved inside and the
 * cache is an hour, so a flip shows up within the hour rather than needing the
 * key to carry it. An hour is the same window the player list already accepts.
 */
export function loadWaiverBoardCached(params: LoadBoardParams): Promise<WaiverBoard> {
  return unstable_cache(
    () => loadWaiverBoardUncached(params),
    [
      "waiver-board",
      String(params.week),
      params.format.id,
      params.sourceSlug,
    ],
    { revalidate: CACHE_TTL.hourly, tags: [CACHE_TAGS.playerValues] },
  )();
}
