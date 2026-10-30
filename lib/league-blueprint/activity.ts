/**
 * Recommended trade activity (plan 6.8). Pure.
 *
 * activity = 100 * (sellWeight * sellShare + needWeight * needShare
 *                   + divergenceWeight * divergence), rounded.
 * sellShare is Sell plus Cut over the priced players; needShare is positions
 * of need over four; divergence is the gap between value rank and Power Pulse
 * rank over half the league (0 without Power Pulse). The sentence under the
 * gauge names the largest of the three terms with its figure.
 */

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

export function computeActivity(input: ActivityInput): BlueprintActivity {
  const s = input.settings;
  const calls = Object.values(input.calls);
  const n = calls.length;
  const sells = calls.filter((c) => c.call === "sell" || c.call === "cut").length;
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

  let driver: string;
  if (largest.v === 0) {
    driver = "Nothing on this roster pushes toward a trade: no sells, no needs, no rank gap.";
  } else if (largest.key === "sell") {
    driver = `Driven mostly by ${sells} ${sells === 1 ? "player" : "players"} worth selling.`;
  } else if (largest.key === "need") {
    driver = `Driven mostly by needs at ${joinWords(input.needPositions)}.`;
  } else {
    driver = `Driven mostly by the gap between value rank ${input.valueRank ?? "unknown"} and Pulse rank ${input.pulseRank ?? "unknown"}.`;
  }

  const pct = (k: number) => (n > 0 ? Math.round((100 * k) / n) : 0);
  return {
    score,
    band: activityBand(score, s),
    driver,
    sellsPct: pct(sells),
    buildsPct: pct(builds),
    holdsPct: pct(holds),
    pricedCount: n,
    buyTargetCount: input.buys.reduce((a, g) => a + g.targets.length, 0),
    buyPositionCount: input.buys.filter((g) => g.targets.length > 0).length,
  };
}

/** "running back and tight end": spelled out for prose. */
export function needWords(positions: string[]): string {
  return joinWords(positions.map((p) => positionNoun(p)));
}
