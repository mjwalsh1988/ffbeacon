import { describe, it, expect } from "vitest";
import {
  scoreFormat,
  replacementLevels,
  positionalDemand,
  computeConfidence,
  categorize,
  adjustmentMultiplier,
  type PlayerInput,
  type FormatShape,
} from "./engine";
import {
  DEFAULT_DRAFT_VALUE_SETTINGS,
  mergeDraftValueSettings,
  canonicalScoringForFormat,
  type StealPosition,
} from "./default-settings";
import { scoreStatMap } from "@/lib/league-scoring";

const S = DEFAULT_DRAFT_VALUE_SETTINGS;

const REDRAFT_1QB: FormatShape = {
  slug: "redraft-ppr-std",
  leagueType: "redraft",
  isSuperflex: false,
};
const REDRAFT_SF: FormatShape = {
  slug: "redraft-ppr-sflex",
  leagueType: "redraft",
  isSuperflex: true,
};
const DYNASTY_SF: FormatShape = {
  slug: "dynasty-ppr-sflex",
  leagueType: "dynasty",
  isSuperflex: true,
};

function player(overrides: Partial<PlayerInput> & Pick<PlayerInput, "playerId" | "position">): PlayerInput {
  return {
    beaconRank: null,
    beaconValue: null,
    positionRank: null,
    projectedPoints: null,
    beatRate: null,
    shrunkMultiplier: null,
    availabilityRate: null,
    marketAdp: null,
    marketAdpKey: "ppr",
    marketSource: "sleeper",
    roomAdp: null,
    roomPicksSampled: null,
    ...overrides,
  };
}

describe("positionalDemand", () => {
  it("counts dedicated starters plus a share of the flex", () => {
    // 12 teams * (2 RB + 0.45 * 1 flex) = 29.4
    expect(positionalDemand("RB", REDRAFT_1QB, S)).toBeCloseTo(29.4, 5);
    // 12 * (3 WR + 0.45) = 41.4
    expect(positionalDemand("WR", REDRAFT_1QB, S)).toBeCloseTo(41.4, 5);
    // 12 * (1 TE + 0.10) = 13.2
    expect(positionalDemand("TE", REDRAFT_1QB, S)).toBeCloseTo(13.2, 5);
  });

  it("gives tight ends a small flex share, not a full one", () => {
    expect(positionalDemand("TE", REDRAFT_1QB, S)).toBeLessThan(
      positionalDemand("RB", REDRAFT_1QB, S),
    );
  });

  it("adds a quarterback in superflex and only in superflex", () => {
    expect(positionalDemand("QB", REDRAFT_1QB, S)).toBe(12);
    expect(positionalDemand("QB", REDRAFT_SF, S)).toBe(24);
  });
});

describe("replacementLevels", () => {
  it("takes the last starter the league actually needs", () => {
    // 30 running backs, 300 down to 10 points in steps of 10.
    const rbs = Array.from({ length: 30 }, (_, i) =>
      player({ playerId: `rb${i}`, position: "RB", projectedPoints: 300 - i * 10 }),
    );
    const levels = replacementLevels(rbs, REDRAFT_1QB, S);
    // demand 29.4 -> ceil 30 -> index 29 -> the 30th best, which is 10.
    expect(levels.RB).toBe(10);
  });

  it("returns null for a position with no projections at all", () => {
    const levels = replacementLevels(
      [player({ playerId: "a", position: "RB", projectedPoints: 100 })],
      REDRAFT_1QB,
      S,
    );
    expect(levels.TE).toBeNull();
  });

  it("uses the last projected player when the board is shallower than demand", () => {
    const rbs = [
      player({ playerId: "a", position: "RB", projectedPoints: 200 }),
      player({ playerId: "b", position: "RB", projectedPoints: 100 }),
    ];
    expect(replacementLevels(rbs, REDRAFT_1QB, S).RB).toBe(100);
  });
});

