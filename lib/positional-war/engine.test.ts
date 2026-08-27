/**
 * The Positional WAR engine, end to end over synthetic universes.
 *
 * Every fixture here is hand-shaped so the seated counts are checkable by
 * inspection: a position's pool is a descending ladder, so the top k are
 * obvious and the replacement level is the (k+1)-th entry.
 */

import { describe, expect, it } from "vitest";
import { NON_STARTING_SLOTS, PULSE_SLOT_ELIGIBILITY, type PulsePosition } from "@/lib/power-pulse/types";
import { startingSlots } from "@/lib/power-pulse/lineup";
import { computeCurves, unprojectableSlots } from "./engine";
import { DEFAULT_WAR_SETTINGS } from "./default-settings";
import type { WarInput, WarPlayerInput } from "./types";

const SETTINGS: WarInput["settings"] = {
  displayDepthMultiple: DEFAULT_WAR_SETTINGS.displayDepthMultiple,
  minDisplayDepth: DEFAULT_WAR_SETTINGS.minDisplayDepth,
  cliffThreshold: DEFAULT_WAR_SETTINGS.cliffThreshold,
  clampBelowReplacement: DEFAULT_WAR_SETTINGS.clampBelowReplacement,
};

const WEEKS = { from: 1, to: 14 };

/** Per-position coefficient of variation, matching the Power Pulse defaults. */
const CV: Record<PulsePosition, number> = {
  QB: 0.35,
  RB: 0.55,
  WR: 0.65,
  TE: 0.7,
  K: 0.5,
  DEF: 0.75,
};

/**
 * A descending ladder of `count` players at `position`, starting at `top`
 * points and falling by `step` each rank. Every player is projected every week
 * in the window unless `byeWeeks` says otherwise.
 */
function ladder(
  position: PulsePosition,
  count: number,
  top: number,
  step: number,
  opts: { byeWeeks?: Map<number, number[]> } = {},
): WarPlayerInput[] {
  const out: WarPlayerInput[] = [];
  for (let i = 0; i < count; i += 1) {
    const points = Math.max(0.5, top - i * step);
    const byWeek = new Map<number, { points: number; sigma: number }>();
    for (let week = WEEKS.from; week <= WEEKS.to; week += 1) {
      const byes = opts.byeWeeks?.get(week) ?? [];
      if (byes.includes(i)) continue;
      byWeek.set(week, { points, sigma: points * CV[position] });
    }
    out.push({
      playerId: `${position}-${String(i + 1).padStart(3, "0")}`,
      sleeperId: `s${position}${i + 1}`,
      slug: `${position.toLowerCase()}-${i + 1}`,
      name: `${position}${i + 1}`,
      team: null,
      injuryStatus: null,
      position,
      byWeek,
    });
  }
  return out;
}

/** A realistic-shaped universe: deep at WR and RB, thin at K and DEF. */
function universe(): WarPlayerInput[] {
  return [
    ...ladder("QB", 40, 22, 0.4),
    ...ladder("RB", 90, 21, 0.35),
    ...ladder("WR", 120, 20, 0.28),
    ...ladder("TE", 60, 15, 0.32),
    ...ladder("K", 34, 7.5, 0.09),
    ...ladder("DEF", 32, 8.4, 0.12),
  ];
}

function inputFor(
  rosterPositions: string[],
  teamCount: number,
  players: WarPlayerInput[] = universe(),
): WarInput {
  return {
    league: {
      season: 2026,
      slots: startingSlots(rosterPositions),
      teamCount,
      fromWeek: WEEKS.from,
      toWeek: WEEKS.to,
    },
    players,
    settings: SETTINGS,
  };
}

const ONE_QB = ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "K", "DEF", "BN", "BN"];
const SUPERFLEX = ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "SUPER_FLEX", "K", "DEF", "BN", "BN"];

function curveFor(result: ReturnType<typeof computeCurves>, position: PulsePosition) {
  const found = result.curves.find((c) => c.position === position);
  if (!found) throw new Error(`no curve for ${position}`);
  return found;
}

