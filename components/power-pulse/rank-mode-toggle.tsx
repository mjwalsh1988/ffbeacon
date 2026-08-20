"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

/**
 * Switches the Overview power rankings between the two things "power ranking"
 * can mean.
 *
 * Power Pulse is the default and answers "who wins games from here". Team value
 * answers "who owns the most", counting draft picks. Both are legitimate
 * questions, and a single table cannot order by both, so this picks which one
 * drives the row order. Whichever mode is active, the other number stays visible
 * in its own column, so nothing is hidden by the choice.
 *
 * State lives in the URL (`?rank=value`; absent means Power Pulse) so it is
 * shareable and survives a reload, matching how the league view already carries
 * `?source=` and `?picks=`.
 *
 * Real radio semantics rather than two buttons, so a screen reader announces
 * "Rank by, Power Pulse, selected, 1 of 2".
 */
export type RankMode = "pulse" | "value";

export function RankModeToggle({
  mode,
  pulseAvailable,
}: {
  mode: RankMode;
  /** When Power Pulse has not been computed, the control explains why. */
  pulseAvailable: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const select = (next: RankMode) => {
    if (next === mode) return;
    const params = new URLSearchParams(searchParams.toString());
    if (next === "value") params.set("rank", "value");
    else params.delete("rank");
    const qs = params.toString();
    startTransition(() => {
      router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
  };

  const options: Array<{ id: RankMode; label: string; hint: string }> = [
    {
      id: "pulse",
      label: "Power Pulse",
      hint: "Rank by expected performance from here. Draft picks are excluded.",
    },
    {
      id: "value",
      label: "Team value",
      hint: "Rank by total trade value of everything on the roster.",
    },
  ];

  return (
    <div
      role="radiogroup"
      aria-label="Rank teams by"
      // Fills its share of the row on a phone, where it sits beside the draft
      // picks switch (or alone, at full width, when Power Pulse is selected and
      // that switch is not on screen). Back to its own width from sm up.
      className="flex w-full items-center gap-1 rounded-card border border-line bg-base/60 p-1 sm:inline-flex sm:w-auto"
    >
      {options.map((option) => {
        const active = option.id === mode;
        const disabled = option.id === "pulse" && !pulseAvailable;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={`Rank by ${option.label}. ${option.hint}${disabled ? " Not available yet for this league." : ""}`}
            disabled={pending || disabled}
            onClick={() => select(option.id)}
            className={`min-h-11 flex-1 truncate rounded-card px-2 py-1.5 text-[11px] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-50 sm:min-h-0 sm:flex-none sm:px-3 sm:text-xs ${
              active
                ? "bg-brand-cyan/15 text-brand-cyan shadow-[0_0_20px_-10px_rgba(34,211,238,0.9)]"
                : "text-ink-muted hover:bg-surface hover:text-ink"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
