import { describe, it, expect } from "vitest";
import { computeMarginal, pointsWeightFor, DEFAULT_MARGINAL_SETTINGS } from "./marginal";
import type { ProjectionBoard, PlayerProjection } from "./projection-board";
import type { PulsePosition } from "@/lib/power-pulse/types";
import { buildOptimalLineup } from "@/lib/power-pulse/lineup";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const WEEKS = [1, 2, 3, 4];

function proj(
  playerId: string,
  position: PulsePosition,
  ppw: number,
  over: Partial<PlayerProjection> = {},
): PlayerProjection {
  const weeks = WEEKS.map((week) => ({
    week,
    points: ppw,
    sigma: ppw * 0.4,
    opponent: "BUF",
    oppMult: 1,
  }));
  return {
    playerId,
    position,
    weeks,
    seasonPoints: ppw * WEEKS.length,
    pointsPerWeek: ppw,
    beatRate: 0.5,
    reliability: 1,
    availability: 1,
    ratioStdev: 0.4,
    weeksPlayed: 30,
    ...over,
  };
}

function board(players: PlayerProjection[]): ProjectionBoard {
  return {
    version: "test",
    scoringSignature: "test",
    season: 2026,
    fromWeek: 1,
    weeks: WEEKS,
    scoringBase: "pts_ppr",
    players: Object.fromEntries(players.map((p) => [p.playerId, p])),
  };
}

/** A one-QB league with two backs, two receivers, a tight end, and a flex. */
const SLOTS = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX"];

// ---------------------------------------------------------------------------

