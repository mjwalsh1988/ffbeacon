import { describe, expect, it } from "vitest";
import {
  bracketFacts,
  bracketPlacements,
  parseBracket,
  playoffStates,
  type PlayoffTeamInput,
} from "./playoffs";
import type { SleeperBracketMatch } from "@/lib/sleeper";

/**
 * A finished six team fixed bracket, shaped like the production ones
 * (playoff_seed_type 0): seeds 1 (roster 7) and 2 (roster 1) on byes, 4 v 5
 * and 3 v 6 in round one, linked forward with t2_from, then the placement
 * games for 3rd and 5th.
 */
const FIXED_SIX: SleeperBracketMatch[] = parseBracket([
  { m: 1, r: 1, t1: 12, t2: 8, w: 12, l: 8 },
  { m: 2, r: 1, t1: 10, t2: 2, w: 10, l: 2 },
  { m: 3, r: 2, t1: 7, t2: 12, w: 7, l: 12, t2_from: { w: 1 } },
  { m: 4, r: 2, t1: 1, t2: 10, w: 1, l: 10, t2_from: { w: 2 } },
  { m: 5, r: 2, p: 5, t1: 8, t2: 2, w: 8, l: 2, t1_from: { l: 1 }, t2_from: { l: 2 } },
  { m: 6, r: 3, p: 1, t1: 7, t2: 1, w: 7, l: 1, t1_from: { w: 3 }, t2_from: { w: 4 } },
  { m: 7, r: 3, p: 3, t1: 12, t2: 10, w: 12, l: 10, t1_from: { l: 3 }, t2_from: { l: 4 } },
]) as SleeperBracketMatch[];

/** The same bracket after round one only: the semifinals are still to play. */
const FIXED_SIX_ROUND_ONE: SleeperBracketMatch[] = FIXED_SIX.map((m) =>
  m.r === 1 ? m : { ...m, w: null, l: null, ...(m.r === 3 ? { t1: null, t2: null } : {}) },
);

describe("parseBracket", () => {
  it("returns null for a missing bracket and drops malformed matches", () => {
    expect(parseBracket(undefined)).toBeNull();
    expect(parseBracket({})).toBeNull();
    const parsed = parseBracket([{ m: 1, r: 1, t1: 3, t2: 4, w: null, l: null }, { r: 2 }, "x"]);
    expect(parsed).toHaveLength(1);
    expect(parsed?.[0].t1).toBe(3);
  });
});

describe("bracketFacts", () => {
  it("reads the champion, the field and every title game from a finished fixed bracket", () => {
    const facts = bracketFacts(FIXED_SIX);
    expect(facts.championRosterId).toBe(7);
    expect(facts.runnerUpRosterId).toBe(1);
    expect([...facts.field].sort((a, b) => a - b)).toEqual([1, 2, 7, 8, 10, 12]);
    // The 5th place game is not a title game, so 2 and 8 meeting there adds no result.
    expect(facts.played.has("2-8")).toBe(false);
    expect(facts.played.get("7-12")).toBe(7);
    expect([...facts.eliminated].sort((a, b) => a - b)).toEqual([1, 2, 8, 10, 12]);
  });

  it("leaves the title open while the semifinals are unplayed", () => {
    const facts = bracketFacts(FIXED_SIX_ROUND_ONE);
    expect(facts.championRosterId).toBeNull();
    expect([...facts.eliminated].sort((a, b) => a - b)).toEqual([2, 8]);
    expect(facts.played.size).toBe(2);
  });

  it("does not take a reseeded bracket's losers' games for title games", () => {
    // playoff_seed_type 1: round two carries no links, and the losers' game
    // (m3 here, 4 v 11, both round one losers) carries no p either.
    const reseeded = parseBracket([
      { m: 1, r: 1, t1: 4, t2: 6, w: 6, l: 4 },
      { m: 2, r: 1, t1: 11, t2: 1, w: 1, l: 11 },
      { m: 3, r: 2, t1: 4, t2: 11, w: 11, l: 4 },
      { m: 4, r: 2, t1: 6, t2: 1, w: 1, l: 6 },
    ]);
    const facts = bracketFacts(reseeded);
    expect(facts.played.has("4-11")).toBe(false);
    expect(facts.played.get("1-6")).toBe(1);
    expect(facts.eliminated.has(6)).toBe(true);
  });
});

