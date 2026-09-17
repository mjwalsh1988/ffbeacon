# SEO review, second pass: Relays and Briefs

Reviewed 2026-09-17, after the first pass (docs/beacon-brief/reviews/seo.md)
and after the changes made the same day that the first pass never saw. Read
against docs/beacon-brief/relays-and-briefs-plan.md sections 2, 6.1, 6.3,
6.4, 11, 14.2, 20 and 22, docs/seo-audit/adsense-review-2026-09-14.md,
docs/seo-audit/seo-audit-and-plan.md sections 6C and 6D, and CLAUDE.md rule 6,
the Time Display rule and the OG brand rule.

Scope: the uncommitted working tree (git status --short, 58 modified files and
the new app/brief/editions, app/brief/relay, app/brief/relays.xml,
components/relays, components/brief-desk, lib/brief-desk and lib/relays
trees). Every file and line cited below was read. String lengths were
measured with a script, not by eye. `npm run typecheck` passes. Production
counts were read through the Supabase MCP (read-only): 0 published editions,
1 published article of any type (see M1), 527 archived articles, 660 published
Relays, 65 hidden, 0 retracted, 463 rows in legacy_article_redirects.

The first pass's fixes were verified one by one; the results are in the
"Verified correct" section at the end. Its M1 (the Terms page sentence) is the
owner's open decision and is not re-argued here; the check asked for was
whether anything else on the site describes the desk, and the answer is in m1.

Counts: 0 blocker, 3 major, 7 minor.

---

## Major

### M1. Production is still publishing per-post articles, and the archive run cannot see them

Files and lines:
- lib/beacon-brief/curate.ts:1131-1133 and :1224-1229 (the gate on
  `settings.articleWriteEnabled`, which is correct in the working tree)
- scripts/archive-legacy-articles.ts:40 (skips only `status = 'archived'`)
  and :15-17 (an article whose ingestion has no Relay is archived with no
  redirect row)
- app/brief/[slug]/page.tsx:171-232 and :301-330 (the legacy layout that
  renders such an article)

The issue. `bb_article_write_enabled` was set false in production at
03:17 UTC today (migration 0285 is applied), but the deployed code is still
commit 604cc04, which does not read the flag. Production has kept running the
old path: ten `article_write` jobs completed in the last 24 hours (the newest
at 10:30:48 UTC today), and one of them published
`/brief/nico-collins-hamstring-injury` at 10:31 UTC, seven hours after the
archive script ran. It is `origin = 'beacon_brief'`, `status = 'published'`,
has one ingestion and no Relay (production does not write Relays either: of
the ingestions accepted since the cut-over, zero have a Relay).

Nothing in the tree is wrong; the sequence is. When this build deploys, that
article, and every one published between the archive run and the deploy,
stays published. It renders the legacy layout, which is noindex (the master
switch is false) and carries no byline, so search impact is bounded, but it
is a live, 200, per-post rewritten article of the exact class the AdSense
record says was removed, reachable by anyone who has the link, and it never
enters the redirect table because the archive script only redirects an
article whose ingestion has a Relay.

Search consequence. A small but growing set of legacy articles that survive
the cut-over as orphan pages, outside both the sitemap and the redirect
table, with the Organization author and no byline. Each is a 200 that a
crawler can reach from an old Discord link.

The fix, in deploy order rather than code:
1. Deploy this tree (the flag then takes effect and the Relay path starts).
2. Re-run `scripts/backfill-relays.ts` for the ingestions accepted since
   2026-09-17 03:17 UTC so each gets a Relay, then re-run
   `scripts/archive-legacy-articles.ts` (it is idempotent: line 40 skips rows
   already archived, line 81 upserts on article_slug). Read the report line
   for any article archived without a redirect and confirm it is expected.
3. Verify afterwards with `select count(*) from articles where status =
   'published' and article_type <> 'brief'`, which must be 0.
Record the counts in plan section 22 beside the BD-T024 line.

### M2. Forty-two archived article URLs permanently redirect to a permalink that returns 404

