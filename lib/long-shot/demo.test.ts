import { describe, expect, it } from "vitest";
import { DEMO_PROMPTS, scoreDemo, searchDemoCandidates } from "./demo";
import { SEARCH_MIN_LENGTH, TIERS } from "./types";

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

describe("searchDemoCandidates", () => {
  const qb = DEMO_PROMPTS[2];

  it("shows nothing until the minimum letters are typed", () => {
    expect(SEARCH_MIN_LENGTH).toBe(4);
    expect(searchDemoCandidates(qb, "")).toEqual([]);
    expect(searchDemoCandidates(qb, "Mah")).toEqual([]);
    expect(searchDemoCandidates(qb, "Maho").map((r) => r.name)).toEqual(["Patrick Mahomes"]);
  });

  it("matches the start of a first name, a surname or the whole name, never the middle", () => {
    expect(searchDemoCandidates(qb, "Patr").map((r) => r.name)).toEqual(["Patrick Mahomes"]);
    expect(searchDemoCandidates(qb, "patrick ma").map((r) => r.name)).toEqual(["Patrick Mahomes"]);
    expect(searchDemoCandidates(qb, "home")).toEqual([]);
  });

  it("ignores punctuation and case so C.J. Stroud is reachable either way", () => {
    expect(searchDemoCandidates(qb, "C.J. S").map((r) => r.name)).toContain("C.J. Stroud");
    expect(searchDemoCandidates(qb, "cj s").map((r) => r.name)).toContain("C.J. Stroud");
    // Punctuation does not count toward the floor: "C.J." is two letters.
    expect(searchDemoCandidates(qb, "C.J.")).toEqual([]);
  });

  it("caps the list at eight and shapes each row like the real search", () => {
    const wide = { ...qb, candidates: Array.from({ length: 12 }, (_, i) => ({ name: `Jake Test${i}`, sleeperId: `t${i}` })) };
    const rows = searchDemoCandidates(wide, "Jake");
    expect(rows).toHaveLength(8);
    expect(rows[0]).toEqual({ id: "t0", name: "Jake Test0", position: "QB", team: null, sleeperId: "t0" });
  });
});
