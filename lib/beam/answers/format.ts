/**
 * Number and word formatting for BEAM answers.
 *
 * Small, boring, and centralised for one reason: an assistant that writes "1
 * touchdowns" has told the reader it is a template, and everything else it says
 * gets read as template output too. Agreement, separators, and rounding are
 * decided here so no presenter has to remember them.
 */

import type { StatFormat } from "@/lib/beam/stats/registry";

/** Thousands separators, no decimals. 3864 becomes "3,864". */
export function int(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

/** One decimal, with separators. 290.44 becomes "290.4". */
export function dec1(value: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

export function pct(value: number): string {
  return `${value.toFixed(1)}%`;
}

/** Format a stat value the way its registry entry asks for. */
export function formatStatValue(value: number, format: StatFormat): string {
  switch (format) {
    case "count":
      // A count that is not whole is a rate in disguise (defensive sacks are
      // recorded in halves), so keep the decimal rather than rounding it away.
      return Number.isInteger(value) ? int(value) : dec1(value);
    case "yards":
      return int(value);
    case "decimal1":
      return dec1(value);
    case "percent":
      return pct(value);
    default:
      return String(value);
  }
}

/**
 * "3,864 passing yards" / "1 passing yard".
 *
 * Agreement is decided by the unrounded value so 1.0 reads singular and 1.4 does
 * not, and stats with no sensible noun (a percentage) return the value alone.
 */
export function withNoun(
  value: number,
  formatted: string,
  singular: string | null,
  plural: string | null,
): string {
  if (!singular || !plural) return formatted;
  const isOne = Math.abs(value - 1) < 1e-9;
  return `${formatted} ${isOne ? singular : plural}`;
}

/** "1st", "2nd", "23rd". Used for ranks and season finishes. */
export function ordinal(value: number): string {
  const n = Math.round(value);
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${int(n)}th`;
  switch (n % 10) {
    case 1:
      return `${int(n)}st`;
    case 2:
      return `${int(n)}nd`;
    case 3:
      return `${int(n)}rd`;
    default:
      return `${int(n)}th`;
  }
}

/** A signed change, for value movement. "+140" / "-85" / "no change". */
export function signed(value: number, digits = 0): string {
  if (Math.abs(value) < (digits === 0 ? 0.5 : 0.05)) return "no change";
  const magnitude = digits === 0 ? int(Math.abs(value)) : Math.abs(value).toFixed(digits);
  return `${value > 0 ? "+" : "-"}${magnitude}`;
}

/** First name only, so a two-player sentence does not read like a roll call. */
export function shortName(fullName: string): string {
  const first = fullName.trim().split(/\s+/)[0];
  return first && first.length > 1 ? first : fullName;
}

/** "QB, SF" / "QB" / "" depending on what we hold. */
export function positionTeam(position: string | null, team: string | null): string {
  if (position && team) return `${position}, ${team}`;
  if (position) return position;
  if (team) return team;
  return "";
}

/** Join a list the way a person would. "a", "a and b", "a, b, and c". */
export function joinList(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

/** Sentence-case a label for use mid-sentence. "Passing yards" -> "passing yards". */
export function lowerLabel(label: string): string {
  if (label.length === 0) return label;
  // Leave acronyms alone: "PPR points" should not become "pPR points".
  if (label.slice(0, 2) === label.slice(0, 2).toUpperCase() && /[A-Z]/.test(label[1] ?? "")) {
    return label;
  }
  return label[0].toLowerCase() + label.slice(1);
}
