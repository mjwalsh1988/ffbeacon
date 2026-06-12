/**
 * Small date/time formatting helpers for server-rendered admin surfaces.
 * Times are rendered in UTC because the crons are scheduled and reasoned about
 * in UTC; mixing in a viewer-local zone would make "did the 07:00 run fire?"
 * harder to answer.
 */

const NA = "n/a";

/** "Jun 12, 2026, 7:30 AM UTC" or n/a. */
export function formatUtc(iso: string | null | undefined): string {
  if (!iso) return NA;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return NA;
  return (
    new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC",
    }).format(d) + " UTC"
  );
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
