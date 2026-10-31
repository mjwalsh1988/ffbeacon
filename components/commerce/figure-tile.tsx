/**
 * One big figure in a definition list. The figure is ONE text node: a unit or a
 * missing word goes `sr-only` inside the same element, never in an aria-hidden
 * twin, so a screen reader following the pointer reads the number itself.
 *
 * Use inside a `<dl>`. Nothing boxes a tile; the grid's spacing rules the row.
 */

import type { ReactNode } from "react";

export type FigureTone = "positive" | "warning" | "danger" | "cyan" | "purple" | "ink";

const TONES: Record<FigureTone, string> = {
  positive: "text-signal-positive",
  warning: "text-signal-warning",
  danger: "text-signal-danger",
  cyan: "text-brand-cyan",
  purple: "text-brand-purple-light",
  ink: "text-ink",
};

export function FigureTile({
  label,
  value,
  srSuffix,
  hint,
  tone = "ink",
  compact = false,
  className = "",
  children,
}: {
  label: string;
  value: string | number;
  /** The missing words, read as part of the figure. */
  srSuffix?: string;
  hint?: string | null;
  tone?: FigureTone;
  /** A smaller figure for a long value, such as a dollar amount in a narrow cell. */
  compact?: boolean;
  /** Grid placement goes HERE, never on a wrapper: a dl may hold one div per group, not a div in a div. */
  className?: string;
  /** A bar or a chart under the figure. */
  children?: ReactNode;
}) {
  return (
    <div className={`min-w-0 ${className}`.trim()}>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">{label}</dt>
      <dd
        className={`mt-1.5 break-words font-mono font-black leading-none tabular-nums ${
          compact ? "text-3xl sm:text-4xl" : "text-4xl sm:text-5xl"
        } ${TONES[tone]}`}
      >
        {value}
        {srSuffix && <span className="sr-only"> {srSuffix}</span>}
      </dd>
      {hint && <dd className="mt-1.5 text-xs leading-snug text-ink-muted">{hint}</dd>}
      {children && <dd className="mt-2">{children}</dd>}
    </div>
  );
}