describe("adjustmentMultiplier", () => {
  it("is exactly 1 for a player with no history", () => {
    expect(adjustmentMultiplier(player({ playerId: "a", position: "WR" }), S)).toBe(1);
  });

  it("clamps a wild reliability multiplier into the configured band", () => {
    const hot = player({ playerId: "a", position: "WR", shrunkMultiplier: 9 });
    expect(adjustmentMultiplier(hot, S)).toBeCloseTo(S.reliability.maxMultiplier, 5);
    const cold = player({ playerId: "b", position: "WR", shrunkMultiplier: 0.01 });
    expect(adjustmentMultiplier(cold, S)).toBeCloseTo(S.reliability.minMultiplier, 5);
  });

  it("damps availability so a missed season never zeroes a player out", () => {
    const fragile = player({ playerId: "a", position: "RB", availabilityRate: 0 });
    // damping 0.5 -> 0.5, floored at minMultiplier 0.7
    expect(adjustmentMultiplier(fragile, S)).toBeCloseTo(0.7, 5);
  });
});

describe("computeConfidence", () => {
  const base = {
    marketAdp: 50,
    beaconRank: 50,
    hasProjection: true,
    hasHistory: true,
    roomAdp: null,
    roomPicksSampled: null,
    deepestMarketAdp: 360,
    teams: 12,
  };

  it("is full for a well-known player with complete data", () => {
    expect(computeConfidence(base, S)).toBe(1);
  });

  it("collapses for a deep-board player, which is the whole point", () => {
    const deep = computeConfidence(
      { ...base, marketAdp: 340, beaconRank: 600 },
      S,
    );
    expect(deep).toBeLessThan(0.4);
  });

  it("docks a player with no projection more than one with no history", () => {
    const noHistory = computeConfidence({ ...base, hasHistory: false }, S);
    const noProjection = computeConfidence(
      { ...base, hasProjection: false, hasHistory: false },
      S,
    );
    expect(noHistory).toBeGreaterThan(noProjection);
    expect(noHistory).toBeLessThan(1);
  });

  it("ignores room ADP below the minimum sample", () => {
    const thin = computeConfidence(
      { ...base, roomAdp: 90, roomPicksSampled: S.confidence.roomMinDrafts - 1 },
      S,
    );
    expect(thin).toBe(computeConfidence(base, S));
  });

  it("raises confidence when our own rooms also let him fall", () => {
    const corroborated = computeConfidence(
      { ...base, marketAdp: 50, roomAdp: 90, roomPicksSampled: 10 },
      S,
    );
    // Already saturated at 1 without the room, so it can only stay there.
    expect(corroborated).toBe(1);

    const partial = { ...base, hasHistory: false, marketAdp: 50 };
    const withRoom = computeConfidence(
      { ...partial, roomAdp: 90, roomPicksSampled: 10 },
      S,
    );
    expect(withRoom).toBeGreaterThan(computeConfidence(partial, S));
  });

  it("lowers confidence when our rooms take him much earlier than the market", () => {
    const partial = { ...base, hasHistory: false };
    const contradicted = computeConfidence(
      { ...partial, marketAdp: 90, roomAdp: 50, roomPicksSampled: 10 },
      S,
    );
    expect(contradicted).toBeLessThan(computeConfidence(partial, S));
  });

  it("never leaves the 0 to 1 range", () => {
    const extreme = computeConfidence(
      { ...base, roomAdp: 500, roomPicksSampled: 50, marketAdp: 1, beaconRank: 1 },
      S,
    );
    expect(extreme).toBeLessThanOrEqual(1);
    expect(extreme).toBeGreaterThanOrEqual(0);
  });
});

