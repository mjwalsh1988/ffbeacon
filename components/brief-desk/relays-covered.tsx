/**
 * "Relays covered": the list at the end of an edition linking every report
 * the edition drew on, by permalink. A plain <ul> of links under an h2 that
 * the table of contents points at. Only published Relays appear; a retracted
 * one is simply not listed.
 *
 * Server component.
 */

import Link from "next/link";
import { GuideSectionHeader } from "@/components/guides/guide-section-header";
import { formatEasternDate } from "@/lib/datetime";
import type { RelayCardData } from "@/lib/relays/load";
import { RELAY_KIND_LABELS } from "@/lib/relays/types";

export const RELAYS_COVERED_ID = "relays-covered";

export function RelaysCovered({ relays, eyebrow }: { relays: RelayCardData[]; eyebrow: string }) {
  if (relays.length === 0) return null;
  const sorted = [...relays].sort((a, b) => b.sourcePostedAt.localeCompare(a.sourcePostedAt));
  return (
    <section aria-labelledby={RELAYS_COVERED_ID} className="mt-12">
      <GuideSectionHeader id={RELAYS_COVERED_ID} eyebrow={eyebrow} heading="Relays covered" tone="purple" />
      <p className="mt-3 text-sm leading-relaxed text-ink-muted">
        The {sorted.length === 1 ? "report" : `${sorted.length} reports`} this edition drew on, newest first. Each one credits its original reporter.
      </p>
      <ul role="list" className="mt-4 space-y-2">
        {sorted.map((r) => (
          <li key={r.id} className="rounded-card border border-line bg-surface/40 px-4 py-3">
            <Link
              href={`/brief/relay/${r.slug}`}
              className="inline-flex min-h-11 items-center font-medium text-ink underline underline-offset-2 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              {r.headline}
            </Link>
            <p className="mt-0.5 text-xs text-ink-subtle">
              {RELAY_KIND_LABELS[r.kind]}
              {r.week !== null ? `, week ${r.week}` : ""}, reported by @{r.sourceHandle.replace(/^@/, "")} on{" "}
              <time dateTime={r.sourcePostedAt}>{formatEasternDate(r.sourcePostedAt)}</time>
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
