import { describe, expect, it } from "vitest";
import { computeRosterSwap } from "@/lib/trade-impact/roster-swap";
import { computeWaiverFit, fitForMove, type FitPlayer, type WireFitContext } from "./waiver-fit";
import * as wire from "./wire-commentary";
import * as trade from "./trade-commentary";
import { tradeTeamLines } from "./trade-commentary";
import { buildWaiverDigest, buildWaiverWriteup, type WaiverMove, type WaiverPlayer } from "./waiver-writeup";
import type { ExecutedTeamImpact } from "./trade-impact";
import type { RelayLeague, RelayTeam } from "./types";
import { buildRelayHeader } from "./header";
import { Voice, type Line } from "./voice";

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const WEEKS = [6, 7, 8];
const SLOTS = ["QB", "RB", "WR"];

function fp(
  id: string,
  position: "QB" | "RB" | "WR",
  points: number | Partial<Record<number, number>>,
  injuryStatus: string | null = null,
): FitPlayer {
  const byWeek = new Map<number, { points: number; sigma: number }>();
  for (const w of WEEKS) {
    const p = typeof points === "number" ? points : points[w];
    if (p !== undefined) byWeek.set(w, { points: p, sigma: 3 });
  }
  return { sleeperId: id, playerId: id, name: `Player ${id}`, position, injuryStatus, byWeek };
}

const base = [fp("qb", "QB", 20), fp("rb1", "RB", 14), fp("wr1", "WR", 12)];

/* -------------------------------------------------------------------------- */
/* The roster comparison                                                      */
/* -------------------------------------------------------------------------- */

describe("computeWaiverFit", () => {
  it("credits an arrival who starts every week and measures the gain", () => {
    const fit = computeWaiverFit({ slots: SLOTS, weeks: WEEKS, base, added: [fp("new", "RB", 18)], dropped: [] });
    expect(fit?.lead).toMatchObject({ name: "Player new", starts: 3, startsThisWeek: true });
    expect(fit?.lineupDelta).toBeCloseTo(4);
    expect(wire.fitKind(fit)).toBe("starter");
  });

  it("calls an arrival who never starts a bench add, with no gain", () => {
    const fit = computeWaiverFit({ slots: SLOTS, weeks: WEEKS, base, added: [fp("new", "RB", 6)], dropped: [] });
    expect(fit?.lead?.starts).toBe(0);
    expect(fit?.lineupDelta).toBe(0);
    expect(wire.fitKind(fit)).toBe("bench");
  });

  it("names the absent regular the arrival is covering, and only when the regular is visibly missing", () => {
    // rb1 has no projection in week 6 (a bye) and starts the other two weeks.
    const roster = [fp("qb", "QB", 20), fp("rb1", "RB", { 7: 14, 8: 14 }), fp("wr1", "WR", 12)];
    const fit = computeWaiverFit({ slots: SLOTS, weeks: WEEKS, base: roster, added: [fp("new", "RB", 9)], dropped: [] });
    expect(fit?.cover).toEqual({ name: "Player rb1", reason: "absent", status: null });
    expect(wire.fitKind(fit)).toBe("cover");
  });

  it("names an injury cover from the designation, not a guess", () => {
    const roster = [fp("qb", "QB", 20), fp("rb1", "RB", { 6: 0, 7: 14, 8: 14 }, "Out"), fp("wr1", "WR", 12)];
    const fit = computeWaiverFit({ slots: SLOTS, weeks: WEEKS, base: roster, added: [fp("new", "RB", 9)], dropped: [] });
    expect(fit?.cover).toEqual({ name: "Player rb1", reason: "injury", status: "out" });
  });

  it("does not invent a cover when the regular is simply worse", () => {
    const fit = computeWaiverFit({ slots: SLOTS, weeks: WEEKS, base, added: [fp("new", "RB", 18)], dropped: [] });
    expect(fit?.cover).toBeNull();
  });

  it("flags a move that cut a starter for a worse player", () => {
    const roster = [fp("qb", "QB", 20), fp("wr1", "WR", 12)];
    const fit = computeWaiverFit({
      slots: SLOTS,
      weeks: WEEKS,
      base: roster,
      added: [fp("new", "RB", 8)],
      dropped: [fp("rb1", "RB", 14)],
    });
    expect(fit?.droppedStarter).toEqual({ name: "Player rb1", starts: 3 });
    expect(fit?.lineupDelta).toBeCloseTo(-6);
    expect(wire.fitKind(fit)).toBe("worse");
  });

  it("counts two starts in a three-week window as a starter", () => {
    const fit = computeWaiverFit({
      slots: SLOTS,
      weeks: WEEKS,
      base,
      added: [fp("new", "RB", { 6: 18, 7: 18, 8: 2 })],
      dropped: [],
    });
    expect(fit?.lead?.starts).toBe(2);
    expect(wire.fitKind(fit)).toBe("starter");
  });

  it("only calls a dropped player a bench piece when the comparison measured them", () => {
    const noProjection: FitPlayer = { ...fp("ghost", "RB", 0), byWeek: new Map() };
    const fit = computeWaiverFit({
      slots: SLOTS,
      weeks: WEEKS,
      base,
      added: [fp("new", "RB", 18)],
      dropped: [fp("spare", "RB", 3), noProjection],
    });
    expect(fit?.droppedBench).toEqual(["Player spare"]);
  });

  it("returns nothing with no window, rather than a zero", () => {
    expect(computeWaiverFit({ slots: SLOTS, weeks: [], base, added: [], dropped: [] })).toBeNull();
  });
});

