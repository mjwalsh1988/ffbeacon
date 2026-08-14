import { describe, expect, it } from "vitest";
import {
  countArticleWords,
  isArticleIndexable,
  THIN_ARTICLE_WORDS,
} from "./index-quality";

/**
 * The floor, tested on the shape of real articles rather than on lorem ipsum.
 *
 * The two cases that matter are the pair the rule exists to separate: a short article
 * about a ranked player (keep) and a short article about nobody in particular (drop).
 */

/** Roughly what a 90-word transaction note looks like, with the real structure. */
const SHORT_ARTICLE = `## Nazeeh Johnson suspended six games

Titans CB Nazeeh Johnson was suspended six games for violating the NFL's policy against performance-enhancing substances, according to [Adam Schefter](https://x.com/AdamSchefter).

## What this means for your roster

Johnson is a rotational corner with no fantasy value in any standard format. Tennessee's secondary loses depth for six weeks, which is worth noting only in deep IDP leagues.`;

const LONG_ARTICLE = `# Heading\n\n${"word ".repeat(400)}`;

describe("countArticleWords", () => {
  it("counts the words a reader would count", () => {
    expect(countArticleWords("Jedrick Wills takes first-team reps")).toBe(5);
  });

  it("does not credit an article for its own markdown", () => {
    // Same five words, wrapped in a heading, a bullet, emphasis, and a link.
    const dressed = "## **Jedrick** Wills\n\n- takes [first-team](/x) reps";
    expect(countArticleWords(dressed)).toBe(5);
  });

  it("counts figures and money as words", () => {
    expect(countArticleWords("The deal is $67.5M over 3 years")).toBe(7);
  });

  it("drops a fenced code block and an image entirely", () => {
    expect(countArticleWords("one two\n\n```\nnot prose here\n```")).toBe(2);
    expect(countArticleWords("one two ![some alt text](/img.png)")).toBe(2);
  });

  it("treats a missing body as zero rather than throwing", () => {
    expect(countArticleWords(null)).toBe(0);
    expect(countArticleWords("")).toBe(0);
    expect(countArticleWords("   \n  ")).toBe(0);
  });
});

describe("isArticleIndexable", () => {
  it("keeps a short article about a ranked player", () => {
    // The Puka Nacua groin note: 85 words, and the page someone actually searches for.
    expect(
      isArticleIndexable({ contentMd: SHORT_ARTICLE, hasRankedPlayer: true }),
    ).toBe(true);
  });

  it("drops a short article about nobody rostered", () => {
    expect(countArticleWords(SHORT_ARTICLE)).toBeLessThan(THIN_ARTICLE_WORDS);
    expect(
      isArticleIndexable({ contentMd: SHORT_ARTICLE, hasRankedPlayer: false }),
    ).toBe(false);
  });

  it("keeps a long article whether or not anyone on it is ranked", () => {
    expect(
      isArticleIndexable({ contentMd: LONG_ARTICLE, hasRankedPlayer: false }),
    ).toBe(true);
    expect(
      isArticleIndexable({ contentMd: LONG_ARTICLE, hasRankedPlayer: true }),
    ).toBe(true);
  });

  it("drops an article with no body at all", () => {
    expect(
      isArticleIndexable({ contentMd: null, hasRankedPlayer: false }),
    ).toBe(false);
  });
});
