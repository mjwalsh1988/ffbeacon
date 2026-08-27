/**
 * Cover for draft-slot labelling, and specifically for the case that used to be
 * decided by row order: a league holding more than one draft for one season.
 *
 * Migration 0029 made that legal, and a production league carries two completed
 * 23-round 2026 startups with DIFFERENT seat maps. The old reader kept whichever
 * row came back last, so "1.04" on the transactions feed could point at two
 * different teams on two renders of the same page.
 */

import { describe, it, expect } from "vitest";
import { loadLeagueDraftSlots } from "./league-pick-slots";
import { preferLaterDraft, type LeagueDraftRow } from "./league-drafts";

type Row = {
  sleeper_draft_id: string;
  season: number;
  status: string | null;
  start_time: string | null;
  slot_to_roster_id: Record<string, number> | null;
};

function stub(rows: Row[]) {
  return {
    from: () => ({
      select: () => ({
        eq: () => Promise.resolve({ data: rows, error: null }),
      }),
    }),
  } as unknown as Parameters<typeof loadLeagueDraftSlots>[0];
}

const EARLIER: Row = {
  sleeper_draft_id: "1381744430708428800",
  season: 2026,
  status: "complete",
  start_time: "2026-08-16T20:41:20.861Z",
  slot_to_roster_id: { "1": 5, "11": 7 },
};

const LATER: Row = {
  sleeper_draft_id: "1394068769269088256",
  season: 2026,
  status: "complete",
  start_time: "2026-08-24T15:25:04.091Z",
  slot_to_roster_id: { "1": 7, "11": 5 },
};

describe("loadLeagueDraftSlots", () => {
  it("labels a pick from the season's draft", async () => {
    const index = await loadLeagueDraftSlots(stub([LATER]), "L");
    expect(index.slotFor(2026, 7)).toBe(1);
    expect(index.labelFor(2026, 7, 1)).toBe("1.01");
    expect(index.labelFor(2026, 5, 3)).toBe("3.11");
  });

  it("returns null for a roster or season it has no draft for", async () => {
    const index = await loadLeagueDraftSlots(stub([LATER]), "L");
    expect(index.slotFor(2026, 99)).toBeNull();
    expect(index.slotFor(2029, 7)).toBeNull();
    expect(index.labelFor(2029, 7, 1)).toBeNull();
  });

  it("ignores a draft whose seat map is empty or malformed", async () => {
    const index = await loadLeagueDraftSlots(
      stub([
        { ...LATER, slot_to_roster_id: {} },
        { ...EARLIER, sleeper_draft_id: "x", slot_to_roster_id: null },
      ]),
      "L",
    );
    expect(index.rosterToSlotBySeason.size).toBe(0);
  });

  it("keeps the later draft regardless of the order rows arrive in", async () => {
    for (const rows of [
      [EARLIER, LATER],
      [LATER, EARLIER],
    ]) {
      const index = await loadLeagueDraftSlots(stub(rows), "L");
      // The later draft seats roster 7 at slot 1.
      expect(index.slotFor(2026, 7)).toBe(1);
      expect(index.slotFor(2026, 5)).toBe(11);
    }
  });

  it("does not mix seats from two drafts into one map", async () => {
    const index = await loadLeagueDraftSlots(stub([EARLIER, LATER]), "L");
    expect(index.rosterToSlotBySeason.get(2026)?.size).toBe(2);
  });
});

describe("preferLaterDraft", () => {
  const base: LeagueDraftRow = {
    sleeperDraftId: "a",
    season: 2026,
    status: null,
    isComplete: false,
    type: "snake",
    rounds: 23,
    teams: 12,
    shape: { type: "snake", reversalRound: 0 },
    rosterToSeat: new Map(),
    startedAtMs: 100,
    lastPickedAtMs: null,
  };

  it("prefers the later start", () => {
    expect(preferLaterDraft(base, { ...base, sleeperDraftId: "b", startedAtMs: 200 })).toBe(true);
    expect(preferLaterDraft(base, { ...base, sleeperDraftId: "b", startedAtMs: 50 })).toBe(false);
  });

  it("breaks a start-time tie on completion, then on the sleeper id", () => {
    expect(preferLaterDraft(base, { ...base, sleeperDraftId: "b", isComplete: true })).toBe(true);
    expect(
      preferLaterDraft({ ...base, isComplete: true }, { ...base, sleeperDraftId: "b" }),
    ).toBe(false);
    expect(preferLaterDraft(base, { ...base, sleeperDraftId: "b" })).toBe(true);
    expect(preferLaterDraft({ ...base, sleeperDraftId: "b" }, base)).toBe(false);
  });

  it("is a total order, so the outcome never depends on input order", () => {
    const a = { ...base, sleeperDraftId: "a", startedAtMs: 100 };
    const b = { ...base, sleeperDraftId: "b", startedAtMs: 200 };
    expect(preferLaterDraft(a, b)).toBe(true);
    expect(preferLaterDraft(b, a)).toBe(false);
  });
});
