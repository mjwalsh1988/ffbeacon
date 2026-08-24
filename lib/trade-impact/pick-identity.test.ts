import { describe, it, expect } from "vitest";
import { resolveAgainstTeam } from "./evaluate";
import { team, pick, player } from "@/lib/trade-finder/_test-kit";
import type { BuildAsset } from "./types";

/**
 * A pick is season, round AND original owner.
 *
 * WHY THIS FILE EXISTS
 * One roster in a real synced league holds NINE different 2027 1sts, from nine
 * different original owners. Across the leagues we have stored, 3,048
 * roster/season/round groups hold more than one pick, covering 7,274 picks.
 *
 * Every one of those was collapsed. `picksByKey` was keyed `k:season:round`, so
 * the last pick written won and the other eight were untradeable: the builder
 * offered one, a link could name one, and whichever one the map happened to keep
 * answered for all of them, at its own value rather than theirs.
 *
 * These tests hold the identity. The engine's own suite cannot: its fixtures
 * give every team one pick per round, which is exactly the case the bug does not
 * appear in.
 */

const asset = (
  season: number,
  round: number,
  originalRosterId?: number,
): BuildAsset => ({
  kind: "pick",
  season,
  round,
  pickPosition: "mid",
  ...(originalRosterId === undefined ? {} : { originalRosterId }),
});

/** A roster holding three 2027 1sts: its own, and two it acquired. */
function threeFirsts() {
  return team({
    rosterId: 3,
    picks: [
      pick({
        season: 2027,
        round: 1,
        originalRosterId: 3,
        isOwnPick: true,
        pickPosition: "late",
        value: 4200,
        label: "2027 R1 Late (own pick)",
      }),
      pick({
        season: 2027,
        round: 1,
        originalRosterId: 7,
        pickPosition: "early",
        value: 6000,
        label: "2027 R1 Early (via @manager7)",
      }),
      pick({
        season: 2027,
        round: 1,
        originalRosterId: 11,
        pickPosition: "mid",
        value: 5000,
        label: "2027 R1 Mid (via @manager11)",
      }),
    ],
  });
}

describe("resolving a pick against a roster", () => {
  it("finds the exact pick that was named, not a same-round substitute", () => {
    const { resolved, missing } = resolveAgainstTeam([asset(2027, 1, 7)], threeFirsts());
    expect(missing).toEqual([]);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toMatchObject({
      kind: "pick",
      originalRosterId: 7,
      value: 6000,
      pickPosition: "early",
    });
  });

  it("prices each of three 2027 firsts as itself", () => {
    // The whole point. These used to be one asset at one price.
    const { resolved } = resolveAgainstTeam(
      [asset(2027, 1, 3), asset(2027, 1, 7), asset(2027, 1, 11)],
      threeFirsts(),
    );
    expect(resolved).toHaveLength(3);
    expect(resolved.map((r) => r.kind === "pick" && r.value)).toEqual([4200, 6000, 5000]);
  });

  it("rejects a pick that roster does not hold rather than substituting one it does", () => {
    // Silently resolving to another 2027 1st would evaluate a different deal to
    // the one that was proposed, and report it as the proposed one.
    const { resolved, missing } = resolveAgainstTeam([asset(2027, 1, 12)], threeFirsts());
    expect(resolved).toEqual([]);
    expect(missing).toHaveLength(1);
    expect(missing[0]).toContain("2027 round 1");
  });

  it("carries the attribution through, so the verdict can name the pick", () => {
    const { resolved } = resolveAgainstTeam([asset(2027, 1, 3)], threeFirsts());
    expect(resolved[0]).toMatchObject({
      isOwnPick: true,
      originalRosterId: 3,
    });
  });

  it("still resolves a link written before the original owner was encoded", () => {
    // Three-part tokens decode with no originalRosterId. They fall back to the
    // first pick of that season and round, which is what they have always
    // resolved to; breaking every shared trade would be the worse answer.
    const { resolved, missing } = resolveAgainstTeam([asset(2027, 1)], threeFirsts());
    expect(missing).toEqual([]);
    expect(resolved[0]).toMatchObject({ originalRosterId: 3 });
  });

  it("resolves a legacy token to the same pick every time", () => {
    // First wins rather than last, so the answer does not depend on the order
    // the roster read happened to come back in.
    const first = resolveAgainstTeam([asset(2027, 1)], threeFirsts());
    const second = resolveAgainstTeam([asset(2027, 1)], threeFirsts());
    expect(first.resolved[0]).toEqual(second.resolved[0]);
  });

  it("never matches on the slot bucket, which is our estimate and not a fact", () => {
    // The stored pick is "early"; the asset says "mid". It still resolves,
    // because rejecting a real pick over a label we chose ourselves would be a
    // bug of our own making. Power Pulse can move that bucket between loads.
    const { resolved, missing } = resolveAgainstTeam(
      [{ kind: "pick", season: 2027, round: 1, pickPosition: "mid", originalRosterId: 7 }],
      threeFirsts(),
    );
    expect(missing).toEqual([]);
    expect(resolved[0]).toMatchObject({ originalRosterId: 7, pickPosition: "early" });
  });

  it("leaves player resolution alone", () => {
    const roster = team({
      rosterId: 3,
      players: [player({ playerId: "abc", name: "Real Guy" })],
      picks: [],
    });
    const found = resolveAgainstTeam([{ kind: "player", playerId: "abc" }], roster);
    expect(found.resolved[0]).toMatchObject({ kind: "player", name: "Real Guy" });
    const absent = resolveAgainstTeam([{ kind: "player", playerId: "nope" }], roster);
    expect(absent.resolved).toEqual([]);
    expect(absent.missing).toHaveLength(1);
  });
});
