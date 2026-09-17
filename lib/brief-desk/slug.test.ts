import { describe, expect, it } from "vitest";
import {
  isInSeasonPhase,
  KEBAB_SLUG,
  requiredSlugPrefix,
  suggestedEditionSlug,
  suggestedEditionTitle,
} from "./slug";

const END = "2026-09-15T13:00:00.000Z";

describe("suggested edition slug and title", () => {
  it("uses the fixed in-season pattern", () => {
    const p = { season: "2026", week: 2, phase: "regular" as const, preSeasonWeek: null, periodEnd: END };
    expect(suggestedEditionSlug(p)).toBe("week-2-fantasy-football-news-injuries-2026");
    expect(suggestedEditionTitle(p)).toBe("Week 2 Fantasy Football News and Injuries (2026)");
    expect(requiredSlugPrefix(p)).toBe("week-2-");
  });

  it("names playoff and pre-season periods without reusing the regular pattern", () => {
    expect(
      suggestedEditionSlug({ season: "2026", week: 19, phase: "post", preSeasonWeek: null, periodEnd: END }),
    ).toBe("playoffs-week-19-fantasy-football-news-injuries-2026");
    expect(
      suggestedEditionSlug({ season: "2026", week: null, phase: "pre", preSeasonWeek: 3, periodEnd: END }),
    ).toBe("preseason-3-weeks-to-kickoff-fantasy-football-news-2026");
  });

  it("gives an off-season period a provisional dated slug and no required prefix", () => {
    const p = { season: "2026", week: null, phase: "off" as const, preSeasonWeek: null, periodEnd: "2026-07-16T13:00:00.000Z" };
    expect(suggestedEditionSlug(p)).toBe("offseason-fantasy-football-news-2026-07-16");
    expect(suggestedEditionTitle(p)).toContain("Jul 16, 2026");
    expect(requiredSlugPrefix(p)).toBeNull();
    expect(isInSeasonPhase("off")).toBe(false);
    expect(isInSeasonPhase("regular")).toBe(true);
  });

  it("every suggested slug is kebab case", () => {
    for (const phase of ["regular", "post", "pre", "off"] as const) {
      const slug = suggestedEditionSlug({ season: "2026", week: 5, phase, preSeasonWeek: 2, periodEnd: END });
      expect(slug).toMatch(KEBAB_SLUG);
    }
  });
});
