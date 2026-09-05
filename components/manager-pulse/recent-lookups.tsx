/**
 * The handles this reader has looked up before, as links straight back to
 * those reports.
 *
 * The entry page was a single input field on an otherwise empty screen, and
 * the only way back to a report built five minutes ago was to remember the
 * handle and type it again. Every one of these is warm in
 * `manager_pulse_cache`, so following one costs an indexed read and no Sleeper
 * traffic at all.
 *
 * Renders nothing when there is nothing to show, rather than an empty box
 * explaining that there is nothing to show.
 *
 * Presentational server component.
 */

import Link from "next/link";
import { History } from "lucide-react";
import { formatEastern } from "@/lib/datetime";
import type { RecentManagerLookup } from "@/lib/manager-pulse/service";

export function RecentLookups({ lookups }: { lookups: RecentManagerLookup[] }) {
  if (lookups.length === 0) return null;

  return (
    <section
      aria-labelledby="mp-recent-heading"
      className="rounded-modal border border-line bg-surface/50 p-4 sm:p-5"
    >
      <h2
        id="mp-recent-heading"
        className="flex items-center gap-2 text-sm font-semibold text-ink"
      >
        <History aria-hidden="true" className="h-4 w-4 text-brand-cyan" />
        Managers you have looked up
      </h2>
      <ul className="mt-3 flex flex-wrap gap-2">
        {lookups.map((lookup) => (
          <li key={lookup.handle.toLowerCase()}>
            <Link
              href={`/tools/manager-pulse/${encodeURIComponent(lookup.handle.toLowerCase())}`}
              className="inline-flex min-h-11 flex-col justify-center rounded-card border border-line bg-base px-3 py-1.5 transition-colors hover:border-brand-cyan/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              <span className="text-sm font-semibold text-ink">{lookup.handle}</span>
              {/* A sibling line inside the same link on purpose: the date is
                  part of what distinguishes one chip from another, so it
                  belongs in the link's accessible name rather than beside it. */}
              <span className="text-[11px] text-ink-subtle">
                Last read {formatEastern(lookup.lookedUpAt)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
