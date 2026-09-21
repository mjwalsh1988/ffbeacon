/**
 * The questions under a rankings board, and the answers.
 *
 * Every rankings page had a masthead, a table and a Discord card, and nothing
 * that answered the question a reader arrived with. Those questions are real
 * search queries ("who is the number one dynasty superflex player", "what is a
 * tier in fantasy football rankings") and the board already holds the answers.
 *
 * TWO RULES HOLD THIS FILE HONEST.
 *
 * One: an answer states only what the board on the same screen shows. The
 * names, ranks and values come from the rows being rendered, so the prose and
 * the table cannot disagree, and an answer whose input is missing is DROPPED
 * rather than written around a blank. That is also what makes the FAQPage
 * JSON-LD safe to emit: it is built from this same array, so the structured
 * data can never claim an answer the page does not show.
 *
 * Two: the wording is per format, derived from the format's own structural
 * columns the way lib/rankings-formats.ts derives its phrasing. A superflex
 * board and a 1QB board do not get the same paragraph about quarterbacks with
 * a word swapped, because they are not the same answer.
 *
 * Pure: takes plain data, returns plain strings.
 */

import type { FaqAccordionItem } from "@/components/faq-accordion";
import {
  formatPhrase,
  formatPhraseLower,
  isBestBall,
  type RankingFormat,
} from "@/lib/rankings-formats";
import type { BoardPulse, BoardRow } from "@/lib/rankings/insights";

export type RankingsFaqInput = {
  format: RankingFormat;
  /** The rows on screen, in board order. */
  rows: BoardRow[];
  pulse: BoardPulse;
  /** Active position filter, or null on the overall board. */
  position: string | null;
  /** source_registry.display_name for the value source. Never a raw slug. */
  sourceLabel: string;
  /** How often that source publishes. */
  cadence: "daily" | "weekly" | undefined;
};

const POSITION_WORD: Record<string, string> = {
  QB: "quarterback",
  RB: "running back",
  WR: "wide receiver",
  TE: "tight end",
  K: "kicker",
  DEF: "defense",
};

function positionWord(position: string): string {
  return POSITION_WORD[position] ?? position;
}

