import { describe, expect, it } from "vitest";
import type { BenchUpgrade, MatchupSide, MatchupView, SchedulePlayer } from "@/lib/league-schedule/types";
import {
  BENCH_LOST_IT,
  BENCH_WOULD_NOT_MATTER,
  BUST_COST_GAME,
  BUST_ON_LOSER,
  BUST_ON_WINNER,
  DEFENSE_MVP,
  DEFENSE_NEGATIVE,
  EMPTY_SLOT_LINES,
  EMPTY_SLOT_PREVIEW_LINES,
  HERO_ON_LOSER,
  HERO_ON_WINNER,
  KEY_PLAYER_LINES,
  KICKER_MVP,
  LOSER_OVER_PROJECTION,
  RESULT_LINES,
  SHAKY_STARTER_LINES,
  SWAP_LOST_IT,
  SWAP_WINNER_SHRUG,
  TOP_SCORER_LOSER,
  TOP_SCORER_WINNER,
  WINNER_UNDER_PROJECTION,
  ZERO_LINES,
  fill,
  overPerformer,
  underPerformer,
} from "./commentary";
import { buildMatchupPreview, buildMatchupRecap } from "./matchup-writeup";
import type { RelayLeague, RelayTeam } from "./types";
import type { Line } from "./voice";

const BANKS: Record<string, Line[]> = {
  ...Object.fromEntries(Object.entries(RESULT_LINES).map(([k, v]) => [`result.${k}`, v])),
  HERO_ON_WINNER,
  HERO_ON_LOSER,
  BUST_ON_LOSER,
  BUST_COST_GAME,
  BUST_ON_WINNER,
  ZERO_LINES,
  TOP_SCORER_WINNER,
  TOP_SCORER_LOSER,
  SWAP_LOST_IT,
  BENCH_LOST_IT,
  BENCH_WOULD_NOT_MATTER,
  SWAP_WINNER_SHRUG,
  EMPTY_SLOT_LINES,
  KICKER_MVP,
  DEFENSE_MVP,
  DEFENSE_NEGATIVE,
  LOSER_OVER_PROJECTION,
  WINNER_UNDER_PROJECTION,
  KEY_PLAYER_LINES,
  SHAKY_STARTER_LINES,
  EMPTY_SLOT_PREVIEW_LINES,
};

describe("the commentary banks", () => {
  it("every bank keeps a plain line for when the harshness is at zero", () => {
    for (const [name, bank] of Object.entries(BANKS)) {
      expect(bank.some((l) => l.heat === 0), name).toBe(true);
    }
  });

  it("uses plain ASCII punctuation only", () => {
    for (const [name, bank] of Object.entries(BANKS)) {
      for (const line of bank) expect(line.text, name).toMatch(/^[\x20-\x7e]+$/);
    }
  });

  it("every result line states the winner and the score", () => {
    for (const kind of ["big", "normal", "close"] as const) {
      for (const line of RESULT_LINES[kind]) {
        expect(line.text, line.text).toContain("{W}");
        expect(line.text, line.text).toMatch(/\{wp\}|\{margin\}/);
      }
    }
  });

  it("fill leaves an unknown key visible rather than blank", () => {
    expect(fill("{a} and {b}", { a: "x" })).toBe("x and {b}");
  });
});

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

function player(name: string, position: string, projected: number | null, actual: number | null, extra: Partial<SchedulePlayer> = {}): SchedulePlayer {
  return {
    playerId: `id-${name}`,
    sleeperId: `s-${name}`,
    name,
    position,
    team: "BUF",
    injuryStatus: null,
    nflOpponent: "MIA",
    nflIsHome: null,
    opponentMultiplier: 1,
    beatRate: null,
    availability: null,
    reliability: null,
    projected,
    sigma: null,
    actual,
    isInactive: false,
    ...extra,
  };
}

function slot(label: string, p: SchedulePlayer | null, order: number) {
  return {
    slot: { token: label, label, description: label, group: "flex", projectable: true, order },
    player: p,
  } as unknown as MatchupSide["slots"][number];
}

