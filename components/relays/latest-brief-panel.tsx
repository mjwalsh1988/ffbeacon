/**
 * The "Latest Brief" panel pinned above the Relay feed on /brief: the newest
 * published edition, its dateline, the period it covers, its summary and a
 * link. When no edition exists the hub renders nothing here, never a "coming
 * soon" card (the AdSense review removed those).
 *
 * The panel's own eyebrow says "Latest Brief", so a caller must not print that
 * label above it as well. The heading level is the caller's, because the panel
 * sits under an h1 on /brief and under an h2 on the homepage.
 *
 * Server component.
 */

import Link from "next/link";
import { ArrowRight, BookOpen } from "lucide-react";
import { formatEasternDate } from "@/lib/datetime";
import { formatPeriod } from "@/lib/brief-desk/period";
import type { LatestBrief } from "@/lib/relays/load";

/**
 * "Covers Sep 9 to Sep 15, 2026". Named apart from lib/brief-desk/period.ts
 * periodLabel, which answers a different question ("Week 2") from a different
 * argument; two exports with one name and two signatures is how a caller
 * imports the wrong one.
 */
function coversLabel(brief: LatestBrief): string | null {
  const period = formatPeriod(brief.periodStart, brief.periodEnd);
  return period ? `Covers ${period}` : null;
}

export function LatestBriefPanel({
  brief,
  headingLevel = 2,
}: {
  brief: LatestBrief | null;
  /**
   * 2 on /brief, where the panel sits directly under the masthead h1. 3 on the
   * homepage, where it sits under the section h2.
   */
  headingLevel?: 2 | 3;
}) {
  if (!brief) return null;
  const period = coversLabel(brief);
  const Heading = (`h${headingLevel}` as const) as "h2" | "h3";
  return (
    <section
      aria-labelledby="latest-brief-heading"
      className="mb-6 rounded-modal border border-brand-purple/40 bg-surface/60 p-5 sm:p-6"
      style={{ boxShadow: "0 0 80px -52px rgba(168, 85, 247, 0.55)" }}
    >
      <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-purple">
        <BookOpen aria-hidden="true" className="h-3.5 w-3.5" />
        Latest Brief
      </p>
      <Heading id="latest-brief-heading" className="mt-2 text-xl font-semibold leading-snug tracking-tight text-ink sm:text-2xl">
        <Link
          href={`/brief/${brief.slug}`}
          className="hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          {brief.title}
        </Link>
      </Heading>
      <p className="mt-2 text-xs text-ink-subtle">
        {brief.publishedAt && (
          <>
            Published <time dateTime={brief.publishedAt}>{formatEasternDate(brief.publishedAt)}</time>
          </>
        )}
        {period && <>{brief.publishedAt ? ". " : ""}{period}.</>}
      </p>
      {brief.tlDr && <p className="mt-3 text-sm leading-relaxed text-ink-muted sm:text-base">{brief.tlDr}</p>}
      <Link
        href={`/brief/${brief.slug}`}
        className="mt-4 inline-flex min-h-11 items-center gap-1.5 rounded-card bg-beacon px-4 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
      >
        Read the Brief
        <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
      </Link>
    </section>
  );
}
