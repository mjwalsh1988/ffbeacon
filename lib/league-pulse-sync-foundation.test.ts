import { describe, it, expect } from "vitest";
import {
  buildRosterPicks,
  chooseSleeperDraftPerSeason,
  isPastSeason,
  rosterSlotsForDraft,
  transactionWalkEmptyStop,
} from "./league-pulse";
import type { SleeperDraft, SleeperTradedPick } from "./sleeper";

const rosters = [
  { roster_id: 1, owner_id: "u1" },
  { roster_id: 2, owner_id: "u2" },
  { roster_id: 3, owner_id: "u3" },
];

function draft(overrides: Partial<SleeperDraft>): SleeperDraft {
  return {
    draft_id: "d",
    league_id: "l",
    season: "2026",
    status: "pre_draft",
    type: "snake",
    ...overrides,
  };
}

const dynasty = (draftRounds?: number) => ({
  season: "2026",
  settings: { type: 2, ...(draftRounds === undefined ? {} : { draft_rounds: draftRounds }) },
});

describe("buildRosterPicks", () => {
  it("plants the league's own number of rounds, not a flat four", () => {
    const picks = buildRosterPicks(rosters, [], [], dynasty(5));
    const rounds = new Set(picks.map((p) => p.round));
    expect([...rounds].sort()).toEqual([1, 2, 3, 4, 5]);
    // Four seasons from the league's own, three rosters, five rounds.
    expect(picks).toHaveLength(4 * 3 * 5);
  });

  it("falls back to four rounds when the league does not say", () => {
    const picks = buildRosterPicks(rosters, [], [], dynasty());
    expect(Math.max(...picks.map((p) => p.round))).toBe(4);
  });

  it("gives redraft and chopped leagues no picks at all", () => {
    const traded: SleeperTradedPick[] = [
      { season: "2027", round: 1, roster_id: 1, owner_id: 2, previous_owner_id: 1 } as SleeperTradedPick,
    ];
    expect(buildRosterPicks(rosters, traded, [], { season: "2026", settings: { type: 0 } })).toEqual([]);
    expect(buildRosterPicks(rosters, traded, [], { season: "2026", settings: { type: 3 } })).toEqual([]);
  });

  it("keeps picks for keeper leagues", () => {
    expect(buildRosterPicks(rosters, [], [], { season: "2026", settings: { type: 1 } }).length).toBeGreaterThan(0);
  });

  it("drops a season once its draft is complete, traded picks included", () => {
    const traded = [
      { season: "2026", round: 1, roster_id: 1, owner_id: 2, previous_owner_id: 1 },
      { season: "2027", round: 1, roster_id: 1, owner_id: 3, previous_owner_id: 1 },
    ] as SleeperTradedPick[];
    const picks = buildRosterPicks(rosters, traded, [draft({ season: "2026", status: "complete" })], dynasty(4));
    expect(picks.some((p) => p.season === 2026)).toBe(false);
    expect(new Set(picks.map((p) => p.season))).toEqual(new Set([2027, 2028, 2029]));
    const moved = picks.find((p) => p.season === 2027 && p.round === 1 && p.original_roster_id === 1);
    expect(moved?.current_roster_id).toBe(3);
  });

  it("stamps the known slot and label from the draft order", () => {
    const picks = buildRosterPicks(
      rosters,
      [],
      [draft({ season: "2027", slot_to_roster_id: { "1": 3, "2": 1 }, draft_order: { u2: 3 } })],
      dynasty(2),
    );
    const of = (rosterId: number) =>
      picks.find((p) => p.season === 2027 && p.round === 2 && p.original_roster_id === rosterId);
    expect(of(3)).toMatchObject({ slot: 1, pick_label: "2.01" });
    expect(of(1)).toMatchObject({ slot: 2, pick_label: "2.02" });
    // Roster 2 is placed through draft_order and its owner.
    expect(of(2)).toMatchObject({ slot: 3, pick_label: "2.03" });
    // A season with no known order carries no slot.
    expect(picks.find((p) => p.season === 2028)?.slot).toBeNull();
  });
});

describe("chooseSleeperDraftPerSeason", () => {
  it("picks the later draft for a season, the read path's rule", () => {
    const chosen = chooseSleeperDraftPerSeason([
      draft({ draft_id: "old", season: "2027", start_time: 1000, slot_to_roster_id: { "1": 1 } }),
      draft({ draft_id: "new", season: "2027", start_time: 2000, slot_to_roster_id: { "1": 2 } }),
    ]);
    expect(chosen.get(2027)?.draft_id).toBe("new");
  });
});

describe("rosterSlotsForDraft", () => {
  it("skips a slot Sleeper has not assigned yet", () => {
    const slots = rosterSlotsForDraft(
      { slot_to_roster_id: { "1": 2, "2": null as unknown as number } },
      rosters,
    );
    expect([...slots.entries()]).toEqual([[2, 1]]);
  });
});

describe("transactionWalkEmptyStop", () => {
  it("reads every week when the far end is known", () => {
    expect(transactionWalkEmptyStop(true, false)).toBe(Number.POSITIVE_INFINITY);
    expect(transactionWalkEmptyStop(false, true)).toBe(Number.POSITIVE_INFINITY);
  });

  it("keeps the three-week stop only for the unbounded guess", () => {
    expect(transactionWalkEmptyStop(false, false)).toBe(3);
  });
});

describe("isPastSeason", () => {
  it("is true only for a season before the current one", () => {
    expect(isPastSeason(2025, 2026)).toBe(true);
    expect(isPastSeason(2026, 2026)).toBe(false);
    expect(isPastSeason(2027, 2026)).toBe(false);
    expect(isPastSeason(Number.NaN, 2026)).toBe(false);
  });
});
