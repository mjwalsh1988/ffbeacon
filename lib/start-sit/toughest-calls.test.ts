import { describe, expect, it } from "vitest";
import {
  selectToughestCalls,
  comparePairsByCloseness,
  TOUGHEST_CALLS_STARTABLE_CUT,
  TOUGHEST_CALLS_PAIR_WINDOW,
  TOUGHEST_CALLS_GRID_MIN,
  TOUGHEST_CALLS_GRID_MAX,
  TOUGHEST_CALLS_BY_POSITION_SIZE,
  TOUGHEST_CALLS_UNAVAILABLE_INJURY_STATUSES,
  type SelectToughestCallsInput,
  type ToughestCallsPair,
  type ToughestCallsUniversePlayer,
} from "./toughest-calls";
import { winProbability } from "@/lib/power-pulse/math";
import type { StartSitCandidate, StartSitProjection, PulsePosition } from "./types";

/* -------------------------------------------------------------------------- */
/* Fixture builders, matching the pattern established by engine.test.ts,     */
/* rank.test.ts and reasons.test.ts in this directory.                       */
/* -------------------------------------------------------------------------- */

function candidate(overrides: Partial<StartSitCandidate> & { playerId: string; name: string }): StartSitCandidate {
  return {
    playerId: overrides.playerId,
    slug: overrides.slug ?? overrides.playerId,
    sleeperId: overrides.sleeperId ?? null,
    name: overrides.name,
    position: overrides.position ?? "RB",
    team: overrides.team ?? "ATL",
    injuryStatus: overrides.injuryStatus ?? null,
  };
}

function projection(playerId: string, overrides: Partial<StartSitProjection> = {}): StartSitProjection {
  return {
    playerId,
    week: 5,
    points: null,
    rawPoints: null,
    sigma: null,
    floor: null,
    ceiling: null,
    opponent: null,
    opponentMultiplier: null,
    defenseRankVsPosition: null,
    beatRate: null,
    availabilityRate: null,
    weeksGraded: 0,
    environment: null,
    environmentTier: null,
    onBye: false,
    availability: "projected",
    ...overrides,
  };
}

/** One universe player: a slug, a position, a points figure, a positional rank, and an optional sigma. */
function entry(params: {
  slug: string;
  position: PulsePosition;
  points: number;
  positionRank: number;
  sigma?: number | null;
  injuryStatus?: string | null;
  availability?: "projected" | "out" | null;
}): ToughestCallsUniversePlayer {
  const sigma = params.sigma ?? 4;
  return {
    candidate: candidate({
      playerId: params.slug,
      slug: params.slug,
      name: params.slug,
      position: params.position,
      injuryStatus: params.injuryStatus ?? null,
    }),
    projection: projection(params.slug, {
      points: params.points,
      sigma,
      availability: params.availability ?? "projected",
    }),
    positionRank: params.positionRank,
  };
}

function baseInput(universe: ToughestCallsUniversePlayer[]): SelectToughestCallsInput {
  return {
    universe,
    week: 5,
    season: 2026,
    formatDisplay: "PPR",
    projectionSource: "sleeper",
  };
}

/** A dense, evenly spaced group so every position has plenty of eligible pairs, for size/diversity tests. */
function denseGroup(position: PulsePosition, count: number, startPoints: number, step: number): ToughestCallsUniversePlayer[] {
  const out: ToughestCallsUniversePlayer[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push(
      entry({
        slug: `${position.toLowerCase()}${i + 1}`,
        position,
        points: startPoints - i * step,
        positionRank: i + 1,
      }),
    );
  }
  return out;
}

function allSlugsIn(pairs: ToughestCallsPair[]): string[] {
  return pairs.flatMap((p) => [p.a.slug, p.b.slug]);
}

/* -------------------------------------------------------------------------- */
/* Startable cuts                                                             */
/* -------------------------------------------------------------------------- */

