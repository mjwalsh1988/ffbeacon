"use client";

import { useId } from "react";
import { Check } from "lucide-react";
import { trackEvent } from "@/lib/analytics";
import { GOAL_LABEL } from "./bid-view";
import type { GoalKey } from "@/lib/faab/types";

/**
 * Which question is the reader asking?
 *
 * Two answers, and they are genuinely different bids: the cheapest number
 * that usually wins, or the number that almost always does. The calculator
 * prices both on the server, so switching between them is arithmetic in the
 * browser and never a round trip.
 *
 * Native radios in a real fieldset. The visible control is a pill, the radio
 * itself is visually hidden rather than replaced, so arrow keys, the selected
 * state and the group's own name all come from the platform. The selected
 * pill carries a tick as well as the gradient, because colour is never the
 * only signal.
 *
 * NO LIVE REGION IN HERE, on purpose. There is exactly one polite region per
 * mode and it belongs to the parent that owns the answer, so the new bid is
 * announced once rather than twice.
 */
export function GoalToggle({
  goal,
  onChange,
  name,
}: {
  goal: GoalKey;
  onChange: (goal: GoalKey) => void;
  /** Unique per card: a league answer and a manual one can share a page. */
  name: string;
}) {
  const helpId = useId();
  const goals: GoalKey[] = ["value", "sure"];

  // Counted here rather than in either parent, so one call site covers both
  // modes and neither can forget it.
  const pick = (next: GoalKey) => {
    trackEvent("faab_goal_change", { goal: next });
    onChange(next);
  };

  return (
    <fieldset aria-describedby={helpId} className="mt-4">
      <legend className="text-sm font-medium text-ink">What matters more?</legend>
      <p id={helpId} className="mt-1 text-xs leading-relaxed text-ink-subtle">
        Good value is the cheapest bid that usually wins him. Make sure I win
        pays up to end the argument.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {goals.map((option) => {
          const selected = option === goal;
          return (
            <label key={option} className="relative cursor-pointer">
              <input
                type="radio"
                name={name}
                value={option}
                checked={selected}
                onChange={() => pick(option)}
                className="peer sr-only"
              />
              <span
                className={`flex h-11 min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-card border px-4 text-sm font-semibold motion-safe:transition-all peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-cyan ${
                  selected
                    ? "border-transparent text-ink"
                    : "border-line bg-base text-ink-muted hover:border-line-accent hover:text-ink"
                }`}
                style={
                  selected
                    ? {
                        backgroundImage:
                          "linear-gradient(135deg, rgba(168,85,247,0.22) 0%, rgba(34,211,238,0.14) 100%)",
                        borderColor: "rgba(168,85,247,0.55)",
                      }
                    : undefined
                }
              >
                {selected && (
                  <Check aria-hidden="true" className="h-3.5 w-3.5 text-brand-cyan" />
                )}
                {GOAL_LABEL[option]}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
