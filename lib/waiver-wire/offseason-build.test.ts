import { describe, expect, it } from "vitest";
import {
  FANTASY_LAST_WEEK,
  STORED_PER_POSITION,
  foldPickupCounts,
  medianOf,
  offseasonSeasonFor,
  pickupCost,
  pointsAfter,
  poolBids,
  qualifyingLeagues,
  scoredPoints,
  selectStored,
  showcaseDue,
  typicalWeek,
  type PickupAggregate,
  type ShowcaseEntry,
} from "./offseason-build";

describe("offseasonSeasonFor", () => {
  it("is the season just played once its regular season is over", () => {
    expect(offseasonSeasonFor({ season: 2026, currentWeek: 19 })).toBe(2026);
  });

  it("is null during the season and in the preseason", () => {
    expect(offseasonSeasonFor({ season: 2026, currentWeek: 18 })).toBeNull();
    expect(offseasonSeasonFor({ season: 2027, currentWeek: 1 })).toBeNull();
  });

  it("is null with no season at all", () => {
    expect(offseasonSeasonFor({ season: null, currentWeek: 1 })).toBeNull();
  });
});

describe("showcaseDue", () => {
  const now = Date.parse("2027-02-10T12:00:00Z");
  it("is due with nothing stored", () => expect(showcaseDue(null, now)).toBe(true));
  it("is not due inside a week", () => expect(showcaseDue("2027-02-05T12:00:00Z", now)).toBe(false));
  it("is due after a week", () => expect(showcaseDue("2027-02-02T12:00:00Z", now)).toBe(true));
  it("is due for an unreadable stamp", () => expect(showcaseDue("garbage", now)).toBe(true));
});

describe("foldPickupCounts and typicalWeek", () => {
  it("adds batches together per player and week", () => {
    const acc = new Map<string, PickupAggregate>();
    foldPickupCounts(acc, [
      ["100", 3, 4, 3, 1],
      ["100", 5, 2, 2, 0],
    ]);
    foldPickupCounts(acc, [["100", 3, 1, 0, 1]]);
    const agg = acc.get("100")!;
    expect(agg.leagues).toBe(7);
    expect(agg.viaWaiver).toBe(5);
    expect(agg.viaFreeAgent).toBe(2);
    expect(agg.weekCounts.get(3)).toBe(5);
    expect(typicalWeek(agg.weekCounts)).toBe(3);
  });

  it("ignores malformed rows", () => {
    const acc = new Map<string, PickupAggregate>();
    foldPickupCounts(acc, [
      ["", 3, 4, 3, 1],
      ["7", 2.5, 4, 3, 1],
      ["8", 2, 0, 0, 0],
    ] as never);
    expect(acc.size).toBe(0);
  });

  it("breaks a tie toward the earlier week", () => {
    expect(typicalWeek(new Map([[9, 4], [4, 4], [12, 1]]))).toBe(4);
  });

  it("is null with no weeks", () => {
    expect(typicalWeek(new Map())).toBeNull();
  });
});

describe("qualifyingLeagues", () => {
  it("is five percent of the season's leagues", () => {
    expect(qualifyingLeagues(1426)).toBe(72);
  });
  it("is never fewer than five", () => {
    expect(qualifyingLeagues(20)).toBe(5);
  });
});

describe("pointsAfter", () => {
  const lines = [
    { week: 2, gp: 1, ppr: 30, half: 25, std: 20, rec: 10 },
    { week: 5, gp: 1, ppr: 12.4, half: 10.4, std: 8.4, rec: 4 },
    { week: 6, gp: 1, ppr: null, half: null, std: null, rec: 0 },
    { week: 7, gp: 0, ppr: 99, half: 99, std: 99, rec: 9 },
    { week: FANTASY_LAST_WEEK + 1, gp: 1, ppr: 40, half: 40, std: 40, rec: 9 },
  ];

  it("counts from the pickup week through week 17 only", () => {
    expect(pointsAfter(lines, 5)).toEqual({ ppr: 12.4, half: 10.4, std: 8.4, rec: 4, games: 2 });
  });

  it("treats null points on a played game as zero and skips unplayed weeks", () => {
    const out = pointsAfter(lines, 6);
    expect(out.games).toBe(1);
    expect(out.ppr).toBe(0);
  });
});

