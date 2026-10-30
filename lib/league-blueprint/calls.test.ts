import { describe, expect, it } from "vitest";
import {
  NOTE_HARD_SELL,
  NOTE_HOLD_LOW,
  NOTE_KEEP,
  NOTE_SELL_HIGH,
  callLabel,
  computeBuyTargets,
  computeCalls,
  type CallPlayer,
} from "./calls";
import { DEFAULT_LEAGUE_BLUEPRINT_SETTINGS } from "./default-settings";
import { buildTeamProfile, leagueStarterBaselines } from "@/lib/trade-finder/profile";
import { SLOTS, buildLeague } from "./__fixtures__/league";

const cutoff = DEFAULT_LEAGUE_BLUEPRINT_SETTINGS.calls.ageCutoff;

const p = (id: string, over: Partial<CallPlayer> = {}): CallPlayer => ({
  id,
  position: "WR",
  value: 3000,
  isStarter: false,
  age: 25,
  yearsExperience: 4,
  positionRank: 40,
  inSurplus: false,
  signal: null,
  ...over,
});

/** Three high-value starters so the top-3 build slots are taken unless a test says otherwise. */
const stars = [
  p("s1", { value: 9000, isStarter: true, positionRank: 2 }),
  p("s2", { value: 8500, isStarter: true, positionRank: 3 }),
  p("s3", { value: 8000, isStarter: true, positionRank: 4 }),
];
const opts = { direction: "balanced" as const, isDynasty: true, ageCutoff: cutoff };

describe("computeCalls decision table", () => {
  it("roster sell plus a market sell lean is a hard sell", () => {
    const c = computeCalls([...stars, p("x", { inSurplus: true, signal: "sell" })], opts);
    expect(c.x).toEqual({ call: "sell", strength: "hard", note: NOTE_HARD_SELL });
    expect(callLabel(c.x)).toBe("Hard sell");
  });

  it("roster sell without a lean is a soft sell", () => {
    const c = computeCalls([...stars, p("x", { inSurplus: true })], opts);
    expect(c.x).toEqual({ call: "sell", strength: "soft", note: null });
    expect(callLabel(c.x)).toBe("Sell");
  });

  it("a rebuilder sells an aging priced player", () => {
    const c = computeCalls([...stars, p("x", { position: "RB", age: 28.2, value: 2000 })], {
      ...opts,
      direction: "rebuild",
    });
    expect(c.x.call).toBe("sell");
  });

  it("a hold that is aging and priced high becomes a soft sell", () => {
    const c = computeCalls([...stars, p("x", { age: 31, signal: "watch_sell" })], opts);
    expect(c.x).toEqual({ call: "sell", strength: "soft", note: NOTE_SELL_HIGH });
  });

  it("a top-3 starter is a build around, with the keep note on a sell lean", () => {
    const c = computeCalls([p("a", { value: 9000, isStarter: true, signal: "sell" })], opts);
    expect(c.a).toEqual({ call: "build", strength: null, note: NOTE_KEEP });
  });

  it("a rebuilder does not build around an old star", () => {
    const c = computeCalls([p("a", { value: 9000, isStarter: true, position: "RB", age: 29 })], {
      ...opts,
      direction: "rebuild",
    });
    expect(c.a.call).toBe("sell");
  });

  it("a hold priced low gets the do-not-sell note", () => {
    const c = computeCalls([...stars, p("x", { signal: "buy" })], opts);
    expect(c.x).toEqual({ call: "hold", strength: null, note: NOTE_HOLD_LOW });
  });

  // The shared rule (lib/roster-badges.ts) names cuts only from a bench of 6 or more.
  it("names the three cheapest non-starters as cut candidates", () => {
    const bench = [600, 700, 800, 900, 1000, 1100].map((v, i) => p(`b${i}`, { value: v, age: 29 }));
    const c = computeCalls([...stars, ...bench], opts);
    expect(["b0", "b1", "b2"].map((id) => c[id].call)).toEqual(["cut", "cut", "cut"]);
    expect(c.b3.call).toBe("hold");
  });

  it("the dynasty keep value blocks a cut", () => {
    const bench = [1500, 1600, 1700, 1800, 1900, 2000].map((v, i) => p(`b${i}`, { value: v, age: 29 }));
    const c = computeCalls([...stars, ...bench], opts);
    expect(c.b0.call).not.toBe("cut");
    const redraft = computeCalls([...stars, ...bench], { ...opts, isDynasty: false });
    expect(redraft.b0.call).toBe("cut");
  });
});

describe("computeBuyTargets", () => {
  const teams = buildLeague();
  const baselines = leagueStarterBaselines(teams, SLOTS);
  const profiles = teams.map((t) => buildTeamProfile(t, SLOTS, baselines, { isDynasty: true }));
  const mine = profiles[0];
  const others = profiles.slice(1);

  it("targets the position of need on other rosters only", () => {
    const groups = computeBuyTargets({
      mine,
      others,
      signals: new Map(),
      myRosterId: 1,
      settings: DEFAULT_LEAGUE_BLUEPRINT_SETTINGS.calls,
    });
    expect(groups[0]?.position).toBe("RB");
    for (const g of groups) {
      for (const t of g.targets) {
        expect(t.rosterId).not.toBe(1);
        expect(t.proposal).toMatchObject({ myRosterId: 1, theirRosterId: t.rosterId, outgoing: [] });
      }
      expect(g.targets.length).toBeLessThanOrEqual(2);
    }
  });

  it("ranks a market buy first and marks it hard", () => {
    const settings = DEFAULT_LEAGUE_BLUEPRINT_SETTINGS.calls;
    const base = computeBuyTargets({ mine, others, signals: new Map(), myRosterId: 1, settings });
    const rb = base.find((g) => g.position === "RB")!;
    expect(rb.targets.length).toBe(2);
    expect(rb.targets.every((t) => t.strength === "soft")).toBe(true);
    const second = rb.targets[1].playerId;
    const withSignal = computeBuyTargets({
      mine,
      others,
      signals: new Map([[second, "buy"]]),
      myRosterId: 1,
      settings,
    });
    const first = withSignal.find((g) => g.position === "RB")!.targets[0];
    expect(first.playerId).toBe(second);
    expect(first.strength).toBe("hard");
  });
});
