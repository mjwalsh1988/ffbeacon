import { describe, expect, it } from "vitest";
import type { PulseTeam } from "@/lib/league-power-pulse-data";
import {
  oddsSummary,
  pctOdds,
  playedRecordText,
  playoffFigure,
  playoffIsOdds,
  projectedRecordText,
  titleFigure,
} from "./odds-format";

function team(over: Partial<PulseTeam>): PulseTeam {
  return {
    chopped: false,
    titleOdds: 0.24,
    playoffOdds: 0.71,
    surviveAllOdds: null,
    chopOddsThisWeek: null,
    playoff: null,
    ...over,
  } as PulseTeam;
}

describe("pctOdds", () => {
  it("says a missing figure in words", () => {
    expect(pctOdds(null)).toBe("No odds yet");
  });
  it("never shows 0% for a real chance", () => {
    expect(pctOdds(0.004)).toBe("under 1%");
    expect(pctOdds(0)).toBe("0%");
    expect(pctOdds(0.997)).toBe("over 99%");
    expect(pctOdds(0.24)).toBe("24%");
  });
});

describe("records", () => {
  it("shows fractions and ties only when there are some", () => {
    expect(projectedRecordText({ wins: 9.44, losses: 4.56, ties: 0 })).toBe("9.4-4.6");
    expect(projectedRecordText({ wins: 9, losses: 4, ties: 1 })).toBe("9.0-4.0-1.0");
    expect(projectedRecordText(null)).toBe("No projection");
    expect(playedRecordText({ wins: 9, losses: 4, ties: 0 })).toBe("9-4");
    expect(playedRecordText({ wins: 9, losses: 4, ties: 1 })).toBe("9-4-1");
  });
});

describe("postseason figures", () => {
  it("shows odds before the playoffs", () => {
    const t = team({});
    expect(titleFigure(t, "regular")).toBe("24%");
    expect(playoffFigure(t, "regular")).toBe("71%");
    expect(playoffIsOdds(t, "regular")).toBe(true);
  });

  it("says eliminated and missed teams in words during the bracket", () => {
    const out = team({ titleOdds: 0, playoff: { phase: "playoffs", seed: 4, status: "eliminated", finalPlace: null } });
    const missed = team({ titleOdds: 0, playoff: { phase: "playoffs", seed: null, status: "missed", finalPlace: null } });
    const alive = team({ titleOdds: 0.5, playoff: { phase: "playoffs", seed: 1, status: "alive", finalPlace: null } });
    expect(titleFigure(out, "playoffs")).toBe("Eliminated");
    expect(titleFigure(missed, "playoffs")).toBe("Missed playoffs");
    expect(playoffFigure(missed, "playoffs")).toBe("Missed playoffs");
    expect(titleFigure(alive, "playoffs")).toBe("50%");
    expect(playoffFigure(alive, "playoffs")).toBe("Seed 1");
  });

  it("names the champion and the final place after the title game", () => {
    const champ = team({ playoff: { phase: "complete", seed: 2, status: "champion", finalPlace: 1 } });
    const third = team({ playoff: { phase: "complete", seed: 3, status: "eliminated", finalPlace: 3 } });
    expect(titleFigure(champ, "complete")).toBe("Champion");
    expect(titleFigure(third, "complete")).toBe("3rd place");
  });

  it("uses survival, never playoffs, in a chopped league", () => {
    const t = team({ chopped: true, surviveAllOdds: 0.12, chopOddsThisWeek: 0.2, titleOdds: null, playoffOdds: null });
    const s = oddsSummary(t, null);
    expect(s.primary).toEqual({ label: "Last standing", text: "12%" });
    expect(s.secondary).toEqual({ label: "Chopped this week", text: "20%" });
    expect(playoffIsOdds(t, null)).toBe(false);
  });
});
