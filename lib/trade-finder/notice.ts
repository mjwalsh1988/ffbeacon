/**
 * The engine's machine reasons, as sentences a reader can act on.
 *
 * A separate module rather than a const inside the server action, because both
 * the action AND the tab's first server render need it, and a "use server" file
 * may only export async functions. Pure: no database, no React, no clock.
 */

import type { TradeFinderNotice } from "./types";

/**
 * The engine's machine reason, as a sentence for the reader.
 *
 * Written here rather than in the engine because the engine is pure and knows
 * nothing about surfaces, and written at all because "no trade to suggest" is
 * a bad answer to a question that could never have had one. A reader who named
 * two players from two different rosters has not made a mistake anybody would
 * spot on their own.
 */
export const NOTICE_TEXT: Record<TradeFinderNotice, string> = {
  "targets-split":
    "Those players are on different teams. A trade has one other side, so pick players from a single roster.",
  "targets-missing":
    "We could not find all of those players on another roster in this league.",
  "targets-unpriced":
    "One roster holds all of those players, but we have no trade value for one of them, so we cannot price the package.",
  "targets-unaffordable":
    "Nothing on your roster adds up to all of those players at once. Try naming fewer of them.",
  "offers-missing":
    "We have no trade value for one of the players you picked, so we cannot price that package.",
  // Not a malformed question. The search ran, it found deals, and every one of
  // them would have cost points off the starting lineup, so the contender floor
  // turned them all away. Said out loud because the alternative reads as a
  // broken tool: a manager looking at eleven other rosters does not believe
  // "no trade to suggest".
  "no-lineup-gain":
    "We found deals, but every one of them would cost you points a week off your starting lineup, so none of them is worth sending. Name a player above to see what he would bring back anyway.",
};

/** The sentence for a reason, or null when there is no reason to give. */
export function noticeText(notice: TradeFinderNotice | null): string | null {
  return notice ? NOTICE_TEXT[notice] : null;
}