Files and lines:
- app/brief/[slug]/page.tsx:304-310 (the redirect, unconditional on the
  target's status)
- lib/relays/legacy-redirect.ts:20-33 (reads relay_slug only)
- app/brief/relay/[slug]/page.tsx:66-88 (a hidden Relay is `notFound()`)
- next.config.ts:360-362 and :398-400 (two config redirects whose survivor
  slug is one of the forty-two)

The issue. Verified in production: 42 of the 463 rows in
legacy_article_redirects point at a Relay whose status is `hidden`
(`status_reason = 'grounding'`, every one of them). `loadRelayBySlug` filters
on `status = 'published'`, so the permalink loads nothing, reads the status
back as hidden, and calls `notFound()`. The archived article URL therefore
answers 308 to a URL that answers 404. Two of the config-level redirects
compound it into three steps: `/brief/darnell-wright-bears-extension-431cc`
and `/brief/darnell-wright-extension-bears` go 308 (config) to
`/brief/darnell-wright-bears-extension`, 308 (page) to
`/brief/relay/bears-darnell-wright-contract-extension`, then 404; the same
for the two `jedrick-wills` sources via
`/brief/relay/wills-first-team-lt-reps-burden-stevenson-fall`.

next.config.ts's own comment at lines 225-231 says a permanent redirect to
a 404 is worse for both readers and crawlers than the 404 itself, and this is
that pattern, 42 times, on URLs that were live for up to three months and
were posted to Discord.

Search consequence. Search Console reports these as redirect errors rather
than plain not-found, so the "expected 64 not-found" note in the first
pass's m3 becomes 64 not-found plus 42 redirect errors that look like a
broken migration. A reader following an old Discord link lands on a 404 with
no explanation, when the site has the report and is merely holding it
pending review.

The fix. Do not redirect to a Relay that is not published. Either:
- In `lookupLegacyArticleRedirect`, join or second-read `relays.status` and
  return null unless it is `published`; the page then falls through to
  `notFound()` directly, one hop, no chain. This is the smaller change.
- Or, when the grounding-failed Relays are reviewed and published from the
  admin Relays manager, the redirects come alive by themselves. That is not a
  fix on its own, because 42 rows are waiting on a human and new
  grounding failures will keep landing in the same state.
Do the first regardless, and treat the second as the reason the table should
not be rewritten. Separately, the archive script could skip writing a row
for a hidden Relay, but then a later publish of that Relay would leave the
old URL a 404 for good, so filtering at read time is the right layer.

### M3. The hub's indexable page wipes the site-wide preview permissions

File and line: app/brief/(feed)/page.tsx:49

The issue. `robots: query || currentPage > 1 ? { index: false, follow:
true } : undefined` sets the key to `undefined` on the one variant of the hub
that is indexable. Next merges metadata key by key
(node_modules/next/dist/lib/metadata/resolve-metadata.js:176-178 assigns
`target.robots = resolveRobots(source.robots)` for any key present on the
source, and resolvers/resolve-basics.js:155-156 returns null for a falsy
input). A present-but-undefined `robots` therefore replaces the root
layout's `max-image-preview: large`, `max-snippet: -1` and `max-video-preview:
-1` (app/layout.tsx:60-64) with no robots tag at all. The root layout's own
comment at lines 55-59 names exactly this trap, and
components/signal/profile-view.tsx:80-85 shows the working pattern: spread
the key in only when it is needed.

The shape predates this build (the first pass quotes the same line at its
old position), which is why it was never recorded; it is still wrong, and
this build is the one that rewrote the line.

Search consequence. `/brief` is one of only two indexable Brief URLs today,
and it loses the large-image-preview permission the SEO audit's B06 put on
every page. Without `max-image-preview:large` a page is not eligible for a
large image in Discover or image-led results, which is where a news hub
would otherwise appear.

The fix:

```ts
...(query || currentPage > 1 ? { robots: { index: false, follow: true } } : {}),
```

While there, the editions page (app/brief/editions/page.tsx:49-53) puts
`max-image-preview` on `googleBot` only; add `"max-image-preview": "large"`
and `"max-snippet": -1` to the basic object too, as the edition page does
(app/brief/[slug]/page.tsx:149-153 sets both on googleBot; the basic object
there could take them as well), so Bing gets the same permission.

---

## Minor

### m1. Five public sentences say "the desk" accepts reports; none describes how it works

The owner's decision (plan 20, 11.3) is that how the desk gathers and
prepares material is described nowhere on the site. Checked every string a
reader or crawler sees under app/, components/ and lib/llms/. Nothing
describes the method, the model, the research or the review; the Terms
sentence (first pass M1, the owner's call) remains the only description.
Five sentences do name a desk that "accepts" reports, which is a mention of a
selection step rather than a description of it:
- app/brief/(feed)/page.tsx:108, the indexable hub's visible description:
  "Every injury, trade, signing and role change the desk accepted".
- components/beacon-brief/brief-feed.tsx:230, the feed's empty state: "New
  reports land here the moment the desk accepts them."
- components/player-profile/beacon-brief-tab.tsx:54-55, on every indexable
  player profile with no reports: "Player news will appear here as the desk
  accepts it."
- app/brief/relays.xml/route.ts:60, the Relay feed's channel description
  (same sentence as the hub).
- app/author/michael/page.tsx:290, the Brief tile: "The news desk, written
  so the roster impact is in the first line."
The word is harmless on its own; the reason to change it is that "the desk
accepted" invites the question the site has decided not to answer, and
"accepted" implies an editor a reader may then look for. A wording that
names the output rather than the process reads the same to a crawler and
raises nothing: "Every injury, trade, signing and role change, as a
structured report with the original source credited" and "New reports land
here as they are published." Owner's call; recorded so the check is on file.

### m2. The editions listing has no share image

File and lines: app/brief/editions/page.tsx:54-55

`openGraph` carries title, description, url, siteName and type but no
`images`, and `twitter.card` is `"summary"`. Every other indexable page in
this build goes through `pageShareMetadata` (lib/page-og.ts) and gets a real
1200x630 card; a share of `/brief/editions` gets the bare link. Fix: replace
the two blocks with `...pageShareMetadata({ key: "brief", title: TITLE,
description: DESCRIPTION, path: "/brief/editions" })`, which also keeps
`og:url` equal to the canonical.

### m3. Two config redirects land on a 404, and thirty land on a second redirect

File and lines: next.config.ts:380-382, :419-421, and the 0151 and 0178
blocks at :232-421

Verified in production: `/brief/aaron-donald-rams-workout` 308s to
`/brief/aaron-donald-rams-workout-comeback`, which is archived and has no
row in legacy_article_redirects (one of the 64 the gates dropped), so it is
a permanent redirect to a 404. `/brief/jak-bi-lane-michael-thomas-comparison-ravens`
308s to `/brief/jakobi-lane-michael-thomas-comparison-ravens`, same state.
Fix: point both at `/brief`, the way RETIRED_BRIEF_SLUGS are (lines 448-452),
or drop them and let the 404 stand. The remaining thirty or so 0151 and 0178
entries take two hops (config 308 to the archived survivor, page 308 to the
Relay), which the first pass's m3 noted and which is inside what crawlers
follow; collapsing them means writing the Relay slug into next.config.ts,
which then has to track a database table, so leaving them is defensible.
Sixteen of the eighteen survivors were checked against the table; the two
above are the only ones with no row, and two more (darnell-wright,
jedrick-wills) chain into M2.

### m4. The llms files advertise the editions listing while it is noindex, and say "0 published so far"

Files and lines: lib/llms/llms-txt.ts:180-184 and lib/llms/llms-full-txt.ts:189-191

With zero editions, /llms.txt lists "Every Brief edition" at /brief/editions
with the tail "0 published so far", and /llms-full.txt says "0 editions are
published. Every edition is listed at /brief/editions". Both are true, and
the count comes from a real read (lib/llms/data.ts:106-110, with the
failed-read guard at 113-131), so this is not a false claim. It is the same
under-construction advertisement that B1 removed from the sitemap and the
hub, made to answer engines instead of Google. Fix: emit the /brief/editions
link and the sentence only when `data.articleCount > 0`, the way the
"Editions index" block at llms-full-txt.ts:201 already gates itself.

### m5. The fixed playoff title pattern is longer than the validator's own SERP limit

Files and lines: lib/brief-desk/slug.ts:45 and lib/brief-desk/validate-draft.ts:96, :278-280

Measured: "NFL Playoffs Week 20 Fantasy Football News and Injuries (2026)"
is 62 characters before the run adds anything after the colon, and the
validator warns at 60 (SERP_TITLE_MAX). Every playoff edition will carry a
warning the owner can only clear by departing from the pattern the plan
fixes (11.1). The regular-season pattern is 49 and the pre-season pattern
58, both inside the limit. Fix: "Playoffs Week 20 Fantasy Football News and
Injuries (2026)" is 58; or accept that the playoff title runs long and note
it in the validator's message. The thresholds themselves are right: Google
truncates titles around 600 px, which is 50 to 60 characters, and
descriptions around 155 to 160 on desktop; the rendered `<title>` is
`absolute` (app/brief/[slug]/page.tsx:143) so no suffix is added to what the
validator measured, and the description renders verbatim.

### m6. The Briefs feed's managingEditor is a name, not an address

File and line: app/brief/rss.xml/route.ts:116

RSS 2.0 defines `managingEditor` as an email address for the person
responsible for editorial content, and the W3C validator warns on a bare
name. The line predates this build (the diff touches lines 64-72 and 113
only), so it is recorded rather than charged to it. Fix: drop the element,
or use `SITE.author.email` if one exists in the form "editor@example.com
(Michael Walsh)". Everything else in both feeds validates: channel title,
link and description present, `atom:link rel="self"`, RFC 822 dates from
`formatRfc822Eastern`, every field escaped, guid as the permalink, and a
channel with zero items is legal.

### m7. A stale code comment on the author page still describes the disclosure line

File and lines: app/author/michael/page.tsx:56-59

The comment says the page is the one "every Beacon Brief article's
disclosure line links to" and that the line "names Michael as the person who
built the automated news desk and oversees it". That line was deleted in
this build (app/brief/[slug]/page.tsx:531-539). Comments are not crawled, so
there is no search consequence; the risk is a later editor reading it as the
current design and restoring the line. Fix: rewrite it to say every guide
and every Brief edition bylines Michael and links here.

---

## Verified correct, for the record

First-pass resolutions, each re-read against the code:

- B1. `hasPublishedEditions()` (lib/sitemap/sections.ts:186-195) is the one
  read behind all three decisions: the editions page's robots
  (app/brief/editions/page.tsx:38-53), the core sitemap entry
  (sections.ts:306-312, pushed only when `editions.length > 0`, which is the
  same filter) and the hub's masthead link
  (components/beacon-brief/brief-feed.tsx:101-104, :170-179, rendered only on
  the unfiltered view and only when true). The index file keeps the articles
  sitemap out until an edition exists (app/sitemap.xml/route.ts:36-39).
- B2. app/page.tsx:1113-1156: no placeholder for a missing Brief; the Relay
  column takes the width. The remaining empty branch at :1121-1124 fires
  only when there are no Relays either (660 today), and does not promise an
  edition.
- M2. app/brief/[slug]/page.tsx:531-539 carries no byline and no disclosure;
  :312-321 calls `notFound()` for a `brief` row with no edition. The legacy
  JSON-LD at :395-399 still names the Organization as author, which is the
  accurate credit.
- M3. The hub's robots rule keys on `feedQuery(search) || currentPage > 1`
  (app/brief/(feed)/page.tsx:49), so every filtered and every paged variant
  is noindex, follow and self-canonical through `feedPath` (:35). An
  unrecognised `?team=` or `?player=` still produces a non-empty query
  (lib/relays/feed-params.ts:55-56 sets the param from the raw value, not
  the resolved one), so the empty state (:70, :119-123) is noindex with a
  canonical of itself. An unrecognised `?kind=` or out-of-range `?week=`
  parses to null, produces an empty query, and the page is then the
  indexable hub with canonical `/brief`, which is the right consolidation.
  `?team=phi` is uppercased in both the canonical and the lookup
  (lib/beacon-brief-feed.ts:307). The pagination builds every href on the
  filtered base (components/beacon-brief/brief-pagination.tsx:7-10), so
  filters survive paging.
- M3 on the four filter routes. Category, team, tag and player all carry
  kind and week through `FILTER_KEYS` (each route's line 17-19), canonical
  through `feedPath(base, search, FILTER_KEYS)`, hardcode `index: false,
  follow: true` unconditionally, and are listed in no sitemap (sections.ts
  comment block at :47-60 and the absence of any such push in
  `coreSection`).
- M4. `/brief` takes its lastmod from the newest published Relay's
  `source_posted_at` (sections.ts:259-265, :295), the homepage from the
  newer of that and the editions (:280-284), `/brief/editions` from the
  editions (:309), and the core branch of `sectionLastModified` reads the
  same three sources (:477-502). Every lastmod is derived or absent.
- M5. `phase` is parsed (lib/brief-desk/edition-metadata.ts:139),
  `periodLabel(week, phase)` renders "Pre-season" (period.ts:46-50), the
  chip and the section eyebrows pass it (components/brief-desk/edition-page.tsx:68,
  :76, :142), the schema type branches on it with the week column as the
  fallback for rows written before it was stored (app/brief/[slug]/page.tsx:255-261),
  and the OG fallback tile uses it (app/api/og/brief/[slug]/route.tsx:197,
  :204). The editions listing at app/brief/editions/page.tsx:134 calls
  `periodLabel(b.week)` without the phase because `LatestBrief` does not
  carry it (lib/relays/load.ts:391-401 projects only period_start and
  period_end); a pre-season edition will read "Off-season" in that one list
  until `phase` is added to BRIEF_SELECT. Recorded here as a gap in M5's
  resolution rather than a new finding, since it is one column on one
  select.
- M6. Neither app/brief/(feed)/category/[slug]/page.tsx nor
  team/[abbr]/page.tsx imports BRIEF_SEARCH_INDEXING; the article-driven
  category and team blocks are gone from `coreSection` (sections.ts:342-352
  explains why).
- m2. All four filter routes pass their own `base` as the share path
  (category :51, team :45, tag :49, player :44). The hub's own `og:url` is
  always `/brief` (page.tsx:50) while its canonical carries the filter and
  page; on noindex variants that is acceptable and consolidates shares onto
  the hub, and on the indexable page the two agree.
- m7. The permalink's comment matches the code (app/brief/relay/[slug]/page.tsx:26-29).

Measured lengths on the indexable pages in this build (root layout appends
" | FF Beacon" unless the page uses `title: { absolute }`):
- `/brief`: title 51 (absolute, includes the brand once), description 152.
- `/brief/editions`: title 31 (absolute), description 148.
- `/`: title 57 (absolute), description 143.
- `/about`: the Brief tile at five editions is a 129-character body that
  reads "... 5 editions published so far."; at zero it says nothing about a
  count (app/about/page.tsx:295-299, threshold at :80). Both read cleanly.
- `/author/michael`: title 41 with the suffix, description 141.
- Edition pages: title is `absolute: article.title`, so the validator's
  60-character warning measures the rendered title exactly; the
  regular-season pattern is 49 before the colon.
No duplicate titles: the hub, the listing, the homepage and the author page
are all distinct, and the two Brief titles share a prefix but not a string.

Structured data, checked shape by shape against schema.org:
- Edition page (app/brief/[slug]/page.tsx:263-291): NewsArticle or Article
  with headline (clipped at 110), description, inLanguage,
  isAccessibleForFree, datePublished, dateModified, `author` as the Person
  by `@id` with name, jobTitle, worksFor (Organization by `@id` with name),
  url and sameAs (lib/json-ld.ts:156-174), `publisher` as the Organization
  by `@id` with name, url and an ImageObject logo (:177-191), three
  ImageObjects with url, width and height matching the OG route's three
  frames exactly (:44-51 against route.tsx:16-20), mainEntityOfPage as a
  WebPage `@id`, articleSection, `about` as Person nodes with profile URLs,
  url. FAQPage from `faqPageJsonLd` (components/tool-explainer.tsx:91-101:
  Question with name and acceptedAnswer Answer text). BreadcrumbList of
  three ListItems with position, name and item. No isBasedOn, citation or
  contributor. Valid.
- Editions listing (app/brief/editions/page.tsx:79-106): CollectionPage
  with name, description, url, inLanguage and `mainEntity` ItemList of
  ListItems with position, name and url; BreadcrumbList of three. Valid;
  with zero editions the ItemList is empty, and the page is noindex then.
- The Person `@id` is one entity across the root layout's Organization
  founder, the author page (app/author/michael/page.tsx:68-83, which
  spreads `personAuthorJsonLd()`), every guide (the diff replaces each
  inline Person with `authorJsonLd()`) and the edition. The guides' own
  `publisher` nodes still lack the `@id` the edition's carry; harmless and
  outside this build.

Internal linking: `/brief/editions` is reachable from the hub masthead once
an edition exists and from every edition page (components/brief-desk/edition-page.tsx:180-186).
An edition is reachable from the hub's Latest Brief panel, the homepage
block, the listing, and from each Relay card it covered
(components/relays/relay-card.tsx:195). The hub is in the nav and the
footer. Every indexable page in the build has an indexable parent.

OG images: the edition branch of app/api/og/brief/[slug]/route.tsx is brand
only (`#0F0F1A` to `#07070D`, purple to cyan, the wordmark, "ffbeacon.com",
"By Michael Walsh, founder of FF Beacon"); no gold, no `#0c0c18`. The three
sizes served (:16-20) equal the three the page declares (:44-51). A
non-published article gets a 404 image with no cache header (:284-306).

