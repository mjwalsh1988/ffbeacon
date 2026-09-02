/**
 * Coverage for the failure posture rule added on top of runNflOddsSync: a
 * total ESPN outage (every targeted week's fetch failed) must throw so
 * recordCronRun marks the cron ledger entry "error" and cron-health can page
 * on it, while a partial failure and a genuine empty slate both stay
 * ok:true and must never throw. season/fromWeek/toWeek are always passed
 * explicitly so runNflOddsSync never calls getNflState(), keeping these tests
 * independent of lib/sleeper.ts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./nfl-odds", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./nfl-odds")>();
  return { ...actual, getEspnScoreboard: vi.fn() };
});

import { runNflOddsSync } from "./sync-nfl-odds";
import { getEspnScoreboard, type EspnOddsGame } from "./nfl-odds";
import type { Database } from "./database.types";
import type { SupabaseClient } from "@supabase/supabase-js";

const getEspnScoreboardMock = vi.mocked(getEspnScoreboard);

function game(overrides: Partial<EspnOddsGame> = {}): EspnOddsGame {
  return {
    season: 2026,
    seasonType: "regular",
    week: 6,
    homeTeam: "SEA",
    awayTeam: "NE",
    kickoffAt: "2026-10-08T00:20:00Z",
    gameTotal: 44.5,
    homeSpread: -3.5,
    provider: "DraftKings",
    raw: { id: "401" },
    ...overrides,
  };
}

/** A minimal fake covering only what runNflOddsSync calls: from(...).upsert(...). */
function fakeSupabase() {
  const upsertCalls: Array<{ table: string; rows: unknown[] }> = [];
  const client = {
    from(table: string) {
      return {
        upsert: async (rows: unknown[]) => {
          upsertCalls.push({ table, rows });
          return { error: null };
        },
      };
    },
  };
  return { client: client as unknown as SupabaseClient<Database>, upsertCalls };
}

beforeEach(() => {
  getEspnScoreboardMock.mockReset();
});
afterEach(() => {
  vi.clearAllMocks();
});

describe("runNflOddsSync failure posture", () => {
  it("throws when every targeted week's fetch failed, so the ledger records an error", async () => {
    getEspnScoreboardMock.mockResolvedValue(null);
    const { client, upsertCalls } = fakeSupabase();

    await expect(
      runNflOddsSync(client, { season: 2026, seasonType: "regular", fromWeek: 5, toWeek: 6 }),
    ).rejects.toThrow(
      "ESPN scoreboard request failed for all 2 targeted week(s) (5, 6) for 2026 regular; treating this as an outage rather than a healthy run.",
    );
    expect(upsertCalls).toHaveLength(0);
  });

  it("stays ok:true with the failure surfaced when only some weeks failed", async () => {
    getEspnScoreboardMock.mockImplementation(async (_season, week) => {
      if (week === 5) return null; // failed fetch
      if (week === 6) return [game({ week: 6 })]; // a real game
      return []; // week 7: ESPN answered, nothing published yet
    });
    const { client, upsertCalls } = fakeSupabase();

    const result = await runNflOddsSync(client, {
      season: 2026,
      seasonType: "regular",
      fromWeek: 5,
      toWeek: 7,
    });

    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.failedWeeks).toEqual([5]);
    expect(result.totalStored).toBe(1);
    expect(result.perWeek).toEqual([
      { week: 5, status: "failed", fetched: 0, stored: 0 },
      { week: 6, status: "ok", fetched: 1, stored: 1 },
      { week: 7, status: "ok", fetched: 0, stored: 0 },
    ]);
    expect(upsertCalls).toHaveLength(1);
  });

  it("returns skipped:true without throwing when every week fetched cleanly with no games", async () => {
    getEspnScoreboardMock.mockResolvedValue([]);
    const { client, upsertCalls } = fakeSupabase();

    const result = await runNflOddsSync(client, {
      season: 2026,
      seasonType: "regular",
      fromWeek: 1,
      toWeek: 3,
    });

    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.reason).toContain("no games published by ESPN");
    expect(result.failedWeeks).toEqual([]);
    expect(result.totalStored).toBe(0);
    expect(upsertCalls).toHaveLength(0);
  });
});
