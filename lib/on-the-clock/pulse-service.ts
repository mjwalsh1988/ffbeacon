/**
 * Server orchestration for Draft Pulse and the marginal-value engine.
 *
 * One entry point, getPulsePayload, which the /api/on-the-clock/pulse route
 * calls. It stitches together three things that are each cached at a different
 * grain, because they change at wildly different rates:
 *
 *   projection board   per (scoring signature, season, week window), 24h TTL,
 *                      SHARED across every league with identical scoring
 *   Draft Pulse        per (draft, pick count), recomputed when a pick lands
 *   marginal values    per request, because they depend on which roster is
 *                      asking and what is still on the board
 *
 * The expensive one is the projection board, and it is the one that almost never
 * has to run. Everything after it is arithmetic over numbers already in memory.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { getNflState, currentNflSeason } from "@/lib/sleeper";
import { resolveCurrentWeek } from "@/lib/league-matchups";
import { mapSleeperToPlayerIds } from "@/lib/players/sleeper-map";
import { loadPowerPulseSettings } from "@/lib/power-pulse/settings";
import { startingSlots } from "@/lib/power-pulse/lineup";
import { readDraftCache } from "./cache";
import {
  computeDraftPulse,
  fallbackSlotsFromDraftSettings,
  DRAFT_PULSE_VERSION,
  type DraftPulseResult,
} from "./draft-pulse";
import {
  computeMarginal,
  DEFAULT_MARGINAL_SETTINGS,
  type MarginalSettings,
} from "./marginal";
import { rosteredPlayerIds } from "./waiver-replacement";
import { SLEEPER_SOURCE } from "@/lib/projections/source-constants";
import {
  getProjectionBoard,
  projectionDataVersion,
  resolveBoardProjectionSource,
  type ProjectionBoard,
} from "./projection-board";
import type { ShapedDraftCache } from "./types";
import type {
  PulseMarginalPayload,
  PulsePayload,
  PulsePlayerSummary,
} from "./pulse-types";

export type { PulseMarginalPayload, PulsePayload, PulsePlayerSummary };

type Client = SupabaseClient<Database>;

/**
 * Fallback ceiling on candidates priced in one request, used only when the
 * caller does not supply the admin's own value. Each candidate costs a seat
 * probe, so this is the real cost control.
 */
export const MAX_MARGINAL_CANDIDATES = 160;

/**
 * The hard ceiling, applied to whatever the admin setting says. The admin page
 * clamps on SAVE; this clamps on USE, so the cost control does not depend on
 * every future writer remembering the first clamp.
 */
export const MAX_MARGINAL_CANDIDATES_CEILING = 300;

// ---------------------------------------------------------------------------
// NFL state, memoized in process
// ---------------------------------------------------------------------------

const NFL_STATE_TTL_MS = 10 * 60 * 1000;
let nflStateCache: {
  at: number;
  state: Awaited<ReturnType<typeof getNflState>>;
} | null = null;

async function cachedNflState() {
  if (nflStateCache && Date.now() - nflStateCache.at < NFL_STATE_TTL_MS)
    return nflStateCache.state;
  const state = await getNflState();
  nflStateCache = { at: Date.now(), state };
  return state;
}

/**
 * The first week the draft's season still has ahead of it.
 *
 * A draft for a season that has not started yet is scored over the whole slate,
 * which is the normal startup case. A rookie draft mid-season is scored over
 * what is left. A draft for a season already gone gets week 1 and no remaining
 * weeks, which the projection board will report as an empty slate.
 */
/**
 * Sleeper's own default when a league has not configured a playoff start.
 * Matches lib/power-pulse/load.ts so the two features cannot disagree about a
 * league that never set one.
 */
export const DEFAULT_PLAYOFF_WEEK_START = 15;

/**
 * The last week of a league's regular season, from Sleeper's playoff_week_start.
 *
 * Exported because it is the one place that knows a non-positive value means
 * "this league has no playoffs" rather than "week zero". Sleeper's own default
 * when a league has not configured playoffs is week 15, which is what every
 * caller falls back to.
 */
export function regularSeasonThroughWeek(
  playoffWeekStart: number | null | undefined,
): number {
  const positive =
    typeof playoffWeekStart === "number" &&
    Number.isFinite(playoffWeekStart) &&
    playoffWeekStart > 1
      ? playoffWeekStart
      : DEFAULT_PLAYOFF_WEEK_START;
  return positive - 1;
}

