import { describe, it, expect, vi, beforeEach } from "vitest";

const getSleeperMatchups = vi.fn();
vi.mock("@/lib/sleeper", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sleeper")>();
  return { ...actual, getSleeperMatchups: (...args: unknown[]) => getSleeperMatchups(...args) };
});

import {
  MAX_MATCHUP_WEEK,
  normalizeIdList,
  resolveCurrentWeek,
  syncLeagueMatchups,
  weeksToFetch,
  type StoredWeekState,
} from "./league-matchups";

describe("normalizeIdList", () => {
  it("keeps Sleeper's empty-slot placeholder", () => {
    expect(normalizeIdList(["11", "0", "22"])).toEqual(["11", "0", "22"]);
  });

  it("turns a non-string into an empty string instead of removing it", () => {
    expect(normalizeIdList(["11", 22, null, undefined, { id: 3 }])).toEqual([
      "11",
      "",
      "",
      "",
      "",
    ]);
  });

  it("returns an empty array for anything that is not an array", () => {
    expect(normalizeIdList(null)).toEqual([]);
    expect(normalizeIdList(undefined)).toEqual([]);
    expect(normalizeIdList("11,22")).toEqual([]);
    expect(normalizeIdList({ 0: "11" })).toEqual([]);
  });

  it("returns exactly as many entries as it was given", () => {
    for (const input of [[], ["11"], ["11", "0"], ["0", "0", "0", "44"]]) {
      expect(normalizeIdList(input)).toHaveLength(input.length);
    }
  });

  /**
   * GUARD. This is not a duplicate of the first test, it is the reason the
   * first test is allowed to be that boring.
   *
   * `starters` is POSITIONAL: index i is the i-th startable slot of the
   * league's roster_positions, and "0" means the manager left that slot empty.
   * A `.filter(validPlayerId)` here looks like harmless cleanup and it is not:
   * removing the placeholder shifts every player below it up one slot, so the
   * Schedule page renders a lineup nobody set. The array is stored verbatim and
   * every reader filters at read time.
   *
   * If this assertion fails, someone reintroduced the filter. Do not fix the
   * test. Fix the filter, and read lib/league-schedule/lineups.ts on the way.
   */
  it("must not shorten the array: the length IS the slot alignment", () => {
    expect(normalizeIdList(["1", "0", "2"])).toHaveLength(3);
    expect(normalizeIdList(["1", "0", "2"])[2]).toBe("2");
  });
});

describe("weeksToFetch", () => {
  const state = (
    week: number,
    settled: boolean,
    scored: boolean,
  ): StoredWeekState => ({ week, settled, scored });

  it("asks for the whole season when nothing is stored", () => {
    expect(weeksToFetch([], 5, false)).toHaveLength(18);
  });

  it("asks for the whole season on force, however much is stored", () => {
    const stored = Array.from({ length: 18 }, (_, i) => state(i + 1, true, true));
    expect(weeksToFetch(stored, 5, true)).toHaveLength(18);
  });

  it("refreshes the current week and the two ahead of it", () => {
    const stored = Array.from({ length: 18 }, (_, i) => state(i + 1, true, true));
    expect(weeksToFetch(stored, 5, false)).toEqual([5, 6, 7]);
  });

  it("fills a gap in the stored slate", () => {
    const stored = Array.from({ length: 18 }, (_, i) => state(i + 1, true, true)).filter(
      (s) => s.week !== 2,
    );
    expect(weeksToFetch(stored, 10, false)).toEqual([2, 10, 11, 12]);
  });

  it("keeps chasing a past week that has points but has not settled", () => {
    // THE BUG THIS CLOSES. The window used to run forward only, so a week last
    // written mid-Sunday kept its half-played scores forever once Sleeper moved
    // on. Week 3 scored and is not final, so it is asked for again even though
    // it is seven weeks behind.
    const stored = Array.from({ length: 18 }, (_, i) =>
      state(i + 1, i + 1 !== 3, true),
    );
    expect(weeksToFetch(stored, 10, false)).toContain(3);
  });

  it("stops chasing a stale week that never scored, so an abandoned league costs nothing", () => {
    const stored = Array.from({ length: 18 }, (_, i) =>
      state(i + 1, false, false),
    );
    const targets = weeksToFetch(stored, 10, false);
    // The lookback is three weeks, so 7, 8 and 9 are still chased and 6 is not.
    expect(targets).toContain(7);
    expect(targets).not.toContain(6);
    expect(targets).not.toContain(1);
  });

  it("leaves a settled past week alone", () => {
    const stored = Array.from({ length: 18 }, (_, i) => state(i + 1, true, true));
    expect(weeksToFetch(stored, 10, false)).not.toContain(9);
  });
});

