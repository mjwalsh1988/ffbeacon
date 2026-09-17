# SEO review: Relays and Briefs

Reviewed 2026-09-17 against `docs/beacon-brief/relays-and-briefs-plan.md`
sections 1, 2, 6.1, 6.3, 6.4, 11, 14.2 and 20, and against
`docs/seo-audit/adsense-review-2026-09-14.md`.

Scope: `app/brief/**`, `app/sitemap.xml/route.ts`, `lib/sitemap/sections.ts`,
`lib/json-ld.ts`, `app/layout.tsx`, `app/author/michael/page.tsx`,
`app/guides/**`, `app/api/og/brief/[slug]/route.tsx`, `lib/llms/**`,
`lib/relays/legacy-redirect.ts`, `lib/brief-desk/**`,
`components/relays/**`, `components/brief-desk/**`,
`components/beacon-brief/brief-feed.tsx`,
`components/beacon-brief/brief-pagination.tsx`, `app/page.tsx`,
`app/about/page.tsx`, `app/terms/page.tsx`, `app/robots.ts`,
`next.config.ts`.

Production state read during the review, because several findings depend on
it: 0 published articles of any kind (no editions yet), 527 legacy Brief
articles all `status = 'archived'`, 463 rows in `legacy_article_redirects`,
660 published Relays and 65 hidden.

Counts: 2 blocker, 6 major, 7 minor.

---

## Blocker

### B1. `/brief/editions` is indexable and in the sitemap while it renders an empty state, and nothing on the site links to it

Resolution: fixed in app/brief/editions/page.tsx, lib/sitemap/sections.ts and components/beacon-brief/brief-feed.tsx, all three reading hasPublishedEditions().

Files and lines:
- `app/brief/editions/page.tsx:32` (`robots: { index: true, follow: true }`)
- `app/brief/editions/page.tsx:97-100` (the empty state)
- `lib/sitemap/sections.ts:288` (listed in the core sitemap unconditionally)
- Only inbound internal link: `components/brief-desk/edition-page.tsx:181`,
  which is on an edition page, and there are no editions

The issue. With zero published editions the page's entire body is "No edition
has been published yet. The latest reports are on the Brief hub." It is
`index: true`, self-canonical, and advertised in `/sitemaps/core.xml`. The
sitemap file's own rule 1 (`lib/sitemap/sections.ts:20-27`) says every URL
listed must be a real page that is indexable, and the AdSense record
(`docs/seo-audit/adsense-review-2026-09-14.md` part 2 and part 3) says the
guides page lost its "coming soon" card and the author page its two "Nothing
to list yet" tiles precisely because Google's publisher policies name
under-construction screens. This reintroduces that pattern and then points a
sitemap at it.

It is also orphaned. A grep of the repository for `/brief/editions` finds it
in `lib/breadcrumbs.ts`, `lib/llms/llms-txt.ts`, the sitemap, the IndexNow
call and `components/brief-desk/edition-page.tsx`. There is no link from the
hub, the site rail, the footer or `lib/nav-tree.ts`, so once editions exist
the listing page will still have one inbound link, from the pages it lists.

Search consequence. A crawl today finds an empty page that the site itself
advertises as important, which is the exact signal the AdSense decline was
about. After launch the page collects no internal link equity and competes
with `/brief` for the same "Beacon Brief" queries with less content.

The fix.
1. Gate both the robots tag and the sitemap entry on at least one published
   edition. `hasPublishedEditions()` already exists at
   `lib/sitemap/sections.ts:184` for the index file; call it from
   `coreSection` and only push the `/brief/editions` URL when it is true.
   On the page, make `metadata` a `generateMetadata` that reads the same
   count and sets `index: false, follow: true` while the list is empty.
2. Add a permanent link to `/brief/editions` from the hub. The natural place
   is beside the "Latest Brief" panel in `components/relays/latest-brief-panel.tsx`
   or in the masthead of `components/beacon-brief/brief-feed.tsx` when
   `active.type === "all"`, so the listing is one hop from an indexable page.

### B2. The homepage renders a "the first Brief is being written" placeholder

Resolution: fixed in app/page.tsx (handled alongside the homepage heading-level fix).

File and lines: `app/page.tsx:1134-1139`

