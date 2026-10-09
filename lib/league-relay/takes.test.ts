import { describe, expect, it } from "vitest";
import type { MatchupSide, MatchupView } from "@/lib/league-schedule/types";
import { buildMatchupRecap } from "./matchup-writeup";
import { renderPlainText, renderWriteup } from "./render";
import {
  COIN_FLIP_TAKES,
  FAVOURITE_TAKES,
  LOSS_TAKES,
  TRADE_CLOSERS,
  TRADE_TAKES,
  UNDERDOG_TAKES,
  WIN_TAKES,
  gradeFromScore,
  take,
} from "./takes";
import type { RelayLeague, RelayTeam, Writeup } from "./types";
import { Voice, type Line } from "./voice";

const ALL_BANKS: Record<string, Line[]> = {
  ...Object.fromEntries(Object.entries(TRADE_TAKES).map(([k, v]) => [`trade.${k}`, v])),
  ...Object.fromEntries(Object.entries(WIN_TAKES).map(([k, v]) => [`win.${k}`, v])),
  ...Object.fromEntries(Object.entries(LOSS_TAKES).map(([k, v]) => [`loss.${k}`, v])),
  favourite: FAVOURITE_TAKES,
  underdog: UNDERDOG_TAKES,
  coinFlip: COIN_FLIP_TAKES,
  tradeClosers: TRADE_CLOSERS,
};

describe("gradeFromScore", () => {
  it("maps the score onto five grades", () => {
    expect(gradeFromScore(2)).toBe("great");
    expect(gradeFromScore(1)).toBe("good");
    expect(gradeFromScore(0)).toBe("even");
    expect(gradeFromScore(-1)).toBe("bad");
    expect(gradeFromScore(-2)).toBe("awful");
  });
});

describe("the line banks", () => {
  it("every bank still has a plain line when the harshness is at zero", () => {
    // Turning the dial down must keep the direction of the take and drop the
    // joke, never leave a manager with nothing said about them.
    for (const [name, bank] of Object.entries(ALL_BANKS)) {
      expect(bank.some((l) => l.heat === 0), name).toBe(true);
    }
  });

  it("uses plain ASCII punctuation only", () => {
    for (const [name, bank] of Object.entries(ALL_BANKS)) {
      for (const line of bank) {
        expect(line.text, name).toMatch(/^[\x20-\x7e]+$/);
      }
    }
  });

  it("names the manager in every take that is about one", () => {
    const personal = { ...ALL_BANKS };
    delete personal.coinFlip;
    delete personal.tradeClosers;
    for (const [name, bank] of Object.entries(personal)) {
      for (const line of bank) expect(line.text, name).toContain("{name}");
    }
  });
});

describe("take", () => {
  it("fills in the manager's name everywhere it appears", () => {
    const voice = new Voice("seed", 1);
    for (let i = 0; i < 20; i += 1) {
      const line = take(voice, TRADE_TAKES.great, "kendawg9");
      expect(line).not.toContain("{name}");
      expect(line).toContain("kendawg9");
    }
  });

  it("draws only heat-zero lines at zero harshness", () => {
    const plain = new Set(TRADE_TAKES.awful.filter((l) => l.heat === 0).map((l) => l.text.replaceAll("{name}", "X")));
    for (const seed of ["a", "b", "c", "d", "e", "f"]) {
      expect(plain.has(take(new Voice(seed, 0), TRADE_TAKES.awful, "X") ?? "")).toBe(true);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* A recap end to end                                                         */
/* -------------------------------------------------------------------------- */

const league = {
  header: { leagueName: "Gridiron Degenerates", contextLine: "_2026, 12 teams | redraft_" },
  season: 2026,
  totalRosters: 12,
  pulseRankedTeams: 12,
} as unknown as RelayLeague;

function side(handle: string, id: number, actual: number, bench: number): MatchupSide {
  return {
    ownerHandle: handle,
    teamName: handle,
    sleeperRosterId: id,
    record: { wins: 3, losses: 3, ties: 0 },
    projectedTotal: 110,
    optimalTotal: actual + bench,
    actualTotal: actual,
    pointsLeftOnBench: bench,
    benchUpgrades: [],
    pulseRank: 6,
    slots: [],
  } as unknown as MatchupSide;
}

function recap(homePts: number, awayPts: number, loserBench: number, seed: string, snark = 0.8) {
  const view = {
    week: 6,
    isFinal: true,
    homeWinProb: 0.5,
    hasUnprojectableSlots: false,
    home: side("winner", 1, homePts, 0),
    away: side("loser", 2, awayPts, loserBench),
  } as unknown as MatchupView;
  const teams = new Map<number, RelayTeam>();
  return buildMatchupRecap({ league, view, teams, slot: null, snark, showNumbers: false, url: null, seedKey: seed });
}

function linesFor(bank: Line[], name: string): string[] {
  return bank.map((l) => l.text.replaceAll("{name}", name));
}

describe("recap takes", () => {
  it("praises the winner and roasts the loser, sized to the margin, on every seed", () => {
    const winBig = linesFor(WIN_TAKES.big, "winner");
    const lossBig = linesFor(LOSS_TAKES.big, "loser");
    for (const seed of ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"]) {
      const text = (recap(150, 90, 0, seed)?.sections ?? []).map((s) => s.text).join("\n");
      expect(winBig.some((l) => text.includes(l)), seed).toBe(true);
      expect(lossBig.some((l) => text.includes(l)), seed).toBe(true);
      // Never the other way round.
      expect(linesFor(LOSS_TAKES.big, "winner").some((l) => text.includes(l))).toBe(false);
      expect(linesFor(WIN_TAKES.big, "loser").some((l) => text.includes(l))).toBe(false);
    }
  });

  it("blames the bench when the loser left more on it than the margin", () => {
    const text = (recap(110, 104, 12, "bench")?.sections ?? []).map((s) => s.text).join("\n");
    expect(text).toMatch(/12\.0 points/);
  });
});

describe("the format line", () => {
  it("is never printed in a relay post", () => {
    const writeup = recap(120, 100, 0, "fmt") as Writeup;
    const rendered = renderWriteup(writeup, { mentionRoleIds: [], pollHours: null });
    const description = rendered?.message.embeds?.[0]?.description ?? "";
    expect(description).not.toContain("12 teams");
    expect(renderPlainText(writeup)).not.toContain("redraft");
    // The league is still named, above the title.
    expect(renderPlainText(writeup)).toContain("### Gridiron Degenerates");
  });
});
