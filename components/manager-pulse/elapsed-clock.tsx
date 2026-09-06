"use client";

/**
 * The elapsed-time clock beside a Manager Pulse (or League Pulse) progress
 * bar (docs/manager-pulse/manager-pulse-audit-and-speed-plan.md MPS-T023).
 *
 * Deliberately outside any `aria-live` region and carrying no `role`: a
 * ticking clock announced every second would make the panel unusable with a
 * screen reader. A reader who tabs to or otherwise lands on the `<time>`
 * element hears the current reading once, on demand, same as any other
 * static text. The word "elapsed" lives in a sibling span so the announcement
 * reads "2:14 elapsed" rather than a bare number.
 *
 * The fill of the progress bar next to this clock is never driven by this
 * timer: it is bound to counted work only (see progress-bar.tsx).
 */

import { useEffect, useState } from "react";
import { formatElapsed } from "@/lib/manager-pulse/progress-estimate";

export function ElapsedClock({
  requestedAt,
  running,
  id,
}: {
  /** ISO timestamp the run was requested at. */
  requestedAt: string;
  /** Whether to keep ticking. False renders the elapsed time at the moment
   *  this became false and stops updating it. */
  running: boolean;
  id?: string;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!running) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [running]);

  const ms = Math.max(0, now - Date.parse(requestedAt));
  const seconds = Math.floor(ms / 1000);

  return (
    <span className="inline-flex items-baseline gap-1 text-xs text-ink-muted">
      <time id={id} dateTime={`PT${seconds}S`}>
        {formatElapsed(ms)}
      </time>
      <span>elapsed</span>
    </span>
  );
}
