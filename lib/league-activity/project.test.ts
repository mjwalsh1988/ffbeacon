import { describe, it, expect } from "vitest";
import {
  benchPointsOf,
  buildMatchupResultEvents,
  buildTransactionEvent,
  nflWeekEndUtc,
  type MatchupRow,
} from "./project";

/**
 * The projector's three jobs, and the way each of them can go wrong.
 *
 * A failed waiver bid becoming a card about a player who never moved. A bench
 * total of "we do not know" becoming a bench total of zero. A season of results
 * landing on one instant at the top of the feed because nothing carries a
 * timestamp.
 */

function tx(over: Record<string, unknown> = {}) {
  return {
    sleeper_transaction_id: "t1",
    type: "waiver",
    status: "complete",
    week: 3,
    season: 2026,
    adds: { "100": 1 },
    drops: null,
    draft_picks: [],
    waiver_budget: [],
    roster_ids: [1],
    created_at_sleeper: "2026-09-16T09:00:00.000Z",
    waiver_bid: 17,
    ...over,
  } as Parameters<typeof buildTransactionEvent>[0];
}

describe("transactions", () => {
  it("reads the winning bid off the transaction's own settings", () => {
    const e = buildTransactionEvent(tx());
    expect((e?.payload as { bid: number }).bid).toBe(17);
  });

  it("does not read a trade's FAAB transfer as a waiver bid", () => {
    // `waiver_budget` is money moving between two managers inside a trade. A
    // reader told that was the winning bid would be told a fiction.
    const e = buildTransactionEvent(
      tx({
        waiver_bid: null,
        waiver_budget: [{ sender: 1, receiver: 2, amount: 25 }],
      }),
    );
    expect((e?.payload as { bid: number | null }).bid).toBeNull();
  });

  it("drops a failed waiver claim", () => {
    expect(buildTransactionEvent(tx({ status: "failed" }))).toBeNull();
  });

  it("drops a transaction that moved nothing", () => {
    expect(
      buildTransactionEvent(tx({ adds: null, drops: null, draft_picks: [], waiver_budget: [] })),
    ).toBeNull();
  });

  it("ignores Sleeper's empty-slot placeholder", () => {
    const e = buildTransactionEvent(tx({ adds: { "0": 1, "100": 1 } }));
    expect((e?.payload as { adds: string[] }).adds).toEqual(["100"]);
  });

  it("keys on the Sleeper transaction id, so a resync cannot duplicate it", () => {
    // The key must not move when anything ELSE about the row does: a resync
    // re-reads the same transaction with a reordered adds map and a corrected
    // week, and a key that shifted would post the move a second time.
    expect(buildTransactionEvent(tx())?.dedupeKey).toBe("tx:t1");
    expect(
      buildTransactionEvent(tx({ adds: { "200": 1, "100": 1 }, week: 4 }))?.dedupeKey,
    ).toBe("tx:t1");
  });

  it("marks a transaction as exactly timed", () => {
    const e = buildTransactionEvent(tx());
    expect(e?.precision).toBe("exact");
    expect(e?.occurredAt).toBe("2026-09-16T09:00:00.000Z");
  });

  it("regroups a trade into one column per roster", () => {
    const e = buildTransactionEvent(
      tx({
        type: "trade",
        adds: { "100": 2, "200": 1 },
        drops: { "100": 1, "200": 2 },
        roster_ids: [1, 2],
        draft_picks: [{ season: 2027, round: 1, roster_id: 2, owner_id: 1 }],
        waiver_budget: [{ sender: 1, receiver: 2, amount: 8 }],
      }),
    );
    const sides = (e?.payload as { sides: Array<Record<string, unknown>> }).sides;
    expect(sides).toHaveLength(2);
    expect(sides[0]).toMatchObject({ rosterId: 1, players: ["200"], faab: 0 });
    expect(sides[0].picks).toHaveLength(1);
    expect(sides[1]).toMatchObject({ rosterId: 2, players: ["100"], faab: 8 });
  });

  it("accepts Sleeper's object-shaped draft_picks", () => {
    // Sleeper sends this field as an array, an object, a JSON string, or null.
    const e = buildTransactionEvent(
      tx({
        type: "trade",
        adds: null,
        drops: null,
        roster_ids: [1, 2],
        draft_picks: { "0": { season: 2027, round: 2, roster_id: 1, owner_id: 2 } },
      }),
    );
    const sides = (e?.payload as { sides: Array<{ rosterId: number; picks: unknown[] }> }).sides;
    expect(sides.find((s) => s.rosterId === 2)?.picks).toHaveLength(1);
  });
});

