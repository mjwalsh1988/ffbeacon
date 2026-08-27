/**
 * The League Pulse half of startup-pick resolution: reads what we already store,
 * and turns a traded pick descriptor into the player it actually became.
 *
 * The rule itself lives in lib/startup-draft.ts and is shared with On The Clock.
 * This module only supplies the evidence, from two tables we have been writing
 * for months and never read for this purpose:
 *
 *   league_drafts      one row per synced Sleeper draft, carrying the seat map
 *                      (slot_to_roster_id), the settings (teams / rounds /
 *                      reversal_round), and the raw draft object with its
 *                      start_time and last_picked epochs. Read through
 *                      lib/league-drafts.ts, shared with the slot labeller so
 *                      the two can never choose different drafts.
 *   draft_selections   one row per pick of every COMPLETED draft we captured,
 *                      with round, seat, and the FF Beacon player id.
 *
 * NO SLEEPER REQUEST. NO NEW TABLE. Two queries per page at most, and only one
 * when the round counts already rule every draft out.
 *
 * `draft_selections` IS SERVICE-ROLE ONLY (migration 0188 gives it no anon or
 * authenticated policy), so callers MUST pass an admin client. An
 * under-privileged client reads zero rows, which is indistinguishable from "this
 * draft was never captured", and would make us tell a reader the selections are
 * still loading when in truth this client may not read them. There is exactly
 * one build site per page and it holds the admin client; the transactions feed's
 * fallback valuation is handed that same index rather than building its own.
 *
 * THE SIMULATION IS LAZY AND RARELY RUNS.
 * A completed startup draft needs no simulation: every seat has a real player on
 * it. Only a draft that has not finished does, and only for the seats a trade on
 * this page actually references. So the caller hands in every pick descriptor on
 * the page up front, and the ranked board is loaded only when at least one of
 * them lands on an undrafted seat of an unfinished startup whose picks we
 * actually hold.
 *
 * WHEN WE CANNOT SAY, WE SAY SO.
 * A startup pick we cannot resolve is reported unresolved, never quietly priced
 * off `draft_pick_values`. That table holds rookie pick values only, and pricing
 * a startup 1.01 out of it is the exact bug this module exists to remove.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { RankedPlayer } from "@/lib/on-the-clock/board-types";
import type { ShapedPick } from "@/lib/on-the-clock/types";
import { excludeDrafted } from "@/lib/on-the-clock/draft-derive";
import { simulateRemainingDraft } from "@/lib/on-the-clock/adp-sim";
import { resolveCurrentDraftPicks } from "@/lib/on-the-clock/pick-ownership";
import {
  loadLeagueDrafts,
  preferLaterDraft,
  type LeagueDraftRow,
} from "@/lib/league-drafts";
import {
  classifyDraftPool,
  classifyTradeTiming,
  slotLabel,
  startupPickNoFor,
  substituteStartupPick,
  type StartupPickSubstitution,
  type StartupTradeTiming,
} from "@/lib/startup-draft";

type AnySupabase =
  | SupabaseClient<Database>
  | Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>;

/** One traded pick, as it arrives from a Sleeper transaction. */
export interface StartupPickQuery {
  season: number;
  round: number;
  /** The roster the pick ORIGINALLY belonged to. This is what sets its seat. */
  originalRosterId: number | null;
  /**
   * When the trade carrying this pick was agreed, epoch milliseconds.
   *
   * Needed ONLY to tell a startup pick from a rookie pick in a season that ran
   * both drafts, where the round number alone cannot. See `siblingRookieRounds`.
   * It never decides whether a startup pick is a startup pick.
   */
  tradedAtMs?: number | null;
}

/** A resolved startup pick, ready to be priced as a player. */
export interface StartupPickResolution {
  substitution: StartupPickSubstitution;
  /** Draft seat (1..teams), when known. */
  seat: number | null;
  /** Overall pick number in that draft, when known. */
  pickNo: number | null;
  /** "1.04" style label, when the seat is known. */
  label: string | null;
  /** True when the seat had already been drafted. */
  used: boolean;
  season: number;
  round: number;
}

