import { describe, it, expect } from "vitest";
import {
  buildMergedFill,
  positionWeekStats,
  startablePositions,
  structuralCandidates,
  type MergedFill,
} from "./replacement";
import { PULSE_SLOT_ELIGIBILITY, type PulsePosition } from "@/lib/power-pulse/types";
import type { LineupCandidate } from "@/lib/power-pulse/lineup";
import type { WarPlayerInput } from "./types";

// ---------------------------------------------------------------------------
// Shared fixture builders.
//
// Flex configurations F1 through F9 below each fix a small synthetic universe
// with hand-checkable projections, per plan section 9.2. The pool sizes and
// point values are chosen so the seated/benched split at every position is
// determined by simple descending-value arithmetic rather than by tie-breaks,
// so each assertion can be reasoned about directly from the fixture.
// ---------------------------------------------------------------------------

/** One position's pool: `points[i]` is player `i + 1`'s points, descending. */
function pool(position: PulsePosition, points: number[], idPrefix: string = position): LineupCandidate[] {
  return points.map((p, i) => ({ playerId: `${idPrefix}${i + 1}`, position, points: p, sigma: 2 }));
}

/** `count` descending values starting at `start`, stepping down by `step`. */
function ladder(count: number, start: number, step = 1): number[] {
  return Array.from({ length: count }, (_, i) => start - i * step);
}

function leagueWideSlots(perTeamSlots: string[], teamCount: number): string[] {
  return Array.from({ length: teamCount }, () => perTeamSlots).flat();
}

/**
 * Naive slot-order greedy fill: for each slot in league order, take the
 * best remaining eligible candidate. This is the baseline buildOptimalLineup
 * (used inside buildMergedFill) must never do worse than, and the one it must
 * strictly beat on the non-nested-flex counterexample in F2.
 */
function naiveGreedyTotal(slots: string[], candidates: LineupCandidate[]): number {
  const used = new Set<string>();
  let total = 0;
  for (const slot of slots) {
    const eligible = PULSE_SLOT_ELIGIBILITY[slot] ?? [];
    let best: LineupCandidate | null = null;
    for (const c of candidates) {
      if (used.has(c.playerId) || !eligible.includes(c.position)) continue;
      if (!best || c.points > best.points) best = c;
    }
    if (best) {
      used.add(best.playerId);
      total += best.points;
    }
  }
  return total;
}

function fillTotal(fill: MergedFill): number {
  let total = 0;
  for (const points of fill.seatedByPosition.values()) total += points.reduce((sum, p) => sum + p, 0);
  return total;
}

function seatedCountTotal(fill: MergedFill): number {
  let total = 0;
  for (const points of fill.seatedByPosition.values()) total += points.length;
  return total;
}

/** Slot tokens whose eligibility is exactly one position: no flex involved. */
function dedicatedSlotCount(perTeamSlots: string[], position: PulsePosition): number {
  return perTeamSlots.filter((token) => {
    const eligible = PULSE_SLOT_ELIGIBILITY[token] ?? [];
    return eligible.length === 1 && eligible[0] === position;
  }).length;
}

function hasFlexEligibility(perTeamSlots: string[], position: PulsePosition): boolean {
  return perTeamSlots.some((token) => {
    const eligible = PULSE_SLOT_ELIGIBILITY[token] ?? [];
    return eligible.length > 1 && eligible.includes(position);
  });
}

/**
 * Plan section 9.3, asserted against one fill: the benched-never-beats-seated
 * ordering invariant, seated players being exactly the top k by points, and
 * (for positions with no flex eligibility anywhere in the slot list) an exact
 * structuralDemand === teamCount * dedicatedSlotCount.
 *
 * Named for what it protects: if this fails, buildOptimalLineup's greedy
 * admission order changed and every quantity this module reads off a fill is
 * no longer valid.
 */
