/**
 * Wording and number formatting for the Decisions page.
 *
 * Shared by the table, the sheet and the detail so a figure is never spelled
 * one way in the row and another way in the sentence a screen reader hears.
 *
 * Every function here takes a number that might be null, and null is always
 * rendered as "not measured" rather than as a zero. "We could not check" and
 * "there was nothing there" are different statements, and this page exists to
 * keep them apart.
 */

import { ordinal } from "@/components/league-schedule/format";
import type { LedgerRecord } from "@/lib/manager-ledger/types";

// `ordinal` is the Schedule page's, re-exported rather than copied. A third
// implementation of "1st, 2nd, 12th" in one codebase is how two surfaces end
// up disagreeing about the eleventh.
export { ordinal };

/** Points, to one decimal. The precision Sleeper itself shows. */
export function pts(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "--";
  return value.toFixed(1);
}

/** Points with an explicit sign, for a figure that can go either way. */
export function signedPts(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "--";
  const rounded = value.toFixed(1);
  return value > 0 ? `+${rounded}` : rounded;
}

/** A ratio as a whole-number percentage. */
export function pct(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "--";
  return `${Math.round(value * 100)}%`;
}

export function record(r: LedgerRecord): string {
  return r.ties > 0 ? `${r.wins}-${r.losses}-${r.ties}` : `${r.wins}-${r.losses}`;
}


/** A rank as words, or an honest reason there is not one. */
export function rankWords(rank: number | null, total: number): string {
  return rank === null ? "unranked" : `${ordinal(rank)} of ${total}`;
}

/** "3 games" / "1 game". A count that appears in prose needs its noun. */
export function games(n: number): string {
  return `${n} game${n === 1 ? "" : "s"}`;
}

export function weeks(n: number): string {
  return `${n} week${n === 1 ? "" : "s"}`;
}

/**
 * The spoken form of the dash these formatters return.
 *
 * Two hyphens are swallowed at a screen reader's default punctuation level, so
 * a cell holding one announces as empty. This file's whole premise is that
 * "we could not measure this" and "there was nothing there" are different
 * statements, and an empty announcement collapses them, so every visible dash
 * is paired with these words in an sr-only span.
 */
export const NOT_MEASURED = "Not measured";

/**
 * The one-sentence read on a manager, built only from figures on the page.
 *
 * Deterministic templates, never a language model, for the same reason the
 * Trade Ideas reasons are: every sentence has to be checkable against the
 * numbers next to it, and a generated one would not be. A clause whose figure
 * is null simply does not fire.
 */
export function summarySentence(params: {
  teamName: string;
  efficiency: number | null;
  efficiencyRank: number | null;
  scoringRank: number | null;
  winsLeftOnBench: number;
  total: number;
}): string {
  const { teamName, efficiency, efficiencyRank, scoringRank, winsLeftOnBench, total } = params;
  const parts: string[] = [];

  if (efficiency !== null) {
    parts.push(`${teamName} started ${pct(efficiency)} of their own roster's points`);
  } else {
    parts.push(`${teamName} has no graded weeks yet`);
  }

  if (efficiencyRank !== null) {
    parts.push(`${rankWords(efficiencyRank, total)} in this league`);
  }

  const sentence = `${parts.join(", ")}.`;

  const extras: string[] = [];
  if (winsLeftOnBench > 0) {
    extras.push(`They lost ${games(winsLeftOnBench)} their own bench would have won.`);
  }
  // The gap between what the roster produced and what the manager extracted is
  // the whole point of the page, so it is stated outright when it is wide.
  if (efficiencyRank !== null && scoringRank !== null) {
    const gap = efficiencyRank - scoringRank;
    if (gap >= 4) {
      extras.push(
        `They scored ${rankWords(scoringRank, total)} but rank ${rankWords(efficiencyRank, total)} on decisions, so the roster is doing the work.`,
      );
    } else if (gap <= -4) {
      extras.push(
        `They scored ${rankWords(scoringRank, total)} and rank ${rankWords(efficiencyRank, total)} on decisions, so they are getting more out of less.`,
      );
    }
  }

  return [sentence, ...extras].join(" ");
}
