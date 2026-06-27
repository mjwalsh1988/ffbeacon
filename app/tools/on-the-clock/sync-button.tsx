"use client";

/**
 * Sync Draft button + status line. CONTROLLED presentational component (Phase 5):
 * the parent owns the sync request, the shared cooldown countdown, and the status
 * message (driven by the real POST /draft/sync outcome). This component only
 * renders state and calls onSync; it performs NO network and schedules NO timers
 * or polling.
 *
 * Live-region: aria-live="polite" announces sync summaries (the assertive "your
 * turn" channel lives in the command header). The spinner is reduced-motion-safe.
 */

import { RefreshCw } from "lucide-react";

export function SyncButton({
  syncing,
  cooldownRemaining,
  statusMessage,
  onSync,
}: {
  syncing: boolean;
  cooldownRemaining: number;
  statusMessage: string;
  onSync: () => void;
}) {
  const disabled = syncing || cooldownRemaining > 0;
  const label = syncing
    ? "Syncing..."
    : cooldownRemaining > 0
      ? `Synced (${cooldownRemaining}s)`
      : "Sync draft";

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onSync}
        disabled={disabled}
        aria-describedby="otc-sync-status"
        className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-card bg-beacon px-4 py-2 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
      >
        <RefreshCw
          aria-hidden="true"
          className={`h-3.5 w-3.5 ${syncing ? "animate-spin motion-reduce:animate-none" : ""}`}
        />
        {label}
      </button>
      <p
        id="otc-sync-status"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="text-right text-xs text-ink-muted"
      >
        {statusMessage}
      </p>
    </div>
  );
}
