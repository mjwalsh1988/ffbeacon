import { describe, expect, it } from "vitest";
import { rosterArchetype, twoYearOutlook, valueArchetype } from "./archetype";
import { DEFAULT_LEAGUE_BLUEPRINT_SETTINGS } from "./default-settings";

const s = DEFAULT_LEAGUE_BLUEPRINT_SETTINGS.archetype;

describe("valueArchetype", () => {
  it("covers every dynasty branch", () => {
    expect(valueArchetype("competitor", true, 0, 5, s)).toBe("Win now");
    expect(valueArchetype("loaded", true, 0, 5, s)).toBe("Loaded");
    expect(valueArchetype("rebuilder", true, 0, 5, s)).toBe("Rebuild");
    expect(valueArchetype("middle", true, 0.5, 6, s)).toBe("One year reload");
    expect(valueArchetype("middle", true, 0.4, 6, s)).toBe("Retool");
    expect(valueArchetype("middle", true, 0.5, 5, s)).toBe("Retool");
  });

  it("uses the redraft words", () => {
    expect(valueArchetype("competitor", false, 0, null, s)).toBe("Contend");
    expect(valueArchetype("loaded", false, 0, null, s)).toBe("Contend");
    expect(valueArchetype("middle", false, 0, null, s)).toBe("In the hunt");
    expect(valueArchetype("rebuilder", false, 0, null, s)).toBe("Longshot");
  });

  it("is null without Power Pulse", () => {
    expect(valueArchetype(null, true, 0, 5, s)).toBeNull();
  });
});

describe("rosterArchetype", () => {
  it("splits on starter share", () => {
    expect(rosterArchetype(80, 20, s)).toBe("Top heavy");
    expect(rosterArchetype(62, 38, s)).toBe("Deep");
    expect(rosterArchetype(70, 30, s)).toBe("Well rounded");
  });
});

describe("twoYearOutlook", () => {
  it("contenders hold unless the roster is old", () => {
    expect(twoYearOutlook("competitor", true, -0.5, 5, 0.2, s)?.text).toBe("Contend, then Contend");
    expect(twoYearOutlook("competitor", true, -0.6, 5, 0.2, s)?.text).toBe("Contend, then Reload");
  });

  it("middle teams contend next year only when young with picks", () => {
    expect(twoYearOutlook("middle", true, 0.5, 6, 0.2, s)?.text).toBe("Reload, then Contend");
    expect(twoYearOutlook("middle", true, 0.5, 5, 0.2, s)?.text).toBe("Reload, then Reload");
  });

  it("rebuilders reload only with a young core and strong picks", () => {
    expect(twoYearOutlook("rebuilder", true, 2, 7, 0.5, s)?.text).toBe("Rebuild, then Reload");
    expect(twoYearOutlook("rebuilder", true, 2, 6, 0.5, s)?.text).toBe("Rebuild, then Rebuild");
  });

  it("cites the age gap, the picks grade and the young share", () => {
    const o = twoYearOutlook("middle", true, 1.25, 7, 0.42, s)!;
    expect(o.reason).toBe(
      "The roster is 1.3 years younger than the league, with draft capital graded 7 of 10 and 42% of value aged 25 or under.",
    );
  });

  it("is null in redraft and without Power Pulse", () => {
    expect(twoYearOutlook("competitor", false, 0, null, 0, s)).toBeNull();
    expect(twoYearOutlook(null, true, 0, 5, 0, s)).toBeNull();
  });
});
