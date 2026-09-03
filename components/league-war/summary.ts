/**
 * Deterministic prose for the Positional WAR panel: the chart's spoken
 * summary, its legend headlines, the overlay's per-position lines, the
 * footnote, and the status-aware empty states.
 *
 * Every sentence here is built from figures already on the same screen, per
 * CLAUDE.md's rule for Trade Ideas reasons ("a null figure means the reason
 * does not fire") applied the same way to Positional WAR: nothing is
 * invented, and a missing number changes the sentence rather than printing a
 * placeholder zero. Pure, no I/O, so every sentence is independently
 * testable without rendering.
 *
 * KEEP THESE SHORT. Everything here is plain English on purpose, because a
 * reader meeting this chart for the first time should not have to decode it,
 * and every one of these strings is also read aloud. A definition that appears
 * in the footnote does not get repeated in the summary, and a figure the
 * reader can derive from another figure on the same line is left out. Length
 * is a feature the reader did not ask for.
 */

import type { PlottableCurve } from "@/lib/positional-war/types";
import type { PulsePosition } from "@/lib/power-pulse/types";
import type { PositionalWarStatus } from "@/lib/league-positional-war-data";
import { formatEastern, formatRelative } from "@/lib/datetime";
import { selectScarcestAndDeepest } from "./selection";

const POSITION_NAME: Record<PulsePosition, string> = {
  QB: "quarterback",
  RB: "running back",
  WR: "wide receiver",
  TE: "tight end",
  K: "kicker",
  DEF: "team defense",
};

function fmtWar(war: number): string {
  return war.toFixed(2);
}

/** Sentence case for a position name used at the start of a sentence. */
function cap(name: string): string {
  return `${name[0].toUpperCase()}${name.slice(1)}`;
}

/** First rank whose WAR falls below half a win. Null when the curve never does. */
function firstRankBelowHalfWin(curve: PlottableCurve): number | null {
  for (const point of curve.curve) {
    if (point.war < 0.5) return point.positionRank;
  }
  return null;
}

/** Largest gap between one starter and the next, among ranks the league actually starts. */
function maxAdjacentGapWithinDemand(curve: PlottableCurve): number {
  const starters = curve.curve.filter((p) => p.positionRank <= curve.structuralDemand);
  let maxGap = 0;
  for (let i = 1; i < starters.length; i++) {
    const gap = Math.abs(starters[i - 1].war - starters[i].war);
    if (gap > maxGap) maxGap = gap;
  }
  return maxGap;
}

/**
 * The ChartFigure summary: a visually hidden paragraph stating the
 * conclusion, read before the graphic it describes. Names the scarcest and
 * the flattest position with their real numbers, using the same selection
 * rule as the rail summary card so the two surfaces never disagree.
 */
export function buildChartSummary(curves: readonly PlottableCurve[], teamCount: number): string {
  const { scarcest, deepest } = selectScarcestAndDeepest(curves);
  // One short closing, not the full definition: the footnote under the same
  // chart carries that, and a screen reader reaches both.
  const closing = `A replacement player is the best one at his position who would not make a starting lineup anywhere in this ${teamCount}-team league.`;

  if (!scarcest) {
    return `Not calculated for this league yet. ${closing}`;
  }

  const scarcestName = POSITION_NAME[scarcest.position];
  const scarcestWar = scarcest.warRank1 !== null ? fmtWar(scarcest.warRank1) : null;
  const halfWinRank = firstRankBelowHalfWin(scarcest);
  const scarcestSentence =
    scarcestWar !== null
      ? `${cap(scarcestName)} is the hardest position to replace here: the best one should win you ${scarcestWar} more matchups than a replacement would, and ${
          halfWinRank !== null
            ? `that edge drops under half a matchup by ${scarcest.position}${halfWinRank}.`
            : `every one this league starts stays above half a matchup.`
        }`
      : `${cap(scarcestName)} is the hardest position to replace here.`;

  if (!deepest) {
    return `${scarcestSentence} ${closing}`;
  }

  const deepestName = POSITION_NAME[deepest.position];
  const deepestWar = deepest.warRank1 !== null ? fmtWar(deepest.warRank1) : null;
  const maxGap = maxAdjacentGapWithinDemand(deepest);
  const deepestSentence =
    deepestWar !== null
      ? `${cap(deepestName)} is the easiest: the best one is worth ${deepestWar} extra matchups, and every starter is within ${maxGap.toFixed(2)} of the next.`
      : `${cap(deepestName)} is the easiest.`;

  return `${scarcestSentence} ${deepestSentence} ${closing}`;
}

/**
 * One legend button's visible text and accessible name, e.g.
 * "QB: best is worth 0.65 wins, 12 start". Readable with the chart entirely
 * hidden, which is why the figure lives in the text rather than only in the
 * plotted line.
 *
 * The replacement rank is deliberately not spelled out here. It is always one
 * past the number that starts, the footnote says so, and this string sits on a
 * button that a reader may hear six times in a row.
 */
export function buildLegendHeadline(curve: PlottableCurve): string {
  if (curve.warRank1 === null || curve.curve.length === 0) {
    return `${curve.position}: not enough data yet`;
  }
  return `${curve.position}: best one adds ${fmtWar(curve.warRank1)} matchups, ${curve.structuralDemand} start`;
}

/**
 * One "Your best X" line per position the viewer holds a player at,
 * following the deterministic template from section 15.1.1: every figure
 * comes from the same curve on the same screen. A position where the viewer
 * holds nobody says so plainly, so "you have none" reads differently from
 * "we did not check".
 */