describe("selectToughestCalls: startable cut", () => {
  it("never pairs a player ranked below the positional cut", () => {
    const cut = TOUGHEST_CALLS_STARTABLE_CUT.QB; // 16
    const universe = denseGroup("QB", cut + 4, 30, 0.05); // qb1..qb20, positionRank 1..20
    const result = selectToughestCalls(baseInput(universe));

    const gridSlugs = allSlugsIn(result.grid);
    const byPositionSlugs = allSlugsIn(result.byPosition.QB);

    for (let rank = cut + 1; rank <= cut + 4; rank += 1) {
      const slug = `qb${rank}`;
      expect(gridSlugs, `${slug} is past the QB cut of ${cut}`).not.toContain(slug);
      expect(byPositionSlugs, `${slug} is past the QB cut of ${cut}`).not.toContain(slug);
    }
  });

  it("keeps a player exactly at the cut and drops the very next one", () => {
    const cut = TOUGHEST_CALLS_STARTABLE_CUT.DEF; // 12
    const universe = denseGroup("DEF", cut + 1, 10, 0.1); // def1..def13
    const result = selectToughestCalls(baseInput(universe));
    const slugs = new Set(allSlugsIn([...result.grid, ...result.byPosition.DEF]));

    expect(slugs.has(`def${cut}`)).toBe(true);
    expect(slugs.has(`def${cut + 1}`)).toBe(false);
  });

  it("ignores a projection-less player regardless of rank", () => {
    const universe = [
      entry({ slug: "wr1", position: "WR", points: 20, positionRank: 1 }),
      { ...entry({ slug: "wr2", position: "WR", points: 18, positionRank: 2 }), projection: projection("wr2", { points: null }) },
      entry({ slug: "wr3", position: "WR", points: 16, positionRank: 3 }),
    ];
    const result = selectToughestCalls(baseInput(universe));
    const slugs = allSlugsIn([...result.grid, ...result.byPosition.WR]);
    expect(slugs).not.toContain("wr2");
  });
});

/* -------------------------------------------------------------------------- */
/* Availability exclusion (SEO-T911)                                          */
/* -------------------------------------------------------------------------- */

describe("selectToughestCalls: availability exclusion (SEO-T911)", () => {
  it("never lets a player whose projection is marked out appear in the grid or byPosition, even ranked first with a real points figure", () => {
    const universe: ToughestCallsUniversePlayer[] = [
      entry({ slug: "rb1", position: "RB", points: 22, positionRank: 1, availability: "out" }),
      entry({ slug: "rb2", position: "RB", points: 18, positionRank: 2 }),
      entry({ slug: "rb3", position: "RB", points: 17.5, positionRank: 3 }),
    ];
    const result = selectToughestCalls(baseInput(universe));
    const slugs = allSlugsIn([...result.grid, ...result.byPosition.RB]);
    expect(slugs).not.toContain("rb1");
    // The remaining, available players still form a pair.
    expect(slugs).toContain("rb2");
    expect(slugs).toContain("rb3");
  });

  it.each(["Out", "IR", "PUP", "Suspended", "out", "ir", "pup", "suspended"])(
    "never lets a player with injury_status %s appear in the grid or byPosition",
    (status) => {
      const universe: ToughestCallsUniversePlayer[] = [
        entry({ slug: "wr1", position: "WR", points: 20, positionRank: 1, injuryStatus: status }),
        entry({ slug: "wr2", position: "WR", points: 19.8, positionRank: 2 }),
        entry({ slug: "wr3", position: "WR", points: 19.6, positionRank: 3 }),
      ];
      const result = selectToughestCalls(baseInput(universe));
      const slugs = allSlugsIn([...result.grid, ...result.byPosition.WR]);
      expect(slugs).not.toContain("wr1");
    },
  );

  it("does not exclude a week-to-week designation outside the unavailable list, e.g. Questionable or Doubtful", () => {
    for (const status of ["Questionable", "Doubtful"]) {
      expect(TOUGHEST_CALLS_UNAVAILABLE_INJURY_STATUSES.has(status.toUpperCase())).toBe(false);
    }
    const universe: ToughestCallsUniversePlayer[] = [
      entry({ slug: "te1", position: "TE", points: 15, positionRank: 1, injuryStatus: "Questionable" }),
      entry({ slug: "te2", position: "TE", points: 14.8, positionRank: 2 }),
    ];
    const result = selectToughestCalls(baseInput(universe));
    const slugs = allSlugsIn([...result.grid, ...result.byPosition.TE]);
    expect(slugs).toContain("te1");
  });

  it("does not let an out or IR player be pulled in as the diversity fill for another position", () => {
    const universe: ToughestCallsUniversePlayer[] = [
      entry({ slug: "k1", position: "K", points: 9, positionRank: 1, availability: "out" }),
      entry({ slug: "k2", position: "K", points: 8.9, positionRank: 2, injuryStatus: "IR" }),
      entry({ slug: "k3", position: "K", points: 8.8, positionRank: 3 }),
      entry({ slug: "k4", position: "K", points: 8.7, positionRank: 4 }),
    ];
    const result = selectToughestCalls(baseInput(universe));
    const gridSlugs = allSlugsIn(result.grid);
    expect(gridSlugs).not.toContain("k1");
    expect(gridSlugs).not.toContain("k2");
  });
});

