import { describe, it, expect } from "vitest";
import { shapePickObservations, recordPickObservations, type PickObservationInsert } from "./pick-observations";
import type { SleeperDraftPick } from "@/lib/sleeper";

function pick(over: Partial<SleeperDraftPick> = {}): SleeperDraftPick {
  return {
    draft_id: "1234567890",
    pick_no: 1,
    round: 1,
    draft_slot: 1,
    roster_id: 3,
    picked_by: "u1",
    player_id: "4046",
    is_keeper: false,
    metadata: { first_name: "Test", last_name: "Player" },
    ...over,
  };
}

/**
 * A Supabase stand-in for the one table this module writes. Records every
 * upsert call (rows + options) so the ignore-duplicates semantics and the
 * chunking can be asserted directly, and can be told to fail on a given call.
 */
function stub(opts: { failOnCall?: number } = {}) {
  const calls: { rows: PickObservationInsert[]; options: Record<string, unknown> }[] = [];
  let callCount = 0;
  const api = {
    calls,
    from(table: string) {
      if (table !== "draft_pick_observations") throw new Error(`unexpected table ${table}`);
      return {
        upsert: (rows: PickObservationInsert[], options: Record<string, unknown>) => {
          callCount += 1;
          calls.push({ rows, options });
          const shouldFail = opts.failOnCall === callCount;
          return {
            select: () =>
              shouldFail
                ? Promise.resolve({ data: null, error: { message: "boom" } })
                : Promise.resolve({ data: rows.map((r) => ({ pick_no: r.pick_no })), error: null }),
          };
        },
      };
    },
  };
  return api as unknown as Parameters<typeof recordPickObservations>[0] & typeof api;
}

describe("shapePickObservations", () => {
  it("stores the poll gap that was in force for a single newly-seen pick", () => {
    const rows = shapePickObservations([pick({ pick_no: 5 })], {
      sleeperDraftId: "1234567890",
      season: 2026,
      pollGapMs: 4200,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].observation_gap_ms).toBe(4200);
  });

  it("writes null, not zero, when the poll gap is unknown", () => {
    const rows = shapePickObservations([pick({ pick_no: 5 })], {
      sleeperDraftId: "1234567890",
      season: 2026,
      pollGapMs: null,
    });
    expect(rows[0].observation_gap_ms).toBeNull();
  });

  it("writes null for every row of a bulk first-poll batch, even with a real poll gap", () => {
    // Two picks appearing new in the same poll means we did not observe two
    // pick times, only that both had already happened by the time we looked.
    const rows = shapePickObservations(
      [pick({ pick_no: 1 }), pick({ pick_no: 2 })],
      { sleeperDraftId: "1234567890", season: 2026, pollGapMs: 9000 },
    );
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.observation_gap_ms).toBeNull();
  });

  it("marks true for a picker on a provided autopicker list", () => {
    const rows = shapePickObservations([pick({ pick_no: 1, picked_by: "u1" })], {
      sleeperDraftId: "1234567890",
      season: 2026,
      pollGapMs: 1000,
      autopickerIds: ["u1", "u9"],
    });
    expect(rows[0].was_autopick).toBe(true);
  });

  it("marks false for a picker not on a provided autopicker list", () => {
    const rows = shapePickObservations([pick({ pick_no: 1, picked_by: "u2" })], {
      sleeperDraftId: "1234567890",
      season: 2026,
      pollGapMs: 1000,
      autopickerIds: ["u1", "u9"],
    });
    expect(rows[0].was_autopick).toBe(false);
  });

  it("marks null for everyone when the autopicker list could not be read", () => {
    const rows = shapePickObservations(
      [pick({ pick_no: 1, picked_by: "u1" }), pick({ pick_no: 2, picked_by: "u2" })],
      { sleeperDraftId: "1234567890", season: 2026, pollGapMs: 1000, autopickerIds: null },
    );
    for (const row of rows) expect(row.was_autopick).toBeNull();
  });

  it("preserves the raw pick object in metadata", () => {
    const raw = pick({ pick_no: 1, metadata: { first_name: "Ja'Marr", years_exp: "0" } });
    const rows = shapePickObservations([raw], {
      sleeperDraftId: "1234567890",
      season: 2026,
      pollGapMs: 1000,
    });
    expect((rows[0].metadata as Record<string, unknown>).pick).toEqual(raw);
  });

  it("merges the autopicker list into metadata under its own key", () => {
    const rows = shapePickObservations([pick({ pick_no: 1 })], {
      sleeperDraftId: "1234567890",
      season: 2026,
      pollGapMs: 1000,
      autopickerIds: ["u1"],
    });
    expect((rows[0].metadata as Record<string, unknown>).autopickers).toEqual(["u1"]);
  });

  it("drops a pick with no usable pick_no", () => {
    const rows = shapePickObservations([pick({ pick_no: 0 }), pick({ pick_no: 3 })], {
      sleeperDraftId: "1234567890",
      season: 2026,
      pollGapMs: 1000,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].pick_no).toBe(3);
  });
});

describe("recordPickObservations", () => {
  it("uses ignore-duplicates semantics so a re-seen pick never overwrites first_seen_at", async () => {
    const client = stub();
    await recordPickObservations(client, {
      sleeperDraftId: "1234567890",
      season: 2026,
      picks: [pick({ pick_no: 1 })],
      pollGapMs: 5000,
    });
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0].options).toMatchObject({
      onConflict: "sleeper_draft_id,pick_no",
      ignoreDuplicates: true,
    });
  });

  it("returns a result rather than throwing when the database write fails", async () => {
    const client = stub({ failOnCall: 1 });
    await expect(
      recordPickObservations(client, {
        sleeperDraftId: "1234567890",
        season: 2026,
        picks: [pick({ pick_no: 1 })],
        pollGapMs: 5000,
      }),
    ).resolves.toEqual({ inserted: 0, skipped: 1 });
  });

  it("chunks 450 picks into 3 writes", async () => {
    const client = stub();
    const picks = Array.from({ length: 450 }, (_, i) => pick({ pick_no: i + 1 }));
    const result = await recordPickObservations(client, {
      sleeperDraftId: "1234567890",
      season: 2026,
      // A batch this large is itself a bulk catch-up (observation_gap_ms
      // collapses to null), which is fine here: this test asserts request
      // count, not the gap value.
      picks,
      pollGapMs: null,
    });
    expect(client.calls).toHaveLength(3);
    expect(client.calls.map((c) => c.rows.length)).toEqual([200, 200, 50]);
    expect(result).toEqual({ inserted: 450, skipped: 0 });
  });

  it("does nothing for an empty batch", async () => {
    const client = stub();
    const result = await recordPickObservations(client, {
      sleeperDraftId: "1234567890",
      season: 2026,
      picks: [],
      pollGapMs: null,
    });
    expect(client.calls).toHaveLength(0);
    expect(result).toEqual({ inserted: 0, skipped: 0 });
  });
});
