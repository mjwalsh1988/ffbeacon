/**
 * The Head to head table, generalised from a two-player comparison to two to
 * eight players.
 *
 * Every row still comes from the single METRICS registry
 * (lib/breakdown/metrics.ts), and every cell's "Best" badge and weight comes
 * straight off the active lens's GroupEdge (the same contributions the meter
 * and the contribution chart render), so the table can never disagree with the
 * numbers above it.
 *
 * Two layouts render from the same computed rows, and only one is ever in the
 * accessibility tree at a time (the other is `hidden`, not merely scrolled out
 * of view):
 *
 * - At sm and up: a real <table>, following the pattern stats-compare.tsx
 *   already established for the Stats tab's own N-column comparison. The
 *   category is a th scope="row", each player is a th scope="col", a text
 *   "Best" badge marks the top cell (never colour alone, and every tied cell
 *   is badged), and the whole table sits in its own horizontal-scroll region
 *   (tabIndex 0, role="region", an accessible name) so every column stays
 *   reachable at any width up to eight players.
 * - Below sm: each row collapses to the category label followed by a 2-up
 *   grid of cells, one per player, wrapping to more rows as the player count
 *   grows past two. Every cell names its player, its value and its "Best"
 *   badge directly (no reliance on column position or colour alone), which is
 *   what makes the collapse legible without the header row a wide table gets.
 */

import { BeaconValue } from "@/components/beacon-value-icon";
import { METRICS, type MetricSide } from "@/lib/breakdown/metrics";
import type { GroupEdge } from "@/lib/beacon-breakdown";

