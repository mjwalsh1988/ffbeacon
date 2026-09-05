/**
 * The chart furniture Manager Pulse draws with.
 *
 * Hand-rolled, no charting dependency, matching `components/chart-kit.tsx`
 * (which supplies the accessibility wrapper these render inside) and
 * `components/player-profile/value-trend-chart.tsx`. The project has never
 * carried a chart library and does not need one for a bar.
 *
 * THE RULE EVERY CHART HERE FOLLOWS: the bar is `aria-hidden`, and the figure
 * beside it is a real text node carrying the same number. Nothing on this page
 * is legible only as a shape. That is the same rule the report's other bars
 * already followed; this file is where it stops being restated in five places.
 *
 * MOBILE: every one of these lays out as label, bar, figure in a flex row
 * where the LABEL and the BAR flex and the FIGURE never shrinks. The figure is
 * the data; the bar is a second drawing of it. On a narrow column the bar gets
 * thin and then, below `sm`, gets out of the way entirely. No number is ever
 * the thing that clips.
 *
 * Presentational server components.
 */

import type { ReactNode } from "react";

/* -------------------------------------------------------------------------- */
/* Ranked bars                                                                */
/* -------------------------------------------------------------------------- */

export type RankedBarRow = {
  /** Stable React key. */
  key: string;
  /** Left-hand text. Kept as a node so a caller can put a chip beside a name. */
  label: ReactNode;
  /** Drives the bar length. Always non-negative here; see DivergingBars for signed. */
  value: number;
  /** Already-formatted figure shown at the right. Never truncated. */
  display: string;
  /** Tailwind background class for the filled part. */
  barClass?: string;
  /** Emphasised row (the leader). Gets the brand accent and heavier type. */
  lead?: boolean;
};

/**
 * A horizontal bar per row, longest first, each bar a share of the largest.
 *
 * Scaled to the largest row rather than to the total, because these charts
 * answer "who is biggest and by how much", and a share-of-total scale flattens
 * every row on a list with twenty entries into an unreadable stub.
 */
export function RankedBars({
  rows,
  barClass = "bg-brand-cyan",
  labelWidthClass = "sm:w-40",
}: {
  rows: RankedBarRow[];
  barClass?: string;
  /** Fixed label column from `sm`. Below that the label simply flexes. */
  labelWidthClass?: string;
}) {
  if (rows.length === 0) return null;
  const widest = Math.max(...rows.map((row) => Math.abs(row.value)), 0);

  return (
    <ul className="space-y-1.5">
      {rows.map((row) => (
        <li key={row.key} className="flex items-center gap-2 text-xs">
          <span
            className={`min-w-0 flex-1 truncate sm:flex-none ${labelWidthClass} ${
              row.lead ? "font-semibold text-ink" : "text-ink"
            }`}
          >
            {row.label}
          </span>
          <span className="hidden h-2.5 flex-1 overflow-hidden rounded-full bg-line/50 sm:block">
            <span
              aria-hidden="true"
              className={`block h-full rounded-full ${row.barClass ?? barClass}`}
              style={{
                width: `${widest > 0 ? Math.max(2, Math.round((Math.abs(row.value) / widest) * 100)) : 0}%`,
              }}
            />
          </span>
          <span
            className={`shrink-0 whitespace-nowrap text-right font-mono tabular-nums ${
              row.lead ? "font-bold text-brand-cyan" : "text-ink-muted"
            }`}
          >
            {row.display}
          </span>
        </li>
      ))}
    </ul>
  );
}

/* -------------------------------------------------------------------------- */
/* Diverging bars                                                             */
/* -------------------------------------------------------------------------- */

export type DivergingRow = {
  key: string;
  labelText: string;
  /** Signed. Negative draws left of the centre line, positive right. */
  value: number;
  display: string;
};

