/**
 * Turning draft-room assets into a Signal Check trade.
 *
 * The room's own value check totals both sides off the board, which is instant
 * and useful and is NOT a Signal Check grade. Signal Check applies the whole
 * ruleset: post-format calibration, the consolidation and value-adjustment pass,
 * the neutral and blowout thresholds, confidence, and the written explanation. A
 * trade a user is about to make in a draft deserves that, and getting it means
 * handing Signal Check the same shape of input any other trade would arrive as.
 *
 * So every draft-room asset resolves to a real Signal Check asset:
 *
 *   a made pick        the player who was actually taken there
 *   an unmade pick     the player the market would take there, from the ADP
 *                      simulation (adp-sim.ts), flagged as simulated
 *   an available player himself
 *   a future-year pick a pick asset, priced from FF Beacon's published pick
 *                      values, because a 2028 first has no ADP to simulate
 *                      against and inventing one would be fabrication
 *
 * Pure and browser-safe. The resolution runs on the client so the dialog can
 * show what a slot resolves to before anything is submitted; the server then
 * re-resolves nothing and simply prices the asset references it is given, with
 * the format read from the cached league rather than from the request.
 */

import type { RankedPlayer } from "./board-types";
import type { CurrentDraftPick } from "./pick-ownership";
import type { SimulatedPick } from "./adp-sim";
import { substituteStartupPick } from "@/lib/startup-draft";

/** Which side of the trade an asset sits on. */
export type TradeSideId = "a" | "b";

/** A draft-room asset before it becomes a Signal Check asset. */
export type DraftAssetRef =
  | { kind: "player"; playerId: string }
  | { kind: "current-pick"; overall: number }
  | {
      kind: "future-pick";
      season: number;
      round: number;
      bucket: "early" | "mid" | "late";
      /**
       * The roster the pick originally belonged to, when this is a CONCRETE
       * traded pick rather than a generic bucket. It identifies and labels the
       * asset ("2027 1st via Mike"); it never changes the price, because a
       * traded pick is still worth the round's mid bucket until that draft
       * orders itself. Absent for the generic buckets, which is what makes them
       * repeatable.
       */
      originalRosterId?: number;
    };

