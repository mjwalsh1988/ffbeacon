import { describe, expect, it } from "vitest";
import {
  formatPhrase,
  formatPhraseLower,
  isBestBall,
  rankingsSeoCopy,
  type RankingFormat,
} from "@/lib/rankings-formats";

/**
 * Naming for the per-format rankings pages.
 *
 * These strings ARE the SEO difference between twelve real pages and twelve
 * near-duplicates, so the phrasing is worth pinning down. The real format rows from
 * format_configs are used verbatim below, including the te_premium_bonus values that
 * arrive from Postgres as strings rather than numbers.
 */

function fmt(over: Partial<RankingFormat> = {}): RankingFormat {
  return {
    slug: "dynasty-ppr-sflex",
    display_name: "Dynasty PPR SF",
    league_type: "dynasty",
    scoring_type: "ppr",
    is_superflex: true,
    te_premium_bonus: "0",
    ...over,
  };
}

describe("isBestBall", () => {
  it("detects best ball from the slug prefix, which is the only place it lives", () => {
    expect(isBestBall("bestball-ppr-sflex")).toBe(true);
    expect(isBestBall("bestball-dynasty-ppr-sflex")).toBe(true);
    expect(isBestBall("dynasty-ppr-sflex")).toBe(false);
    // Guard against a naive substring check.
    expect(isBestBall("redraft-bestball-ppr")).toBe(false);
  });
});

describe("formatPhrase", () => {
  it("expands the terse dropdown labels into words people search", () => {
    expect(formatPhrase(fmt())).toBe("Dynasty Superflex PPR");
    expect(
      formatPhrase(
        fmt({
          slug: "dynasty-ppr-std",
          league_type: "dynasty",
          is_superflex: false,
        }),
      ),
    ).toBe("Dynasty 1QB PPR");
  });

  it("spells out half PPR and standard scoring", () => {
    expect(
      formatPhrase(
        fmt({
          slug: "redraft-half-std",
          league_type: "redraft",
          scoring_type: "half_ppr",
          is_superflex: false,
        }),
      ),
    ).toBe("Redraft 1QB Half PPR");
    expect(
      formatPhrase(
        fmt({
          slug: "redraft-std-std",
          league_type: "redraft",
          scoring_type: "standard",
          is_superflex: false,
        }),
      ),
    ).toBe("Redraft 1QB Standard");
  });

  it("appends TE Premium when the bonus is a positive string from Postgres", () => {
    expect(
      formatPhrase(fmt({ slug: "dynasty-ppr-tep-sflex", te_premium_bonus: "0.5" })),
    ).toBe("Dynasty Superflex PPR TE Premium");
    // A zero bonus must not add the suffix, whether it arrives as "0" or 0.
    expect(formatPhrase(fmt({ te_premium_bonus: "0" }))).not.toContain(
      "TE Premium",
    );
    expect(formatPhrase(fmt({ te_premium_bonus: 0 }))).not.toContain(
      "TE Premium",
    );
    expect(formatPhrase(fmt({ te_premium_bonus: null }))).not.toContain(
      "TE Premium",
    );
  });

  it("leads with Best Ball", () => {
    expect(
      formatPhrase(
        fmt({
          slug: "bestball-dynasty-ppr-sflex",
          league_type: "dynasty",
          is_superflex: true,
        }),
      ),
    ).toBe("Best Ball Dynasty Superflex PPR");
  });
});

describe("formatPhraseLower", () => {
  it("lowercases ordinary words but keeps initialisms intact", () => {
    expect(formatPhraseLower(fmt())).toBe("dynasty superflex PPR");
    expect(
      formatPhraseLower(
        fmt({
          slug: "redraft-half-std",
          league_type: "redraft",
          scoring_type: "half_ppr",
          is_superflex: false,
        }),
      ),
    ).toBe("redraft 1QB half PPR");
    expect(
      formatPhraseLower(fmt({ te_premium_bonus: "0.5" })),
    ).toBe("dynasty superflex PPR TE Premium");
  });
});