/** One startup draft plus the selections we hold for it. */
export interface StartupDraftRecord {
  draft: LeagueDraftRow;
  /** pickNo -> the selection made there. Empty when picks are not captured yet. */
  selections: Map<number, { playerId: string | null; sleeperPlayerId: string | null }>;
  /** True when we hold at least one captured pick for this draft. */
  captured: boolean;
  /**
   * True when this draft has demonstrably begun.
   *
   * THIS IS THE GUARD ON SIMULATION, AND IT IS DELIBERATELY PESSIMISTIC.
   * Simulating a seat means "assume everything not in `selections` is still on
   * the board". That is only honest when the board really is untouched, and we
   * cannot tell a current capture from a stale one:
   *
   *   - League Pulse captures picks for COMPLETED drafts only (see
   *     lib/league-draft-selections.ts, gate 1), so a mid-flight draft nobody
   *     opened in the draft room has zero selections while dozens of players
   *     are gone.
   *   - On The Clock DOES capture a live draft, but only while somebody has the
   *     room open. It stops when they close it, so holding picks 1 to 50 of a
   *     draft that has reached 120 is a normal state, and "we have some rows"
   *     is not evidence that we have the current ones.
   *   - `league_drafts` is re-read only on the full-sync path, behind a
   *     60-minute cache, so `last_picked` can be up to an hour stale.
   *
   * So once a draft has started, every seat we hold no selection for is
   * reported unresolved rather than simulated. Only a draft that has NOT
   * started is simulated, which is the case the feature was built for: a trade
   * agreed before the startup draft, priced as the player the market would take
   * at that slot. `status` and `last_picked` are both consulted, because either
   * one alone can be behind.
   */
  hasStarted: boolean;
  /**
   * Round count of a ROOKIE draft the league also ran in this same season, or
   * null when there was only the startup.
   *
   * A first-year dynasty league routinely runs both: a long startup in the
   * spring and a short rookie draft after the NFL draft. Sleeper's traded-pick
   * descriptor is `{season, round, roster_id}` with no draft id, so "2026 round
   * 1" could mean either. Refusing the whole season was the first attempt and it
   * was far too blunt, because that shape is the normal one: it silently sent
   * every startup pick in the league back to the rookie table, which is the bug.
   *
   * Two signals separate them, and together they cover every trade in the real
   * league this was found on:
   *
   *   1. THE ROUND. A rookie draft runs `siblingRookieRounds` rounds. Anything
   *      deeper can only be a startup pick. That alone settles rounds 5 to 32.
   *   2. THE TRADE DATE. Sleeper trades picks in the NEXT draft to be held. A
   *      round-1-to-4 pick moved before the startup finished is a startup pick;
   *      once the startup is over those seats are spent, so the same descriptor
   *      means the rookie draft.
   *
   * When neither signal can speak (no trade date, or a startup with no recorded
   * finish) the pick is left on the existing valuation rather than guessed at.
   */
  siblingRookieRounds: number | null;
}

export interface StartupPickIndex {
  /** True when this league has at least one dynasty startup draft on record. */
  readonly hasStartupDraft: boolean;
  /**
   * Resolve one traded pick. Returns null when the pick is NOT a startup pick
   * (a rookie-draft pick, a future season, a redraft league), which is the
   * signal to leave the existing pick valuation completely alone.
   */
  resolve(pick: StartupPickQuery): StartupPickResolution | null;
  /** The startup draft a season maps to, for timing labels. */
  draftForSeason(season: number): StartupDraftRecord | null;
  /** Where a trade sits relative to the startup draft whose picks it moved. */
  timingFor(season: number, createdAtIso: string | null): StartupTradeTiming;
}

/** An index that knows about no startup drafts. Every resolve returns null. */
export const EMPTY_STARTUP_PICK_INDEX: StartupPickIndex = {
  hasStartupDraft: false,
  resolve: () => null,
  draftForSeason: () => null,
  timingFor: () => "unknown",
};

/** How the ranked board is fetched when a simulation is genuinely needed. */
export type BoardLoader = () => Promise<RankedPlayer[]>;

