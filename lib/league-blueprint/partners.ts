/**
 * Ideal trade partners (plan 6.11). Pure.
 *
 *   needFit   = sum over P of min(mine.need[P], surplusPoints(R, P))
 *   giveFit   = sum over P of min(R.need[P], surplusPoints(mine, P))
 *   direction = 1.0 opposite timelines, 0.5 one balanced, 0.25 the same
 *   tendency  = 0.5 (see below)
 *   fit = needWeight * norm(needFit) + giveWeight * norm(giveFit)
 *       + directionWeight * direction + tendencyWeight * tendency
 *
 * surplusPoints(R, P) sums replacementCost over R's surplus players at P, and
 * norm divides by the league maximum of that term (0 when the maximum is 0).
 *
 * The tendency term is fixed at its neutral 0.5. The stored blueprint is
 * shared by every reader, and a manager tendency is a conclusion about a named
 * person that a signed-out reader may not see (see types.ts rule 3).
 */

import { ordinal } from "@/lib/league-team-status";
import type { TeamProfile } from "@/lib/trade-finder/profile";
import type { LeagueBlueprintSettings } from "./default-settings";
import { BLUEPRINT_POSITIONS } from "./default-settings";
import type { TradePartner } from "./types";

export const NO_PARTNERS = "Not enough priced rosters to name a partner.";

export function surplusPoints(profile: TeamProfile, position: string): number {
  let sum = 0;
  for (const p of profile.surplus) {
    if (p.position !== position) continue;
    sum += profile.replacementCost.get(p.playerId) ?? 0;
  }
  return sum;
}

function directionScore(a: TeamProfile["direction"], b: TeamProfile["direction"]): number {
  if ((a === "win-now" && b === "rebuild") || (a === "rebuild" && b === "win-now")) return 1;
  if (a === "balanced" || b === "balanced") return 0.5;
  return 0.25;
}

type Row = {
  profile: TeamProfile;
  needFit: number;
  giveFit: number;
  needBest: { position: string; points: number };
  giveBest: { position: string; points: number };
  direction: number;
};

export function computePartners(
  mine: TeamProfile,
  others: readonly TeamProfile[],
  labels: ReadonlyMap<number, string | null>,
  settings: LeagueBlueprintSettings["partners"],
): TradePartner[] {
  const candidates = others.filter((o) => o.team.rosterId !== mine.team.rosterId);
  if (candidates.length < 2) return [];

  const rows: Row[] = candidates.map((r) => {
    let needFit = 0;
    let giveFit = 0;
    let needBest = { position: "", points: 0 };
    let giveBest = { position: "", points: 0 };
    for (const P of BLUEPRINT_POSITIONS) {
      const n = Math.min(mine.positionNeed[P] ?? 0, surplusPoints(r, P));
      const g = Math.min(r.positionNeed[P] ?? 0, surplusPoints(mine, P));
      needFit += n;
      giveFit += g;
      if (n > needBest.points) needBest = { position: P, points: n };
      if (g > giveBest.points) giveBest = { position: P, points: g };
    }
    return { profile: r, needFit, giveFit, needBest, giveBest, direction: directionScore(mine.direction, r.direction) };
  });

  const maxNeed = Math.max(0, ...rows.map((r) => r.needFit));
  const maxGive = Math.max(0, ...rows.map((r) => r.giveFit));
  const norm = (v: number, max: number) => (max > 0 ? v / max : 0);

  const scored = rows.map((r) => {
    const terms = {
      need: settings.needWeight * norm(r.needFit, maxNeed),
      give: settings.giveWeight * norm(r.giveFit, maxGive),
      direction: settings.directionWeight * r.direction,
      tendency: settings.tendencyWeight * 0.5,
    };
    return { r, terms, fit: terms.need + terms.give + terms.direction + terms.tendency };
  });
  scored.sort((a, b) => b.fit - a.fit || a.r.profile.team.rosterId - b.r.profile.team.rosterId);

  return scored.slice(0, settings.count).map(({ r, terms, fit }) => {
    const t = r.profile.team;
    return {
      rosterId: t.rosterId,
      teamName: t.teamName,
      ownerHandle: t.ownerHandle,
      statusLabel: labels.get(t.rosterId) ?? null,
      reason: partnerReason(r, terms, mine),
      fit: Math.round(fit * 1000) / 1000,
    };
  });
}

function partnerReason(
  r: Row,
  terms: { need: number; give: number; direction: number },
  mine: TeamProfile,
): string {
  const have = r.needBest.points > 0 ? r.needBest : null;
  const want = r.giveBest.points > 0 ? r.giveBest : null;
  if (have && want && terms.need + terms.give >= terms.direction) {
    return `They have ${have.position} depth worth ${have.points.toFixed(1)} points a week to you and need ${want.position}; you have the opposite.`;
  }
  if (have && terms.need >= terms.give && terms.need >= terms.direction) {
    return `They have ${have.position} depth to spare: up to ${have.points.toFixed(1)} points a week where your lineup is short.`;
  }
  if (want && terms.give >= terms.direction) {
    return `They are ${want.points.toFixed(1)} points a week short at ${want.position}, where you have depth to spare.`;
  }
  const word = (d: TeamProfile["direction"]) =>
    d === "win-now" ? "playing for this season" : d === "rebuild" ? "building for later" : "in between";
  const rank = r.profile.team.pulseRank;
  return `You are ${word(mine.direction)} and they are ${word(r.profile.direction)}${
    rank !== null ? ` (${ordinal(rank)} in Power Pulse)` : ""
  }: timelines that trade with each other.`;
}
