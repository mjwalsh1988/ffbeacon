import { describe, expect, it } from "vitest";
import { loadTrends } from "./league-view-data";

function fake(rows: Array<Record<string, unknown>>) {
  const selects: string[] = [];
  const builder = {
    select: (cols: string) => {
      selects.push(cols);
      return builder;
    },
    eq: () => builder,
    in: () => Promise.resolve({ data: rows, error: null }),
  };
  return { client: { from: () => builder } as never, selects };
}

const row = {
  player_id: "p1",
  current_value: "5000",
  change_7d: "50",
  change_7d_pct: "1.0",
  trend_7d: "up",
  rank_change_7d: 1,
  show_trend_7d: true,
  value_30d_ago: "4000",
  change_30d: "1000",
  change_30d_pct: "25",
  rank_change_30d: 4,
  show_trend_30d: true,
};

describe("loadTrends", () => {
  it("reads only the 7-day fields when no window is passed", async () => {
    const { client, selects } = fake([row]);
    const out = await loadTrends(client, ["p1"], "f", "ktc");
    expect(selects[0]).toBe("player_id, current_value, change_7d, change_7d_pct, trend_7d");
    expect(out.p1).toEqual({ current_value: 5000, change_7d: 50, change_7d_pct: 1, trend_7d: "up" });
  });

  it("adds the 30-day fields and both gates with the window option", async () => {
    const { client, selects } = fake([row]);
    const out = await loadTrends(client, ["p1"], "f", "ktc", { window: "30d" });
    expect(selects[0]).toContain("show_trend_30d");
    expect(out.p1).toMatchObject({
      value_30d_ago: 4000,
      change_30d: 1000,
      change_30d_pct: 25,
      rank_change_30d: 4,
      show_trend_30d: true,
      show_trend_7d: true,
    });
  });
});
