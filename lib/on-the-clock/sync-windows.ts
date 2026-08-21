/**
 * The two shared countdowns an On The Clock room runs on.
 *
 * Both are derived from ONE server timestamp, `on_the_clock_draft_cache.last_synced_at`,
 * which advances only when a sync actually reached Sleeper (complete_on_the_clock_sync).
 * Anchoring on the draft's own clock rather than on any one browser's is what makes the
 * cooldowns global: two people who opened the room a minute apart still count down
 * together, and neither can shorten the other's window.
 *
 *   manual  the Sync draft button, the shorter window (default 30s)
 *   auto    the room's unattended refresh, the longer one (default 60s)
 *
 * The countdowns are advisory. The authority is claim_on_the_clock_sync, which is
 * evaluated in Postgres before any Sleeper call, so a browser whose clock runs fast
 * gets a denial and the true remaining seconds back, not an extra Sleeper fetch.
 *
 * Pure: no Supabase, no Sleeper, and no clock beyond the `nowMs` handed in.
 */

export interface SyncWindowSeconds {
  /** Seconds until the manual Sync button is allowed again. */
  manualRemainingSeconds: number;
  /** Seconds until the room's shared automatic refresh is due. */
  autoRemainingSeconds: number;
}

function remaining(windowSeconds: number, elapsedSeconds: number): number {
  if (!Number.isFinite(windowSeconds) || windowSeconds <= 0) return 0;
  // Clamped at both ends. A stamp in the FUTURE (sub-second skew between the
  // database that writes it and the server that formats it, or a genuinely wrong
  // clock) would otherwise produce a countdown longer than the window itself and
  // strand the room; a negative elapsed is treated as zero elapsed.
  const clamped = Math.min(Math.max(elapsedSeconds, 0), windowSeconds);
  return Math.max(0, Math.ceil(windowSeconds - clamped));
}

export function syncWindows(
  lastSyncedAt: string | null,
  opts: { manualCooldownSeconds: number; autoRefreshSeconds: number; nowMs: number },
): SyncWindowSeconds {
  const stampMs = lastSyncedAt ? Date.parse(lastSyncedAt) : Number.NaN;
  if (!Number.isFinite(stampMs)) {
    // Never synced, or an unparseable stamp: both windows are open now.
    return { manualRemainingSeconds: 0, autoRemainingSeconds: 0 };
  }
  const elapsed = (opts.nowMs - stampMs) / 1000;
  return {
    manualRemainingSeconds: remaining(opts.manualCooldownSeconds, elapsed),
    autoRemainingSeconds: remaining(opts.autoRefreshSeconds, elapsed),
  };
}
