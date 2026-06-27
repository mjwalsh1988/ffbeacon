import { describe, it, expect } from "vitest";
import {
  seatForPick,
  pickNoForSeat,
  isReversedRound,
  deriveDraftState,
  mapRealtimePickRow,
  mergePick,
  mergePicks,
  teamNameForSeat,
  lastPickLabel,
  relativeTime,
  formatLastSynced,
  syncStatusLine,
  excludeDrafted,
  filterPool,
  pickBestByValue,
} from "./draft-derive";
import type { ShapedDraftCache, ShapedPick } from "./types";
import type { RankedPlayer } from "./board-types";

function rp(over: Partial<RankedPlayer> = {}): RankedPlayer {
  return {
    playerId: "p1",
    sleeperId: "1001",
    name: "Test Player",
    position: "RB",
    team: "ATL",
    overallRank: 1,
    positionRank: 1,
    tier: 1,
    value: 100,
    isRookie: false,
    ...over,
  };
}

function pick(pickNo: number, over: Partial<ShapedPick> = {}): ShapedPick {
  const teams = 8;
  const round = Math.ceil(pickNo / teams);
  const idx = ((pickNo - 1) % teams) + 1;
  const draftSlot = round % 2 === 0 ? teams - idx + 1 : idx;
  return {
    pickNo,
    round,
    draftSlot,
    rosterId: draftSlot,
    pickedBy: `u${draftSlot}`,
    sleeperPlayerId: String(1000 + pickNo),
    playerId: `player-${pickNo}`,
    isKeeper: false,
    firstName: "First",
    lastName: `Last${pickNo}`,
    position: "RB",
    team: "ATL",
    ...over,
  };
}

function cacheWith(pickCount: number): ShapedDraftCache {
  return {
    draft: {
      sleeperDraftId: "D1",
      sleeperLeagueId: "L1",
      season: "2026",
      draftStatus: "drafting",
      draftType: "snake",
      pickCount,
      slotToRosterId: Object.fromEntries(Array.from({ length: 8 }, (_, i) => [String(i + 1), i + 1])),
      settings: { teams: 8, rounds: 5 },
      lastSyncedAt: null,
    },
    users: Array.from({ length: 8 }, (_, i) => ({
      userId: `u${i + 1}`,
      displayName: `Team ${i + 1}`,
      avatar: null,
    })),
    rosters: Array.from({ length: 8 }, (_, i) => ({
      rosterId: i + 1,
      ownerId: `u${i + 1}`,
      coOwners: [],
      players: [],
    })),
    picks: Array.from({ length: pickCount }, (_, i) => pick(i + 1)),
    tradedPicks: [],
  };
}

describe("seatForPick (snake default)", () => {
  it("maps round 1 straight and round 2 reversed", () => {
    expect(seatForPick(1, 8)).toBe(1);
    expect(seatForPick(8, 8)).toBe(8);
    expect(seatForPick(9, 8)).toBe(8); // round 2 starts reversed
    expect(seatForPick(12, 8)).toBe(5);
    expect(seatForPick(16, 8)).toBe(1);
  });
  it("returns 0 for invalid inputs", () => {
    expect(seatForPick(0, 8)).toBe(0);
    expect(seatForPick(5, 0)).toBe(0);
  });
});

describe("draft shape: snake / linear / 3RR", () => {
  const snake = { type: "snake", reversalRound: 0 };
  const linear = { type: "linear", reversalRound: 0 };
  const trr = { type: "snake", reversalRound: 3 };

  it("isReversedRound: snake reverses even rounds", () => {
    expect(isReversedRound(1, snake)).toBe(false);
    expect(isReversedRound(2, snake)).toBe(true);
    expect(isReversedRound(3, snake)).toBe(false);
  });
  it("isReversedRound: linear never reverses", () => {
    expect(isReversedRound(2, linear)).toBe(false);
    expect(isReversedRound(4, linear)).toBe(false);
  });
  it("isReversedRound: 3RR keeps round 3 reversed, then alternates", () => {
    // R1 fwd, R2 rev, R3 rev (the reversal), R4 fwd, R5 rev
    expect(isReversedRound(1, trr)).toBe(false);
    expect(isReversedRound(2, trr)).toBe(true);
    expect(isReversedRound(3, trr)).toBe(true);
    expect(isReversedRound(4, trr)).toBe(false);
    expect(isReversedRound(5, trr)).toBe(true);
  });

  it("linear: every round runs seat 1..teams left to right", () => {
    expect(seatForPick(9, 8, linear)).toBe(1); // round 2, first pick -> seat 1
    expect(seatForPick(16, 8, linear)).toBe(8);
    expect(pickNoForSeat(2, 1, 8, linear)).toBe(9);
    expect(pickNoForSeat(2, 8, 8, linear)).toBe(16);
  });

  it("3RR: round 3 repeats round 2's reversed order", () => {
    // round 3, seat 1 -> overall 24 (reversed: base 16 + (8 - 1 + 1) = 24)
    expect(pickNoForSeat(3, 1, 8, trr)).toBe(24);
    expect(seatForPick(24, 8, trr)).toBe(1);
    // round 4 returns to forward order
    expect(pickNoForSeat(4, 1, 8, trr)).toBe(25);
  });

  it("seatForPick and pickNoForSeat are inverses for each shape", () => {
    for (const shape of [snake, linear, trr]) {
      for (let pickNo = 1; pickNo <= 40; pickNo++) {
        const round = Math.ceil(pickNo / 8);
        const seat = seatForPick(pickNo, 8, shape);
        expect(pickNoForSeat(round, seat, 8, shape)).toBe(pickNo);
      }
    }
  });
});

