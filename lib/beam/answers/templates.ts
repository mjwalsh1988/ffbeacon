/**
 * The sentences BEAM says.
 *
 * Every one of these is a function, not a string with holes punched in it, so
 * agreement and the "we do not have that" branches live next to the wording
 * rather than at each call site. A copy pass is a diff in this file.
 *
 * RULES THE COPY FOLLOWS (borrowed from lib/on-the-clock/rationale.ts, which
 * solved the same problem for the draft room):
 *   - Name the number. "Brock Purdy threw for 3,864 yards in 2025" beats "Purdy
 *     had a strong year".
 *   - Never claim what we did not measure. A missing stat produces a sentence
 *     about the gap, not a sentence containing zero.
 *   - Say which season, always, even when the reader did not ask.
 *   - Write for the ear. This product is read aloud more than it is read, so the
 *     verb comes early and no sentence needs a parenthetical to make sense.
 */

import { formatEastern } from "@/lib/datetime";
import type { BeamAnswerContext } from "@/lib/beam/types";
import type { BeamStat } from "@/lib/beam/stats/registry";
import { formatStatValue, lowerLabel, ordinal, shortName, withNoun } from "./format";

/**
 * The verb that fits a stat, so the sentence reads like speech.
 * "threw for 3,864 yards", "caught 78 passes", "played 17 games".
 */
export function statSentence(
  playerName: string,
  stat: BeamStat,
  value: number,
  /**
   * What stretch the number covers, already worded: "2025", or "weeks 2 to 8 of
   * 2025". A string rather than a season number so a week-range total can never
   * be rendered as if it were a season total.
   */
  period: string,
): string {
  const formatted = formatStatValue(value, stat.format);
  const withUnit = withNoun(value, formatted, stat.nounSingular, stat.nounPlural);

  switch (stat.id) {
    case "pass_yd":
      return `${playerName} threw for ${formatted} yards in ${period}.`;
    case "pass_td":
      return `${playerName} threw ${withNoun(value, formatted, "touchdown pass", "touchdown passes")} in ${period}.`;
    case "pass_int":
      return `${playerName} threw ${withUnit} in ${period}.`;
    case "rush_yd":
      return `${playerName} ran for ${formatted} yards in ${period}.`;
    case "rush_td":
      return `${playerName} ran for ${withNoun(value, formatted, "touchdown", "touchdowns")} in ${period}.`;
    case "rush_att":
      return `${playerName} had ${withUnit} in ${period}.`;
    case "rec":
      return `${playerName} caught ${withNoun(value, formatted, "pass", "passes")} in ${period}.`;
    case "rec_yd":
      return `${playerName} had ${formatted} receiving yards in ${period}.`;
    case "rec_td":
      return `${playerName} caught ${withNoun(value, formatted, "touchdown", "touchdowns")} in ${period}.`;
    case "rec_tgt":
      return `${playerName} saw ${withUnit} in ${period}.`;
    case "games_played":
      return `${playerName} played ${withUnit} in ${period}.`;
    case "fantasy_points":
      return `${playerName} scored ${formatted} fantasy points in ${period}.`;
    case "fantasy_points_per_game":
      return `${playerName} averaged ${formatted} fantasy points a game in ${period}.`;
    case "total_td":
      return `${playerName} scored ${withNoun(value, formatted, "touchdown", "touchdowns")} in ${period}.`;
    case "fgm":
      return `${playerName} made ${withUnit} in ${period}.`;
    case "def_sack":
      return `The ${playerName} had ${withUnit} in ${period}.`;
    case "pts_allow":
      return `The ${playerName} allowed ${formatted} points in ${period}.`;
    default:
      // Ratios and the long tail. "Jahmyr Gibbs averaged 5.2 yards per carry in
      // 2025" needs a different verb from "Jahmyr Gibbs had 12 drops in 2025".
      if (stat.format === "percent" || stat.format === "decimal1") {
        if (stat.nounPlural === null) {
          return `${playerName} posted ${formatted} ${lowerLabel(stat.label)} in ${period}.`;
        }
      }
      return `${playerName} had ${withUnit} in ${period}.`;
  }
}

/** When the season produced games but this stat was genuinely zero. */
export function trueZeroSentence(
  playerName: string,
  stat: BeamStat,
  period: string,
): string {
  return `${playerName} did not record any ${lowerLabel(stat.nounPlural ?? stat.label)} in ${period}.`;
}

/** When we hold nothing for the player in that season. */
export function noDataSentence(
  playerName: string,
  stat: BeamStat,
  period: string,
): string {
  return `We do not have ${lowerLabel(stat.label)} for ${playerName} in ${period}.`;
}

/** When the stat cannot apply to that position at all. */
export function wrongPositionSentence(
  playerName: string,
  stat: BeamStat,
  position: string | null,
): string {
  const what = position ? `a ${positionNoun(position)}` : "this player";
  return `We do not track ${lowerLabel(stat.label)} for ${what}, so there is nothing to report for ${playerName}.`;
}

export function positionNoun(position: string): string {
  switch (position.toUpperCase()) {
    case "QB":
      return "quarterback";
    case "RB":
      return "running back";
    case "WR":
      return "wide receiver";
    case "TE":
      return "tight end";
    case "K":
      return "kicker";
    case "DEF":
      return "team defense";
    default:
      return position;
  }
}

