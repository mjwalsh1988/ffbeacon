/**
 * One month of reports as a calendar: a real <table>, seven columns Sunday to
 * Saturday, one row per week, each day cell carrying the day number as a link
 * to that day's reports, the count, and the headlines as one-line links to
 * their permalinks. A busy day shows the first few and keeps the rest behind
 * a native "N more" disclosure that opens in place, so every report of the
 * month is reachable from the calendar itself.
 *
 * Seven columns do not fit a phone, so the table sits in a focusable, named
 * scroll region rather than dropping columns: every day, every count and
 * every headline is present at every width. Month navigation is two links.
 *
 * Server component. Days are Eastern calendar days (lib/relays/calendar.ts).
 */

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { easternDateKey, monthGrid, monthLabel, shiftMonth, WEEKDAY_LABELS } from "@/lib/relays/calendar";
import { feedQuery } from "@/lib/relays/feed-params";
import type { RelayCalendarItem } from "@/lib/relays/load";
import { RELAY_KIND_LABELS } from "@/lib/relays/types";

/**
 * Headlines shown inside a day cell before the "N more" disclosure. Each is
 * clamped to one line so a busy day stays a scannable list; the rest of the
 * day expands in place, and the day number opens the day's full reports.
 */
const PREVIEW_PER_DAY = 5;

const navLink =
  "inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-base px-3 text-sm font-semibold text-ink-muted transition-colors hover:border-brand-cyan/60 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan";

export function RelayCalendar({
  year,
  month,
  items,
  todayKey,
}: {
  year: number;
  month: number;
  items: RelayCalendarItem[];
  /** The Eastern date of the render, so today's cell can say so. */
  todayKey: string;
}) {
  const byDay = new Map<string, RelayCalendarItem[]>();
  for (const item of items) {
    const key = easternDateKey(item.sourcePostedAt);
    byDay.set(key, [...(byDay.get(key) ?? []), item]);
  }
  const rows = monthGrid(year, month);
  const label = monthLabel(year, month);
  const prev = shiftMonth(year, month, -1);
  const next = shiftMonth(year, month, 1);
  // The calendar shows EVERY report in the month, so its links carry no
  // filter. Carrying the address's week or kind into a day link made a day
  // from another week open as "no reports" while the cell said eight.
  const monthHref = (m: { year: number; month: number }) =>
    `/brief${feedQuery({ view: "calendar", month: `${m.year}-${String(m.month).padStart(2, "0")}` })}`;
  const dayHref = (key: string) => `/brief${feedQuery({ date: key })}`;
  const total = items.length;

  return (
    <section aria-labelledby="relay-calendar-heading">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h3 id="relay-calendar-heading" className="text-lg font-semibold text-ink">
          {label}
          <span className="ml-2 text-sm font-normal text-ink-muted">
            {total} {total === 1 ? "report" : "reports"}
          </span>
        </h3>
        <nav aria-label="Months" className="flex gap-2">
          <Link href={monthHref(prev)} className={navLink}>
            <ChevronLeft aria-hidden="true" className="h-4 w-4" />
            {monthLabel(prev.year, prev.month)}
          </Link>
          <Link href={monthHref(next)} className={navLink}>
            {monthLabel(next.year, next.month)}
            <ChevronRight aria-hidden="true" className="h-4 w-4" />
          </Link>
        </nav>
      </div>

      <div
        className="overflow-x-auto rounded-card border border-line focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-cyan"
        tabIndex={0}
        role="region"
        aria-label={`${label}, calendar of reports`}
      >
        <table className="w-full min-w-[840px] table-fixed border-collapse text-sm">
          <caption className="sr-only">
            Reports in {label} by day. Each day lists how many reports were posted and their headlines, with the rest of a busy day behind a "more" control; the day number opens every report from that day.
          </caption>
          <thead>
            <tr>
              {WEEKDAY_LABELS.map((day) => (
                <th key={day} scope="col" className="border-b border-line bg-surface/60 px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
                  {day}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="align-top">
                {row.map((cell) => {
                  const dayItems = byDay.get(cell.key) ?? [];
                  const preview = dayItems.slice(0, PREVIEW_PER_DAY);
                  const rest = dayItems.slice(PREVIEW_PER_DAY);
                  const isToday = cell.key === todayKey;
                  const headlineClass =
                    "block truncate text-xs leading-snug text-ink-muted hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan";
                  const headlineLink = (item: RelayCalendarItem) => (
                    <li key={item.id} className="min-w-0">
                      <Link href={`/brief/relay/${item.slug}`} className={headlineClass} title={item.headline}>
                        <span className="sr-only">{RELAY_KIND_LABELS[item.kind]}: </span>
                        {item.headline}
                      </Link>
                    </li>
                  );
                  return (
                    <td
                      key={cell.key}
                      className={`h-32 border-b border-r border-line p-2 align-top last:border-r-0 ${cell.inMonth ? "" : "bg-base/40 text-ink-subtle"}`}
                    >
                      <p className="flex items-center justify-between gap-2">
                        {/* The day number is the link to the day's full reports
                            when it has any; the count beside it is plain text. */}
                        {dayItems.length > 0 ? (
                          <Link
                            href={dayHref(cell.key)}
                            className={`inline-flex min-h-11 items-center text-sm font-semibold underline underline-offset-2 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan ${isToday ? "text-brand-cyan" : "text-ink"}`}
                          >
                            {cell.day}
                            <span className="sr-only">
                              {isToday ? ", today" : ""}: open every report from this day
                            </span>
                          </Link>
                        ) : (
                          <span className={`inline-flex min-h-11 items-center text-sm font-semibold ${isToday ? "text-brand-cyan" : cell.inMonth ? "text-ink" : ""}`}>
                            {cell.day}
                            {isToday && <span className="sr-only">, today</span>}
                          </span>
                        )}
                        {dayItems.length > 0 && (
                          <span className="inline-flex items-center rounded-full border border-brand-cyan/40 bg-brand-cyan/10 px-2 py-0.5 text-[11px] font-semibold text-brand-cyan">
                            {dayItems.length}
                            <span className="sr-only"> {dayItems.length === 1 ? "report" : "reports"}</span>
                          </span>
                        )}
                      </p>
                      {preview.length > 0 && (
                        <ul role="list" className="mt-1 space-y-1">
                          {preview.map(headlineLink)}
                        </ul>
                      )}
                      {rest.length > 0 && (
                        // A native disclosure, so the rest of the day opens in
                        // place with no script: the summary reads "3 more" and
                        // the platform supplies the expanded state.
                        <details className="group mt-1">
                          <summary className="inline-flex min-h-11 cursor-pointer list-none items-center text-xs font-semibold text-brand-cyan underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan [&::-webkit-details-marker]:hidden">
                            <span className="group-open:hidden">{rest.length} more</span>
                            <span className="hidden group-open:inline">Show fewer</span>
                          </summary>
                          <ul role="list" className="mt-1 space-y-1">
                            {rest.map(headlineLink)}
                          </ul>
                        </details>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {total === 0 && <p className="mt-3 text-sm text-ink-muted">No reports were posted in {label}.</p>}
    </section>
  );
}
