# Google AdSense decline, 2026-09-14: why, and what was changed

Written 2026-09-14. Research only at first, then the changes listed in Part 3
were built the same day. Nothing here is committed or deployed by this
document; it is the record of the decision.

## 1. The decline

AdSense declined ffbeacon.com with the reason "Low value content" and linked
four documents: minimum content requirements, unique high quality content and
good user experience, the thin content guideline, and the webmaster quality
guidelines. The site had been connected through public/ads.txt (publisher id
pub-6888936505618934). Search Console showed no crawl or index problem: every
core page indexed, four sitemaps valid, no errors. The decline was about what
Google reads, not about whether it could read it.

## 2. What was found

Measured 2026-09-14 against the live site, the database and Search Console.

- The Beacon Brief was the largest body of indexed editorial content: 316 of
  509 articles in the sitemap, every one drafted by the automated desk from
  other outlets' reporting, median length 127 to 160 words by type, 154 of
  167 roster-move articles under 300 words. Google's spam policy names this
  shape under scaled content abuse and scraped content, and says to exclude
  it from Search.
- Human-written long-form content was three guides (about 4,200, 7,600 and
  1,300 words) plus the about and author pages.
- The sitemap held 1,207 URLs: 812 templated player profiles, 316 articles,
  76 everything else.
- Tool pages carried 50 to 450 words of prose around a form. The two game
  pages sent a crawler their loading fallback first (3 and 6 words) and kept
  the rest of their prose in a rail.
- The guides page carried a "coming soon" card and the author page two
  "Nothing to list yet" tiles. Google's publisher policies name
  under-construction screens.
- The privacy policy said the site does not use advertising cookies, which
  contradicts the AdSense application, and lacked the disclosure AdSense
  requires (support.google.com/adsense/answer/1348695).
- Traffic: 248 Google clicks in 90 days, a third of them branded searches.
  The domain was about three months old.

Sources read: support.google.com/adsense/answer/9724, /7299563, /10502938,
/1348695; support.google.com/webmasters/answer/9044175;
developers.google.com/search/docs/essentials/spam-policies.

## 3. What was changed (2026-09-14, working tree only)

- The Brief was switched out of search. lib/beacon-brief/index-quality.ts
  gained BRIEF_SEARCH_INDEXING (false). While it is false every article page
  is noindex, follow; the category and team archives are noindex, follow; the
  tag archive follows through isArticleIndexable; the articles sitemap is an
  empty urlset and the core sitemap lists no Brief archives. The /brief hub
  stays indexable. Articles still publish, render, feed the homepage, the
  player profiles, RSS and Discord. The quality floor is kept intact behind
  the switch (clearsQualityFloor) so turning it back on restores the old rule.
- The homepage gained a founder section between the sources block and the
  closing call to action: who builds the site, the screen reader angle, a
  pull quote from the author page, and the four build rules from the about
  page.
- The privacy policy gained an Advertising block with Google's required
  disclosure and opt-out links, an AdSense entry in the third-party list, an
  advertising line in the legal-basis and retention lists, and an honest CCPA
  paragraph. The "we do not use advertising cookies" claim was removed. The
  effective date moved to 2026-09-14.
- The guides page lost its "coming soon" card and the "being written" copy.
  The author page's two empty tiles became a panel linking the three guides.
  The games index stat detail no longer says "More on the way".
- Six pages gained a written explainer under the tool or game, through the
  new components/tool-explainer.tsx: FAAB, League Pulse, Manager Pulse (both
  branches), On The Clock, Signal Scout and Would You Rather. Each is a
  method in four steps, a Good to know list, an FAQ whose JSON-LD is built
  from the same array, and three links onward. The trade calculator and the
  start/sit tool already had a written method and FAQ and were left alone.

## 3b. Written 2026-09-15

- Two long-form guides in Michael's first person, registered everywhere a
  guide lives (lib/guides/published.ts, the nav tree, the site page registry
  and footer, breadcrumbs, the guides shelf, the per-guide OG card, the
  author page): /guides/positional-war-explained and /guides/faab-strategy.
  Keyword targets came from Search Console ("faab calculator" is the one
  non-brand query the site wins, 246 impressions in 90 days) and from
  Google's own autocomplete for "faab strategy", "how much faab",
  "waiver wire strategy", "war fantasy football" and "positional scarcity
  fantasy". Semrush was not used.
- The homepage founder section rewritten in the first person.

## 4. What is still open

- Thirteen to twenty-three more human-written pieces (weekly waiver wire,
  start/sit columns, points allowed by position, superflex and TE premium
  explained). The SEO audit's section 6D lists the targets.
- Trimming the player sitemap to players with real content, so templated
  pages are a smaller share of the index once the Brief is out.
- Whether to honor the Global Privacy Control signal automatically now that
  personalized ads may count as CCPA "sharing". The policy says it is not yet
  honored; somebody who owns legal should confirm that is acceptable.
- Wait three to four weeks after deploy for a recrawl, then request the
  AdSense review again.
