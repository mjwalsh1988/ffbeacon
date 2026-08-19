/**
 * The card every page masthead is painted on: the border, the two-stop beacon
 * wash, and the gradient hairline along the top edge.
 *
 * PageMasthead is the usual way in, and most pages should use that. This exists
 * for the one masthead that cannot: the player profile puts a headshot beside
 * the identity and tints the corner with the team colour, which is enough
 * bespoke structure that bending PageMasthead around it would cost more than it
 * saves. What it must not do is restate the gradient stops, because then a
 * change to the house style has to be made in two places and one of them gets
 * forgotten.
 *
 * Presentational server component.
 */

import type { ReactNode } from "react";

export function MastheadCard({
  labelledBy,
  children,
  className = "",
}: {
  /** Id of the heading inside that names this section. */
  labelledBy: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-labelledby={labelledBy}
      className={`relative overflow-hidden rounded-modal border border-line-accent bg-surface/40 ${className}`}
      style={{
        backgroundImage:
          "radial-gradient(ellipse at 0% 0%, rgba(168, 85, 247, 0.14) 0%, transparent 58%), radial-gradient(ellipse at 100% 0%, rgba(34, 211, 238, 0.10) 0%, transparent 60%)",
      }}
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
      {children}
    </section>
  );
}

/** The size every masthead title is set at, so the two agree. */
export const MASTHEAD_TITLE_SIZE = "text-[clamp(1.75rem,4.6vw,3.1rem)]";
