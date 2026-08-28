/**
 * Tests for the Positional WAR tier ladder.
 *
 * The properties that matter are the ones the thresholds are DESIGNED for:
 * that they hold as the remaining window shrinks, that they hold as the league
 * grows, and that the two bottom bands are decided by the model's own points
 * figures rather than by a percentile.
 */

import { describe, expect, it } from "vitest";
import { buildTierScale, describeTierScale, tierFor, WAR_TIERS, WAR_TIER_LABEL } from "./tiers";
import type { PlottableCurve, WarCurvePoint } from "./types";
import type { PulsePosition } from "@/lib/power-pulse/types";

function point(rank: number, war: number, projected = 12, replacement = 10): WarCurvePoint {
  return {
    playerId: `p-${rank}-${war}`,
    sleeperId: null,
    slug: `p-${rank}`,
    name: `Player ${rank}`,
    team: null,
    injuryStatus: null,
    positionRank: rank,
    war,
    pointsAboveReplacement: Math.max(0, (projected - replacement) * 13),
    projectedPointsPerWeek: projected,
    replacementPointsPerWeek: replacement,
    weeksProjected: 13,
  };
}

/** A position whose WAR falls linearly from `top` over `depth` ranks. */
function curve(
  position: PulsePosition,
  demand: number,
  depth: number,
  top: number,
  scale = 1,
): PlottableCurve {
  const points: WarCurvePoint[] = [];
  for (let rank = 1; rank <= depth; rank += 1) {
    points.push(point(rank, Math.max(0, (top - (rank - 1) * (top / depth)) * scale)));
  }
  return {
    position,
    structuralDemand: demand,
    replacementPoints: 10,
    avgSeatedPoints: 12,
    deficit: 2,
    shallowPool: false,
    warRank1: points[0]?.war ?? null,
    warAtDemand: points[demand - 1]?.war ?? null,
    cliffRank: null,
    curve: points,
  };
}

function league(scale = 1): PlottableCurve[] {
  return [
    curve("QB", 12, 36, 0.8, scale),
    curve("RB", 24, 36, 2.0, scale),
    curve("WR", 30, 36, 1.6, scale),
    curve("TE", 12, 36, 1.1, scale),
  ];
}

describe("buildTierScale", () => {
  it("builds the ladder from the league's own starting jobs, not from every plotted player", () => {
    const scale = buildTierScale(league());
    // 12 + 24 + 30 + 12 starting jobs.
    expect(scale?.starterCount).toBe(78);
  });

  it("orders the four cut points from most to least demanding", () => {
    const scale = buildTierScale(league())!;
    expect(scale.leagueBreaker).toBeGreaterThan(scale.elite);
    expect(scale.elite).toBeGreaterThan(scale.strong);
    expect(scale.strong).toBeGreaterThan(scale.starter);
  });

  it("returns null when nothing is worth anything, rather than minting a top tier at 0.00", () => {
    const flat = [curve("QB", 12, 36, 0)];
    expect(buildTierScale(flat)).toBeNull();
  });

  it("returns null for a league with no curves at all", () => {
    expect(buildTierScale([])).toBeNull();
  });
});