function assertBenchedNeverBeatsSeated(fill: MergedFill, teamCount: number, perTeamSlots: string[]) {
  for (const position of startablePositions(perTeamSlots)) {
    const seated = fill.seatedByPosition.get(position) ?? [];
    const benched = fill.benchedByPosition.get(position) ?? [];

    if (seated.length > 0 && benched.length > 0) {
      expect(Math.max(...benched)).toBeLessThanOrEqual(Math.min(...seated));
    }

    // Seated players are exactly the top k of that position by points.
    const combinedDescending = [...seated, ...benched].sort((a, b) => b - a);
    const topK = combinedDescending.slice(0, seated.length).sort((a, b) => b - a);
    expect([...seated].sort((a, b) => b - a)).toEqual(topK);

    if (!hasFlexEligibility(perTeamSlots, position)) {
      expect(seated.length).toBe(teamCount * dedicatedSlotCount(perTeamSlots, position));
    }
  }
}

/** The universe shared by F1, F7's divergent baseline, and F8. */
function standardUniverse(): LineupCandidate[] {
  return [
    ...pool("QB", ladder(15, 30)),
    ...pool("RB", ladder(40, 55)),
    ...pool("WR", ladder(40, 45)),
    ...pool("TE", [...ladder(12, 35), ...[3, 2, 1, 0, -1, -2, -3, -4]]),
    ...pool("K", ladder(15, 10)),
    ...pool("DEF", ladder(15, 12)),
  ];
}

// ---------------------------------------------------------------------------
// F1: single FLEX slot, 12 teams.
// ---------------------------------------------------------------------------

describe("F1: [QB,RB,RB,WR,WR,WR,TE,FLEX,K,DEF], 12 teams", () => {
  const teamCount = 12;
  const perTeamSlots = ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "K", "DEF"];
  const fill = buildMergedFill({
    slots: perTeamSlots,
    teamCount,
    candidates: standardUniverse(),
    week: 1,
  });

  it("seats exactly 120 total, with QB, K, and DEF at exactly 12 and RB+WR+TE at exactly 84", () => {
    expect(seatedCountTotal(fill)).toBe(120);
    expect(positionWeekStats(fill, "QB").seatedCount).toBe(12);
    expect(positionWeekStats(fill, "K").seatedCount).toBe(12);
    expect(positionWeekStats(fill, "DEF").seatedCount).toBe(12);

    const rb = positionWeekStats(fill, "RB").seatedCount;
    const wr = positionWeekStats(fill, "WR").seatedCount;
    const te = positionWeekStats(fill, "TE").seatedCount;
    expect(rb + wr + te).toBe(84);
  });

  it("allocates the flex seats by points, not as a fixed per-position share", () => {
    const rb = positionWeekStats(fill, "RB").seatedCount;
    const wr = positionWeekStats(fill, "WR").seatedCount;
    const te = positionWeekStats(fill, "TE").seatedCount;
    // A fixed even share would add 4 to each dedicated count (24, 36, 12).
    expect([rb, wr, te]).not.toEqual([28, 40, 16]);
    // In this fixture the remaining RB pool outproduces the remaining WR and
    // TE pools at every rank, so every flex seat goes to RB.
    expect(rb).toBe(36);
    expect(wr).toBe(36);
    expect(te).toBe(12);
  });

  it("holds the benched-never-beats-seated invariant (model breaks if this fails)", () => {
    assertBenchedNeverBeatsSeated(fill, teamCount, perTeamSlots);
  });
});

// ---------------------------------------------------------------------------
// F2: non-nested overlapping flex (WR_TE / WRRB_FLEX), the optimizer's own
// counterexample against naive slot-order greedy.
// ---------------------------------------------------------------------------