describe("computeMarginal", () => {
  it("prices a player by what he adds to the optimal lineup, not by his own points", () => {
    // Every starting slot is already occupied, with an 8-point receiver holding
    // the flex. A 12-point back cannot take a dedicated RB spot from the two
    // better backs, so he takes the flex and his add is the 4-point upgrade, not
    // his own 12 points.
    const players = [
      proj("qb1", "QB", 22),
      proj("rb1", "RB", 18),
      proj("rb2", "RB", 16),
      proj("wr1", "WR", 20),
      proj("wr2", "WR", 19),
      proj("te1", "TE", 11),
      proj("flexIncumbent", "WR", 8),
      proj("candidate", "RB", 12),
    ];
    const result = computeMarginal({
      slots: SLOTS,
      rosterPlayerIds: ["qb1", "rb1", "rb2", "wr1", "wr2", "te1", "flexIncumbent"],
      candidateIds: ["candidate"],
      survivorIds: null,
      board: board(players),
      settings: DEFAULT_MARGINAL_SETTINGS,
    });
    const m = result.byPlayer.candidate;
    // He displaces the 8-point receiver in the flex: 12 - 8 = 4.
    expect(m.startingAdd).toBeCloseTo(4, 5);
    expect(m.driver).toBe("upgrade");
    expect(m.weeksStarting).toBe(WEEKS.length);
  });

  it("treats a bye as an absent week for the roster and a zero for the candidate", () => {
    // A candidate who plays three of four weeks adds nothing in the fourth, and
    // his average reflects that rather than pretending he played. Slots here
    // carry no flex, so the displaced tight end really does leave the lineup.
    const partial = proj("candidate", "TE", 12);
    partial.weeks = partial.weeks.filter((w) => w.week !== 3);
    const players = [proj("te1", "TE", 4), partial];
    const result = computeMarginal({
      slots: ["TE"],
      rosterPlayerIds: ["te1"],
      candidateIds: ["candidate"],
      survivorIds: null,
      board: board(players),
      settings: DEFAULT_MARGINAL_SETTINGS,
    });
    // Three weeks at +8, one week at 0, averaged over four.
    expect(result.byPlayer.candidate.startingAdd).toBeCloseTo(6, 5);
    expect(result.byPlayer.candidate.weeksStarting).toBe(3);
  });

  it("still values a player who cannot crack the lineup, as insurance", () => {
    // Every starting slot is filled by someone better. The old model would say
    // this player adds nothing, which is true this week and useless as advice.
    const players = [
      proj("qb1", "QB", 22),
      proj("rb1", "RB", 18),
      proj("rb2", "RB", 17),
      proj("wr1", "WR", 16),
      proj("wr2", "WR", 15),
      proj("te1", "TE", 12),
      proj("flex1", "WR", 14),
      proj("backup", "RB", 9),
    ];
    const result = computeMarginal({
      slots: SLOTS,
      rosterPlayerIds: ["qb1", "rb1", "rb2", "wr1", "wr2", "te1", "flex1"],
      candidateIds: ["backup"],
      survivorIds: null,
      board: board(players),
      settings: DEFAULT_MARGINAL_SETTINGS,
    });
    const m = result.byPlayer.backup;
    expect(m.startingAdd).toBe(0);
    expect(m.insuranceAdd).toBeGreaterThan(0);
    expect(m.effectiveAdd).toBeGreaterThan(0);
    expect(m.driver).toBe("insurance");
  });

  it("charges for waiting when the position falls off before your next pick", () => {
    const players = [proj("elite", "RB", 20), proj("scrub", "RB", 6), proj("rb1", "RB", 10)];
    const result = computeMarginal({
      slots: SLOTS,
      rosterPlayerIds: ["rb1"],
      candidateIds: ["elite"],
      // Only the 6-point back survives to the next pick.
      survivorIds: ["scrub"],
      board: board(players),
      settings: DEFAULT_MARGINAL_SETTINGS,
    });
    expect(result.byPlayer.elite.dropoffEdge).toBeCloseTo(14, 5);
    expect(result.byPlayer.elite.effectiveAdd).toBeGreaterThan(
      result.byPlayer.elite.startingAdd,
    );
  });

  it("reports fullness against the league's real slot count", () => {
    const players = [proj("qb1", "QB", 20), proj("rb1", "RB", 15)];
    const result = computeMarginal({
      slots: SLOTS,
      rosterPlayerIds: ["qb1", "rb1"],
      candidateIds: [],
      survivorIds: null,
      board: board(players),
      settings: DEFAULT_MARGINAL_SETTINGS,
    });
    expect(result.startingSlotCount).toBe(7);
    // Two slots filled of seven.
    expect(result.startersFilled).toBeCloseTo(2, 5);
    expect(result.fullness).toBeCloseTo(2 / 7, 3);
  });

  it("returns nothing rather than guessing when there are no slots", () => {
    const result = computeMarginal({
      slots: [],
      rosterPlayerIds: ["a"],
      candidateIds: ["a"],
      survivorIds: null,
      board: board([proj("a", "RB", 10)]),
      settings: DEFAULT_MARGINAL_SETTINGS,
    });
    expect(result.byPlayer).toEqual({});
    expect(result.baseline).toBe(0);
  });
});

describe("pointsWeightFor", () => {
  const opts = { empty: 0.8, full: 0.35 };

  it("puts almost everything on points when the lineup is empty", () => {
    expect(pointsWeightFor(0, opts)).toBeCloseTo(0.8, 5);
  });

  it("hands over to value when the lineup is full", () => {
    expect(pointsWeightFor(1, opts)).toBeCloseTo(0.35, 5);
  });

  it("holds the handover until late, so a half-full lineup is still a points question", () => {
    // Quadratic, so at halfway the weight has only moved a quarter of the way.
    expect(pointsWeightFor(0.5, opts)).toBeCloseTo(0.8 + (0.35 - 0.8) * 0.25, 5);
    expect(pointsWeightFor(0.5, opts)).toBeGreaterThan(0.65);
  });

  it("clamps out-of-range fullness rather than extrapolating", () => {
    expect(pointsWeightFor(-1, opts)).toBeCloseTo(0.8, 5);
    expect(pointsWeightFor(9, opts)).toBeCloseTo(0.35, 5);
  });
});

