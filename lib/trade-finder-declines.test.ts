import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { DECLINE_LIMITS, loadDeclinedKeysForLeagues } from "./trade-finder-declines";

type Row = { sleeper_league_id: string; suggestion_key: string };

/** Rows come back in the order given, paged by .range(); `failAt` errors that page. */
function fakeClient(rows: Row[], failAt?: number): SupabaseClient<Database> {
  const builder = (): Record<string, unknown> => {
    let ids: string[] = [];
    const b: Record<string, unknown> = {
      select: () => b,
      in: (_col: string, vals: string[]) => {
        ids = vals;
        return b;
      },
      gt: () => b,
      order: () => b,
      range: (from: number, to: number) =>
        Promise.resolve(
          from === failAt
            ? { data: null, error: { message: "timeout" } }
            : {
                data: rows.filter((r) => ids.includes(r.sleeper_league_id)).slice(from, to + 1),
                error: null,
              },
        ),
    };
    return b;
  };
  return { from: () => builder() } as unknown as SupabaseClient<Database>;
}

describe("loadDeclinedKeysForLeagues", () => {
  it("pages past 1000 rows and caps each league at the per-league ceiling", async () => {
    const cap = DECLINE_LIMITS.MAX_DECLINES_PER_LEAGUE;
    const rows: Row[] = [
      ...Array.from({ length: cap + 50 }, (_, i) => ({ sleeper_league_id: "L1", suggestion_key: `a${i}` })),
      ...Array.from({ length: 900 }, (_, i) => ({ sleeper_league_id: "L2", suggestion_key: `b${i}` })),
      { sleeper_league_id: "L3", suggestion_key: "c0" },
    ];
    const out = await loadDeclinedKeysForLeagues(fakeClient(rows), ["L1", "L2", "L3"]);
    expect(out.get("L1")).toHaveLength(cap);
    expect(out.get("L1")?.[0]).toBe("a0");
    expect(out.get("L2")).toHaveLength(cap);
    // L3's only row sits past the first 1000, so finding it proves the second page ran.
    expect(out.get("L3")).toEqual(["c0"]);
  });

  it("returns nothing, not a partial map, when a later page fails", async () => {
    const rows: Row[] = Array.from({ length: 1500 }, (_, i) => ({
      sleeper_league_id: i < 1000 ? "L1" : "L2",
      suggestion_key: `k${i}`,
    }));
    const out = await loadDeclinedKeysForLeagues(fakeClient(rows, 1000), ["L1", "L2"]);
    expect(out.size).toBe(0);
  });
});
