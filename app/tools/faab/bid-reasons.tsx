"use client";

import { useId } from "react";
import { Info } from "lucide-react";

/**
 * Why this number.
 *
 * Three to five lines, each citing a figure that is on the same screen, built
 * by lib/faab/reasons.ts from deterministic templates. A reader has to be able
 * to check every sentence against the numbers beside it, which is exactly what
 * a generated sentence would not allow.
 *
 * Plain text in a plain list. Nothing here is a chip or an icon carrying
 * meaning on its own.
 */
export function BidReasons({ reasons }: { reasons: string[] }) {
  const headingId = `${useId()}-reasons`;
  if (reasons.length === 0) return null;

  return (
    <section
      aria-labelledby={headingId}
      className="rounded-card border border-line bg-surface/40 p-4"
    >
      <h4
        id={headingId}
        className="flex items-center gap-2 text-sm font-semibold text-ink"
      >
        <Info aria-hidden="true" className="h-4 w-4 text-brand-cyan" />
        Why this number
      </h4>
      <ul role="list" className="mt-3 space-y-2">
        {reasons.map((reason) => (
          <li key={reason} className="text-sm leading-relaxed text-ink-muted">
            {reason}
          </li>
        ))}
      </ul>
    </section>
  );
}