/**
 * Bars either side of a centre line, for a figure whose SIGN is the point.
 *
 * Position appetite and pick flow are both "which way is this manager
 * leaning", and a one-sided bar chart cannot say that without the reader
 * decoding a minus sign in the figure at the end of the row. Both halves are
 * scaled to the same largest magnitude, so the two sides are comparable.
 *
 * The centre line is drawn, and it is `aria-hidden` like every other mark
 * here: the sign is in the figure text and in the word beside it.
 */
export function DivergingBars({
  rows,
  positiveClass = "bg-signal-success",
  negativeClass = "bg-signal-warning",
  labelWidthClass = "sm:w-28",
}: {
  rows: DivergingRow[];
  positiveClass?: string;
  negativeClass?: string;
  labelWidthClass?: string;
}) {
  if (rows.length === 0) return null;
  const widest = Math.max(...rows.map((row) => Math.abs(row.value)), 0);

  return (
    <ul className="space-y-1.5">
      {rows.map((row) => {
        const share = widest > 0 ? Math.abs(row.value) / widest : 0;
        const width = `${Math.max(row.value === 0 ? 0 : 2, Math.round(share * 50))}%`;
        return (
          <li key={row.key} className="flex items-center gap-2 text-xs">
            <span className={`min-w-0 flex-1 truncate text-ink sm:flex-none ${labelWidthClass}`}>
              {row.labelText}
            </span>
            <span
              aria-hidden="true"
              className="relative hidden h-2.5 flex-1 rounded-full bg-line/50 sm:block"
            >
              {/* The centre line, so a reader can see which side a bar is on
                  without measuring it against its neighbours. */}
              <span className="absolute inset-y-[-2px] left-1/2 w-px -translate-x-1/2 bg-line-accent" />
              <span
                className={`absolute top-0 h-full rounded-full ${
                  row.value >= 0 ? positiveClass : negativeClass
                }`}
                style={
                  row.value >= 0 ? { left: "50%", width } : { right: "50%", width }
                }
              />
            </span>
            <span className="shrink-0 whitespace-nowrap text-right font-mono tabular-nums text-ink-muted">
              {row.display}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/* -------------------------------------------------------------------------- */
/* Stacked share bar                                                          */
/* -------------------------------------------------------------------------- */

export type ShareSegment = {
  key: string;
  labelText: string;
  count: number;
  /** Tailwind background class for this segment, and for its legend dot. */
  barClass: string;
};

/**
 * One bar split into its parts, with a legend under it.
 *
 * For a distribution over a handful of fixed categories this reads faster than
 * a row of separate bars: the eye compares slices of one whole rather than
 * lengths that all start at the same edge. The verdict distribution is exactly
 * that shape.
 *
 * A segment under two percent is still drawn, at a two percent minimum width,
 * because a category with three trades in it disappearing entirely would make
 * the bar disagree with the legend beside it.
 */
export function StackedShareBar({ segments }: { segments: ShareSegment[] }) {
  const rows = segments.filter((segment) => segment.count > 0);
  if (rows.length === 0) return null;
  const total = rows.reduce((sum, row) => sum + row.count, 0);

  return (
    <div>
      <div
        aria-hidden="true"
        className="flex h-3 w-full overflow-hidden rounded-full bg-line/50"
      >
        {rows.map((row) => (
          <span
            key={row.key}
            className={row.barClass}
            style={{ width: `${Math.max(2, (row.count / total) * 100)}%` }}
          />
        ))}
      </div>
      <ul className="mt-2.5 space-y-1">
        {rows.map((row) => (
          <li key={row.key} className="flex items-center gap-2 text-xs">
            <span
              aria-hidden="true"
              className={`h-2 w-2 shrink-0 rounded-full ${row.barClass}`}
            />
            <span className="min-w-0 flex-1 truncate text-ink">{row.labelText}</span>
            <span className="shrink-0 whitespace-nowrap font-mono tabular-nums text-ink-muted">
              {`${row.count} (${Math.round((row.count / total) * 100)}%)`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
