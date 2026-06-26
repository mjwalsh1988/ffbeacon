import { describe, it, expect } from "vitest";
import {
  pickClosestSupportedFormat,
  describeDerivedFormat,
  type DerivedFormat,
  type FormatCandidate,
} from "./sleeper-to-format";

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
