import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/league-removal", () => ({
  LEAGUE_NOT_FOUND_ERROR: "Sleeper league fetch returned null",
  checkLeagueStillMissing: vi.fn(),
}));

import {
  NOT_FOUND_BATCH_SIZE,
  recheckNotFoundLeagues,
  resetStuckSyncs,
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
