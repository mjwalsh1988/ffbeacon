import { describe, it, expect } from "vitest";
import { nameSides } from "./side-names";

describe("nameSides", () => {
  it("puts the managers' names into Signal Check's verdict sentence", () => {
    expect(nameSides("Side A wins by 21.9% of total trade value.", "Yackson24", "kendawg9")).toBe(
      "Yackson24 wins by 21.9% of total trade value.",
    );
  });

  it("maps each side to its own team, not both to the first", () => {
    expect(nameSides("Side A beat Side B", "Alpha", "Bravo")).toBe("Alpha beat Bravo");
  });

  it("keeps possessives intact", () => {
    expect(nameSides("Side A's package is deeper.", "Alpha", "Bravo")).toBe(
      "Alpha's package is deeper.",
    );
  });

  it("leaves words that merely contain the token alone", () => {
    // Word boundaries, so a template mentioning a sideline or an inside track
    // is not rewritten into nonsense.
    const text = "Sideline reporting from inside Side A.";
    expect(nameSides(text, "Alpha", "Bravo")).toBe("Sideline reporting from inside Alpha.");
  });

  it("leaves other letters alone", () => {
    // Only A and B are sides. "Side C" is not a thing Signal Check emits, and
    // rewriting it would be inventing a party to the trade.
    expect(nameSides("Side C", "Alpha", "Bravo")).toBe("Side C");
  });

  it("replaces every occurrence, not just the first", () => {
    expect(nameSides("Side A wins. Side A also wins.", "Alpha", "Bravo")).toBe(
      "Alpha wins. Alpha also wins.",
    );
  });
});
