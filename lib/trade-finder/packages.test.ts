import { describe, it, expect } from "vitest";
import {
  acquirablePool,
  anchorCandidates,
  assetId,
  assetValue,
  balancePackages,
  givablePool,
  PACKAGE_LIMITS,
  type AssetRef,
  type QualityGate,
} from "./packages";
import { DEFAULT_TRADE_QUALITY_CONFIG } from "@/lib/trade-quality";
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

  it("reaches for the asset the reader has not been offered yet", () => {
    // Three assets that all balance a 2,000 target on their own. Walking the
    // pool from one end returns "a" every time, which is how one player ended
    // up paying for nearly every deal in a real league.
    const pool = [asRef(1950, "a"), asRef(2000, "b"), asRef(2050, "c")];
    const fresh = balancePackages(2000, pool);
    expect(fresh[0].map(assetId)).toEqual(["b"]);

    const used = balancePackages(2000, pool, {
      usage: new Map([
        ["b", 3],
        ["a", 1],
      ]),
    });
    expect(used[0].map(assetId)).toEqual(["c"]);
  });

  it("returns alternatives that lead with different assets", () => {
    const pool = [
      asRef(600, "cheap"),
      asRef(1400, "a"),
      asRef(1450, "b"),
      asRef(1500, "c"),
    ];
    const packages = balancePackages(1500, pool);
    const leads = packages.map((p) => {
      const sorted = [...p].sort((x, y) => assetValue(y) - assetValue(x));
      return assetId(sorted[0]);
    });
    // Three ways to pay that lead with the same player are one idea printed
    // three times, which is what the reader sees when they press the arrow.
    expect(new Set(leads).size).toBe(leads.length);
  });

  it("is deterministic under a usage tally too", () => {
    const pool = [asRef(900, "a"), asRef(950, "b"), asRef(1000, "c")];
    const usage = new Map([["b", 2]]);
    const once = balancePackages(950, pool, { usage }).map((p) => p.map(assetId).join());
    const twice = balancePackages(950, pool, { usage }).map((p) => p.map(assetId).join());
    expect(once).toEqual(twice);
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

  it("admits a comparable starter when the reader is putting up an equal piece", () => {
    const starters = fullRoster();
    const theirBest = starters[0]; // 3,000, a starting quarterback
    const theirs = profileOf(starters, { statusKey: "competitor" });

    const spareParts = acquirablePool(theirs, mine, {
      goal: "balanced",
      targetPlayerId: null,
      allowPicks: true,
    });
    // Untouched by the ordinary pool: nobody trades their starter for filler.
    expect(spareParts.map(assetId)).not.toContain(theirBest.playerId);

    const evenSwap = acquirablePool(theirs, mine, {
      goal: "balanced",
      targetPlayerId: null,
      allowPicks: true,
      comparableTo: theirBest.value,
    });
    // On the table once the reader is offering a piece of the same size, which
    // is a normal trade rather than the lowball this pool exists to prevent.
    expect(evenSwap.map(assetId)).toContain(theirBest.playerId);
  });

  it("does not call a much cheaper player comparable", () => {
    const starters = fullRoster();
    const theirs = profileOf(starters, { statusKey: "competitor" });
    const pool = acquirablePool(theirs, mine, {
      goal: "balanced",
      targetPlayerId: null,
      allowPicks: true,
      comparableTo: 8000,
    });
    // Nothing on a roster topping out at 3,000 balances an 8,000 asset alone.
    expect(pool).toHaveLength(0);
  });
});