describe("fitForMove", () => {
  const players = new Map(
    [...base, fp("new", "RB", 18), fp("old", "RB", 4), fp("ir", "WR", 15)].map((p) => [p.sleeperId, p]),
  );
  const ctx = (startable: string[], parked: string[] = []): WireFitContext => ({
    slots: SLOTS,
    slotMap: undefined as never,
    weeks: WEEKS,
    rosters: new Map([[1, { startable, parked: new Set(parked) }]]),
    players,
  });

  it("gives the same answer whether the roster was synced before or after the move", () => {
    const before = fitForMove(ctx(["qb", "rb1", "wr1", "old"]), 1, ["new"], ["old"]);
    const after = fitForMove(ctx(["qb", "rb1", "wr1", "new"]), 1, ["new"], ["old"]);
    expect(after.fit).toEqual(before.fit);
    expect(after.fit?.lineupDelta).toBeCloseTo(4);
  });

  it("reports an arrival parked on IR instead of seating them", () => {
    const res = fitForMove(ctx(["qb", "rb1", "wr1"], ["ir"]), 1, ["ir"], []);
    expect(res.parked).toEqual(["Player ir"]);
    expect(res.fit?.lead).toBeNull();
    expect(wire.fitKind(res.fit, res.parked)).toBe("parked");
  });

  it("never counts a dropped injured player as a lost starter, even after the IR slot synced away", () => {
    const hurt = fp("hurt", "RB", 16, "IR");
    const ctxWith = (): WireFitContext => ({
      ...ctx(["qb", "rb1", "wr1"]),
      players: new Map([...players, ["hurt", hurt]]),
    });
    const res = fitForMove(ctxWith(), 1, ["new"], ["hurt"]);
    expect(res.fit?.droppedStarter).toBeNull();
    expect(res.fit?.lineupDelta).toBeCloseTo(4);
  });

  it("says nothing about a roster it could not load", () => {
    expect(fitForMove(null, 1, ["new"], [])).toEqual({ fit: null, parked: [] });
  });
});

