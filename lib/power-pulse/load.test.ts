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
import { loadSchedule, loadAccuracy } from "./load";

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

/**
 * Coverage for loadAccuracy's `source` parameter (the projection engine
 * review's finding 1). Before this parameter existed, the query carried no
 * source filter at all, so once a source='ffbeacon' blended row existed
 * alongside a source='sleeper' one for the same player, whichever row
 * PostgREST happened to return last silently won, mixing two sources'
 * reliability figures into one.
 */
describe("loadAccuracy source scoping", () => {
  type AccuracyDbRow = {
    player_id: string;
    scoring: string;
    season: number | null;
    source: string;
    shrunk_multiplier: number | null;
    beat_rate: number | null;
    availability_rate: number | null;
    ratio_stdev: number | null;
    weeks_played: number;
  };

  /**
   * The smallest client that satisfies loadAccuracy's call chain:
   * from().select().eq(scoring).eq(source).is(season, null).in(player_id).
   */
  function fakeAccuracyClient(rows: AccuracyDbRow[]): SupabaseClient<Database> {
    const eqFilters: Record<string, unknown> = {};
    let isSeasonNull = false;
    let inIds: string[] = [];
    const builder = {
      select: () => builder,
      eq(col: string, val: unknown) {
        eqFilters[col] = val;
        return builder;
      },
      is(col: string, val: unknown) {
        if (col === "season" && val === null) isSeasonNull = true;
        return builder;
      },
      in(_col: string, vals: string[]) {
        inIds = vals;
        return Promise.resolve({
          data: rows.filter(
            (r) =>
              Object.entries(eqFilters).every(([k, v]) => (r as Record<string, unknown>)[k] === v) &&
              (!isSeasonNull || r.season === null) &&
              inIds.includes(r.player_id),
          ),
          error: null,
        });
      },
    };
    return { from: () => builder } as unknown as SupabaseClient<Database>;
  }

  function row(over: Partial<AccuracyDbRow> & Pick<AccuracyDbRow, "player_id" | "source" | "shrunk_multiplier">): AccuracyDbRow {
    return {
      scoring: "pts_ppr",
      season: null,
      beat_rate: null,
      availability_rate: null,
      ratio_stdev: null,
      weeks_played: 10,
      ...over,
    };
  }

  it("defaults to the sleeper source when none is passed, matching every pre-existing caller", async () => {
    const client = fakeAccuracyClient([
      row({ player_id: "p1", source: "sleeper", shrunk_multiplier: 1.05 }),
      row({ player_id: "p1", source: "ffbeacon", shrunk_multiplier: 0.7 }),
    ]);
    const out = await loadAccuracy(client, ["p1"], "pts_ppr");
    expect(out.get("p1")?.shrunkMultiplier).toBe(1.05);
  });

  it("reads only the requested source's row when both exist for the same player", async () => {
    const client = fakeAccuracyClient([
      row({ player_id: "p1", source: "sleeper", shrunk_multiplier: 1.05 }),
      row({ player_id: "p1", source: "ffbeacon", shrunk_multiplier: 0.7 }),
    ]);
    const out = await loadAccuracy(client, ["p1"], "pts_ppr", "ffbeacon");
    expect(out.get("p1")?.shrunkMultiplier).toBe(0.7);
  });

  it("returns nothing for a player who has no row under the requested source", async () => {
    const client = fakeAccuracyClient([
      row({ player_id: "p1", source: "sleeper", shrunk_multiplier: 1.05 }),
    ]);
    const out = await loadAccuracy(client, ["p1"], "pts_ppr", "ffbeacon");
    expect(out.has("p1")).toBe(false);
  });
});
