/**
 * Pure, browser-safe derivations for the On The Clock room.
 *
 * NOTHING here touches Sleeper, Supabase, or fetch. These are the deterministic
 * transforms the client runs on the shaped cache + Realtime pick rows:
 *   - mapRealtimePickRow: shape a raw on_the_clock_pick_cache row (the Postgres
 *     Changes payload.new) using the SAME shaper as the read path (no drift).
 *   - mergePick / mergePicks: fold incoming pick rows into local state by pick_no.
 *   - deriveDraftState: who is on the clock, the last pick, and (when the connected
 *     Sleeper user is known) which seat/roster is theirs.
 *   - relativeTime / formatLastSynced / syncStatusLine: the sync status copy.
 *
 * The on-the-clock seat math mirrors draft-board.tsx pickNoFor (snake: even rounds
 * reverse) so the derived "on the clock" seat lines up with the highlighted board
 * cell. Linear and third-round-reversal drafts are approximated as snake here; true
 * 3RR/linear seat ordering is a documented live-verification item, not a crash.
 */

import type { Database } from "@/lib/database.types";
import { shapePickRow } from "./cache";
import type { PlayerPool, ShapedDraftCache, ShapedPick, SyncStatus } from "./types";
import type { RankedPlayer } from "./board-types";

type PickRow = Database["public"]["Tables"]["on_the_clock_pick_cache"]["Row"];

// ---------------------------------------------------------------------------
// Realtime pick mapping + merge
// ---------------------------------------------------------------------------

/**
 * Shape a raw pick-cache row delivered by Supabase Realtime. The Postgres Changes
 * payload.new carries the full row with the same column names/types as the table,
 * so we coerce it to the row type and reuse the canonical shaper. Returns null when
 * the payload is not a usable pick row (missing/!numeric pick_no).
 */
export function mapRealtimePickRow(raw: unknown): ShapedPick | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const pickNo = Number(row.pick_no);
  if (!Number.isFinite(pickNo)) return null;
  return shapePickRow(row as unknown as PickRow);
}

/**
 * Fold one incoming pick into a pick list, keyed by pick_no (idempotent: a repeat
 * or UPDATE of an existing pick replaces it). Returns a new array sorted by pick_no.
 */
export function mergePick(picks: ShapedPick[], incoming: ShapedPick): ShapedPick[] {
  const byNo = new Map<number, ShapedPick>(picks.map((p) => [p.pickNo, p]));
  byNo.set(incoming.pickNo, incoming);
  return [...byNo.values()].sort((a, b) => a.pickNo - b.pickNo);
}

/** Fold many incoming picks in one pass (same idempotent, sorted semantics). */
export function mergePicks(picks: ShapedPick[], incoming: ShapedPick[]): ShapedPick[] {
  const byNo = new Map<number, ShapedPick>(picks.map((p) => [p.pickNo, p]));
  for (const p of incoming) byNo.set(p.pickNo, p);
  return [...byNo.values()].sort((a, b) => a.pickNo - b.pickNo);
}

// ---------------------------------------------------------------------------
// Available board: drafted exclusion + pool filter + Best Available
// ---------------------------------------------------------------------------

/** Normalize a player name for the unmapped-pick name guard. */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Remove drafted players from the ranked board. Exclusion prefers the resolved
 * FF Beacon player_id (exact), then the Sleeper id, then a normalized-name guard
 * for picks we could not map to a player_id (so an unmapped pick still drops the
 * matching board row). DST/K are excluded the same way once drafted; they remain
 * on the board until then. Pure: no Sleeper, no DB.
 */
