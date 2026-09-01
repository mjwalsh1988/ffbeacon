/**
 * Small date/time formatting helpers.
 *
 * Every timestamp shown anywhere on the site is rendered in America/New_York so
 * the displayed time is consistent for all viewers regardless of their device's
 * zone. This is a DISPLAY concern only: stored timestamps stay in UTC. The zone
 * label (EST/EDT) is included on time-of-day displays so the zone is explicit.
 */

/** The single display timezone for the whole site (front-end only). */
export const SITE_TIME_ZONE = "America/New_York";

const NA = "n/a";

/**
 * The formatters, built once.
 *
 * `Intl.DateTimeFormat` is expensive to construct and free to reuse, and every
 * one of these takes options that never vary. Building them per call cost about
 * 63 ms on a 200 row page (measured: 600 constructions in 65 ms against 2 ms
 * reused), on every page that renders a list of dates. Nothing here depends on
 * request state, so module scope is safe.
 */
const EASTERN_DATE_TIME = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: SITE_TIME_ZONE,
  timeZoneName: "short",
});

const EASTERN_DATE = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: SITE_TIME_ZONE,
});

const EASTERN_SHORT_DATE = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: SITE_TIME_ZONE,
});

const RELATIVE = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });

/** "Jun 12, 2026, 7:30 AM EDT" in America/New_York, or n/a. */
export function formatEastern(iso: string | null | undefined): string {
  if (!iso) return NA;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return NA;
  return EASTERN_DATE_TIME.format(d);
}

/** "Jun 12, 2026" in America/New_York, or n/a. Date only, no time-of-day, so
 * no zone label is needed (a calendar date is unambiguous across US zones). */
export function formatEasternDate(iso: string | null | undefined): string {
  if (!iso) return NA;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return NA;
  return EASTERN_DATE.format(d);
}

/** "Jun 12" in America/New_York, or n/a. For dense axis labels where the year
 * is already established by the surrounding copy. Date only, so no zone label. */
export function formatEasternShortDate(iso: string | null | undefined): string {
  if (!iso) return NA;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return NA;
  return EASTERN_SHORT_DATE.format(d);
}

/**
 * RFC 822 date for RSS `pubDate` and `lastBuildDate`, in America/New_York.
 *
 * Example: "Wed, 29 Jul 2026 18:13:23 -0400".
 *
 * RSS 2.0 requires RFC 822, so this cannot use the Intl formats above. It still
 * expresses the site's zone rather than GMT: the numeric offset is valid RFC 822,
 * every feed reader converts it correctly, and it keeps the site's one display zone
 * consistent instead of introducing a second one. The offset shifts with daylight
 * saving on its own, so nothing is hardcoded.
 *
 * Returns null for a missing or unparseable input, so callers can omit the element
 * rather than emit an invalid date that would fail feed validation.
 */
export function formatRfc822Eastern(
  iso: string | null | undefined,
): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SITE_TIME_ZONE,
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "longOffset",
  }).formatToParts(d);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";

  // longOffset yields "GMT-04:00"; RFC 822 wants "-0400".
  const offset = get("timeZoneName").replace("GMT", "").replace(":", "");
  // Hour can come back as "24" at midnight under hour12: false in some runtimes.
  const hour = get("hour") === "24" ? "00" : get("hour");

  return `${get("weekday")}, ${get("day")} ${get("month")} ${get("year")} ${hour}:${get("minute")}:${get("second")} ${offset || "+0000"}`;
}

/** "3 hours ago", "in 5 minutes", "yesterday", relative to nowMs. */
export function formatRelative(
  iso: string | null | undefined,
  nowMs: number = Date.now(),
): string {
  if (!iso) return NA;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return NA;
  const diffMs = t - nowMs;
  const min = 60_000;
  const hour = 60 * min;
  const day = 24 * hour;
  const abs = Math.abs(diffMs);
  if (abs < min) return "just now";
  if (abs < hour) return RELATIVE.format(Math.round(diffMs / min), "minute");
  if (abs < day) return RELATIVE.format(Math.round(diffMs / hour), "hour");
  return RELATIVE.format(Math.round(diffMs / day), "day");
}

/** "850 ms", "4.2s", "4m 32s", or n/a. */
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || Number.isNaN(ms)) return NA;
  if (ms < 1000) return `${ms} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s}s`;
}
