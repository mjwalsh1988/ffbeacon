import { describe, it, expect } from "vitest";
import {
  deriveLeagueFormat,
  mapToFormatSlug,
  pickClosestSupportedFormat,
  describeDerivedFormat,
  type DerivedFormat,
  type FormatCandidate,
} from "./sleeper-to-format";
import type { SleeperLeague } from "@/lib/sleeper";

// The supported FF Beacon formats today (active, FF Beacon publishes values).
const CANDIDATES: FormatCandidate[] = [
  { slug: "redraft-ppr-std", display: "Redraft PPR", league_type: "redraft", scoring_type: "ppr", is_superflex: false, is_tep: false, display_order: 1 },
  { slug: "redraft-ppr-sflex", display: "Redraft PPR Superflex", league_type: "redraft", scoring_type: "ppr", is_superflex: true, is_tep: false, display_order: 2 },
  { slug: "dynasty-ppr-std", display: "Dynasty PPR", league_type: "dynasty", scoring_type: "ppr", is_superflex: false, is_tep: false, display_order: 3 },
  { slug: "dynasty-ppr-sflex", display: "Dynasty PPR Superflex", league_type: "dynasty", scoring_type: "ppr", is_superflex: true, is_tep: false, display_order: 4 },
  { slug: "dynasty-ppr-tep-sflex", display: "Dynasty PPR TEP Superflex", league_type: "dynasty", scoring_type: "ppr", is_superflex: true, is_tep: true, display_order: 5 },
];

function derived(over: Partial<DerivedFormat>): DerivedFormat {
  return { league_type: "redraft", scoring_type: "ppr", is_superflex: false, is_tep: false, ...over };
}

function sleeperLeague(over: Partial<SleeperLeague>): SleeperLeague {
  return {
    league_id: "1",
    name: "Test",
    season: "2026",
    scoring_settings: { rec: 1 },
    roster_positions: ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DEF"],
    settings: { type: 0 },
    ...over,
  } as SleeperLeague;
}

describe("deriveLeagueFormat league_type", () => {
  it("keeps a redraft league that has run before on the redraft board", () => {
    // Sleeper sets previous_league_id on ANY league carried season to season.
    // Reading it as a dynasty signal priced continued redraft leagues off the
    // dynasty board and told On The Clock the room was a dynasty startup.
    const d = deriveLeagueFormat(
      sleeperLeague({ settings: { type: 0 }, previous_league_id: "1253794481229004800" }),
    );
    expect(d.league_type).toBe("redraft");
    expect(mapToFormatSlug(d)).toBe("redraft-ppr-std");
  });

  it("reads a keeper league (type 1) as redraft", () => {
    expect(
      deriveLeagueFormat(sleeperLeague({ settings: { type: 1 }, previous_league_id: "999" }))
        .league_type,
    ).toBe("redraft");
  });

  it("reads type 2 as dynasty, with or without a prior season", () => {
    expect(deriveLeagueFormat(sleeperLeague({ settings: { type: 2 } })).league_type).toBe("dynasty");
    expect(
      deriveLeagueFormat(sleeperLeague({ settings: { type: 2 }, previous_league_id: "999" }))
        .league_type,
    ).toBe("dynasty");
  });
});