export async function resolveFromWeek(
  season: number,
  playoffWeekStart: number | null,
): Promise<number> {
  if (season > Number(currentNflSeason())) return 1;
  const state = await cachedNflState();
  // Same guard as regularSeasonThroughWeek: a zero here would ask
  // resolveCurrentWeek to treat the whole season as postseason.
  return resolveCurrentWeek(
    state,
    season,
    regularSeasonThroughWeek(playoffWeekStart) + 1,
  );
}

// ---------------------------------------------------------------------------
// Draft Pulse with its cache
// ---------------------------------------------------------------------------

/** roster_id to the FF Beacon player ids that roster currently controls. */
export async function buildTeamRosters(
  admin: Client,
  cache: ShapedDraftCache,
  opts: { includePreDraftRoster: boolean },
): Promise<Map<number, string[]>> {
  const byRoster = new Map<number, string[]>();
  for (const r of cache.rosters) byRoster.set(r.rosterId, []);

  for (const pick of cache.picks) {
    if (pick.rosterId === null || !pick.playerId) continue;
    const list = byRoster.get(pick.rosterId) ?? [];
    list.push(pick.playerId);
    byRoster.set(pick.rosterId, list);
  }

  // A dynasty rookie draft sits on top of rosters that already exist, so those
  // players are part of the team being scored. A startup's rosters are empty, so
  // this costs nothing there. Sleeper stores roster players as Sleeper ids, so
  // they need resolving; drafted picks were already resolved at sync time.
  if (opts.includePreDraftRoster) {
    const sleeperIds = [...new Set(cache.rosters.flatMap((r) => r.players))];
    if (sleeperIds.length > 0) {
      const map = await mapSleeperToPlayerIds(admin, sleeperIds);
      for (const r of cache.rosters) {
        const list = byRoster.get(r.rosterId) ?? [];
        for (const sid of r.players) {
          const pid = map.get(sid);
          if (pid && !list.includes(pid)) list.push(pid);
        }
        byRoster.set(r.rosterId, list);
      }
    }
  }

  return byRoster;
}

interface PulseContext {
  cache: ShapedDraftCache;
  board: ProjectionBoard;
  pulse: DraftPulseResult;
  rosters: Map<number, string[]>;
  season: number;
  fromWeek: number;
  slots: string[];
  scoringEstimated: boolean;
}

const inFlightPulse = new Map<string, Promise<PulseContext | null>>();

/**
 * Everything the payload needs, with the Draft Pulse half served from
 * on_the_clock_pulse_cache when the pick count has not moved. Concurrent callers
 * for one draft coalesce, so a room opened by ten league mates computes once.
 */