/** "Jahmyr Gibbs had more, 1,412 rushing yards to Bijan Robinson's 1,205." */
export function compareSentence(
  leaderName: string,
  trailerName: string,
  stat: BeamStat,
  leaderValue: number,
  trailerValue: number,
  period: string,
): string {
  const lead = formatStatValue(leaderValue, stat.format);
  const trail = formatStatValue(trailerValue, stat.format);
  const label = lowerLabel(stat.label);
  if (Math.abs(leaderValue - trailerValue) < 1e-9) {
    return `They tied. ${leaderName} and ${trailerName} both had ${lead} ${label} in ${period}.`;
  }
  // Read from the registry, not from a second list kept here. The two lists
  // disagreed about points allowed, and the answer named the right team with
  // the wrong verb.
  const verb = stat.lowerIsBetter ? "had fewer" : "had more";
  return `${leaderName} ${verb}: ${lead} ${label} in ${period} to ${shortName(trailerName)}'s ${trail}.`;
}

/** Where a player sits in the rankings. */
export function rankSentence(
  playerName: string,
  overallRank: number | null,
  positionRank: number | null,
  position: string | null,
  formatDisplay: string,
): string {
  if (overallRank === null && positionRank === null) {
    return `We do not currently rank ${playerName} in ${formatDisplay}.`;
  }
  // The position is spelled out, not left as a code. A screen reader speaks
  // "WR" as "W R", so "the 3rd WR" becomes "the third W R" in a sentence whose
  // whole job is to read like English.
  if (overallRank !== null && positionRank !== null && position) {
    return `${playerName} is the ${ordinal(positionRank)} ${positionNoun(position)} and ${ordinal(overallRank)} overall in ${formatDisplay}.`;
  }
  if (overallRank !== null) {
    return `${playerName} is ${ordinal(overallRank)} overall in ${formatDisplay}.`;
  }
  return `${playerName} is the ${ordinal(positionRank as number)} ${position ? positionNoun(position) : "player"} in ${formatDisplay}.`;
}

/** Build the provenance footnote every answer carries. */
export function buildContext(input: {
  formatDisplay?: string | null;
  sourceDisplay?: string | null;
  asOf?: string | null;
  note?: string | null;
}): BeamAnswerContext {
  return {
    formatDisplay: input.formatDisplay ?? null,
    sourceDisplay: input.sourceDisplay ?? null,
    asOf: input.asOf ?? null,
    note: input.note ?? null,
  };
}

/**
 * The provenance line, read aloud after the facts.
 *
 * Timestamps go through formatEastern so an answer never renders a time in the
 * server's UTC or the browser's local zone. That is a site-wide rule, and an
 * assistant quoting "as of 3am" to an East Coast reader would break it loudly.
 */
export function contextSentence(context: BeamAnswerContext): string | null {
  const parts: string[] = [];
  if (context.formatDisplay) parts.push(context.formatDisplay);
  if (context.sourceDisplay) parts.push(`${context.sourceDisplay} values`);
  let sentence = parts.length > 0 ? `Based on ${parts.join(", ")}.` : "";
  if (context.asOf) {
    const stamp = formatEastern(context.asOf);
    sentence = sentence ? `${sentence} Updated ${stamp}.` : `Updated ${stamp}.`;
  }
  if (context.note) {
    sentence = sentence ? `${sentence} ${context.note}` : context.note;
  }
  return sentence || null;
}

/**
 * Assemble what a screen reader hears.
 *
 * The visual card is a headline plus a two-column fact grid, and a grid does not
 * read aloud in a useful order. This flattens the same content into one
 * paragraph: headline, then each fact as "label, value", then the caveats, then
 * provenance. Facts are limited to what fits in a breath; the full set stays on
 * screen for anyone reading it.
 */
export function buildSpeech(input: {
  headline: string;
  /** Long-form prose, when the answer carries it. Spoken in full, right after
   * the headline, because prose is the answer rather than a supporting figure. */
  body?: string | null;
  facts: Array<{ label: string; value: string }>;
  caveats: string[];
  context: BeamAnswerContext;
  maxFacts?: number;
}): string {
  const parts = [input.headline];
  if (input.body?.trim()) parts.push(input.body.trim());

  // Facts the headline already said are DROPPED, not repeated.
  //
  // Every presenter leads with the number in the headline and then lists it
  // again as the first fact, because the card needs both. Read aloud that
  // produced "Brock Purdy threw for 3,864 yards in 2025. Passing yards: 3,864
  // passing yards. Season: 2025." The answer, then the grid, in sequence.
  //
  // A fact is redundant when its value already appears in the headline, so the
  // test is on the value rather than on a hand-maintained skip list that would
  // drift the moment a presenter changed its wording.
  const spokenHeadline = input.headline.toLowerCase();
  const novel = input.facts.filter((fact) => {
    const value = fact.value.trim().toLowerCase();
    if (!value) return false;
    return !spokenHeadline.includes(value);
  });

  const facts = novel.slice(0, input.maxFacts ?? 6);
  if (facts.length > 0) {
    parts.push(facts.map((f) => `${f.label}: ${f.value}.`).join(" "));
  }
  if (novel.length > facts.length) {
    const hidden = novel.length - facts.length;
    parts.push(`${hidden} more ${hidden === 1 ? "figure is" : "figures are"} on screen.`);
  }
  for (const caveat of input.caveats) parts.push(caveat);
  const provenance = contextSentence(input.context);
  if (provenance) parts.push(provenance);
  return parts.join(" ");
}