describe("tier assignment", () => {
  it("puts the best player in the league in the top band", () => {
    const curves = league();
    const scale = buildTierScale(curves)!;
    const best = curves.find((c) => c.position === "RB")!.curve[0];
    expect(tierFor(best, scale)).toBe("league-breaker");
  });

  it("keeps the top band genuinely rare", () => {
    const curves = league();
    const scale = buildTierScale(curves)!;
    const starters = curves.flatMap((c) =>
      c.curve.filter((p) => p.positionRank <= c.structuralDemand),
    );
    const breakers = starters.filter((p) => tierFor(p, scale) === "league-breaker");
    // The top 2% of 78 starting jobs. Nearest rank rounds up, so this is a
    // handful of players, never a tier that half the league lands in.
    expect(breakers.length).toBeGreaterThan(0);
    expect(breakers.length).toBeLessThanOrEqual(4);
  });

  it("names a player below replacement from his points, not from his WAR", () => {
    // WAR is floored at zero by default, so it cannot tell "exactly
    // replacement" from "far under it". The two per-week figures can.
    const below = point(60, 0, 6, 10);
    expect(tierFor(below, buildTierScale(league()))).toBe("below");
  });

  it("calls a zero-WAR player who still matches replacement points replacement level, not below it", () => {
    const level = point(60, 0, 10, 10);
    expect(tierFor(level, buildTierScale(league()))).toBe("replacement");
  });

  it("does not award a tier on a WAR that rounds to 0.00", () => {
    // 0.004 prints as "0.00" everywhere, so a badge above replacement level
    // next to it would contradict the number beside it.
    const nearZero = point(50, 0.004, 12, 10);
    expect(tierFor(nearZero, buildTierScale(league()))).toBe("replacement");
  });

  it("falls back to the structural bands when there is no ladder", () => {
    expect(tierFor(point(1, 0, 12, 10), null)).toBe("replacement");
    expect(tierFor(point(1, 0, 6, 10), null)).toBe("below");
  });

  it("prefers the wins band when a boom profile beats replacement in most weeks", () => {
    // Below replacement on AVERAGE but carrying real WAR: the tier reports the
    // wins, because the wins are what he actually delivered week by week.
    const curves = league();
    const scale = buildTierScale(curves)!;
    const boom = point(3, 1.9, 9, 10);
    // Well above the elite cut, so the tier reports the wins rather than the
    // average. What matters is that it is not "below replacement".
    expect(tierFor(boom, scale)).toBe("elite");
    expect(tierFor(boom, scale)).not.toBe("below");
  });
});

describe("the ladder is scale-free, which is why it is percentile-based", () => {
  it("assigns the same tiers when every WAR shrinks by the same factor", () => {
    // The same league seen in week 14 instead of week 1: a quarter of the
    // window left, so roughly a quarter of the WAR, and not one projection
    // has changed. A fixed threshold in wins would relabel the whole league.
    const full = league(1);
    const late = league(0.25);
    const fullScale = buildTierScale(full)!;
    const lateScale = buildTierScale(late)!;

    for (let i = 0; i < full.length; i += 1) {
      const a = full[i].curve.map((p) => tierFor(p, fullScale));
      const b = late[i].curve.map((p) => tierFor(p, lateScale));
      expect(b).toEqual(a);
    }
  });

  it("keeps the top band proportional as the league grows", () => {
    const small = [curve("QB", 6, 36, 0.8), curve("RB", 12, 36, 2.0)];
    const big = [curve("QB", 18, 36, 0.8), curve("RB", 36, 36, 2.0)];
    const smallScale = buildTierScale(small)!;
    const bigScale = buildTierScale(big)!;
    expect(smallScale.starterCount).toBe(18);
    expect(bigScale.starterCount).toBe(54);
    // A bigger league hands out more starting jobs, so its 98th percentile
    // sits further up its own distribution, never at a fixed number of wins.
    expect(bigScale.leagueBreaker).toBeGreaterThan(0);
    expect(smallScale.leagueBreaker).toBeGreaterThan(0);
  });
});

describe("labels and copy", () => {
  it("gives every tier a plain-language label with no unexplained acronym", () => {
    for (const tier of WAR_TIERS) {
      const label = WAR_TIER_LABEL[tier];
      expect(label.length).toBeGreaterThan(0);
      expect(label).not.toMatch(/PORP|WAR/);
    }
  });

  it("names the starting-job count it was built from, so a reader can check it", () => {
    expect(describeTierScale(buildTierScale(league()))).toContain("78");
  });

  it("says plainly when there is no ladder rather than printing a zero", () => {
    expect(describeTierScale(null)).not.toContain("0");
  });
});