export function buildOverlayPositionLine(
  curve: PlottableCurve,
  bestOwnedRank: number | null,
  bestOwnedWar: number | null,
): string {
  const name = curve.position;
  if (bestOwnedRank === null || bestOwnedWar === null) {
    return `No ranked ${name} on your roster.`;
  }
  const top = curve.warRank1 !== null ? fmtWar(curve.warRank1) : null;
  const base = `Your best ${name} is ${name}${bestOwnedRank}, adding ${fmtWar(bestOwnedWar)} matchups`;
  return top !== null ? `${base}; ${name}1 adds ${top}.` : `${base}.`;
}

/** The trailing line naming rostered players who rank past the chart's display depth. */
export function buildPastDepthLine(names: readonly string[]): string | null {
  if (names.length === 0) return null;
  return `Yours, past the chart's depth: ${names.join(", ")}.`;
}

/** The trailing line counting rostered players with no resolvable projection at all. */
export function buildNoProjectionLine(count: number): string | null {
  if (count === 0) return null;
  // "of your players" stays plural at every count: one OF a group is still a
  // group. Only the verb and the pronoun move.
  return `${count} of your players ${count === 1 ? "has" : "have"} no projection, so ${count === 1 ? "it is" : "they are"} not plotted.`;
}

export type FootnoteInput = {
  fromWeek: number | null;
  throughWeek: number | null;
  scoringDescription: string;
  teamCount: number;
  excludedSlots: readonly string[];
  shallowPositions: readonly PulsePosition[];
  modelVersion: string | null;
  generatedAt: string | null;
  isStale: boolean;
  /**
   * Whose weekly projections the curve was built from, spelled out ("Sleeper"
   * or "FF Beacon").
   *
   * A FIELD, NOT A CONSTANT. This line used to say "Sleeper projections"
   * outright, which was true and frozen: the day an admin enables our own
   * engine the curve is rebuilt from it (the engine is part of the Positional
   * WAR fingerprint, see lib/positional-war/fingerprint.ts) and the sentence
   * would be attributing our numbers to somebody else.
   */
  projectionSourceLabel?: string;
};

/** The one footnote line under the chart, per section 11.6 and 8.4. */
export function buildFootnote(input: FootnoteInput): string {
  const {
    fromWeek,
    throughWeek,
    scoringDescription,
    teamCount,
    excludedSlots,
    shallowPositions,
    modelVersion,
    generatedAt,
    isStale,
    projectionSourceLabel = "Sleeper",
  } = input;

  const weekClause =
    fromWeek !== null && throughWeek !== null
      ? fromWeek === throughWeek
        ? `Week ${fromWeek}.`
        : `Weeks ${fromWeek} to ${throughWeek}.`
      : null;

  const parts: string[] = [];
  if (weekClause) parts.push(weekClause);
  parts.push(
    `Built from weekly projections for the rest of the season, not from what players have already done.`,
  );
  parts.push(`Scored under this league's own settings: ${scoringDescription}.`);
  parts.push(
    `A replacement player is the best one at his position who would not make a starting lineup anywhere in this ${teamCount}-team league.`,
  );
  if (excludedSlots.length > 0) {
    parts.push(`Sleeper does not project ${excludedSlots.join(", ")}, so they are excluded.`);
  }
  if (shallowPositions.length > 0) {
    const names = shallowPositions.join(", ");
    const one = shallowPositions.length === 1;
    parts.push(
      `There ${one ? "are" : "are"} fewer projected ${names} than this league starts, so the line understates how hard ${one ? "that position is" : "those positions are"} to replace.`,
    );
  }
  parts.push(
    `${projectionSourceLabel} projections, model ${modelVersion ?? "unknown"}, ${formatEastern(generatedAt)}.`,
  );
  if (isStale) {
    parts.push(`Last calculated ${formatRelative(generatedAt)}; the latest refresh did not complete.`);
  }

  return parts.join(" ");
}

/**
 * Fixed sentence per status, per section 8.4: never positional_war_detail
 * verbatim to a reader, always one of a small set of honest, pre-written
 * reasons. `error` and `pending` share the same base sentence; the "quiet
 * note" that error status adds is a separate, second sentence, see
 * buildEmptyStateQuietNote below.
 */
export function buildEmptyStateMessage(status: PositionalWarStatus | null): string {
  switch (status) {
    case "settled":
      return "This league's season is over, so there are no games left to score.";
    case "skipped":
      return "Waiting on this league's rosters or projections. Check back soon.";
    case "error":
    case "pending":
    case null:
    default:
      return "Not calculated for this league yet.";
  }
}

/**
 * The line under a chart that stops short of a league's full pool.
 *
 * Says the number rather than implying it. "Top 36 at each position" is a
 * statement a reader can check against the axis; "some positions run deeper"
 * on its own leaves them wondering how much deeper and whether it matters.
 * Null when nothing was cut, because a note about a cut that did not happen is
 * noise.
 */
export function buildTruncationNote(maxRank: number, truncated: boolean): string | null {
  if (!truncated) return null;
  return `Showing the top ${maxRank} at each position. Below that every line is flat, because those players would not start anywhere in this league.`;
}

/**
 * The quiet, separate note an `error` status adds beneath the base empty
 * state (section 8.4: "the same empty state plus a quiet note that the last
 * refresh failed"). Null for every other status, so callers can render it
 * conditionally without a status check of their own.
 */
export function buildEmptyStateQuietNote(status: PositionalWarStatus | null): string | null {
  return status === "error" ? "The latest refresh did not complete." : null;
}
