import { describe, expect, it } from "vitest";
import { describeDerived, pickLeagueTypeSafeFormat } from "./league-format-resolution";
import type { DerivedFormat } from "./sleeper-to-format";

type Row = {
  slug: string;
  display_name: string;
  league_type: string;
  scoring_type: string;
  is_superflex: boolean;
  display_order: number | null;
  te_premium_bonus: number | null;
};

const row = (slug: string, order: number, over: Partial<Row> = {}): Row => ({
  slug,
  display_name: slug,
  league_type: slug.includes("dynasty") ? "dynasty" : "redraft",
  scoring_type: slug.includes("-half-") ? "half_ppr" : slug.includes("-std-std") ? "standard" : "ppr",
  is_superflex: slug.includes("sflex"),
  display_order: order,
  te_premium_bonus: slug.includes("-tep") ? 0.5 : 0,
  ...over,
});

// The active boards, in their production display order.
const FORMATS: Row[] = [
  row("redraft-ppr-std", 1),
  row("redraft-half-std", 2),
  row("redraft-std-std", 3),
  row("redraft-ppr-sflex", 4),
  row("redraft-ppr-tep", 5),
  row("redraft-ppr-tep-sflex", 6),
  row("dynasty-ppr-std", 7),
  row("dynasty-ppr-sflex", 8),
  row("dynasty-ppr-tep-sflex", 9),
  row("dynasty-ppr-tep", 10),
  row("bestball-ppr-std", 11),
  row("bestball-ppr-sflex", 12),
  row("bestball-dynasty-ppr-sflex", 13),
];

const derived = (over: Partial<DerivedFormat>): DerivedFormat => ({
  league_type: "redraft",
  scoring_type: "ppr",
  is_superflex: false,
  is_tep: false,
  ...over,
});

describe("pickLeagueTypeSafeFormat", () => {
  it("weighs TE premium: a half PPR TEP league lands on the TEP board, not the first PPR board", () => {
    const supported = FORMATS.map((f) => f.slug).filter((s) => s !== "redraft-half-std");
    const picked = pickLeagueTypeSafeFormat(FORMATS, derived({ scoring_type: "half_ppr", is_tep: true }), supported);
    expect(picked?.slug).toBe("redraft-ppr-tep");
  });

  it("keeps a dynasty TEP superflex league on the TEP superflex board", () => {
    const picked = pickLeagueTypeSafeFormat(
      FORMATS,
      derived({ league_type: "dynasty", scoring_type: "half_ppr", is_superflex: true, is_tep: true }),
      null,
    );
    expect(picked?.slug).toBe("dynasty-ppr-tep-sflex");
  });

  it("never crosses league type", () => {
    const supported = ["redraft-ppr-std", "redraft-ppr-sflex"];
    expect(pickLeagueTypeSafeFormat(FORMATS, derived({ league_type: "dynasty" }), supported)).toBeNull();
  });

  it("keeps a best ball league on a best ball board when the source has one", () => {
    const picked = pickLeagueTypeSafeFormat(
      FORMATS,
      derived({ scoring_type: "half_ppr", is_best_ball: true }),
      ["redraft-ppr-std", "bestball-ppr-std"],
    );
    expect(picked?.slug).toBe("bestball-ppr-std");
  });

  it("keeps a managed league off the best ball board", () => {
    const picked = pickLeagueTypeSafeFormat(FORMATS, derived({ scoring_type: "half_ppr" }), [
      "bestball-ppr-std",
      "redraft-ppr-std",
    ]);
    expect(picked?.slug).toBe("redraft-ppr-std");
  });
});

describe("describeDerived", () => {
  it("names best ball", () => {
    expect(describeDerived(derived({ is_best_ball: true, is_superflex: true }))).toBe(
      "Best Ball Redraft PPR Superflex",
    );
  });
});
