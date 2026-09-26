/**
 * The words Beacon Ranker says after an answer (plan section 10): the visible
 * result line and the polite live-region sentence. Pure and client-safe.
 *
 * The live region is NOT optional. After an answer focus stays on the
 * question, but both buttons now name different players, and a button whose
 * name changes under focus is not re-announced by every screen reader. The
 * "Next: ... or ..." clause is what tells the reader the question moved on.
 */

import { readerRanksFor, gapSentence, ordinal, rankGap, type RankComparison, type RankGap } from "./compare";
import { provisionalBoard, type RunState } from "./builder";

type Named = { name: string; position: string };

function lastName(full: string): string {
  const parts = full.trim().split(/\s+/);
  // "Jr." and friends are not what a reader calls a player.
  const tail = parts[parts.length - 1] ?? full;
  if (/^(jr|sr|ii|iii|iv|v)\.?$/i.test(tail) && parts.length > 1) return parts[parts.length - 2];
  return tail;
}

export type ResultLine = {
  /** Visible sentence, or null when there is nothing to report. */
  text: string | null;
  /** The FF Beacon gap for the player just placed, for the chip beside it. */
  gap: RankGap | null;
};

/** What the last answer did, in one visible sentence. */
export function resultLine(
  state: RunState,
  cards: Record<string, Named>,
  comparison: RankComparison | null,
): ResultLine {
  const e = state.event;
  if (!e) return { text: null, gap: null };
  const name = (id: string) => cards[id]?.name ?? "That player";
  switch (e.kind) {
    case "placed": {
      const who = cards[e.playerId];
      let gap: RankGap | null = null;
      let tail = "";
      if (comparison && who) {
        const board = provisionalBoard(state).map((id) => ({
          playerId: id,
          position: cards[id]?.position ?? "",
        }));
        const readerRank = readerRanksFor(board, comparison).get(e.playerId);
        gap = rankGap(comparison, { playerId: e.playerId, position: who.position }, readerRank);
        tail = ` ${gapSentence(gap, comparison.subject)}`;
      }
      return { text: `${lastName(name(e.playerId))} placed ${ordinal(e.rank)}.${tail}`, gap };
    }
    case "climbed":
      return {
        text: `${lastName(name(e.playerId))} moves above ${name(e.passed)}.`,
        gap: null,
      };
    case "left_off":
      return { text: `${name(e.playerId)} left off the board.`, gap: null };
    case "prompt":
      return {
        text: `${lastName(name(e.playerId))} has won ${e.streak} in a row.`,
        gap: null,
      };
    case "extended":
      return { text: `Keep going: the board now aims for ${e.depth} players.`, gap: null };
    case "tier":
      return {
        text: e.drawn
          ? `Tier line drawn after rank ${e.afterRank}.`
          : `No line after rank ${e.afterRank}.`,
        gap: null,
      };
    case "tiers_started":
      return { text: "Tier pass started.", gap: null };
    case "tiers_done":
      return { text: "Tier pass finished.", gap: null };
    default:
      return { text: null, gap: null };
  }
}

/** The question that is open now, as the live region states it. */
export function nextQuestionText(state: RunState, cards: Record<string, Named>): string {
  const name = (id: string | null) => (id ? cards[id]?.name ?? "a player" : "a player");
  if (state.phase === "prompt" && state.current) {
    return `${lastName(name(state.current.playerId))} has won ${state.current.streak} in a row. Place him at a rank, or keep comparing?`;
  }
  if (state.phase === "compare" && state.current) {
    return `Next: ${name(state.current.playerId)} or ${name(state.opponent)}.`;
  }
  if (state.phase === "tiers" && state.tierPass.gap !== null) {
    const g = state.tierPass.gap;
    return `Is there a real drop-off between ${name(state.board[g - 1])} (${ordinal(g)}) and ${name(state.board[g])} (${ordinal(g + 1)})?`;
  }
  if (state.phase === "done") {
    return state.capReached ? "You reached the guest limit." : "The run is complete.";
  }
  if (state.phase === "finished") return "Your board is finished.";
  return "";
}

/** The whole announcement after an answer. */
export function announcement(
  state: RunState,
  cards: Record<string, Named>,
  comparison: RankComparison | null,
): string {
  const line = resultLine(state, cards, comparison).text;
  const next = nextQuestionText(state, cards);
  return [line, next].filter(Boolean).join(" ");
}
