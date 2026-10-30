/**
 * The Spotlight (plan 6.13), in place of the reference sheet's college prospect
 * card (decision 3.4: we hold no prospect data). Pure.
 *
 * In season with a settled week: this roster's top scorer of the latest
 * settled week, against his own season per-game average in this league (both
 * read from the Leaderboards view, scored under the league's settings). Else
 * the roster's top riser; else its most valuable player. The label always
 * says which of the three it is.
 *
 * The plan named league_power_pulse_cache.weekly for a projection to compare
 * with; that column holds one TEAM distribution per week, not a player's
 * projection, so the season average is the honest comparison available.
 */

import type { BlueprintSpotlight } from "./types";

export type SpotlightInput = {
  week: { playerId: string; week: number; points: number; average: number | null } | null;
  riser: { playerId: string; pct: number; delta: number | null; windowLabel: string } | null;
  valuable: { playerId: string; value: number; position: string; positionRank: number | null } | null;
};

export function computeSpotlight(input: SpotlightInput): BlueprintSpotlight | null {
  if (input.week) {
    const w = input.week;
    const diff = w.average === null ? null : w.points - w.average;
    return {
      kind: "week",
      playerId: w.playerId,
      label: `Top scorer, week ${w.week}`,
      figure: w.points.toFixed(1),
      figureUnit: "points",
      comparison:
        diff === null
          ? "No season average to compare with yet."
          : `Season average ${w.average!.toFixed(1)} a game, ${diff >= 0 ? "plus" : "minus"} ${Math.abs(diff).toFixed(1)}.`,
    };
  }
  if (input.riser) {
    const r = input.riser;
    return {
      kind: "riser",
      playerId: r.playerId,
      label: `Top riser, ${r.windowLabel}`,
      figure: `${r.pct > 0 ? "+" : ""}${r.pct.toFixed(1)}%`,
      figureUnit: `in ${r.windowLabel}`,
      comparison:
        r.delta === null
          ? `Value up ${r.pct.toFixed(1)}% in ${r.windowLabel}.`
          : `Up ${Math.round(r.delta).toLocaleString("en-US")} in value over ${r.windowLabel}.`,
    };
  }
  if (input.valuable) {
    const v = input.valuable;
    return {
      kind: "value",
      playerId: v.playerId,
      label: "Most valuable player",
      figure: Math.round(v.value).toLocaleString("en-US"),
      figureUnit: "value",
      comparison:
        v.positionRank === null
          ? "Unranked at his position in this format."
          : `${v.position}${v.positionRank} in this format.`,
    };
  }
  return null;
}
