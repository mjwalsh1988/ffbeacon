/**
 * Cadence-aware staleness gate for the source_value producer (plan v3.1, 3c).
 *
 * A broken-but-still-active source keeps its last successful snapshot in
 * player_value_history. Without a gate, source_value would blend that days- or
 * weeks-old value as if it were current. The gate discards any snapshot older
 * than a per-source max age, so the source drops out of the blend exactly as if
 * it were inactive.
 *
 * The constants here are FALLBACK DEFAULTS only. The DB-backed source of truth
 * is beacon_settings (stale_after_days_daily / _weekly / _default), loaded into
 * StaleDays by lib/beacon/settings.ts. Nothing here needs a code deploy to tune.
 */

export const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Fallback defaults, mirroring INTERVAL_DAYS_BY_CADENCE in calculate-trends.
// daily 3: tolerates ~3 missed nightly runs before presuming a break (one day
// past the +/-2 bookend tolerance). weekly 10: 7-day cadence plus 3 days grace
// for a late publish. Overridden by beacon_settings at runtime.
export const STALE_AFTER_DAYS_BY_CADENCE: Record<string, number> = {
  daily: 3,
  weekly: 10,
};
export const DEFAULT_STALE_AFTER_DAYS = 3;

export interface StaleDays {
  daily: number;
  weekly: number;
  default: number;
}

export const FALLBACK_STALE_DAYS: StaleDays = {
  daily: STALE_AFTER_DAYS_BY_CADENCE.daily,
  weekly: STALE_AFTER_DAYS_BY_CADENCE.weekly,
  default: DEFAULT_STALE_AFTER_DAYS,
};

/** Max age in days for a source of the given cadence. */
export function staleDaysFor(cadence: string, days: StaleDays): number {
  if (cadence === "daily") return days.daily;
  if (cadence === "weekly") return days.weekly;
  return days.default;
}

/** Cutoff timestamp (ms). Snapshots with captured_at < cutoff are stale. */
export function staleCutoffMs(
  cadence: string,
  nowMs: number,
  days: StaleDays,
): number {
  return nowMs - staleDaysFor(cadence, days) * MS_PER_DAY;
}

/** True when a snapshot captured at capturedAtMs is still fresh for its cadence. */
export function isFresh(
  capturedAtMs: number,
  cadence: string,
  nowMs: number,
  days: StaleDays,
): boolean {
  return capturedAtMs >= staleCutoffMs(cadence, nowMs, days);
}