The issue. When `latestBrief` is null the Beacon Brief block on the homepage
renders "The first weekly Brief is being written. Until it publishes, the
reports beside this are the desk's running record." That is live right now
(zero published editions) on the single most crawled, most linked page on the
domain. It is a "coming soon" card in prose, and the second sentence is also
the only place on a public page that frames the Relay feed as a desk's
internal record rather than as published content.

Search consequence. The homepage is the first page an AdSense reviewer and
Googlebot read. Part 3 of the AdSense record lists removing exactly this kind
of copy as one of the remediation steps; shipping it back onto the homepage
undoes that work before the re-review.

The fix. Drop the placeholder branch entirely, the way
`components/relays/latest-brief-panel.tsx:21` already does (`if (!brief)
return null`). When there is no edition, render the Relay column full width
and omit the "Latest Brief" heading. Nothing about a future page should
appear until that page exists.

---

## Major

### M1. The Terms page describes how the Brief is drafted, which the owner's decision says appears nowhere on the site

Resolution: left, app/terms/page.tsx is unchanged because keeping or narrowing the disclosure is the owner's call, not a mechanical edit.

File and lines: `app/terms/page.tsx:169-176`

The issue. Rendered public copy reads: "Some content is AI-assisted. Parts of
the Beacon Brief and some analytical commentary are drafted with the help of
automated language models working from public NFL news and our own data, then
published under our editorial responsibility." Plan section 11.3 and owner
decision 20 say how the desk gathers and prepares material is proprietary and
is described nowhere on the site. This is the one remaining public page that
describes it, and it names the Beacon Brief directly.

There is a second, sharper problem. Once editions publish, they carry "By
Michael Walsh, founder of FF Beacon" and a `Person` author in the JSON-LD,
while the Terms page tells the same reader that Beacon Brief content is
drafted by language models. A reviewer who reads both sees a personal byline
on content the site says a machine wrote, which is the specific pattern
Google's guidance on AI-generated content warns against, and it is worse than
either choice made consistently.

Search consequence. Contradictory authorship signals on a domain applying for
AdSense re-review, plus a plan rule broken.

The fix. This is the owner's call, not a mechanical deletion, because the
sentence is currently true and an honest disclosure has value of its own.
Two coherent options:
- Keep the disclosure and accept that the desk is described, in which case
  plan section 11.3 needs amending and the byline decision should be revisited.
- Narrow the sentence so it no longer describes the Brief pipeline: keep a
  general "some analytical commentary on this site is produced with
  automated assistance and published under our editorial responsibility"
  without naming the Beacon Brief or the drafting method. Editions are
  edited and approved by a named person before publication (plan 10.1), so
  the byline stands on its own.
Whichever is chosen, `app/terms/page.tsx` and the edition byline must agree.

### M2. The legacy article layout still renders "written by FF Beacon's automated news desk", and one live path can reach it

Resolution: fixed in app/brief/[slug]/page.tsx, both the two byline lines and the fall-through, which now calls notFound().

Files and lines:
- `app/brief/[slug]/page.tsx:527-537` (the visible two-line byline)
- `app/brief/[slug]/page.tsx:298-301` (the branch that falls through to it)

The issue. Task BD-T047 in the plan says the legacy disclosure line comes out
as part of BD-T024c "since they no longer render". The articles were archived
(verified: all 527 are `status = 'archived'`), but the line was not removed.
It is unreachable through an archived row, because `loadArticle` filters on
`status = 'published'`, so today nothing renders it. Two things still make it
a live risk:
1. Any article an admin publishes through the existing Beacon Brief admin
   actions renders it, whatever its origin.
2. `article_type = 'brief'` with no `brief_editions` row falls past the
   `if (edition) return ...` guard at line 300 into the legacy layout. In
   that case `generateMetadata` has already returned `index: true`
   (line 149-153, editions are indexable ahead of the master switch), so the
   page would be an indexable edition URL carrying the automated-desk
   disclosure and an `Organization` author.

Search consequence. One publish away from a public sentence that contradicts
an absolute owner decision, on a URL the site asks Google to index.

The fix. Delete the disclosure paragraph at lines 528-537 and the
`By {SITE.name}` line above it, or, if the legacy layout is to keep a byline
at all, make it the same `EditionByline` the editions use. Separately, make
the fall-through explicit: when `article.articleType === "brief"` and
`getEdition(slug)` returns nothing, `notFound()` rather than rendering the
legacy layout, so a half-written edition never becomes an indexable page.