describe("excludeDrafted", () => {
  const board: RankedPlayer[] = [
    rp({ playerId: "a", sleeperId: "10", name: "Alpha One" }),
    rp({ playerId: "b", sleeperId: "20", name: "Bravo Two" }),
    rp({ playerId: "c", sleeperId: "30", name: "Charlie Three" }),
    rp({ playerId: "k1", sleeperId: "KC", name: "Kicker One", position: "K" }),
    rp({ playerId: "d1", sleeperId: "BAL", name: "Ravens Defense", position: "DEF" }),
  ];

  it("removes drafted players by resolved player_id", () => {
    const picks = [pick(1, { playerId: "b", sleeperPlayerId: "20" })];
    const out = excludeDrafted(board, picks);
    expect(out.map((p) => p.playerId)).toEqual(["a", "c", "k1", "d1"]);
  });

  it("removes an unmapped pick by sleeper id, then by name guard", () => {
    // Unmapped pick (no player_id) but a sleeper id that matches a board row.
    const bySleeper = excludeDrafted(board, [pick(1, { playerId: null, sleeperPlayerId: "30" })]);
    expect(bySleeper.find((p) => p.playerId === "c")).toBeUndefined();
    // Unmapped pick with no sleeper id, matched by normalized name.
    const byName = excludeDrafted(board, [
      pick(1, { playerId: null, sleeperPlayerId: null, firstName: "Alpha", lastName: "One" }),
    ]);
    expect(byName.find((p) => p.playerId === "a")).toBeUndefined();
  });

  it("does not crash on empty/garbage picks and keeps K/DEF until drafted", () => {
    const out = excludeDrafted(board, [pick(1, { playerId: null, sleeperPlayerId: null, firstName: null, lastName: null })]);
    expect(out).toHaveLength(5); // nothing matched; K + DEF still present
    expect(out.some((p) => p.position === "K")).toBe(true);
    expect(out.some((p) => p.position === "DEF")).toBe(true);
  });
});

describe("filterPool", () => {
  const board: RankedPlayer[] = [
    rp({ playerId: "vet", isRookie: false }),
    rp({ playerId: "rook", isRookie: true }),
    rp({ playerId: "k", position: "K", isRookie: false }),
  ];
  it("Everyone returns all undrafted ranked players", () => {
    expect(filterPool(board, "everyone").map((p) => p.playerId)).toEqual(["vet", "rook", "k"]);
  });
  it("Rookies Only returns only rookies", () => {
    expect(filterPool(board, "rookies").map((p) => p.playerId)).toEqual(["rook"]);
  });
  it("Rookies Only is empty (not a crash) when no rookie flags are set", () => {
    const noRookies = [rp({ isRookie: false }), rp({ playerId: "x", isRookie: false })];
    expect(filterPool(noRookies, "rookies")).toEqual([]);
  });
});

describe("pickBestByValue", () => {
  it("returns the highest value, deterministic tie-break by rank then id", () => {
    const players = [
      rp({ playerId: "a", value: 50, overallRank: 5 }),
      rp({ playerId: "b", value: 90, overallRank: 2 }),
      rp({ playerId: "c", value: 90, overallRank: 1 }), // ties b on value, better rank
    ];
    expect(pickBestByValue(players)?.playerId).toBe("c");
  });
  it("returns null for an empty pool", () => {
    expect(pickBestByValue([])).toBeNull();
  });
});

describe("deriveDraftState", () => {
  it("computes the on-the-clock pick/seat from real picks", () => {
    const d = deriveDraftState(cacheWith(11), "u3");
    expect(d.onTheClockPickNo).toBe(12);
    expect(d.onTheClockSlot).toBe(5);
    expect(d.onTheClockRound).toBe(2);
    expect(d.onTheClockPickInRound).toBe(4);
    expect(d.lastPick?.pickNo).toBe(11);
    expect(d.complete).toBe(false);
  });

  it("detects the connected user's roster + seat", () => {
    const d = deriveDraftState(cacheWith(11), "u3");
    expect(d.myRosterId).toBe(3);
    expect(d.mySlot).toBe(3);
  });

  it("leaves my-team undetected when the user id is unknown", () => {
    const d = deriveDraftState(cacheWith(11), null);
    expect(d.myRosterId).toBeNull();
    expect(d.mySlot).toBe(0);
  });

  it("marks the draft complete when every seat in every round is filled", () => {
    const d = deriveDraftState(cacheWith(40), "u1"); // 8 * 5 = 40
    expect(d.complete).toBe(true);
    expect(d.onTheClockPickNo).toBe(0);
    expect(d.onTheClockSlot).toBe(0);
  });
});

