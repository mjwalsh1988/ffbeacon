/**
 * How the Contender / Loaded / Bubble / Rebuilder bands read INSIDE A DRAFT
 * ROOM, in this room's own vocabulary and palette.
 *
 * WHY THE ROOM HAS ITS OWN WORDS
 *   `classifyTeamStatus` writes its reason for League Pulse and says "by Power
 *   Pulse", which is a different model measuring expected WINS over a real
 *   remaining schedule. This room ranks by Draft Pulse, and its own stat tiles
 *   say so. Speaking the League Pulse sentence here hands a screen reader the
 *   wrong feature name for the number on screen, and it is the one audience that
 *   gets an explanation at all, since the chip itself is only a word.
 *
 *   Both draft-room surfaces used to disagree about this: the Draft Pulse board
 *   wrote its own sentence and the Rosters tab spoke the classifier's. One file
 *   now owns the answer.
 *
 * WHY THE PALETTE DIFFERS FROM LEAGUE PULSE AND HOW FAR IT MAY DIVERGE
 *   The room has its own hues, but they may not CONTRADICT the ones a reader
 *   learned in League Pulse. Purple means Rebuilder there, so violet means
 *   Rebuilder here; giving violet to Loaded put the same hue on two different
 *   bands across two surfaces of one product, which is worse than an unfamiliar
 *   colour. Sky is unspoken for, so Loaded takes it.
 *
 *   Colour is never the only signal either way: the band's word sits inside
 *   every chip and the sentence below is announced beside it.
 *
 * Pure. No React, no data access.
 */

import type { TeamStatusKey } from "@/lib/league-team-status";

/** The band's meaning, phrased for a draft room. Reads after a comma. */
export const ARCHETYPE_REASON: Record<TeamStatusKey, string> = {
  competitor:
    "near the top by Draft Pulse, so this roster can put points on the field now",
  loaded:
    "not near the top by Draft Pulse, but holding well more value than that ranking shows",
  middle: "in the pack on both the points ranking and the value ranking",
  rebuilder:
    "well down the Draft Pulse ranking, with the value it holds pointed at later",
};

/** Chip border, fill, and text per band. */
export const ARCHETYPE_TONE: Record<TeamStatusKey, string> = {
  competitor: "border-emerald-400/50 bg-emerald-400/10 text-emerald-300",
  loaded: "border-sky-400/50 bg-sky-400/10 text-sky-300",
  middle: "border-zinc-400/40 bg-zinc-400/10 text-zinc-300",
  rebuilder: "border-violet-400/50 bg-violet-400/10 text-violet-300",
};
