import { describe, expect, it } from "vitest";
import { pickSourceForFormatId } from "./value-source";
import type { SourceRegistryRow } from "@/lib/source";

function source(
  slug: string,
  supported: string[] | null,
  isDefault = false,
): SourceRegistryRow {
  return {
    slug,
    display_name: slug.toUpperCase(),
    description: null,
    priority: 0,
    is_default: isDefault,
    data_type: ["rankings", "player_value_history"],
    supported_format_slugs: supported,
    update_cadence: "daily",
  };
}

// The shape production holds: FF Beacon is the default and covers no half PPR
// or standard format; FantasyCalc covers both.
const REGISTRY = [
  source("ffbeacon", ["redraft-ppr-std", "dynasty-ppr-sflex"], true),
  source("ktc", ["dynasty-ppr-sflex", "redraft-ppr-std"]),
  source("fantasycalc", ["redraft-half-std", "redraft-ppr-std"]),
];
const FORMATS = [
  { id: "f-redraft", slug: "redraft-ppr-std" },
  { id: "f-dynasty", slug: "dynasty-ppr-sflex" },
  { id: "f-half", slug: "redraft-half-std" },
];

describe("pickSourceForFormatId", () => {
  it("keeps the reader's source when it covers the league's format", () => {
    expect(pickSourceForFormatId(REGISTRY, FORMATS, "rankings", "f-dynasty", "ktc")).toBe("ktc");
  });

  it("falls through the resolver, not to a hardcoded board, when it does not", () => {
    // KTC does not cover half PPR; FantasyCalc is the only source that does.
    expect(pickSourceForFormatId(REGISTRY, FORMATS, "rankings", "f-half", "ktc")).toBe(
      "fantasycalc",
    );
  });

  it("takes the registry default when the reader has no source", () => {
    expect(pickSourceForFormatId(REGISTRY, FORMATS, "player_value_history", "f-redraft", null)).toBe(
      "ffbeacon",
    );
  });

  it("returns null for an unmatched league format", () => {
    expect(pickSourceForFormatId(REGISTRY, FORMATS, "rankings", null, "ktc")).toBeNull();
    expect(pickSourceForFormatId(REGISTRY, FORMATS, "rankings", "f-unknown", "ktc")).toBeNull();
  });
});