describe("F2: [QB,RB,RB,WR,WR,TE,WR_TE,WRRB_FLEX,K,DEF]", () => {
  it("reproduces the optimizer header's counterexample: greedy 32, exact 35", () => {
    const slots = ["WR_TE", "WRRB_FLEX"];
    const candidates: LineupCandidate[] = [
      { playerId: "wr1", position: "WR", points: 20, sigma: 1 },
      { playerId: "te1", position: "TE", points: 15, sigma: 1 },
      { playerId: "rb1", position: "RB", points: 12, sigma: 1 },
    ];

    expect(naiveGreedyTotal(slots, candidates)).toBeCloseTo(32, 5);

    const fill = buildMergedFill({ slots, teamCount: 1, candidates, week: 1 });
    expect(fillTotal(fill)).toBeCloseTo(35, 5);
    expect(fillTotal(fill)).toBeGreaterThan(naiveGreedyTotal(slots, candidates));
  });

  it("is never worse than naive slot-order greedy over a full league universe", () => {
    const teamCount = 12;
    const perTeamSlots = ["QB", "RB", "RB", "WR", "WR", "TE", "WR_TE", "WRRB_FLEX", "K", "DEF"];
    const candidates = standardUniverse();

    const fill = buildMergedFill({ slots: perTeamSlots, teamCount, candidates, week: 1 });
    const naive = naiveGreedyTotal(leagueWideSlots(perTeamSlots, teamCount), candidates);

    expect(fillTotal(fill)).toBeGreaterThanOrEqual(naive);
    assertBenchedNeverBeatsSeated(fill, teamCount, perTeamSlots);
  });
});

// ---------------------------------------------------------------------------
// F3, F4, F5: superflex and two-QB demand.
// ---------------------------------------------------------------------------

/** RB/WR/TE/K/DEF pools shared by F3, F4, and F5, built so a single flex slot
 *  seats exactly one dedicated-tier "remaining" player from each of RB, WR,
 *  and TE (4 apiece), which makes the FLEX-vs-SUPER_FLEX comparison in F3
 *  and F4 an exact swap rather than a partial one. */
function rbWrTeKDefUniverse(): LineupCandidate[] {
  return [
    ...pool("RB", ladder(24, 80), "RBd"),
    ...pool("RB", [32, 29, 26, 23], "RBr"),
    ...pool("WR", ladder(36, 70), "WRd"),
    ...pool("WR", [31, 28, 25, 22], "WRr"),
    ...pool("TE", ladder(12, 60), "TEd"),
    ...pool("TE", [30, 27, 24, 21], "TEr"),
    ...pool("TE", [5, 4, 3, 2], "TEl"),
    ...pool("K", ladder(15, 20)),
    ...pool("DEF", ladder(15, 18)),
  ];
}

describe("F3: SUPER_FLEX in place of F1's FLEX", () => {
  const teamCount = 12;
  const flexSlots = ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "K", "DEF"];
  const superFlexSlots = ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "SUPER_FLEX", "K", "DEF"];

  // QB1-12 are always seated by the dedicated QB token. QB13-24 outproject
  // every non-QB flex alternative (max 32), so they win SUPER_FLEX outright.
  // QB25-30 stay unconditionally benched in both configurations and give
  // SUPER_FLEX's replacement level somewhere to land.
  const qbUniverse = [
    ...pool("QB", ladder(12, 200), "QBd"),
    ...pool("QB", ladder(12, 50), "QBb"),
    ...pool("QB", ladder(6, 20), "QBx"),
  ];
  const universe = [...qbUniverse, ...rbWrTeKDefUniverse()];

  const flexFill = buildMergedFill({ slots: flexSlots, teamCount, candidates: universe, week: 1 });
  const superFlexFill = buildMergedFill({ slots: superFlexSlots, teamCount, candidates: universe, week: 1 });

  it("raises structural QB demand from 12 to 24", () => {
    expect(positionWeekStats(flexFill, "QB").seatedCount).toBe(12);
    expect(positionWeekStats(superFlexFill, "QB").seatedCount).toBe(24);
  });

  it("lowers replacement(QB) as backups get pulled into the lineup", () => {
    const flexReplacement = positionWeekStats(flexFill, "QB").replacement;
    const superFlexReplacement = positionWeekStats(superFlexFill, "QB").replacement;
    expect(superFlexReplacement).toBeLessThan(flexReplacement);
  });

  it("seats fewer RB, WR, and TE once QB claims the shared flex seats", () => {
    for (const position of ["RB", "WR", "TE"] as const) {
      const flexSeated = positionWeekStats(flexFill, position).seatedCount;
      const superFlexSeated = positionWeekStats(superFlexFill, position).seatedCount;
      expect(superFlexSeated).toBeLessThan(flexSeated);
    }
  });

  it("holds the benched-never-beats-seated invariant in both configurations", () => {
    assertBenchedNeverBeatsSeated(flexFill, teamCount, flexSlots);
    assertBenchedNeverBeatsSeated(superFlexFill, teamCount, superFlexSlots);
  });
});

