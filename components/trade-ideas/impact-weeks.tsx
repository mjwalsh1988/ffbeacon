import type { WeekImpact } from "@/lib/trade-impact/types";

/**
 * What the trade does to each remaining week, before and after.
 *
 * THE CHART HAD TO SAY WHAT IT WAS DRAWING
 *   The first version was a row of bars over a hairline with a week number under
 *   each one, and nothing anywhere on it named the quantity, the direction, or
 *   the scale. A reader could see that week 11 was taller than week 12 and had
 *   no way to learn what "taller" meant. It now carries a title, a one line
 *   explanation, a colour key in words, a labelled zero line with "Better" above
 *   it and "Worse" below, the tallest bar's value called out so the scale is
 *   fixed to something, and the change printed on every bar. Nothing about the
 *   drawing has to be inferred any more.
 *
 * THE TABLE IS STILL THE DATA
 *   The chart is `aria-hidden` and carries no number a reader could act on that
 *   is not also in the table underneath it, at full precision, at every
 *   breakpoint, never behind a disclosure. The table was written first and the
 *   chart was added to it, because a sighted reader can spot the shape of eleven
 *   weeks faster than they can read eleven rows. Removing the table to save
 *   vertical space would delete the feature for the reader this site is built
 *   for.
 *
 * WHY THE CHART SCROLLS INSIDE ITS OWN BOX
 *   A dozen fixed-width columns is wider than a phone. Left to grow, it drags
 *   the whole document sideways and every other surface on the page inherits a
 *   horizontal scrollbar. The bars own an `overflow-x-auto` container so the
 *   overflow stops at its own edge. The axis gutter sits OUTSIDE that container,
 *   so "Better" and "Worse" stay pinned while the weeks scroll past them.
 *
 * MOBILE KEEPS EVERY FIGURE
 *   The two win-probability columns merge into one cell reading "41% to 58%"
 *   below `sm` instead of one of them being dropped. Same numbers, fewer
 *   columns.
 *
 * Server component: no state, no handlers.
 */

/** Bar chart geometry. Half above the zero line, half below. */
const HALF_HEIGHT_PX = 44;

/** Shortest bar we will draw, as a share of the half height. Keeps a tiny change visible. */
const MIN_BAR_PCT = 6;

function fmtPoints(value: number): string {
  return value.toFixed(1);
}

function fmtSigned(value: number, digits = 1): string {
  const rounded = Number(value.toFixed(digits));
  const sign = rounded > 0 ? "+" : rounded < 0 ? "-" : "";
  return `${sign}${Math.abs(rounded).toFixed(digits)}`;
}

function fmtProb(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "Not available";
  return `${Math.round(value * 100)}%`;
}

/** "41% to 58%", or a stated absence when either half is missing. */
function fmtProbPair(before: number | null, after: number | null): string {
  if (before === null || after === null) return "Not available";
  return `${Math.round(before * 100)}% to ${Math.round(after * 100)}%`;
}

/** Which side of even money the week lands on after the trade, if it moved. */
function flipLabel(week: WeekImpact): string | null {
  const { winProbBefore: before, winProbAfter: after } = week;
  if (before === null || after === null) return null;
  if (before < 0.5 && after >= 0.5) return "Now favoured";
  if (before >= 0.5 && after < 0.5) return "Now underdog";
  return null;
}

