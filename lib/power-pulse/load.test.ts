/**
 * Regression guard for the league_matchups sync change (T626).
 *
 * lib/league-matchups.ts stopped filtering Sleeper's "0" placeholders out of
 * `starter_ids` on the way in, so the Schedule page can read the array
 * positionally. The argument that this moves no Power Pulse number is that
 * loadSchedule's own `asStringArray` already drops "0", making the placeholders
 * invisible to it either way.
 *
 * That argument is correct. It is also exactly the kind of thing that stays
 * correct right up until someone changes one of the two functions, so it is
 * checked here rather than trusted. The two datasets below differ ONLY in
 * whether the placeholders are present. loadSchedule must not be able to tell.
 */

import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { loadSchedule } from "./load";

type MatchupRow = {
  week: number;
  sleeper_roster_id: number;
  matchup_id: number | null;
  is_final: boolean;
  starter_ids: unknown;
};

/**
 * The smallest client that satisfies loadSchedule's call chain:
 * from().select().eq().eq().order() awaited for { data, error }.
 */
function fakeClient(rows: MatchupRow[]): SupabaseClient<Database> {
  const builder = {
    select: () => builder,
    eq: () => builder,
    order: () => Promise.resolve({ data: rows, error: null }),
  };
  return { from: () => builder } as unknown as SupabaseClient<Database>;
}

/** The same league, written before and after the sync stopped filtering. */
function dataset(starters: Record<number, string[]>): MatchupRow[] {
  return [
    { week: 1, sleeper_roster_id: 1, matchup_id: 1, is_final: true, starter_ids: starters[1] },
    { week: 1, sleeper_roster_id: 2, matchup_id: 1, is_final: true, starter_ids: starters[2] },
    { week: 2, sleeper_roster_id: 1, matchup_id: 1, is_final: false, starter_ids: starters[1] },
    { week: 2, sleeper_roster_id: 2, matchup_id: 1, is_final: false, starter_ids: starters[2] },
  ];
}

const WITH_PLACEHOLDERS = dataset({ 1: ["11", "0", "22"], 2: ["0", "33", "44"] });
const ALREADY_FILTERED = dataset({ 1: ["11", "22"], 2: ["33", "44"] });

describe("loadSchedule against the T626 sync change", () => {
  it("reads the same set lineups whether or not the placeholders are stored", async () => {
    const before = await loadSchedule(fakeClient(ALREADY_FILTERED), "league-1", 2026);
    const after = await loadSchedule(fakeClient(WITH_PLACEHOLDERS), "league-1", 2026);
    expect(after.setLineups).toEqual(before.setLineups);
  });

  it("reads the same schedule whether or not the placeholders are stored", async () => {
    const before = await loadSchedule(fakeClient(ALREADY_FILTERED), "league-1", 2026);
    const after = await loadSchedule(fakeClient(WITH_PLACEHOLDERS), "league-1", 2026);
    expect(after.weeks).toEqual(before.weeks);
  });

  it("drops the placeholder rather than carrying it as a player id", async () => {
    const { setLineups } = await loadSchedule(fakeClient(WITH_PLACEHOLDERS), "league-1", 2026);
    expect(setLineups.get("1|1")).toEqual(["11", "22"]);
    expect(setLineups.get("1|2")).toEqual(["33", "44"]);
  });

  it("still pairs the rosters and marks the settled week final", async () => {
    const { weeks } = await loadSchedule(fakeClient(WITH_PLACEHOLDERS), "league-1", 2026);
    expect(weeks.map((w) => w.week)).toEqual([1, 2]);
    expect(weeks[0].isFinal).toBe(true);
    expect(weeks[1].isFinal).toBe(false);
    expect(weeks[0].opponents.get(1)).toBe(2);
    expect(weeks[0].opponents.get(2)).toBe(1);
  });
});