describe("categorize", () => {
  it("needs both a real gap and real confidence to call a steal", () => {
    expect(categorize({ gapRounds: 2, confidence: 0.9, marketAdp: 80, par: 20 }, S)).toBe("steal");
    expect(categorize({ gapRounds: 2, confidence: 0.1, marketAdp: 80, par: 20 }, S)).not.toBe(
      "steal",
    );
  });

  it("refuses a steal who projects below a replacement starter", () => {
    // The Kirk Cousins shape: positional centering lifted a backup quarterback
    // going at pick 238 who projects 182 points BELOW replacement into the steal
    // bucket. The gap was real and the label was absurd.
    expect(categorize({ gapRounds: 1.5, confidence: 0.9, marketAdp: 238, par: -182 }, S)).not.toBe(
      "steal",
    );
  });

  it("still allows a steal we have no projection for", () => {
    // A null par is a player we have no opinion on (a rookie, a returning
    // injury), where the value board is the whole case. That is not the same as
    // a measured par that says he is replaceable.
    expect(categorize({ gapRounds: 1.5, confidence: 0.9, marketAdp: 120, par: null }, S)).toBe(
      "steal",
    );
  });

  it("calls the reverse a fade", () => {
    expect(categorize({ gapRounds: -2, confidence: 0.9, marketAdp: 40, par: 5 }, S)).toBe("fade");
  });

  it("allows a late-round swing to be uncertain", () => {
    expect(categorize({ gapRounds: 0.8, confidence: 0.2, marketAdp: 150, par: 10 }, S)).toBe(
      "swing",
    );
  });

  it("refuses a swing that is not actually available late", () => {
    expect(categorize({ gapRounds: 0.8, confidence: 0.2, marketAdp: 20, par: 10 }, S)).toBe("fair");
  });

  it("refuses a swing who projects below a replacement starter", () => {
    expect(categorize({ gapRounds: 0.8, confidence: 0.2, marketAdp: 150, par: -5 }, S)).toBe(
      "fair",
    );
  });

  it("is fair when there is no gap to speak of", () => {
    expect(categorize({ gapRounds: null, confidence: 1, marketAdp: 50, par: 10 }, S)).toBe("fair");
  });
});

// ---------------------------------------------------------------------------
// The two production failures this engine exists to prevent.
// ---------------------------------------------------------------------------