export function ImpactWeeks({
  weeks,
  teamName,
}: {
  weeks: WeekImpact[];
  teamName: string;
}) {
  if (weeks.length === 0) {
    return (
      <p className="text-sm leading-relaxed text-ink-muted">
        There are no regular season games left for {teamName}, so there is no
        week-by-week impact to show.
      </p>
    );
  }

  const peak = weeks.reduce((max, w) => Math.max(max, Math.abs(w.delta)), 0);
  const better = weeks.filter((w) => w.delta > 0).length;
  const worse = weeks.filter((w) => w.delta < 0).length;

  return (
    <div>
      <section
        aria-hidden="true"
        className="rounded-card border border-line bg-base/40 p-3"
      >
        <p className="text-sm font-semibold text-ink">
          Points gained or lost, week by week
        </p>
        <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">
          One bar per week left. Up is more points than you would have scored
          without the trade, down is fewer. The same numbers are in the table
          below.
        </p>

        {/* The key, in words as well as colour. */}
        <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink-muted">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-brand-cyan" />
            Better ({better} {better === 1 ? "week" : "weeks"})
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-brand-purple" />
            Worse ({worse} {worse === 1 ? "week" : "weeks"})
          </span>
          {peak > 0 && (
            <span>Tallest bar = {fmtPoints(peak)} points</span>
          )}
        </p>

        <div className="mt-3 flex gap-2">
          {/* The axis gutter. Fixed, outside the scroller, so the three labels
              stay put while the weeks move past them. Heights match the bar
              geometry exactly so "0 pts" lands on the zero line. */}
          <div className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
            <div
              className="flex items-start justify-end pr-1"
              style={{ height: `${HALF_HEIGHT_PX}px` }}
            >
              Better
            </div>
            <div className="flex h-px items-center justify-end pr-1 text-ink-muted">
              <span className="-translate-y-1/2">0 pts</span>
            </div>
            <div
              className="flex items-end justify-end pr-1"
              style={{ height: `${HALF_HEIGHT_PX}px` }}
            >
              Worse
            </div>
            {/* Spacer matching the week-number row under the bars. */}
            <div className="mt-1 h-4" />
          </div>

          <div className="min-w-0 flex-1 overflow-x-auto">
            <div className="flex min-w-max gap-1.5 pb-1">
              {weeks.map((week) => {
                const gain = week.delta >= 0;
                const pct =
                  peak > 0
                    ? Math.max(MIN_BAR_PCT, Math.round((Math.abs(week.delta) / peak) * 100))
                    : MIN_BAR_PCT;
                return (
                  <div key={week.week} className="flex w-11 shrink-0 flex-col">
                    <div
                      className="flex flex-col justify-end"
                      style={{ height: `${HALF_HEIGHT_PX}px` }}
                    >
                      {gain && (
                        <>
                          {/* The value on the bar. Without it the chart says
                              "bigger than that one" and nothing else. */}
                          <span className="mb-0.5 text-center font-mono text-[9px] leading-none tabular-nums text-brand-cyan">
                            {fmtSigned(week.delta)}
                          </span>
                          <span
                            className="w-full rounded-t-sm bg-brand-cyan/70"
                            style={{ height: `${pct}%` }}
                          />
                        </>
                      )}
                    </div>
                    <span className="block h-px w-full bg-line-accent" />
                    <div
                      className="flex flex-col justify-start"
                      style={{ height: `${HALF_HEIGHT_PX}px` }}
                    >
                      {!gain && (
                        <>
                          <span
                            className="w-full rounded-b-sm bg-brand-purple/70"
                            style={{ height: `${pct}%` }}
                          />
                          <span className="mt-0.5 text-center font-mono text-[9px] leading-none tabular-nums text-brand-purple">
                            {fmtSigned(week.delta)}
                          </span>
                        </>
                      )}
                    </div>
                    <span className="mt-1 block h-4 text-center font-mono text-[10px] leading-4 tabular-nums text-ink-subtle">
                      W{week.week}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-full border-collapse text-left">
          <caption className="sr-only">
            {teamName}: projected points and win chance for each remaining week,
            before and after this trade.
          </caption>
          <thead>
            <tr className="border-b border-line text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">
              <th scope="col" className="py-2 pr-2">
                Week
              </th>
              <th scope="col" className="py-2 pr-2">
                Opponent
              </th>
              <th scope="col" className="py-2 pr-2 text-right">
                Before
              </th>
              <th scope="col" className="py-2 pr-2 text-right">
                After
              </th>
              <th scope="col" className="py-2 pr-2 text-right">
                Change
              </th>
              {/* One merged column on a phone, two from sm up. Same numbers. */}
              <th scope="col" className="py-2 text-right sm:hidden">
                Win %
              </th>
              <th
                scope="col"
                className="hidden py-2 pr-2 text-right sm:table-cell"
              >
                Win % before
              </th>
              <th scope="col" className="hidden py-2 text-right sm:table-cell">
                Win % after
              </th>
            </tr>
          </thead>
          <tbody>
            {weeks.map((week) => {
              const flip = flipLabel(week);
              return (
                <tr key={week.week} className="border-b border-line/60 align-top">
                  <th
                    scope="row"
                    className="py-2 pr-2 font-mono text-xs font-semibold tabular-nums text-ink"
                  >
                    {week.week}
                  </th>
                  <td className="py-2 pr-2 text-xs text-ink-muted">
                    {week.opponentName ?? "No opponent"}
                    {/* The flip sits with the matchup because that is what
                        changed hands. It is a word, not a colour. */}
                    {flip && (
                      <span className="mt-1 inline-block rounded-full border border-line px-2 py-0.5 text-[10px] font-medium text-ink-muted">
                        {flip}
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-2 text-right font-mono text-xs tabular-nums text-ink-muted">
                    {fmtPoints(week.beforeMean)}
                  </td>
                  <td className="py-2 pr-2 text-right font-mono text-xs tabular-nums text-ink">
                    {fmtPoints(week.afterMean)}
                  </td>
                  <td className="py-2 pr-2 text-right font-mono text-xs font-semibold tabular-nums text-ink">
                    {fmtSigned(week.delta)}
                  </td>
                  <td className="py-2 text-right font-mono text-xs tabular-nums text-ink-muted sm:hidden">
                    {fmtProbPair(week.winProbBefore, week.winProbAfter)}
                  </td>
                  <td className="hidden py-2 pr-2 text-right font-mono text-xs tabular-nums text-ink-muted sm:table-cell">
                    {fmtProb(week.winProbBefore)}
                  </td>
                  <td className="hidden py-2 text-right font-mono text-xs tabular-nums text-ink sm:table-cell">
                    {fmtProb(week.winProbAfter)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-ink-subtle">
        Points are your best possible lineup that week. Change is after minus
        before.
      </p>
    </div>
  );
}
