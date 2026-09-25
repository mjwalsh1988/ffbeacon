/**
 * The IDP guide's figures (plan IDP-218). Server-rendered SVG inside
 * ChartFigure: a title, a one-sentence summary for every reader, and a real
 * <table> of the plotted numbers under a disclosure. The SVG itself is
 * aria-hidden; the summary and the table carry the meaning.
 *
 * Every figure is read from our own tables at request time and names the
 * scoring it uses. ASCII only.
 */

import {
  ChartFigure,
  DataTable,
  PLAYER_SERIES,
  POSITION_SERIES,
  SERIES_A,
  SERIES_B,
  Td,
  Th,
} from "@/components/chart-kit";
import { positionNoun } from "@/lib/site";
import type { IdpLeagueFacts } from "@/lib/guides/idp-leagues";
import { MIN_GAMES, type StabilityFigure } from "@/lib/guides/idp-stability";
import type { EligibilityCounts, RankGroupRow } from "@/lib/guides/idp-scarcity";

/*
 * Colours come from the shared tokens, never typed here (review item 53).
 * Bars take chart-kit's validated series hues, measured against the figure
 * surface there: brand purple and cyan (SERIES_A, SERIES_B), the defensive
 * line lime (POSITION_SERIES.DL, the same hue as tailwind position.dl) and
 * ink.muted (PLAYER_SERIES[6]). Text and bar tracks take the tailwind colour
 * utilities (fill-ink, fill-ink-subtle, fill-line-accent), so they follow
 * tailwind.config.ts if a token moves. The site ships one theme; every pair
 * here clears AA on it, and chart-kit.tsx records the ratios.
 */
const PURPLE = SERIES_A;
const CYAN = SERIES_B;
const LIME = POSITION_SERIES.DL.color;
const GREY = PLAYER_SERIES[6].color;
/** Value labels beside a bar. */
const VALUE_TEXT = "fill-ink";
/** Row labels and quieter annotations. */
const LABEL_TEXT = "fill-ink-subtle";
/** The empty track behind a bar. */
const TRACK = "fill-line-accent";

/** Lesson 1: how many defenders the leagues we hold actually start. */
export function StarterCountFigure({ facts }: { facts: IdpLeagueFacts }) {
  const buckets = new Map<string, number>();
  const order = ["1", "2", "3", "4 to 5", "6 to 8", "9 or more"];
  for (const label of order) buckets.set(label, 0);
  for (const n of facts.starterCounts) {
    const label = n <= 3 ? String(n) : n <= 5 ? "4 to 5" : n <= 8 ? "6 to 8" : "9 or more";
    buckets.set(label, (buckets.get(label) ?? 0) + 1);
  }
  const rows = order.map((label) => ({ label, count: buckets.get(label) ?? 0 }));
  const max = Math.max(1, ...rows.map((r) => r.count));
  const barH = 22;
  const gap = 10;
  const labelW = 88;
  const width = 520;
  const height = rows.length * (barH + gap);

  return (
    <ChartFigure
      titleLevel={3}
      title="How many defenders an IDP league starts"
      summary={
        facts.medianStarters === null
          ? "No league synced on FF Beacon starts a defensive player yet, so there is nothing to count."
          : `Across the ${facts.leagues} IDP leagues synced on FF Beacon, the median starts ${facts.medianStarters} defensive players, and ${facts.flexOnly} of them start defenders only through IDP flex slots.`
      }
      table={
        <DataTable
          caption="IDP leagues on FF Beacon by the number of defensive starters."
          head={
            <>
              <Th>Defensive starters</Th>
              <Th numeric>Leagues</Th>
            </>
          }
        >
          {rows.map((r) => (
            <tr key={r.label}>
              <Td>{r.label}</Td>
              <Td numeric>{r.count}</Td>
            </tr>
          ))}
        </DataTable>
      }
    >
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" aria-hidden="true">
        {rows.map((r, i) => {
          const y = i * (barH + gap);
          const w = ((width - labelW - 40) * r.count) / max;
          return (
            <g key={r.label}>
              <text x={0} y={y + barH * 0.7} fontSize={12} className={LABEL_TEXT}>
                {r.label}
              </text>
              <rect x={labelW} y={y} width={width - labelW - 40} height={barH} rx={4} className={TRACK} />
              <rect x={labelW} y={y} width={Math.max(0, w)} height={barH} rx={4} fill={PURPLE} />
              <text x={labelW + w + 6} y={y + barH * 0.7} fontSize={12} className={VALUE_TEXT}>
                {r.count}
              </text>
            </g>
          );
        })}
      </svg>
    </ChartFigure>
  );
}

function fmt(r: number | null): string {
  return r === null ? "Not enough data" : r.toFixed(2);
}

