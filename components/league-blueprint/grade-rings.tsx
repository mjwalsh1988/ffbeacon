/**
 * Grades by position (plan 9.4): the marks table of the report card. Six
 * rings in a row first (each one SVG with role="img" and a name that states
 * the grade; the numeral inside it is real text, drawn once, inside the same
 * labelled element so a pointer reader lands on a named object), then the
 * marks themselves as a visible table: group, grade, value rank, projected
 * rank and the reason in words. A report card does not hide its marks behind
 * a disclosure.
 *
 * Geometry is lib/league-blueprint/ring-geometry.ts, the same the share
 * images draw from.
 */

import { positionNoun } from "@/lib/site";
import { ringGeometry } from "@/lib/league-blueprint/ring-geometry";
import type { BlueprintGrade } from "@/lib/league-blueprint/types";
import { rankOf, SECONDARY_LABEL } from "./bits";
import { SheetSection } from "./sheet";

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

const TH = "py-2 pr-3 text-left text-[10px] font-semibold uppercase tracking-wide text-ink-subtle";
const TD = "py-2.5 pr-3 align-top text-sm";

export function GradeRings({ grades, teamCount, number }: { grades: BlueprintGrade[]; teamCount: number; number: string }) {
  return (
    <SheetSection
      id="bp-grades"
      number={number}
      title="Grades by position"
      helper={`League relative: 10 is the best of ${teamCount} teams. Each grade blends value rank and projected points rank.`}
    >
      <ul role="list" className="grid grid-cols-3 gap-y-4 sm:grid-cols-6">
        {grades.map((g) => (
          <Ring key={g.key} grade={g} />
        ))}
      </ul>
      <div className="mt-6 overflow-x-auto">
        <table className="w-full border-collapse">
          <caption className="sr-only">The marks: grade, value rank, projected rank and the reason for each group</caption>
          <thead className="border-b border-line">
            <tr>
              <th scope="col" className={TH}>Group</th>
              <th scope="col" className={`${TH} text-right`}>Grade</th>
              <th scope="col" className={`${TH} hidden md:table-cell`}>Value rank</th>
              <th scope="col" className={`${TH} hidden md:table-cell`}>Projected rank</th>
              <th scope="col" className={`${TH} w-full`}>Because</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/70">
            {grades.map((g) => (
              <tr key={g.key}>
                <th scope="row" className={`${TD} whitespace-nowrap text-left font-semibold text-ink`}>
                  {spoken(g)}
                </th>
                <td className={`${TD} whitespace-nowrap text-right font-mono font-black tabular-nums text-ink`}>
                  {g.grade === null ? <span className="text-xs font-medium text-ink-subtle">Not scored</span> : g.grade}
                </td>
                <td className={`${TD} hidden whitespace-nowrap font-mono text-xs tabular-nums text-ink-muted md:table-cell`}>
                  {g.valueRank === null ? "None" : rankOf(g.valueRank, teamCount)}
                </td>
                <td className={`${TD} hidden whitespace-nowrap font-mono text-xs tabular-nums text-ink-muted md:table-cell`}>
                  {g.pointsRank === null ? "None" : rankOf(g.pointsRank, teamCount)}
                </td>
                <td className={`${TD} leading-relaxed text-ink-muted`}>
                  {/* Below md the two rank columns fold into this sentence, so
                      no figure leaves the phone. */}
                  <span className="md:hidden">
                    {g.valueRank === null ? "" : `Value ${rankOf(g.valueRank, teamCount)}. `}
                    {g.pointsRank === null ? "" : `Projected ${rankOf(g.pointsRank, teamCount)}. `}
                  </span>
                  {g.reason}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SheetSection>
  );
}
