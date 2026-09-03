/**
 * The small formatters this section needs on top of the Schedule section's.
 *
 * WHAT IS NOT HERE, ON PURPOSE
 *   `fmtPoints`, `fmtSigned`, `pctLabel`, `pctWords`, `recordLabel`,
 *   `opponentLabel`, `opponentWords`, `ordinal`, `withUsername`, the hairline
 *   and the elevated wash all live in components/league-schedule/format.ts and
 *   are imported from there. Copying a points formatter is how "6-2" and
 *   "6-2-0" end up on the same page, and copying a gradient string is how one
 *   surface quietly drifts to a different purple.
 *
 * THE NULL RULE, INHERITED: nothing in here turns a null into a number. A
 * helper that returned "0.0" for a missing projection would put an answer on
 * the screen where there is none.
 */

import type { EnvironmentTier } from "@/lib/nfl-game-environment";
import type { TeamStatusKey } from "@/lib/league-team-status";

/**
 * The chip for a game environment band.
 *
 * COLOUR IS NEVER THE SIGNAL. Every one of these is drawn with the implied
 * total itself plus the band as a word (ENVIRONMENT_TIER_SHORT for the eye,
 * ENVIRONMENT_TIER_LABEL for the ear), so the tint is a scanning aid and
 * removing it loses nothing. Callers must keep it that way: a chip carrying
 * only the number and one of these classes says "high" in hue alone.
 */
/**
 * The band as ONE WORD, for a chip that already carries the number.
 *
 * ENVIRONMENT_TIER_LABEL ("High scoring") is the full form and goes to the ear
 * and anywhere there is room. This is what fits beside "24.5" in a table cell,
 * and it exists because the alternative was letting the tint be the only thing
 * saying high from low, which is the one thing the colour rule forbids.
 */
export const ENVIRONMENT_TIER_SHORT: Record<EnvironmentTier, string> = {
  high: "high",
  neutral: "avg",
  low: "low",
};

/**
 * What has to be APPENDED to the short form to finish the phrase for the ear.
 *
 * A chip that renders the band and then a visually hidden copy of the full
 * label announces "high scoring, high scoring for the week", which is the
 * duplication the aria-hidden rewrite was meant to remove rather than move.
 * These are completions, not repeats: the visible word is the start of the
 * spoken phrase and only the rest of it is hidden. "avg" gets an "erage"
 * because the abbreviation is not a word.
 */
export const ENVIRONMENT_TIER_SUFFIX: Record<EnvironmentTier, string> = {
  high: " scoring for the week",
  neutral: "erage scoring for the week",
  low: " scoring for the week",
};

export const ENVIRONMENT_TIER_CLASS: Record<EnvironmentTier, string> = {
  high: "border-brand-cyan/50 text-brand-cyan",
  neutral: "border-line text-ink-muted",
  low: "border-signal-warning/40 text-signal-warning",
};

/** The status chip, matched to the three bands. Paired with the word every time. */
export const STATUS_TONE: Record<TeamStatusKey, string> = {
  competitor: "border-brand-cyan/50 bg-brand-cyan/10 text-brand-cyan",
  middle: "border-line-accent bg-base/60 text-ink-muted",
  rebuilder: "border-brand-purple/50 bg-brand-purple/10 text-brand-purple",
};

/**
 * How likely a player is to beat his own projection, in words.
 *
 * 50% is the coin flip and it is said out loud, because a bare "48%" invites a
 * reader to think it is bad when it is the middle of the distribution. Above
 * 55 and below 45 are the only two bands that get an adjective; everything
 * between them is "about even", because the sample behind a beat rate is a
 * handful of weeks and pretending to resolve 51 from 49 would be inventing
 * precision.
 */
export function beatRateWords(rate: number | null): string {
  if (rate === null) return "Not enough weeks yet";
  const percent = Math.round(rate * 100);
  if (percent >= 55) return `${percent}%, beats it more often than not`;
  if (percent <= 45) return `${percent}%, misses it more often than not`;
  return `${percent}%, about even`;
}

/** Short form for a chip. The full sentence goes in the accessible name. */
export function beatRateChip(rate: number | null): string | null {
  if (rate === null) return null;
  return `${Math.round(rate * 100)}% beat`;
}