describe("the probe identity", () => {
  /**
   * computeMarginal no longer rebuilds a lineup per candidate. It probes once per
   * (position, week) with an unreachable score, reads the seat threshold off the
   * gain, and prices every candidate at that position arithmetically.
   *
   * That is only sound because a starting lineup is a maximum-weight independent
   * set in a transversal matroid, where adding one element either fills a free
   * slot or displaces exactly one incumbent, so the gain is max(0, points - d)
   * for a d that does not depend on the candidate.
   *
   * This test is the proof, by brute force: build the lineup with the candidate
   * actually added and check the engine agrees, across randomized rosters, slot
   * shapes, and scores. If someone later "simplifies" the probe away, or changes
   * buildOptimalLineup in a way that breaks the matroid property, this fails.
   */
  const SLOT_SHAPES = [
    ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX"],
    ["QB", "RB", "WR", "WR", "TE", "FLEX", "SUPER_FLEX"],
    ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "WR_TE", "WRRB_FLEX"],
    ["QB", "QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "FLEX"],
  ];
  const POSITIONS: PulsePosition[] = ["QB", "RB", "WR", "TE"];

  /** Deterministic generator, so a failure is reproducible. */
  function rng(seed: number) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  it("matches a brute-force rebuild across randomized rosters and slot shapes", () => {
    const random = rng(20260808);
    let checked = 0;
    let worstError = 0;

    for (let trial = 0; trial < 120; trial += 1) {
      const slots = SLOT_SHAPES[trial % SLOT_SHAPES.length];
      const rosterSize = Math.floor(random() * 14);
      const players: PlayerProjection[] = [];
      const rosterIds: string[] = [];
      for (let i = 0; i < rosterSize; i += 1) {
        const position = POSITIONS[Math.floor(random() * POSITIONS.length)];
        const id = `r${trial}_${i}`;
        players.push(proj(id, position, Math.round(random() * 250) / 10));
        rosterIds.push(id);
      }
      const candidateIds: string[] = [];
      for (let i = 0; i < 6; i += 1) {
        const position = POSITIONS[Math.floor(random() * POSITIONS.length)];
        const id = `c${trial}_${i}`;
        players.push(proj(id, position, Math.round(random() * 250) / 10));
        candidateIds.push(id);
      }

      const b = board(players);
      const result = computeMarginal({
        slots,
        rosterPlayerIds: rosterIds,
        candidateIds,
        survivorIds: null,
        board: b,
        settings: DEFAULT_MARGINAL_SETTINGS,
      });

      for (const candidateId of candidateIds) {
        const candidate = b.players[candidateId];
        // Brute force: rebuild the lineup with him in it, every week.
        const gains: number[] = [];
        for (const week of WEEKS) {
          const rosterWeek = rosterIds
            .map((id) => b.players[id])
            .filter(Boolean)
            .map((p) => ({
              playerId: p.playerId,
              position: p.position,
              points: p.weeks[0].points,
              sigma: p.weeks[0].sigma,
            }));
          const base = buildOptimalLineup(slots, rosterWeek).total;
          const withHim = buildOptimalLineup(slots, [
            ...rosterWeek,
            {
              playerId: candidateId,
              position: candidate.position,
              points: candidate.weeks[0].points,
              sigma: candidate.weeks[0].sigma,
            },
          ]).total;
          gains.push(withHim - base);
        }
        const expected = gains.reduce((sum, g) => sum + g, 0) / gains.length;
        const actual = result.byPlayer[candidateId].startingAdd;
        worstError = Math.max(worstError, Math.abs(expected - actual));
        checked += 1;
      }
    }

    expect(checked).toBe(720);
    // Rounded to two decimals by the engine, so anything under half a cent of a
    // point is the rounding and nothing else.
    expect(worstError).toBeLessThan(0.006);
  });
});
