import { describe, it, expect } from "vitest";
import {
  buildTradeCatalog,
  analyzeTradeSides,
  bucketSlot,
  futureDiscount,
  FALLBACK_PICK_VALUE,
  type TradeCatalogInput,
  type TradeItemOption,
} from "./trade-analyzer";
import { draftShapeFromMeta } from "./draft-derive";
import { resolveCurrentDraftPicks, resolveTradedFuturePicks } from "./pick-ownership";
import type { ShapedDraftCache, ShapedPick } from "./types";
import type { PickBucketValue, RankedPlayer } from "./board-types";

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
    overallRank: over.overallRank ?? idSeq,
    positionRank: 1,
    tier: 1,
    value: 100,
    isRookie: false,
    ...over,
  };
}

/** A descending-value board of N players. */
function board(n: number, opts: { rookie?: boolean; startValue?: number; step?: number } = {}): RankedPlayer[] {
  const startValue = opts.startValue ?? 10000;
  const step = opts.step ?? 100;
  return Array.from({ length: n }, (_, i) =>
    rp({
      playerId: `b${i}`,
      sleeperId: `sb${i}`,
      name: `Board ${i}`,
      overallRank: i + 1,
      value: startValue - i * step,
      isRookie: opts.rookie ?? false,
    }),
  );
}

const FUTURE_PICK_SEASONS = [2027, 2028];
const FUTURE_PICK_ROUNDS = [1, 2, 3, 4];
const FUTURE_PICK_BUCKETS = ["early", "mid", "late"] as const;

/** Distinct, deterministic FF Beacon pick value per (season, round, bucket). */
function pickValueFor(season: number, round: number, bucket: "early" | "mid" | "late"): number {
  const bucketAdj = bucket === "early" ? 0 : bucket === "mid" ? 200 : 400;
  return 8000 - (season - 2027) * 1000 - (round - 1) * 700 - bucketAdj;
}

/** A full FF Beacon pick-value set: 2 seasons x 4 rounds x 3 buckets = 24 rows. */
function pickValues(): PickBucketValue[] {
  const out: PickBucketValue[] = [];
  for (const season of FUTURE_PICK_SEASONS) {
    for (const round of FUTURE_PICK_ROUNDS) {
      for (const bucket of FUTURE_PICK_BUCKETS) {
        out.push({ season, round, bucket, value: pickValueFor(season, round, bucket) });
      }
    }
  }
  return out;
}

function madePick(pickNo: number, over: Partial<ShapedPick> = {}): ShapedPick {
  return {
    pickNo,
    round: 1,
    draftSlot: pickNo,
    rosterId: pickNo,
    pickedBy: `u${pickNo}`,
    sleeperPlayerId: null,
    playerId: null,
    isKeeper: false,
    firstName: "First",
    lastName: `Last${pickNo}`,
    position: "RB",
    team: "ATL",
    ...over,
  };
}

const SHAPE = draftShapeFromMeta({
  draftType: "snake",
  settings: { teams: 12, rounds: 15 },
} as unknown as ShapedDraftCache["draft"]);

/** 1:1 slot -> roster for a 12-team draft. */
const SLOT_TO_ROSTER: Record<string, number> = Object.fromEntries(
  Array.from({ length: 12 }, (_, i) => [String(i + 1), i + 1]),
);

const TEAM_NAMES: Record<number, string> = Object.fromEntries(
  Array.from({ length: 12 }, (_, i) => [i + 1, `Team ${i + 1}`]),
);

function catalogInput(over: Partial<TradeCatalogInput> = {}): TradeCatalogInput {
  const b = over.available ?? board(60);
  const currentPicks =
    over.currentPicks ??
    resolveCurrentDraftPicks({
      teams: 12,
      rounds: 15,
      shape: SHAPE,
      slotToRosterId: SLOT_TO_ROSTER,
      madePicks: [],
      tradedPicks: [],
      currentSeason: 2026,
    });
  return {
    mode: "startup",
    pool: "everyone",
    available: b,
    poolBoard: over.poolBoard ?? b,
    valueBoard: over.valueBoard ?? b,
    currentPicks,
    tradedFuturePicks: over.tradedFuturePicks ?? [],
    futurePickValues: over.futurePickValues ?? pickValues(),
    teamNameByRosterId: over.teamNameByRosterId ?? TEAM_NAMES,
    myRosterId: over.myRosterId ?? 5,
    draftSettings: { teams: 12, rounds: 15 },
    onTheClockPickNo: 13,
    currentSeason: 2026,
    ...over,
  };
}

