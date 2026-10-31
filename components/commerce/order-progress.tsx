/**
 * The four-step tracker: Ordered, Paid, In progress, Delivered.
 *
 * An ordered list with `aria-current="step"` on the current step, and a word on
 * every mark, so nothing depends on the color or the shape. A row from `sm`, a
 * column below it with the connector running down the left. The connector and the
 * pulse are decoration; under reduced motion nothing moves.
 */

import { Check, X } from "lucide-react";
import type { ProgressStep, StepState } from "@/lib/commerce/transitions";

const STATE_WORD: Record<StepState, string> = {
  complete: "complete",
  current: "current step",
  upcoming: "not reached yet",
  failed: "did not complete",
};

function Mark({ state }: { state: StepState }) {
  if (state === "complete") {
    return (
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-signal-positive text-black">
        <Check aria-hidden="true" className="h-4 w-4" strokeWidth={3} />
      </span>
    );
  }
  if (state === "failed") {
    return (
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-signal-danger text-black">
        <X aria-hidden="true" className="h-4 w-4" strokeWidth={3} />
      </span>
    );
  }
  if (state === "current") {
    return (
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-brand-cyan bg-base">
        <span
          aria-hidden="true"
          className="h-2.5 w-2.5 rounded-full bg-brand-cyan motion-safe:animate-pulse"
        />
      </span>
    );
  }
  return <span className="block h-7 w-7 shrink-0 rounded-full border border-line bg-base" />;
}

export function OrderProgress({
  steps,
  times = {},
}: {
  steps: ProgressStep[];
  /** A short date under a step word, keyed by step. */
  times?: Partial<Record<ProgressStep["key"], string | null>>;
}) {
  return (
    <ol className="flex flex-col sm:flex-row">
      {steps.map((step, i) => {
        const next = steps[i + 1];
        const filled =
          step.state === "complete" && (next?.state === "complete" || next?.state === "current");
        return (
          <li
            key={step.key}
            aria-current={step.state === "current" ? "step" : undefined}
            className="relative flex gap-3 pb-6 last:pb-0 sm:flex-1 sm:flex-col sm:gap-2 sm:pb-0 sm:pr-4 sm:last:pr-0"
          >
            {next && (
              <span
                aria-hidden="true"
                className={`absolute bottom-0 left-[13px] top-7 w-0.5 sm:bottom-auto sm:left-7 sm:right-0 sm:top-[13px] sm:h-0.5 sm:w-auto ${
                  filled ? "bg-signal-positive" : "bg-line"
                }`}
              />
            )}
            <Mark state={step.state} />
            <div className="min-w-0 pt-0.5 sm:pt-0">
              <p
                className={`text-sm font-semibold ${
                  step.state === "upcoming" ? "text-ink-subtle" : "text-ink"
                }`}
              >
                {step.label}
                <span className="sr-only">, {STATE_WORD[step.state]}</span>
              </p>
              {times[step.key] && (
                <p className="mt-0.5 font-mono text-[11px] text-ink-muted">{times[step.key]}</p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

const DOT: Record<StepState, string> = {
  complete: "bg-signal-positive",
  current: "bg-brand-cyan",
  upcoming: "border border-line bg-transparent",
  failed: "bg-signal-danger",
};

/** One line of four marks for a list row, named as a single image. */
export function CompactProgress({ steps, label }: { steps: ProgressStep[]; label: string }) {
  return (
    <span role="img" aria-label={label} className="inline-flex items-center gap-1">
      {steps.map((step) => (
        <span key={step.key} className={`h-2.5 w-2.5 rounded-full ${DOT[step.state]}`} />
      ))}
    </span>
  );
}
