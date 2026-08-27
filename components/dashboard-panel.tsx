/**
 * Dashboard Panel: the shared paneled container that gives the League Pulse deep
 * view its command-center look, mirroring the On The Clock cockpit `Panel`. A
 * bordered surface with a top beacon-gradient hairline, a structured header
 * (eyebrow + heading + helper + optional action), and an optional soft glow.
 * Headings are real <h2>/<h3>/<h4> elements so the dashboard keeps a correct,
 * navigable outline.
 *
 * Server component (no client hooks): purely presentational so it can be used
 * directly inside the server-rendered league pages. Color is always paired with
 * text, so nothing here is color-only.
 */

import type { ReactNode } from "react";

type HeadingLevel = 2 | 3 | 4;

export function Panel({
  id,
  eyebrow,
  title,
  helper,
  action,
  glow = false,
  headingLevel = 2,
  className = "",
  bodyClassName = "",
  headingFocusable = false,
  children,
}: {
  id?: string;
  eyebrow?: string;
  title: string;
  helper?: string;
  action?: ReactNode;
  glow?: boolean;
  headingLevel?: HeadingLevel;
  className?: string;
  bodyClassName?: string;
  /**
   * Adds tabIndex={-1} to the heading so an in-page anchor link (`href="#{id}-
   * title"`) can move keyboard/screen-reader focus to this panel's heading,
   * not merely scroll the viewport to it. Off by default: most panels are not
   * anchor targets, and a heading is not normally in the tab order.
   */
  headingFocusable?: boolean;
  children: ReactNode;
}) {
  const Heading = (`h${headingLevel}` as const) as "h2" | "h3" | "h4";
  const titleId = id ? `${id}-title` : undefined;
  return (
    <section
      id={id}
      aria-labelledby={titleId}
      className={`relative overflow-hidden rounded-modal border border-line bg-surface/50 ${className}`}
      style={glow ? { boxShadow: "0 0 80px -48px rgba(168, 85, 247, 0.55)" } : undefined}
    >
      {/* Top-edge beacon hairline, decorative.

          pointer-events-none is not cosmetic. This span is absolutely
          positioned across the full width of the panel, so it sits OVER the
          top edge of the header, and anything the mouse finds there hit-tests
          to a decorative element that carries no accessible name. A screen
          reader following the mouse (NVDA mouse tracking, ZoomText) then
          announces nothing at all for a control the reader is pointing
          straight at. Every decorative overlay in this file carries it for the
          same reason. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{
          backgroundImage:
            "linear-gradient(90deg, transparent 0%, #A855F7 30%, #22D3EE 70%, transparent 100%)",
        }}
      />
      {/* THE HEADER IS A BAND, NOT A LINE OF TEXT.
          A dozen of these stack down a page, and with the header sharing the
          body's background the only thing separating one section from the next
          was a one pixel rule the eye has to go looking for. A tinted band, a
          full-weight border under it, and a short beacon bar beside the eyebrow
          give every section a visible start. Nothing here carries meaning on
          its own: the eyebrow and the heading are the labels, and the bar is
          aria-hidden. */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line bg-surface-elevated/50 px-4 py-3.5 sm:px-5">
        <div className="min-w-0">
          {eyebrow && (
            <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-cyan">
              <span
                aria-hidden="true"
                className="pointer-events-none h-3 w-1 shrink-0 rounded-full bg-beacon"
              />
              {eyebrow}
            </p>
          )}
          <Heading
            id={titleId}
            tabIndex={headingFocusable ? -1 : undefined}
            className="mt-1 text-[17px] font-bold leading-tight tracking-tight text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            {title}
          </Heading>
          {helper && <p className="mt-1 text-xs leading-relaxed text-ink-muted">{helper}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {/* A supplied bodyClassName REPLACES the default padding, so callers can
          render a full-bleed table (bodyClassName="p-0") inside the panel. */}
      <div className={bodyClassName || "px-4 py-4 sm:px-5"}>{children}</div>
    </section>
  );
}

/** A small labeled metric for the sidebar status panels: big accent number. */
export function StatReadout({
  label,
  value,
  accent = "cyan",
}: {
  label: string;
  value: string;
  accent?: "cyan" | "purple" | "ink";
}) {
  const color =
    accent === "purple"
      ? "text-brand-purple"
      : accent === "ink"
        ? "text-ink"
        : "text-brand-cyan";
  return (
    <div className="rounded-card border border-line bg-base/50 px-3 py-2">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
        {label}
      </dt>
      <dd className={`mt-0.5 font-mono text-lg font-bold tabular-nums ${color}`}>{value}</dd>
    </div>
  );
}