describe("multi-roster moves", () => {
  it("gives a commissioner-executed trade two sides", () => {
    // Flattened to one roster, the card said "Team 3 swapped X in for Y" when
    // it was Team 5 who gave Y up, and the stored payload could not recover it.
    const e = buildTransactionEvent(
      tx({
        type: "commissioner",
        adds: { "100": 3 },
        drops: { "200": 5 },
        roster_ids: [3, 5],
      }),
    );
    const sides = (
      e?.payload as { sides: Array<{ rosterId: number; players: string[] }> }
    ).sides;
    expect(e?.kind).toBe("commissioner_move");
    expect(sides.map((s) => s.rosterId)).toEqual([3, 5]);
    expect(sides.find((s) => s.rosterId === 3)?.players).toEqual(["100"]);
    expect(sides.find((s) => s.rosterId === 5)?.players).toEqual([]);
  });

  it("leaves a single-roster claim flat, with its bid", () => {
    const e = buildTransactionEvent(tx({ roster_ids: [1] }));
    expect((e?.payload as { sides?: unknown }).sides).toBeUndefined();
    expect((e?.payload as { bid: number }).bid).toBe(17);
  });

  it("files an unrecognised Sleeper type without losing its real name", () => {
    const e = buildTransactionEvent(tx({ type: "something_new", roster_ids: [1] }));
    expect(e?.kind).toBe("commissioner_move");
    // The deep link filters the transactions page on Sleeper's own string, so
    // dropping it would land the reader on an empty list.
    expect((e?.payload as { sleeperType: string }).sleeperType).toBe("something_new");
  });

  it("builds a three-team trade with three columns", () => {
    const e = buildTransactionEvent(
      tx({
        type: "trade",
        adds: { "100": 1, "200": 2, "300": 3 },
        drops: { "100": 3, "200": 1, "300": 2 },
        roster_ids: [1, 2, 3],
      }),
    );
    const sides = (e?.payload as { sides: Array<{ rosterId: number }> }).sides;
    expect(sides.map((s) => s.rosterId)).toEqual([1, 2, 3]);
  });
});

describe("bench points", () => {
  it("sums every player who was not in the lineup", () => {
    expect(
      benchPointsOf(["1", "2"], { "1": 20, "2": 10, "3": 8.4, "4": 1.6 }),
    ).toBe(10);
  });

  it("returns null when Sleeper sent no per-player points", () => {
    // Null is "we do not know". A zero would read as "the bench did nothing",
    // which is a claim, and the card omits the stat instead.
    expect(benchPointsOf(["1"], {})).toBeNull();
    expect(benchPointsOf(["1"], null as never)).toBeNull();
  });
});

function matchup(over: Partial<MatchupRow> = {}): MatchupRow {
  return {
    week: 3,
    matchup_id: 1,
    sleeper_roster_id: 1,
    points: 100,
    starter_ids: ["1"],
    player_points: { "1": 100 },
    ...over,
  };
}