function opt(value: number, over: Partial<TradeItemOption> = {}): TradeItemOption {
  return { id: `o${value}`, label: `Asset ${value}`, value, kind: "player", estimated: false, ...over };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

describe("bucketSlot / futureDiscount", () => {
  it("maps early/mid/late to ascending seats", () => {
    expect(bucketSlot("early", 12)).toBeLessThan(bucketSlot("mid", 12));
    expect(bucketSlot("mid", 12)).toBeLessThan(bucketSlot("late", 12));
  });
  it("discounts further-out seasons more", () => {
    expect(futureDiscount(0)).toBe(1);
    expect(futureDiscount(1)).toBeGreaterThan(futureDiscount(2));
  });
});

// ---------------------------------------------------------------------------
// analyzeTradeSides
// ---------------------------------------------------------------------------

describe("analyzeTradeSides", () => {
  it("returns the empty state with nothing placed", () => {
    expect(analyzeTradeSides([], []).lean).toBe("empty");
  });
  it("sums player-for-player totals", () => {
    const r = analyzeTradeSides([opt(100), opt(50)], [opt(140)]);
    expect(r.totalA).toBe(150);
    expect(r.totalB).toBe(140);
  });
  it("calls a within-5% trade fair", () => {
    expect(analyzeTradeSides([opt(100)], [opt(98)]).lean).toBe("fair");
  });
  it("calls a 5-15% gap a slight edge", () => {
    expect(analyzeTradeSides([opt(110)], [opt(100)]).lean).toBe("a-lean");
  });
  it("calls a >15% gap a strong edge", () => {
    expect(analyzeTradeSides([opt(100)], [opt(200)]).lean).toBe("b-strong");
  });
  it("flags estimates", () => {
    expect(analyzeTradeSides([opt(100, { estimated: true })], [opt(100)]).hasEstimates).toBe(true);
  });
  it("DEF/K assets are summed at face value, no boost", () => {
    const def = opt(300, { label: "Ravens, DEF" });
    const r = analyzeTradeSides([def], [opt(300)]);
    expect(r.totalA).toBe(300);
    expect(r.lean).toBe("fair");
  });
});

// ---------------------------------------------------------------------------
// buildTradeCatalog - includes ALL current draft picks (6C.1 core fix)
// ---------------------------------------------------------------------------

describe("buildTradeCatalog - all current draft picks", () => {
  it("startup mode offers picks only, never the available player pool", () => {
    idSeq = 0;
    const b = board(60);
    const made = [madePick(1, { playerId: "b0" }), madePick(2, { playerId: "b1" })];
    const currentPicks = resolveCurrentDraftPicks({
      teams: 12,
      rounds: 15,
      shape: SHAPE,
      slotToRosterId: SLOT_TO_ROSTER,
      madePicks: made,
      tradedPicks: [],
      currentSeason: 2026,
    });
    const groups = buildTradeCatalog(catalogInput({ available: b, poolBoard: b, valueBoard: b, currentPicks }));
    const labels = groups.map((g) => g.label);
    // Startup drafts trade picks, not players: no player pool group at all.
    expect(labels).not.toContain("Available players");
    expect(labels).not.toContain("Rookie players");
    expect(groups.some((g) => g.options.some((o) => o.kind === "player"))).toBe(false);
    expect(labels).toContain("Made picks");
    expect(labels).toContain("Upcoming picks");
    expect(labels).toContain("Future pick buckets");
  });

  it("includes upcoming picks owned by other teams, not just the connected user", () => {
    idSeq = 0;
    const b = board(60);
    const groups = buildTradeCatalog(catalogInput({ available: b, poolBoard: b, valueBoard: b, myRosterId: 5 }));
    const upcoming = groups.find((g) => g.label === "Upcoming picks")!;
    const owners = new Set(upcoming.options.map((o) => o.detail));
    // More than one owner appears across the upcoming picks (all 12 teams' picks).
    expect(upcoming.options.length).toBeGreaterThan(12);
    expect(owners.size).toBeGreaterThan(1);
    expect(upcoming.options.some((o) => /Your pick/.test(o.detail ?? ""))).toBe(true);
    expect(upcoming.options.some((o) => /Team \d/.test(o.detail ?? ""))).toBe(true);
  });

  it("lists picks in natural overall order, not the connected user's picks first", () => {
    idSeq = 0;
    const b = board(60);
    // myRosterId 9 owns seat 9 (pick 1.09); it must NOT bubble to the top.
    const groups = buildTradeCatalog(catalogInput({ available: b, poolBoard: b, valueBoard: b, myRosterId: 9 }));
    const upcoming = groups.find((g) => g.label === "Upcoming picks")!;
    const firstFour = upcoming.options.slice(0, 4).map((o) => o.label);
    expect(firstFour[0]).toMatch(/^1\.01 /);
    expect(firstFour[1]).toMatch(/^1\.02 /);
    expect(firstFour[2]).toMatch(/^1\.03 /);
    expect(firstFour[3]).toMatch(/^1\.04 /);
  });

  it("marks generic future buckets repeatable but exact slots unique", () => {
    idSeq = 0;
    const b = board(60);
    const made = [madePick(1, { playerId: "b0" })];
    const currentPicks = resolveCurrentDraftPicks({
      teams: 12,
      rounds: 15,
      shape: SHAPE,
      slotToRosterId: SLOT_TO_ROSTER,
      madePicks: made,
      tradedPicks: [],
      currentSeason: 2026,
    });
    const groups = buildTradeCatalog(catalogInput({ available: b, poolBoard: b, valueBoard: b, currentPicks }));
    const future = groups.find((g) => g.label === "Future pick buckets")!;
    const upcoming = groups.find((g) => g.label === "Upcoming picks")!;
    const madeGrp = groups.find((g) => g.label === "Made picks")!;
    expect(future.options.every((o) => o.repeatable === true)).toBe(true);
    expect(upcoming.options.every((o) => !o.repeatable)).toBe(true);
    expect(madeGrp.options.every((o) => !o.repeatable)).toBe(true);
  });
});

describe("buildTradeCatalog - already-made pick valuation (Task 5)", () => {
  it("values a made pick by the selected player's FF Beacon value (not estimated)", () => {
    idSeq = 0;
    const b = board(60); // b0 has value 10000
    const made = [madePick(3, { playerId: "b0", firstName: "JaMarr", lastName: "Chase", position: "WR" })];
    const currentPicks = resolveCurrentDraftPicks({
      teams: 12,
      rounds: 15,
      shape: SHAPE,
      slotToRosterId: SLOT_TO_ROSTER,
      madePicks: made,
      tradedPicks: [],
      currentSeason: 2026,
    });
    const groups = buildTradeCatalog(catalogInput({ available: b, poolBoard: b, valueBoard: b, currentPicks }));
    const madeGroup = groups.find((g) => g.label === "Made picks")!;
    const chase = madeGroup.options[0];
    expect(chase.value).toBe(10000);
    expect(chase.estimated).toBe(false);
    expect(chase.label).toMatch(/Chase/);
  });

  it("falls back to a graceful unavailable/estimated state for an unmapped made pick", () => {
    idSeq = 0;
    const b = board(60);
    const made = [madePick(3, { playerId: "not-on-board", sleeperPlayerId: "9999", firstName: "Ghost", lastName: "Player" })];
    const currentPicks = resolveCurrentDraftPicks({
      teams: 12,
      rounds: 15,
      shape: SHAPE,
      slotToRosterId: SLOT_TO_ROSTER,
      madePicks: made,
      tradedPicks: [],
      currentSeason: 2026,
    });
    const groups = buildTradeCatalog(catalogInput({ available: b, poolBoard: b, valueBoard: b, currentPicks }));
    const madeGroup = groups.find((g) => g.label === "Made picks")!;
    const ghost = madeGroup.options[0];
    expect(ghost.value).toBe(0);
    expect(ghost.estimated).toBe(true);
    expect(ghost.detail).toMatch(/value unavailable/i);
  });
});

describe("buildTradeCatalog - upcoming pick projection (Task 6)", () => {
  it("projects an upcoming pick from the post-exclusion available board", () => {
    idSeq = 0;
    const avail = board(40, { startValue: 5000 }); // best available 5000
    const groups = buildTradeCatalog(catalogInput({ available: avail, poolBoard: avail, valueBoard: avail }));
    const upcoming = groups.find((g) => g.label === "Upcoming picks")!;
    for (const o of upcoming.options) {
      expect(o.estimated).toBe(true);
      // No projected pick exceeds the best available value (drafted players excluded).
      expect(o.value).toBeLessThanOrEqual(5000);
    }
  });
});

describe("buildTradeCatalog - future picks (Task 7)", () => {
  it("values generic future buckets from FF Beacon pick values, not estimated", () => {
    idSeq = 0;
    const b = board(60);
    const groups = buildTradeCatalog(catalogInput({ available: b, poolBoard: b, valueBoard: b, currentSeason: 2026 }));
    const future = groups.find((g) => g.label === "Future pick buckets")!;
    // 2 seasons x 4 rounds x 3 buckets = 24 buckets, all real FF Beacon values.
    expect(future.options.length).toBe(24);
    for (const o of future.options) expect(o.estimated).toBe(false);
    const early = future.options.find((o) => o.id === "fut-2027-1-early")!;
    expect(early.value).toBe(pickValueFor(2027, 1, "early"));
    expect(early.detail).toBe("FF Beacon pick value");
  });

  it("includes 1st through 4th round future picks", () => {
    idSeq = 0;
    const b = board(60);
    const groups = buildTradeCatalog(catalogInput({ available: b, poolBoard: b, valueBoard: b, currentSeason: 2026 }));
    const future = groups.find((g) => g.label === "Future pick buckets")!;
    const ids = new Set(future.options.map((o) => o.id));
    for (const round of [1, 2, 3, 4]) {
      expect(ids.has(`fut-2027-${round}-mid`)).toBe(true);
      expect(ids.has(`fut-2028-${round}-mid`)).toBe(true);
    }
  });

  it("hides future buckets when FF Beacon has no pick values (e.g. redraft)", () => {
    idSeq = 0;
    const b = board(60);
    const groups = buildTradeCatalog(
      catalogInput({ available: b, poolBoard: b, valueBoard: b, futurePickValues: [] }),
    );
    expect(groups.find((g) => g.label === "Future pick buckets")).toBeFalsy();
  });

  it("adds an owner-aware Traded future picks group valued from FF Beacon, not estimated", () => {
    idSeq = 0;
    const b = board(60);
    const tradedFuturePicks = resolveTradedFuturePicks(
      [{ season: 2027, round: 1, originalRosterId: 3, currentOwnerRosterId: 5 }],
      2026,
    );
    const groups = buildTradeCatalog(
      catalogInput({ available: b, poolBoard: b, valueBoard: b, tradedFuturePicks, myRosterId: 5 }),
    );
    const traded = groups.find((g) => g.label === "Traded future picks")!;
    expect(traded.options.length).toBe(1);
    expect(traded.options[0].label).toMatch(/2027 1st - Your pick/);
    expect(traded.options[0].value).toBe(pickValueFor(2027, 1, "mid"));
    expect(traded.options[0].estimated).toBe(false);
  });
});

describe("buildTradeCatalog - rookie mode", () => {
  it("offers rookie players and rookie picks", () => {
    idSeq = 0;
    const rookies = board(24, { rookie: true });
    const groups = buildTradeCatalog(
      catalogInput({ mode: "rookie", pool: "rookies", available: rookies, poolBoard: rookies, valueBoard: rookies }),
    );
    const labels = groups.map((g) => g.label);
    expect(labels).toContain("Rookie players");
    // pick groups are still Made / Upcoming (kind = rookie-pick under the hood).
    expect(labels).toContain("Upcoming picks");
    const upcoming = groups.find((g) => g.label === "Upcoming picks")!;
    expect(upcoming.options.every((o) => o.kind === "rookie-pick")).toBe(true);
  });
});

describe("buildTradeCatalog - values are always whole numbers", () => {
  it("rounds fractional player, made-pick, and upcoming-pick values to integers", () => {
    idSeq = 0;
    // A board whose values carry decimals (e.g. 5123.4, 5023.4, ...).
    const avail = board(40, { startValue: 5123.4, step: 100 });
    const made = [madePick(3, { playerId: "b0", firstName: "Deci", lastName: "Mal", position: "WR" })];
    const currentPicks = resolveCurrentDraftPicks({
      teams: 12,
      rounds: 15,
      shape: SHAPE,
      slotToRosterId: SLOT_TO_ROSTER,
      madePicks: made,
      tradedPicks: [],
      currentSeason: 2026,
    });
    const groups = buildTradeCatalog(
      catalogInput({ mode: "rookie", pool: "rookies", available: avail, poolBoard: avail, valueBoard: avail, currentPicks }),
    );
    for (const g of groups) {
      for (const o of g.options) {
        expect(Number.isInteger(o.value)).toBe(true);
      }
    }
    // b0's fractional value 5123.4 rounds to 5123 for the made pick.
    const madeGroup = groups.find((gr) => gr.label === "Made picks")!;
    expect(madeGroup.options[0].value).toBe(5123);
  });

  it("keeps side totals whole when summing rounded option values", () => {
    idSeq = 0;
    const avail = board(40, { startValue: 4999.6, step: 250 });
    const groups = buildTradeCatalog(
      catalogInput({ mode: "rookie", pool: "rookies", available: avail, poolBoard: avail, valueBoard: avail }),
    );
    const options = groups.flatMap((g) => g.options);
    const result = analyzeTradeSides(options.slice(0, 3), options.slice(3, 5));
    expect(Number.isInteger(result.totalA)).toBe(true);
    expect(Number.isInteger(result.totalB)).toBe(true);
  });
});

describe("buildTradeCatalog - shapes + edges", () => {
  it("works for linear and 3RR without crashing", () => {
    idSeq = 0;
    const linear = draftShapeFromMeta({ draftType: "linear", settings: { teams: 12, rounds: 15 } } as unknown as ShapedDraftCache["draft"]);
    const trr = draftShapeFromMeta({ draftType: "snake", settings: { teams: 12, rounds: 15, reversal_round: 3 } } as unknown as ShapedDraftCache["draft"]);
    for (const shape of [linear, trr]) {
      const currentPicks = resolveCurrentDraftPicks({
        teams: 12,
        rounds: 15,
        shape,
        slotToRosterId: SLOT_TO_ROSTER,
        madePicks: [],
        tradedPicks: [],
        currentSeason: 2026,
      });
      expect(() => buildTradeCatalog(catalogInput({ currentPicks }))).not.toThrow();
    }
  });

  it("returns no groups when there is no board at all", () => {
    expect(buildTradeCatalog(catalogInput({ available: [], poolBoard: [], valueBoard: [] }))).toEqual([]);
  });

  it("values future buckets from FF Beacon data regardless of board size", () => {
    idSeq = 0;
    // A 1-player board cannot project deep slots, but future picks no longer depend
    // on the board: they read FF Beacon pick values, so they are still fully valued.
    const tiny = board(1);
    const groups = buildTradeCatalog(catalogInput({ available: tiny, poolBoard: tiny, valueBoard: tiny }));
    const future = groups.find((g) => g.label === "Future pick buckets")!;
    expect(future.options.length).toBe(24);
    for (const o of future.options) expect(o.value).toBeGreaterThan(0);
    // The board-projection floor is retained only for upcoming current-draft picks.
    expect(FALLBACK_PICK_VALUE).toBeGreaterThan(0);
  });

  it("still builds a full catalog when traded picks are empty (partial-sync safe)", () => {
    idSeq = 0;
    const b = board(60);
    const groups = buildTradeCatalog(catalogInput({ available: b, poolBoard: b, valueBoard: b, tradedFuturePicks: [] }));
    expect(groups.find((g) => g.label === "Upcoming picks")).toBeTruthy();
    expect(groups.find((g) => g.label === "Traded future picks")).toBeFalsy();
  });
});
