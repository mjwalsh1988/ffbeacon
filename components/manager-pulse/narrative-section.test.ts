import { describe, it, expect } from "vitest";
import { splitNarrative } from "./narrative-section";

/**
 * The card splits each template sentence into a claim and its evidence on the
 * first full stop. Every template in lib/manager-pulse/narrative.ts is written
 * claim-first, so this is a display split over a shape the engine guarantees,
 * not a guess at where a sentence ends.
 */
describe("splitNarrative", () => {
  it("splits a two-sentence template into the claim and the numbers behind it", () => {
    const { claim, evidence } = splitNarrative(
      "Pays up in dynasty. Gives up 8% more value than market, over 11 graded trades.",
    );
    expect(claim).toBe("Pays up in dynasty.");
    expect(evidence).toBe("Gives up 8% more value than market, over 11 graded trades.");
  });

  it("keeps a one-sentence template whole rather than leaving an empty body", () => {
    const { claim, evidence } = splitNarrative("Barely trades.");
    expect(claim).toBe("Barely trades.");
    expect(evidence).toBeNull();
  });

  it("keeps the third sentence with the evidence rather than dropping it", () => {
    const { claim, evidence } = splitNarrative("A. B. C.");
    expect(claim).toBe("A.");
    expect(evidence).toBe("B. C.");
  });

  it("never rewrites a word: claim plus evidence reconstructs the template", () => {
    const text = "Trades a lot. 359 trades across 60 league-seasons in 2 seasons, about 6.0 each.";
    const { claim, evidence } = splitNarrative(text);
    expect(`${claim} ${evidence}`).toBe(text);
  });
});