describe("trap 2: cross-position value rank vs scarcity-priced ADP", () => {
  /**
   * The fixture reproduces the MEASURED shape of the real board rather than a
   * guess at it. Query run against production on 2026-08-12, redraft-ppr-std
   * FF Beacon ranks joined to the Sleeper PPR market, mean of
   * (market rank - our value rank) per position:
   *
   *     QB  +26.6      (5 of our top 50, only 2 of the market's)
   *     WR   +8.9
   *     RB   -0.5
   *     TE   -5.7
   *
   * Quarterbacks are the systematic offender by a wide margin, which is what a
   * naive gap surfaces as six of its top twelve. Everything else is noise around
   * zero. So the fixture bakes those offsets in and the tests assert two things:
   * that the fixture really does reproduce the trap, and that the engine then
   * removes most of it.
   */
  const POSITION_MARKET_OFFSET: Record<StealPosition, number> = {
    QB: 27,
    WR: 9,
    RB: 0,
    TE: -6,
  };

  /** Position, count, value-merit curve, and projected-points curve. */
  const SHAPE: {
    position: StealPosition;
    count: number;
    meritBase: number;
    meritSlope: number;
    pointsBase: number;
    pointsSlope: number;
  }[] = [
    // Quarterbacks score the most raw points in real life, which is exactly why
    // a points-blind comparison overrates them in a one-QB league.
    { position: "QB", count: 32, meritBase: 1000, meritSlope: 22, pointsBase: 300, pointsSlope: 5.5 },
    { position: "RB", count: 73, meritBase: 1010, meritSlope: 9, pointsBase: 250, pointsSlope: 2.4 },
    { position: "WR", count: 96, meritBase: 1005, meritSlope: 7, pointsBase: 255, pointsSlope: 1.9 },
    { position: "TE", count: 32, meritBase: 960, meritSlope: 20, pointsBase: 190, pointsSlope: 4.2 },
  ];

  interface Fixture {
    players: PlayerInput[];
    valueRank: Map<string, number>;
    adpRank: Map<string, number>;
  }

  function buildFixture(): Fixture {
    const raw = SHAPE.flatMap((s) =>
      Array.from({ length: s.count }, (_, i) => ({
        playerId: `${s.position.toLowerCase()}${i}`,
        position: s.position,
        merit: s.meritBase - i * s.meritSlope,
        projected: s.pointsBase - i * s.pointsSlope,
      })),
    );

    // Our value board: rank by merit, best first.
    const byMerit = [...raw].sort((a, b) => b.merit - a.merit || a.playerId.localeCompare(b.playerId));
    const valueRank = new Map<string, number>();
    byMerit.forEach((p, i) => valueRank.set(p.playerId, i + 1));

    // The market: our rank shifted by the measured per-position offset, then
    // re-ranked so it is a real ordering rather than a shifted one.
    const byMarket = [...raw].sort((a, b) => {
      const av = (valueRank.get(a.playerId) as number) + POSITION_MARKET_OFFSET[a.position];
      const bv = (valueRank.get(b.playerId) as number) + POSITION_MARKET_OFFSET[b.position];
      return av - bv || a.playerId.localeCompare(b.playerId);
    });
    const adpRank = new Map<string, number>();
    byMarket.forEach((p, i) => adpRank.set(p.playerId, i + 1));

    const players = raw.map((p) =>
      player({
        playerId: p.playerId,
        position: p.position,
        beaconRank: valueRank.get(p.playerId) as number,
        beaconValue: 10000 - (valueRank.get(p.playerId) as number) * 30,
        projectedPoints: p.projected,
        // One pick per ranked player: ADP and its rank coincide, which is what
        // a real market looks like over its own drafted set.
        marketAdp: adpRank.get(p.playerId) as number,
      }),
    );

    return { players, valueRank, adpRank };
  }

  function meanBy<T>(items: readonly T[], of: (item: T) => number | null): number {
    const values = items.map(of).filter((v): v is number => typeof v === "number");
    return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
  }

  it("the fixture reproduces the trap it is testing against", () => {
    const { players, valueRank, adpRank } = buildFixture();
    const qbs = players.filter((p) => p.position === "QB");
    const naiveBias = meanBy(
      qbs,
      (p) => (adpRank.get(p.playerId) as number) - (valueRank.get(p.playerId) as number),
    );
    // Matches the +26.6 measured on production.
    expect(naiveBias).toBeGreaterThan(15);
  });

  it("removes the quarterback bias from the number the board ranks on", () => {
    const { players, valueRank, adpRank } = buildFixture();
    const scored = scoreFormat(players, REDRAFT_1QB, S);

    const qbIds = new Set(players.filter((p) => p.position === "QB").map((p) => p.playerId));
    const naiveBias = meanBy([...qbIds], (id) =>
      (adpRank.get(id) as number) - (valueRank.get(id) as number),
    );
    const qbs = scored.filter((s) => qbIds.has(s.playerId));

    // The scarcity ladder alone shrinks it, but does not remove it: a
    // points-above-replacement model really does want quarterbacks earlier than
    // a one-QB room takes them.
    const ladderOnlyBias = meanBy(qbs, (s) => s.valueGap);
    expect(Math.abs(ladderOnlyBias)).toBeLessThan(naiveBias);

    // Positional centering removes what is left, so the board ranks on how a
    // quarterback compares to other quarterbacks.
    const rankedBias = meanBy(qbs, (s) => s.positionAdjustedGap);
    expect(Math.abs(rankedBias)).toBeLessThan(naiveBias / 4);
  });

  it("keeps the raw arithmetic intact for the verdict to quote", () => {
    const { players } = buildFixture();
    const scored = scoreFormat(players, REDRAFT_1QB, S);
    for (const s of scored) {
      if (s.marketAdp === null || s.beaconPick === null) continue;
      expect(s.valueGap).toBeCloseTo(s.marketAdp - s.beaconPick, 5);
    }
  });

  it("leaves the board alone when centering is switched off", () => {
    const { players } = buildFixture();
    const off = mergeDraftValueSettings({ positionCentering: { enabled: false } });
    const scored = scoreFormat(players, REDRAFT_1QB, off);
    for (const s of scored) {
      expect(s.positionAdjustedGap).toBe(s.valueGap);
    }
  });

  it("does not center a position with too few graded players", () => {
    const thin = [
      player({ playerId: "te0", position: "TE", beaconValue: 500, marketAdp: 100 }),
      ...Array.from({ length: 20 }, (_, i) =>
        player({ playerId: `wr${i}`, position: "WR", beaconValue: 9000 - i * 100, marketAdp: i + 1 }),
      ),
    ];
    const scored = scoreFormat(thin, REDRAFT_1QB, S);
    const te = scored.find((s) => s.playerId === "te0");
    expect(te?.positionAdjustedGap).toBe(te?.valueGap);
  });

  it("does not fill the top of a one-QB board with quarterbacks", () => {
    const { players } = buildFixture();
    const scored = scoreFormat(players, REDRAFT_1QB, S);
    const topTwelve = [...scored]
      .filter((s) => s.stealScore !== null)
      .sort((a, b) => (b.stealScore as number) - (a.stealScore as number))
      .slice(0, 12);
    const qbCount = topTwelve.filter((s) => s.position === "QB").length;
    // The naive implementation returned 6 of 12. Half is the artifact returning.
    expect(qbCount).toBeLessThan(6);
  });

  it("prices the same quarterback later in one-QB than in superflex", () => {
    const { players } = buildFixture();
    const oneQb = scoreFormat(players, REDRAFT_1QB, S).find((s) => s.playerId === "qb8");
    const superflex = scoreFormat(players, REDRAFT_SF, S).find((s) => s.playerId === "qb8");
    expect(oneQb?.beaconPick).not.toBeNull();
    expect(superflex?.beaconPick).not.toBeNull();
    // Superflex needs twice as many quarterbacks, so QB9 clears a much lower
    // replacement bar there and belongs earlier.
    expect(superflex?.beaconPick as number).toBeLessThan(oneQb?.beaconPick as number);
  });
});