describe("computeRosterSwap outgoing starts", () => {
  it("counts how often each departing player started before the swap", () => {
    const c = (id: string, position: "QB" | "RB" | "WR", points: number) => ({ playerId: id, position, points, sigma: 1 });
    const roster = new Map(WEEKS.map((w) => [w, [c("qb", "QB", 20), c("rb1", "RB", 14), c("rb2", "RB", 5), c("wr1", "WR", 10)]]));
    const res = computeRosterSwap({
      slots: SLOTS,
      weeks: WEEKS,
      rosterByWeek: roster,
      incomingByWeek: new Map(),
      outgoingPlayerIds: ["rb1", "rb2"],
    });
    expect(res.outgoingStartWeeks).toEqual({ rb1: 3, rb2: 0 });
  });
});

/* -------------------------------------------------------------------------- */
/* The banks                                                                  */
/* -------------------------------------------------------------------------- */

function banksOf(mod: Record<string, unknown>): Record<string, Line[]> {
  return Object.fromEntries(
    Object.entries(mod).filter(
      ([, v]) => Array.isArray(v) && v.length > 0 && typeof (v[0] as Line).heat === "number",
    ),
  ) as Record<string, Line[]>;
}
const BANKS = { ...banksOf(wire), ...banksOf(trade) };

