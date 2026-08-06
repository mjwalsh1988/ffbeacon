/**
 * The Reliability tab: how often each player actually does what he is supposed
 * to do.
 *
 * This is the part of the comparison nobody else publishes well, and we already
 * compute it nightly in player_projection_accuracy. Three numbers carry it:
 *
 *   Beat rate      Share of projected weeks he met or beat the number. A week he
 *                  was projected for and did not play counts as a MISS, so an
 *                  injured stretch drags the number down instead of vanishing
 *                  from the denominator. That is a deliberate choice in the
 *                  nightly calculation and the reason this beat rate is lower,
 *                  and more useful, than the ones you see elsewhere.
 *   Availability   Share of projected weeks he was on the field at all.
 *   Consistency    Standard deviation of actual over projected. The difference
 *                  between a metronome and a lottery ticket.
 *
 * Everything is gated on sample size. Four weeks produces a beat rate that looks
 * authoritative and is noise, so below the threshold the tile says how many
 * games we have rather than printing a percentage.
 */

import { Activity } from "lucide-react";
import type {
  BreakdownPlayer,
  BreakdownReliability,
  ReliabilityWeek,
} from "@/lib/beacon-breakdown";
import { riskPhrase } from "@/lib/breakdown/scoring";
import {
  ChartEmpty,
  ChartFigure,
  DataTable,
  SERIES_A,
  SERIES_B,
  Td,
  Th,
} from "./chart-kit";

type Side = { player: BreakdownPlayer; reliability: BreakdownReliability | null };

/** Below this, we report the sample instead of a rate built from it. */
const MIN_GRADED_WEEKS = 4;

/** A week at or above this multiple of projection is a boom, at or below is a bust. */
const BOOM = 1.25;
const BUST = 0.75;

function graded(side: Side): BreakdownReliability | null {
  const r = side.reliability;
  if (!r || r.weeksPlayed < MIN_GRADED_WEEKS) return null;
  return r;
}

function pct(v: number | null | undefined, digits = 0): string {
  return v == null ? "-" : `${(v * 100).toFixed(digits)}%`;
}

/**
 * The season the week-by-week charts cover.
 *
 * The summary tiles are recency-weighted across every season we have graded,
 * which is why a tile can say "35 graded games" while the chart below shows
 * seventeen marks. The charts name their season so those two numbers never read
 * as a contradiction.
 */
function chartSeason(a: Side, b: Side): number | null {
  return a.reliability?.season ?? b.reliability?.season ?? null;
}

