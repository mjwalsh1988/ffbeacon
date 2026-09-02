import { describe, it, expect } from "vitest";
import { findTrades } from "./engine";
import {
  PACKAGE_LIMITS,
  RELAXED_TOLERANCES,
  assetId,
  givablePool,
} from "./packages";
import { buildTeamProfile, leagueStarterBaselines } from "./profile";
import { STANDARD_SLOTS, pick, player, pulse, team } from "./_test-kit";
import { DEFAULT_TRADE_QUALITY_CONFIG } from "@/lib/trade-quality";
import {
  TRADE_GOALS,
  type FinderTeam,
  type TradeFinderInput,
  type TradeSuggestion,
} from "./types";
import type { TeamStatusKey } from "@/lib/league-team-status";

/**
 * One league, built so the right trade is obvious to a human.
 *
 * ME (roster 1, competitor): strong everywhere except tight end, where I am
 * starting a 3-point placeholder, and one running back deep enough that the
 * third one only holds his flex slot by a point.
 * THEM (roster 2, rebuilder): two startable tight ends and not much else, so the
 * second one is stuck in a flex a receiver could fill.
 * THE MIDDLE (roster 3): balanced and unremarkable, there to be considered and
 * passed over rather than to be the answer.
 *
 * Rosters are full (fourteen players against seven starting slots) because that
 * is what makes a bench exist, and a bench is what makes a trade possible. A
 * seven-man roster has no expendable pieces by construction, and testing against
 * one would prove nothing about a real league.
 *
 * The deal a person would make: my spare piece for their spare tight end, which
 * is worth eight points a week to a lineup starting a placeholder there.
 */
function league(): FinderTeam[] {
  return [
    team({
      rosterId: 1,
      teamName: "My Team",
      ownerHandle: "me",
      statusKey: "competitor",
      pulseRank: 2,
      valueRank: 4,
      players: [
        player({ playerId: "my-qb", position: "QB", projPoints: 20, value: 3000 }),
        player({ playerId: "my-rb1", position: "RB", projPoints: 16, value: 3200 }),
        player({ playerId: "my-rb2", position: "RB", projPoints: 14, value: 2800 }),
        // Holds the flex by a single point over the receiver behind him, so
        // losing him costs almost nothing. This is the trade chip.
        player({ playerId: "my-rb3", position: "RB", projPoints: 11, value: 2400, age: 27 }),
        player({ playerId: "my-wr1", position: "WR", projPoints: 15, value: 3000 }),
        player({ playerId: "my-wr2", position: "WR", projPoints: 13, value: 2600 }),
        player({ playerId: "my-te", position: "TE", projPoints: 3, value: 300 }),
        player({ playerId: "my-wr3", position: "WR", projPoints: 10, value: 2000 }),
        player({ playerId: "my-rb4", position: "RB", projPoints: 9, value: 1500 }),
        player({ playerId: "my-wr4", position: "WR", projPoints: 8, value: 1200 }),
        player({ playerId: "my-qb2", position: "QB", projPoints: 12, value: 900 }),
        player({ playerId: "my-te2", position: "TE", projPoints: 2, value: 200 }),
        player({ playerId: "my-rb5", position: "RB", projPoints: 5, value: 600 }),
        player({ playerId: "my-wr5", position: "WR", projPoints: 6, value: 700 }),
      ],
      picks: [pick({ key: "pick:2027:1:1", value: 2600 })],
    }),
    team({
      rosterId: 2,
      teamName: "Rebuild City",
      ownerHandle: "rebuilder",
      statusKey: "rebuilder",
      pulseRank: 11,
      valueRank: 3,
      players: [
        player({ playerId: "th-qb", position: "QB", projPoints: 18, value: 2600 }),
        player({ playerId: "th-rb1", position: "RB", projPoints: 9, value: 1400 }),
        player({ playerId: "th-rb2", position: "RB", projPoints: 8, value: 1200 }),
        player({ playerId: "th-wr1", position: "WR", projPoints: 14, value: 2800 }),
        player({ playerId: "th-wr2", position: "WR", projPoints: 12, value: 2400 }),
        player({ playerId: "th-te1", position: "TE", projPoints: 13, value: 2600 }),
        // Startable anywhere else, stuck in a flex behind te1 here.
        player({ playerId: "th-te2", position: "TE", projPoints: 11, value: 2300, age: 23 }),
        player({ playerId: "th-wr3", position: "WR", projPoints: 10, value: 1900 }),
        player({ playerId: "th-rb3", position: "RB", projPoints: 7, value: 800 }),
        player({ playerId: "th-wr4", position: "WR", projPoints: 6, value: 700 }),
        player({ playerId: "th-qb2", position: "QB", projPoints: 5, value: 400 }),
        player({ playerId: "th-te3", position: "TE", projPoints: 1, value: 100 }),
        player({ playerId: "th-rb4", position: "RB", projPoints: 4, value: 300 }),
        player({ playerId: "th-wr5", position: "WR", projPoints: 3, value: 200 }),
      ],
      picks: [pick({ key: "pick:2027:1:2", value: 2500 })],
    }),
    team({
      rosterId: 3,
      teamName: "The Middle",
      statusKey: "middle",
      pulseRank: 6,
      valueRank: 6,
      players: [
        player({ playerId: "mid-qb", position: "QB", projPoints: 19, value: 2800 }),
        player({ playerId: "mid-rb1", position: "RB", projPoints: 13, value: 2500 }),
        player({ playerId: "mid-rb2", position: "RB", projPoints: 12, value: 2300 }),
        player({ playerId: "mid-wr1", position: "WR", projPoints: 14, value: 2700 }),
        player({ playerId: "mid-wr2", position: "WR", projPoints: 11, value: 2100 }),
        player({ playerId: "mid-te1", position: "TE", projPoints: 10, value: 2000 }),
        player({ playerId: "mid-wr3", position: "WR", projPoints: 10, value: 1800 }),
        player({ playerId: "mid-rb3", position: "RB", projPoints: 8, value: 1100 }),
        player({ playerId: "mid-qb2", position: "QB", projPoints: 6, value: 500 }),
        player({ playerId: "mid-te2", position: "TE", projPoints: 4, value: 400 }),
      ],
      picks: [],
    }),
  ];
}

/** The most valuable thing the reader would send. What the card leads with. */
function outgoingLeadOf(s: TradeSuggestion): string {
  let best = s.outgoing[0];
  for (const a of s.outgoing) if (a.value > best.value) best = a;
  return best.kind === "player" ? best.playerId : best.key;
}

/** The most valuable thing coming back. The name a reader remembers a deal by. */
function incomingLeadOf(s: TradeSuggestion): string {
  let best = s.incoming[0];
  for (const a of s.incoming) if (a.value > best.value) best = a;
  return best.kind === "player" ? best.playerId : best.key;
}

function run(overrides: Partial<TradeFinderInput> = {}) {
  return findTrades({
    myRosterId: 1,
    teams: league(),
    startingSlots: STANDARD_SLOTS,
    isDynasty: true,
    allowPicks: true,
    goal: "balanced",
    targetPlayerIds: [],
    offerPlayerIds: [],
    excludeKeys: [],
    ...overrides,
  });
}

