/**
 * Where the edge came from.
 *
 * The meter above says "Clear Edge: Player A, 58 to 42". This shows the eight
 * points of that margin broken into the categories that produced them, because
 * the contributions are additive by construction: each bar is
 * `weight * (share - 0.5)`, and they sum to exactly `aShare - 0.5`. Nothing here
 * is an illustration of the verdict. It is the verdict, itemized.
 *
 * Accessibility. The bars are decorative and marked aria-hidden. Every row also
 * carries a full sentence in text that names the category, which player it
 * favored, how far it moved the meter, and how much weight it carried, so a
 * screen reader gets the complete decomposition in reading order rather than a
 * shape it cannot see. The totals line restates the sum so the arithmetic is
 * checkable without the graphic.
 *
 * Server component. No SVG, no dependencies: a diverging bar is two divs either
 * side of a center line, which reflows on a narrow screen where a fixed-viewBox
 * SVG would not.
 */

import { Scale } from "lucide-react";
import type { BeaconEdge, BreakdownPlayer } from "@/lib/beacon-breakdown";

/** Contributions below this are rounding noise, not a reason. */
const MIN_VISIBLE = 0.002;

function points(contribution: number): string {
  return Math.abs(contribution * 100).toFixed(1);
}

export function EdgeContributionChart({
  a,
  b,
  edge,
}: {
  a: BreakdownPlayer;
  b: BreakdownPlayer;
  edge: BeaconEdge;
}) {
  const shown = edge.contributions.filter((c) => Math.abs(c.contribution) >= MIN_VISIBLE);
  if (shown.length === 0) return null;

  const maxAbs = Math.max(...shown.map((c) => Math.abs(c.contribution)));
  const dropped = edge.contributions.length - shown.length;

  const aTotal = shown
    .filter((c) => c.contribution > 0)
    .reduce((s, c) => s + c.contribution, 0);
  const bTotal = shown
    .filter((c) => c.contribution < 0)
    .reduce((s, c) => s + Math.abs(c.contribution), 0);

  return (
    <section
      aria-labelledby="contribution-heading"
      className="rounded-modal border border-line bg-surface/40 p-4 sm:p-6"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3
          id="contribution-heading"
          className="flex items-center gap-1.5 text-lg font-semibold tracking-tight text-ink sm:text-xl"
        >
          <Scale aria-hidden="true" className="h-4 w-4 text-brand-cyan" />
          Where the edge comes from
        </h3>
        <p className="text-xs text-ink-subtle">
          {edge.metricsUsed} categor{edge.metricsUsed === 1 ? "y" : "ies"} scored
        </p>
      </div>

      <p className="mt-1 text-sm text-ink-muted">
        Each bar is how far that category moved the meter, in percentage points. They add up to
        the split above.
      </p>

      {/* Column key. Decorative: every row below names its own player in text. */}
      <div
        aria-hidden="true"
        className="mt-4 grid grid-cols-2 gap-2 border-b border-line pb-2 text-[11px] font-semibold uppercase tracking-wide"
      >
        <span className="text-right text-brand-purple">&#9664; {a.name}</span>
        <span className="text-brand-cyan">{b.name} &#9654;</span>
      </div>

      <ul role="list" className="mt-2 divide-y divide-line/60">
        {shown.map((c) => {
          const favorsA = c.contribution > 0;
          const width = maxAbs > 0 ? (Math.abs(c.contribution) / maxAbs) * 100 : 0;
          const name = favorsA ? a.name : b.name;
          return (
            <li key={c.key} className="py-2.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <p className="text-sm font-medium text-ink">{c.label}</p>
                <p className="text-[11px] text-ink-subtle">
                  <span className="sr-only">Weighted at </span>
                  {(c.weight * 100).toFixed(0)}% of this lens
                </p>
              </div>

              {/* The full statement, for screen readers and for anyone who
                  cannot resolve the bar's direction by color alone. */}
              <p className="sr-only">
                {c.label}: favors {name} by {points(c.contribution)} percentage points, carrying{" "}
                {(c.weight * 100).toFixed(0)} percent of the weight.
              </p>

              <div aria-hidden="true" className="mt-1.5 flex items-center gap-0">
                {/* Left half: player A. */}
                <div className="flex h-4 flex-1 justify-end">
                  {favorsA && (
                    <div
                      className="h-full rounded-l-sm"
                      style={{
                        width: `${width}%`,
                        backgroundImage:
                          "linear-gradient(270deg, #A855F7 0%, rgba(168,85,247,0.55) 100%)",
                      }}
                    />
                  )}
                </div>
                <span className="h-5 w-px shrink-0 bg-line" />
                {/* Right half: player B. */}
                <div className="flex h-4 flex-1 justify-start">
                  {!favorsA && (
                    <div
                      className="h-full rounded-r-sm"
                      style={{
                        width: `${width}%`,
                        backgroundImage:
                          "linear-gradient(90deg, rgba(34,211,238,0.55) 0%, #22D3EE 100%)",
                      }}
                    />
                  )}
                </div>
              </div>

              <p
                aria-hidden="true"
                className={`mt-1 text-[11px] font-semibold tabular-nums ${
                  favorsA ? "text-right text-brand-purple" : "text-brand-cyan"
                }`}
              >
                {points(c.contribution)} pts to {name}
              </p>
            </li>
          );
        })}
      </ul>

      <p className="mt-3 border-t border-line pt-3 text-xs leading-relaxed text-ink-subtle">
        Totals: {a.name} {points(aTotal)} points, {b.name} {points(bTotal)} points, for a final
        split of {edge.aPct} to {edge.bPct}.
        {dropped > 0 && (
          <>
            {" "}
            {dropped} further categor{dropped === 1 ? "y" : "ies"} scored too close to move the
            result.
          </>
        )}
      </p>
    </section>
  );
}