describe("rankingsSeoCopy", () => {
  it("keeps every real format's title inside the budget the brand suffix leaves", () => {
    // The root layout appends " | FF Beacon" (12 chars). Past roughly 60 total
    // Google truncates, so the base title has to stay under about 48.
    //
    // Asserted against the twelve rows actually in format_configs rather than a
    // synthetic worst case. A best-ball dynasty format that ALSO carried the TE
    // premium would produce a 51-character title, but no such format exists and
    // inventing one to fail against would be testing a straw man.
    const ACTIVE_FORMATS: Array<Partial<RankingFormat>> = [
      { slug: "redraft-ppr-std", league_type: "redraft", scoring_type: "ppr", is_superflex: false },
      { slug: "redraft-half-std", league_type: "redraft", scoring_type: "half_ppr", is_superflex: false },
      { slug: "redraft-std-std", league_type: "redraft", scoring_type: "standard", is_superflex: false },
      { slug: "redraft-ppr-sflex", league_type: "redraft", scoring_type: "ppr", is_superflex: true },
      { slug: "redraft-ppr-tep", league_type: "redraft", scoring_type: "ppr", is_superflex: false, te_premium_bonus: "0.5" },
      { slug: "dynasty-ppr-std", league_type: "dynasty", scoring_type: "ppr", is_superflex: false },
      { slug: "dynasty-ppr-sflex", league_type: "dynasty", scoring_type: "ppr", is_superflex: true },
      { slug: "dynasty-ppr-tep-sflex", league_type: "dynasty", scoring_type: "ppr", is_superflex: true, te_premium_bonus: "0.5" },
      { slug: "dynasty-ppr-tep", league_type: "dynasty", scoring_type: "ppr", is_superflex: false, te_premium_bonus: "0.5" },
      { slug: "bestball-ppr-std", league_type: "redraft", scoring_type: "ppr", is_superflex: false },
      { slug: "bestball-ppr-sflex", league_type: "redraft", scoring_type: "ppr", is_superflex: true },
      { slug: "bestball-dynasty-ppr-sflex", league_type: "dynasty", scoring_type: "ppr", is_superflex: true },
    ];

    for (const over of ACTIVE_FORMATS) {
      const copy = rankingsSeoCopy(fmt(over));
      expect(
        copy.title.length,
        `${over.slug} title too long: "${copy.title}"`,
      ).toBeLessThanOrEqual(48);
      // Meta descriptions get truncated past roughly 160 characters.
      expect(
        copy.description.length,
        `${over.slug} description too long`,
      ).toBeLessThanOrEqual(185);
    }
  });

  it("gives each format a distinct title, description, and h1", () => {
    const a = rankingsSeoCopy(fmt());
    const b = rankingsSeoCopy(
      fmt({ slug: "dynasty-ppr-std", is_superflex: false }),
    );
    expect(a.title).not.toBe(b.title);
    expect(a.description).not.toBe(b.description);
    expect(a.headline).not.toBe(b.headline);
    expect(a.intro).not.toBe(b.intro);
  });

  it("explains the quarterback rules differently for superflex and 1QB", () => {
    expect(rankingsSeoCopy(fmt()).intro).toContain("starts two of them");
    expect(
      rankingsSeoCopy(fmt({ is_superflex: false })).intro,
    ).toContain("single-quarterback");
  });

  it("frames dynasty as long-term and redraft as this season only", () => {
    expect(rankingsSeoCopy(fmt()).intro).toContain("long-term value");
    expect(
      rankingsSeoCopy(fmt({ league_type: "redraft" })).intro,
    ).toContain("this season only");
  });

  it("mentions the TE premium only when the format carries it", () => {
    expect(rankingsSeoCopy(fmt({ te_premium_bonus: "0.5" })).intro).toContain(
      "TE premium bonus",
    );
    expect(rankingsSeoCopy(fmt()).intro).not.toContain("TE premium bonus");
  });

  it("uses plain ASCII punctuation only", () => {
    // Project rule: no em dashes, en dashes, curly quotes, or ellipsis characters
    // anywhere, including generated copy.
    const banned = /[–—‘’“”… ·]/;
    for (const superflex of [true, false]) {
      for (const tep of ["0", "0.5"]) {
        for (const league of ["dynasty", "redraft"]) {
          const copy = rankingsSeoCopy(
            fmt({ is_superflex: superflex, te_premium_bonus: tep, league_type: league }),
          );
          for (const value of Object.values(copy)) {
            expect(value).not.toMatch(banned);
          }
        }
      }
    }
  });
});