describe("anchorCandidates", () => {
  it("puts every valued player on the table, not only the expendable ones", () => {
    const roster = fullRoster();
    const profile = profileOf(roster, { statusKey: "competitor" });
    const anchors = anchorCandidates(profile, { goal: "balanced", allowPicks: true });
    for (const p of roster) {
      expect(anchors.map(assetId)).toContain(p.playerId);
    }
  });

  it("leads with the most valuable piece, which is the one a manager wonders about", () => {
    const profile = profileOf(fullRoster());
    const anchors = anchorCandidates(profile, { goal: "balanced", allowPicks: true });
    const values = anchors.map(assetValue);
    expect([...values].sort((a, b) => b - a)).toEqual(values);
  });

  it("never puts a rebuilding team's own picks on the table", () => {
    const profile = profileOf(fullRoster(), {
      statusKey: "rebuilder",
      picks: [pick({ value: 3000 })],
    });
    const anchors = anchorCandidates(profile, { goal: "balanced", allowPicks: true });
    expect(anchors.some((a) => a.kind === "pick")).toBe(false);
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
      goal: "consolidate",
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

describe("balancePackages quality gate", () => {
  const gateFor = (incomingValues: number[]): QualityGate => ({
    config: DEFAULT_TRADE_QUALITY_CONFIG,
    poolMax: 9900,
    incomingValues,
  });

  it("rejects a pile of depth pieces that only adds up on paper", () => {
    // Three pieces summing to 4,100 against a single 4,000 asset. The raw band
    // is delighted. The other manager would not be.
    const pool = [asRef(1300, "a"), asRef(1400, "b"), asRef(1400, "c")];
    const raw = balancePackages(4000, pool);
    const gated = balancePackages(4000, pool, { quality: gateFor([4000]) });

    expect(raw.length).toBeGreaterThan(0);
    expect(gated).toHaveLength(0);
  });

  it("still accepts a like-for-like single asset", () => {
    const pool = [asRef(1000, "a"), asRef(4050, "b")];
    const gated = balancePackages(4000, pool, { quality: gateFor([4000]) });
    expect(gated.length).toBeGreaterThan(0);
    expect(gated[0]).toHaveLength(1);
    expect(assetId(gated[0][0])).toBe("b");
  });

  it("accepts a two-piece package once it pays the consolidation premium", () => {
    // Raw total 5,400 against a 4,000 target: a 35% overpay, which is roughly
    // what consolidation actually costs. The old raw ceiling would have thrown
    // this out at 15% and left nothing behind it.
    const pool = [asRef(2600, "a"), asRef(2800, "b")];
    const gated = balancePackages(4000, pool, { quality: gateFor([4000]) });
    expect(gated.length).toBeGreaterThan(0);
  });

  it("rejects an overpay that hands over a clearly better asset", () => {
    const pool = [asRef(6500, "a")];
    const gated = balancePackages(4000, pool, { quality: gateFor([4000]) });
    expect(gated).toHaveLength(0);
  });

  it("behaves exactly as before when no gate is supplied", () => {
    const pool = [asRef(1300, "a"), asRef(1400, "b"), asRef(1400, "c")];
    expect(balancePackages(4000, pool).length).toBeGreaterThan(0);
  });
});

describe("givablePool value spread", () => {
  /** A roster with far more tradeable pieces than the pool can hold. */
  const deepBench = () => {
    const starters = fullRoster();
    const bench = Array.from({ length: 16 }, (_, i) =>
      player({ position: "WR", value: 400 + i * 60, projPoints: 1 }),
    );
    // One genuinely valuable piece the lineup does not need, which is exactly
    // the asset a reader would expect to be able to trade.
    const stash = player({ position: "WR", value: 7000, projPoints: 1 });
    return [...starters, ...bench, stash];
  };

  it("keeps the reader's most valuable expendable asset in the pool", () => {
    const profile = profileOf(deepBench());
    const pool = givablePool(profile, {
      goal: "balanced",
      offerPlayerId: null,
      allowPicks: false,
    });

    expect(pool.length).toBeLessThanOrEqual(PACKAGE_LIMITS.GIVE_LIMIT);
    // The old slice kept the cheapest fourteen, so a 7,000-point stash could
    // never be offered however obvious the trade was.
    expect(Math.max(...pool.map(assetValue))).toBeGreaterThan(6000);
  });

  it("still leads with cheap currency, which is what the balancer walks first", () => {
    const profile = profileOf(deepBench());
    const pool = givablePool(profile, {
      goal: "balanced",
      offerPlayerId: null,
      allowPicks: false,
    });
    const values = pool.map(assetValue);
    // Ascending order is preserved across the cut, which the search depends on.
    expect([...values].sort((a, b) => a - b)).toEqual(values);
  });

  it("leaves a pool that already fits completely alone", () => {
    const profile = profileOf();
    const pool = givablePool(profile, {
      goal: "balanced",
      offerPlayerId: null,
      allowPicks: false,
    });
    expect(pool.length).toBeLessThanOrEqual(PACKAGE_LIMITS.GIVE_LIMIT);
  });
});

describe("balancePackages does not trust the caller's ordering", () => {
  // The two-asset scans break out of their inner loop as soon as a running total
  // overshoots the band, which is only sound walking UP a pool. The coverage
  // search hands this function a pool sorted by appetite DESCENDING, where the
  // first pair tried is the largest, the break fires immediately, and every
  // smaller pair behind it is discarded unexamined. That pass is the only
  // producer of multi-piece returns for a named player, so it was quietly
  // throwing away answers it had in hand.
  const values = [3000, 2000, 1200, 1000, 900];
  const build = (order: number[]) =>
    order.map((v, i) => asRef(v, `p${values.indexOf(v)}${i}`));

  it("finds the same packages whichever way the pool is sorted", () => {
    const target = 3500;
    const ascending = balancePackages(target, build([...values].sort((a, b) => a - b)));
    const descending = balancePackages(target, build([...values].sort((a, b) => b - a)));

    const shapes = (packages: AssetRef[][]) =>
      packages
        .map((p) => p.map(assetValue).sort((a, b) => a - b).join("+"))
        .sort();

    expect(shapes(ascending).length).toBeGreaterThan(0);
    expect(shapes(descending)).toEqual(shapes(ascending));
  });

  it("reaches the pairs a descending walk would have skipped", () => {
    const packages = balancePackages(3500, build([...values].sort((a, b) => b - a)));
    const totals = packages.map((p) => p.reduce((s, a) => s + assetValue(a), 0));
    // 3000 + 900 and 3000 + 1000 both land in the band. A descending scan that
    // breaks on the first overshoot never sees either.
    expect(totals.some((t) => t >= 3325 && t <= 4025)).toBe(true);
  });
});

describe("balancePackages honours maxAssets", () => {
  it("stops at one asset even when a required piece is pinned", () => {
    // Only the two- and three-asset scans consulted maxAssets, so the "required
    // plus one more" loop returned two-asset packages under maxAssets: 1 and the
    // constraint was a lie the caller could not see.
    const required = asRef(2000, "req");
    const packages = balancePackages(3000, [required, asRef(900, "a"), asRef(1100, "b")], {
      required,
      maxAssets: 1,
    });
    for (const p of packages) expect(p.length).toBeLessThanOrEqual(1);
  });

  it("still builds the pair when there is room for it", () => {
    const required = asRef(2000, "req");
    const packages = balancePackages(3000, [required, asRef(900, "a"), asRef(1100, "b")], {
      required,
      maxAssets: 2,
    });
    expect(packages.some((p) => p.length === 2)).toBe(true);
  });
});
