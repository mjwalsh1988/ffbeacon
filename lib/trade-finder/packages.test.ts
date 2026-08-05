import { describe, it, expect } from "vitest";
import {
  acquirablePool,
  assetId,
  balancePackages,
  givablePool,
  PACKAGE_LIMITS,
  type AssetRef,
} from "./packages";
import { buildTeamProfile } from "./profile";
import { STANDARD_SLOTS, fullRoster, pick, player, team } from "./_test-kit";

const BASELINES = { QB: 18, RB: 12, WR: 12, TE: 8 };

const asRef = (value: number, id: string): AssetRef => ({
  kind: "player",
  player: player({ playerId: id, value, projPoints: value / 200 }),
});

const profileOf = (players = fullRoster(), extras: Parameters<typeof team>[0] = {}) =>
  buildTeamProfile(team({ players, ...extras }), STANDARD_SLOTS, BASELINES);

describe("balancePackages", () => {
  it("prefers the single asset that lands closest, over a pile", () => {
    const pool = [asRef(500, "a"), asRef(1000, "b"), asRef(2000, "c")];
    const [first] = balancePackages(2000, pool);
    expect(first.map(assetId)).toEqual(["c"]);
  });

  it("builds a pair when nothing on its own fits", () => {
    const pool = [asRef(900, "a"), asRef(1100, "b"), asRef(4000, "c")];
    const [first] = balancePackages(2000, pool);
    expect(first.map(assetId).sort()).toEqual(["a", "b"]);
  });

  it("refuses a lowball", () => {
    // 1000 against a 3000 target is not an offer anyone sends.
    expect(balancePackages(3000, [asRef(1000, "a")])).toEqual([]);
  });

  it("refuses a wild overpay", () => {
    expect(balancePackages(1000, [asRef(9000, "a")])).toEqual([]);
  });

  it("allows a modest overpay, because that is how trades get done", () => {
    const over = 1000 * (1 + PACKAGE_LIMITS.OVER_TOLERANCE - 0.01);
    expect(balancePackages(1000, [asRef(over, "a")])).toHaveLength(1);
  });

  it("puts the required asset in every package it returns", () => {
    const required = asRef(1500, "keeper");
    const pool = [asRef(400, "a"), asRef(800, "b"), required];
    const packages = balancePackages(2200, pool, { required });
    expect(packages.length).toBeGreaterThan(0);
    for (const pkg of packages) {
      expect(pkg.map(assetId)).toContain("keeper");
    }
  });

  it("is deterministic, so a passed deal stays passed", () => {
    const pool = [asRef(500, "a"), asRef(700, "b"), asRef(900, "c"), asRef(1300, "d")];
    const once = balancePackages(1400, pool).map((p) => p.map(assetId).sort().join());
    const twice = balancePackages(1400, pool).map((p) => p.map(assetId).sort().join());
    expect(once).toEqual(twice);
  });

  it("never returns more than the package cap", () => {
    const pool = Array.from({ length: 12 }, (_, i) => asRef(500 + i * 10, `a${i}`));
    expect(balancePackages(1100, pool).length).toBeLessThanOrEqual(
      PACKAGE_LIMITS.MAX_PACKAGES,
    );
  });
});