describe("findTrades", () => {
  it("finds the deal a person would make", () => {
    const { suggestions } = run();
    expect(suggestions.length).toBeGreaterThan(0);

    const top = suggestions[0];
    // A tight end comes in, because that is the only hole this roster has.
    expect(top.incoming.some((a) => a.kind === "player" && a.position === "TE")).toBe(true);
    expect(top.mine.lineupDelta).toBeGreaterThan(0);
  });

  it("never suggests trading with yourself", () => {
    for (const s of run().suggestions) {
      expect(s.counterparty.rosterId).not.toBe(1);
    }
  });

  it("never puts the same asset on both sides", () => {
    for (const s of run().suggestions) {
      const inIds = s.incoming.map((a) => (a.kind === "player" ? a.playerId : a.key));
      const outIds = s.outgoing.map((a) => (a.kind === "player" ? a.playerId : a.key));
      expect(inIds.filter((id) => outIds.includes(id))).toEqual([]);
    }
  });

  it("only ever offers assets the reader actually holds", () => {
    const mine = new Set(league()[0].players.map((p) => p.playerId));
    const myPicks = new Set(league()[0].picks.map((p) => p.key));
    for (const s of run().suggestions) {
      for (const asset of s.outgoing) {
        if (asset.kind === "player") expect(mine.has(asset.playerId)).toBe(true);
        else expect(myPicks.has(asset.key)).toBe(true);
      }
    }
  });

  it("shows one at a time: excluding the top deal surfaces the next one", () => {
    const first = run().suggestions[0];
    const second = run({ excludeKeys: [first.key] }).suggestions[0];
    expect(second).toBeDefined();
    expect(second.key).not.toBe(first.key);
  });

  it("keeps passing until it runs out, and never repeats", () => {
    const seen: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      const next = run({ excludeKeys: seen }).suggestions[0];
      if (!next) break;
      expect(seen).not.toContain(next.key);
      seen.push(next.key);
    }
    expect(seen.length).toBeGreaterThan(1);
  });

  it("does not follow a deal with a near-copy of the same deal", () => {
    const first = run().suggestions[0];
    const second = run({ excludeKeys: [first.key] }).suggestions[0];
    const targetOf = (s: typeof first) =>
      `${s.counterparty.rosterId}|${s.incoming
        .map((a) => (a.kind === "player" ? a.playerId : a.key))
        .sort()
        .join(",")}`;
    // Passing has to feel like it did something. Three ways of paying for the
    // same player, one after another, reads as a broken button.
    expect(targetOf(second)).not.toBe(targetOf(first));
  });

  it("still reaches the alternative packages for a player, just later", () => {
    const all = run().suggestions;
    const firstTarget = `${all[0].counterparty.rosterId}|${all[0].incoming
      .map((a) => (a.kind === "player" ? a.playerId : a.key))
      .sort()
      .join(",")}`;
    const sameTarget = all.filter(
      (s) =>
        `${s.counterparty.rosterId}|${s.incoming
          .map((a) => (a.kind === "player" ? a.playerId : a.key))
          .sort()
          .join(",")}` === firstTarget,
    );
    // Spreading is a reordering, not a filter.
    expect(sameTarget.length).toBeGreaterThan(0);
  });

  it("returns the same order every run, so a pass advances rather than reshuffles", () => {
    const once = run().suggestions.map((s) => s.key);
    const twice = run().suggestions.map((s) => s.key);
    expect(once).toEqual(twice);
  });

  it("answers what it would take for a named player", () => {
    const { suggestions } = run({ targetPlayerIds: ["th-te1"] });
    expect(suggestions.length).toBeGreaterThan(0);
    for (const s of suggestions) {
      expect(s.incoming).toHaveLength(1);
      expect(s.incoming[0].kind === "player" && s.incoming[0].playerId).toBe("th-te1");
      expect(s.counterparty.rosterId).toBe(2);
    }
  });

  it("answers what a named player brings back", () => {
    const { suggestions } = run({ offerPlayerIds: ["my-rb3"] });
    expect(suggestions.length).toBeGreaterThan(0);
    for (const s of suggestions) {
      expect(
        s.outgoing.some((a) => a.kind === "player" && a.playerId === "my-rb3"),
      ).toBe(true);
    }
  });

  it("gives up when the named player is not on the roster", () => {
    expect(run({ offerPlayerIds: ["not-mine"] }).suggestions).toEqual([]);
  });

  it("never trades a pick in a redraft league", () => {
    const { suggestions } = run({ isDynasty: false, allowPicks: false });
    for (const s of suggestions) {
      expect([...s.incoming, ...s.outgoing].some((a) => a.kind === "pick")).toBe(false);
    }
  });

  it("brings back picks when told to collect them", () => {
    const picks = run({ goal: "add-picks" }).suggestions;
    expect(picks.length).toBeGreaterThan(0);
    // The goal is a constraint, so EVERY suggestion honours it, not just the
    // top one. A reader who asked for picks never sees a deal without one.
    for (const s of picks) expect(s.mine.pickCountDelta).toBeGreaterThan(0);
  });

  it("does not restrict a pick search to picks only", () => {
    // "Obtain draft picks" names what must come back, not what may not, so a
    // pick alongside a player is squarely the thing being asked for. Refusing
    // that shape would hide the best version of the deal.
    const picks = run({ goal: "add-picks" }).suggestions;
    expect(picks.some((s) => s.incoming.some((a) => a.kind === "player"))).toBe(true);
  });

  it("returns something for every goal, not just the right shape of nothing", () => {
    // Each of these asserted the shape of whatever came back and never that
    // anything did, so a goal whose constraints could not be satisfied passed
    // silently. Two of them could not be satisfied.
    for (const goal of TRADE_GOALS) {
      const { suggestions } = run({ goal: goal.key });
      expect(suggestions.length, `${goal.key} returned nothing`).toBeGreaterThan(0);
    }
  });

  it("honours the shape goals", () => {
    expect(run({ goal: "consolidate" }).suggestions.length).toBeGreaterThan(0);
    expect(run({ goal: "split-assets" }).suggestions.length).toBeGreaterThan(0);
    for (const s of run({ goal: "consolidate" }).suggestions) {
      expect(s.outgoing.length).toBeGreaterThan(s.incoming.length);
      // Fewer pieces is not the point on its own; the piece coming back has to
      // be better than anything that left.
      const inTop = Math.max(...s.incoming.map((a) => a.value));
      const outTop = Math.max(...s.outgoing.map((a) => a.value));
      expect(inTop).toBeGreaterThan(outTop);
    }
    for (const s of run({ goal: "split-assets" }).suggestions) {
      expect(s.incoming.length).toBeGreaterThan(s.outgoing.length);
      const inTop = Math.max(...s.incoming.map((a) => a.value));
      const outTop = Math.max(...s.outgoing.map((a) => a.value));
      expect(outTop).toBeGreaterThan(inTop);
    }
    for (const s of run({ goal: "get-younger" }).suggestions) {
      if (s.mine.ageDelta !== null) expect(s.mine.ageDelta).toBeLessThan(0);
    }
  });

  it("lets a named player override the goal, because it is the more specific ask", () => {
    // th-te1 costs value and adds no picks, so an add-picks filter would drop
    // him. Naming him is the reader saying they want this answer anyway.
    const { suggestions } = run({ goal: "add-picks", targetPlayerIds: ["th-te1"] });
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions[0].incoming[0]).toMatchObject({ playerId: "th-te1" });
  });

  it("reports lineup impact as unavailable rather than zero with no projections", () => {
    const noProjections = league().map((t) => ({
      ...t,
      players: t.players.map((p) => ({ ...p, projPoints: null })),
    }));
    const result = findTrades({
      myRosterId: 1,
      teams: noProjections,
      startingSlots: STANDARD_SLOTS,
      isDynasty: true,
      allowPicks: true,
      goal: "balanced",
      targetPlayerIds: [],
      offerPlayerIds: [],
      excludeKeys: [],
    });
    expect(result.lineupUnavailable).toBe(true);
    for (const s of result.suggestions) {
      expect(s.mine.lineupDelta).toBeNull();
      // The caveat has to say so, or a reader is left to assume we checked.
      expect(s.caveats.join(" ")).toContain("value alone");
    }
  });

  it("has nothing to say when the reader is not in the league", () => {
    expect(run({ myRosterId: 99 }).suggestions).toEqual([]);
  });

  it("writes an explanation that names both sides", () => {
    const top = run().suggestions[0];
    expect(top.headline).toContain("Send");
    expect(top.headline).toContain(top.counterparty.teamName);
    expect(top.whyYou.length).toBeGreaterThan(10);
    expect(top.whyThem).toContain(top.counterparty.teamName);
  });

  it("keeps the two sides close on value", () => {
    for (const s of run().suggestions.slice(0, 5)) {
      // The balancing band is what stops a suggestion reading as a lowball.
      expect(s.valueGap).toBeLessThanOrEqual(0.25);
    }
  });
});

