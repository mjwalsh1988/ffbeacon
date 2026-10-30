import { describe, expect, it } from "vitest";
import { ageHistoryPayload, easternDay, writeAgeHistory } from "./age-history";
import type { BlueprintAge } from "./types";

const age: BlueprintAge = {
  rows: [
    { position: "QB", mine: 28.1, league: 27.4, gap: -0.7, count: 2 },
    { position: "RB", mine: null, league: 25, gap: null, count: 0 },
    { position: "WR", mine: 24.5, league: 26, gap: 1.5, count: 4 },
    { position: "TE", mine: 27, league: 27.2, gap: 0.2, count: 1 },
  ],
  rosterMean: 26.2,
  leagueMean: 26.5,
  gap: 0.3,
  youngCoreShare: 0.4,
};

describe("age history", () => {
  it("dates by the Eastern day, not the UTC one", () => {
    // 02:30 UTC on Oct 30 is still Oct 29 in New York.
    expect(easternDay(new Date("2026-10-30T02:30:00Z"))).toBe("2026-10-29");
  });

  it("stores the four position pairs, counts and both means", () => {
    expect(ageHistoryPayload(age)).toEqual({
      QB: { mine: 28.1, league: 27.4, count: 2 },
      RB: { mine: null, league: 25, count: 0 },
      WR: { mine: 24.5, league: 26, count: 4 },
      TE: { mine: 27, league: 27.2, count: 1 },
      roster: 26.2,
      league: 26.5,
    });
  });

  it("upserts one row per roster per day", async () => {
    const calls: Array<{ row: Record<string, unknown>; opts: unknown }> = [];
    const client = {
      from: () => ({
        upsert: (row: Record<string, unknown>, opts: unknown) => {
          calls.push({ row, opts });
          return Promise.resolve({ error: null });
        },
      }),
    } as never;
    await writeAgeHistory(client, { leagueRowId: "L", rosterId: 3, season: "2026", age, at: new Date("2026-10-29T15:00:00Z") });
    expect(calls[0].row).toMatchObject({ league_id: "L", roster_id: 3, as_of_day: "2026-10-29" });
    expect(calls[0].opts).toEqual({ onConflict: "league_id,roster_id,as_of_day" });
  });
});
