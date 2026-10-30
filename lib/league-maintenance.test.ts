import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/league-removal", () => ({
  LEAGUE_NOT_FOUND_ERROR: "Sleeper league fetch returned null",
  checkLeagueStillMissing: vi.fn(),
}));

import {
  BLUEPRINT_CACHE_RETENTION_DAYS,
  NOT_FOUND_BATCH_SIZE,
  pruneBlueprintTables,
  recheckNotFoundLeagues,
  resetStuckSyncs,
  runLeagueMaintenance,
  STUCK_SYNC_MS,
} from "./league-maintenance";
import { checkLeagueStillMissing } from "@/lib/league-removal";

const NOW = Date.parse("2026-09-29T12:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resetStuckSyncs", () => {
  it("flips only rows still syncing and older than the cutoff, in one statement", async () => {
    const filters: Array<[string, string, unknown]> = [];
    let payload: Record<string, unknown> | null = null;
    const builder = {
      update: (p: Record<string, unknown>) => {
        payload = p;
        return builder;
      },
      eq: (col: string, val: unknown) => {
        filters.push(["eq", col, val]);
        return builder;
      },
      lt: (col: string, val: unknown) => {
        filters.push(["lt", col, val]);
        return builder;
      },
      select: () => Promise.resolve({ data: [{ id: "a" }, { id: "b" }], error: null }),
    };
    const client = { from: () => builder } as never;

    const count = await resetStuckSyncs(client, NOW);

    expect(count).toBe(2);
    expect(filters).toEqual([
      ["eq", "pulse_status", "syncing"],
      ["lt", "updated_at", new Date(NOW - STUCK_SYNC_MS).toISOString()],
    ]);
    // `error` is never fresh to isLeaguePulseFresh, so the next view resyncs.
    expect(payload).toMatchObject({ pulse_status: "error" });
  });
});

describe("recheckNotFoundLeagues", () => {
  function client(rows: Array<{ id: string; sleeper_league_id: string }>) {
    const seen: Record<string, unknown> = {};
    const builder = {
      select: () => builder,
      eq: (col: string, val: unknown) => {
        seen[col] = val;
        return builder;
      },
      order: () => builder,
      limit: (n: number) => {
        seen.limit = n;
        return Promise.resolve({ data: rows, error: null });
      },
    };
    return { client: { from: () => builder } as never, seen };
  }

  it("reads only not-found leagues, bounded, and tallies each outcome", async () => {
    const { client: c, seen } = client([
      { id: "1", sleeper_league_id: "a" },
      { id: "2", sleeper_league_id: "b" },
      { id: "3", sleeper_league_id: "c" },
      { id: "4", sleeper_league_id: "d" },
    ]);
    vi.mocked(checkLeagueStillMissing)
      .mockResolvedValueOnce({ status: "found" })
      .mockResolvedValueOnce({ status: "failed" })
      .mockResolvedValueOnce({ status: "not_found", outcome: "deleted" })
      .mockResolvedValueOnce({ status: "not_found", outcome: "waiting" });

    const out = await recheckNotFoundLeagues(c, NOW);

    expect(seen.pulse_error).toBe("Sleeper league fetch returned null");
    expect(seen.limit).toBe(NOT_FOUND_BATCH_SIZE);
    expect(out).toMatchObject({
      checked: 4,
      stillThere: 1,
      requestFailed: 1,
      deleted: 1,
      waiting: 1,
    });
  });
});

describe("pruneBlueprintTables", () => {
  it("issues one dated DELETE per table", async () => {
    const calls: Array<{ table: string; col: string; val: unknown }> = [];
    const client = {
      from: (table: string) => ({
        delete: () => ({
          lt: (col: string, val: unknown) => {
            calls.push({ table, col, val });
            return Promise.resolve({ count: table === "league_blueprint_cache" ? 3 : 1, error: null });
          },
        }),
      }),
    } as never;

    const out = await pruneBlueprintTables(client, NOW);

    expect(out).toEqual({ cacheDeleted: 3, ageHistoryDeleted: 1 });
    expect(calls).toEqual([
      {
        table: "league_blueprint_cache",
        col: "generated_at",
        val: new Date(NOW - BLUEPRINT_CACHE_RETENTION_DAYS * 86_400_000).toISOString(),
      },
      { table: "league_roster_age_history", col: "as_of_day", val: "2024-09-29" },
    ]);
  });
});

describe("runLeagueMaintenance", () => {
  it("records a failed blueprint prune as a step and still runs the not-found recheck", async () => {
    const tablesRead: string[] = [];
    // Every chain resolves; a DELETE fails, everything else returns nothing.
    const chain = (failing: boolean): unknown =>
      new Proxy(
        {},
        {
          get: (_t, prop) => {
            if (prop === "then") {
              const result = failing
                ? { data: null, count: null, error: { message: "delete timed out" } }
                : { data: [], count: 0, error: null };
              return (resolve: (v: unknown) => void) => resolve(result);
            }
            return (..._args: unknown[]) => chain(failing || prop === "delete");
          },
        },
      );
    const client = {
      from: (table: string) => {
        tablesRead.push(table);
        return chain(false);
      },
    } as never;

    const out = await runLeagueMaintenance(client, NOW);

    expect(out.blueprintPrune).toBeNull();
    expect(out.failedSteps).toEqual([expect.stringContaining("blueprintPrune")]);
    expect(out.notFound.checked).toBe(0);
    expect(tablesRead.filter((t) => t === "leagues").length).toBeGreaterThanOrEqual(2);
  });
});