describe("findTrades consolidation and variety", () => {
  it("never pays for a starter with a pile of pieces worth under half of him", () => {
    for (const s of run({ quality: { config: DEFAULT_TRADE_QUALITY_CONFIG, poolMax: 9900 } })
      .suggestions) {
      const best = Math.max(
        ...s.incoming.map((a) => a.value),
        ...s.outgoing.map((a) => a.value),
      );
      const throwIns = s.outgoing.filter((a) => a.value < best * 0.5).length;
      // Two throw-ins is a package. Three is the shape this engine used to
      // produce and the reason the feature reads as unfair.
      expect(throwIns).toBeLessThan(3);
    }
  });

  it("reports a quality ratio on every suggestion, near level", () => {
    // Measured against the RELAXED bands, which are the outer edge of anything
    // the engine can emit. It searches on the strict bands first and only widens
    // when that came up short, and a test cannot see which pass produced a given
    // deal, so the invariant worth asserting is that nothing escapes the wider
    // pair either. Pinned to the constants rather than to numbers, so tuning the
    // bands cannot leave this quietly checking a band that no longer exists.
    for (const s of run().suggestions) {
      expect(Number.isFinite(s.qualityRatio)).toBe(true);
      expect(s.qualityRatio).toBeGreaterThan(1 - RELAXED_TOLERANCES.qualityUnder);
      expect(s.qualityRatio).toBeLessThan(1 + RELAXED_TOLERANCES.qualityOver);
    }
  });

  it("never repeats both ends of a deal back to back", () => {
    // The promise the walk can actually keep, and the one that matters. A card
    // that repeats the previous card's payment AND the player coming back is
    // the same idea printed twice; repeating one of the two, with the other
    // fresh, is a genuine alternative and there are leagues where the field
    // offers nothing else. Asserting an absolute per-axis rule on both axes at
    // once asks for something no ordering of a finite list can deliver, and the
    // version of this test that did was passing only because the other axis was
    // silently taking the hit.
    const { suggestions } = run();
    for (let i = 1; i < suggestions.length; i += 1) {
      const sameOut = outgoingLeadOf(suggestions[i]) === outgoingLeadOf(suggestions[i - 1]);
      const sameIn = incomingLeadOf(suggestions[i]) === incomingLeadOf(suggestions[i - 1]);
      expect(sameOut && sameIn).toBe(false);
    }
  });

  it("keeps the payment varied across the shortlist", () => {
    const { suggestions } = run();
    const leads = new Set(suggestions.map(outgoingLeadOf));
    expect(leads.size).toBeGreaterThanOrEqual(
      Math.min(4, Math.ceil(suggestions.length / 2)),
    );
  });

  it("is still deterministic: two runs return the same order", () => {
    const a = run().suggestions.map((s) => s.key);
    const b = run().suggestions.map((s) => s.key);
    expect(a).toEqual(b);
  });
});

describe("findTrades counterparty spread", () => {
  it("does not put consecutive suggestions with the same team", () => {
    const { suggestions } = run();
    for (let i = 1; i < suggestions.length; i += 1) {
      const rest = suggestions.slice(i).map((s) => s.counterparty.rosterId);
      // The only allowed repeat is when every deal left is with one team.
      if (rest.every((id) => id === rest[0])) break;
      expect(suggestions[i].counterparty.rosterId).not.toBe(
        suggestions[i - 1].counterparty.rosterId,
      );
    }
  });

  it("drops nothing while spreading", () => {
    const spread = run().suggestions;
    const keys = new Set(spread.map((s) => s.key));
    expect(keys.size).toBe(spread.length);
  });
});

/**
 * The failure these describe was found in production, not in a fixture: asked
 * for twelve ideas, the engine returned twelve different players coming back
 * for the same two or three going out. In the worst real league the reader held
 * fourteen tradeable assets and saw three of them across all forty ranked deals,
 * and their best player was never mentioned once.
 */
describe("findTrades variety on the paying side", () => {
  const headlineOut = (s: TradeSuggestion) => {
    let best = s.outgoing[0];
    for (const a of s.outgoing) if (a.value > best.value) best = a;
    return best.kind === "player" ? best.playerId : best.key;
  };

  it("varies what the reader sends, not only what comes back", () => {
    const window = run().suggestions.slice(0, 8);
    const outgoing = new Set(window.map(headlineOut));
    const incoming = new Set(
      window.map((s) =>
        s.incoming
          .map((a) => (a.kind === "player" ? a.playerId : a.key))
          .sort()
          .join(","),
      ),
    );
    // Both ends, not just the one that was already varied.
    expect(incoming.size).toBe(window.length);
    expect(outgoing.size).toBeGreaterThanOrEqual(window.length - 1);
  });

  it("offers assets the currency pool could never have reached", () => {
    const teams = league();
    const mine = teams.find((t) => t.rosterId === 1)!;
    const baselines = leagueStarterBaselines(teams, STANDARD_SLOTS);
    const profile = buildTeamProfile(mine, STANDARD_SLOTS, baselines);
    const currency = new Set(
      givablePool(profile, {
        goal: "balanced",
        offerPlayerIds: [],
        allowPicks: true,
      }).map(assetId),
    );

    const offered = new Set(
      run().suggestions.flatMap((s) =>
        s.outgoing.map((a) => (a.kind === "player" ? a.playerId : a.key)),
      ),
    );
    // Currency is what a roster can afford to lose, which is deliberately
    // narrow. A manager asking what their good players are worth is asking a
    // reasonable question, and before the coverage pass the answer was silence.
    const beyondCurrency = [...offered].filter((id) => !currency.has(id));
    expect(beyondCurrency.length).toBeGreaterThan(0);
  });

  it("finds a deal for a starter the reader would otherwise never be offered for", () => {
    const offered = new Set(
      run().suggestions.flatMap((s) =>
        s.outgoing.map((a) => (a.kind === "player" ? a.playerId : a.key)),
      ),
    );
    // my-rb1 is the second most valuable asset on the roster and holds a
    // starting slot, so no amount of balancing against somebody else's spare
    // parts would ever put him on the table.
    expect(offered.has("my-rb1")).toBe(true);
  });

  it("still opens on the best realistic deal in the league", () => {
    // "Best" means best among the deals that clear the strict fairness band.
    // The search runs on a wider band so a quiet league still has answers, and
    // a wider-band deal always scores well for the reader, because the reader's
    // side of a generous trade is the side that looks good. Opening on one would
    // be the lopsided-offer failure the acceptance discount already exists to
    // prevent, arriving through a different door.
    const { suggestions } = run();
    const opener = suggestions[0];
    const strictBand = (s: (typeof suggestions)[number]) =>
      s.qualityRatio >= 1 - PACKAGE_LIMITS.QUALITY_UNDER_TOLERANCE &&
      s.qualityRatio <= 1 + PACKAGE_LIMITS.QUALITY_OVER_TOLERANCE &&
      s.valueGap <= PACKAGE_LIMITS.OVER_TOLERANCE;
    expect(strictBand(opener)).toBe(true);

    const bestStrict = Math.max(
      ...suggestions.filter(strictBand).map((s) => s.score),
    );
    expect(opener.score).toBe(bestStrict);
  });

  it("keeps every suggestion inside the fairness band, coverage included", () => {
    for (const s of run({
      quality: { config: DEFAULT_TRADE_QUALITY_CONFIG, poolMax: 9900 },
    }).suggestions) {
      // Variety is bought from the ordering and from which questions get asked,
      // never from loosening what counts as a fair trade. The bound is the
      // relaxed band, which is the widest the engine will ever go, so this still
      // proves the coverage pass is gated by the same arithmetic as every other
      // suggestion rather than waved through.
      expect(s.qualityRatio).toBeGreaterThan(1 - RELAXED_TOLERANCES.qualityUnder);
      expect(s.qualityRatio).toBeLessThan(1 + RELAXED_TOLERANCES.qualityOver);
    }
  });

  it("advances the queue on a pass rather than rebuilding it", () => {
    const first = run().suggestions;
    const after = run({ excludeKeys: [first[0].key] }).suggestions;
    expect(after.map((s) => s.key)).not.toContain(first[0].key);

    // A pass counts against the tallies exactly as a shown deal does, so the
    // search takes the same path it took before and the reader keeps moving
    // through one queue. Measured against production leagues this carries nine
    // or ten of the next eleven; a wholesale reshuffle would carry far fewer.
    const before = new Set(first.map((s) => s.key));
    const carried = after.filter((s) => before.has(s.key)).length;
    expect(carried).toBeGreaterThanOrEqual(after.length - 2);
  });
});