describe("scoredPoints", () => {
  const entry = { points: { ppr: 100, half: 80, std: 60, rec: 40, games: 10 } };
  it("reads the format's scoring", () => {
    expect(scoredPoints(entry, "ppr", 0, false)).toBe(100);
    expect(scoredPoints(entry, "half_ppr", 0, false)).toBe(80);
    expect(scoredPoints(entry, "standard", 0, false)).toBe(60);
  });
  it("adds a tight end premium per reception, for tight ends only", () => {
    expect(scoredPoints(entry, "ppr", 0.5, true)).toBe(120);
    expect(scoredPoints(entry, "ppr", 0.5, false)).toBe(100);
  });
});

describe("selectStored", () => {
  function entry(i: number, position: ShowcaseEntry["position"], ppr: number): ShowcaseEntry {
    return {
      playerId: `p${position}${i}`,
      sleeperId: `${position}${i}`,
      position,
      typicalWeek: 3,
      leagues: 10,
      viaWaiver: 5,
      viaFreeAgent: 5,
      bidsByPool: {},
      points: { ppr, half: ppr, std: ppr, rec: 0, games: 10 },
    };
  }

  it("keeps the leaders of every position, not only the highest scorers overall", () => {
    const qbs = Array.from({ length: 40 }, (_, i) => entry(i, "QB", 300 - i));
    const tes = Array.from({ length: 3 }, (_, i) => entry(i, "TE", 90 - i));
    const stored = selectStored([...qbs, ...tes]);
    expect(stored.filter((e) => e.position === "TE")).toHaveLength(3);
    expect(stored.filter((e) => e.position === "QB")).toHaveLength(STORED_PER_POSITION);
  });
});

describe("poolBids and pickupCost", () => {
  const bids = poolBids([
    { pool: "redraft", pct: 2 },
    { pool: "redraft", pct: 4 },
    { pool: "redraft", pct: 6 },
    { pool: "dynasty", pct: 30 },
    { pool: "dynasty", pct: 40 },
    { pool: "dynasty", pct: 50 },
    { pool: "dynasty", pct: 250 },
  ]);
  const entry = { bidsByPool: bids, viaWaiver: 7, viaFreeAgent: 0 };

  it("takes each pool's median from that pool's bids only", () => {
    expect(bids.redraft).toEqual({ medianPct: 4, samples: 3 });
    // 250 is clamped to the whole budget before the median is taken.
    expect(bids.dynasty).toEqual({ medianPct: 40, samples: 4 });
  });

  it("quotes a reader their own pool's price", () => {
    expect(pickupCost(entry, "redraft")).toEqual({ kind: "bid", pct: 4, samples: 3 });
    expect(pickupCost(entry, "dynasty")).toEqual({ kind: "bid", pct: 40, samples: 4 });
  });

  it("says unpriced rather than borrowing the other pool's price", () => {
    const dynastyOnly = { ...entry, bidsByPool: { dynasty: bids.dynasty! } };
    expect(pickupCost(dynastyOnly, "redraft")).toEqual({ kind: "unpriced", pct: null, samples: 0 });
  });

  it("reads a row stored before the split as unpriced, never its pooled median", () => {
    const legacy = { medianBidPct: 22, bidSamples: 90, viaWaiver: 7, viaFreeAgent: 0 };
    expect(pickupCost(legacy, "redraft").kind).toBe("unpriced");
  });
});

describe("medianOf", () => {
  it("is the nearest-rank median", () => {
    expect(medianOf([5, 1, 3])).toBe(3);
    expect(medianOf([4, 1, 3, 2])).toBe(2);
  });
  it("is null for no values", () => expect(medianOf([])).toBeNull());
});