export function BreakdownTable({
  sides,
  edge,
  valueIsBeacon,
}: {
  /** One entry per player, in the same order as `edge.sides`. */
  sides: MetricSide[];
  /** The active lens's group edge: supplies each cell's weight and "Best" badge. */
  edge: GroupEdge;
  /** True when the value row should carry the FF Beacon mark. */
  valueIsBeacon: boolean;
}) {
  const names = sides.map((s) => s.player.name);

  const rows = METRICS.map((metric) => {
    const cells = sides.map((side, i) => {
      const contribution = edge.sides[i]?.contributions.find((c) => c.key === metric.key);
      return {
        display: metric.display(side),
        note: metric.note?.(side),
        isBest: contribution?.isBest ?? false,
      };
    });
    // Renormalized weight can differ slightly per side (each side renormalizes
    // over the metrics that resolved for it), so the row header shows the
    // largest one as a representative figure rather than picking a side.
    const weight = edge.sides.reduce((max, s) => {
      const w = s.contributions.find((c) => c.key === metric.key)?.weight ?? 0;
      return Math.max(max, w);
    }, 0);
    const hasData = cells.some((c) => c.display !== "-");
    const resolvedCells = cells.filter((c) => c.display !== "-");
    const isEven = weight > 0 && resolvedCells.length > 1 && resolvedCells.every((c) => c.isBest);
    return { metric, cells, weight, hasData, isEven };
  }).filter((row) => row.weight > 0 || row.hasData);

  return (
    <>
      {/* Desktop / wide layout: a real table, sm and up. Hidden below sm so
          the collapsed list is the only copy of this data in the
          accessibility tree on a phone. */}
      <div
        tabIndex={0}
        role="region"
        aria-label={`Category comparison for ${names.join(", ")}, scrollable`}
        className="hidden overflow-x-auto rounded-card border border-line focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-cyan sm:block"
      >
        <table className="w-max min-w-full border-collapse text-sm sm:w-full">
          <caption className="sr-only">
            Category-by-category comparison of {names.join(", ")}
          </caption>
          <thead className="bg-surface/60 text-xs uppercase tracking-wide text-ink-subtle">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                Category
              </th>
              {names.map((name) => (
                <th
                  key={name}
                  scope="col"
                  className="max-w-[10rem] truncate px-3 py-2 text-left font-semibold text-ink"
                  title={name}
                >
                  {name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line/50">
            {rows.map(({ metric, cells, weight, hasData, isEven }) => (
              <tr key={metric.key}>
                <th scope="row" className="px-3 py-2 text-left align-top font-medium text-ink">
                  {metric.label}
                  <p className="mt-0.5 max-w-[14rem] whitespace-normal text-[11px] font-normal leading-snug text-ink-subtle">
                    {metric.help}
                  </p>
                  {weight > 0 ? (
                    <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-brand-cyan/80">
                      Counts {Math.round(weight * 100)}%
                      <span className="sr-only"> toward the verdict for this lens</span>
                    </p>
                  ) : (
                    <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
                      Context only<span className="sr-only">, not counted toward the verdict</span>
                    </p>
                  )}
                  {!hasData && (
                    <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
                      No data
                    </p>
                  )}
                  {hasData && isEven && (
                    <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
                      Even
                    </p>
                  )}
                </th>
                {cells.map((cell, i) => (
                  <td key={names[i]} className="px-3 py-2 align-top">
                    <Cell
                      playerName={names[i]}
                      display={cell.display}
                      note={cell.note}
                      isBest={cell.isBest && !isEven}
                      valueIsBeacon={Boolean(metric.isBeaconValue) && valueIsBeacon}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Phone layout: below sm. Each category collapses to its label
          followed by a 2-up grid of cells (one per player), wrapping to more
          rows as the player count grows past two. Hidden at sm and up so it
          never duplicates the table above in the accessibility tree. */}
      <div className="divide-y divide-line/60 rounded-card border border-line sm:hidden">
        {rows.map(({ metric, cells, weight, hasData, isEven }) => (
          <div key={metric.key} className="p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-brand-cyan">
              {metric.label}
            </p>
            <p className="mt-0.5 text-[11px] leading-snug text-ink-subtle">{metric.help}</p>
            {weight > 0 ? (
              <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-brand-cyan/80">
                Counts {Math.round(weight * 100)}%
                <span className="sr-only"> toward the verdict for this lens</span>
              </p>
            ) : (
              <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
                Context only<span className="sr-only">, not counted toward the verdict</span>
              </p>
            )}
            {!hasData && (
              <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
                No data
              </p>
            )}
            {hasData && isEven && (
              <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
                Even
              </p>
            )}
            <div className="mt-2 grid grid-cols-2 gap-2">
              {cells.map((cell, i) => (
                <MobileCell
                  key={names[i]}
                  playerName={names[i]}
                  display={cell.display}
                  note={cell.note}
                  isBest={cell.isBest && !isEven}
                  valueIsBeacon={Boolean(metric.isBeaconValue) && valueIsBeacon}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function Cell({
  playerName,
  display,
  note,
  isBest,
  valueIsBeacon,
}: {
  playerName: string;
  display: string;
  note?: string;
  isBest: boolean;
  valueIsBeacon: boolean;
}) {
  const showBeacon = valueIsBeacon && display !== "-";
  return (
    <div className="flex min-w-[6rem] flex-col gap-1">
      {/* Screen-reader label so each value is attributed to its player. */}
      <span className="sr-only">
        {playerName}
        :{" "}
      </span>
      <p
        className={`font-mono text-[15px] font-semibold tabular-nums ${
          isBest ? "text-brand-cyan" : "text-ink"
        }`}
      >
        {showBeacon ? <BeaconValue show>{display}</BeaconValue> : display}
      </p>
      {isBest && (
        <span className="inline-flex w-fit items-center gap-1 rounded-full border border-brand-cyan/50 bg-brand-cyan/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-cyan">
          <span aria-hidden="true">&#9670;</span> Best
        </span>
      )}
      {note && <p className="text-[11px] text-ink-subtle">{note}</p>}
    </div>
  );
}

function MobileCell({
  playerName,
  display,
  note,
  isBest,
  valueIsBeacon,
}: {
  playerName: string;
  display: string;
  note?: string;
  isBest: boolean;
  valueIsBeacon: boolean;
}) {
  const showBeacon = valueIsBeacon && display !== "-";
  return (
    <div
      className={`flex min-h-[3.25rem] flex-col gap-1 rounded-card border px-3 py-2 ${
        isBest ? "border-brand-cyan/50 bg-brand-cyan/10" : "border-line/60 bg-base/40"
      }`}
    >
      {/* The player name is real, visible text here (not sr-only): on a
          phone there is no header row to attribute a cell to a player by
          column, so the name has to live in the cell itself. */}
      <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-ink-subtle" title={playerName}>
        {playerName}
      </p>
      <p
        className={`font-mono text-[15px] font-semibold tabular-nums ${
          isBest ? "text-brand-cyan" : "text-ink"
        }`}
      >
        {showBeacon ? <BeaconValue show>{display}</BeaconValue> : display}
      </p>
      {isBest && (
        <span className="inline-flex w-fit items-center gap-1 rounded-full border border-brand-cyan/50 bg-brand-cyan/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-cyan">
          <span aria-hidden="true">&#9670;</span> Best
        </span>
      )}
      {note && <p className="text-[11px] text-ink-subtle">{note}</p>}
    </div>
  );
}
