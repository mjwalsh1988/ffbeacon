"use client";

import Link from "next/link";
import { openSignalGuide, useSignalGuideAvailable } from "@/lib/guide/open-guide";

/**
 * "What is X?" next to a metric, opening the Signal Guide at that term.
 *
 * Two renderings, and which one appears is decided by whether the page
 * actually has a guide:
 *
 *   - It does: a real button that opens the panel in place, at the named
 *     entry, expanded, with focus on it. The reader stays where they were.
 *   - It does not (no registry entry for the route, nothing published, or the
 *     panel has not hydrated yet): a plain link to `fallbackHref`, which is
 *     what this control did before the opener existed. A control that silently
 *     does nothing would be worse than the link it replaced.
 *
 * Server rendering always produces the link, because `useSignalGuideAvailable`
 * reports false until the mount has fetched the page's content. That is
 * deliberate: the markup a crawler and a no-JavaScript reader get is a working
 * link, and it upgrades to the opener on hydration.
 */
export function GuideTermLink({
  heading,
  fallbackHref,
  label,
  ariaLabel,
  fallbackAriaLabel,
  className,
}: {
  /** Matched against guide_entries.heading, case-insensitively. */
  heading: string;
  /** Where to send the reader when no in-place guide exists on this page. */
  fallbackHref: string;
  label: string;
  /** Announced when the control opens the panel in place. */
  ariaLabel: string;
  /** Announced when the control is a link away. Defaults to `ariaLabel`. */
  fallbackAriaLabel?: string;
  className?: string;
}) {
  const available = useSignalGuideAvailable();

  if (!available) {
    return (
      <Link href={fallbackHref} className={className} aria-label={fallbackAriaLabel ?? ariaLabel}>
        {label}
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={() => openSignalGuide(heading)}
      aria-haspopup="dialog"
      className={className}
      aria-label={ariaLabel}
    >
      {label}
    </button>
  );
}
