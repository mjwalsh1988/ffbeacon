import { describe, it, expect } from "vitest";
import { detectLeagueFormat } from "./format-detect";
import type { FormatCandidate } from "@/lib/sleeper-to-format";
import type { SleeperLeague } from "@/lib/sleeper";

/**
 * Format detection mirrors Signal Check: derive the league's real format from its
 * Sleeper scoring/roster settings, then match to an FF Beacon-supported format
 * (exact when carried, else the closest within the same redraft/dynasty type).
 */

const CANDIDATES: FormatCandidate[] = [
  { slug: "redraft-ppr-std", display: "Redraft PPR", league_type: "redraft", scoring_type: "ppr", is_superflex: false, is_tep: false, display_order: 1 },
  { slug: "redraft-half-std", display: "Redraft Half PPR", league_type: "redraft", scoring_type: "half_ppr", is_superflex: false, is_tep: false, display_order: 2 },
  { slug: "redraft-ppr-sflex", display: "Redraft PPR Superflex", league_type: "redraft", scoring_type: "ppr", is_superflex: true, is_tep: false, display_order: 3 },
  { slug: "dynasty-ppr-std", display: "Dynasty PPR", league_type: "dynasty", scoring_type: "ppr", is_superflex: false, is_tep: false, display_order: 10 },
  { slug: "dynasty-ppr-sflex", display: "Dynasty Superflex", league_type: "dynasty", scoring_type: "ppr", is_superflex: true, is_tep: false, display_order: 11 },
];

function league(over: Partial<SleeperLeague>): SleeperLeague {
  return {
    league_id: "L1",
    name: "Test",
    season: "2026",
    sport: "nfl",
    status: "drafting",
    total_rosters: 12,
    ...over,
  } as SleeperLeague;
}

describe("detectLeagueFormat", () => {
  it("picks the exact FF Beacon format when supported (dynasty superflex PPR)", () => {
    const l = league({
      settings: { type: 2 },
      scoring_settings: { rec: 1 },
      roster_positions: ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "SUPER_FLEX"],
    });
    const d = detectLeagueFormat(l, CANDIDATES);
    expect(d?.slug).toBe("dynasty-ppr-sflex");
    expect(d?.isClosest).toBe(false);
    expect(d?.derivedLabel).toContain("Dynasty");
    expect(d?.derivedLabel).toContain("Superflex");
  });

  it("picks the exact redraft PPR standard format", () => {
    const l = league({
      settings: { type: 0 },
      scoring_settings: { rec: 1 },
      roster_positions: ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX"],
    });
    const d = detectLeagueFormat(l, CANDIDATES);
    expect(d?.slug).toBe("redraft-ppr-std");
    expect(d?.isClosest).toBe(false);
  });

  it("falls back to the closest supported format when the exact one is not carried", () => {
    // Dynasty HALF-PPR: mapToFormatSlug returns null (we only carry PPR dynasty),
    // so the closest dynasty format is used.
    const l = league({
      settings: { type: 2 },
      scoring_settings: { rec: 0.5 },
      roster_positions: ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX"],
    });
    const d = detectLeagueFormat(l, CANDIDATES);
    expect(d).not.toBeNull();
    expect(d?.isClosest).toBe(true);
    // Never crosses league type: it must be a dynasty format.
    expect(d?.slug.startsWith("dynasty")).toBe(true);
  });

  it("never crosses the redraft/dynasty line and returns null when no same-type candidate exists", () => {
    const dynastyOnly = CANDIDATES.filter((c) => c.league_type === "dynasty");
    const redraftLeague = league({
      settings: { type: 0 },
      scoring_settings: { rec: 1 },
      roster_positions: ["QB", "RB", "WR", "TE", "FLEX"],
    });
    expect(detectLeagueFormat(redraftLeague, dynastyOnly)).toBeNull();
  });

  it("treats a superflex roster as superflex (2+ QB slots or SUPER_FLEX)", () => {
    const twoQb = league({
      settings: { type: 0 },
      scoring_settings: { rec: 1 },
      roster_positions: ["QB", "QB", "RB", "WR", "TE"],
    });
    expect(detectLeagueFormat(twoQb, CANDIDATES)?.slug).toBe("redraft-ppr-sflex");
  });
});
