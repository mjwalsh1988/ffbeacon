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

/** "Jun 12, 2026, 7:30 AM EDT" in America/New_York, or n/a. */
export function formatEastern(iso: string | null | undefined): string {
  if (!iso) return NA;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return NA;
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: SITE_TIME_ZONE,
    timeZoneName: "short",
  }).format(d);
}

/** "Jun 12, 2026" in America/New_York, or n/a. Date only, no time-of-day, so
 * no zone label is needed (a calendar date is unambiguous across US zones). */
export function formatEasternDate(iso: string | null | undefined): string {
  if (!iso) return NA;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return NA;
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: SITE_TIME_ZONE,
  }).format(d);
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
  const rtf = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });
  const min = 60_000;
  const hour = 60 * min;
  const day = 24 * hour;
  const abs = Math.abs(diffMs);
  if (abs < min) return "just now";
  if (abs < hour) return rtf.format(Math.round(diffMs / min), "minute");
  if (abs < day) return rtf.format(Math.round(diffMs / hour), "hour");
  return rtf.format(Math.round(diffMs / day), "day");
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