describe("F4: F3's league with only 14 projectable QBs", () => {
  const teamCount = 12;
  const superFlexSlots = ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "SUPER_FLEX", "K", "DEF"];

  // Only 2 backups exist, and they are too weak (18, 17) to beat the RB/WR/TE
  // remaining pool (max 32), so superflex cannot manufacture QB demand that
  // does not exist in the pool.
  const universe = [
    ...pool("QB", ladder(12, 200), "QBd"),
    ...pool("QB", [18, 17], "QBb"),
    ...rbWrTeKDefUniverse(),
  ];
  const fill = buildMergedFill({ slots: superFlexSlots, teamCount, candidates: universe, week: 1 });

  it("does not manufacture quarterbacks that do not exist: structural demand stays below 24", () => {
    const stats = positionWeekStats(fill, "QB");
    expect(stats.seatedCount).toBe(12);
    expect(stats.seatedCount).toBeLessThan(24);
  });

  it("is not a shallow pool, since the 14-player pool exceeds the 12 seated", () => {
    const stats = positionWeekStats(fill, "QB");
    expect(stats.shallowPool).toBe(false);
    expect(stats.replacement).toBe(18);
  });

  it("holds the benched-never-beats-seated invariant", () => {
    assertBenchedNeverBeatsSeated(fill, teamCount, superFlexSlots);
  });
});

describe("F5: [QB,QB,RB,RB,WR,WR,WR,TE,K,DEF], two literal QB tokens", () => {
  const teamCount = 12;
  const perTeamSlots = ["QB", "QB", "RB", "RB", "WR", "WR", "WR", "TE", "K", "DEF"];
  const universe = [
    ...pool("QB", ladder(12, 200), "QBd"),
    ...pool("QB", ladder(12, 50), "QBb"),
    ...rbWrTeKDefUniverse(),
  ];
  const fill = buildMergedFill({ slots: perTeamSlots, teamCount, candidates: universe, week: 1 });

  it("seats exactly 24 quarterbacks unconditionally, unlike F3's conditional 24", () => {
    expect(positionWeekStats(fill, "QB").seatedCount).toBe(24);
  });

  it("has no flex token at all, so every position is dedicated-only and exact", () => {
    // This is exactly what assertBenchedNeverBeatsSeated's dedicated-count
    // check verifies for every position, since none of F5's tokens are
    // flex-eligible.
    assertBenchedNeverBeatsSeated(fill, teamCount, perTeamSlots);
  });
});

// ---------------------------------------------------------------------------
// F6: REC_FLEX excludes RB.
// ---------------------------------------------------------------------------

