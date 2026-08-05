import { describe, it, expect } from "vitest";
import {
  buildTeamProfile,
  directionOf,
  leagueStarterBaselines,
  lineupTotal,
} from "./profile";
import {
  STANDARD_SLOTS,
  SUPERFLEX_SLOTS,
  fullRoster,
  player,
  team,
} from "./_test-kit";

describe("lineupTotal", () => {
  it("returns null when nobody has a projection, rather than zero", () => {
    const roster = [
      player({ position: "QB", projPoints: null }),
      player({ position: "RB", projPoints: null }),
    ];
    // Null and zero mean different things here: zero would read as a lineup
    // that scores nothing, which is a claim we cannot make.
    expect(lineupTotal(STANDARD_SLOTS, roster)).toBeNull();
  });

  it("seats the best players and ignores the rest", () => {
    const roster = [
      player({ position: "QB", projPoints: 20 }),
      player({ position: "RB", projPoints: 15 }),
      player({ position: "RB", projPoints: 12 }),
      player({ position: "RB", projPoints: 11 }),
      player({ position: "WR", projPoints: 14 }),
      player({ position: "WR", projPoints: 13 }),
      player({ position: "TE", projPoints: 9 }),
    ];
    // QB 20, RB 15 + 12, WR 14 + 13, TE 9, FLEX takes the 11-point RB.
    expect(lineupTotal(STANDARD_SLOTS, roster)).toBe(94);
  });

  it("leaves a player on IR out of the lineup", () => {
    const healthy = [
      player({ position: "QB", projPoints: 20 }),
      player({ position: "QB", projPoints: 18 }),
    ];
    const injured = [
      player({ position: "QB", projPoints: 20, isInactive: true }),
      player({ position: "QB", projPoints: 18 }),
    ];
    expect(lineupTotal(SUPERFLEX_SLOTS, healthy)).toBe(38);
    expect(lineupTotal(SUPERFLEX_SLOTS, injured)).toBe(18);
  });
});

describe("leagueStarterBaselines", () => {
  it("measures the median starter at each position across the league", () => {
    const teams = [
      team({
        players: [
          player({ position: "QB", projPoints: 24 }),
          player({ position: "RB", projPoints: 10 }),
        ],
      }),
      team({
        players: [
          player({ position: "QB", projPoints: 20 }),
          player({ position: "RB", projPoints: 14 }),
        ],
      }),
      team({
        players: [
          player({ position: "QB", projPoints: 16 }),
          player({ position: "RB", projPoints: 12 }),
        ],
      }),
    ];
    const baselines = leagueStarterBaselines(teams, STANDARD_SLOTS);
    expect(baselines.QB).toBe(20);
    expect(baselines.RB).toBe(12);
  });

  it("answers with nothing when there is no league to measure", () => {
    expect(leagueStarterBaselines([], STANDARD_SLOTS)).toEqual({});
  });
});

describe("buildTeamProfile", () => {
  const baselines = { QB: 18, RB: 12, WR: 12, TE: 8 };

  it("reads direction from the Power Pulse standing", () => {
    expect(directionOf(team({ statusKey: "competitor" }))).toBe("win-now");
    expect(directionOf(team({ statusKey: "rebuilder" }))).toBe("rebuild");
    expect(directionOf(team({ statusKey: "middle" }))).toBe("balanced");
    // No standing is the absence of a claim, not a claim of mediocrity, but
    // balanced is the only honest way to act on it.
    expect(directionOf(team({ statusKey: null }))).toBe("balanced");
  });

  it("counts a valuable player who cannot crack the lineup as surplus", () => {
    const starters = fullRoster();
    const benched = player({ position: "WR", value: 2500, projPoints: 5 });
    const profile = buildTeamProfile(
      team({ players: [...starters, benched] }),
      STANDARD_SLOTS,
      baselines,
    );
    expect(profile.surplus.map((p) => p.playerId)).toContain(benched.playerId);
  });

  it("leaves waiver flotsam out of surplus", () => {
    const junk = player({ position: "WR", value: 20, projPoints: 0.1 });
    const profile = buildTeamProfile(
      team({ players: [...fullRoster(), junk] }),
      STANDARD_SLOTS,
      baselines,
    );
    expect(profile.surplus.map((p) => p.playerId)).not.toContain(junk.playerId);
  });

  it("reports a real need at the position the lineup is thin at", () => {
    const thinAtTe = [
      player({ position: "QB", projPoints: 20 }),
      player({ position: "RB", projPoints: 15 }),
      player({ position: "RB", projPoints: 14 }),
      player({ position: "WR", projPoints: 15 }),
      player({ position: "WR", projPoints: 14 }),
      player({ position: "TE", projPoints: 2 }),
      player({ position: "WR", projPoints: 13 }),
    ];
    const profile = buildTeamProfile(
      team({ players: thinAtTe }),
      STANDARD_SLOTS,
      baselines,
    );
    // An average tight end (8) replaces a 2-point one, so the gain is 6.
    expect(profile.positionNeed.TE).toBeCloseTo(6, 5);
    // Every other position is already covered better than league average, so
    // adding one more average body does nothing.
    expect(profile.positionNeed.QB).toBe(0);
  });

  it("sees a superflex quarterback hole that counting bodies would miss", () => {
    const oneQb = [
      player({ position: "QB", projPoints: 22 }),
      player({ position: "RB", projPoints: 15 }),
      player({ position: "RB", projPoints: 14 }),
      player({ position: "WR", projPoints: 15 }),
      player({ position: "WR", projPoints: 14 }),
      player({ position: "TE", projPoints: 9 }),
      player({ position: "WR", projPoints: 13 }),
      player({ position: "WR", projPoints: 12 }),
    ];
    const standard = buildTeamProfile(team({ players: oneQb }), STANDARD_SLOTS, baselines);
    const superflex = buildTeamProfile(team({ players: oneQb }), SUPERFLEX_SLOTS, baselines);

    // One quarterback is plenty in a one-QB league and a hole in superflex.
    expect(standard.positionNeed.QB).toBe(0);
    expect(superflex.positionNeed.QB).toBeGreaterThan(5);
  });
});