/* -------------------------------------------------------------------------- */
/* Pairing window of three                                                    */
/* -------------------------------------------------------------------------- */

describe("selectToughestCalls: pairing window", () => {
  it("never pairs a player against anyone more than TOUGHEST_CALLS_PAIR_WINDOW below him", () => {
    // Six WRs, all with the EXACT same points value. A tie is the only way to
    // put the absolute closest possible pair (diff 0) at an arbitrary index
    // distance: with points equal, the group sorts by slug, so "wa" and "wf"
    // (alphabetically first and last) land 5 apart despite being as close as
    // any pair in the group can be. If the window were not enforced, wa-wf
    // (and wa-we, 4 apart) would be at least as good a pick as any other
    // equal-points pair; they must never appear.
    const universe: ToughestCallsUniversePlayer[] = ["wa", "wb", "wc", "wd", "we", "wf"].map((slug, i) =>
      entry({ slug, position: "WR", points: 15.0, positionRank: i + 1 }),
    );

    const result = selectToughestCalls(baseInput(universe));
    const everyPairSlugs = [...result.byPosition.WR, ...result.grid].map((p) => new Set([p.a.slug, p.b.slug]));

    for (const pairSlugs of everyPairSlugs) {
      expect(pairSlugs.has("wa") && pairSlugs.has("we"), "wa and we are 4 apart, outside the window").toBe(false);
      expect(pairSlugs.has("wa") && pairSlugs.has("wf"), "wa and wf are 5 apart, outside the window").toBe(false);
    }
  });

  it("does pair a player against someone exactly TOUGHEST_CALLS_PAIR_WINDOW below him", () => {
    expect(TOUGHEST_CALLS_PAIR_WINDOW).toBe(3);
    const universe: ToughestCallsUniversePlayer[] = ["wa", "wb", "wc", "wd"].map((slug, i) =>
      entry({ slug, position: "WR", points: 15.0, positionRank: i + 1 }),
    );
    const result = selectToughestCalls(baseInput(universe));
    const pairSlugs = [...result.byPosition.WR, ...result.grid].map((p) => new Set([p.a.slug, p.b.slug]));
    const hasWaWd = pairSlugs.some((s) => s.has("wa") && s.has("wd"));
    expect(hasWaWd, "wa and wd are exactly 3 apart, inside the window").toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Closeness ordering                                                         */
/* -------------------------------------------------------------------------- */

describe("selectToughestCalls: closeness ordering", () => {
  it("orders a close-tier pair ahead of a far-tier pair regardless of confidence", () => {
    const universe: ToughestCallsUniversePlayer[] = [
      entry({ slug: "te1", position: "TE", points: 20, positionRank: 1, sigma: 0 }),
      entry({ slug: "te2", position: "TE", points: 19.5, positionRank: 2, sigma: 0 }), // diff 0.5, tier 0
      entry({ slug: "te3", position: "TE", points: 15, positionRank: 3, sigma: 0 }), // diff (te2,te3) 4.5, tier 1
    ];
    const result = selectToughestCalls(baseInput(universe));
    const ordered = result.byPosition.TE;
    expect(ordered.length).toBeGreaterThanOrEqual(2);
    const closeIndex = ordered.findIndex((p) => new Set([p.a.slug, p.b.slug]).has("te1") && new Set([p.a.slug, p.b.slug]).has("te2"));
    const farIndex = ordered.findIndex((p) => new Set([p.a.slug, p.b.slug]).has("te2") && new Set([p.a.slug, p.b.slug]).has("te3"));
    expect(closeIndex).toBeGreaterThanOrEqual(0);
    expect(farIndex).toBeGreaterThanOrEqual(0);
    expect(closeIndex).toBeLessThan(farIndex);
  });

  it("comparePairsByCloseness: within the close tier, orders by confidence nearest 0.5 first", () => {
    // Two pairs, both under the 2.0 threshold. Pair A has a tiny points gap
    // (near-even win probability); pair B's gap is wider (confidence pulled
    // toward 1). Confidence is computed with the real winProbability
    // function, the same one computeConfidence uses, so the test asserts
    // real numbers rather than an assumption about their ordering.
    const sigma = 3;
    const pairA = { slugTop: "k1", slugBottom: "k2", pointsTop: 10.2, pointsBottom: 10.0 };
    const pairB = { slugTop: "k3", slugBottom: "k4", pointsTop: 11.9, pointsBottom: 10.1 };

    const confA = winProbability(pairA.pointsTop, sigma, pairA.pointsBottom, sigma);
    const confB = winProbability(pairB.pointsTop, sigma, pairB.pointsBottom, sigma);
    expect(Math.abs(confA - 0.5)).toBeLessThan(Math.abs(confB - 0.5));
    expect(Math.abs(pairA.pointsTop - pairA.pointsBottom)).toBeLessThan(2.0);
    expect(Math.abs(pairB.pointsTop - pairB.pointsBottom)).toBeLessThan(2.0);

    const player = (slug: string) => ({ slug, name: slug, position: "K" as PulsePosition, team: null, sleeperId: null });
    const pairAObj: ToughestCallsPair = {
      a: player(pairA.slugTop),
      b: player(pairA.slugBottom),
      week: 5,
      pointsA: pairA.pointsTop,
      pointsB: pairA.pointsBottom,
      confidence: confA,
      verdict: `Start ${pairA.slugTop}.`,
    };
    const pairBObj: ToughestCallsPair = {
      a: player(pairB.slugTop),
      b: player(pairB.slugBottom),
      week: 5,
      pointsA: pairB.pointsTop,
      pointsB: pairB.pointsBottom,
      confidence: confB,
      verdict: `Start ${pairB.slugTop}.`,
    };

    const sorted = [pairBObj, pairAObj].sort(comparePairsByCloseness);
    expect(sorted[0]).toBe(pairAObj);
    expect(sorted[1]).toBe(pairBObj);
  });

  it("comparePairsByCloseness sorts an unmeasured (null-confidence) pair after a measured one in the same tier", () => {
    const measured: ToughestCallsPair = {
      a: { slug: "a1", name: "A1", position: "RB", team: null, sleeperId: null },
      b: { slug: "b1", name: "B1", position: "RB", team: null, sleeperId: null },
      week: 5,
      pointsA: 10,
      pointsB: 9.5,
      confidence: 0.6,
      verdict: "Start A1.",
    };
    const unmeasured: ToughestCallsPair = {
      a: { slug: "a2", name: "A2", position: "RB", team: null, sleeperId: null },
      b: { slug: "b2", name: "B2", position: "RB", team: null, sleeperId: null },
      week: 5,
      pointsA: 10,
      pointsB: 9.5,
      confidence: null,
      verdict: "Start A2.",
    };
    const sorted = [unmeasured, measured].sort(comparePairsByCloseness);
    expect(sorted[0]).toBe(measured);
    expect(sorted[1]).toBe(unmeasured);
  });
});

/* -------------------------------------------------------------------------- */
/* Diversity                                                                  */
/* -------------------------------------------------------------------------- */

describe("selectToughestCalls: diversity", () => {
  it("never repeats a player across the grid", () => {
    const universe = [
      ...denseGroup("QB", 10, 25, 0.3),
      ...denseGroup("RB", 12, 22, 0.25),
      ...denseGroup("WR", 14, 20, 0.2),
    ];
    const result = selectToughestCalls(baseInput(universe));
    const slugs = allSlugsIn(result.grid);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("includes at least one pair for every position that has an eligible pair", () => {
    const universe = [
      ...denseGroup("QB", 4, 25, 0.3),
      ...denseGroup("RB", 4, 22, 0.25),
      ...denseGroup("WR", 4, 20, 0.2),
      ...denseGroup("TE", 4, 16, 0.15),
      ...denseGroup("K", 4, 9, 0.1),
      ...denseGroup("DEF", 4, 8, 0.1),
    ];
    const result = selectToughestCalls(baseInput(universe));
    const gridPositions = new Set(result.grid.flatMap((p) => [p.a.position, p.b.position]));
    for (const position of ["QB", "RB", "WR", "TE", "K", "DEF"] as PulsePosition[]) {
      expect(gridPositions.has(position), `${position} has eligible players but no grid pair`).toBe(true);
    }
  });

  it("skips a conflicting next-best pair rather than reusing a player", () => {
    // Three players, one position. The two closest pairs by points both
    // involve the middle player, so only one of them can ever appear.
    const universe: ToughestCallsUniversePlayer[] = [
      entry({ slug: "rb1", position: "RB", points: 20.0, positionRank: 1 }),
      entry({ slug: "rb2", position: "RB", points: 19.9, positionRank: 2 }), // closest to rb1
      entry({ slug: "rb3", position: "RB", points: 19.8, positionRank: 3 }), // closest to rb2
    ];
    const result = selectToughestCalls(baseInput(universe));
    const gridSlugs = allSlugsIn(result.grid);
    // rb2 sits between both closest pairs; it can appear in at most one grid pair.
    expect(gridSlugs.filter((s) => s === "rb2").length).toBeLessThanOrEqual(1);
    expect(new Set(gridSlugs).size).toBe(gridSlugs.length);
  });
});

/* -------------------------------------------------------------------------- */
/* Grid size bounds                                                           */
/* -------------------------------------------------------------------------- */

describe("selectToughestCalls: grid size bounds", () => {
  it("fills to the maximum when every position has ample non-conflicting pairs", () => {
    const universe = [
      ...denseGroup("QB", 16, 26, 0.3),
      ...denseGroup("RB", 30, 22, 0.25),
      ...denseGroup("WR", 36, 20, 0.2),
      ...denseGroup("TE", 14, 16, 0.15),
      ...denseGroup("K", 12, 9, 0.1),
      ...denseGroup("DEF", 12, 8, 0.1),
    ];
    const result = selectToughestCalls(baseInput(universe));
    expect(result.grid.length).toBe(TOUGHEST_CALLS_GRID_MAX);
    expect(result.grid.length).toBeGreaterThanOrEqual(TOUGHEST_CALLS_GRID_MIN);
  });

  it("never exceeds the maximum even with a very large universe", () => {
    const universe = [
      ...denseGroup("QB", 16, 26, 0.05),
      ...denseGroup("RB", 30, 22, 0.05),
      ...denseGroup("WR", 36, 20, 0.05),
      ...denseGroup("TE", 14, 16, 0.05),
      ...denseGroup("K", 12, 9, 0.05),
      ...denseGroup("DEF", 12, 8, 0.05),
    ];
    const result = selectToughestCalls(baseInput(universe));
    expect(result.grid.length).toBeLessThanOrEqual(TOUGHEST_CALLS_GRID_MAX);
  });

  it("keeps byPosition at or under TOUGHEST_CALLS_BY_POSITION_SIZE for every position", () => {
    const universe = denseGroup("WR", 36, 20, 0.2);
    const result = selectToughestCalls(baseInput(universe));
    for (const position of Object.keys(result.byPosition) as PulsePosition[]) {
      expect(result.byPosition[position].length).toBeLessThanOrEqual(TOUGHEST_CALLS_BY_POSITION_SIZE);
    }
  });

  it("can fall short of the minimum on a thin universe, rather than fabricating pairs", () => {
    const universe = denseGroup("K", 2, 9, 0.1); // one pair, total
    const result = selectToughestCalls(baseInput(universe));
    expect(result.grid.length).toBe(1);
    expect(result.grid.length).toBeLessThan(TOUGHEST_CALLS_GRID_MIN);
  });
});

/* -------------------------------------------------------------------------- */
/* Determinism                                                                */
/* -------------------------------------------------------------------------- */

describe("selectToughestCalls: determinism", () => {
  it("produces byte-identical output across repeated runs of the same input", () => {
    const universe = [
      ...denseGroup("QB", 16, 26, 0.3),
      ...denseGroup("RB", 30, 22, 0.25),
      ...denseGroup("WR", 36, 20, 0.2),
      ...denseGroup("TE", 14, 16, 0.15),
      ...denseGroup("K", 12, 9, 0.1),
      ...denseGroup("DEF", 12, 8, 0.1),
    ];
    const input = baseInput(universe);
    const first = selectToughestCalls(input);
    const second = selectToughestCalls(baseInput(universe.map((u) => ({ ...u }))));
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("is stable to the input's original array order", () => {
    const universe = [
      ...denseGroup("RB", 8, 22, 0.25),
      ...denseGroup("WR", 8, 20, 0.2),
    ];
    const shuffled = [...universe].reverse();
    const a = selectToughestCalls(baseInput(universe));
    const b = selectToughestCalls(baseInput(shuffled));
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it("breaks exact points ties by slug, not by input order", () => {
    const universe: ToughestCallsUniversePlayer[] = [
      entry({ slug: "wrz", position: "WR", points: 15, positionRank: 1 }),
      entry({ slug: "wra", position: "WR", points: 15, positionRank: 2 }),
      entry({ slug: "wrm", position: "WR", points: 12, positionRank: 3 }),
    ];
    const forward = selectToughestCalls(baseInput(universe));
    const reversed = selectToughestCalls(baseInput([...universe].reverse()));
    expect(JSON.stringify(reversed)).toBe(JSON.stringify(forward));
  });
});

/* -------------------------------------------------------------------------- */
/* Verdict text                                                               */
/* -------------------------------------------------------------------------- */

describe("selectToughestCalls: verdict text", () => {
  const BANNED_CHARACTERS = /[—–‘’“”…]/;

  it("never produces a banned AI-tell character in any verdict sentence", () => {
    const universe = [
      ...denseGroup("QB", 16, 26, 0.3),
      ...denseGroup("RB", 30, 22, 0.25),
      ...denseGroup("WR", 36, 20, 0.2),
      ...denseGroup("TE", 14, 16, 0.15),
      ...denseGroup("K", 12, 9, 0.1),
      ...denseGroup("DEF", 12, 8, 0.1),
    ];
    const result = selectToughestCalls(baseInput(universe));
    const allVerdicts = [
      ...result.grid.map((p) => p.verdict),
      ...Object.values(result.byPosition).flatMap((pairs) => pairs.map((p) => p.verdict)),
    ];
    expect(allVerdicts.length).toBeGreaterThan(0);
    for (const verdict of allVerdicts) {
      expect(verdict, verdict).not.toMatch(BANNED_CHARACTERS);
      expect(verdict.length).toBeGreaterThan(0);
    }
  });

  it("uses the same verdict template computeStartSit prints on the board (a Start sentence naming the higher side)", () => {
    const universe: ToughestCallsUniversePlayer[] = [
      entry({ slug: "rb1", position: "RB", points: 20, positionRank: 1, sigma: 3 }),
      entry({ slug: "rb2", position: "RB", points: 18, positionRank: 2, sigma: 3 }),
    ];
    const result = selectToughestCalls(baseInput(universe));
    const pair = result.byPosition.RB[0];
    expect(pair.a.slug).toBe("rb1");
    expect(pair.b.slug).toBe("rb2");
    expect(pair.verdict.startsWith("Start ")).toBe(true);
    expect(pair.verdict).toContain("rb1");
  });
});
