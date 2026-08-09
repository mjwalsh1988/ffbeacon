"use client";

/**
 * Compete, balanced, or rebuild.
 *
 * Only rendered in a dynasty STARTUP, where the question is real. A redraft team
 * is competing by definition and a rookie draft sits on top of a team whose
 * direction was set years ago, so both of those get a plain sentence instead of
 * a control that pretends to offer a choice.
 *
 * Changing the mode re-sorts the whole available board and rewrites both
 * recommendation cards. That is a large change to make silently, and it is worse
 * by ear than by eye: a sighted drafter sees the list move, a screen reader user
 * gets nothing unless we say so. So the parent announces the new top of the
 * board through a live region, and this control carries the consequence in its
 * own description rather than leaving it to be discovered.
 */

import { Rocket, Scale, Sprout } from "lucide-react";
import type { BuildMode } from "@/lib/on-the-clock/types";

const OPTIONS: Array<{
  id: BuildMode;
  label: string;
  icon: typeof Rocket;
  hint: string;
}> = [
  {
    id: "compete",
    label: "Compete",
    icon: Rocket,
    hint: "Ranks the board by what wins games this season.",
  },
  {
    id: "balanced",
    label: "Balanced",
    icon: Scale,
    hint: "Weighs this season against long-term value.",
  },
  {
    id: "rebuild",
    label: "Rebuild",
    icon: Sprout,
    hint: "Ranks the board by long-term value, youth, and upside.",
  },
];

export function BuildModeSelector({
  mode,
  onChange,
  disabled = false,
}: {
  mode: BuildMode;
  onChange: (mode: BuildMode) => void;
  disabled?: boolean;
}) {
  const active = OPTIONS.find((o) => o.id === mode) ?? OPTIONS[1];

  return (
    <div className="flex flex-col gap-1.5">
      <div
        role="group"
        aria-label="How you are building this team"
        aria-describedby="otc-build-mode-hint"
        className="inline-flex overflow-hidden rounded-card border border-line"
      >
        {OPTIONS.map((option) => {
          const Icon = option.icon;
          const isActive = option.id === mode;
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={isActive}
              disabled={disabled}
              onClick={() => onChange(option.id)}
              className={`inline-flex min-h-11 items-center gap-1.5 px-3 py-1.5 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-cyan disabled:cursor-not-allowed disabled:opacity-50 ${
                isActive ? "bg-beacon text-black" : "bg-base text-ink-muted hover:text-ink"
              }`}
            >
              <Icon aria-hidden="true" className="h-3.5 w-3.5" />
              {option.label}
            </button>
          );
        })}
      </div>
      <p id="otc-build-mode-hint" className="text-xs text-ink-subtle">
        {active.hint}
      </p>
    </div>
  );
}

/**
 * The sentence shown where the selector would be, in rooms that do not get one.
 * Saying why is the point: a missing control with no explanation reads as a bug.
 */
export function BuildModeNotice({ reason }: { reason: string }) {
  return (
    <p className="text-xs text-ink-subtle">
      {reason}
    </p>
  );
}
