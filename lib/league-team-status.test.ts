import { describe, it, expect } from "vitest";
import {
  classifyTeamStatus,
  teamStatusBands,
  teamStatusWords,
  type TeamStatusBands,
} from "./league-team-status";
import { DEFAULT_PLAYOFF_TEAMS } from "./power-pulse/playoff-defaults";

/**
 * Run an assertion over every league shape we could plausibly meet: 2 through
 * 20 teams crossed with every bracket size that fits, plus the unconfigured
 * bracket. The invariant tests below all use it, because the three defects it
 * caught were each live in a shape nobody had written a case for.
 */
function forEveryShape(
  assertOne: (
    bands: TeamStatusBands,
    teamCount: number,
    playoffTeams: number | null,
  ) => void,
): void {
  for (let teamCount = 2; teamCount <= 20; teamCount += 1) {
    const fields: Array<number | null> = [null];
    for (let f = 1; f <= teamCount; f += 1) fields.push(f);
    for (const playoffTeams of fields) {
      assertOne(teamStatusBands({ teamCount, playoffTeams }), teamCount, playoffTeams);
    }
  }
}

/**
 * The reference league throughout: twelve teams, seven of them make the
 * playoffs. That is the shape the bands were rebuilt around, so it is the one
 * worth writing the expectations against.
 *
 * Its cut lines: Contenders 1 to 5, Bubble and Loaded 6 to 9, Rebuilders 10 to
 * 12.
 */
const twelve = (pulseRank: number | null, valueRank: number | null = null) =>
  classifyTeamStatus({ pulseRank, valueRank, teamCount: 12, playoffTeams: 7 });

describe("teamStatusBands", () => {
  it("makes contenders most of the playoff field", () => {
    expect(teamStatusBands({ teamCount: 12, playoffTeams: 7 })).toMatchObject({
      contenderCeiling: 5,
      bubbleCeiling: 9,
      playoffTeamsAssumed: false,
    });
    expect(teamStatusBands({ teamCount: 12, playoffTeams: 6 })).toMatchObject({
      contenderCeiling: 4,
      bubbleCeiling: 8,
    });
    expect(teamStatusBands({ teamCount: 10, playoffTeams: 4 })).toMatchObject({
      contenderCeiling: 3,
      bubbleCeiling: 6,
    });
  });

  it("assumes half the league when Sleeper has not configured a bracket", () => {
    // Sleeper writes 0 on a league whose bracket is not set up, and omits it
    // entirely on some. Both mean the same thing and neither is a real field.
    for (const playoffTeams of [null, undefined, 0, Number.NaN]) {
      const bands = teamStatusBands({ teamCount: 12, playoffTeams });
      expect(bands.playoffTeams).toBe(6);
      expect(bands.playoffTeamsAssumed).toBe(true);
      expect(bands.contenderCeiling).toBe(4);
    }
  });

  it("assumes the same field the playoff odds were simulated against", () => {
    // The one number three surfaces have to agree on: this classifier, the
    // Monte Carlo season in lib/power-pulse/load.ts, and the visible cut line on
    // the Projected standings table. An earlier version assumed half the league,
    // which matches a flat six only at 11, 12 and 13 teams. Every live league
    // with no configured bracket is 13 to 18 teams, so every one of them got a
    // Bubble band that ran past the cut line the same page was drawing.
    for (const teamCount of [8, 10, 12, 14, 16, 18, 20]) {
      const bands = teamStatusBands({ teamCount, playoffTeams: null });
      expect(bands.playoffTeams).toBe(DEFAULT_PLAYOFF_TEAMS);
      expect(bands.playoffTeamsAssumed).toBe(true);
    }
    // Only clamped down when the league is smaller than the default field.
    expect(teamStatusBands({ teamCount: 4, playoffTeams: null }).playoffTeams).toBe(4);
  });

  it("never promises a bracket place the league does not have", () => {
    forEveryShape((bands) => {
      expect(bands.contenderCeiling).toBeGreaterThanOrEqual(1);
      expect(bands.contenderCeiling).toBeLessThanOrEqual(bands.playoffTeams);
    });
  });

  it("keeps the Bubble band at least one rank wide in any real league", () => {
    forEveryShape((bands) => {
      if (bands.teamCount <= 4) return;
      // Strictly greater. Equality is an EMPTY band, and asserting
      // greater-than-or-equal here is what let a four-team league ship with no
      // rank that could ever read Bubble or Loaded.
      expect(bands.bubbleCeiling).toBeGreaterThan(bands.contenderCeiling);
    });
  });

  it("has a Rebuilder exactly when somebody misses the bracket", () => {
    forEveryShape((bands) => {
      const everyoneQualifies = bands.playoffTeams >= bands.teamCount;
      // Last place reads Rebuilder in a normal league, and Bubble in a league
      // whose bracket takes everyone.
      expect(bands.bubbleCeiling < bands.teamCount).toBe(!everyoneQualifies);
    });
  });

  /**
   * The self-contradiction guard. Both halves of a Rebuilder's sentence come
   * out of the same bands object, so a rank inside the bracket landing in the
   * bottom band produced: "6th of 6 by Power Pulse in a league that takes 6 to
   * the playoffs, below every team still within range of this league's 6-team
   * playoff field." Three live 6-team leagues are shaped that way.
   */
  it("never calls a team inside the bracket a Rebuilder, in any league shape", () => {
    forEveryShape((bands, teamCount, playoffTeams) => {
      for (let rank = 1; rank <= Math.min(bands.playoffTeams, teamCount); rank += 1) {
        const key = classifyTeamStatus({
          pulseRank: rank,
          valueRank: rank,
          teamCount,
          playoffTeams,
        })?.key;
        expect(key).not.toBe("rebuilder");
      }
    });
  });
});

