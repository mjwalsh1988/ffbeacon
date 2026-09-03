/**
 * Weekly projections for every projectable player, scored under ONE league's own
 * scoring settings.
 *
 * On The Clock needs to answer questions that value alone cannot: how many points
 * does this player add to your starting lineup, which team's drafted lineup
 * projects best, how reliable are a team's starters. All three need the same
 * input, which is every player projected week by week in the league's scoring.
 *
 * The model is NOT reimplemented here. Every per-week number comes from
 * lib/power-pulse/project.ts projectPlayerWeek, the same function the Power Pulse
 * page uses, with the same admin-editable settings out of
 * league_power_pulse_settings. A projection shown in a draft room and the same
 * player's projection on the Power Pulse page can therefore never disagree.
 *
 * THE CACHING PROPERTY THAT MAKES THIS AFFORDABLE
 * The sweep depends only on (scoring settings, season, week window). It does NOT
 * depend on the draft. Two leagues with byte-identical scoring share one row in
 * on_the_clock_projection_cache, and a live draft re-rendering on every pick
 * never triggers it. The per-draft work (filling lineups from these numbers)
 * lives in draft-pulse.ts and is cheap.
 *
 * Absent is not zero. A player with no projection row is omitted from `players`
 * entirely, and every consumer treats a miss as "no opinion" rather than a zero,
 * because a zero would quietly rank a rookie below a backup kicker.
 *
 * THE SOURCE IS RESOLVED, NEVER LEFT TO A DEFAULT. `player_weekly_projections`
 * now holds an ffbeacon row beside every sleeper one (lib/projections/
 * source-constants.ts), so a read with no `source` filter is not merely stale:
 * it returns BOTH rows for every player-week, and this sweep pushes them into
 * one array, so every player would be projected twice and `seasonPoints` would
 * roughly double. The source therefore comes from
 * resolveProjectionSourceForWindow (lib/projections/source.ts), which makes no
 * query at all while the feature is off, and is folded into the cache
 * fingerprint so the day an admin turns it on every stored board is rebuilt
 * rather than served from the old engine.
 */

import "server-only";

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { closestScoringBase, type ScoringSettings } from "@/lib/league-scoring";
import {
  loadAccuracy,
  loadDefenseSplits,
  type AccuracyRow,
  type ProjectionRow,
} from "@/lib/power-pulse/load";
import { loadPowerPulseSettings } from "@/lib/power-pulse/settings";
import type { PowerPulseSettings } from "@/lib/power-pulse/default-settings";
import {
  projectPlayerWeek,
  reliabilityMultiplier,
} from "@/lib/power-pulse/project";
import { PULSE_POSITIONS, type PulsePosition } from "@/lib/power-pulse/types";
import { defenseSeasonsFor } from "@/lib/projections/defense-seasons";
import { resolveProjectionSourceForWindow } from "@/lib/projections/source";
import { SLEEPER_SOURCE } from "@/lib/projections/source-constants";

type Client = SupabaseClient<Database>;

const PAGE = 1000;

/**
 * Bump when the SHAPE or the MEANING of a cached payload changes, so stale rows
 * are ignored rather than rendered. The Power Pulse settings' own modelVersion is
 * folded into the signature separately, so an admin tuning also invalidates.
 *
 * otc-proj-2 (2026-08-31): the sweep now reads each row's `availability`, which
 * it had never selected, so every cached payload was built with our own injury
 * discounts firing on numbers Sleeper had already discounted.
 */
export const PROJECTION_BOARD_VERSION = "otc-proj-2";

/**
 * How long a cached sweep stays fresh when nothing underneath it has moved.
 *
 * The TTL is now the BACKSTOP rather than the mechanism. `projectionDataVersion`
 * below is what actually invalidates: it fingerprints the two syncs the sweep is
 * built from, so a rebuild happens the moment either writes, and never happens
 * on a day neither does.
 */
export const PROJECTION_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** Returned when a fingerprint read fails, so the TTL alone governs. */
const UNKNOWN_DATA_VERSION = "unknown";

