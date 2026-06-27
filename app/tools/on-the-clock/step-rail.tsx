"use client";

/**
 * Onboarding step rail for the On The Clock setup flow:
 *   1 Connect Sleeper -> 2 Choose draft -> 3 Sync room -> 4 Draft with signals.
 * Rendered as an ordered list with aria-current="step" on the active step and a
 * visually-hidden state word per step (so state is never color-only). Static; no
 * motion.
 */

import { Check } from "lucide-react";

const STEPS = [
  { n: 1, label: "Connect Sleeper", hint: "Enter your username" },
  { n: 2, label: "Choose draft", hint: "Pick an active league" },
  { n: 3, label: "Sync room", hint: "Pull the latest picks" },
  { n: 4, label: "Draft with signals", hint: "Best value, live" },
] as const;

export function StepRail({ current }: { current: 1 | 2 | 3 | 4 }) {
  return (
    <nav aria-label="Setup progress">
      <ol role="list" className="flex flex-wrap items-stretch gap-2 sm:gap-3">
        {STEPS.map((s) => {
          const done = s.n < current;
          const active = s.n === current;
          const state = done ? "Completed" : active ? "Current step" : "Upcoming";
          return (
            <li
              key={s.n}
              aria-current={active ? "step" : undefined}
              className={`flex min-w-[8.5rem] flex-1 items-center gap-2.5 rounded-card border px-3 py-2 ${
                active
                  ? "border-brand-cyan/60 bg-brand-cyan/10"
                  : done
                    ? "border-line bg-surface/60"
                    : "border-line bg-base/40"
              }`}
            >
              <span
                aria-hidden="true"
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-bold ${
                  active
                    ? "border-brand-cyan bg-brand-cyan/20 text-brand-cyan"
                    : done
                      ? "border-brand-purple/50 bg-brand-purple/15 text-brand-purple"
                      : "border-line text-ink-subtle"
                }`}
              >
                {done ? <Check className="h-3.5 w-3.5" /> : s.n}
              </span>
              <span className="min-w-0">
                <span className="block text-xs font-semibold text-ink">{s.label}</span>
                <span className="block truncate text-[11px] text-ink-subtle">{s.hint}</span>
              </span>
              <span className="sr-only">({state})</span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
