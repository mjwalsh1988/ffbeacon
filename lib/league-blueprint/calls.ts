/**
 * Buy, sell, hold (plan 6.7). Pure.
 *
 * The ROSTER decides first and the market signal only strengthens or weakens
 * that decision (decision 3.6): a market signal alone never produces a call.
 * Starters are Sleeper's ACTUAL lineup, not the value-greedy fill the power
 * rankings cache stores. Defenders and specialists get no call at all; the
 * caller leaves them out and the page prints "No market value".
 *
 * Buys are not the reader's players. They are positions of need with named
 * targets on OTHER rosters (decision 18.4), each carrying a proposal into the
 * trade builder with the target incoming and nothing outgoing, so the builder
 * re-derives ownership the way every Trade Ideas link does.
 */

import { DYNASTY_KEEP_VALUE } from "@/lib/league-lineups/advice";
import { dropCandidateIds } from "@/lib/roster-badges";
import { acquirablePool } from "@/lib/trade-finder/packages";
import type { TeamProfile } from "@/lib/trade-finder/profile";
import type { TeamDirection } from "@/lib/trade-finder/types";
import type { LeagueBlueprintSettings } from "./default-settings";
import { BLUEPRINT_POSITIONS, type BlueprintPosition } from "./default-settings";
import type { BuyGroup, CallStrength, MarketSignalState, PlayerCall, RosterCall } from "./types";

export type CallPlayer = {
  id: string;
  position: BlueprintPosition;
  value: number;
  isStarter: boolean;
  /** Decimal years. */
  age: number | null;
  /** Whole seasons played. */
  yearsExperience: number | null;
  positionRank: number | null;
  inSurplus: boolean;
  signal: MarketSignalState | null;
};

export const NOTE_HARD_SELL = "Value is at the top of his own market band.";
export const NOTE_SELL_HIGH = "Aging and priced high: a sell-high window.";
export const NOTE_KEEP = "Priced high right now; this is still a keep.";
export const NOTE_HOLD_LOW = "Priced low against his own market band: do not sell now.";

function marketLean(signal: MarketSignalState | null): "buy" | "sell" | null {
  if (signal === "sell" || signal === "watch_sell") return "sell";
  if (signal === "buy" || signal === "watch_buy") return "buy";
  return null;
}

export function computeCalls(
  players: readonly CallPlayer[],
  opts: {
    direction: TeamDirection;
    isDynasty: boolean;
    ageCutoff: LeagueBlueprintSettings["calls"]["ageCutoff"];
  },
): Record<string, PlayerCall> {
  const drops = dropCandidateIds(
    players.map((p) => ({
      id: p.id,
      value: p.value,
      isStarter: p.isStarter,
      age: p.age === null ? null : Math.floor(p.age),
      yearsExperience: p.yearsExperience,
      positionRank: p.positionRank,
    })),
    { isDynasty: opts.isDynasty },
  );
  const top3 = new Set(
    [...players]
      .sort((a, b) => b.value - a.value || a.id.localeCompare(b.id))
      .slice(0, 3)
      .map((p) => p.id),
  );

  const out: Record<string, PlayerCall> = {};
  for (const p of players) {
    const cutoff = opts.ageCutoff[p.position];
    const old = p.age !== null && p.age >= cutoff;
    let roster: RosterCall;
    if (!p.isStarter && drops.has(p.id) && (!opts.isDynasty || p.value < DYNASTY_KEEP_VALUE)) {
      roster = "cut";
    } else if (
      // A rebuilder never sells youth for being surplus: an under-cutoff
      // player is exactly what a rebuild is holding for.
      (p.inSurplus && (opts.direction !== "rebuild" || old)) ||
      (opts.direction === "rebuild" && old && p.value >= DYNASTY_KEEP_VALUE)
    ) {
      roster = "sell";
    } else if (p.isStarter && top3.has(p.id) && (opts.direction !== "rebuild" || !old)) {
      roster = "build";
    } else {
      roster = "hold";
    }

    const lean = marketLean(p.signal);
    let call: PlayerCall;
    if (roster === "sell") {
      call = lean === "sell"
        ? { call: "sell", strength: "hard", note: NOTE_HARD_SELL }
        : { call: "sell", strength: "soft", note: null };
    } else if (roster === "hold" && lean === "sell" && old) {
      call = { call: "sell", strength: "soft", note: NOTE_SELL_HIGH };
    } else if (roster === "build") {
      call = { call: "build", strength: null, note: lean === "sell" ? NOTE_KEEP : null };
    } else if (roster === "cut") {
      call = { call: "cut", strength: null, note: null };
    } else if (lean === "buy") {
      call = { call: "hold", strength: null, note: NOTE_HOLD_LOW };
    } else {
      call = { call: "hold", strength: null, note: null };
    }
    out[p.id] = call;
  }
  return out;
}

