/**
 * Top priorities (plan 6.9). Pure, deterministic templates, never a language
 * model, the same rule lib/trade-impact/reasons.ts states: every sentence
 * cites a figure present in the input, and a null figure disables its
 * candidate. The highest-weight firing candidates are shown, in weight order.
 *
 * P1 to P10 are the plan's. P11 and P12 are always-firing fallbacks below P10
 * so a quiet roster still gets the three priorities the page promises; both
 * cite a figure, so neither is filler.
 */

import { ordinal } from "@/lib/league-team-status";
import { positionNoun } from "@/lib/site";
import type { TeamDirection } from "@/lib/trade-finder/types";
import type { ActivityBand, BlueprintGrade, Priority } from "./types";

export type PriorityInput = {
  teamCount: number;
  direction: TeamDirection | null;
  /** The four positional grades. */
  positional: BlueprintGrade[];
  /** Positions of need, most need first, points a week. */
  needs: Array<{ position: string; need: number }>;
  sellShare: number;
  /** Names of the roster's Sell calls, best value first. */
  sellNames: string[];
  ledger: {
    efficiency: number;
    gradedWeeks: number;
    pointsLeftPerWeek: number;
    efficiencyRank: number | null;
  } | null;
  bench: { grade: number; rank: number | null } | null;
  picks: { grade: number; rank: number | null; seasons: number[] } | null;
  ageGap: number | null;
  mineAge: number | null;
  activityBand: ActivityBand;
  risers: Array<{ name: string; pct: number }>;
  windowLabel: string;
  buildNames: string[];
  totalValue: number | null;
  valueRank: number | null;
};

function list(words: string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

const pct1 = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;

type Candidate = { id: string; weight: number; text: string | null };

export function computePriorities(input: PriorityInput, count: number): Priority[] {
  const T = input.teamCount;
  const winNow = input.direction === "win-now";
  const rebuild = input.direction === "rebuild";
  const graded = input.positional.filter((g) => g.grade !== null);
  const weakest = [...graded].sort((a, b) => a.grade! - b.grade! || a.key.localeCompare(b.key))[0];
  const strongest = [...graded].sort((a, b) => b.grade! - a.grade! || a.key.localeCompare(b.key))[0];

  const candidates: Candidate[] = [
    {
      id: "P1",
      weight: 100,
      text:
        weakest && weakest.grade! <= 4 && weakest.valueRank !== null
          ? `Fix ${positionNoun(weakest.key)}: graded ${weakest.grade} of 10, ${ordinal(weakest.valueRank)} of ${T} in value.`
          : null,
    },
    {
      id: "P2",
      weight: 90,
      text:
        winNow && input.needs.length > 0
          ? `Upgrade ${positionNoun(input.needs[0].position)}: the lineup is ${input.needs[0].need.toFixed(1)} points a week short there.`
          : null,
    },
    {
      id: "P3",
      weight: 85,
      text:
        rebuild && input.sellShare >= 0.25 && input.sellNames.length > 0
          ? `Sell ${input.sellNames.length} ${input.sellNames.length === 1 ? "veteran" : "veterans"} while they still start: ${list(input.sellNames.slice(0, 3))}.`
          : null,
    },
    {
      id: "P4",
      weight: 80,
      text:
        input.ledger && input.ledger.efficiency < 0.9 && input.ledger.gradedWeeks >= 4
          ? `Set better lineups: ${input.ledger.pointsLeftPerWeek.toFixed(1)} points a week left on the bench${
              input.ledger.efficiencyRank !== null ? `, ${ordinal(input.ledger.efficiencyRank)} of ${T}` : ""
            }.`
          : null,
    },
    {
      id: "P5",
      weight: 75,
      text:
        winNow && input.bench && input.bench.grade <= 4 && input.bench.rank !== null
          ? `Add depth: bench value ranks ${ordinal(input.bench.rank)} of ${T}.`
          : null,
    },
    {
      id: "P6",
      weight: 70,
      text:
        winNow && input.picks && input.picks.grade >= 8 && input.picks.rank !== null && input.picks.seasons.length > 0
          ? `Spend draft capital: ${list(input.picks.seasons.map(String))} picks rank ${ordinal(input.picks.rank)} of ${T} and a contender does not need them.`
          : null,
    },
    {
      id: "P7",
      weight: 65,
      text:
        !rebuild && input.ageGap !== null && input.ageGap <= -1.5 && input.mineAge !== null
          ? `Get younger: the roster averages ${input.mineAge.toFixed(1)}, ${Math.abs(input.ageGap).toFixed(1)} years older than the league.`
          : null,
    },
    {
      id: "P8",
      weight: 60,
      text:
        input.activityBand === "Low"
          ? "Hold steady: no move on this roster is worth making for its own sake."
          : null,
    },
    {
      id: "P9",
      weight: 55,
      text:
        rebuild && input.risers.length >= 2
          ? `Ride the risers: ${list(input.risers.slice(0, 3).map((r) => `${r.name} gained ${pct1(r.pct).replace("+", "")}`))} in ${input.windowLabel}.`
          : null,
    },
    {
      id: "P10",
      weight: 50,
      text:
        input.buildNames.length > 0
          ? `Keep the core: ${list(input.buildNames)} ${input.buildNames.length === 1 ? "is the player" : "are the players"} this team is built on.`
          : null,
    },
    {
      id: "P11",
      weight: 45,
      text:
        strongest && strongest.valueRank !== null
          ? `Lean on ${positionNoun(strongest.key)}: graded ${strongest.grade} of 10, ${ordinal(strongest.valueRank)} of ${T} in value.`
          : null,
    },
    {
      id: "P12",
      weight: 40,
      text:
        input.totalValue !== null && input.valueRank !== null
          ? `Track the total: the roster is worth ${Math.round(input.totalValue).toLocaleString("en-US")}, ${ordinal(input.valueRank)} of ${T} in the league.`
          : null,
    },
  ];

  // P8 says a move is not worth making; it never sits beside a priority that
  // names one, because the page would contradict itself.
  const firing = candidates.filter((c) => c.text !== null);
  const action = firing.some((c) => ["P1", "P2", "P3", "P5", "P6", "P7"].includes(c.id));
  return firing
    .filter((c) => !(c.id === "P8" && action))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, count)
    .map((c) => ({ id: c.id, weight: c.weight, text: c.text! }));
}