### M3. Twenty-one paginated hub URLs are indexable, self-canonical listings of noindex reports

Resolution: fixed in app/brief/(feed)/page.tsx; the four filter routes need no page rule of their own now that all four are noindex unconditionally (M6).

File and line: `app/brief/(feed)/page.tsx:69`
(`robots: query ? { index: false, follow: true } : undefined`)

The issue. The robots rule keys on the FILTER query only, so `?page=N`
without a filter is indexable and canonical to itself
(`app/brief/(feed)/page.tsx:58`). With 660 published Relays at
`RELAY_PAGE_SIZE` 30 that is pages 1 to 22, and
`components/beacon-brief/brief-pagination.tsx` links every one of them with
real anchors. Pages 2 to 22 contain no prose of their own: a masthead, a
heading, and thirty cards whose every destination (`/brief/relay/...`,
`/brief/team/...`, `/brief/tag/...`) is noindex.

Search consequence. Twenty-one thin, near-identical listing URLs entering the
index at the moment the domain is trying to show Google a small body of
substantial pages. It is the same shape (many thin pages, each derived from
one source post) that the AdSense decline named, moved up one level from the
article to the listing.

The fix. Set `index: false, follow: true` when `currentPage > 1`, keeping the
self-canonical:

```ts
robots: query || currentPage > 1 ? { index: false, follow: true } : undefined,
```

Do the same for the `?page=` branch on the four filter routes for
consistency. `follow: true` keeps the archive crawlable, which is what the
pagination was built for.

### M4. `/brief` reports a lastmod taken from articles, and the hub is a Relay feed

Resolution: fixed in lib/sitemap/sections.ts, in coreSection and in the core branch of sectionLastModified.

File and lines: `lib/sitemap/sections.ts:265-285`

The issue. `newestArticleAt` is the newest `last_updated` / `published_at`
across published `articles`, and the hub's sitemap entry uses it
(line 285). Since BD-T018 the hub renders Relays, not articles. Today there
are no published articles, so `/brief` and `/` carry no `lastmod` at all
while the hub changes several times a day. Once the first edition publishes,
`/brief` and `/brief/editions` will carry the identical timestamp, and
`/brief` will claim it last changed the day an edition was approved while the
feed above the fold changes hourly.

The file's own rule 2 (lines 29-33) is that `lastModified` must be true or
absent, and the stated reason is that Google's response to a lastmod it does
not trust is to ignore lastmod for the whole site.

Search consequence. The one freshness signal the site has is wrong on its
most frequently updated page, and is wrong in the direction that suppresses
recrawls of new reports.

The fix. Derive the hub's lastmod from Relays:

```ts
const { data: newestRelay } = await supabase
  .from("relays").select("source_posted_at")
  .eq("status", "published")
  .order("source_posted_at", { ascending: false }).limit(1);
```

and use it for the `/brief` entry and in the `core` branch of
`sectionLastModified` (line 495-514). `/brief/editions` keeps
`newestEditionAt`, which is correct for it. The homepage entry (line 279)
should take the newer of the two, since `app/page.tsx` now shows both.

### M5. A pre-season edition will be labelled "Off-season" and marked up as `Article` rather than `NewsArticle`

Resolution: fixed in lib/brief-desk/edition-metadata.ts, lib/brief-desk/period.ts, app/brief/[slug]/page.tsx, components/brief-desk/edition-page.tsx and app/api/og/brief/[slug]/route.tsx.

Files and lines:
- `app/brief/[slug]/page.tsx:252` (`edition.week !== null ? "NewsArticle" : "Article"`)
- `lib/brief-desk/period.ts:24-26` (`periodLabel`: week null means "Off-season")
- `lib/brief-desk/cadence.ts:186` (a pre-season period is built with `week: null`)
- `lib/brief-desk/edition-metadata.ts:36-44` (`phase` is not parsed)
- `app/api/brief-desk/drafts/route.ts:218` (`phase` IS written to
  `articles.metadata`)

The issue. The cadence function assigns `week: null` to pre-season periods
and counts them in weeks to kickoff instead, which is the deliberate
deviation recorded in plan section 22. Every reader of that column then
treats null as off-season. A pre-season edition therefore gets the masthead
chip "Off-season, 2026", section eyebrows reading "Off-season, part 3 of 7",
the same wording in the editions listing and in the OG card's fallback tile
(`app/api/og/brief/[slug]/route.tsx:202`), and `@type: "Article"` where plan
11.4 asks for `NewsArticle` in season. Pre-season is weekly, dense, and is
not the off-season.