The legacy redirect (plan 14.2): lookupLegacyArticleRedirect validates both
the input and the stored slug against `^[a-z0-9-]{1,120}$` (lib/relays/legacy-redirect.ts:15,
:24, :31), so no off-site target is possible; the redirect is a 308; the
target is noindex, follow. The 64 archived slugs with no row 404, as the
first pass's m3 expected. The 42 with a hidden target are M2 above.

Sitemap rules (lib/sitemap/sections.ts): every URL listed is indexable
(core statics, the hub, the editions listing when non-empty, guides,
format boards, editions, ranked player profiles, live public profiles);
every lastModified is derived from a row or omitted; the four filter
families, Relays and legacy articles are absent; the index omits the
articles file while it would be empty.

Time display: every date on the new surfaces goes through lib/datetime.ts
(`formatEasternDate`, `formatEastern`, `formatEasternShortDate`,
`formatRfc822Eastern`); no bare `toLocale*` or `Intl.DateTimeFormat` was
found in the new trees.

Punctuation: every user-facing string read in this pass is plain ASCII. The
validator's banned-character table (lib/brief-desk/validate-draft.ts:54-63)
holds the literal characters it bans, which the file's own comment says
should be escapes; the check still works, and it is a code-hygiene note for
the Brief Desk pass rather than an SEO finding.

