/**
 * "Recent form" on a Who Should I Start card: the player's last few graded
 * weeks, what they scored as a column and what they were projected as a
 * tick across it, with the numbers in a small table directly underneath.
 *
 * The data is the per-week actual against projected list the Reliability
 * tab already draws (BreakdownReliability.weeks, from
 * lib/breakdown/load-extras.ts), for the most recent graded season, which
 * the caption names. Nothing here is computed beyond counting the weeks the
 * player met or beat the number, the same test the beat rate uses.
 *
 * THE TABLE IS THE CHART'S AXIS. components/chart-kit.tsx requires every
 * chart's values to exist as real text, and a figure a sighted reader cannot
 * read is no better than one a screen reader cannot. So the week numbers,
 * the scores and the projections sit in a visible <table> whose week columns
 * line up under the columns of the drawing: the table is table-fixed with a
 * 4rem row-header column, and the SVG is inset by the same 4rem and divides
 * its width into the same number of equal slots. The row headers carry the
 * colour keys (a cyan square for scored, a light bar for projected), so there
 * is no separate legend to match by colour, and a week the player did not
 * play says "Out" in its own cell right under its ring. The met-or-beat count
 * is a visible sentence. The SVG itself is aria-hidden: everything it draws
 * is in the table.
 *
 * Marks follow the house chart specs: columns at most 22 units wide with a
 * rounded top and a square baseline, a 2px projection tick carried on a dark
 * halo so it stays visible where it crosses a column, a hairline baseline.
 *
 * Presentational server component.
 */

import type { ReliabilityWeek } from "@/lib/breakdown/types";

export type RecentForm = {
  season: number | null;
  weeks: ReliabilityWeek[];
};

/** How many of the most recent graded weeks the chart draws. */
export const RECENT_FORM_WEEKS = 6;

const WIDTH = 240;
const HEIGHT = 64;
const TOP = 6;
const BASELINE = 62;
const BAR_COLOR = "#22D3EE";
const TICK_COLOR = "#F4F4F8";
const HALO_COLOR = "#07070D";

function fmt(value: number): string {
  return value.toFixed(1);
}

/** Round the top of the axis up to a clean multiple of five, never below five. */
function niceMax(value: number): number {
  return Math.max(5, Math.ceil(value / 5) * 5);
}

/** A column with a rounded top and a square foot on the baseline. */
function columnPath(x: number, width: number, top: number, base: number): string {
  const height = base - top;
  const r = Math.min(4, width / 2, height);
  return [
    `M ${x} ${base}`,
    `V ${top + r}`,
    `Q ${x} ${top} ${x + r} ${top}`,
    `H ${x + width - r}`,
    `Q ${x + width} ${top} ${x + width} ${top + r}`,
    `V ${base}`,
    "Z",
  ].join(" ");
}

/**
 * The weeks the chart draws: the most recent RECENT_FORM_WEEKS, and none
 * after the last week that carries a real score.
 *
 * WHY THE CUTOFF. lib/breakdown/load-extras.ts marks a week `missed: true`
 * whenever a projection exists and no player_stats row says the player
 * played. That is right for a week whose stats have landed, and wrong for a
 * week whose stats have not synced yet (or has not been played): all three
 * look identical. Charting only through the last scored week keeps a genuine
 * absence in the middle of a run, which the loader deliberately preserves,
 * and never prints "did not play" about a player whose numbers simply are
 * not in yet. The cost is that an injury running right up to the present is
 * not drawn until a later week is scored; the Reliability tab still lists it.
 */
export function selectRecentFormWeeks(weeks: ReliabilityWeek[]): ReliabilityWeek[] {
  let lastScored = Number.NEGATIVE_INFINITY;
  for (const w of weeks) {
    if (w.actual != null && w.week > lastScored) lastScored = w.week;
  }
  return weeks
    .filter((w) => w.week <= lastScored)
    .filter((w) => w.actual != null || w.projected != null || w.missed)
    .sort((a, b) => a.week - b.week)
    .slice(-RECENT_FORM_WEEKS);
}

/** The scored cell: the points, "Out" for a week the player did not play, or a dash with its reason. */
function ScoredCell({ week }: { week: ReliabilityWeek }) {
  if (week.missed) {
    return (
      <>
        Out<span className="sr-only">, did not play</span>
      </>
    );
  }
  if (week.actual != null) return <>{fmt(week.actual)}</>;
  return (
    <>
      {"--"}
      <span className="sr-only"> no score on file</span>
    </>
  );
}

