"use client";

import { useEffect, useRef } from "react";
import type { BeamClarification } from "@/lib/beam/types";

/**
 * The "which one did you mean" state.
 *
 * A clarification is a real question with real choices, so it is marked up as
 * one: a fieldset with a legend naming the ambiguity, and a list of buttons.
 * Not a combobox, not a listbox, not a set of links. Each button's accessible
 * name carries everything that distinguishes it ("Drake London, wide receiver
 * for ATL"), because "Drake London" and "Drake Maye" sound similar and the
 * position is the whole reason there is a choice to make.
 *
 * Focus moves to the first option when the clarification appears, so a keyboard
 * or screen reader user lands on the answer to the question they were just
 * asked rather than having to hunt for it.
 */
export function BeamClarify({
  clarification,
  onPick,
  disabled,
}: {
  clarification: BeamClarification;
  onPick: (option: { value: string; label: string }) => void;
  disabled: boolean;
}) {
  const firstRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // Deferred a frame so the browser has painted the new node before focus
    // moves; focusing an element mid-render can be dropped silently.
    const id = window.requestAnimationFrame(() => firstRef.current?.focus());
    return () => window.cancelAnimationFrame(id);
  }, [clarification]);

  // aria-disabled, not disabled: disabling a fieldset unfocuses the button the
  // reader just pressed, which drops focus to the document body on the one
  // interaction where they most need to stay put. The click handler guards
  // instead.
  return (
    <fieldset
      aria-disabled={disabled || undefined}
      className="rounded-card border border-brand-purple/40 bg-gradient-to-br from-brand-purple/10 to-brand-cyan/10 p-4 sm:p-5"
    >
      <legend className="px-1 text-base font-semibold text-ink">
        {clarification.prompt}
      </legend>
      <ul role="list" className="mt-3 grid gap-2 sm:grid-cols-2">
        {clarification.options.map((option, index) => (
          <li key={option.value}>
            <button
              ref={index === 0 ? firstRef : undefined}
              type="button"
              onClick={() => {
                if (disabled) return;
                onPick({ value: option.value, label: option.label });
              }}
              aria-label={option.speech}
              className="flex min-h-[44px] w-full flex-col items-start justify-center gap-0.5 rounded-card border border-line bg-base px-3 py-2 text-left transition-colors hover:border-brand-cyan/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-60"
            >
              <span className="text-sm font-semibold text-ink">{option.label}</span>
              {option.detail && (
                <span aria-hidden="true" className="text-xs text-ink-muted">
                  {option.detail}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}