describe("F6: [QB,RB,RB,WR,WR,TE,REC_FLEX,K,DEF]", () => {
  const teamCount = 12;
  const perTeamSlots = ["QB", "RB", "RB", "WR", "WR", "TE", "REC_FLEX", "K", "DEF"];
  // The RB pool is deep and strong, well above the WR/TE pools, so if RB
  // could take REC_FLEX it would win every seat. It cannot.
  const candidates = [
    ...pool("QB", ladder(15, 30)),
    ...pool("RB", ladder(40, 55)),
    ...pool("WR", ladder(30, 45)),
    ...pool("TE", ladder(20, 35)),
    ...pool("K", ladder(15, 10)),
    ...pool("DEF", ladder(15, 12)),
  ];
  const fill = buildMergedFill({ slots: perTeamSlots, teamCount, candidates, week: 1 });

  it("seats exactly teamCount * 2 running backs, however strong the RB pool is", () => {
    expect(positionWeekStats(fill, "RB").seatedCount).toBe(teamCount * 2);
  });

  it("holds the benched-never-beats-seated invariant", () => {
    assertBenchedNeverBeatsSeated(fill, teamCount, perTeamSlots);
  });
});

// ---------------------------------------------------------------------------
// F7: three FLEX slots converge RB/WR/TE replacement levels.
// ---------------------------------------------------------------------------

describe("F7: [QB,RB,RB,WR,WR,WR,TE,FLEX,FLEX,FLEX,K,DEF], three flex", () => {
  const teamCount = 12;
  const baseSlots = ["QB", "RB", "RB", "WR", "WR", "WR", "TE"];

  function replacementSpread(fill: MergedFill): number {
    const values = (["RB", "WR", "TE"] as const).map((p) => positionWeekStats(fill, p).replacement);
    const max = Math.max(...values);
    const min = Math.min(...values);
    return (max - min) / ((max + min) / 2);
  }

  it("converges RB, WR, and TE replacement within 15%, far tighter than a single-FLEX league", () => {
    // F1's fixture: a single flex slot, RB dominant, replacement values
    // (36, 9, 3-ish) that are nowhere near converged.
    const sparseFill = buildMergedFill({
      slots: [...baseSlots, "FLEX", "K", "DEF"],
      teamCount,
      candidates: standardUniverse(),
      week: 1,
    });
    const sparseSpread = replacementSpread(sparseFill);

    // Deep flex (36 shared seats) over a universe where RB, WR, and TE
    // decline at the same rate below their dedicated tier, just offset from
    // one another, so the shared pool substitutes across positions.
    const richCandidates = [
      ...pool("QB", ladder(15, 30)),
      ...pool("RB", [...ladder(24, 100), ...ladder(30, 40)], "RB"),
      ...pool("WR", [...ladder(36, 90), ...ladder(30, 37)], "WR"),
      ...pool("TE", [...ladder(12, 80), ...ladder(30, 34)], "TE"),
      ...pool("K", ladder(15, 10)),
      ...pool("DEF", ladder(15, 12)),
    ];
    const richFill = buildMergedFill({
      slots: [...baseSlots, "FLEX", "FLEX", "FLEX", "K", "DEF"],
      teamCount,
      candidates: richCandidates,
      week: 1,
    });
    const richSpread = replacementSpread(richFill);

    expect(richSpread).toBeLessThanOrEqual(0.15);
    expect(richSpread).toBeLessThan(sparseSpread);

    assertBenchedNeverBeatsSeated(richFill, teamCount, [...baseSlots, "FLEX", "FLEX", "FLEX", "K", "DEF"]);
  });
});

// ---------------------------------------------------------------------------
// F8: a TE point premium pulls tight ends into flex.
// ---------------------------------------------------------------------------

