import { describe, expect, it } from "vitest";
import {
  compareFreeAgentLeagues,
  resolveSlot,
  ROSTER_SLOT_LABEL,
  type FreeAgentLeague,
} from "./free-agent-finder";

function row(over: Partial<FreeAgentLeague> = {}): FreeAgentLeague {
  return {
    sleeperLeagueId: "1",
    leagueName: "League",
    avatar: null,
    isFreeAgent: true,
    rosteredBy: null,
    isYours: false,
    slot: null,
    ...over,
  };
}

describe("compareFreeAgentLeagues", () => {
  it("puts free agents above rostered", () => {
    const taken = row({ leagueName: "Alpha", isFreeAgent: false });
    const free = row({ leagueName: "Zeta", isFreeAgent: true });
    expect([taken, free].sort(compareFreeAgentLeagues)[0]).toBe(free);
  });

  it("alphabetizes within a band, case insensitively", () => {
    const sorted = [
      row({ leagueName: "zeta" }),
      row({ leagueName: "Alpha" }),
      row({ leagueName: "mid" }),
    ].sort(compareFreeAgentLeagues);
    expect(sorted.map((l) => l.leagueName)).toEqual(["Alpha", "mid", "zeta"]);
  });

  it("keeps both bands sorted at once", () => {
    const sorted = [
      row({ leagueName: "B", isFreeAgent: false }),
      row({ leagueName: "Z", isFreeAgent: true }),
      row({ leagueName: "A", isFreeAgent: false }),
      row({ leagueName: "C", isFreeAgent: true }),
    ].sort(compareFreeAgentLeagues);
    expect(
      sorted.map((l) => `${l.leagueName}${l.isFreeAgent ? "+" : "-"}`),
    ).toEqual(["C+", "Z+", "A-", "B-"]);
  });
});

describe("resolveSlot", () => {
  const empty = { starter_ids: [], reserve_ids: [], taxi_ids: [] };

  it("reports a starter", () => {
    expect(resolveSlot("99", { ...empty, starter_ids: ["4", "99"] })).toBe(
      "starter",
    );
  });

  it("reports IR", () => {
    expect(resolveSlot("99", { ...empty, reserve_ids: ["99"] })).toBe(
      "reserve",
    );
  });

  it("reports the taxi squad", () => {
    expect(resolveSlot("99", { ...empty, taxi_ids: ["99"] })).toBe("taxi");
  });

  it("falls back to the bench", () => {
    expect(resolveSlot("99", empty)).toBe("bench");
  });

  it("prefers the more specific slot when a player is in two arrays", () => {
    // Sleeper has shipped rosters where an IR player is also listed as a
    // starter. The special array is the more informative answer.
    expect(
      resolveSlot("99", {
        ...empty,
        starter_ids: ["99"],
        reserve_ids: ["99"],
      }),
    ).toBe("starter");
    expect(
      resolveSlot("99", { ...empty, reserve_ids: ["99"], taxi_ids: ["99"] }),
    ).toBe("reserve");
  });

  it("ignores Sleeper's empty-slot placeholder", () => {
    expect(resolveSlot("0", { ...empty, starter_ids: ["0", "0"] })).toBe(
      "bench",
    );
  });

  it("survives a column that is not an array", () => {
    expect(
      resolveSlot("99", {
        starter_ids: null,
        reserve_ids: "not an array",
        taxi_ids: undefined,
      }),
    ).toBe("bench");
  });
});

describe("ROSTER_SLOT_LABEL", () => {
  it("labels every slot the resolver can return", () => {
    expect(Object.keys(ROSTER_SLOT_LABEL).sort()).toEqual([
      "bench",
      "reserve",
      "starter",
      "taxi",
    ]);
  });
});
