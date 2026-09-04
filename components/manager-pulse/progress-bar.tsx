/**
 * A real progress bar for a Manager Pulse capture (docs/manager-pulse-plan.md
 * 7.4). Presentational only: it takes counted work and renders it.
 *
 * ABSOLUTE RULE: NO PROGRESS BAR ANIMATES ON A TIMER. The fill is bound to a
 * counted fraction of real work (leagues actually read against leagues we
 * know we need to read). When the total is not known yet, the bar renders as
 * INDETERMINATE and says so in words, rather than as a determinate bar
 * showing a made-up percentage. A bar that fills while nothing is happening
 * is worse than a spinner, because it makes a promise the work is not keeping.
 *
 * `progressState` is the one place that decides indeterminate versus
 * determinate and computes the fraction. It is pure and exported for
 * ./progress-bar.test.ts; nothing here reads a clock or a timer.
 */

export type ProgressBarState =
  | { kind: "indeterminate"; text: string }
  | { kind: "determinate"; fraction: number; text: string };

/**
 * Decide the bar's state from real counts.
 *
 * - `total === null`: the run has not told us how many leagues it needs yet.
 *   Indeterminate.
 * - `total <= 0`: never divide by zero, and never claim a zero-length job is
 *   100% done. Indeterminate.
 * - Otherwise: determinate, fraction clamped to [0, 1] even if `done` and
 *   `failed` overshoot `total` (a stale read racing a fresher count).
 *
 * The text always names counts, never a percentage, because "31 of 44
 * leagues read" survives being spoken aloud and a bare "70%" does not say
 * what it is 70% of.
 */
export function progressState(
  done: number,
  failed: number,
  total: number | null,
): ProgressBarState {
  if (total === null) {
    return {
      kind: "indeterminate",
      text: done > 0 ? `${done} league${done === 1 ? "" : "s"} read so far` : "Preparing to read leagues",
    };
  }

  if (total <= 0) {
    return { kind: "indeterminate", text: "No leagues to read yet" };
  }

  const safeDone = Math.max(0, done);
  const safeFailed = Math.max(0, failed);
  const attempted = Math.min(safeDone + safeFailed, total);
  const fraction = Math.min(1, Math.max(0, attempted / total));

  const text =
    safeFailed > 0
      ? `${safeDone} of ${total} leagues read, ${safeFailed} failed`
      : `${safeDone} of ${total} leagues read`;

  return { kind: "determinate", fraction, text };
}

export function ProgressBar({
  done,
  failed,
  total,
  id,
  className,
  ariaLabel = "Report progress",
  ariaLabelledBy,
}: {
  done: number;
  failed: number;
  total: number | null;
  /** Passed through to the outer element, so a caller can `aria-describedby` it. */
  id?: string;
  className?: string;
  /** Accessible name, used only when `ariaLabelledBy` is not given. Without
   *  either, the bar announces with no indication of what job it tracks. */
  ariaLabel?: string;
  /** Id of an element that already states what this bar tracks (e.g. the
   *  "N of M leagues read" line beside it). Takes priority over `ariaLabel`
   *  so the name is not a second, differently worded copy of visible text. */
  ariaLabelledBy?: string;
}) {
  const state = progressState(done, failed, total);
  const percent = state.kind === "determinate" ? Math.round(state.fraction * 100) : null;

  return (
    <div
      id={id}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      // Indeterminate omits aria-valuenow entirely. That absence is what
      // tells assistive tech this is not a countable value yet; setting it to
      // 0 would say the opposite of what is true.
      aria-valuenow={state.kind === "determinate" ? percent! : undefined}
      aria-valuetext={state.text}
      aria-label={ariaLabelledBy ? undefined : ariaLabel}
      aria-labelledby={ariaLabelledBy}
      className={`h-2.5 w-full overflow-hidden rounded-full border border-line bg-surface ${className ?? ""}`}
    >
      {state.kind === "determinate" ? (
        <div
          className="h-full rounded-full bg-beacon transition-[width] duration-300 motion-reduce:transition-none"
          style={{ width: `${state.fraction * 100}%` }}
        />
      ) : (
        // Indeterminate: a fixed, non-animated pattern rather than a moving
        // sweep. It never implies a known amount of progress, and it never
        // moves on its own, so there is nothing for prefers-reduced-motion to
        // turn off.
        <div
          aria-hidden="true"
          className="h-full w-full opacity-40"
          style={{
            backgroundImage:
              "repeating-linear-gradient(135deg, rgb(168 85 247 / 0.6) 0px, rgb(168 85 247 / 0.6) 6px, transparent 6px, transparent 12px)",
          }}
        />
      )}
    </div>
  );
}