export function RecentFormChart({ form }: { form: RecentForm | null | undefined }) {
  const weeks = selectRecentFormWeeks(form?.weeks ?? []);

  if (weeks.length === 0) {
    return (
      <div className="rounded-card border border-line bg-base/30 px-3 py-2.5">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">Recent form</p>
        <p className="mt-0.5 text-sm leading-snug text-ink-muted">Not enough graded weeks to chart yet.</p>
      </div>
    );
  }

  const caption = `Last ${weeks.length} ${weeks.length === 1 ? "week" : "weeks"}${form?.season ? `, ${form.season}` : ""}`;

  const peak = Math.max(...weeks.map((w) => Math.max(w.actual ?? 0, w.projected ?? 0)));
  const yMax = niceMax(peak);
  const y = (v: number) => BASELINE - (Math.max(0, v) / yMax) * (BASELINE - TOP);

  const slot = WIDTH / weeks.length;
  const barWidth = Math.min(22, slot * 0.5);

  const graded = weeks.filter((w) => w.actual != null && w.projected != null);
  const beat = graded.filter((w) => (w.actual as number) >= (w.projected as number)).length;

  return (
    <div className="rounded-card border border-line bg-base/30 px-3 pb-2.5 pt-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">Recent form</p>
        <p className="text-[11px] text-ink-muted">{caption}</p>
      </div>
      {graded.length > 0 && (
        <p className="mt-1 text-xs text-ink-muted">
          Met or beat the projection in {beat} of {graded.length} graded {graded.length === 1 ? "week" : "weeks"}.
        </p>
      )}

      <div className="mt-2 pl-16">
        <svg
          aria-hidden="true"
          focusable="false"
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="pointer-events-none block h-auto w-full"
        >
          <line x1={0} x2={WIDTH} y1={BASELINE} y2={BASELINE} stroke="#2A2A47" strokeWidth={1} />
          {weeks.map((w, i) => {
            const cx = slot * (i + 0.5);
            const x = cx - barWidth / 2;
            const tickY = w.projected != null ? y(w.projected) : null;
            return (
              <g key={w.week}>
                {w.missed || w.actual == null ? (
                  <circle cx={cx} cy={BASELINE - 5} r={4} fill="none" stroke="#8A8A9C" strokeWidth={1.5} />
                ) : w.actual > 0 ? (
                  <path d={columnPath(x, barWidth, y(w.actual), BASELINE)} fill={BAR_COLOR} />
                ) : (
                  // A played week at zero or below (a defense or a kicker can
                  // land there) still gets a mark, flat on the baseline.
                  <rect x={x} y={BASELINE - 2} width={barWidth} height={2} rx={1} fill={BAR_COLOR} />
                )}
                {tickY != null && (
                  <>
                    <line
                      x1={x - 4}
                      x2={x + barWidth + 4}
                      y1={tickY}
                      y2={tickY}
                      stroke={HALO_COLOR}
                      strokeWidth={5}
                      strokeLinecap="round"
                    />
                    <line
                      x1={x - 4}
                      x2={x + barWidth + 4}
                      y1={tickY}
                      y2={tickY}
                      stroke={TICK_COLOR}
                      strokeWidth={2}
                      strokeLinecap="round"
                    />
                  </>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      <table className="mt-1 w-full table-fixed border-collapse text-[11px] leading-tight">
        <caption className="sr-only">Scored and projected points by week</caption>
        <thead>
          <tr>
            <th scope="col" className="w-16 py-0.5 text-left font-semibold text-ink-subtle">
              Week
            </th>
            {weeks.map((w) => (
              <th key={w.week} scope="col" className="py-0.5 text-center font-mono font-semibold text-ink-subtle">
                {w.week}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row" className="py-0.5 text-left font-semibold text-ink-muted">
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-sm" style={{ backgroundColor: BAR_COLOR }} />
                Scored
              </span>
            </th>
            {weeks.map((w) => (
              <td key={w.week} className="py-0.5 text-center font-mono tabular-nums text-ink">
                <ScoredCell week={w} />
              </td>
            ))}
          </tr>
          <tr>
            <th scope="row" className="py-0.5 text-left font-semibold text-ink-muted">
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className="h-0.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: TICK_COLOR }} />
                Projected
              </span>
            </th>
            {weeks.map((w) => (
              <td key={w.week} className="py-0.5 text-center font-mono tabular-nums text-ink-muted">
                {w.projected != null ? (
                  fmt(w.projected)
                ) : (
                  <>
                    {"--"}
                    <span className="sr-only"> no projection</span>
                  </>
                )}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
