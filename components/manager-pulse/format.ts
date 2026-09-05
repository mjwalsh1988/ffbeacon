/**
 * The formatting vocabulary for Manager Pulse's report sections.
 *
 * Four section components read the same figures, so the wording has to come
 * from one place or "62%" in one card and "62.0%" in another read as two
 * different tools disagreeing about the same manager.
 *
 * THE NULL RULE. A null in this feature means "we could not measure this",
 * never "this measured as zero". Every formatter below returns a plain dash
 * for null and never a "0", a "0%" or an empty string standing in for a real
 * value. `docs/manager-pulse-plan.md` section 14 states the same rule for the
 * whole feature; this file is where it is enforced for display.
 */

import type { ManagerRecord } from "@/lib/manager-pulse/types";

/** The visible stand-in for "we have nothing to show here". */
const DASH = "--";

function isFiniteNumber(v: number | null | undefined): v is number {
  return v !== null && v !== undefined && Number.isFinite(v);
}

/** "62%" from a 0 to 1 share. Null renders as a dash, never "0%". */
export function formatPercent(v: number | null, digits = 0): string {
  if (!isFiniteNumber(v)) return DASH;
  return `${(v * 100).toFixed(digits)}%`;
}

/** A plain decimal rate, "2.4" for something like moves per week. */
export function formatRate(v: number | null): string {
  if (!isFiniteNumber(v)) return DASH;
  return v.toFixed(1);
}

/** A whole-number count, "14". Never rounds a fraction into hiding. */
export function formatCount(v: number | null): string {
  if (!isFiniteNumber(v)) return DASH;
  return Math.round(v).toLocaleString("en-US");
}

/**
 * "34-19-1". A win-loss-ties record. Ties are dropped from the string when
 * there are none, matching the record format used across League Pulse
 * (`components/league-schedule/format.ts recordLabel`), so a manager's record
 * reads the same wherever it appears on the site.
 */
export function formatRecord(r: ManagerRecord | null): string {
  if (!r) return DASH;
  const base = `${r.wins}-${r.losses}`;
  return r.ties > 0 ? `${base}-${r.ties}` : base;
}

/**
 * A signed figure with an optional unit. "+0.8 rounds" for a delta with a
 * word unit, "-8%" for one whose unit is a percent sign, which never gets a
 * space before it. A unit of `undefined` renders no unit at all.
 */
export function formatSigned(v: number | null, unit?: string): string {
  if (!isFiniteNumber(v)) return DASH;
  const sign = v > 0 ? "+" : v < 0 ? "-" : "";
  const magnitude = Math.abs(v).toFixed(1);
  if (!unit) return `${sign}${magnitude}`;
  const separator = unit.startsWith("%") ? "" : " ";
  return `${sign}${magnitude}${separator}${unit}`;
}

/**
 * "over 14 trades" / "over 1 trade". Pass the singular noun; the plural is
 * built by appending "s". Null means there is no sample to speak of, so this
 * returns an empty string rather than a sentence about zero evidence.
 */
export function formatSample(n: number | null, noun: string): string {
  if (!isFiniteNumber(n) || n <= 0) return "";
  const label = n === 1 ? noun : `${noun}s`;
  return `over ${formatCount(n)} ${label}`;
}

/** "0.8 rounds" / "1 round". An unsigned rounds figure. */
export function formatRounds(v: number | null): string {
  if (!isFiniteNumber(v)) return DASH;
  const magnitude = Math.abs(v);
  const label = magnitude.toFixed(1) === "1.0" ? "round" : "rounds";
  return `${magnitude.toFixed(1)} ${label}`;
}

/**
 * "42 seconds" / "1 second". Used by the draft clock card, where both the
 * whole-draft pace and the per-pick measurement are quoted in seconds.
 */
export function formatSeconds(v: number | null): string {
  if (!isFiniteNumber(v)) return DASH;
  const whole = Math.round(v);
  return `${whole} second${whole === 1 ? "" : "s"}`;
}

/**
 * A duration in seconds, in whatever unit reads as a number a person would
 * say out loud: "42 seconds", "33 minutes", "2.1 hours".
 *
 * The draft clock is why this exists. An asynchronous dynasty rookie draft
 * runs for days with overnight pauses in it, so its honest pace lands in the
 * thousands of seconds, and "2007 seconds a pick" is a figure nobody can read
 * at a glance even though it is true.
 */
export function formatDuration(v: number | null): string {
  if (!isFiniteNumber(v)) return DASH;
  const seconds = Math.abs(v);
  if (seconds < 90) {
    const whole = Math.round(seconds);
    return `${whole} second${whole === 1 ? "" : "s"}`;
  }
  if (seconds < 5400) {
    const minutes = Math.round(seconds / 60);
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  const hours = seconds / 3600;
  return `${hours.toFixed(1)} hours`;
}

/**
 * A large league-value figure at a readable width: "131.6k", "1.2M", "845".
 *
 * Position appetite sums market values across hundreds of trades, so its raw
 * figure runs to six digits. Printed in full it reads as an account balance
 * rather than as a direction, and the direction is the whole point of the
 * card. The sign is dropped on purpose: every caller states buying or selling
 * in words beside it.
 */
export function formatCompactValue(v: number | null): string {
  if (!isFiniteNumber(v)) return DASH;
  const magnitude = Math.abs(v);
  if (magnitude >= 1_000_000) return `${(magnitude / 1_000_000).toFixed(1)}M`;
  if (magnitude >= 1_000) return `${(magnitude / 1_000).toFixed(1)}k`;
  return formatCount(magnitude);
}
