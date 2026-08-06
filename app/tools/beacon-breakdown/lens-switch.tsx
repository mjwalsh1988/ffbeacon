/**
 * The lens switch: Dynasty, Win now, This week.
 *
 * A lens does not change a single measured number. It changes how much each one
 * counts toward the verdict, which is the honest way to answer "who is better"
 * when the answer genuinely depends on what the reader is trying to do.
 *
 * Built from links rather than buttons on purpose. Each lens is a distinct,
 * shareable URL, it works with JavaScript disabled, and the browser's back
 * button does what a reader expects. Links that represent the current view take
 * aria-current, not aria-pressed: nothing is being toggled, we are navigating.
 */

import Link from "next/link";
import { LENSES, type LensId } from "@/lib/breakdown/types";

export function LensSwitch({
  active,
  hrefForLens,
}: {
  active: LensId;
  /** Builds the URL for a lens, preserving the players, format, and source. */
  hrefForLens: (lens: LensId) => string;
}) {
  const activeLens = LENSES.find((l) => l.id === active) ?? LENSES[0];

  return (
    <div className="rounded-modal border border-line bg-surface/40 p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-sm font-semibold text-ink" id="lens-heading">
          What are you trying to decide?
        </h3>
        <p className="text-[11px] text-ink-subtle">
          Same numbers, weighted for the question you are asking.
        </p>
      </div>

      <nav aria-labelledby="lens-heading" className="mt-3">
        <ul role="list" className="flex flex-wrap gap-2">
          {LENSES.map((lens) => {
            const isActive = lens.id === active;
            return (
              <li key={lens.id}>
                <Link
                  href={hrefForLens(lens.id)}
                  scroll={false}
                  aria-current={isActive ? "true" : undefined}
                  aria-describedby={isActive ? "lens-blurb" : undefined}
                  className={`inline-flex min-h-11 items-center rounded-card border px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan ${
                    isActive
                      ? "border-brand-cyan/60 bg-brand-cyan/10 text-brand-cyan"
                      : "border-line bg-base text-ink-muted hover:border-brand-cyan/40 hover:text-ink"
                  }`}
                >
                  {lens.label}
                  {isActive && <span className="sr-only">, selected</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <p id="lens-blurb" className="mt-3 text-sm leading-relaxed text-ink-muted">
        {activeLens.blurb}
      </p>
    </div>
  );
}