/**
 * A league built around one expensive player, because that is the shape the
 * "no trades found" reports all had in common.
 *
 * The reader owns a quarterback worth far more than any spare part in the
 * league. Every counterparty has good players of their own, but nothing they
 * could shrug off is within a factor of two of him, so no single piece from
 * anybody's bench can pay for him and no package of bench pieces gets close.
 *
 * A person looking at this has an easy answer: swap him for one of the other
 * good quarterbacks or receivers, which is what those managers would want to
 * talk about. The engine has to be able to say so.
 */
function starLeague(): FinderTeam[] {
  const depth = (prefix: string, base: number) => [
    player({ playerId: `${prefix}-rb1`, position: "RB", projPoints: 13, value: base }),
    player({ playerId: `${prefix}-rb2`, position: "RB", projPoints: 11, value: base - 400 }),
    player({ playerId: `${prefix}-wr2`, position: "WR", projPoints: 12, value: base - 200 }),
    player({ playerId: `${prefix}-wr3`, position: "WR", projPoints: 9, value: base - 900 }),
    player({ playerId: `${prefix}-te1`, position: "TE", projPoints: 9, value: base - 800 }),
    player({ playerId: `${prefix}-rb3`, position: "RB", projPoints: 7, value: base - 1100 }),
    player({ playerId: `${prefix}-wr4`, position: "WR", projPoints: 6, value: base - 1300 }),
    player({ playerId: `${prefix}-qb2`, position: "QB", projPoints: 8, value: base - 1400 }),
  ];

  return [
    team({
      rosterId: 1,
      teamName: "My Team",
      statusKey: "competitor",
      players: [
        // The star. Worth more than twice anything anyone would part with.
        player({ playerId: "my-star-qb", position: "QB", projPoints: 26, value: 8000, age: 28 }),
        ...depth("my", 2000),
      ],
      picks: [pick({ key: "pick:2027:1:1", value: 2600 })],
    }),
    team({
      rosterId: 2,
      teamName: "Rebuild City",
      statusKey: "rebuilder",
      players: [
        player({ playerId: "th-star-wr", position: "WR", projPoints: 21, value: 7600, age: 24 }),
        ...depth("th", 1900),
      ],
      picks: [pick({ key: "pick:2027:1:2", value: 2500 })],
    }),
    team({
      rosterId: 3,
      teamName: "The Middle",
      statusKey: "middle",
      players: [
        player({ playerId: "mid-star-rb", position: "RB", projPoints: 20, value: 7800, age: 25 }),
        ...depth("mid", 1800),
      ],
      picks: [pick({ key: "pick:2027:2:3", value: 1200 })],
    }),
  ];
}

function runStar(overrides: Partial<TradeFinderInput> = {}) {
  return findTrades({
    myRosterId: 1,
    teams: starLeague(),
    startingSlots: STANDARD_SLOTS,
    isDynasty: true,
    allowPicks: true,
    goal: "balanced",
    targetPlayerIds: [],
    offerPlayerIds: [],
    excludeKeys: [],
    quality: { config: DEFAULT_TRADE_QUALITY_CONFIG, poolMax: 9900 },
    ...overrides,
  });
}

describe("findTrades naming a player", () => {
  it("answers what a star brings back, not silence", () => {
    // The reported failure, exactly: the engine offers a deal involving a star,
    // the reader types that star's name into "player you would move", and is
    // told no trade could be found. The anchored search that built the original
    // deal used to be switched OFF the moment a player was named, so the only
    // remaining question was "which of their spare parts costs as much as him",
    // and the answer to that is always none.
    const { suggestions } = runStar({ offerPlayerIds: ["my-star-qb"] });
    expect(suggestions.length).toBeGreaterThan(0);
    for (const s of suggestions) {
      expect(
        s.outgoing.some((a) => a.kind === "player" && a.playerId === "my-star-qb"),
      ).toBe(true);
    }
  });

  it("brings back real players for a star, not a pile of bench pieces", () => {
    const { suggestions } = runStar({ offerPlayerIds: ["my-star-qb"] });
    const best = Math.max(
      ...suggestions.flatMap((s) => s.incoming.map((a) => a.value)),
    );
    // Somebody comparable has to be in the answer. A return made entirely of
    // depth would be the lowball this engine spends most of its effort refusing.
    expect(best).toBeGreaterThan(5000);
  });

  it("reaches more than one manager when several could do the deal", () => {
    const { suggestions } = runStar({ offerPlayerIds: ["my-star-qb"] });
    const partners = new Set(suggestions.map((s) => s.counterparty.rosterId));
    expect(partners.size).toBeGreaterThan(1);
  });

  it("answers what a star would cost when the reader wants one", () => {
    const { suggestions } = runStar({ targetPlayerIds: ["th-star-wr"] });
    expect(suggestions.length).toBeGreaterThan(0);
    for (const s of suggestions) {
      expect(
        s.incoming.some((a) => a.kind === "player" && a.playerId === "th-star-wr"),
      ).toBe(true);
    }
    // The price has to be payable out of pieces the reader actually owns, which
    // for a player at this value means their own good ones. A currency pool of
    // bench players cannot answer the question at all.
    const paid = Math.max(...suggestions.flatMap((s) => s.outgoing.map((a) => a.value)));
    expect(paid).toBeGreaterThan(5000);
  });

  it("still finds deals for a star in a quiet league", () => {
    // Nothing here is close on value except the other stars, so the strict bands
    // alone would come up short and the relaxed pass is what keeps the panel
    // from being empty.
    expect(runStar().suggestions.length).toBeGreaterThan(0);
  });

  it("gives up honestly when the named player is not on the roster", () => {
    expect(runStar({ offerPlayerIds: ["th-star-wr"] }).suggestions).toEqual([]);
  });

  it("answers a named player whatever the goal dropdown still says", () => {
    // Naming a player is the more specific request, from either side. This held
    // only for the player the reader WANTED, and the asymmetry was fatal: the
    // anchored search always sends exactly one asset, so a named player plus
    // Consolidate could never satisfy that goal's shape test and every star on
    // the roster returned nothing at all.
    for (const goal of TRADE_GOALS) {
      const { suggestions } = runStar({ goal: goal.key, offerPlayerIds: ["my-star-qb"] });
      expect(
        suggestions.length,
        `${goal.key} with a named player returned nothing`,
      ).toBeGreaterThan(0);
    }
  });
});

/**
 * A smooth value curve across four rosters, which is what a real dynasty league
 * looks like: a couple of stars, a long shoulder of startable pieces, then
 * depth, with no cliff anywhere.
 *
 * The shape goals need this. Consolidating is "two of mine for one better one",
 * and whether that is constructible at all depends on the league having
 * something in range of a pair, which the small hand-built fixture above does
 * not: it has three teams and a gap in the middle of its value distribution.
 */
