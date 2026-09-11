/**
 * The Projections tab: the forward-looking half the Breakdown never had.
 *
 * Everything on this tab comes out of lib/power-pulse/project.ts, the same model
 * that decides a team's Power Pulse and prices a FAAB bid. That matters more
 * than it sounds: a reader who compares players here and then opens their
 * league's Power Pulse page must not find two different opinions about what the
 * same player is projected to do.
 *
 * Three charts, each answering a question the numbers alone do not:
 *   - Weekly projected points, every player on one axis. Shows shape, not just
 *     a total. A steady 14 a week and a 4-then-24 pair average the same.
 *   - Schedule difficulty, week by week. Built from our own defensive splits,
 *     not from Sleeper's weekly projections, which are a season average repeated
 *     and produce an identical schedule for every team.
 *   - Floor, projection, and ceiling, from each player's own measured scoring
 *     spread rather than a flat percentage guess.
 *
 * Generalised from a fixed pair to a group of two to eight players
 * (docs/seo/who-should-i-start-and-site-seo-plan.md section 2.7). Series
 * identity comes from PLAYER_SERIES in components/chart-kit.tsx, indexed by
 * a player's position in `sides`, never by NFL position.
 *
 * Degrades honestly. With no projected weeks on file there is no chart and no
 * hedged number, just a sentence saying we have nothing yet, because a season
 * total of 0.0 reads as a real answer and is not one.
 */

import { Fragment } from "react";
import { CalendarRange } from "lucide-react";
import type { BreakdownExtras, BreakdownPlayer, BreakdownProjection } from "@/lib/beacon-breakdown";
import { matchupPhrase, schedulePhrase } from "@/lib/breakdown/scoring";
import {
  ChartEmpty,
  ChartFigure,
  DataTable,
  PLAYER_SERIES,
  Td,
  Th,
  linePath,
  makeScale,
  markerPath,
  type SeriesStyle,
} from "@/components/chart-kit";

/** One player's projection row, resolved from the group's extras map. */
type Row = { player: BreakdownPlayer; projection: BreakdownProjection | null };

const W = 640;
const H = 200;
const PAD = { t: 14, r: 12, b: 26, l: 34 };
const INNER_W = W - PAD.l - PAD.r;
const INNER_H = H - PAD.t - PAD.b;

function pts(n: number | null | undefined, digits = 1): string {
  return n == null ? "-" : n.toFixed(digits);
}

/** style() is a plain lookup, never a fallback: PLAYER_SERIES always has an
 * entry for every index 0-7, and `sides` is capped at eight by loadBreakdown. */
function style(index: number): SeriesStyle {
  return PLAYER_SERIES[index];
}