/** One week of one player's projected output, in the league's own scoring. */
export interface ProjectedWeekLite {
  week: number;
  points: number;
  sigma: number;
  opponent: string | null;
  /** Opponent-strength multiplier applied. 1 when neutral or unknown. */
  oppMult: number;
}

/** One player's full remaining-season outlook. */
export interface PlayerProjection {
  playerId: string;
  position: PulsePosition;
  weeks: ProjectedWeekLite[];
  /** Sum of projected points across the weeks that carry a projection. */
  seasonPoints: number;
  /** Mean over the weeks that carry a projection (a bye is skipped, not zeroed). */
  pointsPerWeek: number;
  /** How often this player met or beat their projection, 0 to 1. Null when unknown. */
  beatRate: number | null;
  /** Recency-weighted reliability multiplier actually applied. */
  reliability: number;
  /** Weeks played over weeks projected, 0 to 1. Null when unknown. */
  availability: number | null;
  /** Spread of actual over projected. Drives the volatility awards. */
  ratioStdev: number | null;
  /** Sample size behind the accuracy row, for the minimum-sample gates. */
  weeksPlayed: number;
}

export interface ProjectionBoard {
  version: string;
  scoringSignature: string;
  season: number;
  fromWeek: number;
  /** Weeks covered, ascending. */
  weeks: number[];
  /** The stored-points fallback base the accuracy rows were read for. */
  scoringBase: string;
  /**
   * Which projection engine produced these numbers, "sleeper" or "ffbeacon".
   *
   * Recorded rather than inferred, so a board read back out of the cache can
   * say what it was built from. Absent on a payload cached before the source
   * was resolved at all, which is exactly the payload that must not be trusted
   * once the feature is enabled; the data fingerprint retires those anyway.
   */
  projectionSource?: string;
  /**
   * When this sweep was computed, ISO. Provenance rather than decoration: a
   * completed draft's snapshot dates its value and ADP inputs and calls itself
   * high confidence, and until this existed it had no way to date the
   * projections that drive its lineup component, its ranks and five of its
   * awards. Absent on a payload cached before otc-proj-2.
   */
  computedAt?: string;
  /** Keyed by FF Beacon player id. A missing key means "no projection", not zero. */
  players: Record<string, PlayerProjection>;
}

// ---------------------------------------------------------------------------
// Cache key
// ---------------------------------------------------------------------------

/**
 * A stable fingerprint of everything that changes the numbers: the league's
 * scoring map (normalized so key order and float noise cannot fork the cache),
 * this module's version, and the Power Pulse model version.
 *
 * An empty scoring map is a real, distinct case (a league whose settings we could
 * not capture) and gets its own signature, so it never shares a row with a league
 * that genuinely scores nothing.
 */
