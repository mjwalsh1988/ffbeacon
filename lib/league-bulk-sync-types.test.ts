import { describe, expect, it } from "vitest";
import {
  IDLE_BULK_SYNC_STATE,
  mergeBulkSyncState,
  type BulkSyncState,
} from "./league-bulk-sync-types";

/**
 * The Sync all page has two clocks: the server render and the button's poll.
 * These cover the orderings that actually happen when they disagree.
 */

function state(over: Partial<BulkSyncState> = {}): BulkSyncState {
  return { ...IDLE_BULK_SYNC_STATE, ...over };
}

describe("mergeBulkSyncState", () => {
  it("takes the incoming state when it is a different batch", () => {
    const prev = state({ requestId: "old", total: 4, done: 4 });
    const incoming = state({ requestId: "new", total: 6, active: true });
    expect(mergeBulkSyncState(prev, incoming)).toBe(incoming);
  });

  it("takes the first batch the page has seen", () => {
    const incoming = state({ requestId: "r1", total: 3, active: true });
    expect(mergeBulkSyncState(IDLE_BULK_SYNC_STATE, incoming)).toBe(incoming);
  });

  it("takes the incoming state when it has got further", () => {
    const prev = state({ requestId: "r1", total: 5, done: 2, active: true });
    const incoming = state({ requestId: "r1", total: 5, done: 4, active: true });
    expect(mergeBulkSyncState(prev, incoming)).toBe(incoming);
  });

  it("keeps what is on screen when the incoming state is behind", () => {
    // A server render that started before a job finished, resolving after the
    // poll that saw it finish. Taking it would walk the count backwards.
    const prev = state({ requestId: "r1", total: 5, done: 4, active: true });
    const stale = state({ requestId: "r1", total: 5, done: 2, active: true });
    expect(mergeBulkSyncState(prev, stale)).toBe(prev);
  });

  it("counts a failure as progress, so a failing batch still advances", () => {
    const prev = state({ requestId: "r1", total: 3, done: 1, active: true });
    const incoming = state({
      requestId: "r1",
      total: 3,
      done: 1,
      failed: 1,
      active: true,
    });
    expect(mergeBulkSyncState(prev, incoming)).toBe(incoming);
  });

  it("takes an equal-progress update, so the finished flag lands", () => {
    // The last job's completion and the batch closing can arrive as two reads at
    // the same count. Dropping the second would leave the page saying "syncing"
    // forever.
    const prev = state({ requestId: "r1", total: 2, done: 2, active: true });
    const closed = state({ requestId: "r1", total: 2, done: 2, active: false });
    expect(mergeBulkSyncState(prev, closed)).toBe(closed);
  });
});
