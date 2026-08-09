/**
 * Two things a draft room owes you after the fact.
 *
 * WHAT IT COST YOU
 * For each of your picks, the best player still on the board at that moment who
 * turned out to be worth more. Not a scold: most picks have a better option in
 * hindsight, which is exactly why the interesting number is HOW MUCH better and
 * how often, rather than the existence of one.
 *
 * A RECAP YOU CAN PASTE
 * League chat is where a draft actually gets argued about, and a link nobody
 * clicks loses to eight lines of text everyone reads. Plain text, no markup, no
 * emoji, and it fits in a message box.
 *
 * Pure and deterministic.
 */

import type { RankedPlayer } from "./board-types";
import type { Award } from "./awards";
import type { DraftGrade } from "./draft-grade";
import type { ShapedPick } from "./types";

/** One pick measured against the best option that was actually available. */
export interface PassedOn {
  pickNo: number;
  tookName: string;
  tookValue: number;
  /** The most valuable player still on the board at that pick. */
  bestName: string;
  bestValue: number;
  /** bestValue minus tookValue. Always positive; equal picks are omitted. */
  gap: number;
}

export interface PassedOnInput {
  /** The roster being reviewed. */
  rosterId: number;
  /** Every made pick in the draft, any order. */
  picks: ShapedPick[];
  /** The FULL board, for values. */
  board: RankedPlayer[];
}

/**
 * Replay the draft pick by pick, tracking who was still available, and record
 * every time a better player was on the board.
 *
 * "Better" means higher FF Beacon value at TODAY's values, which is the only
 * honest thing to say: we are not claiming to know what the room knew then. For
 * a completed draft the values are the frozen snapshot ones, so the judgement is
 * at least stable rather than drifting every time the board moves.
 */
export function computePassedOn(input: PassedOnInput): PassedOn[] {
  const { rosterId, picks, board } = input;
  const byPlayerId = new Map(board.map((p) => [p.playerId, p]));
  const bySleeperId = new Map(
    board.filter((p) => p.sleeperId).map((p) => [p.sleeperId as string, p]),
  );

  const resolve = (pick: ShapedPick): RankedPlayer | null =>
    (pick.playerId ? byPlayerId.get(pick.playerId) : undefined) ??
    (pick.sleeperPlayerId ? bySleeperId.get(pick.sleeperPlayerId) : undefined) ??
    null;

  const ordered = picks.slice().sort((a, b) => a.pickNo - b.pickNo);
  const taken = new Set<string>();
  const out: PassedOn[] = [];

  // Available = the board minus everyone drafted so far, kept sorted by value.
  const sorted = board.slice().sort((a, b) => b.value - a.value);

  for (const pick of ordered) {
    const player = resolve(pick);
    if (pick.rosterId === rosterId && !pick.isKeeper) {
      const best = sorted.find((p) => !taken.has(p.playerId));
      if (best && player && best.playerId !== player.playerId && best.value > player.value) {
        out.push({
          pickNo: pick.pickNo,
          tookName: player.name,
          tookValue: Math.round(player.value),
          bestName: best.name,
          bestValue: Math.round(best.value),
          gap: Math.round(best.value - player.value),
        });
      }
    }
    if (player) taken.add(player.playerId);
  }

  return out.sort((a, b) => b.gap - a.gap);
}

export interface RecapInput {
  leagueName: string;
  season: string;
  awards: Award[];
  grades: DraftGrade[];
  /** True while the draft is still running, which changes the framing. */
  inProgress: boolean;
}

/**
 * A plain-text recap for the league chat. Deliberately short: the grades and the
 * award cards are the detail, and this is the thing that starts the argument.
 */
export function buildRecapText(input: RecapInput): string {
  const lines: string[] = [];
  lines.push(
    input.inProgress
      ? `${input.leagueName} ${input.season} draft, so far`
      : `${input.leagueName} ${input.season} draft recap`,
  );
  lines.push("");

  if (input.grades.length > 0) {
    lines.push("Grades");
    for (const g of input.grades) {
      const name = g.teamName ? `${g.ownerName} (${g.teamName})` : g.ownerName;
      lines.push(`  ${g.letter}  ${name}`);
    }
    lines.push("");
  }

  const earned = input.awards.filter((a) => !a.pending && a.claimants.length > 0);
  if (earned.length > 0) {
    lines.push("Awards");
    for (const a of earned) {
      const who = a.claimants.map((c) => c.ownerName).join(", ");
      const metric = a.metricLabel ? ` (${a.metricLabel})` : "";
      lines.push(`  ${a.category}: ${who}${metric}`);
    }
    lines.push("");
  }

  if (earned.length === 0 && input.grades.length === 0) {
    lines.push("Nothing has been earned yet. Check back once more picks are in.");
    lines.push("");
  }

  lines.push("Graded by FF Beacon, ffbeacon.com");
  return lines.join("\n");
}
