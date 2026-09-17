import { describe, expect, it } from "vitest";
import {
  BRIEF_SEARCH_INDEXING,
  clearsQualityFloor,
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

describe("clearsQualityFloor", () => {
  it("keeps a short article about a ranked player", () => {
    // The Puka Nacua groin note: 85 words, and the page someone actually searches for.
    expect(
      clearsQualityFloor({ contentMd: SHORT_ARTICLE, hasRankedPlayer: true }),
    ).toBe(true);
  });

  it("drops a short article about nobody rostered", () => {
    expect(countArticleWords(SHORT_ARTICLE)).toBeLessThan(THIN_ARTICLE_WORDS);
    expect(
      clearsQualityFloor({ contentMd: SHORT_ARTICLE, hasRankedPlayer: false }),
    ).toBe(false);
  });

  it("keeps a long article whether or not anyone on it is ranked", () => {
    expect(
      clearsQualityFloor({ contentMd: LONG_ARTICLE, hasRankedPlayer: false }),
    ).toBe(true);
    expect(
      clearsQualityFloor({ contentMd: LONG_ARTICLE, hasRankedPlayer: true }),
    ).toBe(true);
  });

  it("drops an article with no body at all", () => {
    expect(
      clearsQualityFloor({ contentMd: null, hasRankedPlayer: false }),
    ).toBe(false);
  });
});

/**
 * The master switch. While it is off, nothing the floor says matters: the article
 * that most deserves an index entry is still held back, because the decision
 * (docs/seo-audit/adsense-review-2026-09-14.md) is about the section, not the page.
 * If the switch is ever turned back on, the second block pins the floor to the
 * indexable answer again.
 */
describe("isArticleIndexable", () => {
  it("indexes a published Brief edition whatever the master switch says", () => {
    expect(isArticleIndexable({ contentMd: null, hasRankedPlayer: false, articleType: "brief" })).toBe(true);
    expect(
      isArticleIndexable({ contentMd: SHORT_ARTICLE, hasRankedPlayer: false, articleType: "brief", status: "published" }),
    ).toBe(true);
  });

  it("does not index an edition that is not published, and treats other types as legacy", () => {
    expect(isArticleIndexable({ contentMd: LONG_ARTICLE, hasRankedPlayer: true, articleType: "brief", status: "in_review" })).toBe(
      BRIEF_SEARCH_INDEXING,
    );
    expect(isArticleIndexable({ contentMd: LONG_ARTICLE, hasRankedPlayer: true, articleType: "injury" })).toBe(
      BRIEF_SEARCH_INDEXING,
    );
  });

  if (!BRIEF_SEARCH_INDEXING) {
    it("holds back every article while the Brief is switched out of search", () => {
      expect(
        isArticleIndexable({ contentMd: LONG_ARTICLE, hasRankedPlayer: true }),
      ).toBe(false);
      expect(
        isArticleIndexable({ contentMd: SHORT_ARTICLE, hasRankedPlayer: true }),
      ).toBe(false);
      expect(
        isArticleIndexable({ contentMd: SHORT_ARTICLE, hasRankedPlayer: false }),
      ).toBe(false);
    });
  } else {
    it("is the quality floor when the Brief is switched into search", () => {
      const cases: Array<[string | null, boolean]> = [
        [LONG_ARTICLE, true],
        [LONG_ARTICLE, false],
        [SHORT_ARTICLE, true],
        [SHORT_ARTICLE, false],
        [null, false],
      ];
      for (const [contentMd, hasRankedPlayer] of cases) {
        expect(isArticleIndexable({ contentMd, hasRankedPlayer })).toBe(
          clearsQualityFloor({ contentMd, hasRankedPlayer }),
        );
      }
    });
  }
});