function nameList(rows: BoardRow[], count: number): string {
  const names = rows.slice(0, count).map((r) => r.name);
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function buildRankingsFaq({
  format,
  rows,
  pulse,
  position,
  sourceLabel,
  cadence,
}: RankingsFaqInput): FaqAccordionItem[] {
  const phrase = formatPhrase(format);
  const lower = formatPhraseLower(format);
  const dynasty = format.league_type === "dynasty";
  const bestBall = isBestBall(format.slug);
  const items: FaqAccordionItem[] = [];

  // 1. Who is number one. The single most-searched shape of this query, and
  // the board's own first row is the answer.
  const top = rows[0];
  if (top) {
    const scope = position
      ? `the top ${positionWord(position)} in ${phrase}`
      : `the number one player in ${phrase}`;
    const rest = nameList(rows.slice(1), 4);
    items.push({
      question: position
        ? `Who is the best ${positionWord(position)} in ${lower} right now?`
        : `Who is the number one ranked player in ${lower}?`,
      answer:
        `${top.name}${top.team ? ` (${top.team})` : ""} is ${scope} as of the latest update, ` +
        `on a market value of ${top.value === null ? "no published figure" : top.value.toLocaleString("en-US")}` +
        `${rest ? `. Behind him come ${rest}` : ""}. ` +
        `The order is set by ${sourceLabel} market value and re-sorts ${cadence === "weekly" ? "every week" : "every night"}, ` +
        `so it moves with the market rather than with one person's opinion.`,
    });
  }

  // 2. What a tier means here. The board's tier column changed meaning on
  // 2026-09-21 and nothing else on the page explains the new one.
  if (pulse.cliff) {
    items.push({
      question: "What do the tiers on this board mean?",
      answer:
        `A tier is a group of players close enough in value that which one you end up with barely matters, ` +
        `and it ends where the next player down is meaningfully worse. Tiers are worked out inside each position ` +
        `from the gaps between values, not by slicing the list into equal blocks, so a tier of two and a tier of ` +
        `eleven are both normal answers. The steepest drop on this board right now is at ${pulse.cliff.position}, ` +
        `where the fall from tier ${pulse.cliff.tier} to tier ${pulse.cliff.tier + 1} is ` +
        `${Math.round(pulse.cliff.drop).toLocaleString("en-US")} points of value. That is the cliff worth reaching for ` +
        `a round early.`,
    });
  }

  // 3. What the Value number is. Asked constantly, and the honest answer is
  // "a market price", which readers routinely mistake for a projection.
  items.push({
    question: "What does the Value column actually measure?",
    answer:
      `Value is a market price, not a points projection. It is what the ${sourceLabel} market says a player is ` +
      `worth to trade for in ${phrase} right now, on a scale where the most expensive player sits near 10,000. ` +
      `Two players on the same value are roughly interchangeable in a trade. It does not say how many points ` +
      `either one will score this week, which is a different question and a different tool.`,
  });

  // 4. Why the format matters. This is the page's whole reason to exist as a
  // separate URL, so it is worth saying out loud.
  items.push({
    question: `Why do ${lower} rankings differ from other formats?`,
    answer:
      (format.is_superflex
        ? `Superflex lets you start a second quarterback, so every starting quarterback in the league becomes a ` +
          `starter somebody needs and the position prices far above where it sits in a one-quarterback league. `
        : `This board starts one quarterback, so all but the very best quarterbacks are replaceable and running ` +
          `backs and receivers take the top of the board. `) +
      (dynasty
        ? `It is also a dynasty board, so a 23-year-old and a 29-year-old on the same production are not worth the ` +
          `same thing: you are buying the seasons ahead, not just this one. `
        : `It is a redraft board, so it prices this season only and age barely matters. `) +
      (bestBall
        ? `Best ball removes the weekly lineup decision, which lifts boom-or-bust players whose bad weeks you would ` +
          `otherwise have had to start. `
        : "") +
      `Switch format with the Values button in the site header and the whole board reprices.`,
  });

  // 5. How fresh it is. Only asked once, and only worth answering once.
  items.push({
    question: "How often are these rankings updated?",
    answer:
      `${cadence === "weekly" ? "Once a week" : "Every night"}, automatically. ` +
      `${sourceLabel} publishes fresh values, we recalculate the order, the 30-day movement columns and the ` +
      `tiers, and the board you are reading is the result. Nothing here is hand-ranked, and nothing is held ` +
      `back: the whole board is free and there is no account needed to read it.`,
  });

  // 6. The month's movement, if there is a month to describe. Dropped
  // entirely when the source has not published enough history to say
  // anything, rather than reported as a board where nothing moved.
  if (pulse.withWindow > 0 && pulse.biggestRiser) {
    items.push({
      question: "Who is rising and falling in value right now?",
      answer:
        `Of the ${pulse.withWindow.toLocaleString("en-US")} players on this board with a full 30 days of history, ` +
        `${pulse.rising.toLocaleString("en-US")} gained value, ${pulse.falling.toLocaleString("en-US")} lost value and ` +
        `${pulse.holding.toLocaleString("en-US")} held. ${pulse.biggestRiser.name} is the biggest climber at ` +
        `${pulse.biggestRiser.pct > 0 ? "+" : ""}${pulse.biggestRiser.pct.toFixed(1)}%` +
        `${pulse.biggestFaller ? `, and ${pulse.biggestFaller.name} the biggest faller at ${pulse.biggestFaller.pct.toFixed(1)}%` : ""}. ` +
        `The board's movement columns are 30-day for the same reason: a week is whichever piece of news landed ` +
        `that week, and a week of rank movement barely moves at all. The Market movers panel below the board ` +
        `still lists the top five each way over a week as well, where a big move is news rather than noise.`,
    });
  }

  // 7. Positional depth, only on a positional board, where it is the question
  // the reader filtered in order to ask.
  if (position) {
    const tierOne = rows.filter((r) => r.tier === 1).length;
    if (tierOne > 0) {
      items.push({
        question: `How deep is ${positionWord(position)} in ${lower}?`,
        answer:
          `${rows.length.toLocaleString("en-US")} ${positionWord(position)}s are ranked in this format, and ` +
          `${tierOne === 1 ? "one sits" : `${tierOne} sit`} in the top tier. The Gap column on each row is the ` +
          `drop in value to the next ${positionWord(position)} down, which is the number that tells you whether ` +
          `waiting a round costs you anything. A run of small gaps means the position is deep and you can wait; ` +
          `one large gap means the next tier is a real step down.`,
      });
    }
  }

  return items;
}
