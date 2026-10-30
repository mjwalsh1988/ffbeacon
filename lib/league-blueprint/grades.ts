/**
 * Team Blueprint grades (plan section 6.2). Pure.
 *
 * Every grade is LEAGUE RELATIVE: rankScore(rank) = (T - rank + 1) / T, so
 * first of twelve is 10 and twelfth of twelve is 1. A positional grade blends
 * the league rank in value with the league rank in projected points; without
 * a Power Pulse run it is value only. The overall grade is a weighted mean to
 * one decimal; a superflex league weights the quarterback grade up.
 */

import { ordinal } from "@/lib/league-team-status";
import { positionNoun } from "@/lib/site";
import type { LeagueBlueprintSettings } from "./default-settings";
import { BLUEPRINT_POSITIONS, type BlueprintPosition } from "./default-settings";
import type { BlueprintGrade } from "./types";

export function rankScore(rank: number, teamCount: number): number {
  if (teamCount <= 0) return 0;
  const r = Math.min(Math.max(rank, 1), teamCount);
  return (teamCount - r + 1) / teamCount;
}

export function toGrade(score: number): number {
  return Math.min(10, Math.max(1, Math.round(score * 10)));
}

function blend(
  valueRank: number | null,
  pointsRank: number | null,
  teamCount: number,
  w: LeagueBlueprintSettings["grades"],
): number | null {
  if (valueRank === null) return pointsRank === null ? null : toGrade(rankScore(pointsRank, teamCount));
  const valueScore = rankScore(valueRank, teamCount);
  if (pointsRank === null) return toGrade(valueScore);
  const total = w.valueWeight + w.pointsWeight;
  const score =
    total > 0
      ? (w.valueWeight * valueScore + w.pointsWeight * rankScore(pointsRank, teamCount)) / total
      : valueScore;
  return toGrade(score);
}

export type GradeInput = {
  teamCount: number;
  isDynasty: boolean;
  isSuperflex: boolean;
  /** League value rank per position (cards.positionRanks). */
  valueRanks: Record<BlueprintPosition, number | null>;
  /** League projected-points rank per position (Power Pulse); null without one. */
  pointsRanks: Record<BlueprintPosition, number | null> | null;
  benchValueRank: number | null;
  /** Power Pulse depth rank; null without one. */
  depthRank: number | null;
  picksValueRank: number | null;
  settings: LeagueBlueprintSettings["grades"];
};

function reasonFor(
  label: string,
  valueRank: number | null,
  pointsRank: number | null,
  teamCount: number,
  pointsWord: string,
): string {
  const parts: string[] = [];
  if (valueRank !== null) parts.push(`${ordinal(valueRank)} of ${teamCount} in ${label} value`);
  if (pointsRank !== null) parts.push(`${ordinal(pointsRank)} in ${pointsWord}`);
  if (parts.length === 0) return `No ${label} figure to grade yet.`;
  const s = parts.join(", ");
  return `${s.charAt(0).toUpperCase()}${s.slice(1)}.`;
}

export function computeGrades(input: GradeInput): { grades: BlueprintGrade[]; overall: number } {
  const T = input.teamCount;
  const grades: BlueprintGrade[] = [];
  for (const p of BLUEPRINT_POSITIONS) {
    const valueRank = input.valueRanks[p] ?? null;
    const pointsRank = input.pointsRanks?.[p] ?? null;
    const noun = positionNoun(p);
    grades.push({
      key: p,
      label: p,
      grade: blend(valueRank, pointsRank, T, input.settings) ?? 1,
      valueRank,
      pointsRank,
      reason: reasonFor(noun, valueRank, pointsRank, T, `projected ${noun} points`),
    });
  }
  grades.push({
    key: "bench",
    label: "Bench",
    grade: blend(input.benchValueRank, input.depthRank, T, input.settings) ?? 1,
    valueRank: input.benchValueRank,
    pointsRank: input.depthRank,
    reason: reasonFor("bench", input.benchValueRank, input.depthRank, T, "projected depth"),
  });
  grades.push({
    key: "picks",
    label: "Draft capital",
    grade:
      input.isDynasty && input.picksValueRank !== null
        ? toGrade(rankScore(input.picksValueRank, T))
        : input.isDynasty
          ? 1
          : null,
    valueRank: input.isDynasty ? input.picksValueRank : null,
    pointsRank: null,
    reason: input.isDynasty
      ? reasonFor("draft pick", input.picksValueRank, null, T, "")
      : "Not scored in redraft.",
  });

  const w = input.settings.overall;
  const weightOf: Record<string, number> = {
    QB: input.isSuperflex ? w.qbSuperflex : w.qb,
    RB: w.rb,
    WR: w.wr,
    TE: w.te,
    bench: w.bench,
    picks: input.isDynasty ? w.picks : 0,
  };
  let sum = 0;
  let weight = 0;
  for (const g of grades) {
    if (g.grade === null) continue;
    const wt = weightOf[g.key] ?? 0;
    sum += g.grade * wt;
    weight += wt;
  }
  const overall = weight > 0 ? Math.round((sum / weight) * 10) / 10 : 1;
  return { grades, overall };
}
