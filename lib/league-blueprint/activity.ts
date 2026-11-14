/**
 * Recommended trade activity (plan 6.8). Pure.
 *
 * activity = 100 * (sellWeight * sellShare + needWeight * needShare
 *                   + divergenceWeight * divergence), rounded.
 * sellShare is Sell plus Cut over the priced players; needShare is positions
 * of need over four; divergence is the gap between value rank and Power Pulse
 * rank over half the league (0 without Power Pulse). The sentence under the
 * gauge names the largest of the three terms with its figure.
 *
 * The split shown beside the gauge counts Sell and Cut apart (a cut is a drop,
 * not a trade), and its four whole percents add to exactly 100.
 */

import { ordinal } from "@/lib/league-team-status";
import { positionNoun } from "@/lib/site";
import type { LeagueBlueprintSettings } from "./default-settings";
import type { ActivityBand, BlueprintActivity, BuyGroup, PlayerCall } from "./types";

export type ActivityInput = {
  calls: Record<string, PlayerCall>;
  needPositions: string[];
  rankDivergence: number | null;
  valueRank: number | null;
  pulseRank: number | null;
  teamCount: number;
  buys: BuyGroup[];
  settings: LeagueBlueprintSettings["activity"];
};

export function activityBand(score: number, s: LeagueBlueprintSettings["activity"]): ActivityBand {
  if (score < s.lowBelow) return "Low";
  if (score > s.highAbove) return "High";
  return "Moderate";
}

function joinWords(words: string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/**
 * Whole percents that add to exactly 100 (largest remainder): floor each
 * share, then hand the points left over to the largest fractions, earlier
 * entries first on a tie. All zeros when there is nothing to share.
 */
export function largestRemainderPercents(counts: readonly number[]): number[] {
  const total = counts.reduce((a, c) => a + c, 0);
  if (total <= 0) return counts.map(() => 0);
  const raw = counts.map((c) => (100 * c) / total);
  const out = raw.map((r) => Math.floor(r));
  let left = 100 - out.reduce((a, v) => a + v, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    out[i] += 1;
    left -= 1;
  }
  return out;
}

export function computeActivity(input: ActivityInput): BlueprintActivity {
  const s = input.settings;
  const calls = Object.values(input.calls);
  const n = calls.length;
  const sellOnly = calls.filter((c) => c.call === "sell").length;
  const cuts = calls.filter((c) => c.call === "cut").length;
  // The score still reads Sell plus Cut: both are players leaving the roster.
  const sells = sellOnly + cuts;
  const builds = calls.filter((c) => c.call === "build").length;
  const holds = calls.filter((c) => c.call === "hold").length;
  const sellShare = n > 0 ? sells / n : 0;
  const needShare = input.needPositions.length / 4;
  const divergence =
    input.rankDivergence === null || input.teamCount <= 0
      ? 0
      : Math.min(1, Math.max(0, Math.abs(input.rankDivergence) / (input.teamCount / 2)));

  const terms = [
    { key: "sell", v: s.sellWeight * sellShare },
    { key: "need", v: s.needWeight * needShare },
    { key: "gap", v: s.divergenceWeight * divergence },
  ];
  const score = Math.round(100 * terms.reduce((a, t) => a + t.v, 0));
  const largest = [...terms].sort((a, b) => b.v - a.v)[0];

  const T = input.teamCount;
  const rankWords = (rank: number | null) => (rank === null ? "unranked" : `${ordinal(rank)} of ${T}`);
  let driver: string;
  if (largest.v === 0) {
    driver = "No sells, no needs and no rank gap push this roster toward a trade.";
  } else if (largest.key === "sell") {
    driver =
      cuts === 0
        ? `Driven by ${sellOnly} ${sellOnly === 1 ? "player" : "players"} to sell.`
        : sellOnly === 0
          ? `Driven by ${cuts} ${cuts === 1 ? "player" : "players"} to cut.`
          : `Driven by ${sellOnly} ${sellOnly === 1 ? "player" : "players"} to sell and ${cuts} to cut.`;
  } else if (largest.key === "need") {
    driver = `Driven by needs at ${joinWords(input.needPositions)}.`;
  } else {
    driver = `Driven by the gap between ${rankWords(input.valueRank)} in value and ${rankWords(input.pulseRank)} in Power Pulse.`;
  }

  const [sellsPct, cutsPct, buildsPct, holdsPct] = largestRemainderPercents([sellOnly, cuts, builds, holds]);
  return {
    score,
    band: activityBand(score, s),
    driver,
    sellsPct,
    cutsPct,
    buildsPct,
    holdsPct,
    sellCount: sellOnly,
    cutCount: cuts,
    pricedCount: n,
    buyTargetCount: input.buys.reduce((a, g) => a + g.targets.length, 0),
    buyPositionCount: input.buys.filter((g) => g.targets.length > 0).length,
  };
}

/** "running back and tight end": spelled out for prose. */
export function needWords(positions: string[]): string {
  return joinWords(positions.map((p) => positionNoun(p)));
}
