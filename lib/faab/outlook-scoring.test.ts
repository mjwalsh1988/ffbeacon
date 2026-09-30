import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
}));
vi.mock("@/lib/supabase/server", () => ({ createCachedReadClient: () => ({}) }));

import { scoringBaseForFormat, scoringBaseForScoringType } from "./outlook";

/**
 * Every active format_configs row as production holds it (read 2026-09-29).
 * A trailing "std" in a slug is the 1QB roster, not the scoring: the default
 * format redraft-ppr-std is PPR, and pricing it on standard scoring was the bug.
 */
const ACTIVE_FORMATS: Array<{ slug: string; scoring_type: string; expected: string }> = [
  { slug: "redraft-ppr-std", scoring_type: "ppr", expected: "ppr" },
  { slug: "redraft-half-std", scoring_type: "half_ppr", expected: "half_ppr" },
  { slug: "redraft-std-std", scoring_type: "standard", expected: "std" },
  { slug: "redraft-ppr-sflex", scoring_type: "ppr", expected: "ppr" },
  { slug: "redraft-ppr-tep", scoring_type: "ppr", expected: "ppr" },
  { slug: "redraft-ppr-tep-sflex", scoring_type: "ppr", expected: "ppr" },
  { slug: "dynasty-ppr-std", scoring_type: "ppr", expected: "ppr" },
  { slug: "dynasty-ppr-sflex", scoring_type: "ppr", expected: "ppr" },
  { slug: "dynasty-ppr-tep-sflex", scoring_type: "ppr", expected: "ppr" },
  { slug: "dynasty-ppr-tep", scoring_type: "ppr", expected: "ppr" },
  { slug: "bestball-ppr-std", scoring_type: "ppr", expected: "ppr" },
  { slug: "bestball-ppr-sflex", scoring_type: "ppr", expected: "ppr" },
  { slug: "bestball-dynasty-ppr-sflex", scoring_type: "ppr", expected: "ppr" },
];

function fakeClient() {
  return {
    from: (table: string) => {
      expect(table).toBe("format_configs");
      let slug = "";
      const chain = {
        select: () => chain,
        eq: (_col: string, value: string) => {
          slug = value;
          return chain;
        },
        maybeSingle: async () => {
          const row = ACTIVE_FORMATS.find((f) => f.slug === slug);
          return { data: row ? { scoring_type: row.scoring_type } : null, error: null };
        },
      };
      return chain;
    },
  } as unknown as Parameters<typeof scoringBaseForFormat>[0];
}

describe("scoringBaseForFormat", () => {
  it.each(ACTIVE_FORMATS)("$slug scores as $expected", async ({ slug, expected }) => {
    expect(await scoringBaseForFormat(fakeClient(), slug)).toBe(expected);
  });

  it("reads an unknown format as PPR, the site default", async () => {
    expect(await scoringBaseForFormat(fakeClient(), "not-a-format")).toBe("ppr");
  });
});

describe("scoringBaseForScoringType", () => {
  it("maps each scoring_type value", () => {
    expect(scoringBaseForScoringType("ppr")).toBe("ppr");
    expect(scoringBaseForScoringType("half_ppr")).toBe("half_ppr");
    expect(scoringBaseForScoringType("standard")).toBe("std");
    expect(scoringBaseForScoringType(null)).toBe("ppr");
  });
});
