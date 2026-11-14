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

/**
 * The words a null figure prints as. One real text node, read the same by eye
 * and ear, rather than a dash a screen reader swallows.
 */
export const NOT_MEASURED = "Not measured";

/** Points, to one decimal. The precision Sleeper itself shows. */
export function pts(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return NOT_MEASURED;
  return value.toFixed(1);
}

/** Points with an explicit sign, for a figure that can go either way. */
export function signedPts(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return NOT_MEASURED;
  const rounded = value.toFixed(1);
  return value > 0 ? `+${rounded}` : rounded;
}

/** A ratio as a whole-number percentage. */
export function pct(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return NOT_MEASURED;
  return `${Math.round(value * 100)}%`;
}

export function record(r: LedgerRecord): string {
  return r.ties > 0 ? `${r.wins}-${r.losses}-${r.ties}` : `${r.wins}-${r.losses}`;
}

/** What the page calls each figure, by league kind. See lib/manager-ledger/rules.ts. */
export type LedgerWords = {
  /** False in best ball: the lineup sets itself, so nothing about it is graded. */
  gradesLineups: boolean;
  /** Weeks are read against the cut line, not an opponent. */
  chopped: boolean;
  recordLabel: string;
  /** One short line under the record. */
  recordHint: string;
  bestRecordLabel: string;
  winsLeftLabel: string;
  /** One short line naming the wins-left figure. */
  winsLeftHint: string;
  /** "Won" or "Survived" for a week's result. */
  win: string;
  loss: string;
};

export function ledgerWords(rules: {
  bestBall: boolean;
  chopped: boolean;
  medianGame: boolean;
}): LedgerWords {
  if (rules.chopped) {
    return {
      gradesLineups: true,
      chopped: true,
      recordLabel: "Weeks survived",
      recordHint: "weeks above the cut line, then below it",
      bestRecordLabel: "At their best",
      winsLeftLabel: "Cuts left behind",
      winsLeftHint: "weeks below the cut line their bench would have survived",
      win: "Survived",
      loss: "Below the cut",
    };
  }
  return {
    gradesLineups: !rules.bestBall,
    chopped: false,
    recordLabel: "Record",
    recordHint: rules.medianGame
      ? "regular season, median games included"
      : "regular season",
    bestRecordLabel: "Best lineup",
    winsLeftLabel: "Wins left behind",
    winsLeftHint: "losses their own bench would have won",
    win: "Won",
    loss: "Lost",
  };
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
  /** League-kind wording. Absent means an ordinary head-to-head league. */
  words?: LedgerWords;
}): string {
  const { teamName, efficiency, efficiencyRank, scoringRank, winsLeftOnBench, total } = params;
  const parts: string[] = [];

  if (params.words && !params.words.gradesLineups) {
    return scoringRank === null
      ? `${teamName} has no finished weeks yet. Best ball sets the lineup itself.`
      : `${teamName} is ${rankWords(scoringRank, total)} on points. Best ball sets the lineup itself.`;
  }

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
    extras.push(
      params.words?.chopped
        ? `Their bench would have survived ${weeks(winsLeftOnBench)} they fell below the cut.`
        : `They lost ${games(winsLeftOnBench)} their own bench would have won.`,
    );
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