describe("the shape of the answer", () => {
  const result = computeCurves(inputFor(ONE_QB, 12));

  it("produces one curve per startable position", () => {
    expect(result.curves.map((c) => c.position).sort()).toEqual(
      ["DEF", "K", "QB", "RB", "TE", "WR"].sort(),
    );
  });

  it("gives every series a monotonically non-increasing WAR", () => {
    for (const curve of result.curves) {
      for (let i = 1; i < curve.curve.length; i += 1) {
        expect(curve.curve[i].war).toBeLessThanOrEqual(curve.curve[i - 1].war);
      }
    }
  });

  it("numbers position ranks from 1 with no gaps", () => {
    for (const curve of result.curves) {
      curve.curve.forEach((point, i) => expect(point.positionRank).toBe(i + 1));
    }
  });

  it("gives a position with only dedicated slots exactly teamCount times its slot count", () => {
    // One QB slot, one TE slot, one K, one DEF, three WR: only RB, WR and TE
    // are flex-eligible here, so QB, K and DEF cannot move.
    expect(curveFor(result, "QB").structuralDemand).toBe(12);
    expect(curveFor(result, "K").structuralDemand).toBe(12);
    expect(curveFor(result, "DEF").structuralDemand).toBe(12);
  });

  it("puts the flex somewhere among the flex-eligible positions", () => {
    const flexEligible = ["RB", "WR", "TE"] as const;
    const total = flexEligible.reduce((sum, p) => sum + curveFor(result, p).structuralDemand, 0);
    // 2 RB + 3 WR + 1 TE + 1 FLEX = 7 slots per team, 84 across twelve teams.
    expect(total).toBe(84);
  });

  it("seats exactly one player per startable slot across the league", () => {
    const seated = result.curves.reduce((sum, c) => sum + c.structuralDemand, 0);
    expect(seated).toBe(startingSlots(ONE_QB).length * 12);
  });

  it("caps each series at the display depth", () => {
    for (const curve of result.curves) {
      const cap = Math.max(
        SETTINGS.minDisplayDepth,
        Math.ceil(curve.structuralDemand * SETTINGS.displayDepthMultiple),
      );
      expect(curve.curve.length).toBeLessThanOrEqual(cap);
    }
  });

  it("carries a diagnostic row for every week in the window", () => {
    for (const curve of result.curves) {
      expect(curve.weeklyDiagnostics.map((d) => d.week)).toEqual(
        Array.from({ length: 14 }, (_, i) => i + 1),
      );
    }
  });
});

describe("the marker at structural demand", () => {
  const result = computeCurves(inputFor(ONE_QB, 12));

  it("carries a real value rather than an asserted zero", () => {
    // Replacement is weekly and the axis is structural, so the last player this
    // league starts beats the weekly replacement in most weeks. A zero here
    // would be a claim the model does not make.
    const positive = result.curves.filter((c) => (c.warAtDemand ?? 0) > 0);
    expect(positive.length).toBeGreaterThanOrEqual(4);
  });

  it("is the WAR of the player sitting exactly at that rank", () => {
    for (const curve of result.curves) {
      const atRank = curve.curve.find((p) => p.positionRank === curve.structuralDemand);
      expect(curve.warAtDemand).toBe(atRank ? atRank.war : null);
    }
  });

  it("sits below rank 1", () => {
    for (const curve of result.curves) {
      if (curve.warAtDemand === null || curve.warRank1 === null) continue;
      expect(curve.warAtDemand).toBeLessThanOrEqual(curve.warRank1);
    }
  });
});