describe("trap 1: the deep board is noise", () => {
  /**
   * The measured failure: the largest raw gaps in dynasty superflex belonged to
   * players ranked past 130 with ADPs past 240 in a 360-player market. Both
   * numbers are guesses that deep, and the raw difference is largest exactly
   * where it means least.
   */
  it("ranks a shallow believable edge above a deep enormous one", () => {
    // 60 filler receivers whose value order and market order agree exactly, so
    // they contribute no gap of their own and the two test subjects are the only
    // players moving.
    const filler = Array.from({ length: 60 }, (_, i) =>
      player({
        playerId: `wr${String(i).padStart(2, "0")}`,
        position: "WR",
        beaconRank: (i + 1) * 5,
        beaconValue: 9000 - i * 100,
        projectedPoints: 250 - i * 3,
        beatRate: 0.45,
        marketAdp: (i + 1) * 5,
      }),
    );

    const pool = [
      // The Stribling shape: a huge raw gap, but BOTH numbers are deep enough
      // that neither means much. Ranks behind every filler, market takes him
      // near the very end.
      player({
        playerId: "deep",
        position: "WR",
        beaconRank: 320,
        beaconValue: 400,
        marketAdp: 298,
      }),
      // A believable mid-board edge: he ranks with the top handful by value and
      // by points, and the market takes him three rounds later than that.
      player({
        playerId: "shallow",
        position: "WR",
        beaconRank: 12,
        beaconValue: 8750,
        projectedPoints: 244,
        beatRate: 0.52,
        shrunkMultiplier: 1.02,
        availabilityRate: 0.95,
        marketAdp: 45,
      }),
      ...filler,
    ];

    const scored = scoreFormat(pool, DYNASTY_SF, S);
    const deep = scored.find((s) => s.playerId === "deep");
    const shallow = scored.find((s) => s.playerId === "shallow");

    expect(deep?.confidence as number).toBeLessThan(shallow?.confidence as number);
    expect(shallow?.stealScore as number).toBeGreaterThan(deep?.stealScore as number);
    expect(shallow?.category).toBe("steal");
  });

  it("never calls a sub-threshold-confidence player a steal", () => {
    const pool = [
      player({
        playerId: "noisy",
        position: "TE",
        beaconRank: 700,
        marketAdp: 350,
      }),
      ...Array.from({ length: 20 }, (_, i) =>
        player({ playerId: `te${i}`, position: "TE", beaconRank: i + 1, marketAdp: 20 + i * 15 }),
      ),
    ];
    const scored = scoreFormat(pool, DYNASTY_SF, S);
    const noisy = scored.find((s) => s.playerId === "noisy");
    expect(noisy?.confidence as number).toBeLessThan(S.confidence.minConfidence);
    expect(noisy?.category).not.toBe("steal");
  });
});

