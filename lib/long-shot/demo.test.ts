import { describe, expect, it } from "vitest";
import { DEMO_PROMPTS, scoreDemo } from "./demo";
import { TIERS } from "./types";

describe("demo data", () => {
  it("has three prompts with 30 candidates each", () => {
    expect(DEMO_PROMPTS).toHaveLength(3);
    for (const p of DEMO_PROMPTS) expect(p.candidates).toHaveLength(30);
  });

  it("puts every demo answer in its candidate list", () => {
    for (const p of DEMO_PROMPTS) {
      const ids = new Set(p.candidates.map((c) => c.sleeperId));
      for (const a of p.answers) expect(ids.has(a.sleeperId)).toBe(true);
    }
  });

  it("uses valid tiers and unique candidates", () => {
    for (const p of DEMO_PROMPTS) {
      for (const a of p.answers) expect(TIERS).toContain(a.tier);
      expect(new Set(p.candidates.map((c) => c.sleeperId)).size).toBe(p.candidates.length);
    }
  });

  it("scores an answer and a decoy", () => {
    expect(scoreDemo(DEMO_PROMPTS[2], "4892")).toBe("long_shot");
    expect(scoreDemo(DEMO_PROMPTS[2], "4984")).toBeNull();
  });

  it("contains nothing outside ASCII", () => {
    expect(JSON.stringify(DEMO_PROMPTS)).toMatch(/^[\x20-\x7E]+$/);
  });
});
