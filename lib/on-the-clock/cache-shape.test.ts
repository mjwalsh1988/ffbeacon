import { describe, it, expect } from "vitest";
import { PICK_COLUMNS, shapePickRow, shapeProjectedPickRow } from "./cache";
import type { ProjectedPickRow } from "./cache";
import type { Database } from "@/lib/database.types";

type PickRow = Database["public"]["Tables"]["on_the_clock_pick_cache"]["Row"];

/**
 * Two shapers, one shape.
 *
 * readDraftCache projects first_name / last_name / position / team out of the
 * `metadata` jsonb in Postgres, because shipping the whole column moved 105 KB a
 * read to get four short strings. The Realtime handler cannot do that: Postgres
 * Changes delivers the full row, so it still reads the jsonb itself.
 *
 * That is two code paths producing the pick objects the whole room renders from,
 * and a drift between them would show up as a player who has a name on load and
 * loses it the moment a pick lands live. These tests are what stops that.
 *
 * The projected row is DERIVED from the metadata fixture by reading the aliases
 * out of PICK_COLUMNS, so dropping a field from the select or renaming an alias
 * fails here rather than silently returning undefined in production.
 */

const META_ALIASES = ["first_name", "last_name", "position", "team"] as const;

/** Parse the select string the way PostgREST would, into alias -> jsonb key. */
function metadataAliases(select: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of select.split(",").map((s) => s.trim())) {
    const match = /^([a-z_]+):metadata->>([a-z_]+)$/.exec(part);
    if (match) out.set(match[1], match[2]);
  }
  return out;
}

/** What Postgres would return for this row, given the select string. */
function projectRow(metadata: Record<string, unknown>): ProjectedPickRow {
  const aliases = metadataAliases(PICK_COLUMNS);
  const read = (alias: string): string | null => {
    const key = aliases.get(alias);
    // No alias in the select means Postgres returns nothing for it, which is
    // exactly the silent-undefined failure this derivation exists to catch.
    if (!key) return undefined as unknown as string | null;
    const value = metadata[key];
    // `->>` renders a JSON value as text and yields SQL NULL for JSON null.
    if (value === null || value === undefined) return null;
    return typeof value === "string" ? value : String(value);
  };
  return {
    pick_no: 7,
    round: 1,
    draft_slot: 7,
    roster_id: 7,
    picked_by: "u1",
    sleeper_player_id: "4034",
    player_id: "11111111-1111-1111-1111-111111111111",
    is_keeper: false,
    first_name: read("first_name"),
    last_name: read("last_name"),
    position: read("position"),
    team: read("team"),
  };
}

function fullRow(metadata: Record<string, unknown>): PickRow {
  return {
    sleeper_draft_id: "123",
    pick_no: 7,
    round: 1,
    draft_slot: 7,
    roster_id: 7,
    picked_by: "u1",
    sleeper_player_id: "4034",
    player_id: "11111111-1111-1111-1111-111111111111",
    is_keeper: false,
    metadata: metadata as PickRow["metadata"],
    created_at: "2026-08-08T00:00:00.000Z",
    updated_at: "2026-08-08T00:00:00.000Z",
  };
}

describe("the pick-cache select string", () => {
  it("projects every metadata field shapePickRow reads", () => {
    const aliases = metadataAliases(PICK_COLUMNS);
    for (const field of META_ALIASES) {
      expect(aliases.get(field), `PICK_COLUMNS is missing ${field}`).toBe(field);
    }
  });

  it("names every plain column the shaper needs", () => {
    for (const column of [
      "pick_no",
      "round",
      "draft_slot",
      "roster_id",
      "picked_by",
      "sleeper_player_id",
      "player_id",
      "is_keeper",
    ]) {
      expect(PICK_COLUMNS.split(",").map((s) => s.trim())).toContain(column);
    }
  });
});

describe("pick row shaping", () => {
  it("the projected read and the realtime row produce the same pick", () => {
    const metadata = {
      first_name: "Christian",
      last_name: "McCaffrey",
      position: "RB",
      team: "SF",
      // Everything else in the payload is exactly what the projection leaves on
      // the server, so the two results should still match.
      years_exp: "8",
      injury_status: null,
    };

    expect(shapeProjectedPickRow(projectRow(metadata))).toEqual(shapePickRow(fullRow(metadata)));
  });

  it("treats an absent field and an empty string the same way in both paths", () => {
    // Sleeper sends "" for a free agent's team, and omits fields for a defense.
    // Both paths have to land on the same value for both, or a pick changes
    // shape the moment it arrives live instead of on load.
    const metadata = { first_name: "Amon-Ra", team: "" };
    const fromRead = shapeProjectedPickRow(projectRow(metadata));

    expect(fromRead).toEqual(shapePickRow(fullRow(metadata)));
    expect(fromRead.lastName).toBeNull();
  });

  it("agrees on a numeric metadata value, which Postgres renders as text", () => {
    // readString coerces a number to a string and `->>` renders it as text, so
    // the two paths agree. Recorded because they agree for different reasons.
    const metadata = { first_name: "Amon-Ra", last_name: "St. Brown", position: "WR", team: 49 };
    expect(shapeProjectedPickRow(projectRow(metadata))).toEqual(shapePickRow(fullRow(metadata)));
  });
});