function toInt(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/**
 * Has this draft begun?
 *
 * Two signals, either of which is enough, because either one alone can be
 * behind. `status` moves to "drafting" the moment the room opens, and
 * `last_picked` appears with the first selection, but the row carrying both is
 * refreshed only on a full sync behind a 60-minute cache. Reading them together
 * closes most of that window. Anything other than an explicit pre-draft state
 * counts as started, so an unfamiliar status errs toward not simulating.
 */
function draftHasStarted(draft: LeagueDraftRow): boolean {
  if (draft.isComplete) return true;
  if (draft.lastPickedAtMs !== null) return true;
  const status = (draft.status ?? "").toLowerCase();
  return status !== "" && status !== "pre_draft";
}

/**
 * Build the startup-pick index for one league.
 *
 * `formatSlug` is the league's own derived format. It gates everything: a
 * non-dynasty league produces the empty index and no query runs at all.
 */
export async function loadStartupPickIndex(
  supabase: AnySupabase,
  params: {
    leagueRowId: string;
    /** The league's derived FF Beacon format slug. Non-dynasty short-circuits. */
    formatSlug: string | null;
    /** Every traded pick referenced on the page, so the board loads at most once. */
    picks: StartupPickQuery[];
    /** Loads the ranked board. Called only when a live seat must be simulated. */
    loadBoard?: BoardLoader;
  },
): Promise<StartupPickIndex> {
  const { leagueRowId, formatSlug, picks, loadBoard } = params;

  if (!(formatSlug ?? "").toLowerCase().startsWith("dynasty")) {
    return EMPTY_STARTUP_PICK_INDEX;
  }

  try {
    const client = supabase as SupabaseClient<Database>;
    const draftRows = await loadLeagueDrafts(client, leagueRowId);
    if (draftRows.length === 0) return EMPTY_STARTUP_PICK_INDEX;

    // An auction draft assigns pick_no in NOMINATION order, which has no
    // relationship to (round, seat). draft-derive says outright that auction
    // seat order is informational; here it would be load-bearing and would name
    // the wrong player with full confidence. Auctions are dropped from the whole
    // calculation BEFORE anything else looks at them, so one supplemental
    // auction cannot mark its season as containing a rookie draft and take a
    // legitimate snake startup down with it.
    const usable = draftRows.filter(
      (d) => d.rounds > 0 && d.teams > 0 && (d.type ?? "").toLowerCase() !== "auction",
    );
    if (usable.length === 0) return EMPTY_STARTUP_PICK_INDEX;

    // Candidates: a draft the round count alone cannot rule out. A 4-round
    // dynasty draft is a rookie draft under any evidence, so its selections are
    // never worth fetching. Only a draft that MIGHT be a startup gets read,
    // which keeps a dynasty league with only rookie drafts at one query. The
    // trade-off is that captured evidence can DEMOTE a long draft to rookie but
    // can never PROMOTE a short one to startup, which is fine because a draft of
    // six rounds or fewer cannot fill dynasty rosters from an empty league.
    const candidates = usable.filter(
      (d) => classifyDraftPool({ formatSlug, rounds: d.rounds }) === "startup",
    );
    if (candidates.length === 0) return EMPTY_STARTUP_PICK_INDEX;

    const selectionRows = await loadSelections(
      client,
      candidates.map((d) => d.sleeperDraftId),
    );

    // Captured pool evidence, per draft. Every row of one draft carries the same
    // value, so the first is enough. This can DEMOTE a candidate: a long rookie
    // or taxi draft that the round count read as a startup is corrected here.
    const capturedPoolByDraft = new Map<string, string | null>();
    for (const row of selectionRows) {
      if (!capturedPoolByDraft.has(row.sleeper_draft_id)) {
        capturedPoolByDraft.set(row.sleeper_draft_id, row.player_pool ?? null);
      }
    }

    // Split the season's drafts into startups and rookie drafts. A season that
    // holds BOTH is the NORMAL first-year shape (a long startup in the spring, a
    // short rookie draft after the NFL draft), so it is disambiguated rather
    // than abandoned. See StartupDraftRecord.siblingRookieRounds for how.
    const startupsBySeason = new Map<number, LeagueDraftRow>();
    const rookieRoundsBySeason = new Map<number, number>();
    const candidateIds = new Set(candidates.map((c) => c.sleeperDraftId));
    for (const draft of usable) {
      const pool = candidateIds.has(draft.sleeperDraftId)
        ? classifyDraftPool({
            formatSlug,
            rounds: draft.rounds,
            capturedPool: capturedPoolByDraft.get(draft.sleeperDraftId) ?? null,
          })
        : "rookie";
      if (pool === "rookie") {
        // The DEEPEST rookie draft in the season sets the ambiguous band, so a
        // league running more than one cannot leave a round uncovered.
        const current = rookieRoundsBySeason.get(draft.season) ?? 0;
        rookieRoundsBySeason.set(draft.season, Math.max(current, draft.rounds));
        continue;
      }
      const current = startupsBySeason.get(draft.season);
      if (!current || preferLaterDraft(current, draft)) {
        startupsBySeason.set(draft.season, draft);
      }
    }
    if (startupsBySeason.size === 0) return EMPTY_STARTUP_PICK_INDEX;

    // Attach selections to the drafts we kept.
    const bySeason = new Map<number, StartupDraftRecord>();
    const byDraftId = new Map<string, StartupDraftRecord>();
    for (const [season, draft] of startupsBySeason) {
      const record: StartupDraftRecord = {
        draft,
        selections: new Map(),
        captured: false,
        hasStarted: draftHasStarted(draft),
        siblingRookieRounds: rookieRoundsBySeason.get(season) ?? null,
      };
      bySeason.set(season, record);
      byDraftId.set(draft.sleeperDraftId, record);
    }
    for (const row of selectionRows) {
      const record = byDraftId.get(row.sleeper_draft_id);
      if (!record) continue;
      const pickNo = toInt(row.pick_no);
      if (pickNo === null) continue;
      record.captured = true;
      record.selections.set(pickNo, {
        playerId: row.player_id ?? null,
        sleeperPlayerId: row.sleeper_player_id ?? null,
      });
    }

    // Which seats on the page still need a simulated player. Only an UNFINISHED,
    // simulatable startup can have any, which is what keeps the board load rare.
    const simulated = await buildSimulations({ bySeason, picks, loadBoard });

    return makeIndex(bySeason, simulated);
  } catch (err) {
    // A startup index is an improvement on the existing valuation, never a
    // precondition for it. A failure here leaves every pick on the old path.
    console.error("[startup-picks] index build failed", leagueRowId, err);
    return EMPTY_STARTUP_PICK_INDEX;
  }
}

/** draft_selections rows for a set of drafts, paged past the 1000-row cap. */
async function loadSelections(
  client: SupabaseClient<Database>,
  draftIds: string[],
): Promise<
  Array<{
    sleeper_draft_id: string;
    pick_no: number;
    player_id: string | null;
    sleeper_player_id: string | null;
    player_pool: string | null;
  }>
> {
  // Defense in depth, matching lib/trade-analyzer.ts loadPlayerMeta. PostgREST's
  // `.in()` builds a quoted list and does NOT escape an embedded quote, and
  // sleeper_draft_id is a text column holding third-party data. Sleeper emits
  // numeric snowflakes, so nothing is lost by insisting on that shape.
  const safeIds = draftIds.filter((id) => /^[A-Za-z0-9_-]{1,64}$/.test(id));
  if (safeIds.length === 0) return [];

  const out: Array<{
    sleeper_draft_id: string;
    pick_no: number;
    player_id: string | null;
    sleeper_player_id: string | null;
    player_pool: string | null;
  }> = [];

  // A 12-team 33-round startup is 396 rows and a league can carry several
  // drafts, so this can run past 1000. PostgREST truncates silently at that cap,
  // which would look exactly like "these picks were never captured".
  const PAGE = 1000;
  const MAX_PAGES = 20;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const offset = page * PAGE;
    const { data, error } = await client
      .from("draft_selections")
      .select("sleeper_draft_id, pick_no, player_id, sleeper_player_id, player_pool")
      .in("sleeper_draft_id", safeIds)
      .order("sleeper_draft_id", { ascending: true })
      .order("pick_no", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) {
      // A partial read is indistinguishable from an uncaptured draft downstream,
      // so it has to be visible here or it is invisible everywhere.
      console.error("[startup-picks] draft_selections read failed", error.message);
      break;
    }
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < PAGE) break;
  }
  return out;
}