const CURVE_POSITIONS = [
  "WR", "RB", "QB", "WR", "RB", "TE", "WR",
  "RB", "WR", "TE", "QB", "RB", "WR", "RB",
];

function curvedRoster(prefix: string, top: number, seed: number) {
  return CURVE_POSITIONS.map((position, i) =>
    player({
      playerId: `${prefix}-${i}`,
      position,
      value: Math.round(top * Math.pow(0.86, i)) + ((seed * (i + 1)) % 90),
      projPoints: Math.max(1, 22 - i * 1.5),
      age: 22 + ((seed + i * 3) % 9),
    }),
  );
}

function curvedLeague(): FinderTeam[] {
  return [
    team({
      rosterId: 1,
      teamName: "Mine",
      statusKey: "competitor",
      players: curvedRoster("a", 7000, 1),
      picks: [
        pick({ key: "pk:a1", value: 2400 }),
        pick({ key: "pk:a2", round: 2, value: 1100 }),
      ],
    }),
    team({
      rosterId: 2,
      teamName: "Rebuild",
      statusKey: "rebuilder",
      players: curvedRoster("b", 7400, 2),
      picks: [pick({ key: "pk:b1", value: 2500 })],
    }),
    team({
      rosterId: 3,
      teamName: "Middle",
      statusKey: "middle",
      players: curvedRoster("c", 6800, 3),
      picks: [pick({ key: "pk:c1", value: 1400 })],
    }),
    team({
      rosterId: 4,
      teamName: "Contend",
      statusKey: "competitor",
      players: curvedRoster("d", 6400, 4),
      picks: [pick({ key: "pk:d1", value: 900 })],
    }),
  ];
}

function runCurved(goal: TradeFinderInput["goal"]) {
  return findTrades({
    myRosterId: 1,
    teams: curvedLeague(),
    startingSlots: STANDARD_SLOTS,
    isDynasty: true,
    allowPicks: true,
    goal,
    targetPlayerIds: [],
    offerPlayerIds: [],
    excludeKeys: [],
    quality: { config: DEFAULT_TRADE_QUALITY_CONFIG, poolMax: 9900 },
  });
}

describe("findTrades shape goals on a realistic roster curve", () => {
  it("consolidates: two pieces out, one better one back", () => {
    // This returned NOTHING before the anchored search learned to send more than
    // one asset. Consolidation was left entirely to the browse loop, which fixes
    // the incoming side from what the other team can spare, and what a team can
    // spare is by definition not a tier above what the reader is sending. So the
    // one goal whose whole purpose is moving up a tier could only ever be
    // offered deals that did not.
    const { suggestions } = runCurved("consolidate");
    expect(suggestions.length).toBeGreaterThan(3);
    for (const s of suggestions) {
      expect(s.outgoing.length).toBeGreaterThanOrEqual(2);
      expect(s.incoming).toHaveLength(1);
      const outTop = Math.max(...s.outgoing.map((a) => a.value));
      expect(s.incoming[0].value).toBeGreaterThan(outTop);
    }
  });

  it("pays for a consolidation with a pick when that is what closes the gap", () => {
    // "Two players and a draft pick or something" is the shape managers actually
    // describe, so a pick has to be spendable currency here.
    const { suggestions } = runCurved("consolidate");
    expect(suggestions.some((s) => s.outgoing.some((a) => a.kind === "pick"))).toBe(true);
  });

  it("splits an asset: one out, several back", () => {
    const { suggestions } = runCurved("split-assets");
    expect(suggestions.length).toBeGreaterThan(3);
    for (const s of suggestions) {
      expect(s.outgoing).toHaveLength(1);
      expect(s.incoming.length).toBeGreaterThanOrEqual(2);
      const inTop = Math.max(...s.incoming.map((a) => a.value));
      expect(s.outgoing[0].value).toBeGreaterThan(inTop);
    }
  });

  it("does not spend the whole consolidation shortlist on one player", () => {
    const { suggestions } = runCurved("consolidate");
    const leads = new Set(suggestions.map(outgoingLeadOf));
    expect(leads.size).toBeGreaterThan(1);
  });
});

describe("findTrades acquiring draft capital", () => {
  it("offers picks alongside players, not only bare picks", () => {
    // acquirablePool appends picks AFTER up to ten players, so a scan window
    // taken off the front of that pool held no picks on any full roster. Every
    // pair then failed the pick test and the only thing this goal could ever
    // offer was one pick on its own.
    const { suggestions } = run({ goal: "add-picks" });
    expect(suggestions.length).toBeGreaterThan(0);
    const withBoth = suggestions.filter(
      (s) =>
        s.incoming.some((a) => a.kind === "pick") &&
        s.incoming.some((a) => a.kind === "player"),
    );
    expect(withBoth.length).toBeGreaterThan(0);
  });

  it("still requires a pick in every one of them", () => {
    for (const s of run({ goal: "add-picks" }).suggestions) {
      expect(s.incoming.some((a) => a.kind === "pick")).toBe(true);
    }
  });
});

describe("findTrades variety on the acquiring side", () => {
  const leadOf = incomingLeadOf;

  it("only repeats an acquisition when the payment for it is different", () => {
    // The acquiring side is the axis the reader complained about, so it wins
    // the tie: when the ordering has to repeat one end, it repeats the payment.
    // A repeat here therefore has to come with a different price attached, or
    // the card is the previous card.
    const { suggestions } = run();
    for (let i = 1; i < suggestions.length; i += 1) {
      if (leadOf(suggestions[i]) !== leadOf(suggestions[i - 1])) continue;
      expect(outgoingLeadOf(suggestions[i])).not.toBe(outgoingLeadOf(suggestions[i - 1]));
    }
  });

  it("spreads the shortlist across several players to acquire", () => {
    // The coverage pass used to update the outgoing tally and not the incoming
    // one, so every anchor's search saw a pool where nothing had been taken yet
    // and reached for the same attractive player each time.
    const { suggestions } = run();
    const leads = new Set(suggestions.map(leadOf));
    expect(leads.size).toBeGreaterThanOrEqual(
      Math.min(4, Math.ceil(suggestions.length / 2)),
    );
  });

  it("does not spend more than a third of the shortlist on one acquisition", () => {
    const { suggestions } = run();
    const counts = new Map<string, number>();
    for (const s of suggestions) {
      const lead = leadOf(s);
      counts.set(lead, (counts.get(lead) ?? 0) + 1);
    }
    const worst = Math.max(...counts.values());
    expect(worst).toBeLessThanOrEqual(Math.ceil(suggestions.length / 3));
  });
});

describe("findTrades rationale", () => {
  it("says why every suggestion is being shown", () => {
    for (const s of run().suggestions) {
      expect(s.rationale.length).toBeGreaterThan(0);
      // It has to name the counterparty, because "why this team" is the part a
      // reader cannot work out from their own roster.
      expect(s.rationale).toContain(s.counterparty.teamName);
    }
  });

  it("says so plainly when the reader named the player", () => {
    const named = runStar({ offerPlayerIds: ["my-star-qb"] }).suggestions[0];
    expect(named.rationale).toContain("the player you named");
  });
});

/**
 * Naming a position group on either side.
 *
 * The contract is "at least one", never "only": a reader asking for a tight end
 * has not said the pick riding along with him is unwelcome. What the tests below
 * pin is that the named group is always THERE, on the side it was named for,
 * and that the two asks compose with the goals and with a named player rather
 * than quietly cancelling each other.
 */