/** Lesson 5: what repeats from one season to the next, by position. */
export function StabilityFigureView({
  figures,
  span,
}: {
  figures: StabilityFigure[];
  span: [number, number] | null;
}) {
  const metrics = [
    { key: "points" as const, label: "Points per game", color: PURPLE },
    { key: "tackles" as const, label: "Tackles per game", color: CYAN },
    { key: "sacks" as const, label: "Sacks per game", color: LIME },
  ];
  const width = 560;
  const groupH = 3 * 16 + 18;
  const labelW = 150;
  const height = figures.length * groupH;
  const best = [...figures].sort((a, b) => (b.points ?? -1) - (a.points ?? -1))[0];
  const worstSacks = [...figures].sort((a, b) => (a.sacks ?? 2) - (b.sacks ?? 2))[0];
  const spanText = span ? `${span[0]} to ${span[1]}` : "the seasons we hold";

  return (
    <ChartFigure
      titleLevel={3}
      title="What carries over from one season to the next"
      summary={`Year-to-year correlation of per-game figures, ${spanText}, players with ${MIN_GAMES} or more games in both seasons. Closer to 1 repeats; closer to 0 does not. Points per game repeat best for ${
        best ? positionNoun(best.position, "plural") : "no position"
      }${best?.points != null ? ` (${best.points.toFixed(2)})` : ""}, and sacks repeat worst for ${
        worstSacks ? positionNoun(worstSacks.position, "plural") : "no position"
      }${worstSacks?.sacks != null ? ` (${worstSacks.sacks.toFixed(2)})` : ""}.`}
      table={
        <DataTable
          caption={`Year-to-year correlation of per-game figures by position, ${spanText}. Points in Sleeper default IDP scoring.`}
          head={
            <>
              <Th>Position</Th>
              <Th numeric>Pairs</Th>
              <Th numeric>Points</Th>
              <Th numeric>Tackles</Th>
              <Th numeric>Sacks</Th>
            </>
          }
        >
          {figures.map((f) => (
            <tr key={f.position}>
              <Td>{positionNoun(f.position, "plural")}</Td>
              <Td numeric>{f.pairs}</Td>
              <Td numeric>{fmt(f.points)}</Td>
              <Td numeric>{fmt(f.tackles)}</Td>
              <Td numeric>{fmt(f.sacks)}</Td>
            </tr>
          ))}
        </DataTable>
      }
    >
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" aria-hidden="true">
        {figures.map((f, gi) => (
          <g key={f.position} transform={`translate(0, ${gi * groupH})`}>
            <text x={0} y={14} fontSize={12} className={VALUE_TEXT}>
              {positionNoun(f.position, "plural")}
            </text>
            {metrics.map((m, mi) => {
              const v = Math.max(0, f[m.key] ?? 0);
              const w = (width - labelW - 50) * v;
              const y = 20 + mi * 16;
              return (
                <g key={m.key}>
                  <text x={10} y={y + 10} fontSize={10} className={LABEL_TEXT}>
                    {m.label}
                  </text>
                  <rect x={labelW} y={y} width={width - labelW - 50} height={12} rx={3} className={TRACK} />
                  <rect x={labelW} y={y} width={w} height={12} rx={3} fill={m.color} />
                  <text x={labelW + w + 6} y={y + 10} fontSize={10} className={VALUE_TEXT}>
                    {fmt(f[m.key])}
                  </text>
                </g>
              );
            })}
          </g>
        ))}
      </svg>
    </ChartFigure>
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function pg(v: number | null): string {
  return v === null ? "Not enough players" : v.toFixed(1);
}

/**
 * Lesson 4: how fast each position falls off. Average per-game points of the
 * players ranked 1 to 6, 7 to 12, 13 to 24 and 25 to 36 at each position, in
 * Sleeper default IDP scoring. The summary names the steepest fall, computed.
 */
export function RankGroupFigure({ rows, season }: { rows: RankGroupRow[]; season: number }) {
  const falls = rows
    .map((r) => {
      const first = r.groups[0]?.perGame ?? null;
      const lastGroup = [...r.groups].reverse().find((g) => g.perGame !== null) ?? null;
      if (first === null || !lastGroup || lastGroup === r.groups[0]) return null;
      return { position: r.position, first, last: lastGroup.perGame as number, lastLabel: lastGroup.label };
    })
    .filter((f): f is NonNullable<typeof f> => f !== null);
  // Only compare falls over the same span. A position short of thirty-six
  // players ends at an earlier band, and its drop is not the same measurement.
  const sameSpan = falls.length > 1 && falls.every((f) => f.lastLabel === falls[0].lastLabel);
  const steepest = sameSpan
    ? ([...falls].sort((a, b) => b.first - b.last - (a.first - a.last))[0] ?? null)
    : null;
  const summary =
    falls.length === 0
      ? `We do not hold enough ${season} defender seasons to draw this figure.`
      : `Average points a game in Sleeper default IDP scoring, ${season}, by rank at the position. ${falls
          .map(
            (f, i) =>
              `${i === 0 ? capitalize(positionNoun(f.position, "plural")) : positionNoun(f.position, "plural")} fall from ${f.first.toFixed(1)} in ranks 1 to 6 to ${f.last.toFixed(1)} in ranks ${f.lastLabel}`,
          )
          .join("; ")}.${steepest ? ` The steepest fall is at ${positionNoun(steepest.position)}.` : ""}`;

  const colors = [PURPLE, CYAN, LIME, GREY];
  const max = Math.max(1, ...rows.flatMap((r) => r.groups.map((g) => g.perGame ?? 0)));
  const width = 560;
  const labelW = 150;
  const barH = 12;
  const groupH = rows[0] ? rows[0].groups.length * (barH + 4) + 22 : 0;
  const height = rows.length * groupH;

  return (
    <ChartFigure
      titleLevel={3}
      title="How fast each position falls off"
      summary={summary}
      table={
        <DataTable
          caption={`Average points a game by rank at the position, ${season}, Sleeper default IDP scoring. Players with ${MIN_GAMES} or more games, ranked by points a game.`}
          head={
            <>
              <Th>Position</Th>
              {(rows[0]?.groups ?? []).map((g) => (
                <Th key={g.label} numeric>
                  Ranks {g.label}
                </Th>
              ))}
            </>
          }
        >
          {rows.map((r) => (
            <tr key={r.position}>
              <Td>{positionNoun(r.position, "plural")}</Td>
              {r.groups.map((g) => (
                <Td key={g.label} numeric>
                  {pg(g.perGame)}
                </Td>
              ))}
            </tr>
          ))}
        </DataTable>
      }
    >
      <svg viewBox={`0 0 ${width} ${Math.max(1, height)}`} className="h-auto w-full" aria-hidden="true">
        {rows.map((r, gi) => (
          <g key={r.position} transform={`translate(0, ${gi * groupH})`}>
            <text x={0} y={14} fontSize={12} className={VALUE_TEXT}>
              {positionNoun(r.position, "plural")}
            </text>
            {r.groups.map((g, i) => {
              const v = g.perGame ?? 0;
              const w = ((width - labelW - 50) * v) / max;
              const y = 20 + i * (barH + 4);
              return (
                <g key={g.label}>
                  <text x={10} y={y + 10} fontSize={10} className={LABEL_TEXT}>
                    Ranks {g.label}
                  </text>
                  <rect x={labelW} y={y} width={width - labelW - 50} height={barH} rx={3} className={TRACK} />
                  <rect x={labelW} y={y} width={w} height={barH} rx={3} fill={colors[i % colors.length]} />
                  <text x={labelW + w + 6} y={y + 10} fontSize={10} className={VALUE_TEXT}>
                    {g.perGame === null ? "-" : g.perGame.toFixed(1)}
                  </text>
                </g>
              );
            })}
          </g>
        ))}
      </svg>
    </ChartFigure>
  );
}

/** Lesson 6: which positions today's defenders may play, in exclusive groups. */
export function EligibilityFigure({ counts }: { counts: EligibilityCounts }) {
  const rows = [
    { label: "Defensive line only", count: counts.dlOnly },
    { label: "Defensive line and linebacker", count: counts.dlLb },
    { label: "Linebacker only", count: counts.lbOnly },
    { label: "Linebacker and defensive back", count: counts.dbLb },
    { label: "Defensive back only", count: counts.dbOnly },
    ...(counts.other > 0 ? [{ label: "Another combination", count: counts.other }] : []),
  ];
  const max = Math.max(1, ...rows.map((r) => r.count));
  const barH = 22;
  const gap = 10;
  const labelW = 210;
  const width = 560;
  const height = rows.length * (barH + gap);

  return (
    <ChartFigure
      titleLevel={3}
      title="Which positions a defender may play"
      summary={`Of the ${counts.onTeam} defensive players on an NFL roster today, ${counts.dlLb} may play defensive line and linebacker on Sleeper and ${counts.dbLb} linebacker and defensive back${counts.other > 0 ? `; ${counts.other} more are listed at another combination` : ""}. These are today's labels.`}
      table={
        <DataTable
          caption="Defensive players on an NFL roster by the positions Sleeper lists them at today."
          head={
            <>
              <Th>Eligible at</Th>
              <Th numeric>Players</Th>
            </>
          }
        >
          {rows.map((r) => (
            <tr key={r.label}>
              <Td>{r.label}</Td>
              <Td numeric>{r.count}</Td>
            </tr>
          ))}
        </DataTable>
      }
    >
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" aria-hidden="true">
        {rows.map((r, i) => {
          const y = i * (barH + gap);
          const w = ((width - labelW - 50) * r.count) / max;
          const twoWay = r.label.includes(" and ");
          return (
            <g key={r.label}>
              <text x={0} y={y + barH * 0.7} fontSize={12} className={LABEL_TEXT}>
                {r.label}
              </text>
              <rect x={labelW} y={y} width={width - labelW - 50} height={barH} rx={4} className={TRACK} />
              <rect x={labelW} y={y} width={Math.max(0, w)} height={barH} rx={4} fill={twoWay ? CYAN : PURPLE} />
              <text x={labelW + w + 6} y={y + barH * 0.7} fontSize={12} className={VALUE_TEXT}>
                {r.count}
              </text>
            </g>
          );
        })}
      </svg>
    </ChartFigure>
  );
}