describe("F8: F1 with a TE point premium applied to the universe", () => {
  const teamCount = 12;
  const perTeamSlots = ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "K", "DEF"];

  it("raises structural TE demand above the dedicated-only count of 12", () => {
    const baseline = buildMergedFill({
      slots: perTeamSlots,
      teamCount,
      candidates: standardUniverse(),
      week: 1,
    });
    expect(positionWeekStats(baseline, "TE").seatedCount).toBe(12);

    const boosted = standardUniverse().map((c) =>
      c.position === "TE" ? { ...c, points: c.points + 30 } : c,
    );
    const withPremium = buildMergedFill({ slots: perTeamSlots, teamCount, candidates: boosted, week: 1 });
    const teStats = positionWeekStats(withPremium, "TE");
    expect(teStats.seatedCount).toBeGreaterThan(12);

    assertBenchedNeverBeatsSeated(withPremium, teamCount, perTeamSlots);
  });
});

// ---------------------------------------------------------------------------
// F9: DEF depth and the shallow pool fallback.
// ---------------------------------------------------------------------------

describe("F9: DEF depth and the shallow pool fallback", () => {
  const perTeamSlots = ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "K", "DEF"];

  it("seats exactly one DEF per team from a 32-player pool at 20 teams, not shallow", () => {
    const teamCount = 20;
    const candidates = [
      ...pool("QB", ladder(25, 30)),
      ...pool("RB", ladder(60, 55)),
      ...pool("WR", ladder(60, 45)),
      ...pool("TE", ladder(30, 35)),
      ...pool("K", ladder(25, 10)),
      ...pool("DEF", ladder(32, 12)),
    ];
    const fill = buildMergedFill({ slots: perTeamSlots, teamCount, candidates, week: 1 });
    const stats = positionWeekStats(fill, "DEF");
    expect(stats.seatedCount).toBe(20);
    expect(stats.shallowPool).toBe(false);
  });

  it("falls back to the minimum seated DEF, never zero, once the pool runs out at 33 teams", () => {
    const teamCount = 33;
    const candidates = [
      ...pool("QB", ladder(40, 30)),
      ...pool("RB", ladder(90, 55)),
      ...pool("WR", ladder(90, 45)),
      ...pool("TE", ladder(45, 35)),
      ...pool("K", ladder(40, 10)),
      ...pool("DEF", ladder(32, 12)), // only 32 defenses for 33 teams
    ];
    const fill = buildMergedFill({ slots: perTeamSlots, teamCount, candidates, week: 1 });
    const stats = positionWeekStats(fill, "DEF");
    const seated = fill.seatedByPosition.get("DEF") ?? [];

    expect(stats.seatedCount).toBe(32);
    expect(stats.shallowPool).toBe(true);
    expect(stats.replacement).toBe(Math.min(...seated));
    expect(stats.replacement).not.toBe(0);
  });
});

// ---------------------------------------------------------------------------
// positionWeekStats: direct edge-case coverage.
// ---------------------------------------------------------------------------

