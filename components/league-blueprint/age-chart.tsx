/**
 * Age by position (plan 9.8): a bar pair per position, this roster against
 * the league, value weighted. ChartFigure gives it a summary sentence read
 * before the graphic and a real table under a disclosure. The bars only draw
 * what the table says; geometry is lib/league-blueprint/age-geometry.ts.
 */

import { ChartFigure, DataTable, SERIES_A, SERIES_B, SeriesLegend, Td, Th } from "@/components/chart-kit";
import { positionHeading } from "@/lib/site";
import { ageChart } from "@/lib/league-blueprint/age-geometry";
import type { BlueprintAge } from "@/lib/league-blueprint/types";
import { SheetSection } from "./sheet";

const WIDTH = 480;
/**
 * Below sm the body is about 260px wide, so a 480 viewBox would shrink the
 * axis labels to under five pixels. The phone copy is drawn at its own width.
 */
const PHONE_WIDTH = 280;

function AgeBars({ rows, width, className }: { rows: BlueprintAge["rows"]; width: number; className: string }) {
  const chart = ageChart(rows, { width, labelWidth: 44, barHeight: 12, pairGap: 3, rowGap: 14 });
  return (
    <svg
      viewBox={`0 0 ${width} ${chart.height + 18}`}
      className={`pointer-events-none mt-2 h-auto w-full ${className}`}
      aria-hidden="true"
    >
      {chart.ticks.map((t) => (
        <g key={t.value}>
          <line x1={t.x} x2={t.x} y1={0} y2={chart.height} stroke="rgba(255,255,255,0.06)" />
          <text x={t.x} y={chart.height + 14} fontSize="10" textAnchor="middle" fill="#8B8BA3">
            {t.value}
          </text>
        </g>
      ))}
      {chart.rows.map((r) => (
        <g key={r.position}>
          <text x={0} y={r.labelY + 4} fontSize="11" fontWeight="700" fill="#B4B4C8">
            {r.position}
          </text>
          {r.mine && <rect x={r.mine.x} y={r.mine.y} width={r.mine.width} height={r.mine.height} rx={3} fill={SERIES_A} />}
          {r.league && (
            <rect
              x={r.league.x}
              y={r.league.y}
              width={r.league.width}
              height={r.league.height}
              rx={3}
              fill={SERIES_B}
              fillOpacity={0.55}
            />
          )}
        </g>
      ))}
    </svg>
  );
}

function summary(age: BlueprintAge): string {
  const parts = age.rows
    .filter((r) => r.mine !== null && r.gap !== null)
    .map(
      (r) =>
        `${positionHeading(r.position, "plural")} average ${r.mine!.toFixed(1)}, ${Math.abs(r.gap!).toFixed(1)} years ${
          r.gap! >= 0 ? "younger" : "older"
        } than the league.`,
    );
  return parts.length > 0 ? parts.join(" ") : "No priced players to measure.";
}

export function AgeChart({ age, number }: { age: BlueprintAge; number: string }) {
  const overall =
    age.rosterMean !== null && age.gap !== null
      ? `Value weighted. The roster averages ${age.rosterMean.toFixed(1)}, ${Math.abs(age.gap).toFixed(1)} years ${age.gap >= 0 ? "younger" : "older"} than the league's ${age.leagueMean!.toFixed(1)}.`
      : "No priced players to measure an age against.";
  return (
    <SheetSection id="bp-age" number={number} title="Age by position" helper={overall}>
      {/* The body column can run past 1000px, which would scale a 480-wide
          viewBox into bars taller than the text; the figure stops at 2xl. */}
      <div className="max-w-2xl">
      <ChartFigure
        titleLevel={3}
        title="This roster against the league"
        summary={summary(age)}
        table={
          <DataTable
            caption="Value-weighted age by position"
            head={
              <>
                <Th>Position</Th>
                <Th numeric>Team age</Th>
                <Th numeric>League age</Th>
                <Th numeric>Gap</Th>
                <Th numeric>Players counted</Th>
              </>
            }
          >
            {age.rows.map((r) => (
              <tr key={r.position}>
                <Td>{positionHeading(r.position, "plural")}</Td>
                <Td numeric>{r.mine === null ? "No priced players" : r.mine.toFixed(1)}</Td>
                <Td numeric>{r.league === null ? "None" : r.league.toFixed(1)}</Td>
                <Td numeric>
                  {r.gap === null ? "None" : `${Math.abs(r.gap).toFixed(1)} ${r.gap >= 0 ? "younger" : "older"}`}
                </Td>
                <Td numeric>{r.count}</Td>
              </tr>
            ))}
          </DataTable>
        }
      >
        <SeriesLegend aName="This team" bName="League" />
        <AgeBars rows={age.rows} width={PHONE_WIDTH} className="sm:hidden" />
        <AgeBars rows={age.rows} width={WIDTH} className="hidden sm:block" />
      </ChartFigure>
      </div>
    </SheetSection>
  );
}
