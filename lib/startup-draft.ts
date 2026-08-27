/**
 * Startup drafts, and what a startup draft pick is actually worth.
 *
 * THE BUG THIS EXISTS TO FIX
 * A dynasty league's FIRST draft is a startup: every NFL player is on the board,
 * it runs twenty-odd rounds, and the 1.01 is a top-five dynasty asset. A dynasty
 * league's LATER drafts are rookie drafts: three to five rounds, first-year
 * players only, and the 1.01 is a rookie.
 *
 * `draft_pick_values` only ever holds ROOKIE pick values, and only rounds 1
 * through 4. League Pulse priced every traded pick out of that table, so a
 * startup pick got one of two wrong answers:
 *
 *   rounds 1-4    priced as a rookie pick. In one real 12-team startup, every
 *                 2026 first priced at 4,791 to 6,358 while the twelve players
 *                 actually taken at those seats were worth 6,757 to 10,000.
 *   rounds 5+     no row exists at all, so the pick priced at nothing. A real
 *                 four-pick trade of 2026 rounds 12, 13, 14 and 21 was graded
 *                 as a trade of four worthless assets.
 *
 * THE FIX, AND WHY IT IS SHAPED THIS WAY
 * On The Clock already solved this for the live draft room: a made pick IS the
 * player taken, and an unmade pick is the player the ADP simulation expects
 * there. That rule is correct and it is the one League Pulse needs. Rather than
 * write a second copy of it, the DECISION lives here and both callers ask this
 * module. On The Clock keeps its own live `CurrentDraftPick[]` and League Pulse
 * keeps its own stored `draft_selections` rows, because those inputs genuinely
 * differ; what must never diverge is the judgement made from them.
 *
 * CLASSIFY ON THE PICK, NOT ON THE CLOCK.
 * The obvious rule, "was this trade made during the draft window", is wrong. Of
 * the three real mis-priced trades found in production, one was agreed nine days
 * BEFORE the draft opened, one landed six minutes AFTER the first pick, and one
 * came days AFTER the draft finished (trading picks that had already been used).
 * All three are mis-priced identically, because what makes a pick a startup pick
 * is which draft it belongs to, not when the trade happened. The draft window is
 * still computed here, but only as a label a reader sees; it never decides a
 * valuation.
 *
 * Pure and deterministic. NOTHING here touches Sleeper, Supabase, or fetch. The
 * I/O half lives in lib/league-startup-picks.ts.
 */

import { inferPlayerPool, pickNoForSeat, type DraftShape } from "@/lib/on-the-clock/draft-derive";

// ---------------------------------------------------------------------------
// Pool classification
// ---------------------------------------------------------------------------

/** Which player pool a draft ran against. */
export type DraftPoolKind = "startup" | "rookie";

/**
 * Classify a draft's pool.
 *
 * DYNASTY IS THE FIRST GATE, and it is not optional. `inferPlayerPool` answers
 * "which players belong on the draft board", so it returns "everyone" for a
 * redraft league too, and every redraft draft would classify as a startup if
 * that answer were read directly. It is a different question from "is this a
 * startup draft", and conflating the two would push pick substitution onto
 * leagues that have no dynasty picks at all. A redraft league classifies as
 * "rookie" here, which is the branch that leaves valuation completely untouched.
 *
 * Within dynasty, two sources, best first:
 *
 *   1. CAPTURED EVIDENCE. `draft_selections.player_pool` was resolved at capture
 *      time from the league object we held, and it is stored on every pick of
 *      every completed draft we have ingested. "everyone" means a startup.
 *   2. THE ROUND COUNT. `inferPlayerPool` in lib/on-the-clock/draft-derive.ts,
 *      shared rather than reimplemented: dynasty plus more than
 *      ROOKIE_DRAFT_MAX_ROUNDS rounds is a startup.
 */
export function classifyDraftPool(params: {
  formatSlug: string | null | undefined;
  rounds: number;
  /** draft_selections.player_pool, when this draft's picks have been captured. */
  capturedPool?: string | null;
}): DraftPoolKind {
  const isDynasty = (params.formatSlug ?? "").toLowerCase().startsWith("dynasty");
  if (!isDynasty) return "rookie";
  if (params.capturedPool === "everyone") return "startup";
  if (params.capturedPool === "rookies") return "rookie";
  return inferPlayerPool({ formatSlug: params.formatSlug, rounds: params.rounds }) === "everyone"
    ? "startup"
    : "rookie";
}

// ---------------------------------------------------------------------------
// The substitution rule (shared with On The Clock)
// ---------------------------------------------------------------------------

/** Why a startup pick could not be turned into a player. */
export type StartupUnresolvedReason =
  /** The originating roster holds no seat in this draft, so there is no slot to read. */
  | "no-seat"
  /** The seat was used, but we hold no player for it (picks not captured, or unmapped). */
  | "not-captured"
  /** The seat is unused and the simulation had nobody left to put there. */
  | "board-exhausted";

/** What a startup-draft pick becomes for valuation. */
export type StartupPickSubstitution =
  | {
      kind: "player";
      playerId: string;
      /** True when the player came from the ADP simulation rather than a real selection. */
      simulated: boolean;
    }
  | { kind: "unresolved"; reason: StartupUnresolvedReason };