export function ReliabilityTab({ a, b }: { a: Side; b: Side }) {
  const anyWeeks = (a.reliability?.weeks.length ?? 0) + (b.reliability?.weeks.length ?? 0) > 0;
  const anyGraded = Boolean(graded(a) || graded(b));

  if (!anyWeeks && !anyGraded) {
    return (
      <div className="space-y-4">
        <SectionHeading />
        <ChartEmpty>
          Neither player has enough graded games yet. Reliability needs projections and real
          results for the same weeks, so it fills in as the season is played.
        </ChartEmpty>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <SectionHeading />

      <div className="grid gap-3 sm:grid-cols-2">
        <ReliabilityCard side={a} accent="purple" />
        <ReliabilityCard side={b} accent="cyan" />
      </div>

      <DifferentialStrip a={a} b={b} />
      <BoomBustBars a={a} b={b} />

      <p className="text-xs leading-relaxed text-ink-subtle">
        A week a player was projected for but did not play counts as a miss, not as a week that
        never happened. Recent seasons count for far more than old ones, because roles and
        offenses change year to year. Both are deliberate: they make the number lower and more
        honest than a raw hit rate.
      </p>
    </div>
  );
}

function SectionHeading() {
  return (
    <div>
      <h3 className="flex items-center gap-1.5 text-lg font-semibold tracking-tight text-ink sm:text-xl">
        <Activity aria-hidden="true" className="h-4 w-4 text-brand-cyan" />
        Can you count on him?
      </h3>
      <p className="mt-1 text-sm text-ink-muted">
        Measured against each player&apos;s own weekly projections, not against each other.
      </p>
    </div>
  );
}

function ReliabilityCard({ side, accent }: { side: Side; accent: "purple" | "cyan" }) {
  const { player } = side;
  const r = graded(side);
  const raw = side.reliability;
  const border = accent === "purple" ? "border-brand-purple/40" : "border-brand-cyan/40";
  const text = accent === "purple" ? "text-brand-purple" : "text-brand-cyan";

  return (
    <section
      aria-label={`${player.name} reliability`}
      className={`rounded-card border ${border} bg-base/40 p-4`}
    >
      <p className={`text-sm font-semibold ${text}`}>{player.name}</p>

      {!r ? (
        <p className="mt-2 text-sm text-ink-muted">
          {raw && raw.weeksPlayed > 0
            ? `Only ${raw.weeksPlayed} graded game${raw.weeksPlayed === 1 ? "" : "s"} on file, which is too few to publish a rate from.`
            : "No graded games on file yet."}
        </p>
      ) : (
        <>
          <dl className="mt-3 grid grid-cols-2 gap-2">
            <Stat label="Beats projection" value={pct(r.beatRate)} />
            <Stat label="Availability" value={pct(r.availabilityRate)} />
            <Stat
              label="Avg vs projection"
              value={
                r.meanDiff != null
                  ? `${r.meanDiff >= 0 ? "+" : ""}${r.meanDiff.toFixed(1)}`
                  : "-"
              }
              tone={r.meanDiff == null ? undefined : r.meanDiff >= 0 ? "good" : "bad"}
            />
            <Stat label="Consistency" value={riskPhrase(player, r.ratioStdev)} small />
          </dl>
          <p className="mt-3 text-xs text-ink-muted">
            From {r.weeksPlayed} graded game{r.weeksPlayed === 1 ? "" : "s"} across{" "}
            {r.weeksProjected} projected week{r.weeksProjected === 1 ? "" : "s"}.
          </p>
        </>
      )}
    </section>
  );
}

function Stat({
  label,
  value,
  tone,
  small,
}: {
  label: string;
  value: string;
  tone?: "good" | "bad";
  small?: boolean;
}) {
  const toneClass =
    tone === "good" ? "text-signal-success" : tone === "bad" ? "text-signal-danger" : "text-ink";
  return (
    <div className="rounded-card border border-line/60 bg-surface/40 px-2.5 py-2">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-subtle">
        {label}
      </dt>
      <dd
        className={`mt-0.5 font-mono font-bold tabular-nums ${small ? "text-sm" : "text-base"} ${toneClass}`}
      >
        {value}
      </dd>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Actual minus projected, week by week                                */
/* ------------------------------------------------------------------ */

const W = 640;
const ROW_H = 54;
const PAD_X = 24;

function comparable(weeks: ReliabilityWeek[]) {
  return weeks.filter((w) => w.projected != null && w.actual != null);
}

function DifferentialStrip({ a, b }: { a: Side; b: Side }) {
  const rows = [a, b].filter((s) => comparable(s.reliability?.weeks ?? []).length > 0);
  if (rows.length === 0) return null;
  const season = chartSeason(a, b);

  const allDiffs = rows.flatMap((s) =>
    comparable(s.reliability!.weeks).map((w) => (w.actual as number) - (w.projected as number)),
  );
  const bound = Math.max(5, ...allDiffs.map((d) => Math.abs(d)));
  const H = rows.length * ROW_H + 18;

  const summary = rows
    .map((s) => {
      const diffs = comparable(s.reliability!.weeks).map(
        (w) => (w.actual as number) - (w.projected as number),
      );
      const avg = diffs.reduce((x, y) => x + y, 0) / diffs.length;
      const over = diffs.filter((d) => d >= 0).length;
      return `${s.player.name} finished above projection in ${over} of ${diffs.length} graded games, averaging ${avg >= 0 ? "plus" : "minus"} ${Math.abs(avg).toFixed(1)} points`;
    })
    .join(". ");

  return (
    <ChartFigure
      title={`Every ${season ?? ""} week against its projection`.replace("  ", " ")}
      description={`One mark per graded game${season ? ` in the ${season} season` : ""}, placed by how far above or below projection he finished. A tight cluster near the middle line is a player you can set and forget. The tiles above cover every season we have graded, so their game counts are higher.`}
      summary={`${summary}.`}
      table={
        <DataTable
          caption="Weekly projected against actual points"
          head={
            <>
              <Th>Player</Th>
              <Th>Week</Th>
              <Th numeric>Projected</Th>
              <Th numeric>Actual</Th>
              <Th numeric>Difference</Th>
            </>
          }
        >
          {[a, b].flatMap((s) =>
            (s.reliability?.weeks ?? []).map((w) => (
              <tr key={`${s.player.slug}-${w.week}`}>
                <Td>{s.player.name}</Td>
                <Td>{w.week}</Td>
                <Td numeric>{w.projected != null ? w.projected.toFixed(1) : "-"}</Td>
                <Td numeric>{w.missed ? "Did not play" : (w.actual?.toFixed(1) ?? "-")}</Td>
                <Td numeric>
                  {w.projected != null && w.actual != null
                    ? `${w.actual - w.projected >= 0 ? "+" : ""}${(w.actual - w.projected).toFixed(1)}`
                    : "-"}
                </Td>
              </tr>
            )),
          )}
        </DataTable>
      }
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
      >
        {rows.map((s, idx) => {
          const y = idx * ROW_H + 30;
          const color = s === a ? SERIES_A : SERIES_B;
          const weeks = comparable(s.reliability!.weeks);
          const scaleX = (d: number) =>
            W / 2 + (d / bound) * (W / 2 - PAD_X);
          return (
            <g key={s.player.slug}>
              <text x={PAD_X} y={y - 14} fill="#A8A8B8" fontSize="10" fontWeight="600">
                {s.player.name}
              </text>
              <line
                x1={PAD_X}
                x2={W - PAD_X}
                y1={y}
                y2={y}
                stroke="#1F1F33"
                strokeWidth="1"
              />
              <line x1={W / 2} x2={W / 2} y1={y - 10} y2={y + 10} stroke="#6B6B7D" strokeWidth="1" />
              {weeks.map((w) => {
                const d = (w.actual as number) - (w.projected as number);
                return s === a ? (
                  <circle
                    key={w.week}
                    cx={scaleX(d)}
                    cy={y}
                    r="4"
                    fill={color}
                    fillOpacity="0.75"
                  />
                ) : (
                  <rect
                    key={w.week}
                    x={scaleX(d) - 3.5}
                    y={y - 3.5}
                    width="7"
                    height="7"
                    fill={color}
                    fillOpacity="0.75"
                  />
                );
              })}
            </g>
          );
        })}
        <text x={PAD_X} y={H - 4} fill="#6B6B7D" fontSize="9">
          {`-${bound.toFixed(0)} pts`}
        </text>
        <text x={W / 2} y={H - 4} textAnchor="middle" fill="#6B6B7D" fontSize="9">
          met projection
        </text>
        <text x={W - PAD_X} y={H - 4} textAnchor="end" fill="#6B6B7D" fontSize="9">
          {`+${bound.toFixed(0)} pts`}
        </text>
      </svg>
    </ChartFigure>
  );
}

/* ------------------------------------------------------------------ */
/* Boom, met, bust                                                     */
/* ------------------------------------------------------------------ */

type Split = { boom: number; met: number; bust: number; missed: number; total: number };

function splitOf(weeks: ReliabilityWeek[]): Split {
  let boom = 0;
  let met = 0;
  let bust = 0;
  let missed = 0;
  for (const w of weeks) {
    if (w.projected == null || w.projected <= 0) continue;
    if (w.missed) {
      missed += 1;
      continue;
    }
    if (w.actual == null) continue;
    const ratio = w.actual / w.projected;
    if (ratio >= BOOM) boom += 1;
    else if (ratio <= BUST) bust += 1;
    else met += 1;
  }
  return { boom, met, bust, missed, total: boom + met + bust + missed };
}

const BANDS = [
  { key: "boom", label: "Boom", color: "#10B981", hint: "25% or more above projection" },
  { key: "met", label: "About right", color: "#6B6B7D", hint: "within 25% of projection" },
  { key: "bust", label: "Bust", color: "#F59E0B", hint: "25% or more below projection" },
  { key: "missed", label: "Did not play", color: "#EF4444", hint: "projected but missed" },
] as const;

function BoomBustBars({ a, b }: { a: Side; b: Side }) {
  const rows = [a, b]
    .map((s) => ({ side: s, split: splitOf(s.reliability?.weeks ?? []) }))
    .filter((r) => r.split.total > 0);
  if (rows.length === 0) return null;
  const season = chartSeason(a, b);

  const summary = rows
    .map(
      (r) =>
        `${r.side.player.name}: ${r.split.boom} boom, ${r.split.met} about right, ${r.split.bust} bust, ${r.split.missed} missed, out of ${r.split.total} projected weeks`,
    )
    .join(". ");

  return (
    <ChartFigure
      title="Boom, bust, or about right"
      description={`Every projected week${season ? ` of the ${season} season` : ""} sorted by how the real game compared. Two players with the same average can live in completely different bars.`}
      summary={`${summary}.`}
      table={
        <DataTable
          caption="Weekly outcome distribution"
          head={
            <>
              <Th>Player</Th>
              {BANDS.map((band) => (
                <Th key={band.key} numeric>
                  {band.label}
                </Th>
              ))}
              <Th numeric>Weeks</Th>
            </>
          }
        >
          {rows.map((r) => (
            <tr key={r.side.player.slug}>
              <Td>{r.side.player.name}</Td>
              {BANDS.map((band) => (
                <Td key={band.key} numeric>
                  {r.split[band.key]}
                </Td>
              ))}
              <Td numeric>{r.split.total}</Td>
            </tr>
          ))}
        </DataTable>
      }
    >
      <ul role="list" className="space-y-3">
        {rows.map((r) => (
          <li key={r.side.player.slug}>
            <p className="text-[11px] font-semibold text-ink">{r.side.player.name}</p>
            <div
              aria-hidden="true"
              className="mt-1 flex h-6 w-full overflow-hidden rounded-card border border-line"
            >
              {BANDS.map((band) => {
                const count = r.split[band.key];
                if (count === 0) return null;
                return (
                  <span
                    key={band.key}
                    // Explicit near-black on the solid fill. `text-base` would
                    // have been a font size, not a color, leaving light ink on a
                    // bright bar; every band color clears 4.5:1 against black.
                    className="flex items-center justify-center text-[10px] font-bold text-black"
                    style={{
                      width: `${(count / r.split.total) * 100}%`,
                      backgroundColor: band.color,
                    }}
                  >
                    {count}
                  </span>
                );
              })}
            </div>
            <p className="mt-1 text-[11px] text-ink-subtle">
              {BANDS.filter((band) => r.split[band.key] > 0)
                .map((band) => `${band.label} ${r.split[band.key]}`)
                .join(", ")}
            </p>
          </li>
        ))}
      </ul>

      <ul role="list" className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-ink-subtle">
        {BANDS.map((band) => (
          <li key={band.key} className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: band.color }}
            />
            {band.label}: {band.hint}
          </li>
        ))}
      </ul>
    </ChartFigure>
  );
}