describe("the properties the plan pins", () => {
  it("is deterministic: two runs on identical input are deep-equal", () => {
    const a = computeCurves(inputFor(ONE_QB, 12));
    const b = computeCurves(inputFor(ONE_QB, 12));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("never produces a negative season WAR under the default clamp", () => {
    const result = computeCurves(inputFor(ONE_QB, 12));
    for (const curve of result.curves) {
      for (const point of curve.curve) expect(point.war).toBeGreaterThanOrEqual(0);
    }
  });

  it("lets WAR go negative when the clamp is turned off", () => {
    const input = inputFor(ONE_QB, 12);
    const result = computeCurves({
      ...input,
      settings: { ...SETTINGS, clampBelowReplacement: false },
    });
    const deepest = result.curves.flatMap((c) => c.curve).filter((p) => p.war < 0);
    expect(deepest.length).toBeGreaterThan(0);
  });

  it("lowers replacement and raises rank-1 WAR as the league gets more demanding", () => {
    const sizes = [10, 12, 14];
    const replacements: number[] = [];
    const tops: number[] = [];
    for (const teams of sizes) {
      const rb = curveFor(computeCurves(inputFor(ONE_QB, teams)), "RB");
      replacements.push(rb.replacementPoints ?? 0);
      tops.push(rb.warRank1 ?? 0);
    }
    expect(replacements[1]).toBeLessThan(replacements[0]);
    expect(replacements[2]).toBeLessThan(replacements[1]);
    expect(tops[1]).toBeGreaterThan(tops[0]);
    expect(tops[2]).toBeGreaterThan(tops[1]);
  });

  it("makes quarterbacks far scarcer in superflex", () => {
    const oneQb = curveFor(computeCurves(inputFor(ONE_QB, 12)), "QB");
    const superflex = curveFor(computeCurves(inputFor(SUPERFLEX, 12)), "QB");

    expect(superflex.structuralDemand).toBeGreaterThan(oneQb.structuralDemand);
    expect(superflex.replacementPoints ?? 0).toBeLessThan(oneQb.replacementPoints ?? 0);
    // Acceptance criterion 7: at least a 40 percent higher rank-1 QB figure.
    expect(superflex.warRank1 ?? 0).toBeGreaterThan((oneQb.warRank1 ?? 0) * 1.4);
  });

  it("gives a player who never beats replacement exactly zero", () => {
    const result = computeCurves(inputFor(ONE_QB, 12));
    const wr = curveFor(result, "WR");
    const tail = wr.curve[wr.curve.length - 1];
    // The deepest plotted receiver in a 120-deep ladder is far below the level
    // this league starts, so he is worth nothing over replacement.
    expect(tail.war).toBe(0);
    expect(tail.pointsAboveReplacement).toBe(0);
  });
});

describe("league shapes", () => {
  it("produces no kicker curve for a league with no kicker slot", () => {
    const noKicker = ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "DEF", "BN"];
    const result = computeCurves(inputFor(noKicker, 12));
    expect(result.curves.find((c) => c.position === "K")).toBeUndefined();
    expect(result.curves.find((c) => c.position === "DEF")).toBeDefined();
  });

  it("seats no running back in a receiver-only flex", () => {
    const recFlex = ["QB", "RB", "RB", "WR", "WR", "TE", "REC_FLEX", "K", "DEF", "BN"];
    const result = computeCurves(inputFor(recFlex, 12));
    expect(curveFor(result, "RB").structuralDemand).toBe(24);
  });

  it("seats two quarterbacks per team unconditionally with a second literal QB token", () => {
    const twoQb = ["QB", "QB", "RB", "RB", "WR", "WR", "WR", "TE", "K", "DEF", "BN"];
    const result = computeCurves(inputFor(twoQb, 12));
    expect(curveFor(result, "QB").structuralDemand).toBe(24);
  });

  it("flags a shallow pool rather than inventing a zero replacement", () => {
    // 32 defenses cannot cover 33 teams, so nobody is benched at DEF.
    const result = computeCurves(inputFor(ONE_QB, 33));
    const def = curveFor(result, "DEF");
    expect(def.shallowPool).toBe(true);
    expect(def.replacementPoints ?? 0).toBeGreaterThan(0);
  });

  it("does not flag a shallow pool when the bench holds somebody", () => {
    const result = computeCurves(inputFor(ONE_QB, 20));
    expect(curveFor(result, "DEF").shallowPool).toBe(false);
  });

  it("returns nothing for an empty week window", () => {
    const input = inputFor(ONE_QB, 12);
    const result = computeCurves({
      ...input,
      league: { ...input.league, fromWeek: 15, toWeek: 14 },
    });
    expect(result.curves).toEqual([]);
  });

  it("returns nothing when the universe is empty", () => {
    const result = computeCurves(inputFor(ONE_QB, 12, []));
    expect(result.curves).toEqual([]);
  });
});

describe("byes", () => {
  it("contributes nothing rather than a negative, and never a zero-point week", () => {
    // Give the top six running backs a bye in week 7.
    const byes = new Map<number, number[]>([[7, [0, 1, 2, 3, 4, 5]]]);
    const withByes = [
      ...ladder("QB", 40, 22, 0.4),
      ...ladder("RB", 90, 21, 0.35, { byeWeeks: byes }),
      ...ladder("WR", 120, 20, 0.28),
      ...ladder("TE", 60, 15, 0.32),
      ...ladder("K", 34, 7.5, 0.09),
      ...ladder("DEF", 32, 8.4, 0.12),
    ];
    const result = computeCurves(inputFor(ONE_QB, 12, withByes));
    const rb1 = curveFor(result, "RB").curve[0];

    // Thirteen projected weeks out of fourteen, and his per-week mean is his
    // real rate rather than one dragged down by a fabricated zero.
    expect(rb1.weeksProjected).toBe(13);
    expect(rb1.projectedPointsPerWeek).toBeCloseTo(21, 1);
    expect(rb1.war).toBeGreaterThan(0);
  });

  it("lowers replacement level in a heavy bye week", () => {
    const byes = new Map<number, number[]>([[7, Array.from({ length: 20 }, (_, i) => i)]]);
    const withByes = [
      ...ladder("QB", 40, 22, 0.4),
      ...ladder("RB", 90, 21, 0.35, { byeWeeks: byes }),
      ...ladder("WR", 120, 20, 0.28),
      ...ladder("TE", 60, 15, 0.32),
      ...ladder("K", 34, 7.5, 0.09),
      ...ladder("DEF", 32, 8.4, 0.12),
    ];
    const rb = curveFor(computeCurves(inputFor(ONE_QB, 12, withByes)), "RB");
    const week7 = rb.weeklyDiagnostics.find((d) => d.week === 7);
    const week6 = rb.weeklyDiagnostics.find((d) => d.week === 6);
    expect(week7?.replacement ?? 0).toBeLessThan(week6?.replacement ?? 0);
  });
});

describe("the cliff", () => {
  it("names the first rank below the threshold share of rank 1", () => {
    const result = computeCurves(inputFor(ONE_QB, 12));
    for (const curve of result.curves) {
      if (curve.cliffRank === null || curve.warRank1 === null) continue;
      const bar = curve.warRank1 * SETTINGS.cliffThreshold;
      const at = curve.curve.find((p) => p.positionRank === curve.cliffRank);
      const before = curve.curve.find((p) => p.positionRank === (curve.cliffRank ?? 0) - 1);
      expect(at?.war ?? 0).toBeLessThan(bar);
      if (before) expect(before.war).toBeGreaterThanOrEqual(bar);
    }
  });

  it("is null when rank 1 carries no WAR at all", () => {
    const flat = ladder("QB", 20, 10, 0).map((p) => ({ ...p }));
    const result = computeCurves(
      inputFor(["QB", "BN"], 12, [...flat, ...ladder("RB", 30, 10, 0)]),
    );
    const qb = result.curves.find((c) => c.position === "QB");
    expect(qb?.warRank1).toBe(0);
    expect(qb?.cliffRank).toBeNull();
  });
});

describe("unprojectableSlots", () => {
  it("names an IDP league's defensive slots and nothing else", () => {
    const idp = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "IDP_FLEX", "IDP_FLEX", "K", "DEF", "BN", "IR"];
    expect(unprojectableSlots(idp, NON_STARTING_SLOTS, PULSE_SLOT_ELIGIBILITY)).toEqual([
      "IDP_FLEX",
    ]);
  });

  it("names nothing for a league every slot of which is projectable", () => {
    expect(unprojectableSlots(ONE_QB, NON_STARTING_SLOTS, PULSE_SLOT_ELIGIBILITY)).toEqual([]);
  });

  it("does not name bench, IR, or taxi slots", () => {
    const withReserves = ["QB", "RB", "WR", "BN", "BN", "IR", "TAXI"];
    expect(unprojectableSlots(withReserves, NON_STARTING_SLOTS, PULSE_SLOT_ELIGIBILITY)).toEqual([]);
  });
});
