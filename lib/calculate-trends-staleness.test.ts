import { describe, it, expect } from "vitest";
import { computeTrendRows } from "./calculate-trends";
import { FALLBACK_STALE_DAYS } from "./beacon/freshness";

/**
 * A source that stops covering a player keeps its last snapshot in
 * player_value_history forever. "Newest row wins" then serves that number as the
 * player's CURRENT value with nothing marking it old, and the trend row's own
 * updated_at says today because the calc ran today.
 *
 * Measured on production 2026-08-25: 213 players carried a current_value from a
 * source that had dropped them, worst case 200 days earlier. Tahj Washington sat
 * at 8635 on a KTC value last published on 9 June, which is a top-of-board
 * dynasty number for a player KTC no longer ranks.
 *
 * These tests pin the gate and, just as importantly, pin the exception: a weekly
 * publisher must not be called stale for publishing weekly.
 */

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-08-25T12:00:00.000Z");

function history(source: string, capturedAt: string, value = 9000) {
  return {
    id: `${source}-${capturedAt}`,
    player_id: "player-a",
    format_config_id: "fmt-1",
    source,
    value,
    captured_at: capturedAt,
    formula_offset: 0,
  };
}

function agoIso(days: number): string {
  return new Date(NOW - days * DAY).toISOString();
}

/** daily 3, weekly 10. */
const STALE_DAYS = new Map<string, number>([
  ["ktc", FALLBACK_STALE_DAYS.daily],
  ["dynastyprocess", FALLBACK_STALE_DAYS.weekly],
]);

describe("computeTrendRows staleness gate", () => {
  it("keeps a daily source that published today", () => {
    const rows = computeTrendRows(
      [history("ktc", agoIso(0)), history("ktc", agoIso(1))],
      NOW,
      new Map(),
      STALE_DAYS,
    );
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].current_value)).toBe(9000);
  });

  it("keeps a daily source through a couple of missed nights", () => {
    // Cron jitter is not a dead source. The allowance is 3 days.
    const rows = computeTrendRows([history("ktc", agoIso(2))], NOW, new Map(), STALE_DAYS);
    expect(rows).toHaveLength(1);
  });

  it("drops a daily source that has gone quiet past its allowance", () => {
    const rows = computeTrendRows([history("ktc", agoIso(5))], NOW, new Map(), STALE_DAYS);
    expect(rows).toHaveLength(0);
  });

  it("drops the real case: KTC stopped covering this player in June", () => {
    // 77 days, the exact gap behind Tahj Washington's 8635.
    const rows = computeTrendRows([history("ktc", agoIso(77))], NOW, new Map(), STALE_DAYS);
    expect(rows).toHaveLength(0);
  });

  it("does NOT punish a weekly publisher for publishing weekly", () => {
    // DynastyProcess refreshes about once a week and stamps its own publish
    // date. Judging it on the daily allowance would delete a healthy source
    // from the site every few days.
    const rows = computeTrendRows(
      [history("dynastyprocess", agoIso(7))],
      NOW,
      new Map(),
      STALE_DAYS,
    );
    expect(rows).toHaveLength(1);
  });

  it("still drops a weekly publisher that has missed several weeks", () => {
    const rows = computeTrendRows(
      [history("dynastyprocess", agoIso(21))],
      NOW,
      new Map(),
      STALE_DAYS,
    );
    expect(rows).toHaveLength(0);
  });

  it("defaults an unnamed source to the daily allowance", () => {
    // The conservative direction: an unknown cadence is treated as if it should
    // publish daily, so an unlisted source cannot smuggle old values through.
    const fresh = computeTrendRows([history("mystery", agoIso(1))], NOW, new Map(), new Map());
    const stale = computeTrendRows([history("mystery", agoIso(9))], NOW, new Map(), new Map());
    expect(fresh).toHaveLength(1);
    expect(stale).toHaveLength(0);
  });

  it("judges each source separately for the same player", () => {
    const rows = computeTrendRows(
      [
        { ...history("ktc", agoIso(60)), format_config_id: "fmt-1" },
        { ...history("dynastyprocess", agoIso(3)), format_config_id: "fmt-1" },
      ],
      NOW,
      new Map(),
      STALE_DAYS,
    );
    expect(rows.map((r) => r.source)).toEqual(["dynastyprocess"]);
  });

  it("survives an unparseable timestamp by dropping the pair", () => {
    const rows = computeTrendRows(
      [history("ktc", "not a date")],
      NOW,
      new Map(),
      STALE_DAYS,
    );
    expect(rows).toHaveLength(0);
  });
});