describe("mapToFormatSlug", () => {
  it("sends every TE-premium league to its own TE-premium board", () => {
    expect(mapToFormatSlug(derived({ league_type: "dynasty", is_tep: true }))).toBe("dynasty-ppr-tep");
    expect(
      mapToFormatSlug(derived({ league_type: "dynasty", is_superflex: true, is_tep: true })),
    ).toBe("dynasty-ppr-tep-sflex");
    expect(mapToFormatSlug(derived({ is_tep: true }))).toBe("redraft-ppr-tep");
    expect(mapToFormatSlug(derived({ is_superflex: true, is_tep: true }))).toBe(
      "redraft-ppr-tep-sflex",
    );
  });

  it("leaves non-TEP leagues on their existing board", () => {
    expect(mapToFormatSlug(derived({ league_type: "dynasty" }))).toBe("dynasty-ppr-std");
    expect(mapToFormatSlug(derived({ league_type: "dynasty", is_superflex: true }))).toBe(
      "dynasty-ppr-sflex",
    );
    expect(mapToFormatSlug(derived({}))).toBe("redraft-ppr-std");
    expect(mapToFormatSlug(derived({ is_superflex: true }))).toBe("redraft-ppr-sflex");
    expect(mapToFormatSlug(derived({ scoring_type: "half_ppr" }))).toBe("redraft-half-std");
    expect(mapToFormatSlug(derived({ scoring_type: "standard" }))).toBe("redraft-std-std");
  });

  it("keeps a redraft superflex league on a superflex board whatever its scoring", () => {
    expect(
      mapToFormatSlug(derived({ scoring_type: "standard", is_superflex: true, is_tep: true })),
    ).toBe("redraft-ppr-tep-sflex");
    expect(mapToFormatSlug(derived({ scoring_type: "half_ppr", is_superflex: true }))).toBe(
      "redraft-ppr-sflex",
    );
  });

  it("prefers a 1QB scoring match over a TE-premium match, since only PPR has a TEP board", () => {
    expect(mapToFormatSlug(derived({ scoring_type: "half_ppr", is_tep: true }))).toBe(
      "redraft-half-std",
    );
    expect(mapToFormatSlug(derived({ scoring_type: "standard", is_tep: true }))).toBe(
      "redraft-std-std",
    );
  });

  it("returns null for a dynasty league we carry no scoring for", () => {
    expect(mapToFormatSlug(derived({ league_type: "dynasty", scoring_type: "half_ppr" }))).toBeNull();
  });
});

describe("pickClosestSupportedFormat", () => {
  it("never crosses league_type: dynasty stays dynasty", () => {
    const d = derived({ league_type: "dynasty", scoring_type: "half_ppr", is_superflex: true, is_tep: true });
    const picked = pickClosestSupportedFormat(d, CANDIDATES);
    expect(picked?.league_type).toBe("dynasty");
    // dynasty superflex + TEP, half PPR -> closest is dynasty TEP superflex.
    expect(picked?.slug).toBe("dynasty-ppr-tep-sflex");
  });

  it("never crosses league_type: redraft stays redraft", () => {
    const d = derived({ league_type: "redraft", scoring_type: "standard", is_superflex: false, is_tep: false });
    const picked = pickClosestSupportedFormat(d, CANDIDATES);
    expect(picked?.league_type).toBe("redraft");
    // standard 1QB redraft -> closest supported is redraft PPR (1QB), not superflex.
    expect(picked?.slug).toBe("redraft-ppr-std");
  });

  it("weights superflex above scoring (a superflex league never collapses to 1QB)", () => {
    const d = derived({ league_type: "redraft", scoring_type: "standard", is_superflex: true, is_tep: false });
    const picked = pickClosestSupportedFormat(d, CANDIDATES);
    expect(picked?.slug).toBe("redraft-ppr-sflex");
  });

  it("a 1QB dynasty TEP league keeps 1QB rather than gaining superflex", () => {
    const d = derived({ league_type: "dynasty", scoring_type: "ppr", is_superflex: false, is_tep: true });
    const picked = pickClosestSupportedFormat(d, CANDIDATES);
    expect(picked?.slug).toBe("dynasty-ppr-std");
  });

  it("returns null when no candidate shares the league_type", () => {
    const onlyRedraft = CANDIDATES.filter((c) => c.league_type === "redraft");
    const d = derived({ league_type: "dynasty" });
    expect(pickClosestSupportedFormat(d, onlyRedraft)).toBeNull();
  });
});

describe("describeDerivedFormat", () => {
  it("renders a plain-language label", () => {
    expect(
      describeDerivedFormat({ league_type: "dynasty", scoring_type: "half_ppr", is_superflex: true, is_tep: true }),
    ).toBe("Dynasty Half PPR Superflex TE Premium");
    expect(
      describeDerivedFormat({ league_type: "redraft", scoring_type: "ppr", is_superflex: false, is_tep: false }),
    ).toBe("Redraft PPR");
  });
});