export function scoringSignature(
  scoring: ScoringSettings | null | undefined,
  modelVersion: string,
): string {
  const entries = Object.entries(scoring ?? {})
    .filter(([, v]) => typeof v === "number" && Number.isFinite(v) && v !== 0)
    .map(([k, v]) => [k, Math.round(v * 10000) / 10000] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const canonical = JSON.stringify({
    v: PROJECTION_BOARD_VERSION,
    m: modelVersion,
    s: entries,
  });
  return createHash("sha1").update(canonical).digest("hex");
}

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------

/**
 * Position + injury status for a set of FF Beacon player ids.
 *
 * The injury status is projected out of the jsonb in Postgres rather than by
 * selecting `metadata` and reading one key here: the merged metadata map on
 * `players` averages a little over 4 KB a row, so the whole-column select moved
 * roughly 2.4 MB across the wire per cold build to read one short string.
 */
async function loadPlayerFacts(
  supabase: Client,
  playerIds: string[],
): Promise<
  Map<string, { position: PulsePosition; injuryStatus: string | null }>
> {
  const out = new Map<
    string,
    { position: PulsePosition; injuryStatus: string | null }
  >();
  const valid = new Set<string>(PULSE_POSITIONS);
  const CHUNK = 300;
  for (let i = 0; i < playerIds.length; i += CHUNK) {
    const chunk = playerIds.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("players")
      .select("id, position, injury_status:metadata->sleeper->>injury_status")
      .in("id", chunk)
      .overrideTypes<
        { id: string; position: string | null; injury_status: string | null }[]
      >();
    if (error)
      throw new Error(`otc projection player load failed: ${error.message}`);
    for (const p of data ?? []) {
      const position = (p.position ?? "").toUpperCase();
      if (!valid.has(position)) continue;
      out.set(p.id, {
        position: position as PulsePosition,
        injuryStatus:
          typeof p.injury_status === "string" && p.injury_status.length > 0
            ? p.injury_status
            : null,
      });
    }
  }
  return out;
}

/**
 * Every weekly projection row for a season from `fromWeek` on. Paged, because a
 * full season is well past Supabase's silent 1000-row cap.
 *
 * `availability` is not optional, whatever ProjectionRow's type says. Omitting
 * it is how the draft room and the Power Pulse page came to disagree about the
 * same injured player in two directions at once. projectPlayerWeek reads it to
 * decide whether the SOURCE has already priced a designation in, and an absent
 * value means "nobody priced this in", so leaving the column unselected made the
 * draft room apply our own Questionable discount on top of a number Sleeper had
 * already discounted, and made it overrule a return timeline the Power Pulse
 * page honours. Same model, same player, different answer, for no reason a
 * reader could see.
 */
async function loadAllProjections(
  supabase: Client,
  season: number,
  fromWeek: number,
  source: string,
): Promise<ProjectionRow[]> {
  const out: ProjectionRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("player_weekly_projections")
      .select(
        "player_id, week, opponent, stat_line, projected_pts_ppr, projected_pts_half_ppr, projected_pts_std, availability",
      )
      .eq("season", season)
      .eq("season_type", "regular")
      // NOT OPTIONAL. Without it this pushes one row per source per
      // player-week into `out`, and the loop below sums every one of them.
      .eq("source", source)
      .gte("week", fromWeek)
      .order("player_id", { ascending: true })
      .order("week", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`otc projection load failed: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data) {
      if (!row.player_id) continue;
      out.push({
        playerId: row.player_id,
        week: Number(row.week),
        opponent: row.opponent,
        statLine: (row.stat_line as Record<string, unknown> | null) ?? null,
        ppr: numOrNull(row.projected_pts_ppr),
        halfPpr: numOrNull(row.projected_pts_half_ppr),
        std: numOrNull(row.projected_pts_std),
        availability: row.availability,
      });
    }
    if (data.length < PAGE) break;
  }
  return out;
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

/**
 * Run the sweep. Pure-ish: it reads Supabase but writes nothing and takes no
 * draft-specific input, which is exactly why its result is cacheable across
 * leagues.
 */
export async function buildProjectionBoard(
  supabase: Client,
  params: {
    scoringSettings: ScoringSettings;
    season: number;
    fromWeek: number;
    /** Only supplied by tests; production loads the shared settings row. */
    settings?: PowerPulseSettings;
    /**
     * The already-resolved projection source. getProjectionBoard resolves it
     * once and passes it here so the fingerprint and the build can never end up
     * reading different engines; a direct caller (a test) that omits it gets
     * the same resolution done locally.
     */
    source?: string;
  },
): Promise<ProjectionBoard> {
  const settings = params.settings ?? (await loadPowerPulseSettings(supabase));
  const scoringBase = closestScoringBase(params.scoringSettings);
  const source =
    params.source ??
    (await resolveProjectionSourceForWindow({
      supabase,
      season: params.season,
      fromWeek: params.fromWeek,
      settings: settings.beaconProjections,
    }));

  const projections = await loadAllProjections(
    supabase,
    params.season,
    params.fromWeek,
    source,
  );
  const playerIds = [...new Set(projections.map((p) => p.playerId))];
  const facts = await loadPlayerFacts(supabase, playerIds);

  const [accuracy, defense] = await Promise.all([
    // Scoped to the SAME source the projections came from: a reliability
    // multiplier measured against one engine's numbers is only meaningful
    // applied to that engine's numbers.
    loadAccuracy(supabase, playerIds, scoringBase, source),
    loadDefenseSplits(supabase, scoringBase, defenseSeasonsFor(params.season)),
  ]);

  const byPlayer = new Map<string, ProjectionRow[]>();
  for (const row of projections) {
    const list = byPlayer.get(row.playerId) ?? [];
    list.push(row);
    byPlayer.set(row.playerId, list);
  }

  const weekSet = new Set<number>();
  const players: Record<string, PlayerProjection> = {};

  for (const [playerId, rows] of byPlayer) {
    const fact = facts.get(playerId);
    if (!fact) continue; // unmapped or a position we cannot start
    const acc: AccuracyRow | null = accuracy.get(playerId) ?? null;
    const reliability = reliabilityMultiplier(acc, settings);

    const weeks: ProjectedWeekLite[] = [];
    let total = 0;
    for (const row of rows.slice().sort((a, b) => a.week - b.week)) {
      const projected = projectPlayerWeek({
        projection: row,
        subject: { position: fact.position, injuryStatus: fact.injuryStatus },
        accuracy: acc,
        reliability,
        scoringSettings: params.scoringSettings,
        defense,
        defenseSeasons: defenseSeasonsFor(params.season),
        week: row.week,
        currentWeek: params.fromWeek,
        settings,
      });
      if (!projected) continue;
      weekSet.add(row.week);
      total += projected.points;
      weeks.push({
        week: row.week,
        points: round2(projected.points),
        sigma: round2(projected.sigma),
        opponent: projected.opponent,
        oppMult: round3(projected.opponentMultiplier),
      });
    }
    if (weeks.length === 0) continue;

    players[playerId] = {
      playerId,
      position: fact.position,
      weeks,
      seasonPoints: round2(total),
      pointsPerWeek: round2(total / weeks.length),
      beatRate: acc?.beatRate ?? null,
      reliability: round3(reliability),
      availability: acc?.availabilityRate ?? null,
      ratioStdev: acc?.ratioStdev ?? null,
      weeksPlayed: acc?.weeksPlayed ?? 0,
    };
  }

  return {
    version: PROJECTION_BOARD_VERSION,
    scoringSignature: scoringSignature(
      params.scoringSettings,
      settings.modelVersion,
    ),
    season: params.season,
    fromWeek: params.fromWeek,
    weeks: [...weekSet].sort((a, b) => a - b),
    scoringBase,
    projectionSource: source,
    computedAt: new Date().toISOString(),
    players,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// ---------------------------------------------------------------------------
// Cache read / write
// ---------------------------------------------------------------------------

/**
 * Read a cached sweep, or build and store one. Concurrent callers for the same
 * signature coalesce in-process so a draft room opened by ten league mates at
 * once runs the sweep once rather than ten times.
 */
const inFlight = new Map<string, Promise<ProjectionBoard>>();

/**
 * The parsed board, held in the process that already paid for it.
 *
 * `inFlight` only coalesces genuinely CONCURRENT callers and drops its key in
 * `finally`, so nothing survived between sequential requests: every pulse call
 * re-read roughly 681 KB from Supabase and re-parsed it, for a payload that
 * cannot change during a draft. Twelve co-viewers across a 200-pick draft is
 * about 1.6 GB of egress carrying no new information.
 *
 * Bounded, because `scoring_signature` is derived from a league's own scoring
 * settings and is therefore user-controlled: a server that sees many distinct
 * scoring shapes must not grow this without limit. Oldest entry out first.
 */
const PARSED_BOARD_LIMIT = 6;
const parsedBoards = new Map<string, { at: number; board: ProjectionBoard }>();

/**
 * `at` is when the board was COMPUTED, not when this process read it. Stamping
 * the read time let a row that was already 23 hours old sit in memory for
 * another 24, so a board could be served at twice its TTL and miss a whole
 * nightly projection refresh.
 */
function rememberBoard(
  key: string,
  board: ProjectionBoard,
  computedAt: number,
): void {
  parsedBoards.delete(key);
  parsedBoards.set(key, { at: computedAt, board });
  while (parsedBoards.size > PARSED_BOARD_LIMIT) {
    const oldest = parsedBoards.keys().next().value;
    if (oldest === undefined) break;
    parsedBoards.delete(oldest);
  }
}

/**
 * A fingerprint of the data the sweep is built from.
 *
 * WHY A KEY MADE OF TIMESTAMPS AND NOT A TIMER
 * The cache key was (scoring signature, season, from week), and the freshness
 * test was a 24-hour timer. Nothing in either notices that
 * `sync-weekly-projections` rewrote every row at 12:01 UTC, or that
 * `sync-sleeper-players` wrote a new injury designation at 06:00. Worse, the
 * Draft Pulse built on top is keyed on the draft's PICK COUNT, which stops
 * moving forever the moment a draft completes, so a finished draft room never
 * recomputed at all.
 *
 * Measured on 2026-08-31 in one league: the board was built at 01:23, the player
 * sync at 06:00 moved five players to IR, DNR or PUP, and the projection sync at
 * 12:01 moved 388 of 603 players, 68 of them by over a point a week. The draft
 * room and the League Pulse page were then up to 8 points a week apart about
 * rosters that had not changed a single player.
 *
 * Two indexed `order by updated_at desc limit 1` reads, run together. They cost
 * one round trip and they replace a whole class of "why do these two screens
 * disagree" with an answer that cannot drift. A failed read degrades to
 * UNKNOWN_DATA_VERSION, which leaves the TTL in charge rather than either
 * rebuilding on every request or pinning a stale payload forever.
 */
export async function projectionDataVersion(
  admin: Client,
  season: number,
  /**
   * The resolved projection source. It is part of the fingerprint AND part of
   * the probe, and both matter.
   *
   * Part of the probe, because the two engines are written by different jobs on
   * different schedules: fingerprinting the newest row of EITHER would rebuild
   * a Sleeper board every time the ffbeacon builder ran, and would miss a
   * Sleeper sync that landed while ffbeacon was quiet.
   *
   * Part of the fingerprint, because the stored cache row is keyed on the
   * scoring signature alone. The moment an admin flips the engine on, every
   * stored board was built from the other one, and a fingerprint that did not
   * name the source would report them as current.
   */
  source: string,
): Promise<string> {
  const [projections, players] = await Promise.all([
    admin
      .from("player_weekly_projections")
      .select("updated_at")
      .eq("season", season)
      .eq("season_type", "regular")
      .eq("source", source)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from("players")
      .select("updated_at")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (projections.error || players.error) {
    console.warn(
      "[on-the-clock/projection-board] could not fingerprint the source data, falling back to the TTL:",
      projections.error?.message ?? players.error?.message,
    );
    return UNKNOWN_DATA_VERSION;
  }

  const p = projections.data?.updated_at ?? "none";
  const d = players.data?.updated_at ?? "none";
  // SLEEPER KEEPS THE OLD SHAPE. Prefixing it unconditionally would change
  // every fingerprint on the deploy that introduced this, retiring every stored
  // board and every open draft room's etag at once for no new information. The
  // guarantee this exists for is unaffected: switching engines still changes
  // the string, because the other engine is not the default one.
  return source === SLEEPER_SOURCE ? `${p}|${d}` : `${source}|${p}|${d}`;
}

/**
 * Which projection engine a draft room reads, for one season and window.
 *
 * A thin named wrapper so pulse-service.ts resolves the source ONCE and hands
 * the same value to the fingerprint and to the board, exactly as it already
 * does with the settings document and the data version. Two resolutions could
 * in principle straddle an admin flipping the switch, and the result would be a
 * board fingerprinted against one engine and built from the other.
 */
export async function resolveBoardProjectionSource(
  admin: Client,
  season: number,
  fromWeek: number,
  settings: PowerPulseSettings,
): Promise<string> {
  return resolveProjectionSourceForWindow({
    supabase: admin,
    season,
    fromWeek,
    settings: settings.beaconProjections,
  });
}

export async function getProjectionBoard(
  admin: Client,
  params: {
    scoringSettings: ScoringSettings;
    season: number;
    fromWeek: number;
    /**
     * The already-loaded Power Pulse settings. The caller usually has them in
     * hand (resolveContext loads them one line earlier), and this only needs
     * them for the scoring signature, so passing them through saves a round
     * trip per request.
     */
    settings?: PowerPulseSettings;
    /**
     * The fingerprint from projectionDataVersion. The caller usually has it
     * already (resolveContext folds the same value into its own cache key, so
     * the two can never invalidate at different moments), and passing it through
     * saves a round trip per request.
     */
    dataVersion?: string;
    /**
     * The resolved projection source. Usually passed in by the caller for the
     * same reason `dataVersion` is: one resolution, one answer, no chance of the
     * fingerprint and the build disagreeing about which engine is live.
     */
    source?: string;
  },
): Promise<ProjectionBoard> {
  const settings = params.settings ?? (await loadPowerPulseSettings(admin));
  const source =
    params.source ??
    (await resolveBoardProjectionSource(
      admin,
      params.season,
      params.fromWeek,
      settings,
    ));
  const dataVersion =
    params.dataVersion ??
    (await projectionDataVersion(admin, params.season, source));
  const signature = scoringSignature(
    params.scoringSettings,
    settings.modelVersion,
  );
  // The fingerprint is in the in-process key too, so a warm process cannot serve
  // a board the database has already been told to rebuild.
  const key = `${signature}|${params.season}|${params.fromWeek}|${dataVersion}`;

  const memo = parsedBoards.get(key);
  if (memo && Date.now() - memo.at < PROJECTION_CACHE_TTL_MS) {
    // Touch on a HIT so eviction is least-recently-used, not least-recently
    // written. Without this, six distinct scoring shapes could evict the board
    // that is being hit continuously.
    parsedBoards.delete(key);
    parsedBoards.set(key, memo);
    return memo.board;
  }

  const running = inFlight.get(key);
  if (running) return running;

  const task = (async (): Promise<ProjectionBoard> => {
    const { data } = await admin
      .from("on_the_clock_projection_cache")
      .select("payload, computed_at, data_version")
      .eq("scoring_signature", signature)
      .eq("season", params.season)
      .eq("from_week", params.fromWeek)
      .maybeSingle();

    if (data?.payload) {
      const computedAt = new Date(data.computed_at).getTime();
      const fresh = Date.now() - computedAt < PROJECTION_CACHE_TTL_MS;
      // A stored row from before the fingerprint existed reads as null, and a
      // null must not silently satisfy the check, so it is compared as a value
      // rather than skipped when absent.
      const sameData = (data.data_version ?? null) === dataVersion;
      const payload = data.payload as unknown as ProjectionBoard;
      if (fresh && sameData && payload?.version === PROJECTION_BOARD_VERSION) {
        rememberBoard(key, payload, computedAt);
        return payload;
      }
    }

    const board = await buildProjectionBoard(admin, {
      scoringSettings: params.scoringSettings,
      season: params.season,
      fromWeek: params.fromWeek,
      settings,
      source,
    });
    rememberBoard(key, board, Date.now());
    const { error } = await admin.from("on_the_clock_projection_cache").upsert(
      {
        scoring_signature: signature,
        season: params.season,
        from_week: params.fromWeek,
        payload: board as unknown as Json,
        player_count: Object.keys(board.players).length,
        data_version: dataVersion,
        computed_at: new Date().toISOString(),
      },
      { onConflict: "scoring_signature,season,from_week" },
    );
    // A failed cache write costs a recompute next time; it must never fail the
    // request that produced a perfectly good board.
    if (error)
      console.error(
        "[on-the-clock/projection-board] cache write failed",
        error.message,
      );
    return board;
  })();

  inFlight.set(key, task);
  try {
    return await task;
  } finally {
    inFlight.delete(key);
  }
}