describe("the deal banks", () => {
  it("found every bank", () => {
    expect(Object.keys(BANKS).length).toBeGreaterThan(25);
  });

  it("keep a plain line for zero harshness", () => {
    for (const [name, bank] of Object.entries(BANKS)) expect(bank.some((l) => l.heat === 0), name).toBe(true);
  });

  it("use plain ASCII and never give a player a pronoun", () => {
    for (const [name, bank] of Object.entries(BANKS)) {
      for (const line of bank) {
        expect(line.text, name).toMatch(/^[\x20-\x7e]+$/);
        expect(line.text, name).not.toMatch(/\b(he|him|his)\b/i);
      }
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Trades                                                                     */
/* -------------------------------------------------------------------------- */

function team(over: Partial<ExecutedTeamImpact>): ExecutedTeamImpact {
  return {
    rosterId: 1,
    teamName: "x",
    statusKey: null,
    statusLabel: null,
    pulseRank: null,
    valueBefore: 0,
    valueAfter: 0,
    valueDelta: 0,
    ageDelta: null,
    pickCountDelta: 0,
    lineupBefore: 100,
    lineupAfter: 100,
    lineupDelta: 0,
    weeksImproved: 0,
    weeksWorsened: 0,
    projectedWinsBefore: null,
    projectedWinsAfter: null,
    playoffOddsBefore: null,
    playoffOddsAfter: null,
    titleOddsBefore: null,
    titleOddsAfter: null,
    positionBefore: {},
    positionAfter: {},
    received: [],
    sent: [],
    departedStartWeeks: {},
    receivedStartWeeks: {},
    ...over,
  };
}

const playerAsset = (id: string, name: string, isInactive = false) =>
  ({ kind: "player", playerId: id, sleeperId: id, name, position: "RB", team: null, value: 1, age: null, projPoints: 10, isInactive }) as const;

function teamText(
  t: ExecutedTeamImpact,
  isDynasty = false,
  seed = "t",
  grade: "great" | "good" | "even" | "bad" | "awful" = "even",
  snark = 0,
): string {
  return tradeTeamLines(new Voice(seed, snark), {
    team: t,
    name: "Mgr",
    weeksLeft: 9,
    isDynasty,
    noLineup: false,
    noOdds: false,
    grade,
  }).join(" ");
}

/** True when `text` contains a filled-in copy of this template line. */
function usesLine(text: string, line: Line): boolean {
  const pattern = line.text
    .split(/\{\w+\}/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".+?");
  return new RegExp(pattern).test(text);
}
const hot = (bank: Line[]) => bank.filter((l) => l.heat > 0);

describe("tradeTeamLines", () => {
  it("credits a received starter and quotes the start count", () => {
    const text = teamText(team({ received: [playerAsset("a", "Arrival")], receivedStartWeeks: { a: 8 }, lineupDelta: 4 }));
    expect(text).toContain("Arrival");
    expect(text).toMatch(/8 of/);
  });

  it("does not praise a received starter when the lineup got weaker", () => {
    const text = teamText(team({ received: [playerAsset("a", "Arrival")], receivedStartWeeks: { a: 8 }, lineupDelta: -4 }));
    expect(text).toContain("Arrival starts 8 of Mgr's 9 remaining weeks, but the lineup still comes out weaker.");
    expect(text).not.toContain("How mature");
  });

  it("calls a non-starter a bench piece in redraft and a stash in dynasty", () => {
    const t = team({ received: [playerAsset("a", "Arrival")], receivedStartWeeks: { a: 0 } });
    expect(teamText(t, false)).toMatch(/does not crack/);
    expect(teamText(t, true)).toMatch(/next year/);
  });

  it("never calls a one-in-nine starter a starter on the way out", () => {
    const text = teamText(team({ sent: [playerAsset("s", "Leaver")], departedStartWeeks: { s: 1 }, lineupDelta: -0.2 }));
    expect(text).toContain("would only have started 1");
  });

  it("never mocks a bad number in a paragraph that opened with praise", () => {
    // A dynasty seller can be graded well for taking value while the lineup
    // and odds fall. Every seed, full snark: only the plain statements appear.
    for (const seed of ["a", "b", "c", "d", "e", "f", "g", "h"]) {
      const text = teamText(
        team({
          sent: [playerAsset("s", "Leaver")],
          departedStartWeeks: { s: 9 },
          lineupDelta: -3,
          valueDelta: 500,
          playoffOddsBefore: 0.4,
          playoffOddsAfter: 0.2,
        }),
        true,
        seed,
        "great",
        1,
      );
      for (const bank of [trade.SENT_STARTER_HURT, trade.ODDS_DOWN, trade.LINEUP_DOWN]) {
        for (const line of hot(bank)) expect(usesLine(text, line), `${seed}: ${line.text}`).toBe(false);
      }
      expect(text, seed).toContain("Leaver");
      expect(text, seed).toContain("40%");
    }
  });

  it("never cheers a good number in a paragraph that opened with a roast", () => {
    for (const seed of ["a", "b", "c", "d", "e", "f"]) {
      const text = teamText(
        team({ received: [playerAsset("a", "Arrival")], receivedStartWeeks: { a: 8 }, lineupDelta: 3 }),
        false,
        seed,
        "awful",
        1,
      );
      for (const bank of [trade.RECEIVED_STARTER, trade.LINEUP_UP]) {
        for (const line of hot(bank)) expect(usesLine(text, line), `${seed}: ${line.text}`).toBe(false);
      }
      expect(text, seed).toContain("Arrival");
    }
  });

  it("names the playoff swing when it is big enough to be the story", () => {
    const text = teamText(team({ playoffOddsBefore: 0.45, playoffOddsAfter: 0.33, lineupDelta: -4 }));
    expect(text).toContain("45%");
    expect(text).toContain("33%");
  });
});

/* -------------------------------------------------------------------------- */
/* Waivers, end to end                                                        */
/* -------------------------------------------------------------------------- */

const league: RelayLeague = {
  id: "league-1",
  sleeperLeagueId: "123",
  name: "The Test League",
  season: 2026,
  totalRosters: 12,
  pulseRankedTeams: 12,
  rosterPositions: SLOTS,
  metadata: {},
  watermarkAt: new Date(0).toISOString(),
  header: buildRelayHeader({ leagueName: "The Test League", season: 2026, totalRosters: 12, rosterPositions: SLOTS, sleeperLeague: null }),
};
const alpha: RelayTeam = {
  sleeperRosterId: 1,
  name: "Alpha",
  handle: "Alpha",
  teamName: null,
  record: { wins: 3, losses: 2, ties: 0 },
  pointsFor: 1000,
  standingsRank: 4,
};
const wp = (name: string): WaiverPlayer => ({
  name,
  position: "RB",
  nflTeam: "BUF",
  injuryStatus: null,
  projectedPoints: 8,
  value: null,
  change30dPct: null,
  positionRank: null,
});

function waiverText(fit: ReturnType<typeof computeWaiverFit>, faabSpent: number | null, seed = "w"): string {
  const w = buildWaiverWriteup({
    team: alpha,
    pulseRank: 4,
    kind: "waiver",
    added: [wp("Player new")],
    dropped: [],
    faabSpent,
    week: 6,
    seedKey: seed,
    fit,
    league,
    faabBudget: 100,
    faabMedian: 8,
    weakestPosition: null,
    snark: 0,
    showNumbers: false,
    url: null,
  });
  return (w?.sections ?? []).map((s) => s.text).join("\n");
}

describe("the waiver review", () => {
  const starter = computeWaiverFit({ slots: SLOTS, weeks: WEEKS, base, added: [fp("new", "RB", 18)], dropped: [] });
  const bench = computeWaiverFit({ slots: SLOTS, weeks: WEEKS, base, added: [fp("new", "RB", 6)], dropped: [] });

  it("roasts a big bid on a player who will not start", () => {
    const text = waiverText(bench, 40);
    expect(text).toContain("does not make Alpha's best lineup");
    expect(text).toContain("40 FAAB is a lot to spend on a player who is not starting");
  });

  it("credits a big bid that bought a starter", () => {
    const text = waiverText(starter, 40);
    expect(text).toContain("starts for Alpha in 3 of the next 3 weeks");
    expect(text).toContain("it bought a starter");
  });

  it("never says a move that made the lineup worse bought a non-starter", () => {
    const worse = computeWaiverFit({
      slots: SLOTS,
      weeks: WEEKS,
      base: [fp("qb", "QB", 20), fp("wr1", "WR", 12)],
      added: [fp("new", "RB", 8)],
      dropped: [fp("rb1", "RB", 14)],
    });
    const text = waiverText(worse, 40);
    expect(text).not.toContain("not starting");
    expect(text).toContain("weaker");
  });

  it("calls a free starter good value", () => {
    expect(waiverText(starter, 0)).toContain("A starter for nothing");
  });

  it("drops the general verdict on the player once a roster verdict exists", () => {
    // "startable in most weeks" beside "does not start for this team" would be
    // two claims that contradict each other.
    const text = waiverText(bench, 5);
    expect(text).not.toMatch(/startable in most weeks|can start right away|insurance rather than/);
  });
});

describe("the waiver digest", () => {
  const starterFit = computeWaiverFit({ slots: SLOTS, weeks: WEEKS, base, added: [fp("new", "RB", 18)], dropped: [] });
  const benchFit = computeWaiverFit({ slots: SLOTS, weeks: WEEKS, base, added: [fp("new", "RB", 6)], dropped: [] });
  const mv = (id: number, name: string, fit: typeof starterFit, faabSpent: number): WaiverMove => ({
    team: { ...alpha, sleeperRosterId: id, name },
    pulseRank: 4,
    kind: "waiver",
    added: [wp(`Add ${id}`)],
    dropped: [],
    faabSpent,
    week: 6,
    seedKey: `k${id}`,
    fit,
  });

  it("tags each move and names the best and the most expensive bench add", () => {
    const writeup = buildWaiverDigest({
      league,
      moves: [mv(1, "Alpha", starterFit, 3), mv(2, "Bravo", benchFit, 30), mv(3, "Charlie", benchFit, 1), mv(4, "Delta", benchFit, 2)],
      kind: "waiver",
      week: 6,
      faabBudget: 100,
      faabMedian: 8,
      snark: 0,
      showNumbers: false,
      url: null,
      seedKey: "digest",
    });
    const text = (writeup?.sections ?? []).map((s) => s.text).join("\n");
    expect(text).toContain("Starts right away.");
    expect(text).toContain("Bench only.");
    expect(text).toContain("Best move of the run");
    expect(text).toContain("Alpha");
    expect(text).toContain("Bravo paid 30 FAAB");
  });
});
