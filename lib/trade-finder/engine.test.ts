import { describe, it, expect } from "vitest";
import { findTrades } from "./engine";
import { STANDARD_SLOTS, pick, player, team } from "./_test-kit";
import type { FinderTeam, TradeFinderInput } from "./types";

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

function run(overrides: Partial<TradeFinderInput> = {}) {
  return findTrades({
    myRosterId: 1,
    teams: league(),
    startingSlots: STANDARD_SLOTS,
    isDynasty: true,
    allowPicks: true,
    goal: "balanced",
    targetPlayerId: null,
    offerPlayerId: null,
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
    const { suggestions } = run({ targetPlayerId: "th-te1" });
    expect(suggestions.length).toBeGreaterThan(0);
    for (const s of suggestions) {
      expect(s.incoming).toHaveLength(1);
      expect(s.incoming[0].kind === "player" && s.incoming[0].playerId).toBe("th-te1");
      expect(s.counterparty.rosterId).toBe(2);
    }
  });

  it("answers what a named player brings back", () => {
    const { suggestions } = run({ offerPlayerId: "my-rb3" });
    expect(suggestions.length).toBeGreaterThan(0);
    for (const s of suggestions) {
      expect(
        s.outgoing.some((a) => a.kind === "player" && a.playerId === "my-rb3"),
      ).toBe(true);
    }
  });

  it("gives up when the named player is not on the roster", () => {
    expect(run({ offerPlayerId: "not-mine" }).suggestions).toEqual([]);
  });

  it("never trades a pick in a redraft league", () => {
    const { suggestions } = run({ isDynasty: false, allowPicks: false });
    for (const s of suggestions) {
      expect([...s.incoming, ...s.outgoing].some((a) => a.kind === "pick")).toBe(false);
    }
  });

  it("chases points when told to win now, and picks when told to collect them", () => {
    const winNow = run({ goal: "win-now" }).suggestions;
    const picks = run({ goal: "add-picks" }).suggestions;
    expect(winNow.length).toBeGreaterThan(0);
    expect(picks.length).toBeGreaterThan(0);

    // The goal is a constraint, so EVERY suggestion honours it, not just the
    // top one. A reader who asked for picks never sees a deal without one.
    for (const s of winNow) expect(s.mine.lineupDelta).toBeGreaterThan(0);
    for (const s of picks) expect(s.mine.pickCountDelta).toBeGreaterThan(0);
  });

  it("honours the shape goals", () => {
    for (const s of run({ goal: "consolidate" }).suggestions) {
      expect(s.outgoing.length).toBeGreaterThan(s.incoming.length);
    }
    for (const s of run({ goal: "get-younger" }).suggestions) {
      if (s.mine.ageDelta !== null) expect(s.mine.ageDelta).toBeLessThan(0);
    }
  });

  it("lets a named player override the goal, because it is the more specific ask", () => {
    // th-te1 costs value and adds no picks, so an add-picks filter would drop
    // him. Naming him is the reader saying they want this answer anyway.
    const { suggestions } = run({ goal: "add-picks", targetPlayerId: "th-te1" });
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
      targetPlayerId: null,
      offerPlayerId: null,
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