/** The visible words of a call: "Hard sell", "Sell", "Build around", ... */
export function callLabel(call: PlayerCall): string {
  if (call.call === "sell") return call.strength === "hard" ? "Hard sell" : "Sell";
  if (call.call === "build") return "Build around";
  if (call.call === "cut") return "Cut candidate";
  return "Hold";
}

export type BuyTargetInput = {
  mine: TeamProfile;
  others: TeamProfile[];
  signals: ReadonlyMap<string, MarketSignalState>;
  myRosterId: number;
  settings: LeagueBlueprintSettings["calls"];
};

/**
 * Positions of need, most need first, with the best targets for each on other
 * rosters. Candidates come from the trade finder's own acquirablePool, so a
 * target is a player his owner can plausibly part with, never IR or taxi.
 */
export function computeBuyTargets(input: BuyTargetInput): BuyGroup[] {
  const { mine, others, signals, settings } = input;
  const needs = BLUEPRINT_POSITIONS.map((p) => ({ position: p, need: mine.positionNeed[p] ?? 0 }))
    .filter((n) => n.need >= settings.needMinPoints)
    .sort((a, b) => b.need - a.need || a.position.localeCompare(b.position))
    .slice(0, settings.maxNeedPositions);

  const bestSurplus = mine.surplus.reduce((m, p) => (p.hasValue && p.value > m ? p.value : m), 0);
  const low = bestSurplus > 0 ? bestSurplus * settings.targetValueLow : 0;
  const high = bestSurplus > 0 ? bestSurplus * settings.targetValueHigh : Infinity;

  const groups: BuyGroup[] = [];
  for (const { position, need } of needs) {
    const candidates: Array<{
      playerId: string;
      rosterId: number;
      ownerHandle: string | null;
      ownerTeamName: string;
      projPoints: number;
      lean: "buy" | "sell" | null;
      strength: CallStrength;
    }> = [];
    for (const theirs of others) {
      if (theirs.team.rosterId === input.myRosterId) continue;
      const pool = acquirablePool(theirs, mine, {
        goal: "balanced",
        targetPlayerIds: [],
        allowPicks: false,
        positions: new Set([position]),
      });
      for (const ref of pool) {
        if (ref.kind !== "player") continue;
        const pl = ref.player;
        if (pl.isInactive || !pl.hasValue || pl.value < low || pl.value > high) continue;
        const signal = signals.get(pl.playerId) ?? null;
        const lean = marketLean(signal);
        candidates.push({
          playerId: pl.playerId,
          rosterId: theirs.team.rosterId,
          ownerHandle: theirs.team.ownerHandle,
          ownerTeamName: theirs.team.teamName,
          projPoints: pl.projPoints ?? 0,
          lean,
          strength: lean === "buy" ? "hard" : "soft",
        });
      }
    }
    candidates.sort(
      (a, b) =>
        Number(b.lean === "buy") - Number(a.lean === "buy") ||
        b.projPoints - a.projPoints ||
        a.playerId.localeCompare(b.playerId),
    );
    groups.push({
      position,
      need: Math.round(need * 10) / 10,
      targets: candidates.slice(0, settings.targetsPerPosition).map((c) => ({
        playerId: c.playerId,
        rosterId: c.rosterId,
        ownerHandle: c.ownerHandle,
        ownerTeamName: c.ownerTeamName,
        strength: c.strength,
        proposal: {
          myRosterId: input.myRosterId,
          theirRosterId: c.rosterId,
          incoming: [{ kind: "player", playerId: c.playerId }],
          outgoing: [],
        },
      })),
    });
  }
  return groups;
}
