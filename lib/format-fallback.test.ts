import { describe, it, expect } from "vitest";
import { pickFallbackFormat, type FormatLike } from "./format-fallback";

// The 12 active FF Beacon formats with their real display_order.
const ALL_FORMATS: FormatLike[] = [
  { slug: "redraft-ppr-std", display_name: "Redraft PPR", league_type: "redraft", scoring_type: "ppr", is_superflex: false, display_order: 1 },
  { slug: "redraft-half-std", display_name: "Redraft Half PPR", league_type: "redraft", scoring_type: "half_ppr", is_superflex: false, display_order: 2 },
  { slug: "redraft-std-std", display_name: "Redraft Standard", league_type: "redraft", scoring_type: "standard", is_superflex: false, display_order: 3 },
  { slug: "redraft-ppr-sflex", display_name: "Redraft PPR Superflex", league_type: "redraft", scoring_type: "ppr", is_superflex: true, display_order: 4 },
  { slug: "redraft-ppr-tep", display_name: "Redraft PPR TEP", league_type: "redraft", scoring_type: "ppr", is_superflex: false, display_order: 5 },
  { slug: "dynasty-ppr-std", display_name: "Dynasty PPR", league_type: "dynasty", scoring_type: "ppr", is_superflex: false, display_order: 6 },
  { slug: "dynasty-ppr-sflex", display_name: "Dynasty PPR Superflex", league_type: "dynasty", scoring_type: "ppr", is_superflex: true, display_order: 7 },
  { slug: "dynasty-ppr-tep-sflex", display_name: "Dynasty PPR TEP Superflex", league_type: "dynasty", scoring_type: "ppr", is_superflex: true, display_order: 8 },
  { slug: "dynasty-ppr-tep", display_name: "Dynasty PPR TEP", league_type: "dynasty", scoring_type: "ppr", is_superflex: false, display_order: 9 },
  { slug: "bestball-ppr-std", display_name: "Best Ball PPR", league_type: "redraft", scoring_type: "ppr", is_superflex: false, display_order: 10 },
  { slug: "bestball-ppr-sflex", display_name: "Best Ball PPR Superflex", league_type: "redraft", scoring_type: "ppr", is_superflex: true, display_order: 11 },
  { slug: "bestball-dynasty-ppr-sflex", display_name: "Best Ball Dynasty PPR Superflex", league_type: "dynasty", scoring_type: "ppr", is_superflex: true, display_order: 12 },
];

// Formats that currently have FF Beacon value data (all except the three redraft
// non-PPR / TEP formats, which have none). This is the set the snapshot value-format
// fallback (pickValueFormatWithData) scopes to.
const WITH_VALUE_DATA = ALL_FORMATS.map((f) => f.slug).filter(
  (s) => !["redraft-half-std", "redraft-std-std", "redraft-ppr-tep"].includes(s),
);

describe("value-format fallback for dataless formats", () => {
  it("routes redraft Half / Standard / TEP to redraft PPR (closest with data)", () => {
    expect(pickFallbackFormat(ALL_FORMATS, "redraft-half-std", WITH_VALUE_DATA)?.slug).toBe(
      "redraft-ppr-std",
    );
    expect(pickFallbackFormat(ALL_FORMATS, "redraft-std-std", WITH_VALUE_DATA)?.slug).toBe(
      "redraft-ppr-std",
    );
    expect(pickFallbackFormat(ALL_FORMATS, "redraft-ppr-tep", WITH_VALUE_DATA)?.slug).toBe(
      "redraft-ppr-std",
    );
  });

  it("keeps the fallback on the same league type (never crosses dynasty/redraft)", () => {
    const choice = pickFallbackFormat(ALL_FORMATS, "redraft-half-std", WITH_VALUE_DATA);
    expect(choice?.league_type).toBe("redraft");
  });

  it("returns null when no format has data to fall back to", () => {
    expect(pickFallbackFormat(ALL_FORMATS, "redraft-half-std", [])).toBeNull();
  });
});