describe("classifyTeamStatus", () => {
  it("returns null with no Power Pulse rank, which is the unsynced case", () => {
    expect(twelve(null)).toBeNull();
    expect(classifyTeamStatus({ pulseRank: 3, valueRank: 1, teamCount: 1 })).toBeNull();
  });

  it("calls most of the playoff field contenders regardless of value", () => {
    expect(twelve(1, 12)?.key).toBe("competitor");
    expect(twelve(5, 9)?.key).toBe("competitor");
  });

  /**
   * The defect this rebuild exists for. Kyle's roster in "12 Angry Men": 5th of
   * 12 by Power Pulse, 3rd by value, in a league that takes seven to the
   * playoffs, projected to finish 4th with 72% playoff odds. The old fixed
   * percentile bands put the contender floor at the top four and then let the
   * value-divergence rule label him a Rebuilder.
   */
  it("does not call a team inside the playoff field a rebuilder", () => {
    expect(twelve(5, 3)?.key).toBe("competitor");
    // And nothing anywhere in the picture can reach the bottom band, whatever
    // its value rank does.
    for (let rank = 1; rank <= 9; rank += 1) {
      for (const valueRank of [1, 2, 6, 12]) {
        expect(twelve(rank, valueRank)?.key).not.toBe("rebuilder");
      }
    }
  });

  it("calls the teams below the playoff picture rebuilders", () => {
    expect(twelve(12, 12)?.key).toBe("rebuilder");
    expect(twelve(10, 10)?.key).toBe("rebuilder");
    // Even holding the most valuable roster in the league. Down there the
    // assets ARE the plan, which is what the word means.
    expect(twelve(11, 1)?.key).toBe("rebuilder");
  });

  it("leaves the middle in the middle when value agrees with Power Pulse", () => {
    expect(twelve(6, 6)?.key).toBe("middle");
    expect(twelve(8, 8)?.key).toBe("middle");
  });

  it("calls a team in the picture Loaded when its value far outruns its rank", () => {
    // 7th by Power Pulse, 1st by assets: still in it, and worth more than the
    // ranking says. This used to come back "Rebuilder".
    expect(twelve(7, 1)?.key).toBe("loaded");
    expect(twelve(7, 1)?.label).toBe("Loaded");
    expect(twelve(7, 1)?.reason).toContain("worth more than its projected wins");
  });

  it("needs a real gap before the divergence fires", () => {
    // One place is not a story. The gap is a percentile, so in a twelve-team
    // league two places clears it and one does not. This is the same threshold
    // the old code used; only the band it feeds has changed.
    expect(twelve(7, 7)?.key).toBe("middle");
    expect(twelve(7, 6)?.key).toBe("middle");
    expect(twelve(7, 5)?.key).toBe("loaded");
  });

  it("does not let a cheap roster lose its competitor tag", () => {
    // 2nd by Power Pulse, dead last by value. Still winning, still a competitor.
    expect(twelve(2, 12)?.key).toBe("competitor");
  });

  it("classifies on Power Pulse alone when no source covers the league's format", () => {
    expect(twelve(2, null)?.key).toBe("competitor");
    expect(twelve(11, null)?.key).toBe("rebuilder");
    expect(twelve(7, null)?.key).toBe("middle");
    // Loaded is the one band that cannot be reached without a value rank,
    // because the value rank is the entire claim.
    for (let rank = 1; rank <= 12; rank += 1) {
      expect(twelve(rank, null)?.key).not.toBe("loaded");
    }
  });

  it("moves the cut lines with the league's own playoff field", () => {
    const four = (rank: number) =>
      classifyTeamStatus({
        pulseRank: rank,
        valueRank: rank,
        teamCount: 12,
        playoffTeams: 4,
      })?.key;
    // A twelve-team league that takes only four has a much narrower top band
    // than the same league taking seven.
    expect(four(3)).toBe("competitor");
    expect(four(4)).toBe("middle");
    expect(four(7)).toBe("rebuilder");
    expect(twelve(4, 4)?.key).toBe("competitor");
    expect(twelve(7, 7)?.key).toBe("middle");
  });

  it("pins the divergence threshold at the league sizes that actually exist", () => {
    // The gap is a PERCENTILE, so what it costs in places moves with the league.
    // Only the 12-team case was pinned, which left the behaviour at the sizes
    // either side of it free to change without a test noticing.
    const gapAt = (teamCount: number, playoffTeams: number) => {
      const rank = Math.min(teamCount - 1, playoffTeams + 1);
      for (let places = 1; places < rank; places += 1) {
        const key = classifyTeamStatus({
          pulseRank: rank,
          valueRank: rank - places,
          teamCount,
          playoffTeams,
        })?.key;
        if (key === "loaded") return places;
      }
      return null;
    };
    expect(gapAt(8, 4)).toBe(2);
    expect(gapAt(10, 6)).toBe(2);
    expect(gapAt(12, 7)).toBe(2);
    expect(gapAt(14, 6)).toBe(2);
    expect(gapAt(16, 6)).toBe(3);
    expect(gapAt(18, 6)).toBe(3);
  });

  it("draws the same bands at every league size, off the same rule", () => {
    // 14, 16 and 18 teams had no case at all, which is exactly the range where
    // the assumed-playoff-field defect was live.
    expect(teamStatusBands({ teamCount: 14, playoffTeams: 6 })).toMatchObject({
      contenderCeiling: 4,
      bubbleCeiling: 8,
    });
    expect(teamStatusBands({ teamCount: 16, playoffTeams: 8 })).toMatchObject({
      contenderCeiling: 5,
      bubbleCeiling: 10,
    });
    expect(teamStatusBands({ teamCount: 18, playoffTeams: 10 })).toMatchObject({
      contenderCeiling: 7,
      bubbleCeiling: 12,
    });
  });

  it("reads a league whose bracket takes everyone as having no Rebuilder", () => {
    // Three live 6-team leagues are shaped this way.
    const six = (rank: number) =>
      classifyTeamStatus({
        pulseRank: rank,
        valueRank: rank,
        teamCount: 6,
        playoffTeams: 6,
      })?.key;
    expect(six(6)).toBe("middle");
    expect(six(5)).toBe("middle");
    expect(six(4)).toBe("competitor");
    // And a four-team league where all four qualify still has a Bubble rank.
    expect(
      classifyTeamStatus({ pulseRank: 4, valueRank: 4, teamCount: 4, playoffTeams: 4 })?.key,
    ).toBe("middle");
  });

  it("takes the raw Sleeper value and refuses anything that is not a count", () => {
    // leagues.metadata holds whatever a commissioner's league object contained.
    // Number() would turn true into 1, [5] into 5 and "0x10" into 16, and every
    // one of those would be quoted back to a reader as their own league's
    // setting. PostgREST hands the same value over as a digit string, which is
    // the one non-number form that must still be accepted.
    expect(teamStatusBands({ teamCount: 12, playoffTeams: "7" })).toMatchObject({
      playoffTeams: 7,
      playoffTeamsAssumed: false,
    });
    for (const hostile of [true, [5], { n: 5 }, "0x10", "1e5", 0.4, -3, Number.NaN, Infinity]) {
      const bands = teamStatusBands({ teamCount: 12, playoffTeams: hostile });
      expect(bands.playoffTeamsAssumed).toBe(true);
      expect(bands.playoffTeams).toBe(DEFAULT_PLAYOFF_TEAMS);
    }
  });

  it("keeps an out-of-range value rank out of the spoken sentence", () => {
    // The reason is an aria-label. An unclamped rank rendered "1e+308th by value".
    const reason = classifyTeamStatus({
      pulseRank: 7,
      valueRank: 1e308,
      teamCount: 12,
      playoffTeams: 7,
    })?.reason;
    expect(reason).toContain("12th by value");
    expect(reason).not.toContain("e+");
  });

  it("scales with league size", () => {
    const eight = (rank: number) =>
      classifyTeamStatus({
        pulseRank: rank,
        valueRank: rank,
        teamCount: 8,
        playoffTeams: 4,
      })?.key;
    expect(eight(2)).toBe("competitor");
    expect(eight(5)).toBe("middle");
    expect(eight(7)).toBe("rebuilder");
  });

  it("names the team's actual placing in the reason", () => {
    expect(twelve(1, 1)?.reason).toContain("1st of 12 by Power Pulse");
  });

  it("names the playoff field, never the bubble ceiling, in the bottom band", () => {
    // bubbleCeiling is 9 here and the league takes 7. Telling a reader they are
    // below "the 9 teams still in the playoff picture" hands them a number that
    // contradicts the one they already know, with no explanation of the
    // two-place overhang.
    const reason = twelve(11, 9)?.reason ?? "";
    expect(reason).toContain("7-team playoff field");
    expect(reason).not.toContain("9 teams");
  });

  it("quotes the playoff field only when it is the league's own setting", () => {
    expect(twelve(1, 1)?.reason).toContain("takes 7 to the playoffs");
    // With no configured bracket we fall back to half the league, and saying so
    // out loud would attribute our assumption to the league.
    const assumed = classifyTeamStatus({
      pulseRank: 1,
      valueRank: 1,
      teamCount: 12,
      playoffTeams: 0,
    });
    expect(assumed?.reason).not.toContain("to the playoffs");
  });

  it("speaks dynasty by default", () => {
    expect(twelve(1, 1)?.label).toBe("Contender");
    expect(twelve(7, 1)?.label).toBe("Loaded");
    expect(twelve(7, 7)?.label).toBe("Bubble");
    expect(twelve(12, 12)?.label).toBe("Rebuilder");
  });

  it("calls the bottom band a Longshot in a one-year league", () => {
    const redraft = (pulseRank: number, valueRank: number) =>
      classifyTeamStatus({
        pulseRank,
        valueRank,
        teamCount: 12,
        playoffTeams: 7,
        variant: "redraft",
      });
    expect(redraft(12, 12)?.label).toBe("Longshot");
    // Same band, same reasoning, different word.
    expect(redraft(12, 12)?.key).toBe("rebuilder");
    expect(redraft(1, 1)?.label).toBe("Contender");
    expect(redraft(7, 7)?.label).toBe("Bubble");
    // Loaded is the one band whose word carries across unchanged.
    expect(redraft(7, 1)?.label).toBe("Loaded");
  });

  it("changes only the words, never the classification", () => {
    for (const rank of [1, 3, 5, 6, 7, 9, 12]) {
      for (const valueRank of [1, rank, 12]) {
        expect(
          classifyTeamStatus({
            pulseRank: rank,
            valueRank,
            teamCount: 12,
            playoffTeams: 7,
            variant: "redraft",
          })?.key,
        ).toBe(twelve(rank, valueRank)?.key);
      }
    }
  });

  it("carries the variant that produced its words", () => {
    expect(twelve(12, 12)?.variant).toBe("dynasty");
    expect(
      classifyTeamStatus({
        pulseRank: 12,
        valueRank: 12,
        teamCount: 12,
        playoffTeams: 7,
        variant: "redraft",
      })?.variant,
    ).toBe("redraft");
  });
});

describe("teamStatusWords", () => {
  it("gives the two-word bands a form that survives an indefinite article", () => {
    // "a Bubble" is not a sentence. Every prose surface uses `phrase`.
    expect(teamStatusWords("middle").label).toBe("Bubble");
    expect(teamStatusWords("middle").phrase).toBe("Bubble team");
    expect(teamStatusWords("loaded").phrase).toBe("Loaded team");
  });

  it("shortens only what needs shortening", () => {
    expect(teamStatusWords("competitor").short).toBe("Contend");
    expect(teamStatusWords("loaded").short).toBe("Loaded");
    expect(teamStatusWords("rebuilder", "redraft").short).toBe("Longshot");
  });
});