function side(
  handle: string,
  id: number,
  players: Array<SchedulePlayer | null>,
  opts: { bench?: number; upgrades?: BenchUpgrade[]; projected?: number } = {},
): MatchupSide {
  const actual = players.reduce((sum, p) => sum + (p?.actual ?? 0), 0);
  return {
    ownerHandle: handle,
    teamName: handle,
    sleeperRosterId: id,
    rosterRowId: null,
    ownerAvatarId: null,
    record: { wins: 3, losses: 3, ties: 0 },
    pulseRank: 6,
    slots: players.map((p, i) => slot(["QB", "RB", "WR", "TE", "K", "DEF"][i] ?? "FLEX", p, i)),
    projectedTotal: opts.projected ?? players.reduce((sum, p) => sum + (p?.projected ?? 0), 0),
    sigma: null,
    actualTotal: actual,
    scoredTotal: actual,
    optimalTotal: actual + (opts.bench ?? 0),
    pointsLeftOnBench: opts.bench ?? 0,
    benchUpgrades: opts.upgrades ?? [],
    unprojectedSlots: 0,
  };
}

const league = {
  header: { leagueName: "Gridiron Degenerates", contextLine: "" },
  season: 2026,
  totalRosters: 12,
  pulseRankedTeams: 12,
} as unknown as RelayLeague;

function recapText(home: MatchupSide, away: MatchupSide, seed: string, snark = 0.8): string {
  const view = {
    week: 6,
    season: 2026,
    isFinal: true,
    isCurrent: false,
    homeWinProb: null,
    hasUnprojectableSlots: false,
    resultsVisible: true,
    home,
    away,
  } as MatchupView;
  const writeup = buildMatchupRecap({
    league,
    view,
    teams: new Map<number, RelayTeam>(),
    slot: null,
    snark,
    showNumbers: false,
    url: null,
    seedKey: seed,
  });
  return (writeup?.sections ?? []).map((s) => s.text).join("\n");
}

const SEEDS = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];

/* -------------------------------------------------------------------------- */
/* Picking the players                                                        */
/* -------------------------------------------------------------------------- */