/**
 * Simulate the undrafted seats the page actually asks about.
 *
 * Returns pickNo -> FF Beacon player id, keyed per draft. The board is fetched
 * at most once and only when an unfinished startup genuinely has a referenced
 * seat still open AND its already-made picks are known.
 */
async function buildSimulations(params: {
  bySeason: Map<number, StartupDraftRecord>;
  picks: StartupPickQuery[];
  loadBoard?: BoardLoader;
}): Promise<Map<string, Map<number, string>>> {
  const { bySeason, picks, loadBoard } = params;
  const out = new Map<string, Map<number, string>>();
  if (!loadBoard) return out;

  const needy: StartupDraftRecord[] = [];
  for (const record of bySeason.values()) {
    if (record.draft.isComplete) continue;
    if (record.hasStarted) continue;
    const wanted = picks.some((p) => {
      if (p.season !== record.draft.season || p.originalRosterId === null) return false;
      if (p.round > record.draft.rounds) return false;
      const seat = startupPickNoFor({
        round: p.round,
        originalRosterId: p.originalRosterId,
        rosterToSeat: record.draft.rosterToSeat,
        teams: record.draft.teams,
        shape: record.draft.shape,
      });
      return seat !== null && !record.selections.has(seat.pickNo);
    });
    if (wanted) needy.push(record);
  }
  if (needy.length === 0) return out;

  const board = await loadBoard();
  if (board.length === 0) return out;

  for (const record of needy) {
    const { teams, rounds, shape, season, rosterToSeat } = record.draft;

    // The picks already made, in the shape excludeDrafted and
    // resolveCurrentDraftPicks expect. Only pickNo and the player ids matter
    // here; the rest is padding the shared helpers do not read.
    const madePicks: ShapedPick[] = [];
    for (const [pickNo, sel] of record.selections) {
      madePicks.push({
        pickNo,
        round: Math.ceil(pickNo / teams),
        draftSlot: null,
        rosterId: null,
        pickedBy: null,
        sleeperPlayerId: sel.sleeperPlayerId,
        playerId: sel.playerId,
        isKeeper: false,
        firstName: null,
        lastName: null,
        position: null,
        team: null,
      });
    }

    const slotToRosterId: Record<string, number> = {};
    for (const [rosterId, seat] of rosterToSeat) slotToRosterId[String(seat)] = rosterId;

    const currentPicks = resolveCurrentDraftPicks({
      teams,
      rounds,
      shape,
      slotToRosterId,
      madePicks,
      tradedPicks: [],
      currentSeason: season,
    });

    const firstOpen = currentPicks.find((p) => !p.made)?.overall ?? 1;
    const available = excludeDrafted(board, madePicks);
    const sim = simulateRemainingDraft({
      available,
      currentPicks,
      onTheClockPickNo: firstOpen,
    });

    const byPickNo = new Map<number, string>();
    for (const [pickNo, entry] of sim) byPickNo.set(pickNo, entry.player.playerId);
    out.set(record.draft.sleeperDraftId, byPickNo);
  }

  return out;
}