export function ProjectionsTab({
  sides,
  extras,
  projectionSourceDisplay,
}: {
  sides: BreakdownPlayer[];
  extras: Map<string, BreakdownExtras>;
  /** projectionSourceDisplay() of the resolved slug, e.g. "Sleeper" or "FF Beacon". */
  projectionSourceDisplay: string;
}) {
  const rows: Row[] = sides.map((player) => ({
    player,
    projection: extras.get(player.id)?.projection ?? null,
  }));

  const hasAny = rows.some((r) => r.projection);

  if (!hasAny) {
    return (
      <div className="space-y-4">
        <SectionHeading />
        <ChartEmpty>
          We hold no weekly projections for any of these players right now.{" "}
          {projectionSourceDisplay} publishes them once the season slate is set, so this tab
          fills in ahead of week 1 and stays current all year.
        </ChartEmpty>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <SectionHeading />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {rows.map((row, i) => (
          <SummaryCard key={row.player.slug} row={row} style={style(i)} />
        ))}
      </div>

      <WeeklyProjectionChart rows={rows} />
      <ScheduleStrip rows={rows} />
      <RangeBars rows={rows} />

      <p className="text-xs leading-relaxed text-ink-subtle">
        Projections start from {projectionSourceDisplay}&apos;s weekly numbers and are then
        adjusted by our own model for how generous each opponent has been to the position, how
        reliably the player has hit the projection, how often the player has been available, and any
        current injury designation. This is the same model behind Power Pulse and the FAAB
        calculator.
      </p>
    </div>
  );
}

function SectionHeading() {
  return (
    <div>
      <h3 className="flex items-center gap-1.5 text-lg font-semibold tracking-tight text-ink sm:text-xl">
        <CalendarRange aria-hidden="true" className="h-4 w-4 text-brand-cyan" />
        What is left to come
      </h3>
      <p className="mt-1 text-sm text-ink-muted">
        Every remaining game, projected and matchup-adjusted.
      </p>
    </div>
  );
}

function SummaryCard({ row, style }: { row: Row; style: SeriesStyle }) {
  const { player, projection } = row;
  const border = { borderColor: `${style.color}66` };
  const text = { color: style.color };

  if (!projection) {
    return (
      <section
        aria-label={`${player.name} projected outlook`}
        className="rounded-card border bg-base/40 p-4"
        style={border}
      >
        <p className="text-sm font-semibold" style={text}>
          {player.name}
        </p>
        <p className="mt-2 text-sm text-ink-muted">
          No weekly projections on file, so we are not going to guess at a number.
        </p>
      </section>
    );
  }

  const nw = projection.nextWeek;

  return (
    <section
      aria-label={`${player.name} projected outlook`}
      className="rounded-card border bg-base/40 p-4"
      style={border}
    >
      <p className="text-sm font-semibold" style={text}>
        {player.name}
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-2">
        <Stat label="Rest of season" value={pts(projection.totalPoints, 0)} suffix="pts" />
        <Stat label="Per game" value={pts(projection.perGame)} suffix="pts" />
        <Stat
          label="Games left"
          value={String(projection.weeks.length)}
          suffix={projection.weeks.length === 1 ? "game" : "games"}
        />
        <Stat
          label="Next game"
          value={nw ? pts(nw.points) : "-"}
          suffix={nw ? (nw.opponent ? `vs ${nw.opponent}` : `wk ${nw.week}`) : ""}
        />
      </dl>
      <p className="mt-3 text-xs text-ink-muted">
        Range {pts(projection.floorPoints, 0)} to {pts(projection.ceilingPoints, 0)} points.
        Schedule: {schedulePhrase(projection.scheduleMultiplier).toLowerCase()}.
      </p>
    </section>
  );
}

function Stat({ label, value, suffix }: { label: string; value: string; suffix?: string }) {
  return (
    <div className="rounded-card border border-line/60 bg-surface/40 px-2.5 py-2">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-subtle">
        {label}
      </dt>
      <dd className="mt-0.5 font-mono text-base font-bold tabular-nums text-ink">
        {value}
        {suffix && <span className="ml-1 font-sans text-[10px] font-medium text-ink-subtle">{suffix}</span>}
      </dd>
    </div>
  );
}

/** Names, swatch, dash and marker for every player in the group. Not a toggle:
 * the plan asks for N series on this tab's chart, not for the ability to hide
 * one, so a plain legend (matching chart-kit's two-player SeriesLegend) is
 * enough and keeps this tab a server component. */
function PlayerLegend({ rows }: { rows: Row[] }) {
  return (
    <ul role="list" className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-medium">
      {rows.map((row, i) => {
        const s = style(i);
        return (
          <li key={row.player.slug} className="flex items-center gap-1.5" style={{ color: s.color }}>
            <svg
              aria-hidden="true"
              width="18"
              height="8"
              viewBox="0 0 18 8"
              className="pointer-events-none shrink-0"
            >
              <line
                x1="0"
                y1="4"
                x2="18"
                y2="4"
                stroke={s.color}
                strokeWidth="2"
                strokeDasharray={s.dash ?? undefined}
              />
              <path d={markerPath(s.marker, 9, 4, 3)} fill={s.color} />
            </svg>
            {row.player.name}
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* Weekly projected points, N series on one axis                       */
/* ------------------------------------------------------------------ */

function WeeklyProjectionChart({ rows }: { rows: Row[] }) {
  const weeksByRow = rows.map((r) => r.projection?.weeks ?? []);
  const allWeeks = [...new Set(weeksByRow.flat().map((w) => w.week))].sort((x, y) => x - y);

  if (allWeeks.length < 2) {
    return (
      <ChartEmpty>
        Fewer than two projected games remain, so there is no week-by-week shape to chart yet.
      </ChartEmpty>
    );
  }

  const maxPoints = Math.max(1, ...weeksByRow.flat().map((w) => w.points));
  const minWeek = allWeeks[0];
  const maxWeek = allWeeks[allWeeks.length - 1];

  const xs = makeScale(minWeek, maxWeek, PAD.l, PAD.l + INNER_W);
  const ys = makeScale(0, maxPoints, PAD.t + INNER_H, PAD.t);

  const seriesPoints = weeksByRow.map((weeks) =>
    weeks.map((w) => ({ x: xs(w.week), y: ys(w.points), week: w.week, points: w.points })),
  );
  const byWeekMaps = weeksByRow.map((weeks) => new Map(weeks.map((w) => [w.week, w])));

  const totals = rows.map((r) => r.projection?.totalPoints ?? null);
  const names = rows.map((r) => r.player.name);
  const summary =
    totals.every((t) => t != null)
      ? `Weekly projected points from week ${minWeek} to week ${maxWeek}. ${rows
          .map((r, i) => `${r.player.name} totals ${totals[i]!.toFixed(0)} points`)
          .join(", ")}.`
      : `Weekly projected points from week ${minWeek} to week ${maxWeek} for ${names.join(", ")}.`;

  // Roughly five gridlines, on round numbers.
  const step = Math.max(1, Math.round(maxPoints / 4));
  const ticks: number[] = [];
  for (let v = 0; v <= maxPoints; v += step) ticks.push(v);

  return (
    <ChartFigure
      title="Projected points, week by week"
      description="Players with the same total can get there very differently. This is the shape."
      summary={summary}
      table={
        <DataTable
          caption={`Weekly projected points for ${names.join(", ")}`}
          head={
            <>
              <Th>Week</Th>
              {rows.map((r) => (
                <Fragment key={r.player.slug}>
                  <Th numeric>{r.player.name}</Th>
                  <Th>Opponent</Th>
                </Fragment>
              ))}
            </>
          }
        >
          {allWeeks.map((week) => (
            <tr key={week}>
              <Td>{week}</Td>
              {rows.map((r, i) => {
                const w = byWeekMaps[i].get(week);
                return (
                  <Fragment key={r.player.slug}>
                    <Td numeric>{w ? w.points.toFixed(1) : "Bye"}</Td>
                    <Td>{w?.opponent ?? "-"}</Td>
                  </Fragment>
                );
              })}
            </tr>
          ))}
        </DataTable>
      }
    >
      <PlayerLegend rows={rows} />
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="mt-2 h-auto w-full"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
      >
        {ticks.map((v) => (
          <g key={v}>
            <line
              x1={PAD.l}
              x2={PAD.l + INNER_W}
              y1={ys(v)}
              y2={ys(v)}
              stroke="#1F1F33"
              strokeWidth="1"
            />
            <text x={PAD.l - 6} y={ys(v) + 3} textAnchor="end" fill="#6B6B7D" fontSize="9">
              {v}
            </text>
          </g>
        ))}
        {allWeeks.map((week) => (
          <text
            key={week}
            x={xs(week)}
            y={H - 8}
            textAnchor="middle"
            fill="#6B6B7D"
            fontSize="9"
          >
            {week}
          </text>
        ))}

        {rows.map((r, i) => {
          const s = style(i);
          const linePts = seriesPoints[i];
          return (
            <g key={r.player.slug}>
              <path
                d={linePath(linePts)}
                fill="none"
                stroke={s.color}
                strokeWidth="2"
                strokeDasharray={s.dash ?? undefined}
              />
              {linePts.map((p) => (
                <path
                  key={`${r.player.slug}-${p.week}`}
                  d={markerPath(s.marker, p.x, p.y, 3)}
                  fill={s.color}
                />
              ))}
            </g>
          );
        })}
      </svg>
    </ChartFigure>
  );
}

/* ------------------------------------------------------------------ */
/* Schedule difficulty strip                                           */
/* ------------------------------------------------------------------ */

/** Matchup multiplier to a swatch. Never color alone: each cell is labeled. */
function matchupTone(m: number): { bg: string; label: string } {
  if (m >= 1.08) return { bg: "rgba(16,185,129,0.55)", label: "Great" };
  if (m >= 1.02) return { bg: "rgba(16,185,129,0.28)", label: "Good" };
  if (m > 0.98) return { bg: "rgba(107,107,125,0.35)", label: "Even" };
  if (m > 0.92) return { bg: "rgba(245,158,11,0.32)", label: "Tough" };
  return { bg: "rgba(239,68,68,0.4)", label: "Hard" };
}

function ScheduleStrip({ rows }: { rows: Row[] }) {
  const withWeeks = rows.filter((r) => r.projection && r.projection.weeks.length > 0);
  if (withWeeks.length === 0) return null;

  const allWeeks = [
    ...new Set(withWeeks.flatMap((r) => r.projection!.weeks.map((w) => w.week))),
  ].sort((x, y) => x - y);

  const summary = withWeeks
    .map(
      (r) =>
        `${r.player.name} has a ${schedulePhrase(r.projection!.scheduleMultiplier).toLowerCase()} at ${(
          r.projection!.scheduleMultiplier ?? 1
        ).toFixed(2)} times average`,
    )
    .join(". ");

  return (
    <ChartFigure
      title="Remaining schedule difficulty"
      description="How generous each upcoming defense has been to this position, from our own splits going back to 2020. Above 1.00 helps the player."
      summary={`${summary}.`}
      table={
        <DataTable
          caption="Weekly matchup difficulty"
          head={
            <>
              <Th>Player</Th>
              <Th>Week</Th>
              <Th>Opponent</Th>
              <Th numeric>Multiplier</Th>
              <Th>Read</Th>
            </>
          }
        >
          {withWeeks.flatMap((r) =>
            r.projection!.weeks.map((w) => (
              <tr key={`${r.player.slug}-${w.week}`}>
                <Td>{r.player.name}</Td>
                <Td>{w.week}</Td>
                <Td>{w.opponent ?? "-"}</Td>
                <Td numeric>{w.opponentMultiplier.toFixed(2)}</Td>
                <Td>{matchupPhrase(w.opponentMultiplier)}</Td>
              </tr>
            )),
          )}
        </DataTable>
      }
    >
      <div className="space-y-3">
        {withWeeks.map((r) => {
          const byWeek = new Map(r.projection!.weeks.map((w) => [w.week, w]));
          return (
            <div key={r.player.slug}>
              <p className="text-[11px] font-semibold text-ink">
                {r.player.name}
                <span className="ml-2 font-normal text-ink-subtle">
                  {schedulePhrase(r.projection!.scheduleMultiplier)}
                </span>
              </p>
              {/* Scrolls rather than shrinking, so an 18-week slate stays
                  legible on a phone instead of collapsing into slivers.
                  tabindex="0" because a scroll container with no focusable
                  children cannot be scrolled from the keyboard in Chrome
                  otherwise, which would strand the later weeks (WCAG 2.1.1). */}
              <div
                className="mt-1 overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                tabIndex={0}
                role="group"
                aria-label={`${r.player.name} weekly matchup difficulty, scrollable`}
              >
                <ul role="list" className="flex min-w-max gap-1">
                  {allWeeks.map((week) => {
                    const w = byWeek.get(week);
                    const tone = w ? matchupTone(w.opponentMultiplier) : null;
                    return (
                      <li
                        key={week}
                        className="flex w-11 shrink-0 flex-col items-center rounded-sm border border-line/60 py-1 text-center"
                        style={tone ? { backgroundColor: tone.bg } : undefined}
                      >
                        <span className="text-[9px] font-semibold text-ink-subtle">W{week}</span>
                        <span className="text-[10px] font-bold text-ink">
                          {w ? (w.opponent ?? "-") : "Bye"}
                        </span>
                        <span className="text-[9px] text-ink-muted">{tone?.label ?? ""}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          );
        })}
      </div>
    </ChartFigure>
  );
}

/* ------------------------------------------------------------------ */
/* Floor, projection, ceiling                                          */
/* ------------------------------------------------------------------ */

function RangeBars({ rows }: { rows: Row[] }) {
  const withProjection = rows
    .map((r, i) => ({ row: r, index: i }))
    .filter((x) => x.row.projection);
  if (withProjection.length === 0) return null;

  const max = Math.max(...withProjection.map((x) => x.row.projection!.ceilingPoints), 1);

  const summary = withProjection
    .map(
      ({ row: r }) =>
        `${r.player.name} projects for ${r.projection!.totalPoints.toFixed(0)} points, in a range from ${r.projection!.floorPoints.toFixed(0)} to ${r.projection!.ceilingPoints.toFixed(0)}`,
    )
    .join(". ");

  return (
    <ChartFigure
      title="Floor, projection, and ceiling"
      description="The band is one standard deviation either side, built from how much this player's own weekly scores actually bounce around, not a flat percentage."
      summary={`${summary}.`}
      table={
        <DataTable
          caption="Projected point ranges"
          head={
            <>
              <Th>Player</Th>
              <Th numeric>Floor</Th>
              <Th numeric>Projection</Th>
              <Th numeric>Ceiling</Th>
            </>
          }
        >
          {withProjection.map(({ row: r }) => (
            <tr key={r.player.slug}>
              <Td>{r.player.name}</Td>
              <Td numeric>{r.projection!.floorPoints.toFixed(0)}</Td>
              <Td numeric>{r.projection!.totalPoints.toFixed(0)}</Td>
              <Td numeric>{r.projection!.ceilingPoints.toFixed(0)}</Td>
            </tr>
          ))}
        </DataTable>
      }
    >
      <ul role="list" className="space-y-3">
        {withProjection.map(({ row: r, index }) => {
          const p = r.projection!;
          const color = style(index).color;
          const left = (p.floorPoints / max) * 100;
          const width = ((p.ceilingPoints - p.floorPoints) / max) * 100;
          const mid = (p.totalPoints / max) * 100;
          return (
            <li key={r.player.slug}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                <p className="text-[11px] font-semibold text-ink">{r.player.name}</p>
                <p className="text-[11px] tabular-nums text-ink-subtle">
                  {p.floorPoints.toFixed(0)} to {p.ceilingPoints.toFixed(0)} pts
                </p>
              </div>
              <div
                aria-hidden="true"
                className="relative mt-1 h-5 w-full rounded-full border border-line bg-base"
              >
                <span
                  className="absolute inset-y-0 rounded-full"
                  style={{
                    left: `${left}%`,
                    width: `${Math.max(width, 1)}%`,
                    backgroundColor: color,
                    opacity: 0.35,
                  }}
                />
                <span
                  className="absolute inset-y-0 w-0.5"
                  style={{ left: `${mid}%`, backgroundColor: color }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </ChartFigure>
  );
}