/**
 * The one copy of the rule.
 *
 * A used seat IS the player taken there, and that is not an approximation, so it
 * is never flagged simulated. An unused seat is the player the market would take
 * there, which IS an approximation and is always flagged. Anything else resolves
 * to nothing, with a reason, because a startup pick priced off the rookie table
 * is exactly the bug this module exists to remove: falling back to it silently
 * would reintroduce that bug behind a new name.
 */
export function substituteStartupPick(input: {
  /** False when the originating roster has no seat in this draft. */
  seatKnown: boolean;
  /** True when the seat has already been drafted. */
  used: boolean;
  /** The player taken at the seat. Null when unmapped or not captured. */
  usedPlayerId: string | null;
  /** The player the ADP simulation expects at the seat. Null when unavailable. */
  simulatedPlayerId: string | null;
}): StartupPickSubstitution {
  if (!input.seatKnown) return { kind: "unresolved", reason: "no-seat" };
  if (input.used) {
    return input.usedPlayerId
      ? { kind: "player", playerId: input.usedPlayerId, simulated: false }
      : { kind: "unresolved", reason: "not-captured" };
  }
  return input.simulatedPlayerId
    ? { kind: "player", playerId: input.simulatedPlayerId, simulated: true }
    : { kind: "unresolved", reason: "board-exhausted" };
}

/** Reader-facing sentence for an unresolved startup pick. Never blames the user. */
export function describeUnresolved(reason: StartupUnresolvedReason): string {
  if (reason === "no-seat") return "Draft seat unknown, so this pick is not priced";
  if (reason === "not-captured") return "Startup pick, selection not loaded yet";
  return "Startup pick, the board runs out before this seat";
}

// ---------------------------------------------------------------------------
// Seat maths
// ---------------------------------------------------------------------------

/**
 * The overall pick number a (round, roster) lands on in a startup draft.
 *
 * The seat comes from Sleeper's published slot_to_roster_id, and the serpentine
 * maths is `pickNoForSeat` from lib/on-the-clock/draft-derive.ts, shared rather
 * than reimplemented so snake, linear, and third-round-reversal drafts all land
 * on the same answer the draft room gives. Null when the roster holds no seat.
 *
 * The seat is bounded against `teams` rather than trusted. If a league expanded
 * and the stored `settings.teams` is behind the seat map, a seat above the team
 * count silently rolls into the NEXT round's pick numbers, which resolves to a
 * real player at the wrong slot. Returning null there sends the pick back to the
 * existing valuation instead.
 */
export function startupPickNoFor(params: {
  round: number;
  originalRosterId: number;
  rosterToSeat: ReadonlyMap<number, number>;
  teams: number;
  shape: DraftShape;
}): { seat: number; pickNo: number } | null {
  const { round, originalRosterId, rosterToSeat, teams, shape } = params;
  if (!Number.isFinite(round) || round < 1) return null;
  if (teams <= 0) return null;
  const seat = rosterToSeat.get(originalRosterId);
  if (seat === undefined) return null;
  if (seat < 1 || seat > teams) return null;
  const pickNo = pickNoForSeat(round, seat, teams, shape);
  if (pickNo <= 0) return null;
  return { seat, pickNo };
}

/** "1.04" style label for a seat in a round. */
export function slotLabel(round: number, seat: number): string {
  return `${round}.${String(seat).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Timing (a label, never a valuation input)
// ---------------------------------------------------------------------------

/** When a trade happened relative to the startup draft it traded picks in. */
export type StartupTradeTiming = "before-draft" | "during-draft" | "after-draft" | "unknown";

/**
 * Place a trade against the draft window.
 *
 * Sleeper's draft object carries `start_time` and `last_picked` as epoch
 * milliseconds, both preserved verbatim in league_drafts.metadata, so the window
 * costs no extra request. A missing timestamp yields "unknown" rather than a
 * guess: this label is shown to a reader, and an invented one would be worse
 * than none.
 */
export function classifyTradeTiming(params: {
  createdAtMs: number | null;
  startedAtMs: number | null;
  lastPickedAtMs: number | null;
}): StartupTradeTiming {
  const { createdAtMs, startedAtMs, lastPickedAtMs } = params;
  if (createdAtMs === null || !Number.isFinite(createdAtMs)) return "unknown";
  if (startedAtMs === null || !Number.isFinite(startedAtMs)) return "unknown";
  if (createdAtMs < startedAtMs) return "before-draft";
  // A draft with no recorded last pick is still open, so anything at or after
  // the start is happening inside it.
  if (lastPickedAtMs === null || !Number.isFinite(lastPickedAtMs)) return "during-draft";
  return createdAtMs <= lastPickedAtMs ? "during-draft" : "after-draft";
}

/** Short chip text for a timing. Null when we cannot say. */
export function describeTiming(timing: StartupTradeTiming): string | null {
  if (timing === "before-draft") return "Agreed before the startup draft";
  if (timing === "during-draft") return "Made during the startup draft";
  if (timing === "after-draft") return "Made after the startup draft";
  return null;
}
