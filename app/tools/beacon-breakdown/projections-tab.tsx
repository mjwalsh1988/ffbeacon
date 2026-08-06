/**
 * The Projections tab: the forward-looking half the Breakdown never had.
 *
 * Everything on this tab comes out of lib/power-pulse/project.ts, the same model
 * that decides a team's Power Pulse and prices a FAAB bid. That matters more
 * than it sounds: a reader who compares two players here and then opens their
 * league's Power Pulse page must not find two different opinions about what the
 * same player is projected to do.
 *
 * Three charts, each answering a question the numbers alone do not:
 *   - Weekly projected points, both players on one axis. Shows shape, not just
 *     a total. A steady 14 a week and a 4-then-24 pair average the same.
 *   - Schedule difficulty, week by week. Built from our own defensive splits,
 *     not from Sleeper's weekly projections, which are a season average repeated
 *     and produce an identical schedule for every team.
 *   - Floor, projection, and ceiling, from each player's own measured scoring
 *     spread rather than a flat percentage guess.
 *
 * Degrades honestly. With no projected weeks on file there is no chart and no
 * hedged number, just a sentence saying we have nothing yet, because a season
 * total of 0.0 reads as a real answer and is not one.
 */

import { CalendarRange } from "lucide-react";
import type { BreakdownPlayer, BreakdownProjection } from "@/lib/beacon-breakdown";
import { matchupPhrase, schedulePhrase } from "@/lib/breakdown/scoring";
import {
  ChartEmpty,
  ChartFigure,
  DataTable,
  SERIES_A,
  SERIES_B,
  SeriesLegend,
  Td,
  Th,
  linePath,
  makeScale,
} from "./chart-kit";

type Side = { player: BreakdownPlayer; projection: BreakdownProjection | null };

const W = 640;
const H = 200;
const PAD = { t: 14, r: 12, b: 26, l: 34 };
const INNER_W = W - PAD.l - PAD.r;
const INNER_H = H - PAD.t - PAD.b;

function pts(n: number | null | undefined, digits = 1): string {
  return n == null ? "-" : n.toFixed(digits);
}

