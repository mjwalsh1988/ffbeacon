/**
 * The three things a drafter actually watches for, computed from data the room
 * already holds.
 *
 *   1. A positional run. "Five of the last eight picks were running backs" is
 *      the single most common reason good drafters change plans, and it is
 *      sitting in the pick list already.
 *   2. A tier cliff. The board carries a tier per player and nothing used it
 *      except the reach penalty. "Two receivers left in this tier" is the
 *      difference between taking one now and taking one never.
 *   3. Who will be gone. From the ADP simulation: the players the market is
 *      expected to take before you are back on the clock.
 *
 * All three are announced, not just drawn. A drafter who cannot see the board
 * has to be told a run is happening at the moment it starts, so every alert
 * carries a finished sentence rather than a set of numbers for a component to
 * assemble.
 *
 * Pure and deterministic.
 */

import type { DraftPosition, RankedPlayer } from "./board-types";
import type { ShapedPick } from "./types";

export type DraftAlertKind = "run" | "tier-cliff" | "your-turn";

export interface DraftAlert {
  kind: DraftAlertKind;
  /** Stable identity, so a re-render does not re-announce the same alert. */
  id: string;
  /** The finished sentence, for the panel and the live region alike. */
  message: string;
  /** The position the alert is about, when it is about one. */
  position: DraftPosition | null;
  /** Higher sorts first. */
  severity: number;
}

const POS_PLURAL: Record<DraftPosition, string> = {
  QB: "quarterbacks",
  RB: "running backs",
  WR: "receivers",
  TE: "tight ends",
  K: "kickers",
  DEF: "defenses",
};

const POS_SINGULAR: Record<DraftPosition, string> = {
  QB: "quarterback",
  RB: "running back",
  WR: "receiver",
  TE: "tight end",
  K: "kicker",
  DEF: "defense",
};

function coercePosition(pos: string | null | undefined): DraftPosition | null {
  const p = (pos ?? "").toUpperCase();
  if (p === "QB" || p === "RB" || p === "WR" || p === "TE" || p === "K") return p;
  if (p === "DEF" || p === "DST") return "DEF";
  if (p === "PK") return "K";
  return null;
}

/**
 * A positional run in the last `window` picks. Reports at most one run, the
 * loudest, because two competing "there is a run on X" messages is noise rather
 * than information.
 */
export function detectRun(
  picks: ShapedPick[],
  opts: { window: number; threshold: number },
): DraftAlert | null {
  const recent = picks
    .slice()
    .sort((a, b) => b.pickNo - a.pickNo)
    .slice(0, Math.max(1, opts.window));
  if (recent.length < opts.threshold) return null;

  const counts = new Map<DraftPosition, number>();
  for (const p of recent) {
    const pos = coercePosition(p.position);
    if (!pos) continue;
    counts.set(pos, (counts.get(pos) ?? 0) + 1);
  }

  let winner: DraftPosition | null = null;
  let best = 0;
  for (const [pos, count] of counts) {
    if (count > best || (count === best && winner !== null && pos < winner)) {
      winner = pos;
      best = count;
    }
  }
  if (!winner || best < opts.threshold) return null;

  return {
    kind: "run",
    // The newest pick number is part of the id so the alert re-announces when
    // the run extends, and stays quiet while the same picks sit there.
    id: `run-${winner}-${best}-${recent[0]?.pickNo ?? 0}`,
    message: `Run on ${POS_PLURAL[winner]}: ${best} of the last ${recent.length} picks.`,
    position: winner,
    severity: 2 + best,
  };
}

/**
 * Tier cliffs on the available board. One alert per position whose current top
 * tier is down to `remaining` or fewer players, which is the moment waiting
 * stops being free.
 */
export function detectTierCliffs(
  available: RankedPlayer[],
  opts: {
    remaining: number;
    positions?: DraftPosition[];
    /**
     * The pick on the clock, folded into the id so a cliff that is still true
     * several picks later announces again as it gets closer. Without it a cliff
     * speaks once and then stays silent while the tier actually empties.
     */
    onTheClockPickNo?: number;
  },
): DraftAlert[] {
  const byPosition = new Map<DraftPosition, RankedPlayer[]>();
  for (const p of available) {
    const list = byPosition.get(p.position) ?? [];
    list.push(p);
    byPosition.set(p.position, list);
  }

  const out: DraftAlert[] = [];
  for (const [position, players] of byPosition) {
    if (opts.positions && !opts.positions.includes(position)) continue;
    // Kickers and defenses have no meaningful tier cliff: there are dozens and
    // the difference between the third and the tenth is noise.
    if (position === "K" || position === "DEF") continue;
    const topTier = Math.min(...players.map((p) => p.tier));
    const inTier = players.filter((p) => p.tier === topTier);
    if (inTier.length > opts.remaining) continue;
    out.push({
      kind: "tier-cliff",
      id: `tier-${position}-${topTier}-${inTier.length}-${opts.onTheClockPickNo ?? 0}`,
      message:
        inTier.length === 1
          ? `Last ${POS_SINGULAR[position]} in this tier: ${inTier[0].name}.`
          : `Only ${inTier.length} ${POS_PLURAL[position]} left in this tier.`,
      position,
      severity: 5 - inTier.length,
    });
  }
  return out.sort((a, b) => b.severity - a.severity);
}

/** One player the simulation expects to be gone before your next turn. */
export interface GoneBeforeEntry {
  player: RankedPlayer;
  /** The overall pick number the simulation has him going at. */
  atPick: number;
  /** False when he was placed by FF Beacon rank because he carries no ADP. */
  adpKnown: boolean;
}

/**
 * A "your turn is coming" alert, when the connected user is close enough for it
 * to matter. Silent when the turn is far away, because a countdown that is
 * always on stops being a signal.
 */
export function turnAlert(
  picksUntilNext: number | null,
  /**
   * The overall pick number the countdown refers to. It is part of the id, so
   * "you are on the clock" announces again on your NEXT turn. Keyed on the
   * countdown alone it would fire once per draft and then go quiet forever,
   * because the consumer only announces ids it has not seen.
   */
  nextPickNo: number | null,
): DraftAlert | null {
  if (picksUntilNext === null || picksUntilNext < 0) return null;
  const turnKey = nextPickNo ?? "unknown";
  if (picksUntilNext === 0) {
    return {
      kind: "your-turn",
      id: `turn-${turnKey}-0`,
      message: "You are on the clock.",
      position: null,
      severity: 100,
    };
  }
  if (picksUntilNext > 5) return null;
  return {
    kind: "your-turn",
    id: `turn-${turnKey}-${picksUntilNext}`,
    message: `${picksUntilNext} ${picksUntilNext === 1 ? "pick" : "picks"} until you are up.`,
    position: null,
    severity: 50 - picksUntilNext,
  };
}