The llms files carry no sentence about the desk's method, the model, the
research log or the review process (lib/llms/context.ts:118-131, :145-149,
:155; llms-full-txt.ts:269-270; llms-txt.ts:174-202 read in full).

## Resolutions, 2026-09-17

The reviewer was cut off by the session limit after writing the report above
and before handing back; the report is complete and was applied from disk.

- M1: not a code change. Recorded in handoff.md as a deploy-order step: after
  this tree deploys, re-run backfill:relays and archive:legacy-articles for
  the posts accepted since the cut-over and confirm no non-brief article is
  published.
- M2: fixed. lookupLegacyArticleRedirect returns null unless the target Relay
  is published, so an archived slug answers 404 in one hop rather than 308
  to a 404, and a later publish of the Relay brings the redirect alive.
- M3: fixed. The hub spreads the robots key in only when the page is
  noindex; the editions page carries the preview permissions on the basic
  object too.
- m1: left, owner's call on the "the desk accepted" wording.
- m2: fixed (pageShareMetadata on the editions listing).
- m3: fixed (the two config redirects whose target is a 404 now point at the
  hub; the two-hop chains are left as the report allows).
- m4: fixed (the llms files name the listing and the count only once an
  edition exists).
- m5: fixed (the playoff title pattern is 58 characters).
- m6: fixed (managingEditor removed from the Briefs feed).
- m7: fixed (the author page comment).
- The gap noted under M5: fixed. BRIEF_SELECT projects the phase and the
  editions listing labels a pre-season edition as one.