/**
 * `beatRateWords` WITHOUT the percentage it opens with.
 *
 * For a cell that already draws the number. Appending the full phrase beside a
 * visible "62% beat" announces "62% beat rate, 62%, beats it more often than
 * not", which says the figure twice. The full form stays for the dialog, where
 * there is no visible number for it to collide with.
 */
export function beatRateQualifier(rate: number | null): string | null {
  if (rate === null) return null;
  const percent = Math.round(rate * 100);
  if (percent >= 55) return "beats it more often than not";
  if (percent <= 45) return "misses it more often than not";
  return "about even";
}

/**
 * The opponent-strength multiplier, as a word a reader can act on.
 *
 * Above 1 means the defense has allowed MORE than average to this position, so
 * it is a soft matchup for the player. That direction is easy to get backwards,
 * which is why it is decided in one place.
 */
export function matchupWords(multiplier: number | null): string | null {
  if (multiplier === null) return null;
  const percent = Math.round(Math.abs(multiplier - 1) * 100);
  if (percent < 2) return "Neutral matchup";
  return multiplier > 1 ? `Soft matchup, +${percent}%` : `Tough matchup, -${percent}%`;
}

/** The tint that goes with it. Never the only carrier of the meaning. */
export function matchupTone(multiplier: number | null): string {
  if (multiplier === null) return "border-line text-ink-subtle";
  const percent = Math.round(Math.abs(multiplier - 1) * 100);
  if (percent < 2) return "border-line text-ink-muted";
  return multiplier > 1
    ? "border-brand-cyan/50 text-brand-cyan"
    : "border-signal-warning/40 text-signal-warning";
}

/**
 * Positional WAR for one player, in words.
 *
 * THE NAMING RULE (CLAUDE.md): the token "WAR" carries the word "Positional"
 * adjacent to it on first use in any surface, and it never describes what a
 * player is worth to THIS team. So the phrase is about his rank in a scarce
 * position, which is what the metric actually measures.
 */
export function positionalWarWords(
  war: number | null,
  rank: number | null,
  poolSize: number | null,
  position: string,
): string {
  if (war === null) return "Positional WAR not built for this league yet";
  const place =
    rank !== null && poolSize !== null
      ? `${rank} of ${poolSize} at ${position || "his position"}`
      : rank !== null
        ? `${rank} at ${position || "his position"}`
        : "unranked";
  return `${war.toFixed(2)} Positional WAR, ${place}.`;
}

/** "0.42" or null. The label beside it supplies the word "Positional WAR". */
export function warFigure(war: number | null): string | null {
  return war === null ? null : war.toFixed(2);
}

/**
 * `positionalWarWords` WITHOUT the figure it opens with.
 *
 * Same reason as `beatRateQualifier`: a cell that draws "0.42" and then appends
 * the full sentence announces "0.42, 0.42 Positional WAR, 3 of 24 at QB". This
 * is the tail on its own, so the visible number is said once.
 *
 * THE NAMING RULE still holds: the token "WAR" carries "Positional" beside it.
 */
export function positionalWarPlace(
  rank: number | null,
  poolSize: number | null,
  position: string,
): string {
  return `Positional WAR, ${positionalWarRankPhrase(rank, poolSize, position)}`;
}

/**
 * Where he sits, with no metric name in front of it: "3 of 24 at QB".
 *
 * For a surface whose LABEL already says "Positional WAR", where prefixing it
 * again reads as "Positional WAR: 0.42 Positional WAR, 3 of 24 at QB". The
 * naming rule is satisfied by that label, which is the first use on the
 * surface.
 */
export function positionalWarRankPhrase(
  rank: number | null,
  poolSize: number | null,
  position: string,
): string {
  const where = position || "his position";
  if (rank !== null && poolSize !== null) return `${rank} of ${poolSize} at ${where}`;
  if (rank !== null) return `${rank} at ${where}`;
  return "unranked";
}

/**
 * Lineup efficiency as a percentage, for the headline.
 *
 * Rounded to a whole number, because the difference between 97.4% and 97.6% is
 * a tenth of a point in a projection with a seven point spread on it.
 */
export function efficiencyLabel(efficiency: number | null): string | null {
  if (efficiency === null) return null;
  return `${Math.round(efficiency * 100)}%`;
}
