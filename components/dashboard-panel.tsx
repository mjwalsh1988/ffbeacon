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
      {/* Top-edge beacon hairline, decorative. */}
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-px"
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
                className="h-3 w-1 shrink-0 rounded-full bg-beacon"
              />
              {eyebrow}
            </p>
          )}
          <Heading
            id={titleId}
            className="mt-1 text-[17px] font-bold leading-tight tracking-tight text-ink"
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
