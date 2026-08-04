/**
 * The shapes the Sync all queue exchanges with the browser.
 *
 * Split out of lib/league-bulk-sync.ts on purpose: that module reaches
 * lib/league-pulse.ts, which reaches Sleeper and the service-role client. A
 * client component importing a type from it would drag the whole server chain
 * into the bundle. Types and two constants have no such dependency, so they live
 * here and both sides import from here.
 */

export type LeagueSyncJobStatus = "pending" | "processing" | "done" | "failed";

/** One press per twelve hours per user. Enforced by enqueue_bulk_league_sync. */
export const BULK_SYNC_COOLDOWN_SECONDS = 12 * 60 * 60;

export type BulkSyncState = {
  requestId: string | null;
  /** True while at least one league in the newest request is still queued. */
  active: boolean;
  total: number;
  pending: number;
  processing: number;
  done: number;
  failed: number;
  requestedAt: string | null;
  /** When the twelve-hour window opens again. Null when it already has. */
  nextAllowedAt: string | null;
  canStart: boolean;
  /** Per-league status for the newest request, keyed by Sleeper league id. */
  jobStatuses: Record<string, LeagueSyncJobStatus>;
};

export const IDLE_BULK_SYNC_STATE: BulkSyncState = {
  requestId: null,
  active: false,
  total: 0,
  pending: 0,
  processing: 0,
  done: 0,
  failed: 0,
  requestedAt: null,
  nextAllowedAt: null,
  canStart: true,
  jobStatuses: {},
};

/**
 * Reconcile the two things that describe the same batch: the copy that came down
 * with a server render, and the copy the Sync all button got from its own poll.
 *
 * They race. A render that started before a job finished can resolve after the
 * poll that saw it finish, and taking it would walk the count backwards and put
 * a "Queued" badge back on a row that had just cleared. So the server copy wins
 * only when it describes a DIFFERENT batch (a new press, or the first one this
 * page has seen) or has got at least as far as what is already on screen.
 *
 * Finished jobs never un-finish, so "as far as" is a safe ordering: progress is
 * monotonic within one request id.
 */
export function mergeBulkSyncState(
  prev: BulkSyncState,
  incoming: BulkSyncState,
): BulkSyncState {
  if (incoming.requestId !== prev.requestId) return incoming;
  const incomingProgress = incoming.done + incoming.failed;
  const prevProgress = prev.done + prev.failed;
  return incomingProgress >= prevProgress ? incoming : prev;
}