async function resolveContext(
  admin: Client,
  draftId: string,
  opts: { includePreDraftRoster: boolean },
): Promise<PulseContext | null> {
  const key = `${draftId}|${opts.includePreDraftRoster ? 1 : 0}`;
  const running = inFlightPulse.get(key);
  if (running) return running;

  const task = (async (): Promise<PulseContext | null> => {
    const cache = await readDraftCache(admin, draftId);
    if (!cache) return null;

    const season = Number(cache.draft.season);
    if (!Number.isFinite(season)) return null;

    const fromWeek = await resolveFromWeek(
      season,
      cache.draft.playoffWeekStart,
    );
    const scoringEstimated =
      Object.keys(cache.draft.scoringSettings).length === 0;

    // The projection board is the only expensive step, and it is cached across
    // every league that scores the same way, so it almost never runs.
    const settings = await loadPowerPulseSettings(admin);
    // Fingerprint the source data ONCE and hand the same value to both caches
    // below, so the board and the Draft Pulse built on it can never invalidate
    // at different moments and produce a mixed-vintage answer.
    // Which projection engine is live, resolved ONCE for the same reason the
    // fingerprint is: two resolutions could straddle an admin flipping the
    // switch and leave a board fingerprinted against one engine and built from
    // the other. Free while the feature is off, when it makes no query at all.
    const projectionSource = await resolveBoardProjectionSource(
      admin,
      season,
      fromWeek,
      settings,
    );
    const dataVersion = await projectionDataVersion(
      admin,
      season,
      projectionSource,
    );
    const board = await getProjectionBoard(admin, {
      scoringSettings: cache.draft.scoringSettings,
      season,
      fromWeek,
      // Already loaded one line above; getProjectionBoard only wants it for the
      // scoring signature, so passing it through drops a round trip per request.
      settings,
      dataVersion,
      source: projectionSource,
    });

    const rosters = await buildTeamRosters(admin, cache, {
      includePreDraftRoster: opts.includePreDraftRoster,
    });

    const fallbackSlots = fallbackSlotsFromDraftSettings(cache.draft.settings);
    // includePreDraftRoster BELONGS in the version, because it changes the
    // answer: buildTeamRosters folds every pre-draft Sleeper roster into each
    // team under it, which moves every projected lineup and every rank. The
    // durable row is one per draft, so without it in the key a single request
    // with the flag flipped wrote a payload computed under the wrong roster
    // model, and every other viewer took that as a cache hit. Worse at the end
    // of a draft: once the pick count stops moving, the snapshot finalizer would
    // freeze it permanently, and the grades read their lineup component from it.
    // The league's last regular season week, the same span Power Pulse averages.
    //
    // Zero is a REAL VALUE and not an absent one, which `?? 15` does not catch.
    // A guillotine, best ball or bracket league has no playoffs and Sleeper
    // stores `playoff_week_start: 0` for it; four of the leagues synced here do.
    // Read literally that yields a through-week of -1, every week is filtered
    // out of the average, and every team in the league scores zero. Power Pulse
    // has always used positiveIntOrNull for this column; this is the same guard
    // by the same reasoning.
    const throughWeek = regularSeasonThroughWeek(cache.draft.playoffWeekStart);

    // dataVersion BELONGS in the version, and its absence is the whole reason a
    // completed draft room could sit on numbers a day and a half old. The other
    // half of this key is `through_pick_no`, which stops moving forever the
    // moment a draft finishes, so before this there was nothing left that could
    // ever mark the payload stale. throughWeek belongs for the same reason:
    // changing the span changes every mean and every rank.
    const modelVersion = [
      DRAFT_PULSE_VERSION,
      board.version,
      settings.modelVersion,
      opts.includePreDraftRoster ? "pre" : "nopre",
      `w${throughWeek}`,
      dataVersion,
    ].join("|");
    const throughPickNo = cache.picks.reduce(
      (m, p) => Math.max(m, p.pickNo),
      0,
    );

    const { data: cached } = await admin
      .from("on_the_clock_pulse_cache")
      .select("payload, through_pick_no, model_version")
      .eq("sleeper_draft_id", draftId)
      .maybeSingle();

    let pulse: DraftPulseResult | null = null;
    if (
      cached?.payload &&
      cached.model_version === modelVersion &&
      Number(cached.through_pick_no) === throughPickNo
    ) {
      pulse = cached.payload as unknown as DraftPulseResult;
    }

    if (!pulse) {
      const teams = [...rosters.entries()].map(([rosterId, playerIds]) => ({
        rosterId,
        playerIds,
      }));
      pulse = computeDraftPulse({
        teams,
        rosterPositions: cache.draft.rosterPositions,
        fallbackSlots,
        board,
        display: settings.display,
        throughWeek,
        // Everything anyone in this league owns, which is what makes the leftover
        // pool a WAIVER wire rather than the whole player universe.
        rosteredPlayerIds: rosteredPlayerIds(teams),
      });
      const { error } = await admin.from("on_the_clock_pulse_cache").upsert(
        {
          sleeper_draft_id: draftId,
          through_pick_no: throughPickNo,
          model_version: modelVersion,
          payload: pulse as unknown as Json,
          computed_at: new Date().toISOString(),
        },
        { onConflict: "sleeper_draft_id" },
      );
      if (error)
        console.error("[on-the-clock/pulse] cache write failed", error.message);
    }

    const leagueSlots = startingSlots(cache.draft.rosterPositions);
    return {
      cache,
      board,
      pulse,
      rosters,
      season,
      fromWeek,
      slots: leagueSlots.length > 0 ? leagueSlots : fallbackSlots,
      scoringEstimated,
    };
  })();

  inFlightPulse.set(key, task);
  try {
    return await task;
  } finally {
    inFlightPulse.delete(key);
  }
}

// ---------------------------------------------------------------------------
// Payload
// ---------------------------------------------------------------------------

export interface PulseRequest {
  draftId: string;
  /** Whether pre-draft roster players count (dynasty rookie drafts). */
  includePreDraftRoster: boolean;
  /** The connected user's roster, when detected. Drives the marginal half. */
  myRosterId: number | null;
  /** Available player ids to price, best first. Capped server-side. */
  candidateIds: string[];
  /** Ids expected to survive to the roster's next pick, from the ADP simulation. */
  survivorIds: string[] | null;
  /**
   * The board fingerprint the caller already holds. When it matches, the
   * ~43 KB per-player map is left out of the response instead of being sent
   * again unchanged on every pick.
   */
  knownBoardEtag?: string | null;
  /** Overall pick number of the roster's next pick, for the copy. */
  nextPickNo: number | null;
  /** How many selections happen before that pick. */
  picksUntilNext: number | null;
  /** The admin's cap. Falls back to MAX_MARGINAL_CANDIDATES when absent. */
  maxCandidates?: number;
  marginalSettings?: MarginalSettings;
}