export function excludeDrafted(board: RankedPlayer[], picks: ShapedPick[]): RankedPlayer[] {
  const draftedPlayerIds = new Set<string>();
  const draftedSleeperIds = new Set<string>();
  const draftedNames = new Set<string>();
  for (const p of picks) {
    if (p.playerId) draftedPlayerIds.add(p.playerId);
    if (p.sleeperPlayerId) draftedSleeperIds.add(p.sleeperPlayerId);
    if (!p.playerId) {
      const name = `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim();
      if (name) draftedNames.add(normalizeName(name));
    }
  }
  return board.filter((pl) => {
    if (draftedPlayerIds.has(pl.playerId)) return false;
    if (pl.sleeperId && draftedSleeperIds.has(pl.sleeperId)) return false;
    if (draftedNames.size > 0 && draftedNames.has(normalizeName(pl.name))) return false;
    return true;
  });
}

/**
 * Rookie drafts run this many rounds or fewer. A dynasty draft with more rounds
 * than this is a startup (full player pool).
 */
export const ROOKIE_DRAFT_MAX_ROUNDS = 6;

/**
 * Infer the player pool from the league's detected format and the draft's round
 * count. No manual toggle: redraft (including chopped/guillotine, which derive as
 * redraft) always shows everyone; dynasty uses the round count to split rookie
 * drafts (6 rounds or fewer) from startups. Best ball follows its league type.
 * Unknown round counts read as a startup so we never hide the full pool by
 * accident.
 */
export function inferPlayerPool(params: {
  formatSlug: string | null | undefined;
  rounds: number;
}): PlayerPool {
  const isDynasty = (params.formatSlug ?? "").toLowerCase().startsWith("dynasty");
  if (!isDynasty) return "everyone";
  const rounds = Number(params.rounds);
  if (Number.isFinite(rounds) && rounds > 0 && rounds <= ROOKIE_DRAFT_MAX_ROUNDS) {
    return "rookies";
  }
  return "everyone";
}

/**
 * Plain-English explanation of the inferred pool, for the one-time notice shown
 * when a draft room opens.
 */
export function describeInferredPool(params: {
  formatSlug: string | null | undefined;
  rounds: number;
  pool: PlayerPool;
}): string {
  const isDynasty = (params.formatSlug ?? "").toLowerCase().startsWith("dynasty");
  if (!isDynasty) {
    return "Looks like this is a redraft league, so we are showing all players.";
  }
  if (params.pool === "rookies") {
    return `Looks like this is a dynasty rookie draft (${params.rounds} rounds), so we are showing rookies only.`;
  }
  return "Looks like this is a dynasty startup draft, so we are showing all players.";
}

/**
 * Filter the available board to a pool. "everyone" = all ranked undrafted
 * players; "rookies" = only first-year players (RankedPlayer.isRookie, derived by
 * the loader from years_experience / draft_year). DST/K stay in either pool when
 * ranked. Missing rookie flags simply read as false (non-rookie), so a board with
 * no rookie data yields an empty Rookies-only pool rather than crashing.
 */
export function filterPool(players: RankedPlayer[], pool: PlayerPool): RankedPlayer[] {
  return pool === "rookies" ? players.filter((p) => p.isRookie) : players;
}

/**
 * Deterministic Best Available = highest value, tie-broken by better (lower)
 * overall rank, then lowest player id. Returns null for an empty pool. This is
 * the simple "pure value" pick, NOT the Phase 6B Team Need engine.
 */
export function pickBestByValue(players: RankedPlayer[]): RankedPlayer | null {
  let best: RankedPlayer | null = null;
  for (const p of players) {
    if (!best) {
      best = p;
      continue;
    }
    if (
      p.value > best.value ||
      (p.value === best.value && p.overallRank < best.overallRank) ||
      (p.value === best.value && p.overallRank === best.overallRank && p.playerId < best.playerId)
    ) {
      best = p;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// On-the-clock + my-team derivation
// ---------------------------------------------------------------------------

/**
 * Draft serpentine shape. `type` is the Sleeper draft.type ("snake" | "linear" |
 * "auction" | null). `reversalRound` is settings.reversal_round (0/absent = none;
 * 3 = third-round reversal). Auction is treated like linear for seat math (the
 * board renders read-only; the order is informational only).
 */
export interface DraftShape {
  type: string | null;
  reversalRound: number;
}

const DEFAULT_SHAPE: DraftShape = { type: "snake", reversalRound: 0 };

/** Build a DraftShape from a shaped draft meta. */
export function draftShapeFromMeta(draft: ShapedDraftCache["draft"]): DraftShape {
  const rr = Number(draft.settings.reversal_round ?? 0);
  return { type: draft.draftType, reversalRound: Number.isFinite(rr) && rr > 0 ? rr : 0 };
}

/**
 * Whether a round's seat order is reversed.
 *  - linear: never reversed (every round left-to-right).
 *  - snake (no reversal round): even rounds reversed.
 *  - third-round reversal (reversalRound = R): normal snake for rounds < R, then
 *    the order that would flip at R stays (R repeats R-1's direction), alternating
 *    after. e.g. R=3 -> R1 fwd, R2 rev, R3 rev, R4 fwd, R5 rev.
 */
export function isReversedRound(round: number, shape: DraftShape): boolean {
  if (shape.type === "linear" || shape.type === "auction") return false;
  const rr = shape.reversalRound;
  if (rr > 0 && round >= rr) return (round - rr) % 2 === 0;
  return round % 2 === 0;
}

/** The draft seat (1..teams) for an overall pick number, given the shape. */
export function seatForPick(pickNo: number, teams: number, shape: DraftShape = DEFAULT_SHAPE): number {
  if (teams <= 0 || pickNo <= 0) return 0;
  const round = Math.ceil(pickNo / teams);
  const indexInRound = ((pickNo - 1) % teams) + 1;
  return isReversedRound(round, shape) ? teams - indexInRound + 1 : indexInRound;
}

/** The overall pick number for a (round, seat), given the shape. Inverse of seatForPick. */
export function pickNoForSeat(round: number, seat: number, teams: number, shape: DraftShape = DEFAULT_SHAPE): number {
  if (teams <= 0) return 0;
  const base = (round - 1) * teams;
  return isReversedRound(round, shape) ? base + (teams - seat + 1) : base + seat;
}

export interface DerivedDraftState {
  /** Overall pick number on the clock (0 when the draft is complete/unknown). */
  onTheClockPickNo: number;
  /** Seat (1..teams) on the clock, 0 when unknown/complete. */
  onTheClockSlot: number;
  /** Round of the on-the-clock pick, 0 when unknown. */
  onTheClockRound: number;
  /** Pick within the round (1..teams), 0 when unknown. */
  onTheClockPickInRound: number;
  /** The most recent pick made, or null. */
  lastPick: ShapedPick | null;
  /** The connected user's roster_id, or null when undetected. */
  myRosterId: number | null;
  /** The connected user's seat (1..teams), 0 when undetected. */
  mySlot: number;
  /** True once every seat in every round has a pick (or status is complete). */
  complete: boolean;
}

/**
 * Derive room state from the shaped cache. `myUserId` is the connected Sleeper
 * user id (from the leagues route); pass null/empty when unknown, in which case
 * myRosterId/mySlot come back null/0 and the room shows the undetected experience.
 */
export function deriveDraftState(
  cache: ShapedDraftCache,
  myUserId: string | null,
): DerivedDraftState {
  const teams = Number(cache.draft.settings.teams ?? 0);
  const rounds = Number(cache.draft.settings.rounds ?? 0);
  const totalPicks = teams > 0 && rounds > 0 ? teams * rounds : 0;

  let maxPickNo = 0;
  let lastPick: ShapedPick | null = null;
  for (const p of cache.picks) {
    if (p.pickNo > maxPickNo) {
      maxPickNo = p.pickNo;
      lastPick = p;
    }
  }

  const nextPickNo = maxPickNo + 1;
  const complete =
    cache.draft.draftStatus === "complete" ||
    (totalPicks > 0 && nextPickNo > totalPicks);

  const onTheClockPickNo = complete ? 0 : nextPickNo;
  const shape = draftShapeFromMeta(cache.draft);
  const onTheClockSlot = teams > 0 ? seatForPick(onTheClockPickNo, teams, shape) : 0;
  const onTheClockRound =
    teams > 0 && onTheClockPickNo > 0 ? Math.ceil(onTheClockPickNo / teams) : 0;
  const onTheClockPickInRound =
    teams > 0 && onTheClockPickNo > 0 ? ((onTheClockPickNo - 1) % teams) + 1 : 0;

  // My team: a roster the connected user owns or co-owns.
  let myRosterId: number | null = null;
  if (myUserId) {
    const mine = cache.rosters.find(
      (r) => r.ownerId === myUserId || r.coOwners.includes(myUserId),
    );
    if (mine) myRosterId = mine.rosterId;
  }

  // My seat: the slot whose roster_id is mine.
  let mySlot = 0;
  if (myRosterId !== null) {
    for (const [slot, rosterId] of Object.entries(cache.draft.slotToRosterId)) {
      if (rosterId === myRosterId) {
        const n = Number(slot);
        if (Number.isFinite(n)) mySlot = n;
        break;
      }
    }
  }

  return {
    onTheClockPickNo,
    onTheClockSlot,
    onTheClockRound,
    onTheClockPickInRound,
    lastPick,
    myRosterId,
    mySlot,
    complete,
  };
}

/** Display name for a seat, resolving roster -> owner -> user when possible. */
export function teamNameForSeat(cache: ShapedDraftCache, seat: number): string {
  const rosterId = cache.draft.slotToRosterId[String(seat)];
  if (rosterId !== undefined) {
    const roster = cache.rosters.find((r) => r.rosterId === rosterId);
    if (roster?.ownerId) {
      const user = cache.users.find((u) => u.userId === roster.ownerId);
      if (user?.displayName) return user.displayName;
    }
  }
  return `Team ${seat}`;
}

/**
 * Display name for a roster id, resolving roster -> owner -> user when possible.
 * Used for the trade-aware "on the clock" label: a traded pick's current owner is
 * a roster id, not a draft seat, so we resolve the name from the roster directly
 * rather than from the seat -> roster map (which always points at the seat's
 * original owner).
 */
export function teamNameForRoster(cache: ShapedDraftCache, rosterId: number): string {
  const roster = cache.rosters.find((r) => r.rosterId === rosterId);
  if (roster?.ownerId) {
    const user = cache.users.find((u) => u.userId === roster.ownerId);
    if (user?.displayName) return user.displayName;
  }
  return `Team ${rosterId}`;
}

/** Plain label for the most recent pick. */
export function lastPickLabel(pick: ShapedPick | null): string {
  if (!pick) return "None yet";
  const name = `${pick.firstName ?? ""} ${pick.lastName ?? ""}`.trim() || "Unknown player";
  return pick.position ? `${name} (${pick.position})` : name;
}

// ---------------------------------------------------------------------------
// Sync status copy (relative, zone-independent)
// ---------------------------------------------------------------------------

/**
 * Relative "N seconds/minutes/hours ago" from an ISO timestamp. Zone-independent
 * (no calendar formatting), so it needs no America/New_York handling. Returns
 * null when the input is absent/unparseable.
 */
export function relativeTime(fromIso: string | null, nowMs: number): string | null {
  if (!fromIso) return null;
  const then = Date.parse(fromIso);
  if (!Number.isFinite(then)) return null;
  const secs = Math.max(0, Math.round((nowMs - then) / 1000));
  if (secs < 5) return "just now";
  if (secs < 60) return `${secs} seconds ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} ${mins === 1 ? "minute" : "minutes"} ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} ${hrs === 1 ? "hour" : "hours"} ago`;
  const days = Math.round(hrs / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

/** "Last synced 18 seconds ago" / "Not synced yet". */
export function formatLastSynced(lastSyncedAt: string | null, nowMs: number): string {
  const rel = relativeTime(lastSyncedAt, nowMs);
  return rel ? `Last synced ${rel}` : "Not synced yet";
}

/**
 * The status line under the Sync button, derived from the sync outcome. `error`
 * is the route-supplied, user-safe message on the error path.
 */
export function syncStatusLine(
  status: SyncStatus,
  opts: {
    lastSyncedAt: string | null;
    cooldownRemainingSeconds: number;
    nowMs: number;
    error?: string;
  },
): string {
  const rel = relativeTime(opts.lastSyncedAt, opts.nowMs);
  switch (status) {
    case "synced":
      return "Updated just now.";
    case "synced-by-other":
      return rel ? `Synced by another viewer ${rel}.` : "Synced by another viewer.";
    case "cooldown": {
      const remain = Math.max(0, Math.round(opts.cooldownRemainingSeconds));
      const base = rel ? `Last synced ${rel}.` : "Synced recently.";
      return remain > 0 ? `${base} Next sync available in ${remain} seconds.` : base;
    }
    case "served-cache":
      return rel ? `Showing the draft as of ${rel}.` : "Showing the latest synced draft.";
    case "error":
      return opts.error || "Sync failed. Try again shortly.";
    default:
      return rel ? `Last synced ${rel}.` : "Not synced yet.";
  }
}

/**
 * Whether two shaped caches describe the same draft in the same state, ignoring
 * the sync stamp.
 *
 * An open room now refreshes itself every minute, and most of those refreshes
 * bring back a cache identical to the one already on screen apart from
 * `lastSyncedAt`. Handing that to setState would hand every array in the room a
 * new identity, and the memos downstream would rebuild the available board, the
 * ADP simulation, the roster rollups and the recommendation for a draft that did
 * not move. This is the test that stops that.
 *
 * The cheap scalars come first and settle the common case, a pick landing, in a
 * few comparisons. Only a draft that looks unchanged pays for the structural
 * check, which is still an order of magnitude cheaper than the rebuild it avoids,
 * and it has to be structural: a trade moves players between rosters and rewrites
 * traded picks without touching a single count.
 */
export function sameDraftCacheContent(a: ShapedDraftCache, b: ShapedDraftCache): boolean {
  if (a.draft.sleeperDraftId !== b.draft.sleeperDraftId) return false;
  if (a.draft.pickCount !== b.draft.pickCount) return false;
  if (a.draft.draftStatus !== b.draft.draftStatus) return false;
  if (a.draft.draftType !== b.draft.draftType) return false;
  if (a.draft.playoffTeams !== b.draft.playoffTeams) return false;
  if (a.draft.playoffWeekStart !== b.draft.playoffWeekStart) return false;
  if (a.picks.length !== b.picks.length) return false;
  if (a.users.length !== b.users.length) return false;
  if (a.rosters.length !== b.rosters.length) return false;
  if (a.tradedPicks.length !== b.tradedPicks.length) return false;
  return (
    JSON.stringify(a.picks) === JSON.stringify(b.picks) &&
    JSON.stringify(a.rosters) === JSON.stringify(b.rosters) &&
    JSON.stringify(a.users) === JSON.stringify(b.users) &&
    JSON.stringify(a.tradedPicks) === JSON.stringify(b.tradedPicks) &&
    JSON.stringify(a.draft.settings) === JSON.stringify(b.draft.settings) &&
    JSON.stringify(a.draft.slotToRosterId) === JSON.stringify(b.draft.slotToRosterId) &&
    JSON.stringify(a.draft.scoringSettings) === JSON.stringify(b.draft.scoringSettings) &&
    JSON.stringify(a.draft.rosterPositions) === JSON.stringify(b.draft.rosterPositions)
  );
}
