import { describe, it, expect } from "vitest";
import { readRosteredPlayerPoints, readSetLineup, rawStarterIds, type RawMatchupRow } from "./lineups";
import { alignedStartingSlots } from "./slots";

const SLOTS = alignedStartingSlots(["QB", "RB", "FLEX", "WR", "TE", "BN", "BN"]);

function row(partial: Partial<RawMatchupRow>): RawMatchupRow {
  return {
    starter_ids: null,
    starter_points: null,
    player_ids: null,
    player_points: null,
    metadata: null,
    ...partial,
  };
}

describe("readSetLineup", () => {
  it("keeps every player in their own slot when a slot in the MIDDLE is empty", () => {
    // This is the bug the whole module exists for. The FLEX is empty, so
    // Sleeper puts "0" at index 2. If that placeholder is dropped, the WR moves
    // into the FLEX, the TE moves into the WR, and the TE slot reads empty.
    const entries = readSetLineup(
      row({
        starter_ids: ["qb1", "rb1", "0", "wr1", "te1"],
        starter_points: [22.4, 15.1, 0, 18.9, 9.2],
      }),
      SLOTS,
    );
    expect(entries.map((e) => e.slot.token)).toEqual(["QB", "RB", "FLEX", "WR", "TE"]);
    expect(entries.map((e) => e.sleeperId)).toEqual(["qb1", "rb1", null, "wr1", "te1"]);
    expect(entries[3].sleeperId).toBe("wr1");
    expect(entries[4].sleeperId).toBe("te1");
  });

  it("returns one entry per slot when the starters array is short", () => {
    const entries = readSetLineup(row({ starter_ids: ["qb1", "rb1"] }), SLOTS);
    expect(entries).toHaveLength(SLOTS.length);
    expect(entries.slice(2).every((e) => e.sleeperId === null)).toBe(true);
    expect(entries.slice(2).every((e) => e.actualPoints === null)).toBe(true);
  });

  it("ignores the excess when the starters array is long", () => {
    const entries = readSetLineup(
      row({ starter_ids: ["qb1", "rb1", "rb2", "wr1", "te1", "k1", "def1"] }),
      SLOTS,
    );
    expect(entries).toHaveLength(5);
    expect(entries.map((e) => e.sleeperId)).toEqual(["qb1", "rb1", "rb2", "wr1", "te1"]);
  });

  it("prefers metadata.starters over a column written before the sync fix", () => {
    // Rows written before lib/league-matchups.ts stopped filtering hold a
    // starter_ids missing its placeholders. metadata holds the Sleeper object
    // verbatim, which is the undamaged copy.
    const entries = readSetLineup(
      row({
        starter_ids: ["qb1", "rb1", "wr1"],
        starter_points: [22.4, 15.1, 0, 18.9],
        metadata: {
          starters: ["qb1", "rb1", "0", "wr1"],
          starters_points: [22.4, 15.1, 0, 18.9],
        },
      }),
      SLOTS,
    );
    expect(entries.map((e) => e.sleeperId)).toEqual(["qb1", "rb1", null, "wr1", null]);
  });

  it("takes the points from whichever array it took the ids from", () => {
    // Pairing metadata ids with column points would put the WR's points on the
    // empty FLEX, which is the same misalignment from the other end.
    const entries = readSetLineup(
      row({
        starter_ids: ["qb1", "rb1", "wr1"],
        starter_points: [1, 2, 3],
        metadata: {
          starters: ["qb1", "rb1", "0", "wr1"],
          starters_points: [22.4, 15.1, 0, 18.9],
        },
      }),
      SLOTS,
    );
    expect(entries.map((e) => e.actualPoints)).toEqual([22.4, 15.1, 0, 18.9, null]);
  });

  it("falls back to the column when metadata carries no starters array", () => {
    const entries = readSetLineup(
      row({
        starter_ids: ["qb1", "rb1"],
        starter_points: [10, 20],
        metadata: { roster_id: 4, points: 30 },
      }),
      SLOTS,
    );
    expect(entries.map((e) => e.sleeperId)).toEqual(["qb1", "rb1", null, null, null]);
    expect(entries[0].actualPoints).toBe(10);
  });

  it("reads a missing point as null rather than zero", () => {
    const entries = readSetLineup(
      row({ starter_ids: ["qb1", "rb1", "wr2", "wr1", "te1"], starter_points: [12, null, 0] }),
      SLOTS,
    );
    expect(entries[0].actualPoints).toBe(12);
    expect(entries[1].actualPoints).toBeNull();
    // A real zero is a result and stays a zero.
    expect(entries[2].actualPoints).toBe(0);
    expect(entries[3].actualPoints).toBeNull();
  });

  it("treats an empty string, a null, and a non-string id as an empty slot", () => {
    const entries = readSetLineup(row({ starter_ids: ["", null, 7, "wr1", "te1"] }), SLOTS);
    expect(entries.map((e) => e.sleeperId)).toEqual([null, null, null, "wr1", "te1"]);
  });

  it("returns empty slots rather than throwing when there is no starters array at all", () => {
    const entries = readSetLineup(row({ starter_ids: "not an array" }), SLOTS);
    expect(entries).toHaveLength(5);
    expect(entries.every((e) => e.sleeperId === null)).toBe(true);
  });
});

describe("readRosteredPlayerPoints", () => {
  it("reads the per-player map, bench included", () => {
    const points = readRosteredPlayerPoints(row({ player_points: { qb1: 22.4, bench1: 31.2 } }));
    expect(points.get("qb1")).toBe(22.4);
    expect(points.get("bench1")).toBe(31.2);
  });

  it("drops the placeholder key and any value that is not a number", () => {
    const points = readRosteredPlayerPoints(
      row({ player_points: { "0": 0, qb1: "nope", rb1: 8 } }),
    );
    expect(points.has("0")).toBe(false);
    expect(points.has("qb1")).toBe(false);
    expect(points.get("rb1")).toBe(8);
  });

  it("returns an empty map when the column is an array or missing", () => {
    expect(readRosteredPlayerPoints(row({ player_points: [] })).size).toBe(0);
    expect(readRosteredPlayerPoints(row({})).size).toBe(0);
  });
});

describe("rawStarterIds", () => {
  it("preserves placeholders and length", () => {
    expect(rawStarterIds(row({ starter_ids: ["qb1", "0", "rb1"] }))).toEqual(["qb1", "0", "rb1"]);
  });

  it("turns a non-string into an empty string so the length still matches", () => {
    expect(rawStarterIds(row({ starter_ids: ["qb1", 0, null] }))).toEqual(["qb1", "", ""]);
  });

  it("prefers metadata, same as readSetLineup", () => {
    expect(
      rawStarterIds(row({ starter_ids: ["qb1"], metadata: { starters: ["qb1", "0"] } })),
    ).toEqual(["qb1", "0"]);
  });
});
