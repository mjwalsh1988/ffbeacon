import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./sleeper", () => ({
  getNflState: vi.fn(),
  getWeeklyStatsOrNull: vi.fn(),
}));

import { runSleeperStatsSync } from "./sync-sleeper-stats";
import { getWeeklyStatsOrNull } from "./sleeper";

function fakeClient() {
  const upserts: Array<{ week: number }[]> = [];
  const client = {
    from: (table: string) => {
      if (table === "players") {
        return {
          select: () => ({
            order: () => ({
              range: () =>
                Promise.resolve({
                  data: [{ id: "P1", external_ids: { sleeper: "s1" } }],
                  error: null,
                }),
            }),
          }),
        };
      }
      if (table === "player_stats") {
        return {
          upsert: (rows: { week: number }[]) => {
            upserts.push(rows);
            return Promise.resolve({ error: null });
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  return { client: client as never, upserts };
}

const entry = { sleeperId: "s1", payload: { player_id: "s1", stats: { pts_ppr: 10 } } };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("runSleeperStatsSync: a failed week is not an empty week", () => {
  it("stores the weeks that answered, then throws naming the week that did not", async () => {
    vi.mocked(getWeeklyStatsOrNull).mockImplementation(async (_type, _season, week) =>
      week === 3 ? null : [entry],
    );
    const { client, upserts } = fakeClient();

    await expect(
      runSleeperStatsSync(client, { season: 2026, seasonType: "regular", week: 4, lookbackWeeks: 1 }),
    ).rejects.toThrow(/week\(s\) 3/);

    // Week 4 still went in.
    expect(upserts.flat().map((r) => r.week)).toEqual([4]);
  });

  it("an empty answer is still a successful week", async () => {
    vi.mocked(getWeeklyStatsOrNull).mockResolvedValue([]);
    const { client } = fakeClient();

    const result = await runSleeperStatsSync(client, {
      season: 2026,
      seasonType: "regular",
      week: 4,
      lookbackWeeks: 1,
    });

    expect(result.ok).toBe(true);
    expect(result.perWeek).toEqual([
      { week: 4, entries: 0, matched: 0 },
      { week: 3, entries: 0, matched: 0 },
    ]);
  });
});
