/**
 * Client-safe start/sit strings.
 *
 * No server imports, on purpose: a client component (the confidence meter,
 * the picker's limit message) can pull from this file without dragging a
 * database client into the browser bundle. The one thing it does import,
 * MAX_START_SIT_PLAYERS from ./types, is a plain constant with no imports of
 * its own, so that stays safe too.
 *
 * START_SIT_FAQ is the single source of truth for the FAQ. written-sections.tsx
 * renders it verbatim as visible text, and the page's FAQPage JSON-LD is built
 * from the same array, so the structured data can never claim to answer a
 * question the page does not actually show.
 */

import { MAX_START_SIT_PLAYERS } from "./types";
import type { StartSitCallLabel } from "./types";

export type StartSitFaqEntry = {
  question: string;
  answer: string;
};

/**
 * The visible FAQ, in the order the page renders it under "Start/sit
 * questions, answered". Each answer opens with the answer itself, not a
 * restatement of the question.
 */
export const START_SIT_FAQ: StartSitFaqEntry[] = [
  {
    question: "Can I compare more than two players?",
    answer: `Yes. Add up to ${MAX_START_SIT_PLAYERS} players to one board and set how many of them you plan to start. The tool ranks the whole group and shows where the close calls sit, alongside the top pick.`,
  },
  {
    question: "Does it work for my league's scoring?",
    answer:
      "It reprices every player under the format set in the site header, including PPR, half PPR, standard, TE premium, and superflex. Connect a Sleeper league from the board and the verdict switches to that league's own literal scoring rules instead of a generic format.",
  },
  {
    question: "What does the confidence figure mean?",
    answer:
      "It is the probability that the player you are told to start actually outscores the closest player left on your bench, built from each player's projected points and how much those points tend to vary week to week. A figure near 50 percent means the call is close; one near 100 percent means it is not.",
  },
  {
    question: "How often is it updated?",
    answer:
      "Projections and injury designations refresh once a day. The timestamp shown above the board is the exact time the numbers below it were last pulled.",
  },
  {
    question: "Is it free?",
    answer: "Yes. Running a comparison costs nothing and does not require an account.",
  },
  {
    question: "Why does the verdict differ from my rankings?",
    answer:
      "A ranking is a rest-of-season opinion; this verdict is for one week only. A player can sit ahead of another for the rest of the year and still be the worse start in a single week with a tougher matchup or a bye.",
  },
  {
    question: "Should I start a running back or a wide receiver in my flex?",
    answer:
      "Whichever one this tool ranks higher for the week you are setting. Points are compared directly across positions here, which is exactly what a flex decision calls for, and the higher-ranked player is the better start regardless of position.",
  },
];

/**
 * Short, visible pill text for each confidence call label. Used on the
 * confidence meter and anywhere else a call needs a word rather than a raw
 * probability.
 */
export const START_SIT_CALL_LABEL_TEXT: Record<StartSitCallLabel, string> = {
  clear: "Clear call",
  lean: "Lean call",
  "toss-up": "Close call",
  unmeasured: "Not enough data",
};

/** The visible "Week N, season" line shown above the board. */
export function weekLabel(week: number, season: number): string {
  return `Week ${week}, ${season}`;
}
