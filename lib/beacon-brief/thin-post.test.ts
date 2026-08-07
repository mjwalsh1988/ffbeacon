import { describe, expect, it } from "vitest";

/**
 * The thin-post guard from migration 0179, tested against the real posts.
 *
 * A model asked to write an article from a fragment will write one, and the only
 * material it has is what it already believes. The prompts now forbid that; this is
 * the arithmetic that makes it moot. The rule has to fire on the stub that produced a
 * wholly invented article and stay clear of the short-but-complete reports that make
 * up most of the feed, so both are asserted here.
 *
 * Mirrors substantiveTextLength / MIN_SUBSTANTIVE_POST_CHARS in ./worker.ts, which are
 * private to the queue handler that uses them.
 */

const MIN_SUBSTANTIVE_POST_CHARS = 60;

function substantiveTextLength(
  parts: Array<string | null | undefined>,
): number {
  return parts
    .filter(Boolean)
    .join(" ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[@#]\w+/g, " ")
    .replace(/\s+/g, " ")
    .trim().length;
}

const isThin = (...parts: Array<string | null | undefined>) =>
  substantiveTextLength(parts) < MIN_SUBSTANTIVE_POST_CHARS;

describe("substantiveTextLength", () => {
  it("does not count links or handles as content", () => {
    expect(substantiveTextLength(["https://t.co/abc123"])).toBe(0);
    expect(substantiveTextLength(["@AdamSchefter #Falcons"])).toBe(0);
  });

  it("counts the quoted and retweeted text a post carries with it", () => {
    const own = substantiveTextLength(["Big news:"]);
    const withQuote = substantiveTextLength([
      "Big news:",
      "The Titans and G Peter Skoronski have agreed to terms on a new extension.",
    ]);
    expect(withQuote).toBeGreaterThan(own);
  });
});

describe("the thin-post guard", () => {
  it("fires on the stub that produced an entirely invented article", () => {
    // This post published a 700-word article describing a groin injury on a named
    // date, at a joint practice against a named opponent, after a game with a
    // specific score, quoting a head coach. The post is the whole input.
    expect(isThin("Worst part of training camp: https://t.co/k9eDrJT0TH")).toBe(
      true,
    );
  });

  it("fires on a bare link and on a headline fragment", () => {
    expect(isThin("https://t.co/9p4NuUkv6U")).toBe(true);
    expect(isThin("More on this: https://t.co/Bt55IWvM81")).toBe(true);
  });

  it("does not fire on a short but complete report", () => {
    // Both of these say who and what, which is all an article needs to start from.
    expect(
      isThin("Jonathan Taylor officially has signed his two-year extension."),
    ).toBe(false);
    expect(
      isThin("Source: Tests confirmed an ACL tear for Falcons' Jalon Walker."),
    ).toBe(false);
    expect(
      isThin(
        "Lions RB Jahmyr Gibbs officially signed his three-year extension. https://t.co/NpjJypsVUI",
      ),
    ).toBe(false);
  });

  it("does not fire on a stub whose quoted post carries the story", () => {
    // The guard reads the quoted content too, so a quote-tweet with a real quoted
    // post behind it is not thin even when its own text is a fragment.
    expect(
      isThin(
        "Worst part of training camp:",
        "#Falcons promising edge Jalon Walker is feared to have torn his ACL, per me and @wyche89.",
      ),
    ).toBe(false);
  });
});
