/**
 * Pure formatting and estimation helpers for a Manager Pulse capture's
 * progress panel (docs/manager-pulse/manager-pulse-audit-and-speed-plan.md MPS-T022). No
 * clock read, no network call: every timestamp and count is passed in.
 */

/** m:ss, or h:mm:ss past an hour. Never negative. */
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * "about N minutes left", or null when there is not enough evidence.
 *
 * Null until `done >= minDone` and `elapsedMs >= minElapsedMs`, and null when
 * `remaining <= 0`. Rate is done / elapsed; the estimate is remaining / rate,
 * rounded up to whole minutes, and "about a minute left" below 90 seconds.
 * Stated as an estimate in the text itself, because it is one.
 */
export function estimateRemaining(input: {
  done: number;
  total: number;
  elapsedMs: number;
  minDone?: number;
  minElapsedMs?: number;
}): string | null {
  const { done, total, elapsedMs, minDone = 3, minElapsedMs = 30_000 } = input;

  if (done < minDone || elapsedMs < minElapsedMs) return null;

  const remaining = total - done;
  if (remaining <= 0) return null;

  const rate = done / elapsedMs;
  if (!(rate > 0)) return null;

  const remainingMs = remaining / rate;
  if (remainingMs < 90_000) return "about a minute left";

  const minutesLeft = Math.ceil(remainingMs / 60_000);
  return `about ${minutesLeft} minutes left`;
}
