import { describe, it, expect } from "vitest";
import {
  FINAL_WEEK_VERIFIED,
  LAST_FANTASY_WEEK,
  aliveFraction,
  choppedWeeks,
  eliminatedWeek,
  isAliveRoster,
  isChoppedLeague,
  resolveFinalWeek,
} from "./league";

describe("isChoppedLeague", () => {
  it("accepts a Sleeper league of type 3", () => {
    expect(isChoppedLeague({ type: 3 })).toBe(true);
  });

  it("accepts type 3 with elimination explicitly enabled", () => {
    expect(isChoppedLeague({ type: 3, disable_elimination: 0 })).toBe(true);
  });

  it("rejects a chopped league with elimination disabled", () => {
    expect(isChoppedLeague({ type: 3, disable_elimination: 1 })).toBe(false);
  });

  it("rejects redraft, keeper and dynasty", () => {
    expect(isChoppedLeague({ type: 0 })).toBe(false);
    expect(isChoppedLeague({ type: 1 })).toBe(false);
    expect(isChoppedLeague({ type: 2 })).toBe(false);
  });

  it("rejects a missing settings object", () => {
    expect(isChoppedLeague(null)).toBe(false);
    expect(isChoppedLeague(undefined)).toBe(false);
    expect(isChoppedLeague({})).toBe(false);
  });

  it("reads a numeric string type, which is how jsonb sometimes comes back", () => {
    expect(isChoppedLeague({ type: "3" })).toBe(true);
    expect(isChoppedLeague({ type: "3", disable_elimination: "1" })).toBe(
      false,
    );
  });
});

describe("eliminatedWeek", () => {
  it("reads a real elimination week", () => {
    expect(eliminatedWeek({ eliminated: 6 })).toBe(6);
  });

  it("treats zero as alive rather than week zero", () => {
    expect(eliminatedWeek({ eliminated: 0 })).toBeNull();
  });

  it("treats null and an absent field as alive", () => {
    expect(eliminatedWeek({ eliminated: null })).toBeNull();
    expect(eliminatedWeek({})).toBeNull();
    expect(eliminatedWeek(null)).toBeNull();
    expect(eliminatedWeek(undefined)).toBeNull();
  });

  it("ignores a value it cannot read as a week", () => {
    expect(eliminatedWeek({ eliminated: "" })).toBeNull();
    expect(eliminatedWeek({ eliminated: "nope" })).toBeNull();
    expect(eliminatedWeek({ eliminated: -3 })).toBeNull();
  });
});

describe("isAliveRoster", () => {
  it("is alive for eliminated 0, null and absent", () => {
    expect(isAliveRoster({ eliminated: 0 })).toBe(true);
    expect(isAliveRoster({ eliminated: null })).toBe(true);
    expect(isAliveRoster({})).toBe(true);
    expect(isAliveRoster(null)).toBe(true);
  });

  it("is not alive once a real week is recorded", () => {
    expect(isAliveRoster({ eliminated: 1 })).toBe(false);
    expect(isAliveRoster({ eliminated: 14, locked: 1 })).toBe(false);
  });
});

describe("resolveFinalWeek", () => {
  it("leaves one week per remaining team after this one", () => {
    // Twelve alive in week 5: week 5 chops one, and ten more weeks finish it.
    expect(resolveFinalWeek(5, 12).finalWeek).toBe(15);
  });

  it("ends this week when two teams are left", () => {
    expect(resolveFinalWeek(9, 2).finalWeek).toBe(9);
  });

  it("caps at the last fantasy week", () => {
    expect(resolveFinalWeek(3, 32).finalWeek).toBe(LAST_FANTASY_WEEK);
  });

  it("falls behind the current week once a single team is left", () => {
    expect(resolveFinalWeek(9, 1).finalWeek).toBe(8);
  });

  it("never claims to be verified, because last_chopped_leg is not the final week", () => {
    expect(resolveFinalWeek(5, 12).finalWeekVerified).toBe(false);
    expect(FINAL_WEEK_VERIFIED).toBe(false);
  });

  it("survives junk inputs without producing NaN", () => {
    expect(
      Number.isFinite(resolveFinalWeek(Number.NaN, Number.NaN).finalWeek),
    ).toBe(true);
  });
});

describe("choppedWeeks", () => {
  it("runs from the current week through the final week", () => {
    expect(choppedWeeks(5, 8)).toEqual([5, 6, 7, 8]);
  });

  it("is a single week when the season ends this week", () => {
    expect(choppedWeeks(9, 9)).toEqual([9]);
  });

  it("is empty when the league is already decided", () => {
    expect(choppedWeeks(9, 8)).toEqual([]);
  });
});

describe("aliveFraction", () => {
  it("is the share of the field still in", () => {
    expect(aliveFraction(6, 12)).toBe(0.5);
  });

  it("is zero for a league with no teams rather than NaN", () => {
    expect(aliveFraction(0, 0)).toBe(0);
  });

  it("clamps to the 0 to 1 range", () => {
    expect(aliveFraction(14, 12)).toBe(1);
    expect(aliveFraction(-2, 12)).toBe(0);
  });
});