Search consequence. Factually wrong labels on an indexable page, and a
schema type mismatch on editions published in August, which is one of the
highest-volume fantasy football search windows of the year.

The fix. `phase` is already stored on `articles.metadata`. Parse it in
`lib/brief-desk/edition-metadata.ts` (a string from `"pre" | "regular" |
"post" | "off"`), then:
- branch the JSON-LD on `meta.phase === "off" ? "Article" : "NewsArticle"`;
- give `periodLabel` an optional phase argument so `"pre"` renders
  "Pre-season" (and, when `pre_season_week` travels too, "Pre-season, N weeks
  to kickoff");
- pass the phase through to `periodChipLabel` and to the OG route's fallback
  tile.

### M6. The category and team archives are gated on a switch that now governs content that no longer exists

Resolution: fixed in app/brief/(feed)/category/[slug]/page.tsx, app/brief/(feed)/team/[abbr]/page.tsx and lib/sitemap/sections.ts.

Files and lines:
- `app/brief/(feed)/category/[slug]/page.tsx:42-46`
- `app/brief/(feed)/team/[abbr]/page.tsx:37-41`
- `lib/sitemap/sections.ts:327-373`

The issue. Both archives set `index: BRIEF_SEARCH_INDEXING`, and the core
sitemap lists them when the same flag is true, keyed off ARTICLE counts
(`byCategory` and `byTeam` are built from `publishedArticles`). Since BD-T018
those routes render Relays. Plan 11.6 says the master switch continues to
govern legacy articles, and every legacy article is now archived, so the
switch's stated subject is gone while two public archive families still
depend on it. Flipping it back for any reason would, in one boolean, make
about 9 category URLs and up to 32 team URLs indexable, each a thin listing
of permanently-noindex Relays, and would add them to the sitemap with
`lastmod` values computed from archived articles. The tag and player archives
already hardcode `index: false` (`tag/[tag]/page.tsx:46`,
`player/[slug]/page.tsx:41`), so the four sibling routes disagree about what
governs them.

Search consequence. A latent one-line change that would publish 40 thin
archive pages and put sitemap dates on them that describe content nobody can
reach.

The fix. Decide the archives' indexability on their own terms and stop
importing `BRIEF_SEARCH_INDEXING` into the two route files: hardcode
`index: false, follow: true` to match tag and player, and delete the
article-driven category and team blocks from `coreSection` (lines 329-373)
along with the now-unused `publishedArticles` scan there. If team archives
should ever be indexable, that is a separate decision that needs its own
Relay-count rule and its own lastmod source.

---

## Minor

### m1. Title and description lengths past the display limits on the two indexable hub pages

Resolution: left, the titles and descriptions are a copy decision that spans pages outside this build's scope.

- `app/brief/(feed)/page.tsx:19` the hub title is 60 characters and does NOT
  use `title: { absolute }`, so the root template at `app/layout.tsx:39`
  appends " | FF Beacon" and the rendered title is 72 characters. The edition
  branch and the permalink both use `absolute` and avoid this. It also
  repeats the word "Brief" twice.
- `app/brief/(feed)/page.tsx:21` the hub description is 177 characters.
- `app/brief/editions/page.tsx:21` the editions description is 173 characters.

Both descriptions truncate near 155 to 160 characters in the SERP, cutting
"with what to do about it in dynasty and redraft" off the editions page,
which is its whole differentiator. Fix: give the hub
`title: { absolute: TITLE }` (or shorten to about 48 characters so the suffix
fits), and trim both descriptions to 150 to 155 characters with the
distinguishing clause first.

### m2. All four filter pages declare `og:url` as `/brief`

Resolution: fixed in app/brief/(feed)/category/[slug]/page.tsx, app/brief/(feed)/team/[abbr]/page.tsx, app/brief/(feed)/tag/[tag]/page.tsx and app/brief/(feed)/player/[slug]/page.tsx.

`app/brief/(feed)/category/[slug]/page.tsx:47`, `team/[abbr]/page.tsx:42`,
`tag/[tag]/page.tsx:49`, `player/[slug]/page.tsx:44` all call
`pageShareMetadata({ ..., path: "/brief" })` while their canonical is the
filter URL. Sharing `/brief/team/KC` produces a card whose `og:url` is the
hub. Low impact while the pages are noindex, but the share card is wrong
today. Fix: pass the same `base` the canonical uses.

### m3. Sixty-four archived slugs return 404 rather than resolving

Resolution: left, the finding itself concludes no change is required; it is recorded so the Search Console count is expected rather than investigated twice.

`lib/relays/legacy-redirect.ts` plus `app/brief/[slug]/page.tsx:293-295`.
Verified in production: 527 archived articles, 463 redirect rows, 64 archived
slugs with no row. Those are posts the replayed relevance gates dropped
during the backfill, which plan 14.1 explicitly allows, so there is nothing
to redirect them to and a 404 is defensible. Google treats 404 and 410
almost identically for removal, so no change is required; note it here so the
Search Console "Not found" count after the recrawl is expected rather than
investigated twice.

On the redirect itself, which the brief asked to judge: a permanent redirect
to a noindex, follow Relay permalink is the right outcome for these URLs, and
better than a 410. The reason is that the Relay carries the same report, so
every Discord card, external link and bookmark published over three months
keeps resolving to the content it promised, while the noindex target removes
the URL from search just as a 410 would. A 410 would buy slightly faster
removal at the cost of breaking every one of those links, and there is no
ranking value to preserve either way. One thing to watch: `next.config.ts`
already redirects about 30 retired duplicate slugs to a surviving article
slug that is now itself archived, so those URLs take two hops (config 308,
then the legacy-redirect 308). Well inside what crawlers follow, but the
chains could be collapsed by pointing those config entries straight at the
Relay slug.

### m4. "1 stories published so far" once the first edition lands

Resolution: left, the About page sentence is a copy decision on a page outside this build's scope.

`app/about/page.tsx:74-98` counts every published article and
`app/about/page.tsx:287-289` renders it as "N stories published so far". The
count was 316 legacy articles; it is 0 today and will be 1, then 2, then 3.
Besides the singular-plural bug, "1 stories published so far" on the About
page of a site asking for an AdSense re-review reads worse than saying
nothing. Fix: count `article_type = 'brief'` explicitly, hide the sentence
below about five editions, and pluralise.

### m5. The validator accepts titles and descriptions past the SERP display limits

Resolution: left here, lib/brief-desk/validate-draft.ts belongs to the Brief Desk build rather than to this SEO pass.

`lib/brief-desk/draft-schema.ts:72` (`title` 40 to 110) and `:75`
(`meta_description` 80 to 165). Nothing between the desk run and publication
enforces a length a reader will actually see; the JSON-LD headline is clipped
at 110 (`app/brief/[slug]/page.tsx:245`) but the `<title>` is not. Fix: add a
warning (not an error, the owner edits at approval) to
`lib/brief-desk/validate-draft.ts` when the title exceeds 60 characters or
the description exceeds 155, so it lands in `validation_report` on the review
page.

### m6. Each Relay card links the same permalink twice

Resolution: left, the footer permalink is a deliberate affordance and the duplication is accepted, which is the second option the finding offers.

`components/relays/relay-card.tsx:119-124` (the headline) and `:190-198`
(the "Permalink" link) both point at `/brief/relay/{slug}`. Thirty cards to a
page means 60 anchors to 30 URLs. Harmless, but on an indexable listing page
it doubles the crawl-frontier entries for URLs that are noindex by design.
Fix: keep the headline link and drop the footer permalink on the feed (the
permalink is still needed on Discord and in the Brief's inline citations),
or keep both and accept the duplication as a deliberate affordance.

### m7. The permalink's own comment says it returns 410; it returns 200

Resolution: fixed in app/brief/relay/[slug]/page.tsx, the doc comment only.

`app/brief/relay/[slug]/page.tsx:16-27` documents "A retracted Relay returns
410". The code renders a 200 noindex page (lines 54-72). Plan section 22
records the deviation and the reason (an App Router page cannot set a 410),
so the code is right and the comment is stale. Fix the comment, because the
next reader will otherwise assume a 410 is in place.

---

## Verified correct, for the record

These were checked and need no change:

- `/brief/relay/[slug]` is `index: false, follow: true` unconditionally, not
  behind the master switch, canonical to itself, and absent from every
  sitemap file (`app/brief/relay/[slug]/page.tsx:39-41`,
  `lib/sitemap/sections.ts:56-61`).
- No noindex URL appears in any sitemap file today. The articles file emits
  editions only (`lib/sitemap/sections.ts:388-395`), and
  `app/sitemap.xml/route.ts:36-39` keeps the index from pointing at it while
  it is empty.
- Every `lastModified` is derived from real data or omitted, and
  `changeFrequency` is gone. The `/brief` value is wrong in SOURCE (M4), not
  fabricated.
- One `Person` entity across the site. `AUTHOR_ID`, `ORG_ID` and
  `WEBSITE_ID` are defined once (`lib/json-ld.ts:62-64`); the root layout
  emits the `Organization` and `WebSite` carrying those ids
  (`app/layout.tsx:168`); the author page emits the same Person by `@id`
  (`app/author/michael/page.tsx:71-83`); all seven guides and the edition
  branch embed it through `authorJsonLd()`; `Organization.founder` points at
  the same `@id`. `lib/json-ld.test.ts:53-84` pins it.
- The edition JSON-LD carries `headline` (clipped at 110), `datePublished`,
  `dateModified`, `author` as the Person by `@id` with `jobTitle: "Founder"`,
  `worksFor` and `sameAs` (Discord's invite path excluded,
  `lib/json-ld.ts:76-80`), `publisher` as the Organization by `@id`, three
  `ImageObject`s at 1200x630, 1200x900 and 1200x1200, `mainEntityOfPage`,
  `articleSection`, `about` as the players' profile URLs, a `FAQPage` when
  the draft has one, and a three-item `BreadcrumbList`. No `isBasedOn`, no
  `citation`, no `contributor`.
- The OG route's edition branch is brand only: `#0F0F1A` to `#07070D`,
  purple to cyan, the FF Beacon wordmark, "ffbeacon.com", and "By Michael
  Walsh, founder of FF Beacon". No gold, no `#0c0c18`. The three ratios it
  serves match the dimensions the page declares exactly. Nothing from
  `research_log`, `citations`, `validation_report` or `review_notes` reaches
  it; `articles.metadata` carries only period, cadence, phase, formats,
  source display, stat tiles and the referenced datasets
  (`app/api/brief-desk/drafts/route.ts:214-223`).
- `/brief/rss.xml` selects `article_type = 'brief'` only and
  `/brief/relays.xml` carries every published Relay. Both build `pubDate` and
  `lastBuildDate` through `formatRfc822Eastern`
  (`lib/datetime.ts:89-117`), which emits a valid RFC 822 date with a numeric
  offset in Eastern. Both declare `atom:link rel="self"`. The hub's metadata
  carries autodiscovery for both, Briefs first
  (`app/brief/(feed)/page.tsx:59-64`).
- The llms files carry no sentence about the desk, the model, research or the
  review process. `lib/llms/context.ts:118-131` describes Relays and Briefs
  as content and names Michael Walsh as the editions' author;
  `lib/llms/llms-full-txt.ts:190` states that Relays are noindex and out of
  the sitemap and that editions are in it. Nothing in `components/relays/`,
  `components/brief-desk/`, `app/brief/editions/`, the OG route or either
  feed describes how material is gathered. The only remaining descriptions
  anywhere public are M1 and M2.
- The edition byline is the plan's text, two paragraphs in reading order
  directly under the title, with `rel="author"` on the name
  (`components/brief-desk/edition-byline.tsx:43-68`).
- Player pills link `/players/{slug}`, not the noindex per-player archive
  (`components/relays/relay-card.tsx:145`), which is the C01 fix holding.
- IndexNow fires from the approve action (`lib/brief-desk/publish.ts:137`,
  submitting the edition, `/brief` and `/brief/editions`) and from an edit of
  an already-published edition (`:245`). There is no call anywhere in
  `app/api/brief-desk/drafts/route.ts` or the bundle route.
- Duplicate content between the two ways to filter (`/brief?team=PHI` versus
  `/brief/team/PHI`) is not live: both are noindex today, and each is
  canonical to itself rather than cross-canonical, which is the correct
  pairing with a noindex tag.
- `app/robots.ts` leaves all of `/brief` crawlable, which a noindex tag
  requires to be read at all.
