import { describe, it, expect } from "vitest";
import {
  aggregateRoomAdp,
  normalizePick,
  isAdpEligibleDraftType,
  REFERENCE_TEAMS,
  type SelectionRow,
} from "./room-adp";

const AT = new Date("2026-08-12T12:00:00.000Z");

function row(overrides: Partial<SelectionRow> & Pick<SelectionRow, "sleeperDraftId" | "playerId" | "pickNo">): SelectionRow {
  return {
    formatSlug: "dynasty-ppr-sflex",
    playerPool: "everyone",
    season: 2026,
    teams: 12,
    draftType: "snake",
    isKeeper: false,
    ...overrides,
  };
}

describe("normalizePick", () => {
  it("leaves a 12-team draft untouched", () => {
    expect(normalizePick(24, REFERENCE_TEAMS)).toBe(24);
    expect(normalizePick(1, REFERENCE_TEAMS)).toBe(1);
  });

  it("keeps pick 1 at pick 1 in every room size", () => {
    expect(normalizePick(1, 8)).toBe(1);
    expect(normalizePick(1, 10)).toBe(1);
    expect(normalizePick(1, 14)).toBe(1);
  });

  it("scales a smaller room up and a larger room down", () => {
    // Pick 21 in a 10-team draft is the start of round 3; in a 12-team draft
    // round 3 starts at pick 25.
    expect(normalizePick(21, 10)).toBe(25);
    // Pick 15 in a 14-team draft is early round 2; scaling down keeps it there.
    expect(normalizePick(15, 14)).toBeCloseTo(13, 5);
  });

  it("falls back to the raw pick when the team count is unknown", () => {
    expect(normalizePick(30, null)).toBe(30);
    expect(normalizePick(30, 0)).toBe(30);
  });
});

describe("isAdpEligibleDraftType", () => {
  it("excludes auctions and nothing else", () => {
    expect(isAdpEligibleDraftType("auction")).toBe(false);
    expect(isAdpEligibleDraftType("AUCTION")).toBe(false);
    expect(isAdpEligibleDraftType("snake")).toBe(true);
    expect(isAdpEligibleDraftType("linear")).toBe(true);
    expect(isAdpEligibleDraftType(null)).toBe(true);
  });
});

describe("aggregateRoomAdp", () => {
  it("averages a player's normalized picks across drafts", () => {
    const rows = [
      row({ sleeperDraftId: "d1", playerId: "p1", pickNo: 10 }),
      row({ sleeperDraftId: "d2", playerId: "p1", pickNo: 20 }),
    ];
    const [out] = aggregateRoomAdp(rows, AT);
    expect(out.adp).toBe(15);
    expect(out.adp_median).toBe(15);
    expect(out.earliest_pick).toBe(10);
    expect(out.latest_pick).toBe(20);
    expect(out.picks_sampled).toBe(2);
  });

  it("uses the whole cohort as the draft_rate denominator", () => {
    const rows = [
      row({ sleeperDraftId: "d1", playerId: "p1", pickNo: 5 }),
      row({ sleeperDraftId: "d2", playerId: "p2", pickNo: 5 }),
      row({ sleeperDraftId: "d3", playerId: "p2", pickNo: 7 }),
      row({ sleeperDraftId: "d4", playerId: "p2", pickNo: 9 }),
    ];
    const out = aggregateRoomAdp(rows, AT);
    const p1 = out.find((r) => r.player_id === "p1");
    const p2 = out.find((r) => r.player_id === "p2");
    expect(p1?.drafts_sampled).toBe(4);
    expect(p1?.draft_rate).toBe(0.25);
    expect(p2?.draft_rate).toBe(0.75);
  });

  it("counts a keeper's draft toward the cohort but not toward his own ADP", () => {
    const rows = [
      row({ sleeperDraftId: "d1", playerId: "p1", pickNo: 3, isKeeper: true }),
      row({ sleeperDraftId: "d2", playerId: "p1", pickNo: 40 }),
    ];
    const [out] = aggregateRoomAdp(rows, AT);
    expect(out.picks_sampled).toBe(1);
    expect(out.adp).toBe(40);
    expect(out.drafts_sampled).toBe(2);
  });

  it("drops a player who was only ever kept", () => {
    const rows = [row({ sleeperDraftId: "d1", playerId: "p1", pickNo: 3, isKeeper: true })];
    expect(aggregateRoomAdp(rows, AT)).toEqual([]);
  });

  it("excludes auction drafts entirely, including from the denominator", () => {
    const rows = [
      row({ sleeperDraftId: "d1", playerId: "p1", pickNo: 5, draftType: "auction" }),
      row({ sleeperDraftId: "d2", playerId: "p1", pickNo: 5 }),
    ];
    const [out] = aggregateRoomAdp(rows, AT);
    expect(out.picks_sampled).toBe(1);
    expect(out.drafts_sampled).toBe(1);
  });

  it("keeps cohorts separate by format, pool, and season", () => {
    const rows = [
      row({ sleeperDraftId: "d1", playerId: "p1", pickNo: 5 }),
      row({ sleeperDraftId: "d2", playerId: "p1", pickNo: 5, formatSlug: "dynasty-ppr-std" }),
      row({ sleeperDraftId: "d3", playerId: "p1", pickNo: 5, playerPool: "rookies" }),
      row({ sleeperDraftId: "d4", playerId: "p1", pickNo: 5, season: 2025 }),
    ];
    expect(aggregateRoomAdp(rows, AT)).toHaveLength(4);
  });

  it("normalizes across differently sized rooms before averaging", () => {
    // Both picks are the first pick of round 3 in their own room, so the
    // normalized ADP should be exactly the 12-team round 3 opener.
    const rows = [
      row({ sleeperDraftId: "d1", playerId: "p1", pickNo: 21, teams: 10 }),
      row({ sleeperDraftId: "d2", playerId: "p1", pickNo: 25, teams: 12 }),
    ];
    const [out] = aggregateRoomAdp(rows, AT);
    expect(out.adp).toBe(25);
  });

  it("reports no spread from a single observation", () => {
    const rows = [row({ sleeperDraftId: "d1", playerId: "p1", pickNo: 5 })];
    const [out] = aggregateRoomAdp(rows, AT);
    expect(out.pick_stdev).toBeNull();
  });

  it("measures spread once there are two observations", () => {
    const rows = [
      row({ sleeperDraftId: "d1", playerId: "p1", pickNo: 10 }),
      row({ sleeperDraftId: "d2", playerId: "p1", pickNo: 20 }),
    ];
    const [out] = aggregateRoomAdp(rows, AT);
    expect(out.pick_stdev).toBeCloseTo(7.071, 2);
  });

  it("never lets draft_rate exceed 1 when a draft has duplicate rows", () => {
    const rows = [
      row({ sleeperDraftId: "d1", playerId: "p1", pickNo: 5 }),
      row({ sleeperDraftId: "d1", playerId: "p1", pickNo: 6 }),
    ];
    const [out] = aggregateRoomAdp(rows, AT);
    expect(out.draft_rate).toBe(1);
  });

  it("returns nothing for an empty ledger", () => {
    expect(aggregateRoomAdp([], AT)).toEqual([]);
  });
});