describe("findTrades position asks", () => {
  it("brings back the position that was asked for", () => {
    const { suggestions } = run({ wantPositions: ["TE"] });
    expect(suggestions.length).toBeGreaterThan(0);
    for (const s of suggestions) {
      expect(s.incoming.some((a) => a.kind === "player" && a.position === "TE")).toBe(
        true,
      );
    }
  });

  it("sends the position that was offered", () => {
    const { suggestions } = run({ givePositions: ["RB"] });
    expect(suggestions.length).toBeGreaterThan(0);
    for (const s of suggestions) {
      expect(s.outgoing.some((a) => a.kind === "player" && a.position === "RB")).toBe(
        true,
      );
    }
  });

  it("satisfies both sides at once", () => {
    // The shape a manager actually types: move a back, get a tight end.
    const { suggestions } = run({ wantPositions: ["TE"], givePositions: ["RB"] });
    expect(suggestions.length).toBeGreaterThan(0);
    for (const s of suggestions) {
      expect(s.incoming.some((a) => a.kind === "player" && a.position === "TE")).toBe(
        true,
      );
      expect(s.outgoing.some((a) => a.kind === "player" && a.position === "RB")).toBe(
        true,
      );
    }
  });

  it("treats several groups as any one of them, not all of them", () => {
    const { suggestions } = run({ wantPositions: ["TE", "WR"] });
    expect(suggestions.length).toBeGreaterThan(0);
    for (const s of suggestions) {
      const positions = s.incoming
        .filter((a) => a.kind === "player")
        .map((a) => (a.kind === "player" ? a.position : ""));
      expect(positions.some((p) => p === "TE" || p === "WR")).toBe(true);
    }
    // And at least one of them came back without the other, or the filter is
    // behaving as an AND and the test above proves nothing.
    const single = suggestions.some((s) => {
      const positions = new Set(
        s.incoming
          .filter((a) => a.kind === "player")
          .map((a) => (a.kind === "player" ? a.position : "")),
      );
      return positions.has("TE") !== positions.has("WR");
    });
    expect(single).toBe(true);
  });

  it("does not let a pick alone answer a position ask", () => {
    // A pick has no position, so a deal made only of picks can never satisfy
    // "bring me back a tight end", however well the values line up.
    const { suggestions } = run({ goal: "add-picks", wantPositions: ["TE"] });
    for (const s of suggestions) {
      expect(s.incoming.some((a) => a.kind === "player" && a.position === "TE")).toBe(
        true,
      );
    }
  });

  it("keeps the goal's own shape alongside the position ask", () => {
    // Consolidation means two or more pieces leave. Adding "one of them is a
    // running back" must narrow that, not replace it.
    const { suggestions } = run({ goal: "consolidate", givePositions: ["RB"] });
    for (const s of suggestions) {
      expect(s.outgoing.length).toBeGreaterThanOrEqual(2);
      expect(s.outgoing.some((a) => a.kind === "player" && a.position === "RB")).toBe(
        true,
      );
    }
  });

  it("stands the ask down on the side a player was named for", () => {
    // "Get me this tight end, and take a running back off my hands." The named
    // player settles the incoming side; the outgoing ask survives him.
    const { suggestions } = run({
      targetPlayerIds: ["th-te2"],
      wantPositions: ["QB"],
      givePositions: ["RB"],
    });
    expect(suggestions.length).toBeGreaterThan(0);
    for (const s of suggestions) {
      expect(s.incoming.some((a) => a.kind === "player" && a.playerId === "th-te2")).toBe(
        true,
      );
      expect(s.outgoing.some((a) => a.kind === "player" && a.position === "RB")).toBe(
        true,
      );
    }
  });

  it("reads the ask back on the card", () => {
    const [first] = run({ wantPositions: ["TE"] }).suggestions;
    expect(first.rationale).toContain("a tight end");
  });

  it("changes nothing when no position is named", () => {
    // The empty case has to be byte-identical to the old behaviour, or every
    // reader who never touches the control gets a different engine.
    const before = run().suggestions.map((s) => s.key);
    const after = run({ wantPositions: [], givePositions: [] }).suggestions.map(
      (s) => s.key,
    );
    expect(after).toEqual(before);
  });
});

/**
 * Naming a set of players, and getting one deal for the set.
 *
 * The single-name mode answered "what does this player cost" and "what does he
 * bring back". A manager with two backs they do not need is asking a different
 * question, and asking it twice gets two answers, neither of which is the trade
 * they had in mind.
 */