describe("scoreFormat", () => {
  it("uses the value ladder more in dynasty than in redraft", () => {
    // A player who is a great asset (rank 5) but projects poorly this season:
    // the classic young dynasty piece.
    const pool = [
      player({
        playerId: "young",
        position: "WR",
        beaconRank: 5,
        beaconValue: 8500,
        projectedPoints: 90,
        marketAdp: 60,
      }),
      ...Array.from({ length: 30 }, (_, i) =>
        player({
          playerId: `wr${i}`,
          position: "WR",
          beaconRank: 10 + i * 5,
          beaconValue: 8000 - i * 200,
          projectedPoints: 240 - i * 6,
          marketAdp: 10 + i * 6,
        }),
      ),
    ];
    const dyn = scoreFormat(pool, DYNASTY_SF, S).find((s) => s.playerId === "young");
    const red = scoreFormat(pool, REDRAFT_SF, S).find((s) => s.playerId === "young");
    // Dynasty weights the value ladder at 0.7, so he belongs earlier there.
    expect(dyn?.beaconPick as number).toBeLessThan(red?.beaconPick as number);
  });

  it("scores a player present on only one ladder from that ladder alone", () => {
    const pool = [
      // No projection at all, so he is only on the value ladder. He still gets a
      // pick slot from the market scale; he just gets it from value alone.
      player({ playerId: "valueOnly", position: "WR", beaconRank: 3, beaconValue: 8000, marketAdp: 40 }),
      player({
        playerId: "other",
        position: "WR",
        beaconRank: 1,
        beaconValue: 9000,
        projectedPoints: 250,
        marketAdp: 5,
      }),
    ];
    const scored = scoreFormat(pool, REDRAFT_1QB, S).find((s) => s.playerId === "valueOnly");
    // Second on our ladder, so he takes the second pick slot the market spent.
    expect(scored?.beaconPick).toBe(40);
    expect(scored?.pointsAboveReplacement).toBeNull();
  });

  it("hands out the market's own pick slots, never a bare ladder index", () => {
    // The market spends picks 3, 20 and 140. Whatever our order is, those are
    // the only three numbers beacon_pick may take, so the two sides can never
    // be on different scales.
    const pool = [
      player({ playerId: "a", position: "WR", beaconValue: 100, projectedPoints: 100, marketAdp: 140 }),
      player({ playerId: "b", position: "WR", beaconValue: 300, projectedPoints: 300, marketAdp: 20 }),
      player({ playerId: "c", position: "WR", beaconValue: 200, projectedPoints: 200, marketAdp: 3 }),
    ];
    const scored = scoreFormat(pool, REDRAFT_1QB, S);
    expect(scored.map((s) => s.beaconPick).sort((x, y) => (x as number) - (y as number))).toEqual([
      3, 20, 140,
    ]);
    // Our order is b, c, a, so b takes pick 3 and the market's pick-20 favourite
    // slides to 20 for us.
    expect(scored.find((s) => s.playerId === "b")?.beaconPick).toBe(3);
    expect(scored.find((s) => s.playerId === "a")?.beaconPick).toBe(140);
  });

  it("gives every player a null gap when the market ranks nobody", () => {
    const pool = [
      player({ playerId: "a", position: "WR", beaconValue: 100, projectedPoints: 100 }),
      player({ playerId: "b", position: "WR", beaconValue: 200, projectedPoints: 200 }),
    ];
    const scored = scoreFormat(pool, REDRAFT_1QB, S);
    for (const s of scored) {
      expect(s.beaconPick).toBeNull();
      expect(s.valueGap).toBeNull();
      expect(s.category).toBe("fair");
    }
  });

  it("leaves the gap null when the market has no opinion", () => {
    const scored = scoreFormat(
      [player({ playerId: "a", position: "WR", beaconRank: 10, beaconValue: 100 })],
      REDRAFT_1QB,
      S,
    );
    expect(scored[0].valueGap).toBeNull();
    expect(scored[0].stealScore).toBeNull();
    expect(scored[0].category).toBe("fair");
  });

  it("puts a perfectly priced player at the neutral score", () => {
    const pool = Array.from({ length: 20 }, (_, i) =>
      player({
        playerId: `wr${i}`,
        position: "WR",
        beaconRank: i + 1,
        beaconValue: 9000 - i * 100,
        projectedPoints: 250 - i * 8,
        marketAdp: i + 1,
      }),
    );
    const scored = scoreFormat(pool, REDRAFT_1QB, S);
    for (const s of scored) {
      expect(Math.abs((s.stealScore as number) - 50)).toBeLessThanOrEqual(6);
    }
  });

  it("keeps the ladder stable across identical runs", () => {
    const pool = Array.from({ length: 10 }, (_, i) =>
      player({ playerId: `p${i}`, position: "WR", beaconValue: 100, projectedPoints: 100, marketAdp: 10 }),
    );
    const a = scoreFormat(pool, REDRAFT_1QB, S).map((s) => s.beaconPick);
    const b = scoreFormat(pool, REDRAFT_1QB, S).map((s) => s.beaconPick);
    expect(a).toEqual(b);
  });

  it("returns nothing for an empty pool", () => {
    expect(scoreFormat([], REDRAFT_1QB, S)).toEqual([]);
  });
});