describe("mapRealtimePickRow", () => {
  it("shapes a raw pick-cache row (metadata-aware) with NO Sleeper call", () => {
    const raw = {
      sleeper_draft_id: "D1",
      pick_no: 12,
      round: 2,
      draft_slot: 5,
      roster_id: 5,
      picked_by: "u5",
      sleeper_player_id: "4046",
      player_id: "abc-123",
      is_keeper: false,
      metadata: { first_name: "Patrick", last_name: "Mahomes", position: "QB", team: "KC" },
    };
    const shaped = mapRealtimePickRow(raw);
    expect(shaped).not.toBeNull();
    expect(shaped).toMatchObject({
      pickNo: 12,
      round: 2,
      draftSlot: 5,
      rosterId: 5,
      pickedBy: "u5",
      sleeperPlayerId: "4046",
      playerId: "abc-123",
      firstName: "Patrick",
      lastName: "Mahomes",
      position: "QB",
      team: "KC",
    });
  });

  it("returns null for a payload without a numeric pick_no", () => {
    expect(mapRealtimePickRow({})).toBeNull();
    expect(mapRealtimePickRow(null)).toBeNull();
    expect(mapRealtimePickRow({ pick_no: "nope" })).toBeNull();
  });
});

describe("mergePick / mergePicks (Realtime fold, no network)", () => {
  it("inserts a new pick, keeps order, and is idempotent on pick_no", () => {
    const base = [pick(1), pick(2)];
    const merged = mergePick(base, pick(3));
    expect(merged.map((p) => p.pickNo)).toEqual([1, 2, 3]);
    // Re-applying the same pick_no replaces, never duplicates.
    const dup = mergePick(merged, pick(3, { team: "DET" }));
    expect(dup).toHaveLength(3);
    expect(dup.find((p) => p.pickNo === 3)?.team).toBe("DET");
  });

  it("folds a batch in one pass, sorted by pick_no", () => {
    const merged = mergePicks([pick(2)], [pick(5), pick(1), pick(2)]);
    expect(merged.map((p) => p.pickNo)).toEqual([1, 2, 5]);
  });
});

describe("teamNameForSeat / lastPickLabel", () => {
  it("resolves seat -> roster -> owner display name", () => {
    expect(teamNameForSeat(cacheWith(0), 3)).toBe("Team 3");
  });
  it("labels the last pick or None yet", () => {
    expect(lastPickLabel(null)).toBe("None yet");
    expect(lastPickLabel(pick(7, { firstName: "Bijan", lastName: "Robinson", position: "RB" }))).toBe(
      "Bijan Robinson (RB)",
    );
  });
});

describe("relativeTime / formatLastSynced / syncStatusLine", () => {
  const now = Date.parse("2026-06-26T12:00:30Z");
  const iso18 = "2026-06-26T12:00:12Z"; // 18s earlier

  it("formats relative seconds/minutes", () => {
    expect(relativeTime(iso18, now)).toBe("18 seconds ago");
    expect(relativeTime("2026-06-26T11:58:30Z", now)).toBe("2 minutes ago");
    expect(relativeTime(null, now)).toBeNull();
  });

  it("formats the last-synced label", () => {
    expect(formatLastSynced(iso18, now)).toBe("Last synced 18 seconds ago");
    expect(formatLastSynced(null, now)).toBe("Not synced yet");
  });

  it("maps each sync status to clear copy", () => {
    expect(syncStatusLine("synced", { lastSyncedAt: iso18, cooldownRemainingSeconds: 0, nowMs: now })).toBe(
      "Updated just now.",
    );
    expect(
      syncStatusLine("synced-by-other", { lastSyncedAt: iso18, cooldownRemainingSeconds: 5, nowMs: now }),
    ).toBe("Synced by another viewer 18 seconds ago.");
    expect(
      syncStatusLine("cooldown", { lastSyncedAt: iso18, cooldownRemainingSeconds: 12, nowMs: now }),
    ).toContain("Next sync available in 12 seconds.");
    expect(
      syncStatusLine("error", {
        lastSyncedAt: null,
        cooldownRemainingSeconds: 0,
        nowMs: now,
        error: "Sync failed. Try again shortly.",
      }),
    ).toBe("Sync failed. Try again shortly.");
  });
});
