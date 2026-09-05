/**
 * One card in the Manager Pulse rail, and it collapses.
 *
 * A 340px rail holding four summary cards is taller than a viewport, so a
 * reader who wants the one at the bottom scrolls past three they have already
 * read. `<details>` is the whole mechanism: no JavaScript, no state, no
 * hydration, keyboard-operable and announced as a disclosure by every screen
 * reader, and it survives the page being server-rendered on every request
 * because the open state is the element's own.
 *
 * The summary carries a count or a one-word figure on the right, so a
 * collapsed card still says something rather than being a closed lid with a
 * label on it.
 *
 * Presentational server component.
 */

import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

export function RailCard({
  title,
  badge,
  defaultOpen = true,
  children,
}: {
  title: string;
  /** A short figure shown on the summary row, readable while collapsed. */
  badge?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details
      open={defaultOpen}
      className="group overflow-hidden rounded-modal border border-line bg-surface/50 [&_summary::-webkit-details-marker]:hidden"
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 border-b border-line bg-surface-elevated/50 px-4 py-3 text-sm font-semibold text-ink transition-colors hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan">
        <ChevronDown
          aria-hidden="true"
          className="h-4 w-4 shrink-0 text-ink-subtle transition-transform group-open:rotate-0 [details:not([open])_&]:-rotate-90"
        />
        <span className="min-w-0 flex-1">{title}</span>
        {badge && (
          <span className="shrink-0 font-mono text-xs font-bold tabular-nums text-brand-cyan">
            {badge}
          </span>
        )}
      </summary>
      <div className="px-4 py-3.5">{children}</div>
    </details>
  );
}

/**
 * A label and a figure on one line, the rail's workhorse row.
 *
 * The figure and its "we could not measure this" reason are ONE text node,
 * with the reason `sr-only` inside the same element, matching `StatTile`. A
 * hidden accessible twin beside a visible dash goes silent the moment a
 * pointer reader lands on it.
 */
export function RailFigure({
  label,
  value,
  emptyReason = "Not enough data",
}: {
  label: string;
  value: string | null;
  emptyReason?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line/50 py-2 last:border-b-0">
      <dt className="min-w-0 text-xs text-ink-muted">{label}</dt>
      <dd
        className={`shrink-0 font-mono text-sm font-bold tabular-nums ${
          value === null ? "text-ink-subtle" : "text-ink"
        }`}
      >
        {value === null ? (
          <>
            {"--"}
            <span className="sr-only"> {emptyReason}</span>
          </>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}
