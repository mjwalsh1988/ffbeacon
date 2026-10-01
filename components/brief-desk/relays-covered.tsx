/**
 * "Relays covered": the list at the end of an edition linking every report
 * the edition drew on, by permalink. A plain <ul> of links under an h2 that
 * the table of contents points at. Only published Relays appear; a retracted
 * one is simply not listed.
 *
 * A long list shows the newest SHOWN_FIRST and keeps the rest one tap away in
 * a native disclosure, so a 120-report week does not run a quarter of a phone
 * page. Every report is still in the page and reachable; the disclosure's
 * summary says how many it holds.
 *
 * Server component.
 */

import Link from "next/link";
import { GuideSectionHeader } from "@/components/guides/guide-section-header";
import { formatEasternDate } from "@/lib/datetime";
import type { RelayCardData } from "@/lib/relays/load";
import { RELAY_KIND_LABELS } from "@/lib/relays/types";

export const RELAYS_COVERED_ID = "relays-covered";

const SHOWN_FIRST = 12;

function RelayItem({ r }: { r: RelayCardData }) {
  return (
    <li className="rounded-card border border-line bg-surface/40 px-4 py-3">
      {/* A block link with its own padding, not min-h-11 with centring: a
          one-line headline and a two-line one then sit the same distance
          above the line under them. The padding keeps the 44px target. */}
      <Link
        href={`/brief/relay/${r.slug}`}
        className="block py-2.5 font-medium text-ink underline decoration-ink-subtle/60 underline-offset-4 hover:text-brand-cyan hover:decoration-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
      >
        {r.headline}
      </Link>
      <p className="text-xs text-ink-subtle">
        {RELAY_KIND_LABELS[r.kind]}
        {r.week !== null ? `, week ${r.week}` : ""}, reported by @{r.sourceHandle.replace(/^@/, "")} on{" "}
        <time dateTime={r.sourcePostedAt}>{formatEasternDate(r.sourcePostedAt)}</time>
      </p>
    </li>
  );
}

export function RelaysCovered({ relays, eyebrow }: { relays: RelayCardData[]; eyebrow: string }) {
  if (relays.length === 0) return null;
  const sorted = [...relays].sort((a, b) => b.sourcePostedAt.localeCompare(a.sourcePostedAt));
  const first = sorted.slice(0, SHOWN_FIRST);
  const rest = sorted.slice(SHOWN_FIRST);
  return (
    <section aria-labelledby={RELAYS_COVERED_ID} className="mt-12">
      <GuideSectionHeader id={RELAYS_COVERED_ID} eyebrow={eyebrow} heading="Relays covered" tone="purple" />
      <p className="mt-3 text-sm leading-relaxed text-ink-muted">
        The {sorted.length === 1 ? "report" : `${sorted.length} reports`} this edition drew on, newest first. Each one credits its original reporter.
      </p>
      <ul role="list" className="mt-4 space-y-2">
        {first.map((r) => (
          <RelayItem key={r.id} r={r} />
        ))}
      </ul>
      {rest.length > 0 && (
        <details className="group mt-3">
          <summary className="inline-flex min-h-11 cursor-pointer items-center rounded-card border border-line bg-surface/60 px-4 text-sm font-semibold text-ink hover:border-brand-cyan/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan">
            {`Show the other ${rest.length} ${rest.length === 1 ? "report" : "reports"}`}
          </summary>
          <ul role="list" className="mt-3 space-y-2">
            {rest.map((r) => (
              <RelayItem key={r.id} r={r} />
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
