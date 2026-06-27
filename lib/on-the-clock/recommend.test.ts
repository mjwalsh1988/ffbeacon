import { describe, it, expect } from "vitest";
import {
  recommend,
  buildSlotModel,
  assignToSlots,
  slotFitFor,
  tallyPositions,
  isSuperflexFormat,
  isTepFormat,
  dstkRecommendable,
  reachScoreFor,
  type RecommendInput,
} from "./recommend";
import { DEFAULT_ON_THE_CLOCK_SETTINGS } from "./default-settings";
import type { OnTheClockSettings } from "./types";
import type { DraftPosition, RankedPlayer } from "./board-types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let idSeq = 0;
function rp(over: Partial<RankedPlayer> = {}): RankedPlayer {
  idSeq += 1;
  return {
    playerId: over.playerId ?? `p${idSeq}`,
    sleeperId: over.sleeperId ?? `s${idSeq}`,
    name: over.name ?? `Player ${idSeq}`,
    position: "RB",
    team: "ATL",
    overallRank: idSeq,
    positionRank: 1,
    tier: 1,
    value: 100,
    isRookie: false,
    ...over,
  };
}

/** Settings with deep overrides for the slices the engine reads. */
function settingsWith(over: Partial<OnTheClockSettings> = {}): OnTheClockSettings {
  return {
    ...DEFAULT_ON_THE_CLOCK_SETTINGS,
    ...over,
    recommendation: { ...DEFAULT_ON_THE_CLOCK_SETTINGS.recommendation, ...over.recommendation },
    dstk: { ...DEFAULT_ON_THE_CLOCK_SETTINGS.dstk, ...over.dstk },
    positionAdjust: { ...DEFAULT_ON_THE_CLOCK_SETTINGS.positionAdjust, ...over.positionAdjust },
    positionFallbackTargets: {
      ...DEFAULT_ON_THE_CLOCK_SETTINGS.positionFallbackTargets,
      ...over.positionFallbackTargets,
    },
  };
}

const STD_SETTINGS = { teams: 12, rounds: 15, slots_qb: 1, slots_rb: 2, slots_wr: 3, slots_te: 1, slots_flex: 1, slots_k: 1, slots_def: 1 };
const SF_SETTINGS = { ...STD_SETTINGS, slots_super_flex: 1 };

