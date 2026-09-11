"use client";

/**
 * The Who Should I Start week picker: a native select that pushes ?week=N.
 *
 * CLIENT, because it changes the URL, but it is deliberately tiny: the list
 * of selectable weeks and the live week are computed server side and handed
 * in as props, so this file owns nothing but reading the current value out of
 * the URL and writing the new one back.
 *
 * WORKS WITHOUT JAVASCRIPT. The select sits inside a plain GET form whose
 * hidden inputs carry every other current query parameter (p, start, league,
 * roster, and anything else the page is holding). With JavaScript, choosing
 * an option calls router.push directly and the form is never submitted. Its
 * submit button lives inside a <noscript>, so a scripted browser never shows
 * it (a select alone does not reliably submit a form on Enter, and there is
 * nothing else in the form for a mouse to click), while a browser with
 * scripting off renders it and the native GET submission does the rest.
 *
 * Choosing the live week removes ?week entirely rather than writing it
 * explicitly, matching how the rest of the site treats "the default" as the
 * absence of the param rather than a stated value.
 */

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

const SELECT_ID = "start-sit-week-select";

const CONTROL =
  "min-h-11 min-w-[9.5rem] rounded-card border border-line bg-base px-3 py-2 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan";

const SUBMIT =
  "inline-flex min-h-11 min-w-11 items-center justify-center rounded-card border border-line bg-surface px-3 text-sm font-semibold text-ink hover:border-line-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan";

/** "Week 3 (this week)" for the live week, "Week 4" for every other one. */
function weekOptionLabel(week: number, currentWeek: number): string {
  return week === currentWeek ? `Week ${week} (this week)` : `Week ${week}`;
}

export function WeekSelect({
  currentWeek,
  weeks,
}: {
  /** The live regular-season week. Its option carries "(this week)" and
   *  choosing it drops ?week from the URL. */
  currentWeek: number;
  /** The remaining regular-season weeks a reader may pick, ascending, and
   *  including currentWeek. */
  weeks: number[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const weekParam = searchParams.get("week");
  const parsedWeek = weekParam ? Number(weekParam) : NaN;
  const selectedWeek = weeks.includes(parsedWeek) ? parsedWeek : currentWeek;

  const pushWeek = (nextWeek: number) => {
    const params = new URLSearchParams(searchParams.toString());
    if (nextWeek === currentWeek) params.delete("week");
    else params.set("week", String(nextWeek));
    const qs = params.toString();
    startTransition(() => {
      router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
  };

  // Every current query parameter except week, carried as hidden inputs so
  // the no-JS GET submission preserves p, start, league, roster, and
  // anything else the page is holding.
  const hiddenParams = Array.from(searchParams.entries()).filter(
    ([key]) => key !== "week",
  );

  return (
    <form
      method="get"
      action={pathname}
      className="flex flex-wrap items-end gap-2"
    >
      <div className="flex flex-col gap-1">
        <label htmlFor={SELECT_ID} className="text-xs font-semibold text-ink-muted">
          Week
        </label>
        <select
          id={SELECT_ID}
          name="week"
          value={selectedWeek}
          disabled={pending}
          onChange={(event) => pushWeek(Number(event.target.value))}
          className={CONTROL}
        >
          {weeks.map((week) => (
            <option key={week} value={week}>
              {weekOptionLabel(week, currentWeek)}
            </option>
          ))}
        </select>
      </div>
      {hiddenParams.map(([key, value]) => (
        <input key={`${key}:${value}`} type="hidden" name={key} value={value} />
      ))}
      {/* Only rendered by a browser with scripting off. A scripted browser
          handles the change through pushWeek above and never needs a submit
          control. */}
      <noscript>
        <button type="submit" className={SUBMIT}>
          Update week
        </button>
      </noscript>
    </form>
  );
}
