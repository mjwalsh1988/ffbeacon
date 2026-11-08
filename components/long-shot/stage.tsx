/**
 * The stage (plan 18A.2): the one lit element the whole game lives on. Two
 * stadium-light gradients at the top corners, a faint yard-line pattern
 * behind the content and a beacon bar across the top edge, all decorative.
 * Inside it there are no nested bordered boxes: sections are separated by
 * hairlines and spacing.
 *
 * `ribbon` draws the demo's diagonal "Sample" ribbon (plan 18A.12). The word
 * is real text, so it is read as well as seen.
 */

import type { ReactNode } from "react";

export const STADIUM_LIGHTS =
  "radial-gradient(ellipse at 0% 0%, rgba(34,211,238,0.16), transparent 55%), radial-gradient(ellipse at 100% 0%, rgba(168,85,247,0.18), transparent 55%)";

export function Stage({
  children,
  ribbon,
  labelledBy,
  as: Tag = "section",
}: {
  children: ReactNode;
  ribbon?: string;
  labelledBy?: string;
  as?: "section" | "div";
}) {
  return (
    <Tag
      aria-labelledby={labelledBy}
      className="relative mx-auto w-full max-w-3xl overflow-hidden rounded-[24px] border border-line-accent bg-surface"
      style={{ backgroundImage: STADIUM_LIGHTS }}
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-[3px] bg-beacon" />
      <svg aria-hidden="true" focusable="false" className="pointer-events-none absolute inset-0 h-full w-full">
        <defs>
          <pattern id="ls-yard-lines" width="48" height="48" patternUnits="userSpaceOnUse">
            <line x1="0" y1="0" x2="0" y2="48" stroke="#FFFFFF" strokeOpacity="0.05" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#ls-yard-lines)" />
      </svg>
      {ribbon && (
        <div className="pointer-events-none absolute right-[-44px] top-[18px] z-10 rotate-45 border-y border-[#F59E0B] bg-base/90 px-12 py-1 font-mono text-xs font-bold uppercase tracking-[0.2em] text-[#F59E0B]">
          {ribbon}
        </div>
      )}
      <div className="relative px-5 py-6 sm:px-8 sm:py-8">{children}</div>
    </Tag>
  );
}