describe("bracketPlacements", () => {
  const losers = parseBracket([
    { m: 1, r: 1, t1: 3, t2: 9, w: 3, l: 9 },
    { m: 2, r: 2, p: 1, t1: 3, t2: 5, w: 5, l: 3 },
  ]);

  it("places the winners bracket games and a consolation bracket after the field", () => {
    const places = bracketPlacements(FIXED_SIX, losers, 1, 6);
    expect(places.get(7)).toBe(1);
    expect(places.get(1)).toBe(2);
    expect(places.get(12)).toBe(3);
    expect(places.get(10)).toBe(4);
    expect(places.get(8)).toBe(5);
    expect(places.get(2)).toBe(6);
    expect(places.get(5)).toBe(7);
    expect(places.get(3)).toBe(8);
  });

  it("ignores a toilet bowl, whose winner is not a higher place", () => {
    const places = bracketPlacements(FIXED_SIX, losers, 0, 6);
    expect(places.has(5)).toBe(false);
    expect(places.has(3)).toBe(false);
  });
});

function team(id: number, wins: number, pointsFor: number, division?: number): PlayoffTeamInput {
  return { sleeperRosterId: id, wins, ties: 0, pointsFor, division };
}

describe("playoffStates", () => {
  const teams = [
    team(7, 11, 1500),
    team(1, 10, 1490),
    team(10, 9, 1400),
    team(12, 8, 1450),
    team(8, 8, 1300),
    team(2, 7, 1350),
    team(3, 6, 1200),
    team(5, 3, 1100),
  ];

  it("reads every team as regular season before the bracket", () => {
    const { phase, states } = playoffStates(teams, { playoffTeams: 6 }, false);
    expect(phase).toBe("regular");
    expect(states.get(7)).toEqual({ phase: "regular", seed: null, status: null, finalPlace: null });
  });

  it("seeds the field and marks who is out while the bracket is played", () => {
    const { phase, states } = playoffStates(
      teams,
      { playoffTeams: 6, winnersBracket: FIXED_SIX_ROUND_ONE },
      true,
    );
    expect(phase).toBe("playoffs");
    expect(states.get(7)).toMatchObject({ seed: 1, status: "alive" });
    expect(states.get(8)).toMatchObject({ status: "eliminated" });
    expect(states.get(3)).toMatchObject({ seed: null, status: "missed" });
  });

  it("gives the real champion and a full final order once the title game is played", () => {
    const { phase, states } = playoffStates(
      teams,
      { playoffTeams: 6, winnersBracket: FIXED_SIX, playoffType: 0 },
      true,
    );
    expect(phase).toBe("complete");
    expect(states.get(7)).toMatchObject({ status: "champion", finalPlace: 1 });
    expect(states.get(1)).toMatchObject({ status: "eliminated", finalPlace: 2 });
    expect(states.get(3)?.finalPlace).toBe(7);
    expect(states.get(5)?.finalPlace).toBe(8);
    const places = [...states.values()].map((s) => s.finalPlace).sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(places).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("lifts division winners to the top seeds", () => {
    // Roster 5 wins division 2 with a 3 win record and still takes seed 2.
    const divisional = [
      team(7, 11, 1500, 1),
      team(1, 10, 1490, 1),
      team(10, 9, 1400, 1),
      team(5, 3, 1100, 2),
    ];
    const { states } = playoffStates(divisional, { playoffTeams: 2, divisions: 2 }, true);
    expect(states.get(7)?.seed).toBe(1);
    expect(states.get(5)?.seed).toBe(2);
    expect(states.get(1)?.status).toBe("missed");
  });
});
