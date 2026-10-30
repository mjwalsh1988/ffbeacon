/**
 * The report card sheet: the one document every Team Blueprint section is
 * written on.
 *
 * The page used to be a stack of dashboard panels, each its own box with its
 * own header band. A blueprint is one document somebody wrote about one
 * team, so it is now ONE sheet: a letterhead, then numbered sections divided
 * by full-width rules, each with its number and title in a left margin column
 * and its content in the body column (single column below lg, where the
 * margin becomes a heading row). Inside a section nothing is boxed: lists are
 * ruled rows, figures sit on the sheet, and the only enclosed shape on the
 * whole page is the grade box in the letterhead, because a grade box is what
 * a report card has.
 *
 * Headings are real: the letterhead title and every section title are h2, so
 * the outline under the league's h1 reads as the document's table of
 * contents. The section number is text, read as part of the heading.
 */

import type { ReactNode } from "react";

/** The whole document. */
export function Sheet({ children, labelledBy }: { children: ReactNode; labelledBy: string }) {
  return (
    <article
      aria-labelledby={labelledBy}
      className="relative mt-6 overflow-hidden rounded-modal border border-line-accent bg-surface/60"
    >
      {/* The letterhead stripe: the one place on the sheet the gradient is a
          surface rather than text. Decorative; the sheet is named by its title. */}
      <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-beacon" />
      {children}
    </article>
  );
}

/**
 * One numbered section. The margin column carries the number, the title and
 * the helper sentence; the body column carries everything else. The rule
 * above each section is the division a reader's eye uses to find the next
 * heading, and it runs the full width of the sheet.
 */
export function SheetSection({
  id,
  number,
  title,
  helper,
  children,
  bodyClassName = "",
}: {
  id: string;
  /** "01" to "12", drawn before the title and read as part of the heading. */
  number: string;
  title: string;
  helper?: string;
  children: ReactNode;
  bodyClassName?: string;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="grid gap-4 border-t border-line px-5 py-6 sm:px-8 lg:grid-cols-[11rem_minmax(0,1fr)] lg:gap-8 lg:py-8"
    >
      <div className="min-w-0 lg:sticky lg:top-[9.5rem] lg:self-start">
        <h2 id={`${id}-title`} className="flex items-baseline gap-3 text-sm font-bold uppercase tracking-[0.14em] text-ink">
          <span className="font-mono text-[11px] font-semibold tracking-normal text-brand-cyan">{number}</span>
          <span>{title}</span>
        </h2>
        {helper && <p className="mt-2 text-xs leading-relaxed text-ink-muted">{helper}</p>}
      </div>
      <div className={`min-w-0 ${bodyClassName}`}>{children}</div>
    </section>
  );
}

/**
 * A labeled line in a definition list, with a dotted leader between the
 * label and the value the way a printed form draws one. The leader is the
 * dt's own ::after, so the dl holds nothing but dt and dd.
 */
export function Leader({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-2 py-1.5">
      <dt className="flex min-w-0 flex-1 items-baseline text-[11px] font-semibold uppercase tracking-wide text-ink-subtle after:ml-2 after:min-w-6 after:flex-1 after:border-b after:border-dotted after:border-line-accent after:content-['']">
        {label}
      </dt>
      <dd className="shrink-0 text-right text-sm font-medium text-ink">{children}</dd>
    </div>
  );
}

/** A ruled list: rows divided by hairlines, no box around them. */
export const RULED = "divide-y divide-line/70 border-y border-line";

/** A thin drawn bar under a figure, filled to a fraction of its track. */
export function Bar({ fraction, tone = "beacon", className = "" }: { fraction: number; tone?: "beacon" | "muted" | "warning" | "positive"; className?: string }) {
  const width = `${Math.round(Math.min(1, Math.max(0, fraction)) * 1000) / 10}%`;
  const fill =
    tone === "beacon" ? "bg-beacon" : tone === "warning" ? "bg-signal-warning" : tone === "positive" ? "bg-signal-positive" : "bg-ink/40";
  return (
    <span aria-hidden="true" className={`block h-1 w-full overflow-hidden rounded-full bg-ink/[0.08] ${className}`}>
      <span className={`block h-full rounded-full ${fill}`} style={{ width }} />
    </span>
  );
}
