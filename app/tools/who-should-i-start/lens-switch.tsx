/**
 * The lens switch: Dynasty, Win now, This week.
 *
 * A lens does not change a single measured number. It changes how much each one
 * counts toward the verdict, which is the honest way to answer "who is better"
 * when the answer genuinely depends on what the reader is trying to do.
 *
 * Generalised for the Head to head tab (two to eight players): the lens now
 * lives entirely in this component's own client state instead of the URL, so a
 * click never changes the page's address and never round-trips to the server.
 * That only works because every lens's numbers are already computed server-side
 * (lib/beacon-breakdown.ts loadBreakdown returns all three at once), so this
 * component receives one fully pre-rendered panel per lens and toggles which
 * one is visible, the exact pattern breakdown-tabs.tsx already uses for the
 * tab list itself: every panel stays mounted, only `hidden` moves. Passing a
 * function as `children` would not survive the server/client boundary (a
 * closure is not serialisable), so the caller renders all three panels ahead
 * of time and hands them over as plain nodes.
 *
 * Default lens is "This week": the board's headline verdict above these tabs
 * is always this week's call, so the background tab should open already
 * agreeing with it.
 */

"use client";

import { useId, useState, type ReactNode } from "react";
import { LENSES, type LensId } from "@/lib/breakdown/types";

const DEFAULT_HEAD_TO_HEAD_LENS: LensId = "this-week";

export function LensSwitch({
  panels,
  defaultLens = DEFAULT_HEAD_TO_HEAD_LENS,
}: {
  /** One pre-rendered panel per lens, built from that lens's GroupEdge. */
  panels: Record<LensId, ReactNode>;
  defaultLens?: LensId;
}) {
  const headingId = useId();
  const blurbId = useId();
  const [active, setActive] = useState<LensId>(defaultLens);
  const activeLens = LENSES.find((l) => l.id === active) ?? LENSES[0];

  return (
    <div>
      <div className="rounded-modal border border-line bg-surface/40 p-4 sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h3 className="text-sm font-semibold text-ink" id={headingId}>
            What are you trying to decide?
          </h3>
          <p className="text-[11px] text-ink-subtle">
            Same numbers, weighted for the question you are asking.
          </p>
        </div>

        <div role="group" aria-labelledby={headingId} className="mt-3">
          <ul role="list" className="flex flex-wrap gap-2">
            {LENSES.map((lens) => {
              const isActive = lens.id === active;
              return (
                <li key={lens.id}>
                  <button
                    type="button"
                    aria-pressed={isActive}
                    aria-describedby={isActive ? blurbId : undefined}
                    onClick={() => setActive(lens.id)}
                    className={`inline-flex min-h-11 items-center rounded-card border px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan ${
                      isActive
                        ? "border-brand-cyan/60 bg-brand-cyan/10 text-brand-cyan"
                        : "border-line bg-base text-ink-muted hover:border-brand-cyan/40 hover:text-ink"
                    }`}
                  >
                    {lens.label}
                    {isActive && <span className="sr-only">, selected</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <p id={blurbId} className="mt-3 text-sm leading-relaxed text-ink-muted">
          {activeLens.blurb}
        </p>
      </div>

      {LENSES.map((lens) => (
        <div key={lens.id} hidden={lens.id !== active} className="mt-6">
          {panels[lens.id]}
        </div>
      ))}
    </div>
  );
}
