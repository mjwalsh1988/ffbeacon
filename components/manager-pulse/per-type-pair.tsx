/**
 * The one component that renders a `PerTypeStat`.
 *
 * Every value-priced figure in Manager Pulse (docs/manager-pulse-plan.md
 * section 6.0: trade margins, verdict distribution, position appetite, picks
 * traded, most traded with, overpays, unpriced-pick trades) goes through this,
 * so the never-pool rule lives in one place. Under a specific lens it renders
 * that one side. Under "all" it renders BOTH, dynasty and redraft, clearly
 * labelled, side by side on a wide screen and stacked on a narrow one. There
 * is no combined number anywhere in this file, because there is no unit for
 * one: a dynasty superflex trade and a redraft PPR trade are priced against
 * different format configs.
 *
 * THREE STATES PER SIDE, NOT TWO.
 *   - "value": the figure exists. `render` draws it, and the side's own
 *     sample size sits underneath.
 *   - "empty": this manager HAS played that league type, but the figure
 *     itself is null, i.e. not enough evidence yet. Renders `emptyReason`.
 *   - "never": this manager has never played that league type at all, per
 *     `typeCounts`. This is a different claim from "empty" and gets a
 *     different sentence: an absence of history, not an absence of evidence.
 *   `resolvePerTypePairSides` is the one place that decides between them, and
 *   it is a plain function with no React import, so it is unit-testable on
 *   its own (see per-type-pair.test.tsx).
 *
 * A null value is NEVER passed to `render`. `render`'s parameter type is `T`,
 * not `T | null`, and this file only calls it once a side has resolved to
 * the "value" state, so a caller's render function never has to null-check
 * the figure it was told exists.
 */

import type { ReactNode } from "react";
import type { LeagueLens, PerTypeStat } from "@/lib/manager-pulse/types";
import { lensLabel, perTypeSlice, perTypeUnderLens } from "@/components/manager-shell/lens";
import { formatSample } from "./format";

// ---------------------------------------------------------------------------
// Pure decision. No React, no formatting: safe to unit test on its own and
// safe to import from a server component.
// ---------------------------------------------------------------------------

export type PerTypePairSideState = "value" | "empty" | "never";

export type PerTypePairSide<T> = {
  type: "dynasty" | "redraft";
  state: PerTypePairSideState;
  /** Non-null exactly when `state === "value"`. */
  value: T | null;
  sampleSize: number | null;
};

/**
 * Which sides render under this lens, and in which of the three states.
 *
 * `typeCounts` is how many league-seasons of each type this manager has,
 * full stop, independent of whether this particular figure could be
 * computed for them. Zero there means "never played it" ("never"); a
 * positive count with a null stat means "played it, but not enough evidence
 * for this figure yet" ("empty"). Those are different claims and this
 * function is the one place that keeps them apart.
 */
export function resolvePerTypePairSides<T>(params: {
  lens: LeagueLens;
  stat: PerTypeStat<T>;
  sampleStat?: PerTypeStat<number> | null;
  typeCounts: { dynasty: number; redraft: number };
}): PerTypePairSide<T>[] {
  const { lens, stat, sampleStat, typeCounts } = params;
  const types = perTypeUnderLens(lens);

  return types.map((type) => {
    const value = perTypeSlice(stat, type);
    const sampleSize = sampleStat ? perTypeSlice(sampleStat, type) : null;
    const state: PerTypePairSideState =
      typeCounts[type] <= 0 ? "never" : value === null ? "empty" : "value";
    return { type, state, value, sampleSize };
  });
}

// ---------------------------------------------------------------------------
// The component
// ---------------------------------------------------------------------------

export function PerTypePair<T>({
  lens,
  label,
  stat,
  sampleStat,
  sampleNoun = "trade",
  typeCounts,
  render,
  emptyReason,
  stackSides = false,
}: {
  lens: LeagueLens;
  label: string;
  stat: PerTypeStat<T>;
  /** The sample size behind each side's figure, when this metric has one. */
  sampleStat?: PerTypeStat<number> | null;
  /** Singular noun for the sample line, e.g. "trade". Pluralized by formatSample. */
  sampleNoun?: string;
  /** League-seasons of each type this manager has, full stop. Drives the "never" state. */
  typeCounts: { dynasty: number; redraft: number };
  /** Only ever called with a real, non-null value. */
  render: (value: T) => ReactNode;
  /** Shown when a side has played that type but this figure is null. */
  emptyReason: string;
  /**
   * Stack the dynasty and redraft halves vertically instead of side by side.
   *
   * The default is two across, which is right for a card that spans the whole
   * content column. It is wrong for one that is already half of a two-column
   * row: halving a half leaves about 250px, which is not enough for a chart
   * with a label, a bar and a figure on every line. The caller knows which
   * situation it is in; this component cannot.
   */
  stackSides?: boolean;
}) {
  const sides = resolvePerTypePairSides({ lens, stat, sampleStat, typeCounts });

  if (sides.length === 0) return null;

  const stacked = sides.length > 1;

  return (
    <div className="rounded-card border border-line bg-base/40 px-3 py-2.5">
      <h3 className="text-sm font-semibold text-ink">{label}</h3>
      <div
        className={
          stacked ? `mt-2 grid gap-3 ${stackSides ? "" : "sm:grid-cols-2"}` : "mt-2"
        }
      >
        {sides.map((side) => {
          const sampleNote =
            side.sampleSize !== null ? formatSample(side.sampleSize, sampleNoun) : "";
          return (
            <div
              key={side.type}
              className={stacked ? "rounded-card border border-line/60 bg-surface/40 px-3 py-2" : undefined}
            >
              {stacked && (
                <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
                  {lensLabel(side.type)}
                </p>
              )}

              {side.state === "never" ? (
                <p className="mt-1 text-xs text-ink-muted">
                  Never played {lensLabel(side.type).toLowerCase()} in this window.
                </p>
              ) : side.state === "empty" ? (
                <p className="mt-1 text-xs text-ink-muted">{emptyReason}</p>
              ) : (
                <>
                  <div className="mt-1">{render(side.value as T)}</div>
                  {sampleNote && <p className="mt-1 text-[11px] text-ink-subtle">{sampleNote}</p>}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
