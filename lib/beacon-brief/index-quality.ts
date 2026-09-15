/**
 * Which Beacon Brief articles are worth asking Google to index.
 *
 * THE PROBLEM THIS SOLVES
 *
 * The Brief publishes what the wire publishes, and the wire publishes a lot of news
 * that is real, correctly sourced, and worthless to a fantasy manager. A 91-word note
 * that a backup defensive tackle drew a three-game suspension is an accurate page and
 * a bad page: nobody searches for it, nothing links to it, and it teaches a crawler
 * that this domain produces short, templated, low-value pages. On a three-month-old
 * site with roughly a thousand URLs and a crawl budget that has to be earned, that is
 * a cost with no matching benefit.
 *
 * THE RULE, AND WHY IT IS TWO CONDITIONS RATHER THAN ONE
 *
 *   An article is not indexable when it is under THIN_ARTICLE_WORDS words AND none of
 *   its players is currently ranked.
 *
 * A word count on its own gets this wrong in the direction that matters most. "Puka
 * Nacua leaves Rams practice with groin soreness" is 85 words because that is the
 * whole story, and it is exactly the page someone types into Google at 11pm on a
 * Saturday. Cutting it to protect the domain from the Nazeeh Johnson suspension would
 * be trading the good page for the bad one.
 *
 * So length only disqualifies a page that is ALSO about nobody a fantasy manager
 * rosters. "Currently ranked" is the site's single definition of fantasy relevance
 * (see lib/player-search.ts), the same one the autocomplete and the sitemap's player
 * section use. Not a second opinion invented here.
 *
 * Measured against the 179 published articles on 2026-08-14: 31 fall below the floor
 * with no ranked player and become noindex; 27 are short but cover a ranked player and
 * stay indexed. The 31 are suspensions and IR moves for defensive linemen, corners,
 * safeties, long snappers, and UDFA signings, plus one coaching-staff move.
 *
 * WHAT NOINDEX DOES AND DOES NOT DO
 *
 * These pages stay published, stay in the on-site feed, stay on the player and team
 * filter pages, and keep their Discord card. A reader loses nothing. They leave the
 * sitemap and carry `index: false, follow: true`, so a crawler that finds one still
 * walks its links out to the player profiles rather than treating it as a dead end.
 *
 * THE MASTER SWITCH (2026-09-14)
 *
 * Google AdSense declined the site for "low value content" on 2026-09-14, and the
 * review of why (docs/seo-audit/adsense-review-2026-09-14.md) landed on the Brief as
 * the largest single cause: 316 indexed articles, every one drafted by the automated
 * desk from other outlets' reporting, median length under 160 words. That is the
 * pattern Google's spam policies name under "scaled content abuse", and its own advice
 * for content like it is "exclude it from Search".
 *
 * So BRIEF_SEARCH_INDEXING is false, and while it is false NO article is indexable,
 * however long it is and whoever it covers, and the sitemap's articles file is empty.
 * The quality floor below is kept intact behind it (clearsQualityFloor) so flipping
 * the switch back restores the exact rule that was in force before, rather than a
 * guess at it. The category, team and tag archives follow the same switch, because
 * an archive of noindexed pages is a page of links to nothing.
 *
 * What does NOT change while the switch is off: every article still publishes, still
 * renders, still appears in the on-site feed, the RSS feed, the homepage and every
 * player profile, and still goes to Discord. The /brief hub itself stays indexable.
 * Only the search engines are told to leave the individual articles alone.
 */

/**
 * Whether ANY Beacon Brief article or archive page may be advertised to search
 * engines. See "THE MASTER SWITCH" above for why it is off.
 */
export const BRIEF_SEARCH_INDEXING = false;

/**
 * Below this, an article has to earn its place in the index by covering somebody
 * currently ranked.
 *
 * 250 words is about the point where the pipeline's own structure stops fitting: an
 * article shorter than this is usually one sourced sentence plus a "what this means"
 * paragraph, with no second fact to hang analysis on.
 */
export const THIN_ARTICLE_WORDS = 250;

/**
 * Roughly how many words a reader would count in the rendered article.
 *
 * Markdown syntax is stripped first so a page is not credited for its own formatting:
 * heading hashes, emphasis, link targets, and code fences are not words on the page.
 * Link TEXT is kept, because it is. This is an approximation and only ever compared
 * against one threshold, so it does not need to agree with any other word counter.
 */
export function countArticleWords(markdown: string | null | undefined): number {
  if (!markdown) return 0;
  const text = markdown
    // Fenced code, then inline code.
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    // Images before links: an image contributes alt text, not a word count.
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    // Links keep their text and drop their target.
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    // Heading markers, list bullets, blockquotes, table pipes, emphasis.
    .replace(/^[ \t]*[#>|-]+[ \t]*/gm, " ")
    .replace(/[*_~]+/g, " ")
    .trim();

  if (!text) return 0;
  // A "word" is any run of characters carrying a letter or a digit, so "$67.5M" and
  // "2026" count and a stray hyphen on its own line does not.
  return (text.match(/[^\s]*[A-Za-z0-9][^\s]*/g) ?? []).length;
}

type ArticleQualityInput = {
  contentMd: string | null | undefined;
  /** True when at least one player on the article is ranked inside the window. */
  hasRankedPlayer: boolean;
};

/**
 * The quality floor on its own: would this article be worth indexing if the Brief
 * were being indexed at all? Kept separate from the switch so the rule survives
 * being switched off, and so the tests can pin it down either way.
 */
export function clearsQualityFloor(input: ArticleQualityInput): boolean {
  if (input.hasRankedPlayer) return true;
  return countArticleWords(input.contentMd) >= THIN_ARTICLE_WORDS;
}

/**
 * Should this article be advertised to search engines?
 *
 * Takes the two inputs rather than a client, so the sitemap can answer it in bulk from
 * one scan and the article page can answer it from what it already loaded. Neither
 * caller gets to define the rule. While BRIEF_SEARCH_INDEXING is off the answer is
 * always no.
 */
export function isArticleIndexable(input: ArticleQualityInput): boolean {
  if (!BRIEF_SEARCH_INDEXING) return false;
  return clearsQualityFloor(input);
}