describe("positionWeekStats", () => {
  it("returns seatedCount 0 with no fabricated numbers when a position seats and benches nobody", () => {
    const fill: MergedFill = {
      week: 1,
      seatedByPosition: new Map(),
      benchedByPosition: new Map(),
      muRef: 0,
      sigmaRef: 0,
    };
    expect(positionWeekStats(fill, "K")).toEqual({
      seatedCount: 0,
      replacement: 0,
      avgSeated: 0,
      deficit: 0,
      shallowPool: false,
    });
  });

  it("falls back to the minimum seated player, never zero, when nobody is benched at a seated position", () => {
    const fill: MergedFill = {
      week: 1,
      seatedByPosition: new Map([["DEF", [30, 20, 10]]]),
      benchedByPosition: new Map(),
      muRef: 0,
      sigmaRef: 0,
    };
    const stats = positionWeekStats(fill, "DEF");
    expect(stats.shallowPool).toBe(true);
    expect(stats.replacement).toBe(10);
    expect(stats.avgSeated).toBeCloseTo(20, 5);
    expect(stats.deficit).toBeCloseTo(10, 5);
  });

  it("computes deficit as max(0, avgSeated - replacement), never negative", () => {
    const fill: MergedFill = {
      week: 1,
      seatedByPosition: new Map([["TE", [10, 8]]]),
      benchedByPosition: new Map([["TE", [50]]]), // an implausible but valid input: benched above seated
      muRef: 0,
      sigmaRef: 0,
    };
    const stats = positionWeekStats(fill, "TE");
    expect(stats.replacement).toBe(50);
    expect(stats.avgSeated).toBeCloseTo(9, 5);
    expect(stats.deficit).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// buildMergedFill: reference distribution.
// ---------------------------------------------------------------------------

describe("buildMergedFill", () => {
  it("computes muRef and sigmaRef from the same fill, averaged per team, and carries the week through", () => {
    const fill = buildMergedFill({
      slots: ["QB"],
      teamCount: 2,
      candidates: [
        { playerId: "a", position: "QB", points: 20, sigma: 3 },
        { playerId: "b", position: "QB", points: 10, sigma: 4 },
      ],
      week: 3,
    });

    expect(fill.week).toBe(3);
    expect(fill.muRef).toBeCloseTo((20 + 10) / 2, 5);
    expect(fill.sigmaRef).toBeCloseTo(Math.sqrt((3 * 3 + 4 * 4) / 2), 5);
    expect([...(fill.seatedByPosition.get("QB") ?? [])].sort((a, b) => b - a)).toEqual([20, 10]);
    expect(fill.benchedByPosition.get("QB") ?? []).toEqual([]);
  });

  it("carries a null week through for the structural fill", () => {
    const fill = buildMergedFill({
      slots: ["QB"],
      teamCount: 1,
      candidates: [{ playerId: "a", position: "QB", points: 20, sigma: 3 }],
      week: null,
    });
    expect(fill.week).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// structuralCandidates
// ---------------------------------------------------------------------------

describe("structuralCandidates", () => {
  it("represents each player by the mean of his projected weeks and excludes players with no projection", () => {
    const players: WarPlayerInput[] = [
      {
        playerId: "p1",
        sleeperId: "1",
        slug: "p1",
        name: "Player One",
        team: null,
        injuryStatus: null,
        position: "RB",
        byWeek: new Map([
          [1, { points: 10, sigma: 2 }],
          [2, { points: 20, sigma: 4 }],
        ]),
      },
      {
        playerId: "p2",
        sleeperId: "2",
        slug: "p2",
        name: "Player Two",
        team: null,
        injuryStatus: null,
        position: "WR",
        byWeek: new Map([[1, { points: 5, sigma: 1 }]]), // a bye in week 2
      },
      {
        playerId: "p3",
        sleeperId: "3",
        slug: "p3",
        name: "Player Three",
        team: null,
        injuryStatus: null,
        position: "TE",
        byWeek: new Map(), // no projection anywhere in the window
      },
    ];

    const result = structuralCandidates(players, [1, 2]);

    expect(result).toHaveLength(2);
    const p1 = result.find((c) => c.playerId === "p1");
    expect(p1?.points).toBeCloseTo(15, 5);
    expect(p1?.sigma).toBeCloseTo(3, 5);
    const p2 = result.find((c) => c.playerId === "p2");
    expect(p2?.points).toBeCloseTo(5, 5);
    expect(result.some((c) => c.playerId === "p3")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// startablePositions
// ---------------------------------------------------------------------------

describe("startablePositions", () => {
  it("derives positions from PULSE_SLOT_ELIGIBILITY, deduplicated, in PULSE_POSITIONS order", () => {
    expect(startablePositions(["QB", "RB", "RB", "WR", "FLEX", "K", "DEF"])).toEqual([
      "QB",
      "RB",
      "WR",
      "TE",
      "K",
      "DEF",
    ]);
  });

  it("returns no K when the league has no K slot", () => {
    expect(startablePositions(["QB", "RB", "WR", "TE", "FLEX", "DEF"])).toEqual([
      "QB",
      "RB",
      "WR",
      "TE",
      "DEF",
    ]);
  });
});
