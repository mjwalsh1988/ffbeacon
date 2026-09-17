/**
 * The hub's four ways of looking at the same reports: a grid, one card per
 * row, the season by week, and a month calendar. Plain links, so every view
 * is a shareable address and works without JavaScript; the current one is
 * aria-current. The other filters in the address travel with the switch.
 *
 * Server component.
 */

import Link from "next/link";
import { CalendarDays, LayoutGrid, List, Rows3, type LucideIcon } from "lucide-react";
import { feedQuery, type FeedSearch, type FeedView } from "@/lib/relays/feed-params";

const VIEWS: Array<{ view: FeedView; label: string; icon: LucideIcon }> = [
  { view: "grid", label: "Grid", icon: LayoutGrid },
  { view: "feed", label: "Feed", icon: List },
  { view: "week", label: "By week", icon: Rows3 },
  { view: "calendar", label: "Calendar", icon: CalendarDays },
];

const linkBase =
  "inline-flex min-h-11 items-center gap-1.5 rounded-card border px-3 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan";

export function ViewSwitcher({ current, search }: { current: FeedView; search: FeedSearch }) {
  return (
    <nav aria-label="Ways to browse the reports">
      <ul role="list" className="flex flex-wrap gap-2">
        {VIEWS.map(({ view, label, icon: Icon }) => {
          const active = view === current;
          // A change of view starts at page 1 and carries only what that view
          // applies. The calendar shows the whole month and carries nothing
          // but the month; the week view is a week, so a chosen day is
          // dropped; the grid and the feed keep every filter.
          const carried: FeedSearch =
            view === "calendar"
              ? { view, month: search.month }
              : view === "week"
                ? { view, kind: search.kind, week: search.week, team: search.team, player: search.player }
                : { view, kind: search.kind, week: search.week, team: search.team, player: search.player, date: search.date };
          const href = `/brief${feedQuery(carried)}`;
          return (
            <li key={view}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`${linkBase} ${
                  active
                    ? "border-brand-cyan/60 bg-brand-cyan/10 text-brand-cyan"
                    : "border-line bg-base text-ink-muted hover:border-brand-cyan/60 hover:text-ink"
                }`}
              >
                <Icon aria-hidden="true" className="h-4 w-4" />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
