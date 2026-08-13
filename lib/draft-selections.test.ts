import { describe, it, expect } from "vitest";
import { shapeDraftSelections, type DraftSelectionContext, type RawDraftPick } from "./draft-selections";

const CTX: DraftSelectionContext = {
  sleeperDraftId: "1234567890",
  sleeperLeagueId: "9876543210",
  season: 2026,
  draftType: "snake",
  draftStatus: "complete",
  formatSlug: "dynasty-ppr-sflex",
  playerPool: "everyone",
  teams: 12,
  rounds: 15,
  draftedAt: "2026-08-01T00:00:00.000Z",
  ingestSource: "on_the_clock",
};

const NOW = new Date("2026-08-12T12:00:00.000Z");

const idMap = new Map<string, string>([
  ["4046", "11111111-1111-1111-1111-111111111111"],
  ["BUF", "22222222-2222-2222-2222-222222222222"],
]);

describe("shapeDraftSelections", () => {
  it("carries the draft context onto every row", () => {
    const picks: RawDraftPick[] = [
      { pick_no: 1, round: 1, draft_slot: 1, roster_id: 3, picked_by: "u1", player_id: "4046" },
      { pick_no: 2, round: 1, draft_slot: 2, roster_id: 5, picked_by: "u2", player_id: "BUF" },
    ];
    const rows = shapeDraftSelections(picks, CTX, idMap, NOW);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.sleeper_draft_id).toBe("1234567890");
      expect(row.season).toBe(2026);
      expect(row.format_slug).toBe("dynasty-ppr-sflex");
      expect(row.player_pool).toBe("everyone");
      expect(row.teams).toBe(12);
      expect(row.rounds).toBe(15);
      expect(row.ingest_source).toBe("on_the_clock");
    }
  });

  it("resolves player ids for numeric and DST team-code Sleeper ids", () => {
    const rows = shapeDraftSelections(
      [
        { pick_no: 1, player_id: "4046" },
        { pick_no: 2, player_id: "BUF" },
      ],
      CTX,
      idMap,
      NOW,
    );
    expect(rows[0].player_id).toBe("11111111-1111-1111-1111-111111111111");
    expect(rows[1].player_id).toBe("22222222-2222-2222-2222-222222222222");
  });

  it("keeps an unmapped pick with a null player_id rather than dropping it", () => {
    const rows = shapeDraftSelections([{ pick_no: 1, player_id: "99999" }], CTX, idMap, NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0].sleeper_player_id).toBe("99999");
    expect(rows[0].player_id).toBeNull();
  });

  it("strips the Sleeper empty-slot placeholder", () => {
    const rows = shapeDraftSelections([{ pick_no: 1, player_id: "0" }], CTX, idMap, NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0].sleeper_player_id).toBeNull();
    expect(rows[0].player_id).toBeNull();
  });

  it("rejects a hostile Sleeper player id instead of storing it", () => {
    const rows = shapeDraftSelections(
      [{ pick_no: 1, player_id: "4046,external_ids" }],
      CTX,
      idMap,
      NOW,
    );
    expect(rows[0].sleeper_player_id).toBeNull();
  });

  it("drops a pick with no usable pick_no", () => {
    const picks: RawDraftPick[] = [
      { pick_no: null, player_id: "4046" },
      { pick_no: 0, player_id: "4046" },
      { pick_no: "not-a-number", player_id: "4046" },
      { pick_no: 7, player_id: "4046" },
    ];
    const rows = shapeDraftSelections(picks, CTX, idMap, NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0].pick_no).toBe(7);
  });

  it("coerces Sleeper's string numerics", () => {
    const rows = shapeDraftSelections(
      [{ pick_no: "12", round: "2", draft_slot: "4", roster_id: "6" }],
      CTX,
      idMap,
      NOW,
    );
    expect(rows[0].pick_no).toBe(12);
    expect(rows[0].round).toBe(2);
    expect(rows[0].draft_slot).toBe(4);
    expect(rows[0].roster_id).toBe(6);
  });

  it("keeps the last of duplicate pick numbers so a single upsert is legal", () => {
    const rows = shapeDraftSelections(
      [
        { pick_no: 3, player_id: "4046" },
        { pick_no: 3, player_id: "BUF" },
      ],
      CTX,
      idMap,
      NOW,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].sleeper_player_id).toBe("BUF");
  });

  it("returns rows sorted by pick number", () => {
    const rows = shapeDraftSelections(
      [{ pick_no: 9 }, { pick_no: 2 }, { pick_no: 5 }],
      CTX,
      idMap,
      NOW,
    );
    expect(rows.map((r) => r.pick_no)).toEqual([2, 5, 9]);
  });

  it("preserves the raw Sleeper pick object in metadata", () => {
    const raw: RawDraftPick = {
      pick_no: 1,
      player_id: "4046",
      metadata: { first_name: "Test", years_exp: "0" },
    };
    const rows = shapeDraftSelections([raw], CTX, idMap, NOW);
    expect(rows[0].metadata).toEqual(raw);
  });

  it("stores a null format when the draft could not be classified", () => {
    const rows = shapeDraftSelections(
      [{ pick_no: 1 }],
      { ...CTX, formatSlug: null, playerPool: null },
      idMap,
      NOW,
    );
    expect(rows[0].format_slug).toBeNull();
    expect(rows[0].player_pool).toBeNull();
  });

  it("marks keepers only on an explicit true", () => {
    const rows = shapeDraftSelections(
      [
        { pick_no: 1, is_keeper: true },
        { pick_no: 2, is_keeper: null },
        { pick_no: 3 },
      ],
      CTX,
      idMap,
      NOW,
    );
    expect(rows.map((r) => r.is_keeper)).toEqual([true, false, false]);
  });

  it("returns nothing for an empty payload", () => {
    expect(shapeDraftSelections([], CTX, idMap, NOW)).toEqual([]);
  });

  it("refuses a draft id that is not a Sleeper draft id", () => {
    // The id becomes half the unique key, a PostgREST filter value, and a
    // Sleeper URL path segment. On The Clock validated it at the route; the
    // League Pulse path did not, so it is enforced where both callers meet.
    for (const bad of ["", "not-an-id", "123,456", "../../etc", "1".repeat(21)]) {
      expect(
        shapeDraftSelections([{ pick_no: 1, player_id: "4046" }], { ...CTX, sleeperDraftId: bad }, idMap, NOW),
      ).toEqual([]);
    }
    expect(
      shapeDraftSelections([{ pick_no: 1 }], { ...CTX, sleeperDraftId: "1234567890" }, idMap, NOW),
    ).toHaveLength(1);
  });
});