function makeIndex(
  bySeason: Map<number, StartupDraftRecord>,
  simulated: Map<string, Map<number, string>>,
): StartupPickIndex {
  function draftForSeason(season: number): StartupDraftRecord | null {
    return bySeason.get(season) ?? null;
  }

  function unresolved(
    pick: StartupPickQuery,
    reason: "no-seat" | "not-captured" | "board-exhausted",
  ): StartupPickResolution {
    return {
      substitution: { kind: "unresolved", reason },
      seat: null,
      pickNo: null,
      label: null,
      used: false,
      season: pick.season,
      round: pick.round,
    };
  }

  return {
    hasStartupDraft: bySeason.size > 0,
    draftForSeason,

    resolve(pick: StartupPickQuery): StartupPickResolution | null {
      const record = bySeason.get(pick.season);
      if (!record) return null;

      // A round past the end of the draft is not a seat in it. Placing it would
      // produce a pick number in the next draft's territory and a confident
      // wrong answer, so it goes back to the existing pick valuation.
      if (!Number.isFinite(pick.round) || pick.round < 1 || pick.round > record.draft.rounds) {
        return null;
      }

      // The season also ran a rookie draft, so a round inside the rookie draft's
      // range could belong to either. The trade date settles it: Sleeper trades
      // picks in the NEXT draft to be held, so once the startup is finished the
      // same descriptor means the rookie draft.
      if (record.siblingRookieRounds !== null && pick.round <= record.siblingRookieRounds) {
        const finishedAt = record.draft.lastPickedAtMs;
        const tradedAt = pick.tradedAtMs;
        if (finishedAt === null || tradedAt === null || tradedAt === undefined) return null;
        if (!Number.isFinite(tradedAt)) return null;
        if (tradedAt > finishedAt) return null;
      }

      // A startup pick whose origin Sleeper did not record. We know it belongs
      // to the startup draft but not which seat, so it is unresolved rather
      // than handed back to the rookie table.
      if (pick.originalRosterId === null) return unresolved(pick, "no-seat");

      const placed = startupPickNoFor({
        round: pick.round,
        originalRosterId: pick.originalRosterId,
        rosterToSeat: record.draft.rosterToSeat,
        teams: record.draft.teams,
        shape: record.draft.shape,
      });
      if (!placed) return unresolved(pick, "no-seat");

      const selection = record.selections.get(placed.pickNo) ?? null;
      // A seat in a draft that has STARTED is treated as used whether or not we
      // hold the pick, because we cannot tell "still on the board" from "our
      // capture stopped before here". A seat in a draft that has not started is
      // genuinely open and gets the simulation.
      const used = selection !== null || record.hasStarted;

      const substitution = substituteStartupPick({
        seatKnown: true,
        used,
        usedPlayerId: selection?.playerId ?? null,
        simulatedPlayerId:
          simulated.get(record.draft.sleeperDraftId)?.get(placed.pickNo) ?? null,
      });

      return {
        substitution,
        seat: placed.seat,
        pickNo: placed.pickNo,
        label: slotLabel(pick.round, placed.seat),
        used,
        season: pick.season,
        round: pick.round,
      };
    },

    timingFor(season: number, createdAtIso: string | null): StartupTradeTiming {
      const record = draftForSeason(season);
      if (!record) return "unknown";
      const createdAtMs = createdAtIso ? Date.parse(createdAtIso) : NaN;
      return classifyTradeTiming({
        createdAtMs: Number.isFinite(createdAtMs) ? createdAtMs : null,
        startedAtMs: record.draft.startedAtMs,
        lastPickedAtMs: record.draft.lastPickedAtMs,
      });
    },
  };
}