function baseInput(over: Partial<RecommendInput> = {}): RecommendInput {
  return {
    available: [],
    pool: "everyone",
    formatSlug: "redraft-ppr-std",
    formatLabel: "Redraft PPR",
    draftSettings: STD_SETTINGS,
    myDraftedPositions: [],
    seededPositions: [],
    rosterKnown: true,
    currentRound: 3,
    settings: settingsWith(),
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Slot / roster model (Task 4)
// ---------------------------------------------------------------------------

describe("buildSlotModel", () => {
  it("reads Sleeper slot counts from draft settings", () => {
    const m = buildSlotModel(SF_SETTINGS, settingsWith());
    expect(m).toEqual({ QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 1, SUPER_FLEX: 1, K: 1, DEF: 1 });
  });

  it("folds slots_rec_flex into FLEX", () => {
    const m = buildSlotModel({ ...STD_SETTINGS, slots_rec_flex: 1 }, settingsWith());
    expect(m.FLEX).toBe(2);
  });

  it("falls back to positionFallbackTargets when no slot keys are present", () => {
    const m = buildSlotModel({ teams: 10, rounds: 12 }, settingsWith());
    expect(m).toEqual(settingsWith().positionFallbackTargets);
  });
});

describe("assignToSlots", () => {
  it("fills dedicated slots first, then FLEX, then SUPER_FLEX", () => {
    const model = buildSlotModel(SF_SETTINGS, settingsWith());
    // have 1 QB, 3 RB, 3 WR, 1 TE: QB fills QB, RB fills 2 RB + 1 spills to FLEX,
    // WR fills 3 WR, TE fills TE; SUPER_FLEX still open.
    const have = tallyPositions(["QB", "RB", "RB", "RB", "WR", "WR", "WR", "TE"]);
    const open = assignToSlots(have, model);
    expect(open.QB).toBe(0);
    expect(open.RB).toBe(0);
    expect(open.WR).toBe(0);
    expect(open.TE).toBe(0);
    expect(open.FLEX).toBe(0); // the 3rd RB took the flex
    expect(open.SUPER_FLEX).toBe(1); // nothing left to fill it
  });

  it("a drafted QB reduces SUPER_FLEX need", () => {
    const model = buildSlotModel(SF_SETTINGS, settingsWith());
    const have = tallyPositions(["QB", "QB"]); // 1 fills QB, 1 spills to SF
    const open = assignToSlots(have, model);
    expect(open.QB).toBe(0);
    expect(open.SUPER_FLEX).toBe(0);
  });
});

describe("slotFitFor", () => {
  const model = buildSlotModel(SF_SETTINGS, settingsWith());
  it("weights a dedicated open slot highest", () => {
    const open = assignToSlots(tallyPositions([]), model);
    expect(slotFitFor("RB", open)).toEqual({ factor: 1, slot: "RB" });
  });
  it("falls to FLEX then SUPER_FLEX", () => {
    const open = assignToSlots(tallyPositions(["RB", "RB", "WR", "WR", "WR", "TE"]), model);
    // RB dedicated full, FLEX still open -> RB fits flex
    expect(slotFitFor("RB", open).slot).toBe("FLEX");
  });
  it("returns bench-only weight when nothing is open", () => {
    const open = assignToSlots(tallyPositions(["QB", "QB", "RB", "RB", "RB", "WR", "WR", "WR", "WR", "TE"]), model);
    const fit = slotFitFor("WR", open);
    expect(fit.factor).toBe(0.25);
    expect(fit.slot).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Format detection
// ---------------------------------------------------------------------------

describe("format detection", () => {
  it("detects superflex from slot model or slug", () => {
    expect(isSuperflexFormat("redraft-ppr-std", buildSlotModel(SF_SETTINGS, settingsWith()))).toBe(true);
    expect(isSuperflexFormat("dynasty-ppr-sflex", buildSlotModel(STD_SETTINGS, settingsWith()))).toBe(true);
    expect(isSuperflexFormat("redraft-ppr-std", buildSlotModel(STD_SETTINGS, settingsWith()))).toBe(false);
  });
  it("detects TE premium from the slug", () => {
    expect(isTepFormat("dynasty-ppr-tep-sflex")).toBe(true);
    expect(isTepFormat("redraft-ppr-std")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Core recommendation behavior (Task 3 + Task 7)
// ---------------------------------------------------------------------------

describe("recommend - Best Available", () => {
  it("is the pure highest-value player regardless of roster", () => {
    idSeq = 0;
    const available = [
      rp({ position: "RB", value: 100, positionRank: 1 }),
      rp({ position: "WR", value: 130, positionRank: 1 }),
      rp({ position: "QB", value: 90, positionRank: 1 }),
    ];
    const res = recommend(baseInput({ available }));
    expect(res.best.player?.value).toBe(130);
    expect(res.best.decidingFactor).toBe("value");
  });
});

describe("recommend - Team Need differs from Best Available", () => {
  it("points to a needed position when the top value sits at a saturated spot", () => {
    idSeq = 0;
    // Top value is a WR, but the user is full at WR (3 dedicated + the flex), so the
    // best WR is bench-only depth, while RB and TE slots are wide open.
    const available = [
      rp({ playerId: "wr", position: "WR", value: 130, positionRank: 5, tier: 2 }),
      rp({ playerId: "rb", position: "RB", value: 120, positionRank: 4, tier: 2 }),
      rp({ playerId: "te", position: "TE", value: 60, positionRank: 8, tier: 5 }),
    ];
    const res = recommend(
      baseInput({
        available,
        draftSettings: STD_SETTINGS,
        formatSlug: "redraft-ppr-std",
        myDraftedPositions: ["WR", "WR", "WR", "WR", "QB"], // WR dedicated + flex full
      }),
    );
    expect(res.best.player?.playerId).toBe("wr"); // pure value
    expect(res.need.player?.playerId).toBe("rb"); // value-aware need
    expect(res.need.player).not.toBe(res.best.player);
    expect(res.aligned).toBe(false);
  });
});

describe("recommend - format multipliers", () => {
  it("superflex boosts QB priority (equal value, otherwise a tie)", () => {
    idSeq = 0;
    // Equal-value QB and WR, both filling an open dedicated slot. In a 1QB league
    // the deterministic tie-break favors the lower id (the WR); in superflex the QB
    // multiplier breaks the tie toward the QB.
    const players = () => [
      rp({ playerId: "aaa-wr", position: "WR", value: 100, positionRank: 1, tier: 1 }),
      rp({ playerId: "zzz-qb", position: "QB", value: 100, positionRank: 1, tier: 1 }),
    ];
    const oneQb = recommend(baseInput({ available: players(), draftSettings: STD_SETTINGS, formatSlug: "redraft-ppr-std" }));
    const sf = recommend(baseInput({ available: players(), draftSettings: SF_SETTINGS, formatSlug: "redraft-ppr-sflex" }));
    expect(oneQb.need.player?.playerId).toBe("aaa-wr");
    expect(sf.need.player?.playerId).toBe("zzz-qb");
  });

  it("TE premium boosts TE priority (equal value, otherwise a tie)", () => {
    idSeq = 0;
    const players = () => [
      rp({ playerId: "aaa-wr", position: "WR", value: 100, positionRank: 1, tier: 1 }),
      rp({ playerId: "zzz-te", position: "TE", value: 100, positionRank: 1, tier: 1 }),
    ];
    const noTep = recommend(baseInput({ available: players(), draftSettings: SF_SETTINGS, formatSlug: "dynasty-ppr-sflex" }));
    const tep = recommend(baseInput({ available: players(), draftSettings: SF_SETTINGS, formatSlug: "dynasty-ppr-tep-sflex" }));
    expect(noTep.need.player?.playerId).toBe("aaa-wr");
    expect(tep.need.player?.playerId).toBe("zzz-te");
  });
});

describe("recommend - empty rooms create need without forcing terrible value", () => {
  it("an empty RB/WR/TE room still recommends a sensible, not bottom-tier, player", () => {
    idSeq = 0;
    const available = [
      rp({ position: "RB", value: 120, positionRank: 1, tier: 1 }),
      rp({ position: "WR", value: 118, positionRank: 1, tier: 1 }),
      rp({ position: "TE", value: 40, positionRank: 10, tier: 6 }), // weak TE
    ];
    const res = recommend(baseInput({ available, myDraftedPositions: [] }));
    // Even though TE is an open slot, the engine should not force the bottom-tier TE
    // over strong RB/WR value; the need pick stays a high-value player.
    expect(res.need.player?.position).not.toBe("TE");
    expect(res.need.player?.value).toBeGreaterThanOrEqual(118);
  });
});

describe("recommend - rookie pool", () => {
  it("runs without crashing on a rookies-only pool", () => {
    idSeq = 0;
    const available = [
      rp({ position: "RB", value: 90, isRookie: true, positionRank: 1 }),
      rp({ position: "WR", value: 95, isRookie: true, positionRank: 1 }),
    ];
    const res = recommend(baseInput({ available, pool: "rookies" }));
    expect(res.need.player).not.toBeNull();
    expect(res.best.player?.value).toBe(95);
  });
});

describe("recommend - seeded roster counts toward need", () => {
  it("dynasty seeded QBs reduce QB need so a non-QB wins", () => {
    idSeq = 0;
    // Equal-value QB and RB in superflex. With no seed the QB multiplier + open SF
    // slot make the QB the need pick; once the seeded roster already carries 2 QBs
    // (filling QB + SF), the QB is bench-only and the RB becomes the need.
    const players = () => [
      rp({ playerId: "qb", position: "QB", value: 100, positionRank: 1, tier: 1 }),
      rp({ playerId: "rb", position: "RB", value: 100, positionRank: 1, tier: 1 }),
    ];
    const noSeed = recommend(
      baseInput({ available: players(), draftSettings: SF_SETTINGS, formatSlug: "dynasty-ppr-sflex" }),
    );
    const withSeed = recommend(
      baseInput({
        available: players(),
        draftSettings: SF_SETTINGS,
        formatSlug: "dynasty-ppr-sflex",
        seededPositions: ["QB", "QB"],
      }),
    );
    expect(noSeed.need.player?.playerId).toBe("qb");
    expect(withSeed.need.player?.playerId).toBe("rb");
  });
});

describe("recommend - drafted players are never recommended", () => {
  it("only considers the available pool the caller passes in", () => {
    idSeq = 0;
    // The caller has already excluded the drafted stud; the engine cannot resurrect it.
    const available = [rp({ playerId: "left", position: "RB", value: 50, positionRank: 20 })];
    const res = recommend(baseInput({ available }));
    expect(res.best.player?.playerId).toBe("left");
    expect(res.need.player?.playerId).toBe("left");
  });
});

// ---------------------------------------------------------------------------
// DST/K gating (Task 5 + Task 7)
// ---------------------------------------------------------------------------

describe("dstkRecommendable", () => {
  const model = buildSlotModel(STD_SETTINGS, settingsWith());
  const have = tallyPositions([]);

  it("suppresses K/DEF in early/middle rounds (default behavior)", () => {
    expect(dstkRecommendable("DEF", { settings: settingsWith(), currentRound: 3, model, have })).toBe(false);
    expect(dstkRecommendable("K", { settings: settingsWith(), currentRound: 5, model, have })).toBe(false);
  });

  it("allows DEF late when the slot is required and the team lacks one", () => {
    expect(dstkRecommendable("DEF", { settings: settingsWith(), currentRound: 11, model, have })).toBe(true);
  });

  it("does not recommend DEF late if the team already has one", () => {
    const haveDef = tallyPositions(["DEF"]);
    expect(dstkRecommendable("DEF", { settings: settingsWith(), currentRound: 11, model, have: haveDef })).toBe(false);
  });

  it("never recommends under the 'never' behavior", () => {
    const s = settingsWith({ dstk: { ...DEFAULT_ON_THE_CLOCK_SETTINGS.dstk, recommendBehavior: "never" } });
    expect(dstkRecommendable("DEF", { settings: s, currentRound: 14, model, have })).toBe(false);
  });

  it("always recommends under 'always_allowed'", () => {
    const s = settingsWith({ dstk: { ...DEFAULT_ON_THE_CLOCK_SETTINGS.dstk, recommendBehavior: "always_allowed" } });
    expect(dstkRecommendable("K", { settings: s, currentRound: 1, model, have })).toBe(true);
  });
});

describe("recommend - K/DEF gating end to end", () => {
  it("includes K/DEF in Best Available but never in early Team Need", () => {
    idSeq = 0;
    // A high-value DEF (contrived) plus a normal skill player, early round.
    const available = [
      rp({ playerId: "def", position: "DEF", value: 200, positionRank: 1, tier: 1 }),
      rp({ playerId: "rb", position: "RB", value: 120, positionRank: 1, tier: 1 }),
    ];
    const res = recommend(baseInput({ available, currentRound: 2 }));
    expect(res.best.player?.playerId).toBe("def"); // pure value can surface it
    expect(res.need.player?.position).not.toBe("DEF"); // need gates it out early
    expect(res.need.player?.playerId).toBe("rb");
  });

  it("recommends DEF late only when roster rules require it and the team lacks one", () => {
    idSeq = 0;
    const available = [rp({ playerId: "def", position: "DEF", value: 30, positionRank: 1, tier: 1 })];
    // Late round, no skill players left, team has no DEF, league requires DEF.
    const res = recommend(baseInput({ available, currentRound: 12, myDraftedPositions: [] }));
    expect(res.need.player?.position).toBe("DEF");
  });
});

// ---------------------------------------------------------------------------
// Graceful degrade (Task 6 fallback)
// ---------------------------------------------------------------------------

describe("recommend - graceful degrade", () => {
  it("missing roster settings fall back to fallback targets without crashing", () => {
    idSeq = 0;
    const available = [
      rp({ position: "RB", value: 100, positionRank: 1 }),
      rp({ position: "WR", value: 95, positionRank: 1 }),
    ];
    const res = recommend(baseInput({ available, draftSettings: { teams: 12 } }));
    expect(res.need.player).not.toBeNull();
  });

  it("uses the no-edge fallback copy when the roster is unknown", () => {
    idSeq = 0;
    const available = [rp({ position: "RB", value: 100, positionRank: 1 })];
    const res = recommend(baseInput({ available, rosterKnown: false, myDraftedPositions: [], seededPositions: [] }));
    expect(res.rosterKnown).toBe(false);
    expect(res.need.decidingFactor).toBe("none");
    expect(res.need.reason).toMatch(/no clear roster-need edge/i);
  });

  it("returns empty cards on an empty pool", () => {
    const res = recommend(baseInput({ available: [] }));
    expect(res.best.player).toBeNull();
    expect(res.need.player).toBeNull();
  });

  it("respects the teamNeedEnabled master toggle", () => {
    idSeq = 0;
    const available = [rp({ position: "RB", value: 100, positionRank: 1 })];
    const s = settingsWith({
      recommendation: { ...DEFAULT_ON_THE_CLOCK_SETTINGS.recommendation, teamNeedEnabled: false },
    });
    const res = recommend(baseInput({ available, settings: s }));
    expect(res.best.player).not.toBeNull(); // Best Available always renders
    expect(res.need.player).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Aligned cards + reach
// ---------------------------------------------------------------------------

describe("recommend - aligned", () => {
  it("flags alignment when the top value is also the top need", () => {
    idSeq = 0;
    const available = [
      rp({ playerId: "rb", position: "RB", value: 150, positionRank: 1, tier: 1 }),
      rp({ playerId: "wr", position: "WR", value: 80, positionRank: 5, tier: 4 }),
    ];
    const res = recommend(baseInput({ available, myDraftedPositions: [] }));
    expect(res.best.player?.playerId).toBe("rb");
    expect(res.need.player?.playerId).toBe("rb");
    expect(res.aligned).toBe(true);
    expect(res.need.reason).toMatch(/value on the board is also your biggest roster need/i);
  });
});

describe("reachScoreFor", () => {
  it("is zero for the best player at a position", () => {
    idSeq = 0;
    const pool = [rp({ position: "RB", value: 100, tier: 1 }), rp({ position: "RB", value: 90, tier: 1 })];
    expect(reachScoreFor(pool[0], pool, 1)).toBe(0);
  });
  it("is positional, not global: a needed QB is not penalized for an unrelated top WR", () => {
    idSeq = 0;
    const wr = rp({ position: "WR", value: 200, tier: 1 });
    const qb = rp({ position: "QB", value: 90, tier: 1 });
    const pool = [wr, qb];
    expect(reachScoreFor(qb, pool, 1)).toBe(0); // QB is the best QB; no reach
  });
  it("bites only beyond the tier-break gate", () => {
    idSeq = 0;
    const top = rp({ position: "RB", value: 100, tier: 1 });
    const deep = rp({ position: "RB", value: 40, tier: 4 });
    const pool = [top, deep];
    // tiersBelow = 4 - 1 - 1 = 2 -> 50 reach points
    expect(reachScoreFor(deep, pool, 1)).toBe(50);
  });
});
