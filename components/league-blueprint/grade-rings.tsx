/**
 * Grades by position (plan 9.4). Six equal rings, no hero (the overall lives
 * in Standing). Each ring is one SVG with role="img" and a name that states
 * the grade; the numeral inside it is real text, drawn once, inside the same
 * labelled element so a pointer reader lands on a named object. The reasons
 * are a real table under a disclosure.
 *
 * Geometry is lib/league-blueprint/ring-geometry.ts, the same the share
 * images draw from.
 */

import { Panel } from "@/components/dashboard-panel";
import { DataTable, Td, Th } from "@/components/chart-kit";
import { positionNoun } from "@/lib/site";
import { ringGeometry } from "@/lib/league-blueprint/ring-geometry";
import type { BlueprintGrade } from "@/lib/league-blueprint/types";
import { rankOf, SECONDARY_LABEL } from "./bits";

const SIZE = 76;
const STROKE = 7;

function spoken(g: BlueprintGrade): string {
  if (g.key === "bench") return "Bench";
  if (g.key === "picks") return "Draft capital";
  return positionNoun(g.key).replace(/^\w/, (c) => c.toUpperCase());
}

function Ring({ grade }: { grade: BlueprintGrade }) {
  const r = ringGeometry(grade.grade, SIZE, STROKE);
  const name =
    grade.grade === null ? `${spoken(grade)} grade: not scored` : `${spoken(grade)} grade ${grade.grade} of 10`;
  return (
    <li className="flex flex-col items-center gap-1.5">
      <div role="img" aria-label={name} className="relative" style={{ width: SIZE, height: SIZE }}>
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true" className="pointer-events-none">
          <defs>
            <linearGradient id={`bp-ring-${grade.key}`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#A855F7" />
              <stop offset="1" stopColor="#22D3EE" />
            </linearGradient>
          </defs>
          <circle cx={r.cx} cy={r.cy} r={r.r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={STROKE} />
          {r.fraction > 0 && (
            <circle
              cx={r.cx}
              cy={r.cy}
              r={r.r}
              fill="none"
              stroke={`url(#bp-ring-${grade.key})`}
              strokeWidth={STROKE}
              strokeLinecap="round"
              strokeDasharray={r.dashArray}
              transform={r.transform}
            />
          )}
        </svg>
        {/* Inside role="img", whose name states the grade: the children are
            presentational, so the numeral is not read twice and needs no
            aria-hidden. */}
        <span
          className={`pointer-events-none absolute inset-0 flex items-center justify-center font-mono font-black tabular-nums ${
            grade.grade === null ? "text-sm text-ink-subtle" : "text-2xl text-ink"
          }`}
        >
          {grade.grade === null ? "n/a" : grade.grade}
        </span>
      </div>
      <span className={SECONDARY_LABEL}>{grade.label}</span>
    </li>
  );
}

export function GradeRings({ grades, teamCount }: { grades: BlueprintGrade[]; teamCount: number }) {
  return (
    <Panel id="bp-grades" eyebrow="Grades" title="Grades by position" helper={`League relative: 10 is the best of ${teamCount} teams.`}>
      <ul role="list" className="grid grid-cols-3 gap-y-4 sm:grid-cols-6">
        {grades.map((g) => (
          <Ring key={g.key} grade={g} />
        ))}
      </ul>
      <details className="mt-4">
        <summary className="inline-flex min-h-11 cursor-pointer items-center text-xs font-medium text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan">
          Why each grade
        </summary>
        <div className="mt-2 overflow-x-auto" tabIndex={0} role="region" aria-label="Why each grade, the numbers">
          <DataTable
            caption="Why each grade"
            head={
              <>
                <Th>Group</Th>
                <Th numeric>Grade</Th>
                <Th>Value rank</Th>
                <Th>Projected rank</Th>
                <Th>Because</Th>
              </>
            }
          >
            {grades.map((g) => (
              <tr key={g.key}>
                <Td>{spoken(g)}</Td>
                <Td numeric>{g.grade === null ? "Not scored" : `${g.grade} of 10`}</Td>
                <Td>{g.valueRank === null ? "None" : rankOf(g.valueRank, teamCount)}</Td>
                <Td>{g.pointsRank === null ? "None" : rankOf(g.pointsRank, teamCount)}</Td>
                <Td>{g.reason}</Td>
              </tr>
            ))}
          </DataTable>
        </div>
      </details>
    </Panel>
  );
}
