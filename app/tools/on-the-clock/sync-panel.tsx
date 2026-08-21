"use client";

/**
 * The room's sync control: a small card holding one button, the two countdowns,
 * and the status line.
 *
 * CONTROLLED and presentational. The parent owns the request and the schedule
 * (lib/on-the-clock/use-draft-sync.ts) and hands this component two ABSOLUTE
 * instants; the per-second ticking happens here, in the only subtree that should
 * repaint once a second. Putting the seconds in the room's own state would
 * re-render the whole board every tick.
 *
 * LAYOUT
 * The card is what stops this reading as three loose lines floating beside the
 * league name. It goes full width on mobile, where it sits on its own row under
 * the title and the button spans it, and shrinks to a fixed column on the right
 * of the header from sm up. The button is deliberately small: it is a repeat
 * action, not the thing you came to the page for. It keeps a 44px tap target on
 * mobile and drops to 32px on desktop, where a pointer is doing the aiming.
 *
 * TEXT
 * Two short lines, not three sentences. The timers read "Auto in 42s" and
 * "Sync in 12s", and the explanation of what they mean lives in the button's
 * screen-reader description instead of on screen, because it is the same
 * sentence every second of a two-hour draft.
 *
 * SCREEN READERS
 * The room refreshes itself every minute for as long as it is open, so every
 * announcement this panel can make would be made a hundred times in a long
 * draft. That constraint drives the whole design:
 *   - The button's accessible name is the constant "Sync draft".
 *   - The ticking line is aria-hidden. Its numbers move every second and cannot
 *     be acted on; the description carries the same facts without moving.
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
  /** A sync the reader asked for is in flight. False during an auto refresh. */
  syncing: boolean;
  /** Epoch ms when a manual press is allowed again. */
  manualReadyAt: number;
  /** Epoch ms of the next automatic refresh, or null when none is scheduled. */
  autoDueAt: number | null;
  /** The configured interval, for the screen-reader description. */
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

  const waiting = manualRemaining > 0;
  const unavailable = syncing || waiting;

  // The visible timer line, aria-hidden. Short enough to sit on one row next to
  // the button on desktop and under it on mobile.
  const autoText = !autoAvailable
    ? "Auto off"
    : autoPaused
      ? "Auto paused"
      : autoTarget === null || autoRemaining <= 0
        ? "Refreshing"
        : `Auto in ${autoRemaining}s`;

  return (
    <div
      role="group"
      aria-label="Draft sync"
      className="w-full rounded-card border border-line bg-surface/40 p-2.5 sm:w-56"
    >
      <button
        type="button"
        onClick={onSync}
        aria-describedby={`${hintId} ${statusId}`}
        className={`inline-flex w-full min-h-11 items-center justify-center gap-1.5 rounded border px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan sm:min-h-8 ${
          unavailable
            ? "cursor-not-allowed border-line-accent bg-surface-elevated text-ink"
            : "border-transparent bg-beacon text-black hover:opacity-90"
        }`}
      >
        <RefreshCw
          aria-hidden="true"
          className={`h-3 w-3 shrink-0 ${syncing ? "animate-spin motion-reduce:animate-none" : ""}`}
        />
        {syncing ? "Syncing" : "Sync draft"}
      </button>

      {/* The facts, held still. Everything the ticking line says, in a form that
          does not move, so it can be the button's description without changing
          under a resting cursor. */}
      <p id={hintId} className="sr-only">
        {`Shared with everyone watching this draft.${
          autoAvailable ? ` The room also refreshes itself every ${autoRefreshSeconds} seconds.` : ""
        }`}
      </p>

      {/* The countdowns. Hidden from screen readers: the numbers move every
          second, nothing can be done about either of them, and a press answers
          with the exact wait when it matters. */}
      <p
        aria-hidden="true"
        className="mt-1.5 flex items-baseline justify-between gap-2 text-[11px] tabular-nums text-ink-subtle"
      >
        <span>{autoText}</span>
        {waiting ? <span>Sync in {manualRemaining}s</span> : null}
      </p>

      <p
        id={statusId}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="mt-1 text-[11px] leading-snug text-ink-muted"
      >
        {statusMessage}
      </p>
    </div>
  );
}