describe("acquirablePool", () => {
  const mine = profileOf();

  it("offers up a team's benched value", () => {
    const benched = player({ position: "RB", value: 2400, projPoints: 4 });
    const theirs = profileOf([...fullRoster(), benched]);
    const pool = acquirablePool(theirs, mine, {
      goal: "balanced",
      targetPlayerId: null,
      allowPicks: true,
    });
    expect(pool.map(assetId)).toContain(benched.playerId);
  });

  it("leaves a contender's starters alone", () => {
    const starters = fullRoster();
    const theirs = profileOf(starters, { statusKey: "competitor" });
    const pool = acquirablePool(theirs, mine, {
      goal: "balanced",
      targetPlayerId: null,
      allowPicks: true,
    });
    // Nothing on this roster is spare, so nothing is on the table.
    for (const starter of starters) {
      expect(pool.map(assetId)).not.toContain(starter.playerId);
    }
  });

  it("puts a rebuilding team's older starters on the table", () => {
    const veteran = player({ position: "RB", value: 2600, age: 29, projPoints: 14 });
    const theirs = profileOf(
      [veteran, ...fullRoster().slice(1)],
      { statusKey: "rebuilder" },
    );
    const pool = acquirablePool(theirs, mine, {
      goal: "balanced",
      targetPlayerId: null,
      allowPicks: true,
    });
    expect(pool.map(assetId)).toContain(veteran.playerId);
  });

  it("puts a contender's young stash on the table", () => {
    const stash = player({ position: "WR", value: 2200, age: 22, projPoints: 3 });
    const theirs = profileOf([...fullRoster(), stash], { statusKey: "competitor" });
    const pool = acquirablePool(theirs, mine, {
      goal: "balanced",
      targetPlayerId: null,
      allowPicks: true,
    });
    expect(pool.map(assetId)).toContain(stash.playerId);
  });

  it("names only the named player when the reader has asked for one", () => {
    const wanted = fullRoster()[0];
    const theirs = profileOf([wanted, ...fullRoster().slice(1)]);
    const pool = acquirablePool(theirs, mine, {
      goal: "balanced",
      targetPlayerId: wanted.playerId,
      allowPicks: true,
    });
    // Untouchable or not, they asked what he costs, and that deserves an answer.
    expect(pool.map(assetId)).toEqual([wanted.playerId]);
  });

  it("asks for picks only when the reader is collecting them", () => {
    const theirs = profileOf(fullRoster(), { picks: [pick({ value: 3000 })] });
    const balanced = acquirablePool(theirs, mine, {
      goal: "balanced",
      targetPlayerId: null,
      allowPicks: true,
    });
    const collecting = acquirablePool(theirs, mine, {
      goal: "add-picks",
      targetPlayerId: null,
      allowPicks: true,
    });
    expect(balanced.some((a) => a.kind === "pick")).toBe(false);
    expect(collecting.some((a) => a.kind === "pick")).toBe(true);
  });
});

describe("givablePool", () => {
  it("never spends a rebuilding team's own picks", () => {
    const mine = buildTeamProfile(
      team({
        players: fullRoster(),
        picks: [pick({ value: 3000 })],
        statusKey: "rebuilder",
      }),
      STANDARD_SLOTS,
      BASELINES,
    );
    const pool = givablePool(mine, {
      goal: "balanced",
      offerPlayerId: null,
      allowPicks: true,
    });
    // Suggesting a rebuild trade away its own firsts is the one move this
    // feature must never make.
    expect(pool.some((a) => a.kind === "pick")).toBe(false);
  });

  it("spends picks when a contender is buying", () => {
    const mine = buildTeamProfile(
      team({
        players: fullRoster(),
        picks: [pick({ value: 3000 })],
        statusKey: "competitor",
      }),
      STANDARD_SLOTS,
      BASELINES,
    );
    const pool = givablePool(mine, {
      goal: "win-now",
      offerPlayerId: null,
      allowPicks: true,
    });
    expect(pool.some((a) => a.kind === "pick")).toBe(true);
  });

  it("leads with the named player when the reader wants to move him", () => {
    const roster = fullRoster();
    const offered = roster[0];
    const mine = buildTeamProfile(team({ players: roster }), STANDARD_SLOTS, BASELINES);
    const pool = givablePool(mine, {
      goal: "balanced",
      offerPlayerId: offered.playerId,
      allowPicks: true,
    });
    expect(assetId(pool[0])).toBe(offered.playerId);
  });

  it("returns nothing when the named player is not on the roster", () => {
    const mine = buildTeamProfile(
      team({ players: fullRoster() }),
      STANDARD_SLOTS,
      BASELINES,
    );
    expect(
      givablePool(mine, {
        goal: "balanced",
        offerPlayerId: "not-a-real-player",
        allowPicks: true,
      }),
    ).toEqual([]);
  });
});