describe("canonicalScoringForFormat", () => {
  it("scores a TE premium exactly off Sleeper's own bonus_rec_te count", () => {
    // Sleeper emits bonus_rec_te as the tight end's projected reception count.
    const statLine = { rec: 4, rec_yd: 50, rec_td: 0.4, bonus_rec_te: 4 };
    const ppr = canonicalScoringForFormat({ scoringType: "ppr", tePremiumBonus: 0 });
    const tep = canonicalScoringForFormat({ scoringType: "ppr", tePremiumBonus: 0.5 });
    const base = scoreStatMap(statLine, ppr) as number;
    const premium = scoreStatMap(statLine, tep) as number;
    expect(premium - base).toBeCloseTo(2, 5); // 4 catches * 0.5
  });

  it("varies receptions by scoring type", () => {
    expect(canonicalScoringForFormat({ scoringType: "ppr", tePremiumBonus: 0 }).rec).toBe(1);
    expect(canonicalScoringForFormat({ scoringType: "half_ppr", tePremiumBonus: 0 }).rec).toBe(0.5);
    expect(canonicalScoringForFormat({ scoringType: "standard", tePremiumBonus: 0 }).rec).toBe(0);
  });
});

describe("mergeDraftValueSettings", () => {
  it("degrades to the code defaults on junk", () => {
    expect(mergeDraftValueSettings(null)).toEqual(S);
    expect(mergeDraftValueSettings("nope")).toEqual(S);
    expect(mergeDraftValueSettings([1, 2])).toEqual(S);
  });

  it("keeps unspecified sections when a partial document is saved", () => {
    const merged = mergeDraftValueSettings({ scoring: { lateRoundPick: 120 } });
    expect(merged.scoring.lateRoundPick).toBe(120);
    expect(merged.scoring.stealSaturationRounds).toBe(S.scoring.stealSaturationRounds);
    expect(merged.confidence).toEqual(S.confidence);
  });

  it("merges starters and flexShare without dropping the other positions", () => {
    const merged = mergeDraftValueSettings({ leagueShape: { teams: 10, starters: { WR: 2 } } });
    expect(merged.leagueShape.teams).toBe(10);
    expect(merged.leagueShape.starters.WR).toBe(2);
    expect(merged.leagueShape.starters.RB).toBe(S.leagueShape.starters.RB);
    expect(merged.leagueShape.flexShare).toEqual(S.leagueShape.flexShare);
  });
});
