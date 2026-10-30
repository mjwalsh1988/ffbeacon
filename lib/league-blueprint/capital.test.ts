import { describe, expect, it } from "vitest";
import { computeCapital, pickShortLabel } from "./capital";
import { buildLeague, pick } from "./__fixtures__/league";

describe("computeCapital", () => {
  it("groups the reader's picks by season and ranks each season", () => {
    const teams = buildLeague();
    const out = computeCapital(teams, 1, "KTC");
    expect(out.seasons.map((s) => s.season)).toEqual([2027, 2028]);
    const s27 = out.seasons[0];
    // Reader holds 3000 + 1200 in 2027; every other roster holds 3000.
    expect(s27.value).toBe(4200);
    expect(s27.rank).toBe(1);
    expect(s27.picks.map((p) => p.label)).toEqual(["R1, mid", "R2, mid"]);
    expect(out.seasons[1].rank).toBe(1); // tied at 2800, lowest roster id first
    expect(out.pickSourceDisplay).toBe("KTC");
  });

  it("lists and counts unpriced picks but adds nothing for them", () => {
    const teams = buildLeague();
    teams[0].picks.push(pick(1, 2029, 1, 0));
    const s29 = computeCapital(teams, 1, null).seasons.find((s) => s.season === 2029)!;
    expect(s29.picks).toHaveLength(1);
    expect(s29.unpricedCount).toBe(1);
    expect(s29.value).toBe(0);
    expect(s29.rank).toBeNull();
  });

  it("labels an acquired pick with its original owner", () => {
    const teams = buildLeague();
    teams[0].picks.push({ ...pick(5, 2027, 3, 500), isOwnPick: false, label: "2027 R3, mid, via @owner5" });
    const p = computeCapital(teams, 1, null).seasons[0].picks.find((x) => x.label === "R3, mid")!;
    expect(p.via).toBe("via @owner5");
    expect(pickShortLabel({ ...pick(5, 2027, 3, 500), label: "2027 1.05, via @x" })).toBe("1.05");
  });
});
