/**
 * The season's weeks as a row of links with the count of reports in each,
 * newest week first, for the hub's week view. The chosen week is
 * aria-current; the other filters travel with the choice.
 *
 * Server component.
 */

import Link from "next/link";
import { feedQuery, type FeedSearch } from "@/lib/relays/feed-params";
import type { RelayWeekCount } from "@/lib/relays/load";

export function WeekRail({
  weeks,
  selected,
  search,
}: {
  weeks: RelayWeekCount[];
  selected: number | null;
  search: FeedSearch;
}) {
  if (weeks.length === 0) return null;
  return (
    <nav aria-label="Weeks with reports" className="mb-5">
      <ul role="list" className="flex flex-wrap gap-2">
        {weeks.map(({ week, count }) => {
          const active = week === selected;
          const href = `/brief${feedQuery({ ...search, view: "week", week: String(week), page: undefined })}`;
          return (
            <li key={week}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`inline-flex min-h-11 items-center gap-1.5 rounded-card border px-3 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan ${
                  active
                    ? "border-brand-purple/60 bg-brand-purple/10 text-brand-purple-light"
                    : "border-line bg-base text-ink-muted hover:border-brand-purple/60 hover:text-ink"
                }`}
              >
                Week {week}
                <span className="text-xs font-normal text-ink-subtle">
                  {count}
                  <span className="sr-only"> {count === 1 ? "report" : "reports"}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