describe("packages of named players", () => {
  const idsOf = (assets: TradeSuggestion["incoming"]) =>
    assets.map((a) => (a.kind === "player" ? a.playerId : a.key));

  it("sends every player named on the outgoing side, in every suggestion", () => {
    const { suggestions } = run({ offerPlayerIds: ["my-rb3", "my-wr3"] });
    expect(suggestions.length).toBeGreaterThan(0);
    for (const s of suggestions) {
      expect(idsOf(s.outgoing)).toContain("my-rb3");
      expect(idsOf(s.outgoing)).toContain("my-wr3");
    }
  });

  it("brings back every player named on the incoming side, in every suggestion", () => {
    const { suggestions } = run({ targetPlayerIds: ["th-te1", "th-te2"] });
    expect(suggestions.length).toBeGreaterThan(0);
    for (const s of suggestions) {
      expect(idsOf(s.incoming)).toContain("th-te1");
      expect(idsOf(s.incoming)).toContain("th-te2");
      // And only from the roster that holds them both.
      expect(s.counterparty.rosterId).toBe(2);
    }
  });

  it("never quotes a price for part of the package", () => {
    // Ask what two tight ends cost together and the answer must not be the price
    // of one of them, which is what an unconstrained combination walk produces.
    for (const s of run({ targetPlayerIds: ["th-te1", "th-te2"] }).suggestions) {
      const players = s.incoming.filter((a) => a.kind === "player");
      expect(players.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("says the players are on different teams rather than going quiet", () => {
    const result = run({ targetPlayerIds: ["th-te1", "mid-te1"] });
    expect(result.suggestions).toEqual([]);
    expect(result.notice).toBe("targets-split");
  });

  it("says so when a named player is nowhere in the league", () => {
    const result = run({ targetPlayerIds: ["nobody-at-all"] });
    expect(result.suggestions).toEqual([]);
    expect(result.notice).toBe("targets-missing");
  });

  it("says so when a player the reader would send has no value", () => {
    const result = run({ offerPlayerIds: ["not-on-my-roster"] });
    expect(result.suggestions).toEqual([]);
    expect(result.notice).toBe("offers-missing");
  });

  it("does not claim two players are on different teams when one is unpriced", () => {
    // Both tight ends sit on roster 2, but one has no value row. Reporting
    // that as "different teams" states something about the league the reader
    // can see is false on the next tab, and sends them to move a chip that
    // was never the problem.
    const teams = league().map((t) =>
      t.rosterId === 2
        ? {
            ...t,
            players: t.players.map((p) =>
              p.playerId === "th-te2" ? { ...p, value: 0, hasValue: false } : p,
            ),
          }
        : t,
    );
    const result = run({ teams, targetPlayerIds: ["th-te1", "th-te2"] });
    expect(result.suggestions).toEqual([]);
    expect(result.notice).toBe("targets-unpriced");
  });

  it("says the package is unaffordable when the pieces were all on the table", () => {
    // Four of the other roster's best players at once. They are all there, we
    // can price every one, and nothing on this roster adds up to them, which
    // is a different problem from any of the three above.
    const result = run({
      targetPlayerIds: ["th-qb", "th-wr1", "th-wr2", "th-te1"],
    });
    if (result.suggestions.length === 0) {
      expect(result.notice).toBe("targets-unaffordable");
    } else {
      // If a league this size can somehow pay for it, the notice must be
      // absent rather than wrong.
      expect(result.notice).toBeNull();
    }
  });

  it("honours a pin on BOTH sides at once", () => {
    const { suggestions } = run({
      targetPlayerIds: ["th-te1"],
      offerPlayerIds: ["my-rb3"],
    });
    for (const s of suggestions) {
      expect(idsOf(s.incoming)).toContain("th-te1");
      expect(idsOf(s.outgoing)).toContain("my-rb3");
    }
  });

  it("keeps a four-player outgoing package whole", () => {
    const named = ["my-rb3", "my-wr3", "my-rb4", "my-wr4"];
    for (const s of run({ offerPlayerIds: named }).suggestions) {
      for (const id of named) expect(idsOf(s.outgoing)).toContain(id);
      expect(s.outgoing.length).toBeLessThanOrEqual(
        PACKAGE_LIMITS.MAX_PINNED_OUTGOING,
      );
    }
  });

  it("carries no notice when it actually found something", () => {
    const result = run({ targetPlayerIds: ["th-te1"] });
    expect(result.suggestions.length).toBeGreaterThan(0);
    expect(result.notice).toBeNull();
  });

  it("treats a repeated name as one player rather than two", () => {
    for (const s of run({ offerPlayerIds: ["my-rb3", "my-rb3"] }).suggestions) {
      expect(idsOf(s.outgoing).filter((id) => id === "my-rb3")).toHaveLength(1);
    }
  });

  it("keeps a named package inside what a side may carry", () => {
    for (const s of run({ offerPlayerIds: ["my-rb3", "my-wr3", "my-rb4"] }).suggestions) {
      expect(s.outgoing.length).toBeLessThanOrEqual(
        PACKAGE_LIMITS.MAX_PINNED_OUTGOING,
      );
      expect(s.outgoing.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("still answers a single name exactly as it always did", () => {
    const { suggestions } = run({ offerPlayerIds: ["my-rb3"] });
    expect(suggestions.length).toBeGreaterThan(0);
    for (const s of suggestions) expect(idsOf(s.outgoing)).toContain("my-rb3");
  });
});

/**
 * The ranking is not the same for every team in the league any more.
 *
 * Both readers below own the identical roster and face the identical league. The
 * only difference is where Power Pulse has them, and that has to change what
 * comes back first, or the feature is still handing every manager the same
 * advice and calling it personal.
 */
describe("suggestions weighted by the reader's Power Pulse standing", () => {
  /** The same league, with a Power Pulse snapshot on every team. */
  function scheduled(): FinderTeam[] {
    return league().map((t) => ({ ...t, pulse: pulse() }));
  }

  const topFor = (statusKey: "competitor" | "rebuilder") => {
    const teams = scheduled().map((t) =>
      t.rosterId === 1 ? { ...t, statusKey } : t,
    );
    return findTrades({
      myRosterId: 1,
      teams,
      startingSlots: STANDARD_SLOTS,
      isDynasty: true,
      allowPicks: true,
      goal: "balanced",
      targetPlayerIds: [],
      offerPlayerIds: [],
      excludeKeys: [],
    });
  };

  it("puts projected wins on every suggestion once Power Pulse has scored the league", () => {
    for (const s of topFor("competitor").suggestions) {
      expect(s.mine.winsDelta).not.toBeNull();
      // Same sign as the lineup change it was converted from.
      if (s.mine.lineupDelta !== null && Math.abs(s.mine.lineupDelta) > 0.01) {
        expect(Math.sign(s.mine.winsDelta as number)).toBe(
          Math.sign(s.mine.lineupDelta),
        );
      }
    }
  });

  it("leads a contender with a deal that adds points on Sunday", () => {
    const top = topFor("competitor").suggestions[0];
    expect(top.mine.lineupDelta).not.toBeNull();
    expect(top.mine.lineupDelta as number).toBeGreaterThan(0);
  });

  it("does not hand a contender and a rebuilder the same shortlist", () => {
    // The two readers own the same roster in the same league. The deals that
    // exist are the same deals; what has to change is which of them the reader
    // is shown first. Measured on the one distinction that separates the two
    // timelines: how far down the list a deal that adds trade value sits.
    const rankOfValueDeal = (result: ReturnType<typeof topFor>) =>
      result.suggestions.findIndex((s) => s.mine.valueDelta > 300);

    const contender = rankOfValueDeal(topFor("competitor"));
    const rebuilder = rankOfValueDeal(topFor("rebuilder"));
    expect(rebuilder).toBeGreaterThanOrEqual(0);
    expect(rebuilder).toBeLessThan(contender);
  });

  it("offers a rebuilder draft capital and does not offer it to a contender", () => {
    // A pick coming back is the shape of a rebuild and noise on a roster trying
    // to win this season, and the acquirable pool has always known that. This
    // locks the behaviour down now that the reader's standing is what decides
    // it end to end.
    expect(
      topFor("rebuilder").suggestions.some((s) => s.mine.pickCountDelta > 0),
    ).toBe(true);
    expect(
      topFor("competitor").suggestions.some((s) => s.mine.pickCountDelta > 0),
    ).toBe(false);
  });

  it("lets a contender spend its own pick and never asks a rebuilder to", () => {
    expect(
      topFor("competitor").suggestions.some((s) => s.mine.pickCountDelta < 0),
    ).toBe(true);
    expect(
      topFor("rebuilder").suggestions.some((s) => s.mine.pickCountDelta < 0),
    ).toBe(false);
  });

  it("names the reader's own footing on the card", () => {
    expect(topFor("competitor").suggestions[0].rationale).toContain("competing");
    expect(topFor("rebuilder").suggestions[0].rationale).toContain("out of the race");
  });

  it("leaves a league with no Power Pulse ranking exactly as it was", () => {
    // Every team unscored, so nothing here has a wins figure and the ordering is
    // the pre-Power-Pulse one. This is the guard against the new weighting
    // quietly applying to leagues that told us nothing.
    for (const s of run().suggestions) expect(s.mine.winsDelta).toBeNull();
  });
});

/**
 * A one-year league has one timeline.
 *
 * Nothing carries over, so trade value is a proxy for rest-of-season production
 * rather than a store of anything, and a team at the bottom of the table is
 * losing rather than rebuilding. Offering that reader picks and 22-year-olds for
 * their best players describes a trade that helps neither side.
 */
describe("redraft leagues, where everybody is competing", () => {
  const redraft = (statusKey: "competitor" | "rebuilder" | "middle") =>
    findTrades({
      myRosterId: 1,
      teams: league().map((t) =>
        t.rosterId === 1 ? { ...t, statusKey, pulse: pulse() } : { ...t, pulse: pulse() },
      ),
      startingSlots: STANDARD_SLOTS,
      isDynasty: false,
      allowPicks: false,
      goal: "balanced",
      targetPlayerIds: [],
      offerPlayerIds: [],
      excludeKeys: [],
    });

  it("ranks the same way for a bottom team as for a top one", () => {
    // The standings say these two readers are opposites. In a redraft league
    // that difference is about who is WINNING, not about what either of them
    // should be trading for, so the shortlist must not diverge.
    const contender = redraft("competitor").suggestions.map((s) => s.key);
    const longshot = redraft("rebuilder").suggestions.map((s) => s.key);
    expect(longshot).toEqual(contender);
  });

  it("leads with a deal that helps this Sunday, whatever the standings say", () => {
    // The coverage pass deliberately keeps sideways and negative deals in the
    // list, so that every asset a reader owns has an answer to "what could I get
    // for him". What must never happen is one of them OPENING the shortlist for
    // a team whose only currency is this season.
    for (const statusKey of ["competitor", "rebuilder", "middle"] as const) {
      const top = redraft(statusKey).suggestions[0];
      expect(top.mine.lineupDelta ?? 0).toBeGreaterThan(0);
    }
  });

  it("never suggests a deal that costs lineup points, at any depth", () => {
    // Ranking these last was not enough, and this is the test that says why.
    // The shortlist is walked with an arrow key, so a deal sitting at position
    // nine is a deal the reader is shown; in a one-year league one that gives up
    // points every remaining week is not a worse idea than the deal above it, it
    // is the wrong answer to the only question the league can ask.
    for (const statusKey of ["competitor", "rebuilder", "middle"] as const) {
      const ranked = redraft(statusKey).suggestions;
      expect(ranked.length).toBeGreaterThan(0);
      for (const s of ranked) {
        expect(
          s.mine.lineupDelta,
          `${s.key} costs ${s.mine.lineupDelta} points a week`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it("never suggests a deal that costs projected wins", () => {
    for (const s of redraft("middle").suggestions) {
      if (s.mine.winsDelta === null) continue;
      expect(s.mine.winsDelta).toBeGreaterThan(0);
    }
  });

  it("still answers a named player with whatever he actually brings back", () => {
    // The floor is about UNPROMPTED suggestions. "What does this player bring
    // back" is a question the reader typed, and refusing to answer it because
    // the honest answer is a step sideways would leave the two name pickers
    // silently returning nothing in every redraft league.
    const { suggestions } = findTrades({
      myRosterId: 1,
      teams: league().map((t) => ({ ...t, pulse: pulse() })),
      startingSlots: STANDARD_SLOTS,
      isDynasty: false,
      allowPicks: false,
      targetPlayerIds: [],
      offerPlayerIds: ["my-rb3"],
      excludeKeys: [],
    });
    expect(suggestions.length).toBeGreaterThan(0);
    for (const s of suggestions) {
      expect(
        s.outgoing.some((a) => a.kind === "player" && a.playerId === "my-rb3"),
      ).toBe(true);
    }
  });

  it("says it is a one-year league rather than reading the standings back", () => {
    const top = redraft("rebuilder").suggestions[0];
    expect(top.rationale).toContain("one-year league");
    expect(top.rationale).not.toContain("out of the race");
    expect(top.rationale).not.toContain("Power Pulse has you competing");
  });

  it("does not put a player on the table just because he is young", () => {
    // wouldMoveStarter is an argument about the age curve, and a redraft league
    // has no age curve to trade against. What a team can spare is its bench.
    const dynastyIds = new Set(
      run({ isDynasty: true, allowPicks: false }).suggestions.flatMap((s) =>
        s.incoming.map((a) => (a.kind === "player" ? a.playerId : a.key)),
      ),
    );
    const redraftIds = new Set(
      redraft("competitor").suggestions.flatMap((s) =>
        s.incoming.map((a) => (a.kind === "player" ? a.playerId : a.key)),
      ),
    );
    // th-te2 is 23 and startable, so a dynasty contender is offered him as a
    // stash. A redraft team is not, unless he is genuine bench surplus.
    expect(dynastyIds.size).toBeGreaterThan(0);
    expect(redraftIds.size).toBeGreaterThan(0);
    for (const id of redraftIds) expect(dynastyIds.has(id)).toBe(true);
  });
});

/**
 * The two questions a dynasty manager is actually choosing between.
 *
 * "Contender" and "Value" are not two weightings of the same ranking; they are
 * two different questions, and a league that answered them the same way would
 * be a toggle that does nothing. These tests are the guarantee that it does
 * something, and that what it does is the thing on the label.
 */
describe("the dynasty strategy toggle", () => {
  const dynasty = (strategy: "contender" | "value", statusKey?: TeamStatusKey) =>
    findTrades({
      myRosterId: 1,
      teams: league().map((t) =>
        t.rosterId === 1
          ? { ...t, statusKey: statusKey ?? t.statusKey, pulse: pulse() }
          : { ...t, pulse: pulse() },
      ),
      startingSlots: STANDARD_SLOTS,
      isDynasty: true,
      allowPicks: true,
      strategy,
      targetPlayerIds: [],
      offerPlayerIds: [],
      excludeKeys: [],
    });

  it("gives both sides of the toggle something to show", () => {
    expect(dynasty("contender").suggestions.length).toBeGreaterThan(0);
    expect(dynasty("value").suggestions.length).toBeGreaterThan(0);
  });

  it("holds a contender search to the same lineup floor a redraft league gets", () => {
    // The floor is about the QUESTION, not about the league. A dynasty manager
    // who has pressed Contender has asked for deals that win them games, and a
    // deal that costs points every remaining week is not one.
    for (const s of dynasty("contender").suggestions) {
      expect(s.mine.lineupDelta).toBeGreaterThan(0);
    }
  });

  it("lets a value search take a deal that costs lineup points", () => {
    // The mirror. A value search is allowed to hand back the standard dynasty
    // trade: a starter out, more than he is worth coming back, and a worse
    // Sunday for it.
    const contender = new Set(dynasty("contender").suggestions.map((s) => s.key));
    const value = dynasty("value").suggestions;
    expect(value.some((s) => !contender.has(s.key))).toBe(true);
  });

  it("orders the two searches differently", () => {
    const contender = dynasty("contender").suggestions.map((s) => s.key);
    const value = dynasty("value").suggestions.map((s) => s.key);
    expect(value).not.toEqual(contender);
  });

  it("obeys the reader over Power Pulse's read of them", () => {
    // A rebuilder who presses Contender has decided to make a run, and the
    // stance table does not get to overrule them. Before the toggle existed
    // this reader's ranking was value-and-youth first whatever they asked for.
    const asked = dynasty("contender", "rebuilder").suggestions;
    expect(asked.length).toBeGreaterThan(0);
    for (const s of asked) expect(s.mine.lineupDelta).toBeGreaterThan(0);
  });

  it("says which question it answered, in the reader's own terms", () => {
    expect(dynasty("contender").suggestions[0].rationale).toContain(
      "asked for contender deals",
    );
    expect(dynasty("value").suggestions[0].rationale).toContain(
      "asked for value deals",
    );
  });

  it("leaves a dynasty caller that names no strategy exactly where it was", () => {
    // Absent means "we have not been told", never "contender". A caller that
    // has not thought about it still gets the stance-weighted ranking that
    // shipped before the toggle, which is what stops this from being a silent
    // behaviour change for every other consumer of the engine.
    const unset = run({ teams: league().map((t) => ({ ...t, pulse: pulse() })) });
    expect(unset.suggestions.length).toBeGreaterThan(0);
    expect(unset.suggestions.some((s) => (s.mine.lineupDelta ?? 0) <= 0)).toBe(true);
  });

  it("tells a contender with nothing to gain why the panel is empty", () => {
    // Everybody else in the league projects nothing, so no incoming player can
    // lift the reader's lineup and every deal the search builds fails the floor.
    // The honest answer is not "no trade to suggest", which reads as a search
    // that broke; it is that the search ran and found only deals that would cost
    // this team points.
    const barren = league().map((t) =>
      t.rosterId === 1
        ? { ...t, pulse: pulse() }
        : {
            ...t,
            pulse: pulse(),
            players: t.players.map((p) => ({ ...p, projPoints: 0 })),
          },
    );
    const { suggestions, notice } = findTrades({
      myRosterId: 1,
      teams: barren,
      startingSlots: STANDARD_SLOTS,
      isDynasty: false,
      allowPicks: false,
      targetPlayerIds: [],
      offerPlayerIds: [],
      excludeKeys: [],
    });
    expect(suggestions).toEqual([]);
    expect(notice).toBe("no-lineup-gain");
  });

  it("keeps the reason to itself when there is a shortlist to read instead", () => {
    // A reason printed beside a working shortlist is noise about a question the
    // reader is no longer asking.
    const { suggestions, notice } = findTrades({
      myRosterId: 1,
      teams: league().map((t) => ({ ...t, pulse: pulse() })),
      startingSlots: STANDARD_SLOTS,
      isDynasty: false,
      allowPicks: false,
      targetPlayerIds: [],
      offerPlayerIds: [],
      excludeKeys: [],
    });
    expect(suggestions.length).toBeGreaterThan(0);
    expect(notice).toBeNull();
  });
});