describe("matchup results", () => {
  it("emits ONE event per game, carrying both the win and the loss", () => {
    const events = buildMatchupResultEvents(2026, [
      matchup({ sleeper_roster_id: 1, points: 128.4 }),
      matchup({ sleeper_roster_id: 2, points: 96.1 }),
    ]);
    expect(events).toHaveLength(1);
    const payload = events[0].payload as {
      sides: Array<{ rosterId: number; points: number }>;
      margin: number;
      tie: boolean;
    };
    expect(payload.sides.map((s) => s.rosterId)).toEqual([1, 2]);
    expect(payload.margin).toBe(32.3);
    expect(payload.tie).toBe(false);
    expect(events[0].rosterIds).toEqual([1, 2]);
  });

  it("keys on the lowest roster id, so the two rows cannot post twice", () => {
    const forward = buildMatchupResultEvents(2026, [
      matchup({ sleeper_roster_id: 7, points: 90 }),
      matchup({ sleeper_roster_id: 4, points: 110 }),
    ]);
    const reversed = buildMatchupResultEvents(2026, [
      matchup({ sleeper_roster_id: 4, points: 110 }),
      matchup({ sleeper_roster_id: 7, points: 90 }),
    ]);
    expect(forward[0].dedupeKey).toBe("game:2026:3:4");
    expect(reversed[0].dedupeKey).toBe(forward[0].dedupeKey);
  });

  it("puts the higher score first, and marks a tie as one", () => {
    const events = buildMatchupResultEvents(2026, [
      matchup({ sleeper_roster_id: 5, points: 110.2 }),
      matchup({ sleeper_roster_id: 2, points: 110.2 }),
    ]);
    const payload = events[0].payload as { margin: number; tie: boolean };
    expect(payload.margin).toBe(0);
    expect(payload.tie).toBe(true);
  });

  it("reports a win over a manager who started nobody", () => {
    // `is_final` is per row and includes `points > 0`, so the 0.0 side is never
    // flagged final, and trusting the flag swallowed the opponent's win.
    const events = buildMatchupResultEvents(2026, [
      matchup({ sleeper_roster_id: 1, points: 84.5 }),
      matchup({ sleeper_roster_id: 2, points: 0, player_points: {} }),
    ]);
    expect(events).toHaveLength(1);
    expect((events[0].payload as { margin: number }).margin).toBe(84.5);
  });

  it("does not report a game nobody has played", () => {
    expect(
      buildMatchupResultEvents(2026, [
        matchup({ sleeper_roster_id: 1, points: 0, player_points: {} }),
        matchup({ sleeper_roster_id: 2, points: 0, player_points: {} }),
      ]),
    ).toEqual([]);
  });

  it("drops a roster Sleeper left unpaired", () => {
    expect(buildMatchupResultEvents(2026, [matchup({ matchup_id: 9 })])).toEqual([]);
  });

  it("drops a row with no matchup id rather than pairing it with a stranger", () => {
    expect(
      buildMatchupResultEvents(2026, [
        matchup({ matchup_id: null, sleeper_roster_id: 1 }),
        matchup({ matchup_id: null, sleeper_roster_id: 2 }),
      ]),
    ).toEqual([]);
  });

  it("keeps games in different weeks apart", () => {
    const events = buildMatchupResultEvents(2026, [
      matchup({ week: 3, sleeper_roster_id: 1, points: 100 }),
      matchup({ week: 3, sleeper_roster_id: 2, points: 90 }),
      matchup({ week: 4, sleeper_roster_id: 1, points: 80 }),
      matchup({ week: 4, sleeper_roster_id: 2, points: 95 }),
    ]);
    expect(events).toHaveLength(2);
    expect(new Set(events.map((e) => e.dedupeKey)).size).toBe(2);
  });

  it("carries the bench total, or null when Sleeper sent no per-player points", () => {
    const events = buildMatchupResultEvents(2026, [
      matchup({
        sleeper_roster_id: 1,
        points: 100,
        starter_ids: ["1"],
        player_points: { "1": 100, "2": 42 },
      }),
      matchup({ sleeper_roster_id: 2, points: 90, player_points: {} }),
    ]);
    const sides = (
      events[0].payload as { sides: Array<{ benchPoints: number | null }> }
    ).sides;
    expect(sides[0].benchPoints).toBe(42);
    expect(sides[1].benchPoints).toBeNull();
  });
});

describe("week end timestamps", () => {
  it("lands on the Tuesday after Monday Night Football", () => {
    // Week 1 of 2025 ran Thu Sep 4 to Mon Sep 8, so it ends Tuesday Sep 9.
    expect(nflWeekEndUtc(2025, 1).slice(0, 10)).toBe("2025-09-09");
    // 2024 opened a week later: Thu Sep 5 to Mon Sep 9, ending Tuesday Sep 10.
    expect(nflWeekEndUtc(2024, 1).slice(0, 10)).toBe("2024-09-10");
    expect(nflWeekEndUtc(2023, 1).slice(0, 10)).toBe("2023-09-12");
    expect(nflWeekEndUtc(2026, 1).slice(0, 10)).toBe("2026-09-15");
  });

  it("adds exactly a week per week", () => {
    const w1 = Date.parse(nflWeekEndUtc(2026, 1));
    const w6 = Date.parse(nflWeekEndUtc(2026, 6));
    expect(w6 - w1).toBe(5 * 7 * 86_400_000);
  });

  it("orders a result before the moves of the week that follows it", () => {
    // The reason this function exists. Without it a backfilled season landed on
    // one instant at the top of the feed, above moves made months earlier.
    const week3 = Date.parse(nflWeekEndUtc(2026, 3));
    const week4 = Date.parse(nflWeekEndUtc(2026, 4));
    const aThursdayInsideWeek4 = Date.parse("2026-10-01T23:00:00.000Z");
    expect(week3).toBeLessThan(aThursdayInsideWeek4);
    expect(aThursdayInsideWeek4).toBeLessThan(week4);
  });

  it("falls back to week 1 rather than producing a date before the season", () => {
    expect(nflWeekEndUtc(2026, 0)).toBe(nflWeekEndUtc(2026, 1));
    expect(nflWeekEndUtc(2026, Number.NaN)).toBe(nflWeekEndUtc(2026, 1));
  });
});
