/**
 * Value archetype, roster archetype and the two-year outlook (plan 6.3). Pure.
 *
 * Status comes from Power Pulse (lib/league-team-status.ts); without it the
 * value archetype and the outlook are null and the page says why rather than
 * guessing. Redraft gets its own words: there is no next year to hold for.
 */

import type { TeamStatusKey } from "@/lib/league-team-status";
import type { LeagueBlueprintSettings } from "./default-settings";
import type { BlueprintOutlook } from "./types";

export const NO_PULSE_STANDING =
  "Standing is computed once the league's Power Pulse has run.";
export const REDRAFT_OUTLOOK = "One season at a time: redraft has no next year to hold for.";

type A = LeagueBlueprintSettings["archetype"];

export function valueArchetype(
  status: TeamStatusKey | null,
  isDynasty: boolean,
  ageGap: number | null,
  picksGrade: number | null,
  s: A,
): string | null {
  if (status === null) return null;
  if (!isDynasty) {
    if (status === "competitor" || status === "loaded") return "Contend";
    if (status === "middle") return "In the hunt";
    return "Longshot";
  }
  if (status === "competitor") return "Win now";
  if (status === "loaded") return "Loaded";
  if (status === "rebuilder") return "Rebuild";
  return (ageGap ?? -Infinity) >= s.reloadAgeGap && (picksGrade ?? 0) >= s.reloadPicksGrade
    ? "One year reload"
    : "Retool";
}

export function rosterArchetype(starterValue: number, benchValue: number, s: A): string {
  const total = starterValue + benchValue;
  const share = total > 0 ? starterValue / total : 0;
  if (share >= s.topHeavyShare) return "Top heavy";
  if (share <= s.deepShare) return "Deep";
  return "Well rounded";
}

type Word = BlueprintOutlook["now"];

export function twoYearOutlook(
  status: TeamStatusKey | null,
  isDynasty: boolean,
  ageGap: number | null,
  picksGrade: number | null,
  youngCoreShare: number | null,
  s: A,
): BlueprintOutlook | null {
  if (!isDynasty || status === null) return null;
  const now: Word =
    status === "competitor" || status === "loaded"
      ? "Contend"
      : status === "middle"
        ? "Reload"
        : "Rebuild";
  const gap = ageGap ?? 0;
  const picks = picksGrade ?? 0;
  const young = youngCoreShare ?? 0;
  let next: Word;
  if (now === "Contend") next = gap >= s.contendHoldAgeGap ? "Contend" : "Reload";
  else if (now === "Reload") next = gap >= s.reloadAgeGap && picks >= s.reloadPicksGrade ? "Contend" : "Reload";
  else next = young >= s.rebuildYoungShare && picks >= s.rebuildPicksGrade ? "Reload" : "Rebuild";

  const ageWords =
    ageGap === null
      ? "no priced ages to compare"
      : gap >= 0
        ? `${gap.toFixed(1)} years younger than the league`
        : `${Math.abs(gap).toFixed(1)} years older than the league`;
  const picksWords = picksGrade === null ? "no draft capital grade" : `draft capital graded ${picks} of 10`;
  const youngWords =
    youngCoreShare === null
      ? "no priced players"
      : `${Math.round(young * 100)}% of value aged ${s.youngAge} or under`;
  return {
    now,
    next,
    text: `${now}, then ${next}`,
    reason: `The roster is ${ageWords}, with ${picksWords} and ${youngWords}.`,
  };
}
