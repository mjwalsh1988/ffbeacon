import type { ReactNode } from "react";

/**
 * A tier break, drawn the same way in Beacon Ranker's board-so-far rail, the
 * board editor and the public board page, so a break looks like one object
 * everywhere (plan section 13.4): a full-width beacon-gradient hairline with a
 * label pill on its left.
 *
 * The pill is real text ("Tier 2, Weekly starters"), not decoration: it is the
 * visible name of the tier that begins below the line. The hairline itself is
 * the only aria-hidden part. `children` is where a surface that edits breaks
 * puts the line's own controls, after the pill.
 */
export function TierBreakLine({
  tier,
  label,
  headingLevel,
  id,
  children,
}: {
  tier: number;
  /** The owner's custom label, or null for plain "Tier N". */
  label: string | null;
  /** Render the pill as a heading at this level, so a reader can move tier to
   * tier by heading. Omit for a plain span. */
  headingLevel?: 2 | 3 | 4;
  id?: string;
  children?: ReactNode;
}) {
  const text = label ? `Tier ${tier}, ${label}` : `Tier ${tier}`;
  const pillClass =
    "inline-flex shrink-0 items-center rounded-full border border-brand-purple/50 bg-surface px-2.5 py-0.5 text-xs font-semibold text-brand-purple-light";
  const Heading = headingLevel ? (`h${headingLevel}` as const) : null;
  return (
    <div className="flex flex-wrap items-center gap-2 py-1.5">
      {Heading ? (
        <Heading id={id} className={pillClass}>
          {text}
        </Heading>
      ) : (
        <span id={id} className={pillClass}>
          {text}
        </span>
      )}
      <span aria-hidden="true" className="h-px min-w-8 flex-1 bg-beacon" />
      {children}
    </div>
  );
}