describe("over- and under-performers", () => {
  const team = side("t", 1, [
    player("Hero", "WR", 10, 31),
    player("Bust", "RB", 18, 4),
    player("Fine", "TE", 8, 9),
    player("Bench Warmer", "QB", 5, 0.5), // projected under the bust floor
  ]);

  it("picks the starter who beat their projection by the most", () => {
    expect(overPerformer(team)?.name).toBe("Hero");
  });

  it("picks the starter who missed by the most, among those anybody counted on", () => {
    expect(underPerformer(team)?.name).toBe("Bust");
  });

  it("names nobody when nobody was far enough off", () => {
    const steady = side("s", 2, [player("A", "WR", 10, 12), player("B", "RB", 12, 9)]);
    expect(overPerformer(steady)).toBeNull();
    expect(underPerformer(steady)).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* A recap end to end                                                         */
/* -------------------------------------------------------------------------- */

describe("a recap with players in it", () => {
  const winner = side("champ", 1, [player("Jet Fuel", "WR", 12, 34), player("Passenger", "RB", 16, 5), player("Steady", "QB", 20, 22)]);
  const loser = side("chump", 2, [player("Lone Star", "TE", 7, 19), player("Dud", "WR", 17, 3), player("Meh", "QB", 18, 17)]);

  it("names each team's over-performer and under-performer", () => {
    for (const seed of SEEDS) {
      const text = recapText(winner, loser, seed);
      for (const name of ["Jet Fuel", "Passenger", "Lone Star", "Dud"]) {
        expect(text, `${seed}: ${name}`).toContain(name);
      }
    }
  });

  it("never fills a line with a placeholder still in it", () => {
    for (const seed of SEEDS) {
      for (const snark of [0, 0.5, 1]) {
        expect(recapText(winner, loser, seed, snark)).not.toMatch(/\{\w+\}/);
      }
    }
  });

  it("points the hero line the way the result points", () => {
    const vars = { player: "Jet Fuel", name: "champ", act: "34.0", proj: "12.0", diff: "22.0" };
    const loserOnly = HERO_ON_LOSER.map((l) => fill(l.text, vars));
    for (const seed of SEEDS) {
      const text = recapText(winner, loser, seed);
      expect(loserOnly.some((l) => text.includes(l)), seed).toBe(false);
    }
  });

  it("only blames one player for the game when that miss was bigger than the margin", () => {
    // Margin 22.0 (61 to 39), Dud missed by 14.0: not the reason for the loss.
    for (const seed of SEEDS) {
      const text = recapText(winner, loser, seed);
      expect(text).not.toContain("more than the 22.0 chump lost by");
      expect(text).not.toContain("An average day from Dud wins this game");
    }
    // Margin 4.0 (40 to 36), Dud missed by 14.0: it may say so, and does on
    // some seeds.
    const w = side("champ", 1, [player("A", "QB", 20, 40)]);
    const l = side("chump", 2, [player("Dud", "WR", 17, 3), player("B", "QB", 20, 33)]);
    const costVars = { player: "Dud", name: "chump", act: "3.0", proj: "17.0", miss: "14.0", margin: "4.0" };
    const costLines = BUST_COST_GAME.map((line) => fill(line.text, costVars));
    expect(SEEDS.some((seed) => costLines.some((c) => recapText(w, l, seed).includes(c)))).toBe(true);
  });

  it("blames a single bench decision only when that swap beat the margin", () => {
    const swap = (gain: number): BenchUpgrade => ({
      inPlayer: player("Sat Down", "WR", 9, 3 + gain),
      outPlayer: player("Started", "WR", 9, 3),
      slotLabel: "FLEX",
      gain,
      requiresMove: false,
    });
    const w = side("champ", 1, [player("A", "QB", 20, 104)]);
    const close = side("chump", 2, [player("B", "QB", 20, 100)], { bench: 12, upgrades: [swap(12)] });
    const notEnough = side("chump", 2, [player("B", "QB", 20, 100)], { bench: 3, upgrades: [swap(3)] });
    for (const seed of SEEDS) {
      expect(recapText(w, close, seed), seed).toContain("Sat Down");
      expect(recapText(w, notEnough, seed), seed).not.toContain("Sat Down");
    }
  });

  it("never says anybody won a tie", () => {
    const a = side("left", 1, [player("A", "QB", 20, 100)], {
      upgrades: [
        { inPlayer: player("X", "WR", 9, 20), outPlayer: player("Y", "WR", 9, 2), slotLabel: "FLEX", gain: 18, requiresMove: false },
      ],
    });
    const b = side("right", 2, [player("B", "QB", 20, 100)]);
    for (const seed of SEEDS) {
      const text = recapText(a, b, seed);
      expect(text, seed).toMatch(/tie|both scored/i);
      // "beat a projection" is fine; "X beat Y" and "won" are not.
      expect(text, seed).not.toMatch(/\bwon\b|\*\* beat /);
    }
  });

  it("calls out a kicker who was the top scorer", () => {
    const w = side("champ", 1, [player("Leg", "K", 8, 21), player("Quiet", "WR", 10, 9)]);
    const l = side("chump", 2, [player("Other", "WR", 10, 10)]);
    const hits = SEEDS.filter((seed) => recapText(w, l, seed).includes("kicker"));
    expect(hits.length).toBeGreaterThan(0);
  });
});

/* -------------------------------------------------------------------------- */
/* A preview                                                                  */
/* -------------------------------------------------------------------------- */

describe("a preview with players in it", () => {
  function previewText(home: MatchupSide, away: MatchupSide, seed: string): string {
    const view = {
      week: 7,
      season: 2026,
      isFinal: false,
      isCurrent: true,
      homeWinProb: 0.55,
      hasUnprojectableSlots: false,
      resultsVisible: false,
      home,
      away,
    } as MatchupView;
    const writeup = buildMatchupPreview({
      league,
      view,
      teams: new Map<number, RelayTeam>(),
      slot: "headline",
      snark: 0.8,
      showNumbers: false,
      url: null,
      seedKey: seed,
    });
    return (writeup?.sections ?? []).map((s) => s.text).join("\n");
  }

  it("names the player each team's week rests on, and a shaky starter", () => {
    const home = side("home", 1, [player("Big Arm", "QB", 24, null), player("Limping", "RB", 12, null, { injuryStatus: "Questionable" })]);
    const away = side("away", 2, [player("Speedy", "WR", 18, null), null]);
    for (const seed of SEEDS) {
      const text = previewText(home, away, seed);
      expect(text, seed).toContain("Big Arm");
      expect(text, seed).toContain("Speedy");
      expect(text, seed).toContain("Limping");
      expect(text, seed).toMatch(/questionable/);
      // The away side has an empty second slot.
      expect(text, seed).toMatch(/RB/);
      expect(text).not.toMatch(/\{\w+\}/);
    }
  });
});
