"use client";

/**
 * The All / Dynasty / Redraft filter that sits at the top of a Manager Pulse
 * report (docs/manager-pulse/manager-pulse-plan.md section 6.0).
 *
 * Dynasty and redraft are different games with different value scales, so the
 * whole report reads through this one lens. It lives in `?lens=` so a filtered
 * view is shareable, and it is a real filter, never a page: every section below
 * it reads the same lens back out through `underLens` / `perTypeUnderLens`
 * rather than each section carrying its own toggle.
 *
 * MUST BE WRAPPED IN <Suspense> BY ITS PARENT. This reads `useSearchParams`,
 * which opts a static route out of prerendering unless the reader is inside a
 * Suspense boundary (project convention, see the Next.js static +
 * useSearchParams rule). `app/tools/manager-pulse/[handle]/page.tsx` is the one
 * caller and wraps this accordingly.
 *
 * The pure lens helpers (`underLens`, `perTypeUnderLens`, `perTypeSlice`,
 * `defaultLens`, `lensLabel`) are NOT here. They live in `./lens`, which has no
 * "use client" directive, because the report sections that call them are server
 * components. See that file for what went wrong when they lived here.
 *
 * ACCESSIBILITY: a `role="group"` of real buttons, never `aria-current` (this
 * filters content in place, it does not navigate), `aria-pressed` on every
 * option, and a polite live region that announces the new lens and the count it
 * now covers on every change. Every button holds a 44x44 CSS px minimum target.
 */

import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { LeagueLens } from "@/lib/manager-pulse/types";
// The pure helpers live in a module with no "use client" directive, because six
// server components call them and every export of a client module becomes a
// throwing client reference across that boundary. See lens.ts.
import { countFor, lensLabel, type LensCounts } from "./lens";

// ---------------------------------------------------------------------------
// The control
// ---------------------------------------------------------------------------

const LENS_OPTIONS: LeagueLens[] = ["all", "dynasty", "redraft"];

export function LensSwitch({ lens, counts }: { lens: LeagueLens; counts: LensCounts }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [announcement, setAnnouncement] = useState("");

  const select = (next: LeagueLens) => {
    if (next === lens || pending) return;

    const params = new URLSearchParams(searchParams.toString());
    if (next === "all") params.delete("lens");
    else params.set("lens", next);
    const qs = params.toString();

    startTransition(() => {
      router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });

    setAnnouncement(`${lensLabel(next)}, ${countFor(next, counts)} of ${counts.leagueSeasons} league-seasons`);
  };

  return (
    <div>
      <div
        role="group"
        aria-label="Filter this report by league type"
        aria-busy={pending}
        className="inline-flex w-full items-stretch gap-1 rounded-card border border-line bg-base/60 p-1 sm:w-auto"
      >
        {LENS_OPTIONS.map((option) => {
          const active = option === lens;
          const count = countFor(option, counts);
          return (
            <button
              key={option}
              type="button"
              aria-pressed={active}
              onClick={() => select(option)}
              aria-label={`${lensLabel(option)}, ${count} of ${counts.leagueSeasons} league-seasons`}
              className={`flex min-h-11 min-w-11 flex-1 flex-col items-center justify-center gap-0.5 rounded-card px-3 py-1.5 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:cursor-wait sm:flex-none sm:flex-row sm:gap-1.5 ${
                active
                  ? "bg-brand-cyan/15 text-brand-cyan shadow-[0_0_20px_-10px_rgba(34,211,238,0.9)]"
                  : "text-ink-muted hover:bg-surface hover:text-ink"
              }`}
            >
              <span>{lensLabel(option)}</span>
              <span
                className={`font-mono text-xs tabular-nums ${active ? "text-brand-cyan" : "text-ink-subtle"}`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}
