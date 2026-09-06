import { describe, expect, it } from "vitest";
import { describeChoice, type LeagueChoice } from "./league-choice-list";

function choice(overrides: Partial<LeagueChoice> = {}): LeagueChoice {
  return {
    sleeperLeagueId: "111",
    name: "The Dynasty Room",
    avatar: null,
    ...overrides,
  };
}

describe("describeChoice", () => {
  it("is the name alone when there is nothing to qualify it", () => {
    expect(describeChoice(choice())).toBe("The Dynasty Room");
  });

  it("puts the meta line after the name", () => {
    expect(describeChoice(choice({ meta: "12 teams, 2026" }))).toBe(
      "The Dynasty Room. 12 teams, 2026",
    );
  });

  it("says why a choice cannot be picked", () => {
    expect(
      describeChoice(choice({ disabledReason: "No draft yet" })),
    ).toBe("The Dynasty Room. No draft yet");
  });

  it("says out loud that a row is working", () => {
    expect(describeChoice(choice({ busyLabel: "Loading" }))).toBe(
      "The Dynasty Room. Loading",
    );
  });

  it("reads name, meta, busy, then reason", () => {
    expect(
      describeChoice(
        choice({
          meta: "12 teams",
          busyLabel: "Syncing",
          disabledReason: "Not ready",
        }),
      ),
    ).toBe("The Dynasty Room. 12 teams. Syncing. Not ready");
  });
});
