"use client";

/**
 * The room's sync control: one button, two countdowns, one status line.
 *
 * CONTROLLED and presentational. The parent owns the request and the schedule
 * (lib/on-the-clock/use-draft-sync.ts) and hands this component two ABSOLUTE
 * instants; the per-second ticking happens here, in the only subtree that should
 * repaint once a second. Putting the seconds in the room's own state would
 * re-render the whole board every tick.
 *
 * Both windows are shared per draft, not per viewer: the numbers here are the same
 * numbers everyone else watching this draft is looking at.
 *
 * Screen readers. The room refreshes itself every minute for as long as it is
 * open, so every announcement this panel can make will be made a hundred times in
 * a long draft. That constraint drives the whole design:
 *   - The button's accessible name is the constant "Sync draft". The countdown
 *     rides beside it as aria-hidden text, so a name that changes every second
 *     never reaches the accessibility tree.
 *   - Nothing that ticks is inside a live region, and no ticking number is inside
 *     the button's description either. Descriptions are read on focus, and a
 *     number that moves under a resting cursor is a number that can be read wrong.
 *   - The button carries no aria-disabled. The shared cooldown opens and closes
 *     on its own twice a minute, and a control that reports itself unavailable
 *     and available again at a reader who did nothing is worse than one that
 *     answers when pressed. So it always answers: a press inside the cooldown
 *     goes to the status line with the exact wait, which is the one moment that
 *     number is worth speaking.
 *   - Only the status line announces, politely, and only when a sync produced
 *     something worth saying.
 */

import { useEffect, useId, useState } from "react";
import { RefreshCw } from "lucide-react";

function secondsUntil(target: number | null): number {
  if (target === null) return 0;
  return Math.max(0, Math.ceil((target - Date.now()) / 1000));
}

/**
 * Seconds left on both windows, from ONE interval.
 *
 * Recomputed from the wall clock every tick rather than decremented, so a
 * throttled background tab or a sleeping machine comes back to the right numbers
 * instead of ones frozen where they left off. The interval stops itself once both
 * windows are open, and a tick that moves neither number returns the previous
 * pair, so React skips the render entirely.
 */
function useCountdowns(manualTarget: number, autoTarget: number | null): [number, number] {
  const [pair, setPair] = useState<[number, number]>(() => [
    secondsUntil(manualTarget),
    secondsUntil(autoTarget),
  ]);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const stop = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
    const tick = () => {
      const manual = secondsUntil(manualTarget);
      const auto = secondsUntil(autoTarget);
      setPair((prev) => (prev[0] === manual && prev[1] === auto ? prev : [manual, auto]));
      if (manual <= 0 && auto <= 0) stop();
    };
    tick();
    if (secondsUntil(manualTarget) > 0 || secondsUntil(autoTarget) > 0) {
      timer = setInterval(tick, 1000);
    }
    return stop;
  }, [manualTarget, autoTarget]);

  return pair;
}

export function SyncPanel({
  syncing,
  manualReadyAt,
  autoDueAt,
  autoRefreshSeconds,
  autoPaused,
  autoAvailable,
  statusMessage,
  onSync,
}: {
  /** A sync is in flight, from either trigger. */
  syncing: boolean;
  /** Epoch ms when a manual press is allowed again. */
  manualReadyAt: number;
  /** Epoch ms of the next automatic refresh, or null when none is scheduled. */
  autoDueAt: number | null;
  /** The configured interval, for the plain-language explanation. */
  autoRefreshSeconds: number;
  /** The tab is in the background, so the automatic refresh is holding. */
  autoPaused: boolean;
  /** Automatic refresh is switched on for this room. */
  autoAvailable: boolean;
  statusMessage: string;
  onSync: () => void;
}) {
  const autoTarget = autoAvailable && !autoPaused ? autoDueAt : null;
  const [manualRemaining, autoRemaining] = useCountdowns(manualReadyAt, autoTarget);

  const id = useId();
  const hintId = `${id}-hint`;
  const statusId = `${id}-status`;
  const autoId = `${id}-auto`;

  const waiting = manualRemaining > 0;
  const unavailable = syncing || waiting;

  return (
    <div role="group" aria-label="Draft sync" className="flex flex-col items-end gap-1.5">
      <button
        type="button"
        onClick={onSync}
        aria-describedby={`${hintId} ${autoId} ${statusId}`}
        className={`inline-flex min-h-11 items-center justify-center gap-1.5 rounded-card px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan ${
          unavailable
            ? "cursor-not-allowed border border-line-accent bg-surface-elevated text-ink"
            : "bg-beacon text-black hover:opacity-90"
        }`}
      >
        <RefreshCw
          aria-hidden="true"
          className={`h-3.5 w-3.5 ${syncing ? "animate-spin motion-reduce:animate-none" : ""}`}
        />
        Sync draft
        {syncing ? (
          <span aria-hidden="true" className="font-normal opacity-80">
            (working)
          </span>
        ) : waiting ? (
          <span aria-hidden="true" className="font-normal tabular-nums opacity-80">
            ({manualRemaining}s)
          </span>
        ) : null}
      </button>

      {/* Why the button looks the way it does, and who the wait belongs to. The
          sentence is fixed; only the aria-hidden number moves, so this can sit in
          the button's description without changing under a resting cursor. */}
      <p id={hintId} className="text-right text-xs text-ink-muted">
        {syncing ? (
          "Pulling the latest picks from Sleeper."
        ) : waiting ? (
          <>
            <span>Sync is shared with everyone watching this draft.</span>{" "}
            <span aria-hidden="true" className="tabular-nums">
              Available again in {manualRemaining}s.
            </span>
          </>
        ) : (
          "Sync is shared with everyone watching this draft."
        )}
      </p>

      <p id={autoId} className="text-right text-xs text-ink-muted">
        {!autoAvailable ? (
          "Automatic refresh is off. Use Sync draft."
        ) : autoPaused ? (
          "Automatic refresh holds while this tab is in the background."
        ) : syncing ? (
          "Refreshing the room now."
        ) : (
          <>
            <span>This room refreshes itself every {autoRefreshSeconds} seconds.</span>{" "}
            <span aria-hidden="true" className="tabular-nums">
              {autoTarget === null || autoRemaining <= 0
                ? "Refreshing shortly."
                : `Next in ${autoRemaining}s.`}
            </span>
          </>
        )}
      </p>

      <p
        id={statusId}
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
