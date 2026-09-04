/**
 * The wrapper every Manager Pulse report section renders inside.
 *
 * A `<section>` with `aria-labelledby` pointing at its own `<h2>`, matching the
 * house `Panel` pattern (`components/dashboard-panel.tsx`) but built fresh for
 * this feature because Manager Pulse needs two things Panel does not carry:
 * a `typeExclusive` label that folds into the heading itself, and a
 * `scroll-margin-top` so the in-page section nav (`components/manager-shell/`,
 * built by another agent) lands a jumped-to section below the sticky header
 * rather than under it.
 *
 * `typeExclusive` matters under the All lens. A section that exists for only
 * one game (dynasty pick trading, redraft churn) has to SAY so in its own
 * heading rather than silently vanishing, or a reader is left wondering where
 * a card went. The label is plain text inside the `<h2>`, not a separate
 * badge, so it is announced as part of the section's name rather than as a
 * decoration a screen reader user could miss.
 */

import type { ReactNode } from "react";

const TYPE_EXCLUSIVE_LABEL: Record<"dynasty" | "redraft", string> = {
  dynasty: "Dynasty only",
  redraft: "Redraft only",
};

/**
 * Alternates the top-edge hairline and eyebrow color so a long report does not
 * read as one grey column. Purely decorative; every section still carries the
 * same real heading and body regardless of which accent it gets.
 */
const ACCENT_GRADIENT: Record<"purple" | "cyan", string> = {
  purple: "linear-gradient(90deg, transparent 0%, #A855F7 30%, #22D3EE 70%, transparent 100%)",
  cyan: "linear-gradient(90deg, transparent 0%, #22D3EE 30%, #A855F7 70%, transparent 100%)",
};

export function SectionFrame({
  id,
  title,
  eyebrow,
  sampleNote,
  typeExclusive,
  accent = "purple",
  isSample,
  children,
}: {
  /** Also the in-page nav anchor target. */
  id: string;
  title: string;
  eyebrow?: string;
  /** A short, quiet line under the title, e.g. "over 31 league-seasons". */
  sampleNote?: string;
  /** Appends a plain label to the heading when the section applies to one game only. */
  typeExclusive?: "dynasty" | "redraft";
  accent?: "purple" | "cyan";
  /** True on the guest sample report. Folds a plain-language disclaimer
   *  directly into this section's own `<h2>`, so a reader navigating by
   *  heading level hears it, rather than only in a wrapping region a heading
   *  jump can skip past. */
  isSample?: boolean;
  children: ReactNode;
}) {
  const headingId = `${id}-heading`;

  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className="relative scroll-mt-24 overflow-hidden rounded-modal border border-line bg-surface/50"
    >
      {/* Decorative top-edge hairline. Nothing here carries meaning on its
          own; the eyebrow and heading text are the real labels. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{ backgroundImage: ACCENT_GRADIENT[accent] }}
      />

      <div className="border-b border-line bg-surface-elevated/50 px-4 py-3.5 sm:px-5">
        {eyebrow && (
          <p
            className={`flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] ${
              accent === "cyan" ? "text-brand-cyan" : "text-brand-purple"
            }`}
          >
            <span
              aria-hidden="true"
              className="pointer-events-none h-3 w-1 shrink-0 rounded-full bg-beacon"
            />
            {eyebrow}
          </p>
        )}
        <h2
          id={headingId}
          className="mt-1 text-[17px] font-bold leading-tight tracking-tight text-ink"
        >
          {title}
          {typeExclusive && (
            <span className="ml-2 align-middle text-xs font-semibold normal-case tracking-normal text-ink-subtle">
              ({TYPE_EXCLUSIVE_LABEL[typeExclusive]})
            </span>
          )}
          {isSample && (
            <span className="ml-2 align-middle text-xs font-semibold normal-case tracking-normal text-brand-cyan">
              (Sample data, not a real manager)
            </span>
          )}
        </h2>
        {sampleNote && (
          <p className="mt-1 text-xs leading-relaxed text-ink-muted">{sampleNote}</p>
        )}
      </div>

      <div className="space-y-4 px-4 py-4 sm:px-5">{children}</div>
    </section>
  );
}