export async function getPulsePayload(
  admin: Client,
  request: PulseRequest,
): Promise<PulsePayload | null> {
  const context = await resolveContext(admin, request.draftId, {
    includePreDraftRoster: request.includePreDraftRoster,
  });
  if (!context) return null;

  // The map is a pure function of the projection board, so this identifies it
  // exactly. A caller holding this etag already has the same bytes.
  //
  // The projection engine is part of it. The scoring signature covers the
  // league's scoring and the model version and nothing else, so the day an
  // admin switches engines every open draft room would hold an etag that still
  // matched and would never be sent the rebuilt numbers.
  //
  // Sleeper keeps the old shape, for the same reason projectionDataVersion does:
  // appending it unconditionally would invalidate every open room on the deploy
  // that added the suffix, which is a rebuild storm buying nothing.
  const engine = context.board.projectionSource ?? SLEEPER_SOURCE;
  const boardEtag =
    engine === SLEEPER_SOURCE
      ? `${context.board.scoringSignature}|${context.board.season}|${context.board.fromWeek}`
      : `${context.board.scoringSignature}|${context.board.season}|${context.board.fromWeek}|${engine}`;

  let players: Record<string, PulsePlayerSummary> | null = null;
  if (request.knownBoardEtag !== boardEtag) {
    players = {};
    for (const [id, p] of Object.entries(context.board.players)) {
      players[id] = {
        ppw: p.pointsPerWeek,
        sp: p.seasonPoints,
        br: p.beatRate,
        av: p.availability,
        rl: p.reliability,
        wp: p.weeksPlayed,
        cv: p.ratioStdev,
      };
    }
  }

  let marginal: PulseMarginalPayload | null = null;
  if (request.myRosterId !== null) {
    const rosterPlayerIds = context.rosters.get(request.myRosterId) ?? [];
    const requested = request.candidateIds.length;
    // Clamped on the READ path too, not only where the admin saves it. The
    // route sizes its oversized-array rejection from this same number, so a
    // value written straight to the settings row would uncap both, and every
    // candidate costs a seat probe for every remaining week.
    const cap = Math.min(
      Math.max(1, Math.round(request.maxCandidates ?? MAX_MARGINAL_CANDIDATES)),
      MAX_MARGINAL_CANDIDATES_CEILING,
    );
    const candidateIds = request.candidateIds.slice(0, cap);
    const result = computeMarginal({
      slots: context.slots,
      rosterPlayerIds,
      candidateIds,
      survivorIds: request.survivorIds,
      board: context.board,
      settings: request.marginalSettings ?? DEFAULT_MARGINAL_SETTINGS,
    });
    marginal = {
      ...result,
      rosterId: request.myRosterId,
      nextPickNo: request.nextPickNo,
      picksUntilNext: request.picksUntilNext,
      priced: Object.keys(result.byPlayer).length,
      requested,
    };
  }

  return {
    version: context.pulse.version,
    season: context.season,
    fromWeek: context.fromWeek,
    weeks: context.board.weeks,
    slots: context.pulse.slots,
    slotsEstimated: context.pulse.slotsEstimated,
    scoringEstimated: context.scoringEstimated,
    teams: context.pulse.teams,
    players,
    boardEtag,
    marginal,
    coverage: { projectedPlayers: Object.keys(context.board.players).length },
  };
}

/**
 * Draft Pulse alone, for the snapshot finalizer, which freezes the standings but
 * has no connected user to price candidates for.
 */
export async function getDraftPulseOnly(
  admin: Client,
  draftId: string,
  opts: { includePreDraftRoster: boolean },
): Promise<DraftPulseResult | null> {
  const context = await resolveContext(admin, draftId, opts);
  return context?.pulse ?? null;
}

/**
 * Draft Pulse plus the vintage of the projections behind it.
 *
 * The snapshot finalizer needs both. It already dates its value and ADP inputs
 * and reports a confidence from them, and the projections were the one input it
 * froze without dating, which is how a snapshot taken two minutes after a draft
 * could carry a sweep computed two hours earlier and still call itself high
 * confidence.
 */
export async function getDraftPulseWithVintage(
  admin: Client,
  draftId: string,
  opts: { includePreDraftRoster: boolean },
): Promise<{
  pulse: DraftPulseResult | null;
  projectionComputedAt: string | null;
}> {
  const context = await resolveContext(admin, draftId, opts);
  return {
    pulse: context?.pulse ?? null,
    projectionComputedAt: context?.board.computedAt ?? null,
  };
}