export function ProjectionsTab({ a, b }: { a: Side; b: Side }) {
  const hasAny = Boolean(a.projection || b.projection);

  if (!hasAny) {
    return (
      <div className="space-y-4">
        <SectionHeading />
        <ChartEmpty>
          We hold no weekly projections for either player right now. Sleeper publishes them once
          the season slate is set, so this tab fills in ahead of week 1 and stays current all
          year.
        </ChartEmpty>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <SectionHeading />

      <div className="grid gap-3 sm:grid-cols-2">
        <SummaryCard side={a} accent="purple" />
        <SummaryCard side={b} accent="cyan" />
      </div>

      <WeeklyProjectionChart a={a} b={b} />
      <ScheduleStrip a={a} b={b} />
      <RangeBars a={a} b={b} />

      <p className="text-xs leading-relaxed text-ink-subtle">
        Projections start from Sleeper&apos;s weekly numbers and are then adjusted by our own
        model for how generous each opponent has been to the position, how reliably the player
        has hit his own projection, how often he has been available, and any current injury
        designation. This is the same model behind Power Pulse and the FAAB calculator.
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

function SummaryCard({ side, accent }: { side: Side; accent: "purple" | "cyan" }) {
  const { player, projection } = side;
  const border = accent === "purple" ? "border-brand-purple/40" : "border-brand-cyan/40";
  const text = accent === "purple" ? "text-brand-purple" : "text-brand-cyan";

  if (!projection) {
    return (
      <section
        aria-label={`${player.name} projected outlook`}
        className={`rounded-card border ${border} bg-base/40 p-4`}
      >
        <p className={`text-sm font-semibold ${text}`}>{player.name}</p>
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
      className={`rounded-card border ${border} bg-base/40 p-4`}
    >
      <p className={`text-sm font-semibold ${text}`}>{player.name}</p>
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

/* ------------------------------------------------------------------ */
/* Weekly projected points, two series on one axis                     */
/* ------------------------------------------------------------------ */

function WeeklyProjectionChart({ a, b }: { a: Side; b: Side }) {
  const weeksA = a.projection?.weeks ?? [];
  const weeksB = b.projection?.weeks ?? [];
  const allWeeks = [...new Set([...weeksA, ...weeksB].map((w) => w.week))].sort((x, y) => x - y);

  if (allWeeks.length < 2) {
    return (
      <ChartEmpty>
        Fewer than two projected games remain, so there is no week-by-week shape to chart yet.
      </ChartEmpty>
    );
  }

  const maxPoints = Math.max(
    1,
    ...weeksA.map((w) => w.points),
    ...weeksB.map((w) => w.points),
  );
  const minWeek = allWeeks[0];
  const maxWeek = allWeeks[allWeeks.length - 1];

  const xs = makeScale(minWeek, maxWeek, PAD.l, PAD.l + INNER_W);
  const ys = makeScale(0, maxPoints, PAD.t + INNER_H, PAD.t);

  const project = (weeks: typeof weeksA) =>
    weeks.map((w) => ({ x: xs(w.week), y: ys(w.points), week: w.week, points: w.points }));

  const ptsA = project(weeksA);
  const ptsB = project(weeksB);

  const byWeekA = new Map(weeksA.map((w) => [w.week, w]));
  const byWeekB = new Map(weeksB.map((w) => [w.week, w]));

  const totalA = a.projection?.totalPoints ?? null;
  const totalB = b.projection?.totalPoints ?? null;
  const summary =
    totalA != null && totalB != null
      ? `Weekly projected points from week ${minWeek} to week ${maxWeek}. ${a.player.name} totals ${totalA.toFixed(0)} points, ${b.player.name} totals ${totalB.toFixed(0)}.`
      : `Weekly projected points from week ${minWeek} to week ${maxWeek} for ${a.player.name} and ${b.player.name}.`;

  // Roughly five gridlines, on round numbers.
  const step = Math.max(1, Math.round(maxPoints / 4));
  const ticks: number[] = [];
  for (let v = 0; v <= maxPoints; v += step) ticks.push(v);

  return (
    <ChartFigure
      title="Projected points, week by week"
      description="Two players with the same total can get there very differently. This is the shape."
      summary={summary}
      table={
        <DataTable
          caption={`Weekly projected points for ${a.player.name} and ${b.player.name}`}
          head={
            <>
              <Th>Week</Th>
              <Th numeric>{a.player.name}</Th>
              <Th>Opponent</Th>
              <Th numeric>{b.player.name}</Th>
              <Th>Opponent</Th>
            </>
          }
        >
          {allWeeks.map((week) => {
            const wa = byWeekA.get(week);
            const wb = byWeekB.get(week);
            return (
              <tr key={week}>
                <Td>{week}</Td>
                <Td numeric>{wa ? wa.points.toFixed(1) : "Bye"}</Td>
                <Td>{wa?.opponent ?? "-"}</Td>
                <Td numeric>{wb ? wb.points.toFixed(1) : "Bye"}</Td>
                <Td>{wb?.opponent ?? "-"}</Td>
              </tr>
            );
          })}
        </DataTable>
      }
    >
      <SeriesLegend aName={a.player.name} bName={b.player.name} />
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

        <path d={linePath(ptsA)} fill="none" stroke={SERIES_A} strokeWidth="2" />
        <path
          d={linePath(ptsB)}
          fill="none"
          stroke={SERIES_B}
          strokeWidth="2"
          strokeDasharray="5 4"
        />
        {ptsA.map((p) => (
          <circle key={`a-${p.week}`} cx={p.x} cy={p.y} r="3" fill={SERIES_A} />
        ))}
        {ptsB.map((p) => (
          <rect key={`b-${p.week}`} x={p.x - 2.5} y={p.y - 2.5} width="5" height="5" fill={SERIES_B} />
        ))}
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

function ScheduleStrip({ a, b }: { a: Side; b: Side }) {
  const rows = [a, b].filter((s) => s.projection && s.projection.weeks.length > 0);
  if (rows.length === 0) return null;

  const allWeeks = [
    ...new Set(rows.flatMap((s) => s.projection!.weeks.map((w) => w.week))),
  ].sort((x, y) => x - y);

  const summary = rows
    .map(
      (s) =>
        `${s.player.name} has a ${schedulePhrase(s.projection!.scheduleMultiplier).toLowerCase()} at ${(
          s.projection!.scheduleMultiplier ?? 1
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
          {rows.flatMap((s) =>
            s.projection!.weeks.map((w) => (
              <tr key={`${s.player.slug}-${w.week}`}>
                <Td>{s.player.name}</Td>
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
        {rows.map((s) => {
          const byWeek = new Map(s.projection!.weeks.map((w) => [w.week, w]));
          return (
            <div key={s.player.slug}>
              <p className="text-[11px] font-semibold text-ink">
                {s.player.name}
                <span className="ml-2 font-normal text-ink-subtle">
                  {schedulePhrase(s.projection!.scheduleMultiplier)}
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
                aria-label={`${s.player.name} weekly matchup difficulty, scrollable`}
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

function RangeBars({ a, b }: { a: Side; b: Side }) {
  const rows = [a, b].filter((s) => s.projection);
  if (rows.length === 0) return null;

  const max = Math.max(...rows.map((s) => s.projection!.ceilingPoints), 1);

  const summary = rows
    .map(
      (s) =>
        `${s.player.name} projects for ${s.projection!.totalPoints.toFixed(0)} points, in a range from ${s.projection!.floorPoints.toFixed(0)} to ${s.projection!.ceilingPoints.toFixed(0)}`,
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
          {rows.map((s) => (
            <tr key={s.player.slug}>
              <Td>{s.player.name}</Td>
              <Td numeric>{s.projection!.floorPoints.toFixed(0)}</Td>
              <Td numeric>{s.projection!.totalPoints.toFixed(0)}</Td>
              <Td numeric>{s.projection!.ceilingPoints.toFixed(0)}</Td>
            </tr>
          ))}
        </DataTable>
      }
    >
      <ul role="list" className="space-y-3">
        {rows.map((s) => {
          const p = s.projection!;
          const color = s === a ? SERIES_A : SERIES_B;
          const left = (p.floorPoints / max) * 100;
          const width = ((p.ceilingPoints - p.floorPoints) / max) * 100;
          const mid = (p.totalPoints / max) * 100;
          return (
            <li key={s.player.slug}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                <p className="text-[11px] font-semibold text-ink">{s.player.name}</p>
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
