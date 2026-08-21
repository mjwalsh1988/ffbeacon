import type { WeekImpact } from "@/lib/trade-impact/types";

/**
 * What the trade does to each remaining week, before and after.
 *
 * THE TABLE IS THE DATA. THE STRIP IS DECORATION.
 *   The bar strip above the table is `aria-hidden` and carries no number a
 *   reader could act on. Everything it draws is in the table underneath it, at
 *   full precision, at every breakpoint, never behind a disclosure. The table was
 *   written first and the strip was added to it, because a sighted reader can
 *   spot the shape of eleven weeks faster than they can read eleven rows.
 *   Removing the table to save vertical space would delete the feature for the
 *   reader this site is built for.
 *
 * WHY THE STRIP SCROLLS INSIDE ITS OWN BOX
 *   A dozen fixed-width columns is wider than a phone. Left to grow, it drags
 *   the whole document sideways and every other surface on the page inherits a
 *   horizontal scrollbar. The strip owns an `overflow-x-auto` container so the
 *   overflow stops at its own edge.
 *
 * MOBILE KEEPS EVERY FIGURE
 *   The two win-probability columns merge into one cell reading "41 to 58
 *   percent" below `sm` instead of one of them being dropped. Same numbers,
 *   fewer columns.
 *
 * Server component: no state, no handlers.
 */

/** Bar strip geometry. Half above the baseline, half below. */
const HALF_HEIGHT_PX = 40;

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

/** "41 to 58 percent", or a stated absence when either half is missing. */
function fmtProbPair(before: number | null, after: number | null): string {
  if (before === null || after === null) return "Not available";
  return `${Math.round(before * 100)} to ${Math.round(after * 100)} percent`;
}

/** Which side of even money the week lands on after the trade, if it moved. */
function flipLabel(week: WeekImpact): string | null {
  const { winProbBefore: before, winProbAfter: after } = week;
  if (before === null || after === null) return null;
  if (before < 0.5 && after >= 0.5) return "Flips to favoured";
  if (before >= 0.5 && after < 0.5) return "Flips to underdog";
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

  return (
    <div>
      {/* Decorative. Every value drawn here is spelled out in the table below. */}
      <div aria-hidden="true" className="overflow-x-auto">
        <div className="flex min-w-max gap-1.5 pb-1">
          {weeks.map((week) => {
            const gain = week.delta >= 0;
            const pct =
              peak > 0 ? Math.max(4, Math.round((Math.abs(week.delta) / peak) * 100)) : 4;
            return (
              <div key={week.week} className="flex w-9 shrink-0 flex-col">
                <div
                  className="flex items-end"
                  style={{ height: `${HALF_HEIGHT_PX}px` }}
                >
                  {gain && (
                    <span
                      className="w-full rounded-t-sm bg-brand-cyan/70"
                      style={{ height: `${pct}%` }}
                    />
                  )}
                </div>
                <span className="block h-px w-full bg-line-accent" />
                <div
                  className="flex items-start"
                  style={{ height: `${HALF_HEIGHT_PX}px` }}
                >
                  {!gain && (
                    <span
                      className="w-full rounded-b-sm bg-brand-purple/70"
                      style={{ height: `${pct}%` }}
                    />
                  )}
                </div>
                <span className="mt-1 text-center font-mono text-[10px] tabular-nums text-ink-subtle">
                  {week.week}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-full border-collapse text-left">
          <caption className="sr-only">
            {teamName}: projected points and win probability for each remaining
            week, before and after this trade.
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
                Win chance
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
        Points are the optimal starting lineup for that week. Change is after
        minus before.
      </p>
    </div>
  );
}
