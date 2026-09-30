"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { useRadioGroup } from "@/lib/use-radio-group";
import type { WarAxisMode } from "@/lib/positional-war/chart-geometry";

/**
 * Switches the Positional WAR chart's x-axis between raw position rank (the
 * default: "the twelfth best running back" is a thing a reader already knows
 * how to think about, and a position's line simply ends where its data ends)
 * and relative depth (where every position's replacement boundary lands at the
 * same point, so positions with different starting counts compare directly).
 *
 * Modelled directly on components/power-pulse/rank-mode-toggle.tsx: real
 * radio semantics, a useTransition push that does not scroll, 44px minimum
 * targets, and an aria-label on each option carrying the hint rather than a
 * tooltip.
 *
 * The 44px minimum holds at EVERY width, not only below sm. Both this control
 * and the rank-mode toggle it copies used to drop it from sm up, and sm starts
 * at 640px: a tablet, and a large phone turned sideways, are both touch
 * devices well past that line. Changed in both files together, so the two
 * still match.
 *
 * State lives in the URL (`?war=depth`; absent means rank), matching
 * `?rank=`, `?picks=`, and `?source=` on the same pages. This is a rendering
 * choice only: it never invalidates the cached curve and never changes the
 * fingerprint (E2-3).
 */
export function WarAxisToggle({ mode }: { mode: WarAxisMode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const select = (next: WarAxisMode) => {
    // A repeat activation while navigating is ignored rather than disabling
    // the buttons, which would drop keyboard focus to the page body.
    if (next === mode || pending) return;
    const params = new URLSearchParams(searchParams.toString());
    // The default axis carries no parameter, so a link to the page a reader is
    // looking at is the shortest one. `?war=rank` still resolves to rank for
    // anyone holding an older link (see parseAxisMode).
    if (next === "depth") params.set("war", "depth");
    else params.delete("war");
    const qs = params.toString();
    startTransition(() => {
      router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
  };

  const options: Array<{ id: WarAxisMode; label: string; hint: string }> = [
    // Short hints. These are read aloud every time the control is hovered or
    // focused, and a paragraph is a lot to hear before you can press a button.
    {
      id: "rank",
      label: "Position rank",
      hint: "Plots the best, second best, and so on at each position.",
    },
    {
      id: "depth",
      label: "Relative depth",
      hint: "Lines every position up at its replacement point so they compare directly.",
    },
  ];

  const radios = useRadioGroup({
    count: options.length,
    checkedIndex: options.findIndex((o) => o.id === mode),
    onSelect: (i) => select(options[i].id),
  });

  return (
    <div
      role="radiogroup"
      aria-label="Chart axis"
      aria-busy={pending || undefined}
      className="flex w-full items-center gap-1 rounded-card border border-line bg-base/60 p-1 sm:inline-flex sm:w-auto"
    >
      {options.map((option, index) => {
        const active = option.id === mode;
        return (
          <button
            key={option.id}
            ref={radios.refFor(index)}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={`Chart axis, ${option.label}. ${option.hint}`}
            tabIndex={radios.tabIndexFor(index)}
            onKeyDown={(event) => radios.onKeyDown(event, index)}
            onClick={() => select(option.id)}
            className={`min-h-11 flex-1 truncate rounded-card px-2 py-1.5 text-[11px] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan sm:flex-none sm:px-3 sm:text-xs ${
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
