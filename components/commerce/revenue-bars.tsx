/**
 * Twelve weeks of revenue. The bars are decoration on a named image; the table in
 * the disclosure under them is the data, because a week label at this size is not
 * readable by anyone. The best week is cyan, and the words name it too.
 */

import { formatEasternDate } from "@/lib/datetime";
import { formatMoney } from "@/lib/commerce/constants";
import type { WeekBucket } from "@/lib/commerce/figures";

const WIDTH = 240;
const HEIGHT = 64;

/** Noon UTC, so the Eastern date prints the calendar day it names. */
function weekLabel(weekStart: string): string {
  return formatEasternDate(`${weekStart}T12:00:00Z`);
}

export function RevenueBars({ weeks }: { weeks: WeekBucket[] }) {
  const total = weeks.reduce((sum, w) => sum + w.revenueCents, 0);
  const best = weeks.reduce((top, w) => (w.revenueCents > top.revenueCents ? w : top), weeks[0]);
  const peak = Math.max(1, best.revenueCents);
  const gap = 4;
  const barWidth = (WIDTH - gap * (weeks.length - 1)) / weeks.length;
  const summary =
    total > 0
      ? `Revenue over twelve weeks: ${formatMoney(total)}. Best week started ${weekLabel(best.weekStart)} at ${formatMoney(best.revenueCents)}.`
      : "No revenue in the last twelve weeks.";

  return (
    <div>
      <svg
        role="img"
        aria-label={summary}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-16 w-full"
        preserveAspectRatio="none"
      >
        <line x1="0" y1={HEIGHT - 0.5} x2={WIDTH} y2={HEIGHT - 0.5} stroke="currentColor" className="text-line" />
        {weeks.map((week, i) => {
          const height = week.revenueCents > 0 ? Math.max(2, (week.revenueCents / peak) * (HEIGHT - 4)) : 0;
          return (
            <rect
              key={week.weekStart}
              x={i * (barWidth + gap)}
              y={HEIGHT - 1 - height}
              width={barWidth}
              height={height}
              rx={1.5}
              className={week === best && total > 0 ? "fill-brand-cyan" : "fill-brand-purple"}
            />
          );
        })}
      </svg>
      <details className="mt-2">
        <summary className="flex min-h-11 cursor-pointer items-center text-xs font-semibold text-ink-muted hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan">
          Revenue by week
        </summary>
        <table className="mt-1 w-full text-left text-xs">
          <caption className="sr-only">Orders, revenue and refunds by week, Monday to Sunday Eastern</caption>
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-ink-subtle">
              <th scope="col" className="py-1 pr-2 font-semibold">
                Week of
              </th>
              <th scope="col" className="py-1 pr-2 text-right font-semibold">
                Orders
              </th>
              <th scope="col" className="py-1 pr-2 text-right font-semibold">
                Revenue
              </th>
              <th scope="col" className="py-1 text-right font-semibold">
                Refunded
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/70">
            {weeks.map((week) => (
              <tr key={week.weekStart}>
                <th scope="row" className="py-1.5 pr-2 font-normal text-ink">
                  {weekLabel(week.weekStart)}
                </th>
                <td className="py-1.5 pr-2 text-right font-mono tabular-nums text-ink">{week.orders}</td>
                <td className="py-1.5 pr-2 text-right font-mono tabular-nums text-ink">
                  {formatMoney(week.revenueCents)}
                </td>
                <td className="py-1.5 text-right font-mono tabular-nums text-ink-muted">
                  {formatMoney(week.refundedCents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