/**
 * Sleeper sends `draft_picks` as an array, an object map, a JSON string, or
 * null. Every reader has to normalize, per the League Pulse rules in CLAUDE.md.
 * Accepting only the array shape here meant a differently-shaped row produced an
 * empty pre-scan, so the board never loaded and every live startup seat reported
 * "the board runs out" for what was really a parser mismatch.
 */
function normalizePickArray(input: unknown): unknown[] {
  if (input == null) return [];
  if (Array.isArray(input)) return input;
  if (typeof input === "object") return Object.values(input as Record<string, unknown>);
  if (typeof input === "string") {
    try {
      const parsed = JSON.parse(input);
      if (Array.isArray(parsed)) return parsed;
      if (parsed && typeof parsed === "object") return Object.values(parsed);
      return [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Every traded pick descriptor in one Sleeper `draft_picks` payload.
 *
 * ONE parser, called from every site that needs pick descriptors, because there
 * used to be four and they disagreed. `roster_id` is the pick's ORIGINAL team
 * and is what sets its seat; `previous_owner_id` is the honest fallback when
 * Sleeper omits it, and dropping that fallback in one collector but not another
 * meant a pick was invisible to the board-load pre-scan while still being
 * resolved later.
 */
export function collectStartupPickQueries(
  draftPicks: unknown,
  /** When the trade was agreed, ISO. Only needed to separate a startup pick
   * from a rookie pick in a season that ran both drafts. */
  tradedAtIso?: string | null,
): StartupPickQuery[] {
  const parsed = tradedAtIso ? Date.parse(tradedAtIso) : NaN;
  const tradedAtMs = Number.isFinite(parsed) ? parsed : null;

  const arr = normalizePickArray(draftPicks);
  const out: StartupPickQuery[] = [];
  for (const raw of arr) {
    if (!raw || typeof raw !== "object") continue;
    const p = raw as Record<string, unknown>;
    const season = toInt(p.season);
    const round = toInt(p.round);
    if (season === null || round === null) continue;
    const origin = toInt(p.roster_id) ?? toInt(p.previous_owner_id);
    out.push({ season, round, originalRosterId: origin, tradedAtMs });
  }
  return out;
}