describe("resolveCurrentWeek", () => {
  it("returns null, not week 1, when Sleeper's NFL state did not answer", () => {
    expect(resolveCurrentWeek(null, 2026, 15)).toBeNull();
  });

  it("treats the NFL postseason as every fantasy week played", () => {
    expect(resolveCurrentWeek({ season: "2026", season_type: "post", week: 19 }, 2026, 15)).toBe(
      MAX_MATCHUP_WEEK + 1,
    );
  });

  it("reads the regular season week and floors the preseason to week 1", () => {
    expect(resolveCurrentWeek({ season: "2026", season_type: "regular", week: 9 }, 2026, 15)).toBe(9);
    expect(resolveCurrentWeek({ season: "2026", season_type: "pre", week: 0 }, 2026, 15)).toBe(1);
  });

  it("calls a past season fully played", () => {
    expect(resolveCurrentWeek({ season: "2026", season_type: "regular", week: 3 }, 2025, 15)).toBe(
      MAX_MATCHUP_WEEK + 1,
    );
  });
});

/** A fake client holding stored matchup rows, a frozen flag, and the upserts it saw. */
function fakeClient(opts: {
  stored: Array<{ week: number; sleeper_roster_id: number; is_final: boolean; points: number }>;
  frozenAt?: string | null;
}) {
  const upserts: Array<Record<string, unknown>> = [];
  const client = {
    from(table: string) {
      if (table === "leagues") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { frozen_at: opts.frozenAt ?? null }, error: null }),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({ eq: async () => ({ data: opts.stored, error: null }) }),
        }),
        upsert: async (rows: Array<Record<string, unknown>>) => {
          upserts.push(...rows);
          return { error: null };
        },
      };
    },
  };
  return { client: client as never, upserts };
}

describe("syncLeagueMatchups", () => {
  beforeEach(() => {
    getSleeperMatchups.mockReset();
  });

  it("makes no Sleeper request for a frozen league", async () => {
    const { client, upserts } = fakeClient({ stored: [], frozenAt: "2026-11-13T00:00:00Z" });
    const result = await syncLeagueMatchups(client, "row", "sl", 2025, MAX_MATCHUP_WEEK + 1, {
      force: true,
    });
    expect(result.ok).toBe(true);
    expect(getSleeperMatchups).not.toHaveBeenCalled();
    expect(upserts).toHaveLength(0);
  });

  it("never writes a stored final row back as unfinished", async () => {
    // Week 9 settled for both rosters. The current week resolved lower than
    // before (5), so the fresh answer alone would call week 9 unplayed.
    const stored = Array.from({ length: MAX_MATCHUP_WEEK }, (_, i) => [
      { week: i + 1, sleeper_roster_id: 1, is_final: i + 1 === 9, points: 100 },
      { week: i + 1, sleeper_roster_id: 2, is_final: i + 1 === 9, points: 90 },
    ]).flat();
    const { client, upserts } = fakeClient({ stored });
    getSleeperMatchups.mockImplementation(async (_id: string, week: number) => [
      { roster_id: 1, matchup_id: 1, points: week === 9 ? 101 : 0, starters: [], players: [] },
      { roster_id: 2, matchup_id: 1, points: week === 9 ? 91 : 0, starters: [], players: [] },
    ]);
    await syncLeagueMatchups(client, "row", "sl", 2026, 5, { force: true });
    const week9 = upserts.filter((r) => r.week === 9);
    expect(week9).toHaveLength(2);
    expect(week9.every((r) => r.is_final === true)).toBe(true);
    // An unplayed future week with nothing stored as final stays open.
    expect(upserts.filter((r) => r.week === 12).every((r) => r.is_final === false)).toBe(true);
  });
});
