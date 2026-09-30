import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { loadLatestPickSnapshot } from "./draft-pick-snapshot";

type Row = {
  id: string;
  format_config_id: string;
  source: string;
  captured_at: string;
  season: number;
  round: number;
  pick_position: string;
  value: number;
};

/** A small PostgREST stand-in: eq, order, limit, gt, maybeSingle, await. */
function fakeClient(rows: Row[], opts: { failNewest?: boolean } = {}) {
  const calls: string[] = [];
  const client = {
    from: () => {
      let result = [...rows];
      let cap: number | null = null;
      let selected = "";
      const builder: Record<string, unknown> = {
        select: (cols: string) => {
          selected = cols;
          return builder;
        },
        eq: (col: keyof Row, val: unknown) => {
          result = result.filter((r) => r[col] === val);
          return builder;
        },
        gt: (col: keyof Row, val: unknown) => {
          result = result.filter((r) => String(r[col]) > String(val));
          return builder;
        },
        order: (col: keyof Row, o: { ascending: boolean }) => {
          result.sort((a, b) => {
            const cmp = String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0;
            return o.ascending ? cmp : -cmp;
          });
          return builder;
        },
        limit: (n: number) => {
          cap = n;
          return builder;
        },
        maybeSingle: () => {
          calls.push(`newest:${selected}`);
          if (opts.failNewest) return Promise.resolve({ data: null, error: { message: "boom" } });
          return Promise.resolve({ data: result[0] ?? null, error: null });
        },
        then: (resolve: (v: unknown) => unknown) => {
          calls.push(`page:${selected}`);
          return Promise.resolve({ data: cap === null ? result : result.slice(0, cap), error: null }).then(resolve);
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient<Database>;
  return { client, calls };
}

function row(over: Partial<Row>): Row {
  return {
    id: "00",
    format_config_id: "f1",
    source: "ktc",
    captured_at: "2026-09-29T07:00:00Z",
    season: 2027,
    round: 1,
    pick_position: "early",
    value: 100,
    ...over,
  };
}

describe("loadLatestPickSnapshot", () => {
  it("reads only the newest capture of the asked format and source", async () => {
    const { client } = fakeClient([
      row({ id: "01", captured_at: "2026-09-28T07:00:00Z", value: 90 }),
      row({ id: "02", captured_at: "2026-09-29T07:00:00Z", value: 100 }),
      row({ id: "03", captured_at: "2026-09-29T07:00:00Z", round: 2, value: 50 }),
      // A slot only the older capture has: absent from the answer, not carried forward.
      row({ id: "04", captured_at: "2026-09-07T07:00:00Z", season: 2026, value: 70 }),
      // Another source and another format, newer still: ignored.
      row({ id: "05", source: "ffbeacon", captured_at: "2026-09-29T09:30:00Z", value: 1 }),
      row({ id: "06", format_config_id: "f2", captured_at: "2026-09-29T09:30:00Z", value: 2 }),
    ]);
    const snap = await loadLatestPickSnapshot(client, "f1", "ktc");
    expect(snap.capturedAt).toBe("2026-09-29T07:00:00Z");
    expect(snap.rows).toEqual([
      { season: 2027, round: 1, pick_position: "early", value: 100 },
      { season: 2027, round: 2, pick_position: "early", value: 50 },
    ]);
  });

  it("returns nothing, and reads no rows, when the source has no picks", async () => {
    const { client, calls } = fakeClient([row({ source: "ffbeacon" })]);
    const snap = await loadLatestPickSnapshot(client, "f1", "ktc");
    expect(snap).toEqual({ capturedAt: null, rows: [] });
    expect(calls.filter((c) => c.startsWith("page:"))).toHaveLength(0);
  });

  it("throws on a failed read rather than reporting no picks", async () => {
    const { client } = fakeClient([row({})], { failNewest: true });
    await expect(loadLatestPickSnapshot(client, "f1", "ktc")).rejects.toThrow(/boom/);
  });
});