/** What a draft-room asset resolves to, with everything the UI needs to show it. */
export interface ResolvedAsset {
  ref: DraftAssetRef;
  /** Stable id for React keys and for de-duplication within a trade. */
  id: string;
  /** Primary label, e.g. "1.04, Ja'Marr Chase" or "2027 1st (Early)". */
  label: string;
  /** Secondary line: who owns it, or how the player was derived. */
  detail: string;
  /** The Signal Check asset this becomes. Null when it cannot be resolved. */
  signalCheck:
    | { kind: "player"; playerId: string }
    | { kind: "pick"; season: number; round: number; pickPosition: "early" | "mid" | "late" }
    | null;
  /** Board value, for the instant totals strip. */
  value: number;
  /**
   * True when the player behind this asset came from the ADP simulation rather
   * than from an actual selection. The report says so, per asset.
   */
  simulated: boolean;
  /** The roster that currently owns it, for the "which side" dialog. */
  ownerRosterId: number | null;
  /** Generic future buckets can appear more than once in one trade. */
  repeatable: boolean;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function ordinal(round: number): string {
  if (round === 1) return "1st";
  if (round === 2) return "2nd";
  if (round === 3) return "3rd";
  return `${round}th`;
}

function cap(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

export interface ResolveContext {
  /** Every pick in the current draft, made and unmade, with ownership. */
  currentPicks: CurrentDraftPick[];
  /** The ADP simulation for the unmade picks. */
  simulated: Map<number, SimulatedPick>;
  /** FULL board, for valuing made picks and available players. */
  valueBoard: RankedPlayer[];
  /** FF Beacon published pick values for future buckets. */
  pickValueFor: (season: number, round: number, bucket: "early" | "mid" | "late") => number | null;
  /** roster_id to display name. */
  teamNameByRosterId: Record<number, string>;
  myRosterId: number | null;
}

function ownerLabel(rosterId: number | null, ctx: ResolveContext): string {
  if (rosterId === null) return "owner unknown";
  if (ctx.myRosterId !== null && rosterId === ctx.myRosterId) return "your pick";
  return ctx.teamNameByRosterId[rosterId] ?? `Team ${rosterId}`;
}

/** Plain team name, with no "your pick" substitution. Used for "originally X". */
function teamLabel(rosterId: number | null, ctx: ResolveContext): string {
  if (rosterId === null) return "an unknown team";
  if (ctx.myRosterId !== null && rosterId === ctx.myRosterId) return "yours";
  return ctx.teamNameByRosterId[rosterId] ?? `Team ${rosterId}`;
}

/**
 * Resolve one draft-room asset. Returns null when the asset does not exist in
 * this draft (a stale click after a resync, a bucket the format does not
 * publish), so the caller can drop it rather than send a phantom to the server.
 */
export function resolveDraftAsset(ref: DraftAssetRef, ctx: ResolveContext): ResolvedAsset | null {
  if (ref.kind === "player") {
    const player = ctx.valueBoard.find((p) => p.playerId === ref.playerId);
    if (!player) return null;
    return {
      ref,
      id: `pl-${player.playerId}`,
      label: `${player.name}, ${player.position}`,
      detail: player.team ? `${player.team}, value ${Math.round(player.value).toLocaleString()}` : `value ${Math.round(player.value).toLocaleString()}`,
      signalCheck: { kind: "player", playerId: player.playerId },
      value: Math.round(player.value),
      simulated: false,
      ownerRosterId: null,
      repeatable: false,
    };
  }

  if (ref.kind === "future-pick") {
    const value = ctx.pickValueFor(ref.season, ref.round, ref.bucket);
    if (value === null) return null;
    // A CONCRETE traded pick carries the roster it came from, so it gets that
    // team's name and its own id (one specific pick, placeable once). A generic
    // bucket has no origin, so it stays generic and repeatable.
    const concrete = typeof ref.originalRosterId === "number";
    return {
      ref,
      id: concrete
        ? `tfut-${ref.season}-${ref.round}-${ref.originalRosterId}`
        : `fut-${ref.season}-${ref.round}-${ref.bucket}`,
      label: concrete
        ? `${ref.season} ${ordinal(ref.round)}, originally ${teamLabel(ref.originalRosterId ?? null, ctx)}`
        : `${ref.season} ${ordinal(ref.round)} (${cap(ref.bucket)})`,
      // A future pick goes to Signal Check as a PICK, not as a simulated player.
      // There is no ADP for a class that has not been scouted, so naming a player
      // would be inventing one.
      detail: "FF Beacon pick value",
      signalCheck: {
        kind: "pick",
        season: ref.season,
        round: ref.round,
        pickPosition: ref.bucket,
      },
      value: Math.round(value),
      simulated: false,
      ownerRosterId: null,
      repeatable: !concrete,
    };
  }

  const pick = ctx.currentPicks.find((p) => p.overall === ref.overall);
  if (!pick) return null;
  const slotLabel = `${pick.round}.${pad2(pick.pickInRound)}`;

  const made = pick.made ? pick.madePick : null;
  const projected = pick.made ? null : (ctx.simulated.get(pick.overall) ?? null);

  // The player behind a made pick, looked up on the board by either id. A pick
  // whose player is not on the board resolves to nothing rather than to a price.
  const boardPlayer = made
    ? ((made.playerId ? ctx.valueBoard.find((p) => p.playerId === made.playerId) : undefined) ??
      (made.sleeperPlayerId
        ? ctx.valueBoard.find((p) => p.sleeperId === made.sleeperPlayerId)
        : undefined) ??
      null)
    : null;

  // THE DECISION IS NOT MADE HERE. substituteStartupPick in lib/startup-draft.ts
  // holds the one copy of "a made pick IS the player taken, an unmade pick is the
  // player the market would take there", because League Pulse now has to reach the
  // same answer for startup trades in its feed. The labels below are still this
  // room's own; only the judgement is shared.
  const substitution = substituteStartupPick({
    // The room only ever asks about seats that exist in this draft.
    seatKnown: true,
    used: made !== null,
    usedPlayerId: boardPlayer?.playerId ?? null,
    simulatedPlayerId: projected?.player.playerId ?? null,
  });
  const resolved = substitution.kind === "player" ? substitution : null;

  if (made) {
    const name = `${made.firstName ?? ""} ${made.lastName ?? ""}`.trim() || "Unknown player";
    return {
      ref,
      id: `made-${pick.overall}`,
      label: `${slotLabel}, ${name}`,
      detail: `Already drafted${made.position ? `, ${made.position}` : ""}, ${ownerLabel(pick.currentOwnerRosterId, ctx)}`,
      signalCheck: resolved ? { kind: "player", playerId: resolved.playerId } : null,
      value: boardPlayer ? Math.round(boardPlayer.value) : 0,
      simulated: false,
      ownerRosterId: pick.currentOwnerRosterId,
      repeatable: false,
    };
  }

  if (!projected || !resolved) {
    return {
      ref,
      id: `up-${pick.overall}`,
      label: `${slotLabel}, not yet made`,
      detail: `The board runs out before this pick, ${ownerLabel(pick.currentOwnerRosterId, ctx)}`,
      signalCheck: null,
      value: 0,
      simulated: true,
      ownerRosterId: pick.currentOwnerRosterId,
      repeatable: false,
    };
  }

  return {
    ref,
    id: `up-${pick.overall}`,
    label: `${slotLabel}, ${projected.player.name}`,
    detail: `${projected.adpKnown ? "Projected by Sleeper ADP" : "Projected by FF Beacon rank, no ADP for this player"}, ${projected.player.position}, ${ownerLabel(pick.currentOwnerRosterId, ctx)}`,
    signalCheck: { kind: "player", playerId: resolved.playerId },
    value: Math.round(projected.player.value),
    simulated: true,
    ownerRosterId: pick.currentOwnerRosterId,
    repeatable: false,
  };
}

/** Resolve a whole side, dropping anything that no longer exists. */
export function resolveSide(refs: DraftAssetRef[], ctx: ResolveContext): ResolvedAsset[] {
  return refs
    .map((ref) => resolveDraftAsset(ref, ctx))
    .filter((a): a is ResolvedAsset => a !== null);
}

/**
 * The Signal Check input for a resolved side. Assets that could not be resolved
 * to a real player or pick are dropped, and the caller reports how many, because
 * silently analyzing four of five assets would produce a confident wrong answer.
 */
export function toSignalCheckAssets(
  assets: ResolvedAsset[],
): { assets: NonNullable<ResolvedAsset["signalCheck"]>[]; dropped: number } {
  const out: NonNullable<ResolvedAsset["signalCheck"]>[] = [];
  let dropped = 0;
  for (const a of assets) {
    if (a.signalCheck) out.push(a.signalCheck);
    else dropped += 1;
  }
  return { assets: out, dropped };
}
