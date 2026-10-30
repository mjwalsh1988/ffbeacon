import { describe, expect, it } from "vitest";
import { ctaFigureFrom, loadBlueprintCtaFigure } from "./cta-data";
import { BLUEPRINT_MODEL_VERSION } from "./types";

const row = (over: Record<string, unknown> = {}) => ({
  standing: { overall: 7.4, status: { label: "Contender" }, rosterArchetype: "Deep" },
  model_version: BLUEPRINT_MODEL_VERSION,
  generated_at: "2026-10-29T15:00:00Z",
  ...over,
});

describe("ctaFigureFrom", () => {
  it("reads the stored overall and status", () => {
    expect(ctaFigureFrom(row())).toEqual({ overall: 7.4, statusLabel: "Contender", generatedAt: "2026-10-29T15:00:00Z" });
  });

  it("shows no figure without a row or for an older model", () => {
    expect(ctaFigureFrom(null)).toBeNull();
    expect(ctaFigureFrom(row({ model_version: BLUEPRINT_MODEL_VERSION - 1 }))).toBeNull();
  });
});

describe("loadBlueprintCtaFigure", () => {
  it("reads exactly one row by league, roster, season and source", async () => {
    const filters: Array<[string, unknown]> = [];
    let selected = "";
    const builder = {
      select: (cols: string) => {
        selected = cols;
        return builder;
      },
      eq: (c: string, v: unknown) => {
        filters.push([c, v]);
        return builder;
      },
      maybeSingle: async () => ({ data: row(), error: null }),
    };
    const out = await loadBlueprintCtaFigure({ from: () => builder } as never, "L", 3, "2026", "ktc");
    expect(out?.overall).toBe(7.4);
    expect(selected).toContain("view->standing");
    expect(selected).not.toMatch(/(^|, )view(,|$)/);
    expect(filters).toEqual([
      ["league_id", "L"],
      ["roster_id", 3],
      ["season", "2026"],
      ["source", "ktc"],
    ]);
  });
});
