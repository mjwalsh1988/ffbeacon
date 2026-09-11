# FF Beacon SEO and answer-engine audit, and the plan to grow organic traffic

Status: STEP 1 (QUICK FIXES) AND THE FIVE OWNER DECISIONS BUILT 2026-09-11, NOT
YET COMMITTED OR DEPLOYED. Everything else from Part 7 Phase 2 onward is still
plan only. Written 2026-09-11. What was built, how it differs from Part 6, and
what the reviews found is in Part 0 (step 1) and Part 0b (the decisions); where
those two parts and the item text in Part 6 disagree, Part 0 and 0b are the
record. Continue at Part 7, Phase 2, which starts with the step 1 leftovers.

Goal, in the owner's words: keep maximising organic traffic. That means more
people arriving from Google, Bing, and the AI answer engines (Google AI
Overviews and AI Mode, ChatGPT search, Copilot, Perplexity, Claude).

How this was made:

- Search Console data for `sc-domain:ffbeacon.com`, pulled 2026-09-11 through
  the GSC connector: 90 days (2026-06-13 to 2026-09-11) by query, page, date,
  device and country, a period comparison, the sitemap report, and URL
  inspection of 16 URLs.
- Six read-only review passes: current SEO and AEO practice (web research,
  every claim sourced and dated, Part 11), crawl and index controls, metadata
  and structured data, content and internal linking, rendering and Core Web
  Vitals, and the live site fetched with curl as Googlebot, Bingbot and Chrome.
- Every file and line below was checked on 2026-09-11. Line numbers drift;
  treat them as where to look, not as a contract.
- It builds on docs/completed/seo/who-should-i-start-and-site-seo-plan.md,
  which shipped in 8ae3504 and bb7f9ef on 2026-09-10 and 2026-09-11. Nothing
  that plan fixed is reported again here. Its unbuilt section 4.5 (the content
  pages) is carried into Part 6D.

Conventions this document follows because the codebase does: plain ASCII
punctuation in every string (no em dashes, curly quotes or ellipsis
characters), every visible timestamp through lib/datetime.ts, every page that
shows player data keeps the source and format resolver chain, and one shell
command per tool call.

## Contents

0. Build record: step 1, Quick fixes (2026-09-11)
1. The short version
2. Where organic traffic stands today
3. Yesterday's SEO work: what it will do, and when
4. What changed in search this year, and what it means here
5. Decisions only the owner can make
6. Findings and fixes
   - 6A Crawling, rendering and indexing
   - 6B Titles, snippets and headings
   - 6C Trust: the Beacon Brief, authorship and accuracy
   - 6D Content that earns new searches
   - 6E Speed and page experience
   - 6F Structured data
   - 6G Bing, answer engines and off-site signals
7. Build order
8. Measurement and checkpoints
9. Task list
10. Implementation rules
11. Sources

## 0. Build record: step 1, Quick fixes (2026-09-11)

Scope. Step 1 was the "Quick fixes" list on the owner's explainer page, and
only that list: A03, A04, A02, B03 (the title), the first bullet of B06, C03,
and C01 (the disclosure line and author markup). The original Part 7 Phase 1
also named B04, B05, the rest of B06, A09, C04 and several owner actions;
those were not in the quick-fix list and are now the first block of Phase 2.

Owner decision 1 was made on 2026-09-11: credit Brief articles to FF Beacon,
with Michael as editor, and keep autopublish on.

Nothing is live. The work is in the working tree, not committed and not
deployed, by instruction. It takes effect on the site at the next deploy, and
Part 3's settling clock for these changes starts then, not on 2026-09-11.

What was built, item by item:

- A03, a missing Brief article is a real 404. app/brief/page.tsx,
  app/brief/loading.tsx and the category, team, tag and player folders moved
  with `git mv` into the route group app/brief/(feed)/. app/brief/[slug] stays
  outside it, so its notFound() is no longer softened by a loading boundary.
  URLs are unchanged. The loading file's comment, which claimed articles
  render statically, was corrected.
- A04, `?format=` on rankings URLs. New lib/rankings-format-redirect.ts, called
  from middleware.ts before the session refresh, answers /rankings?format=X and
  /rankings/Y?format=X with a 308 to /rankings/X, every other parameter kept in
  order. The in-page redirect() in app/rankings/[format]/page.tsx was removed.
  Tests: lib/rankings-format-redirect.test.ts.
- A02, metadata in the head for crawlers. New lib/seo/html-limited-bots.ts
  (Next's default list verbatim, plus Googlebot, OAI-SearchBot, ChatGPT-User,
  Claude-SearchBot, Claude-User, PerplexityBot, Perplexity-User, DuckAssistBot,
  GPTBot, ClaudeBot and CCBot), set as `htmlLimitedBots` in next.config.ts.
  Tests: lib/seo/html-limited-bots.test.ts, which also fails if a Next upgrade
  changes the default list.
- B03, home title. app/page.tsx: "FF Beacon: Free Fantasy Football Rankings,
  Tools and News" (57 characters, absolute). The H1 keeps the slogan.
- B06 first bullet, large image previews. app/layout.tsx root metadata sets
  `robots: { "max-image-preview": "large", "max-snippet": -1,
  "max-video-preview": -1 }`.
- C01, steps 1 and 2. app/brief/[slug]/page.tsx: the byline reads "By FF
  Beacon", and a second line reads "This story was written by FF Beacon's
  automated news desk. Michael built the desk and oversees it." with Michael
  linked to the author page (no rel="author"). NewsArticle `author` is the
  Organization, `editor` is Michael; og article:author is "FF Beacon". Both
  lines use text-ink-muted, brighter than the old byline.
- C03, the llms text. lib/llms/context.ts, lib/llms/llms-full-txt.ts and
  lib/llms/llms-txt.ts now say Brief articles are drafted by the automated
  desk from public reporting and published under the FF Beacon byline with a
  note saying so, that Michael built and oversees the desk, that he writes the
  guides, that an original reporter should be credited only where an article
  names one, and that BEAM is available on desktop only.

Where the build differs from Part 6, and why:

- B06 sets NO index and NO follow, and puts the preview directives on the
  general robots tag, not googleBot only. Both reviewers found that an explicit
  "index, follow" at the root sat beside Next's own "noindex" on every
  not-found branch that returns only a title (Brief category, team and player
  archives, rankings formats, league pages). Google applies the stricter rule,
  but not every parser does, and Google says listing index and follow has no
  effect. Bing honours max-image-preview and max-snippet too, hence the
  general tag. The B06 code sample below has been updated to match.
- B06 also needed components/signal/profile-view.tsx changed: it returned
  `robots: undefined` for a live profile, and a present-but-undefined key
  replaces the root default with nothing. It now omits the key.
- A04 checks the slug's SHAPE (lowercase letters, digits, single hyphens, at
  most 64 characters) rather than a static list of formats, and lowercases the
  value first. A static list drifts: a format added in the database but not to
  the list would have its dropdown choice silently dropped on the hub. The cost
  is that a well-formed slug that is not a format now gets a 308 to the format
  page's "not found" screen (still a 200 there until A01; see A03). On
  2026-09-11 all 13 format_configs rows are active and no migration has ever
  deleted, renamed or deactivated one, so no old link can hit that. If a format
  is ever retired, add its slug to lib/rankings-format-redirect.ts as a value to
  drop.
- A02 step 3 (share the player metadata read) was not needed. The metadata read
  is a single indexed lookup that starts alongside the page's own load; sharing
  it would save one query but no first-byte time. The two Brief metadata reads
  cannot run in parallel, because the index check needs the article's player
  list first.
- A02 fixes the METADATA order and not the BODY order. Measured on a local
  production build: Googlebot now gets the title at byte 1,886 with `</head>`
  at 4,818 on /rankings/dynasty-ppr-sflex (Chrome still gets it at about
  34,000), but on routes with a loading.tsx the loading line still comes first
  and the H1 arrives later in the same response, in a hidden block a script
  moves into place. Crawlers that run no JavaScript still see the loading line
  first on those routes. A01 fixes that. A matched crawler's first byte waits
  for generateMetadata: 0.25 s against 0.03 s for Chrome on a rankings page.
- B03 changed the title only. The answer-first hero sentence from B03 is open
  (Phase 2). og:title and twitter:title use the new title too; the share image
  artwork is unchanged.
- C01 is two lines rather than one. The first build read "By FF Beacon's
  automated news desk"; the SEO review pointed out that Google's guidance on
  AI-generated content prefers an accurate byline plus a separate note on how
  the page was made over giving the automation a byline, and the owner's choice
  was worded as a byline plus a line under it. `editor` is valid schema.org but
  Google does not use it, and with autopublish on Michael does not edit each
  article; it is kept because the owner chose it. C01 steps 3 to 5 (the "How
  the Beacon Brief is written" section the line should link to, a source credit
  rendered from data, a corrections note) are open (Phase 2).

Verification, all on 2026-09-11:

- `npx tsc --noEmit`: zero errors.
- `npx vitest run`: 333 files, 5,053 tests, all passing (the two new test
  files included).
- `npm run build`: succeeds. The Brief listing pages and archives resolve at
  their unchanged URLs from the (feed) group.
- A local production server, fetched with curl as Googlebot and as Chrome:
  - /brief/zzz-not-a-real-article-xyz answers 404; /brief and /brief/team/BUF
    answer 200.
  - /rankings?format=dynasty-ppr-sflex&source=ktc answers 308 to
    /rankings/dynasty-ppr-sflex?source=ktc;
    /rankings/redraft-ppr-std?format=dynasty-ppr-sflex&position=QB answers 308
    to /rankings/dynasty-ppr-sflex?position=QB; an uppercase format answers 308
    to the lowercase path.
  - Googlebot gets the title and canonical inside the head; Chrome still
    streams them.
  - /about carries `robots: max-video-preview:-1, max-image-preview:large,
    max-snippet:-1` and nothing else; a not-found category page carries that
    plus Next's `noindex`, with no contradicting `index`; /join keeps only
    `noindex, follow`; a live Signal profile now carries the preview directives.
  - The home title is the new one; the article shows both byline lines and
    the Organization author and Person editor; /llms.txt and /llms-full.txt
    carry the new wording.
- Every changed file scanned for non-ASCII characters: none.

Reviews. Two independent review agents read the finished work.

- Implementation review: no high or medium findings; all seven items judged
  correct. Nine low findings. Fixed: the contradicting robots tags (the B06
  change above), the Signal profile `robots: undefined`, two stale comments in
  app/brief/(feed)/loading.tsx, a comment that overstated the order of the
  format toggle's save, the BEAM wording ("desktop only"), byline contrast, a
  note on the rankings hub's now-unused `format` read, and progress.md entries.
  Recorded rather than changed: the shape-check deviation (above).
- SEO review: one medium finding, the body order (above), recorded and left
  for A01 because removing loading screens from indexable routes was not a
  quick fix. Fixed: the robots conflict, the two-line byline, uppercase format
  values, the overstated comment in lib/seo/html-limited-bots.ts, and stale
  comments on app/page.tsx and app/author/michael/page.tsx. Recorded: the RSS
  `managingEditor` element (now in A09), optional extra crawlers for the bot
  list (Amazonbot, meta-externalagent, meta-externalfetcher, MistralAI-User),
  and a two-hop path for /rankings/?format=X (Next's trailing-slash redirect
  runs before middleware; harmless and rare).

After the deploy:

- curl -s -o /dev/null -w "%{http_code}" https://ffbeacon.com/brief/zzz-not-a-real-article-xyz
  must print 404.
- curl -sI "https://ffbeacon.com/rankings?format=dynasty-ppr-sflex" must show a
  308 to /rankings/dynasty-ppr-sflex.
- Fetch /rankings/redraft-ppr-std with the Googlebot user agent and confirm the
  title sits before `</head>`.
- Request indexing in Search Console for the home page and one Brief article.

## 0b. Build record: the five owner decisions (2026-09-11)

The owner answered decisions 1 to 5 of Part 5 on 2026-09-11 and asked for them
built on top of step 1. Not committed or deployed, by instruction.

What was built:

- Decision 1, Brief attribution (C01). The NewsArticle `author` stays the
  Organization; the `editor` property is removed (Google does not use it, and
  with autopublish on nobody edits each article). The visible byline and the
  disclosure line are unchanged. Files: app/brief/[slug]/page.tsx, plus
  comments in app/page.tsx and app/author/michael/page.tsx.
- Decision 2, the /rankings hub (D04). app/rankings/page.tsx no longer renders
  a board. It shows the format directory, a "Which format is my league?"
  section (plain definitions of redraft, dynasty, best ball, superflex, PPR and
  TE premium) and links to the methodology and glossary guides. A reader whose
  format resolves from their account or the format cookie (resolveFormatSlug
  origin db or cookie, and the format still active) gets a 307 to
  /rankings/{slug}, carrying source and position. Crawlers and first-time
  visitors carry neither, so they get the hub. `?view=formats`
  (lib/rankings-hub.ts) shows the hub to anyone; the breadcrumb's Rankings
  crumb uses it (lib/breadcrumbs.ts) while the breadcrumb JSON-LD keeps the
  bare /rankings; the ?format= redirect drops the flag when it moves a reader
  onto a board. The format route and its loading.tsx moved with `git mv` into
  app/rankings/(board)/, so the hub has no loading boundary and its redirect is
  a real 307. The hub is about 108 KB against the old 1.6 MB, so A06 now
  concerns the format pages only.
  - Differs from D04 as written: no "top 24 of the default format" preview,
    because the owner asked for a hub to click into a format.
  - The title and H1 stay frozen until 2026-09-25. The description was changed
    as an exception, because the old one promised a player list the page no
    longer has: "Fantasy football rankings for every format: redraft, dynasty,
    superflex, TE premium and best ball. Pick yours to see every player
    ranked, updated daily."
  - The sitemap entry for /rankings no longer carries the nightly rankings
    date, and the nightly IndexNow ping no longer includes /rankings, because
    the hub's content does not change nightly.
  - Links that promised "the rankings board" (BEAM answers, the terms guide)
    now say "the rankings". The site-wide "Rankings Board" menu label was left
    alone as a naming decision for the owner.
- Decision 3, Signal profiles (A09). They stay indexed, and the profiles
  sitemap already adds every live profile automatically. Boards are indexable
  and reached through their owner's profile; the comment in
  lib/sitemap/sections.ts that said otherwise was corrected. No behaviour
  changed.
- Decision 4, AI training (G03). app/robots.ts keeps one wildcard group on
  purpose: a crawler with its own group ignores the wildcard, so a named group
  would have to repeat every disallow line. The decision is recorded in its
  comment, and the ignored `Host` line was removed. Owner action still open:
  check Vercel's Firewall and Bot Protection settings.
- Decision 5, preferred sources (G05). Google's documented deeplink,
  https://www.google.com/preferences/source?q=ffbeacon.com
  (lib/preferred-source.ts), rendered as a plain link with one explanatory
  sentence by components/beacon-brief/preferred-source-link.tsx, at the end of
  every Brief article and every Brief listing page. Chosen over Google's
  publisher.js button: no third-party script, nothing for the CSP to allow, no
  layout shift, and a real link a screen reader announces by its own words.

Verification, 2026-09-11: `npx tsc --noEmit` zero errors; `npx vitest run` 335
files and 5,062 tests passing (new: lib/rankings-hub.test.ts,
lib/preferred-source.test.ts, one more redirect test); `npm run build`
succeeds. On a local production server: /rankings 200 with the hub; with the
format cookie, a 307 to that board with ?source= kept; ?view=formats shows the
hub marked "(your format)"; an unknown cookie slug stays on the hub; the format
page breadcrumb links to /rankings?view=formats while its JSON-LD names
/rankings; the article and /brief carry the Google link; the article JSON-LD has
no `editor`; robots.txt has no Host line; the new hub description is served.
Every changed file is plain ASCII.

Reviews. The same two independent reviewers read the work.

- Implementation review: all five decisions correct. Fixed: the links that
  promised a board, a byline comment that still named an editor, six comments
  that named the old rankings paths, the view flag following the reader onto a
  board. Left by design: the hub has no Discord call-to-action (every board
  still has one); a click on Rankings gives no loading screen while the server
  decides where to send the reader (the cost of a real 307). For the owner:
  the in-page guide for the rankings page is database content edited at
  /admin/signal-guide; check it describes the hub.
- SEO review: all five decisions correct against Google's and Bing's
  documentation; no cloaking concern, because the redirect depends on a cookie,
  never on the user agent. Fixed: the stale hub description, the llms text
  that still called /rankings a board, the nightly lastmod and IndexNow ping.
  Recorded: A01 must keep the format cookie in its personal-cookie list (added
  to A01's checklist), or move the cookie half of the hub redirect into
  middleware first. Left: the breadcrumb links to /rankings?view=formats, a
  non-canonical URL that the canonical and the JSON-LD already fold into
  /rankings; a one-line description under each format link would strengthen
  the hub (optional, not built).

## 1. The short version

- Google is warming to the site. Daily impressions rose from about 20 in early
  August to 550 to 660 a day in September, and the average position improved
  from about 40 to about 12 over the same stretch (Part 2).
- Most clicks still come from people who already know the name: 76 of 235
  clicks in 90 days were searches for "ffbeacon", "ff beacon" or "fantasy
  beacon". The FAAB calculator is the one page winning strangers at scale
  (position 8.6, 8.4 percent click-through on "faab calculator").
- The rankings pages already sit on page one (positions 8.6 to 14) and are
  rarely clicked (about 1.3 percent on the dynasty boards). That is a title and
  snippet problem, and the cheapest traffic on the table once yesterday's
  changes have been recrawled.
- The largest technical problem is that every public page, the Brief articles
  included, is rendered from scratch on every request because the site header
  reads cookies (A01). Googlebot carries no cookies, so every crawl is a full
  server render with `Cache-Control: private, no-store`. That also causes the
  metadata streaming (A02) and the soft 404 (A03). The fix keeps every
  preference working.
- The largest trust problem is that Brief articles are drafted by a model,
  published automatically, and bylined to a person with no disclosure (C01).
  Google's guidance on AI content and the February 2026 Discover update both
  bear on exactly that. (Fixed in step 1, Part 0.)
- The largest content opportunity is in-season, weekly search: waiver wire,
  start/sit, FAAB bids, points allowed by position. The season is under way
  (Week 2), so that content comes before the spring work (rookie rankings).

## 2. Where organic traffic stands today

All figures are Google web search, 2026-06-13 to 2026-09-11, pulled
2026-09-11. First impression on record: 2026-07-03. This is the baseline from
BEFORE the 2026-09-10/11 changes took effect (Part 3).

Totals: 235 clicks, 11,457 impressions, 2.05 percent click-through, average
position 26.0.

Trend, by day:

- 2026-07-03 to 2026-08-19: 0 to 49 impressions a day, positions 15 to 40.
- 2026-08-20 to 2026-08-31: 108 to 1,164 a day (peak 2026-08-30), positions
  30 to 45. This is Google testing the site on more queries.
- 2026-09-01 to 2026-09-10: 296 to 802 a day, average position improving from
  21.1 to 10.4 to 13.1. Clicks 5 to 16 a day.

Brand share: "ffbeacon" 39 clicks from 42 impressions, "ff beacon" 34 from 38,
"fantasy beacon" 3 from 6. That is 76 of 235 clicks, 32 percent. The home page
took 137 clicks, most of them branded.

Pages, by clicks and impressions (90 days, per-page figures):

| Page | Clicks | Impressions | CTR | Avg position |
| --- | --- | --- | --- | --- |
| / | 137 | 284 | 48.2% | 13.5 |
| /tools/faab | 36 | 484 | 7.4% | 8.7 |
| /rankings/redraft-ppr-tep | 10 | 69 | 14.5% | 9.9 |
| /rankings/dynasty-ppr-sflex | 5 | 299 | 1.7% | 10.7 |
| /rankings/redraft-ppr-sflex | 5 | 128 | 3.9% | 11.0 |
| /rankings/redraft-ppr-std | 5 | 79 | 6.3% | 21.9 |
| /rankings/bestball-ppr-sflex | 4 | 104 | 3.8% | 10.5 |
| /rankings/dynasty-ppr-tep-sflex | 4 | 341 | 1.2% | 8.6 |
| /tools/league-pulse | 4 | 43 | 9.3% | 13.0 |
| /rankings/dynasty-ppr-std | 1 | 143 | 0.7% | 14.1 |
| /tools/on-the-clock | 1 | 133 | 0.8% | 5.8 |
| /tools | 1 | 90 | 1.1% | 14.4 |
| /about | 0 | 42 | 0% | 2.0 |
| /author/michael | 0 | 33 | 0% | 5.9 |

Page families (filtered by URL; Search Console aggregates these by site, so
they undercount against a sum of the per-page rows. Treat them as lower
bounds):

- /players/: at least 1,705 impressions, 4 clicks. Desktop position 52.1,
  mobile 21.2.
- /brief/: at least 562 impressions, 1 click. Desktop position 54.5, mobile
  21.3.
- /tools: at least 462 impressions, 25 clicks. Mobile position 6.1.

What the queries say:

- FAAB is the one non-brand cluster the site wins: "faab calculator" 16 clicks
  from 190 impressions at 8.6, "faab calculator fantasy football" 3 from 40,
  "faab fantasy football calculator" 2 from 30, "fantasy football faab
  calculator" 1 from 9. It is sitting at the bottom of page one.
- Rankings: most rankings impressions come from queries too rare for Search
  Console to name (the page reported 299 impressions, the named queries 15).
  The named ones are format phrases at positions 20 to 50: "dynasty superflex
  rankings" at 50, "superflex te premium rankings" at 20.3, "redraft superflex
  rankings" at 7.1 (1 click from 9), "ff rankings" at 54.2 on /rankings.
- Players: long-tail name queries at positions 40 to 90, and a cluster of
  "{player} net worth" queries at about position 10 (Blake Grupe, 19
  impressions, position 9.5). Google treats the profiles as person pages. Those
  are not our searchers and nothing should chase them.
- Brief: queries are mostly off-topic for a fantasy site: "browns starting
  center", "texans trade today", "jets legacy uniforms", "atlanta falcons
  news". One click in 90 days.
- Trade and start/sit: before the slug change, "trade analyzer" showed
  /tools/signal-check 4 times at 25.2. No start/sit queries yet. Yesterday's
  work targets both (Part 3).
- Discover: no data at all. Google News tab: 13 impressions.
- Device: mobile averages position 11.0, desktop 24.9 (US).

Index and crawl state (URL inspection, 2026-09-11):

- Indexed: /, /rankings, /rankings/dynasty-ppr-sflex, /rankings/dynasty-ppr-tep-sflex,
  /tools/faab, /tools/who-should-i-start, /tools/trade-calculator,
  /guides/how-ff-beacon-works, /guides/fantasy-football-draft-guide,
  /author/michael, /brief, a Brief article, two player pages. Breadcrumbs
  detected on all but / and /rankings.
- Last crawled: /tools/faab 2026-08-20, /rankings 2026-08-18, the format pages
  2026-08-29, / 2026-09-02, players 2026-08-29 and 2026-09-04. The rankings
  data changes daily and Google visits every two to three weeks.
- The old slugs /tools/beacon-breakdown and /tools/signal-check are still
  indexed, last crawled 2026-08-19. Google has not yet seen their 308s.
- The new slugs and the methodology guide were crawled and indexed on
  2026-09-11.
- Sitemaps: an index plus core (74), players (812), articles (291) and
  profiles (3), all Valid, no errors. The live files hold 76, 812, 292 and 3.

## 3. Yesterday's SEO work: what it will do, and when

Shipped on 2026-09-10 and 2026-09-11: the start/sit tool on
/tools/who-should-i-start, the trade calculator on /tools/trade-calculator
with 308s from both old slugs, IndexNow, player tab titles and canonicals, the
rankings SEO copy, the methodology guide, Organization, WebSite and
WebApplication JSON-LD, noindex on league pages, and the rest of that plan's
21 audit items.

Google has not processed most of it. The new slugs were indexed today; the old
ones have not been recrawled since 2026-08-19; the rankings and player pages
were last crawled before the copy changed. Expect:

- One to four weeks for Google to recrawl the old URLs, follow the 308s and
  move their signals to the new ones. The old URLs can show in reports for a
  while after that.
- Title and snippet changes show in results only after each page is
  recrawled, then take a week or two to settle.
- No meaningful read on start/sit or the trade calculator before 2026-09-25,
  and a fair read around 2026-10-09.

The rule that follows, and every part of this plan keeps it: DO NOT CHANGE A
TITLE, H1 OR META DESCRIPTION THAT CHANGED ON 2026-09-10 OR 2026-09-11 BEFORE
THE 2026-09-25 CHECKPOINT. The player titles changed in 8ae3504 and the
rankings copy in bb7f9ef. Changing them again before Google has seen the first
version makes it impossible to tell which change did what, and resets the
settling period. The home title (last changed 2026-08-20) is not covered by
this freeze; it was changed in step 1 (Part 0).

Post-deploy steps from the previous plan that may still be open (handoff.md;
the repo cannot show whether they were done): curl the three 308s, open
/tools/who-should-i-start logged out and check view-source, run the Rich
Results test, `npm run indexnow` for the new URLs, request indexing in Search
Console, resubmit the sitemap. Do these first if they have not been done.

## 4. What changed in search this year, and what it means here

The research pass is summarised here; sources and dates are in Part 11.
"Official" means the engine documents it; "industry" means it was observed and
not confirmed.

- Core updates in March, June and December 2025 and March and May 2026; spam
  updates in August 2025, March, June and August 2026 (official). Since
  December 2025 Google says smaller core updates run continuously without
  announcement (official). A drop outside a dashboard window is no longer
  proof that nothing algorithmic happened.
- The February 2026 Discover core update favoured in-depth, original, timely
  work from sites with topic expertise and pushed down sensational content
  (official). The Brief is the surface this judges.
- AI Overviews and AI Mode have no extra requirements: a page must be indexed
  and eligible for a snippet (official, updated 2025-12-10). Google's AI
  optimisation guide (2026-05-15, updated 2026-07-10) says optimising for
  generative AI "is still SEO" and rules out llms.txt, Markdown copies of
  pages, and special schema (official).
- Search Console's generative AI performance report (impressions for AI
  Overviews, AI Mode and Discover AI, by page) reached every site on
  2026-08-31 (official). Bing Webmaster Tools' AI Performance report names the
  pages Copilot cited and the grounding queries (official, February and June
  2026). These are the two reports that measure AEO.
- FAQ rich results ended for every site on 2026-05-07 (official). FAQPage
  markup is still valid and still read by Bing, but earns nothing in Google.
  Dataset markup feeds only Dataset Search (official, November 2025).
- Google accepts rel=canonical only in the head (official, updated
  2026-07-10). It honours robots meta tags wherever they sit (official,
  2026-03-24). This makes A02 matter.
- Googlebot reads the first 2 MB of uncompressed HTML (official, documented
  2026-02-03). The rankings pages are 1.6 MB (A06).
- Scaled content abuse explicitly includes using generative AI to make many
  pages without adding value (official, updated 2026-08-28). Google permits AI
  content that meets Search Essentials and asks sites to tell readers how it
  was made (official). Case studies of the August 2026 spam update found
  penalised sites combined programmatic pages with AI-written filler
  (industry).
- Core Web Vitals thresholds are unchanged (LCP 2.5 s, INP 200 ms, CLS 0.1);
  Google calls them one signal among many (official). Chrome 151 measures
  soft navigations by default, which will give client-side page changes their
  own LCP and INP (official, 2026-09-02).
- IndexNow feeds Bing, Yandex, Naver, Seznam, Yep and Amazon, not Google
  (official). Bing recommends it specifically so AI answers cite the current
  version of a page (official).
- Brand mentions correlate with AI visibility more than referring domains do
  (industry, Ahrefs, 75,000 brands, correlation only).
- llms.txt: Google does not use it (official); an Ahrefs study of 137,000
  sites found 97 percent of llms.txt files got zero requests in May 2026
  (industry). Keep ours accurate and small; do not invest in it.

## 5. Decisions only the owner can make

The owner answered decisions 1 to 5 on 2026-09-11 and all five are built (Part
0b). Decision 6 keeps its recommendation.

1. The Brief byline (C01). DECIDED: credit FF Beacon as author and keep
   autopublish on. A second answer the same day removed the `editor` property,
   because Google does not use it. The visible byline and the disclosure line
   stay.
2. /rankings (D04). DECIDED: a hub for choosing a format, except that a reader
   with a saved format (account or cookie) lands straight on that format's
   board.
3. Public Signal profiles (A09). DECIDED: keep them indexed, against the
   earlier recommendation. There are only a few, they will gain content, and
   the profiles sitemap already adds every live profile automatically, so
   nobody has to remember to index them later.
4. AI training crawlers (G03). DECIDED: allow them, as recommended.
5. Google's preferred sources button on the Brief (G05). DECIDED: add it, as
   recommended.
6. Order of the new content (Part 7). Recommendation: in-season pages first
   (waiver wire, start/sit articles, FAAB guide, points allowed), then the
   trade value chart and position pages, then rookie rankings before the
   spring.

## 6. Findings and fixes

Each finding says what is wrong (with evidence), why it matters for Google,
Bing and the answer engines, how to fix it, and how to verify the fix.
Severity is critical, high, medium or low. Effort is S (under a day), M (one
to three days) or L (a week or more). Items built in step 1 carry a Status
line; everything else is still to do.

### 6A. Crawling, rendering and indexing

#### A01. Every public page renders on every request

Severity: critical. Effort: L.

What is wrong:

- components/site-header.tsx:47 awaits `cookies()`, and `SiteHeader` renders
  on every route from app/layout.tsx:165. Three more pieces of the shared
  chrome read the request: `AppRailSections`
  (components/app-shell/app-rail-sections.tsx:18), the bookmark slots, and
  `isHandheldRequest` (lib/device.ts:38, `headers()`). The code says so
  itself: site-header.tsx:66-73 ("does not make any route static") and
  lib/device.ts:31-34.
- In Next 15 without Partial Prerendering, one dynamic read anywhere in the
  tree makes the whole route dynamic. So `revalidate = 300` and
  `generateStaticParams` on app/brief/[slug]/page.tsx:45-56 do nothing, even
  though that file (lines 31-44) describes the route as static.
- These routes also set `force-dynamic` explicitly: app/page.tsx:69,
  app/rankings/page.tsx:39, app/rankings/[format]/page.tsx:31,
  app/players/[slug]/page.tsx:30, app/[handle]/page.tsx:23,
  app/guides/fantasy-football-draft-guide/page.tsx:104 (PERF-T041 is marked
  done but this line is still there), app/guides/how-ff-beacon-works/page.tsx:116,
  and the trade calculator (:20), who-should-i-start (:106), faab (:43),
  league-pulse (:49) and on-the-clock (:49) pages, and both games.
- Live, 2026-09-11: every HTML response carries `Cache-Control: private,
  no-cache, no-store, max-age=0, must-revalidate`, `Age: 0` and
  `X-Vercel-Cache: MISS`, on repeat requests too. Time to first byte 0.19 to
  0.64 seconds, the player page up to 1.11 seconds.
- Note from the step 1 build: `next build` lists /brief/[slug] and
  /rankings/[format] as prerendered (they declare generateStaticParams), yet
  production served them uncached with no-store. Confirm which of the two is
  true per route at the start of this item; the fix below is the same either
  way.

Why it matters:

- Googlebot sends no cookies, so every crawl of every page is a full function
  run with database reads (the 2026-09-08 audit measured about 45 ms per read
  and 250 to 400 ms of server time for the home page). Google sets its crawl
  rate partly by how fast and how reliably a site answers (crawl budget
  documentation, updated 2026-07-22). A new site with slow answers gets
  crawled less often, and Part 2 shows exactly that: pages whose data changes
  daily are visited every two to three weeks. app/page.tsx:1088-1091 already
  records Brief articles stuck at "Discovered, currently not indexed".
- It is the cause of A02 (metadata streamed into the body, and the page body
  still streamed behind loading screens after step 1) and of the remaining
  soft 404s (A03).
- It costs every first-time visitor the same render time a crawler pays.

How to fix it: a static twin for each public page family, and a middleware
split that sends anonymous, parameter-free requests to the twin. This needs
neither Partial Prerendering nor a header rewrite.

1. Add a twin route per page family under a reserved segment, for example
   `app/static-render/rankings/[format]/page.tsx`. The segment cannot start
   with an underscore: `_folders` are private in the App Router and never
   route. Add `static-render` to the reserved names in
   scripts/check-reserved-routes.ts (it runs as `prebuild`, package.json:12)
   so no Signal handle at `/[handle]` can claim it.

   ```ts
   // app/static-render/rankings/[format]/page.tsx
   export const dynamic = "force-static";
   export const revalidate = 900;
   export const dynamicParams = false;
   export {
     default,
     generateMetadata,
     generateStaticParams,
   } from "@/app/rankings/[format]/page";
   ```

   With `force-static`, `cookies()`, `headers()` and `searchParams` return
   empty values for the whole route render, the root layout included. The
   header renders signed out, `resolveFormatSlug` and `resolveSourceSlug`
   fall through to `DEFAULT_FORMAT_SLUG` and the registry default, and
   `isDiscordMember` returns false. None of the header or page code changes.
   Re-exported segment config is not always picked up by Next's static
   analysis, so keep `dynamic`, `revalidate` and `dynamicParams` as literal
   exports in the twin file itself, as above.

2. In middleware.ts, before `updateSession` and after the step 1
   `rankingsFormatRedirect` call:

   ```ts
   // Personal state that changes what a page shows. Names from
   // lib/preferences.ts:37-38 and the Supabase SSR cookie (chunked as .0, .1).
   const PERSONAL_COOKIE =
     /^(sb-cilvpyivysjxpxbudkfa-auth-token(\.\d+)?|ffbeacon\.(format|source))$/;

   const TWIN_PATHS = [
     /^\/$/,
     /^\/rankings(\/[a-z0-9-]+)?$/,
     /^\/players\/[a-z0-9-]+$/,
     /^\/brief(\/[a-z0-9-]+)?$/,
     /^\/brief\/(category|team)\/[A-Za-z0-9-]+$/,
     /^\/guides(\/[a-z0-9-]+)?$/,
     /^\/(about|tools|games|donate|privacy|terms|author\/michael)$/,
     /^\/tools\/(trade-calculator|who-should-i-start|faab|league-pulse|on-the-clock)$/,
   ];

   const { pathname, search } = request.nextUrl;
   if (pathname.startsWith("/static-render")) {
     return new NextResponse(null, { status: 404 });
   }
   const personal = request.cookies
     .getAll()
     .some((c) => PERSONAL_COOKIE.test(c.name));
   if (!personal && search === "" && TWIN_PATHS.some((r) => r.test(pathname))) {
     const url = request.nextUrl.clone();
     url.pathname = `/static-render${pathname === "/" ? "" : pathname}`;
     return NextResponse.rewrite(url);
   }
   ```

   Verify the exact cookie names against lib/preferences.ts and the Supabase
   client before shipping; a wrong name would serve a signed-in reader the
   anonymous page.

3. Revalidation, per family:

   | Family | revalidate | On-demand invalidation |
   | --- | --- | --- |
   | Home | 300 | `revalidateTag("home")`, which the Brief worker already fires |
   | Brief article | 300 | tag the article read; fire it from the worker on publish, rewrite and archive |
   | Brief index, category, team | 300 | same Brief tag |
   | Rankings, both routes | 900 | the tag recalculate-derived already fires (lib/rankings-board.ts:314) |
   | Player profile | 3600 | `generateStaticParams` for the ranked set the sitemap uses; `dynamicParams` true |
   | Start/sit | 3600 | a tag fired from sync-weekly-projections, so the week label turns over |
   | Tool landing pages, guides, about, author, legal | 86400 | none needed |

   A `revalidateTag` on a tag used by an `unstable_cache` read invalidates the
   ISR page that used it. Confirm that in one test deploy.

How this keeps the Source and Format Sync rule (CLAUDE.md): a request with no
URL parameter and no preference cookie already resolves to the default format
and the registry default source. The twin serves exactly what the resolver
chain would have produced for that request. Readers with a cookie or a
parameter keep today's dynamic page, unchanged. The parameter variants
already canonicalise to the clean URL (app/rankings/[format]/page.tsx:80-82),
so the copy Google indexes is the static one.

Things to test before calling it done:

- An unknown slug on a twin must be a real 404: `dynamicParams = false` where
  the slug set is closed (rankings formats), and a `notFound()` on an ISR
  miss where it is open (players, articles).
- Signed-in readers must never receive a twin. Test with an auth cookie, a
  format cookie and a source cookie separately.
- A01 changes the header markup for anonymous readers only if the header
  today differs between "no cookie" and "signed out with an expired cookie";
  check both.
- The Discord call-to-action and bookmark bar must not flash for anyone.
- On a twin, Googlebot must get the H1 and the main content in document order
  with no loading line first (the part step 1 could not fix).
- The /rankings hub redirects a reader with a saved format (Part 0b). That only
  stays correct while every request carrying `ffbeacon.format` or a session
  cookie skips the twin, so `PERSONAL_COOKIE` must keep matching the format
  cookie. Alternatively, move the cookie half of that redirect into middleware,
  ahead of the twin rewrite, with `Cache-Control: private, no-store` on the 307,
  and leave only the account-saved half in the page.

Verify:

- `npm run build`: the twins show as static (circle or filled circle) and the
  originals stay dynamic (f).
- `curl -sI -A "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" https://ffbeacon.com/rankings/dynasty-ppr-sflex`
  twice: the second shows `x-vercel-cache: HIT` and a public cache-control.
- The title, canonical and robots tags sit inside `<head>` in the raw HTML.
- Time to first byte under 100 ms on a hit.

#### A02. Googlebot receives the title, canonical and robots tags inside the body

Severity: high (becomes low once A01 ships). Effort: S.

Status: DONE 2026-09-11 for the metadata (Part 0). Step 3 below was found
unnecessary. The page BODY still streams behind loading screens; A01 fixes
that.

What is wrong:

- Since Next 15.2, dynamic pages stream `generateMetadata` output into the
  body after the first flush, except for user agents that match
  `htmlLimitedBots`. next.config.ts set none, so the default list applied
  (node_modules/next/dist/shared/lib/router/utils/html-bots.js). It matches
  Bingbot, Google-InspectionTool, Mediapartners-Google and Chrome-Lighthouse.
  It does not match `Googlebot/2.1`.
- Live, 2026-09-11, /rankings/redraft-ppr-std as Googlebot: `</head>` at byte
  3,737, the title at byte 35,003. As Bingbot: title at byte 2,593, inside the
  head. The same holds on the rankings, trade calculator, start/sit, Brief,
  article, League Pulse, team and author pages. Only home, about, the player
  profile and the user profile carry metadata in the head for Googlebot.
- On the streamed pages the H1 and the main content also sit in a streamed
  segment. The first visible text a non-rendering crawler sees is the loading
  line ("Loading the fantasy football rankings.").
- URL Inspection's live test in Search Console fetches as
  Google-InspectionTool, which IS on the list. What the owner sees in Search
  Console is therefore not what Googlebot receives.

Why it matters: Google accepts rel=canonical only in the head. Next.js says
Googlebot reads streamed metadata after rendering, because React moves the
tags into the head; that depends on rendering and is not documented by Google.
The site relies on canonicals for the `?source=`, `?position=`, `?tab=` and
`?page=` variants. AI crawlers that do not run JavaScript (GPTBot,
OAI-SearchBot, ClaudeBot, Claude-SearchBot, PerplexityBot) see the body
placement and the loading text too.

How to fix it:

1. A01 removes the problem for every clean URL: a prerendered page carries
   its metadata in the head and its content in the HTML.
2. For the dynamic remainder, set `htmlLimitedBots` in next.config.ts. It
   REPLACES the default list rather than extending it, so copy the default
   regex from html-bots.js at the installed Next version, and prepend the
   crawlers that matter here. Built as lib/seo/html-limited-bots.ts, with a
   test that matches real user agent strings and fails if the copied default
   drifts from Next's.
3. Make generateMetadata cheap, because matched bots wait for it before the
   first byte. Checked in step 1 and not needed: the player metadata read
   (app/players/[slug]/page.tsx:91-96) is one indexed lookup that runs
   alongside the page's own load, and the two Brief reads are dependent (the
   index check needs the article's players). Revisit only if Crawl Stats shows
   response time rising after the deploy.

Verify: fetch a dynamic variant (for example `?source=fantasycalc`) as
Googlebot and confirm the title's byte offset is below `</head>`. Done
locally in step 1.

#### A03. A missing or removed Brief article answers 200

Severity: medium. Effort: S.

Status: DONE 2026-09-11 for Brief articles (Part 0). The rankings case below
waits for A01.

What is wrong: live, /brief/zzz-not-a-real-article-xyz returned HTTP 200 with
the title "Article not found | FF Beacon" and the noindex in the streamed
body. app/brief/loading.tsx opened a Suspense boundary, so the 200 was sent
before `notFound()` at app/brief/[slug]/page.tsx:172 ran. Articles are
archived routinely (lib/beacon-brief/deletion.ts:302-307), and 33 retired
slugs needed redirects on 2026-09-10. /rankings/not-a-format has the same
shape (accepted in app/rankings/loading.tsx:10-19), and so do the Brief
category, team and tag archives for a bad slug.

Why it matters: Google files these as soft 404s. It keeps recrawling them and
may not render non-200 pages, and its crawl guidance asks for a real 404 or
410 on removed pages. (Google treats every 4xx other than 429 the same, so a
410 is not worth the extra work.)

How it was fixed: the boundary moved into a route group so it covers only the
listing pages: app/brief/(feed)/ holds page.tsx, loading.tsx, category/,
team/, tag/ and player/; [slug]/ sits outside it. URLs did not change. A01
fixes the rankings case (`dynamicParams = false`); until then it is low.

Verify: `curl -s -o /dev/null -w "%{http_code}" https://ffbeacon.com/brief/zzz-not-a-real-article-xyz`
prints 404. Done locally in step 1; repeat after the deploy.

#### A04. `?format=` on the rankings pages sends mixed signals

Severity: medium. Effort: S.

Status: DONE 2026-09-11, with a shape check instead of a static list and the
value lowercased first (Part 0).

What is wrong:

- /rankings?format=dynasty-ppr-sflex rendered the superflex board with its
  canonical set to /rankings (app/rankings/page.tsx:26 and :53-57), which
  shows the default board. These are the legacy URLs the path migration of
  2026-07-29 replaced, and nothing redirected them.
- /rankings/redraft-ppr-std?format=dynasty-ppr-sflex returned 200 with
  `<meta http-equiv="refresh" content="1;url=/rankings/dynasty-ppr-sflex">`,
  a canonical still naming redraft-ppr-std, no H1 and 1,015 characters of
  text. The `redirect()` in app/rankings/[format]/page.tsx ran after
  app/rankings/loading.tsx had flushed.

Why it matters: a canonical pointing at different content is ignored, a
delayed meta refresh is read as a weak temporary redirect, and old links and
index entries never consolidate onto /rankings/{format}.

How it was fixed: lib/rankings-format-redirect.ts, called from middleware.ts
before `updateSession` (and before the future A01 rewrite). A 308 to
/rankings/X with `format` removed and every other parameter kept; a malformed
value is dropped and the reader stays put. The in-page `redirect()` was
deleted. The header toggle keeps its `router.push`
(components/format-toggle.tsx:105), and a shareable link still lands on the
chosen format, so the Source and Format Sync rule holds. Next strips its
internal `_rsc` parameter before middleware runs, so client navigations work.

Verify: both legacy shapes return 308 with the right Location and keep any
`position` and `source` parameters. Done locally in step 1.

#### A05. Player profiles left out of the sitemap can still be indexed

Severity: medium. Effort: M.

What is wrong: the players sitemap lists only players ranked inside the
relevance window (lib/sitemap/sections.ts:424-446, 812 URLs), and its comment
says that keeps about 10,000 retired and practice-squad rows out. But
app/players/[slug]/page.tsx:85-159 sets no robots directive, and every slug in
the players table renders 200. Those pages are reachable from Brief articles
and trade history.

Why it matters: a page whose only unique text is a name is the template
pattern the scaled-content policy describes. The sitemap and the page
disagree about which players deserve an index entry. Part 2 shows player
impressions landing on off-intent queries (height, weight, net worth) at
positions 40 to 90.

How to fix it:

1. Move the ranked-in-window test into one shared predicate,
   `isPlayerIndexable()` in a new lib/players/indexable.ts, used by both the
   sitemap section and `generateMetadata`.
2. When it is false, return `robots: { index: false, follow: true }`.
3. Pin it with a test, the same pattern as lib/beacon-brief/index-quality.ts.

Before shipping: export the /players/ pages with any clicks in the last 90
days from Search Console. If the predicate would noindex any of them, widen
it (for example, any player with a value row in the last 365 days) rather
than drop a page that earns visits.

Verify: an unranked player page carries noindex in its head; a ranked one
does not; the sitemap count is unchanged.

#### A06. The rankings HTML is 1.6 MB, near Googlebot's 2 MB limit

Severity: medium. Effort: M. Pairs with E01.

What is wrong: live, /rankings is 1,637,079 bytes and
/rankings/redraft-ppr-std 1,612,258 bytes. The board returns up to 500 rows
(lib/rankings-board.ts:136), all rendered inside a client component
(components/rankings-table.tsx:1). Each row renders its headshot and name
block twice, one for mobile and one for desktop, hidden by CSS
(rankings-table.tsx:339-389), and the row data appears again in the React
flight payload.

Why it matters: Googlebot reads the first 2 MB of uncompressed HTML and
ignores the rest. As more players get values, the bottom of the board and its
player links (the crawl path into the profiles) would be cut off without
anyone noticing. The same weight drives INP (E01).

How to fix it:

1. Render one headshot and one name block per row and switch the layout with
   CSS.
2. Send the client component only the fields it uses. Or render the rows on
   the server and keep a small client island for sorting.
3. Add a guard: a test or a script step that renders the largest format and
   fails above 1 MB.

Target: under 800 KB of HTML for the largest board, with all 500 player links
still in the HTML.

Verify: `curl -s -A Googlebot https://ffbeacon.com/rankings/dynasty-ppr-sflex -o page.html`
and check the file size.

#### A07. IndexNow misses removals and player pages, and fails silently

Severity: medium. Effort: S.

What is wrong: today it pings on article publish and rewrite
(lib/beacon-brief/worker.ts:957, :1649), on the weekly projection sync
(app/api/cron/sync-weekly-projections/route.ts:44-50) and on the derived
recalculation (app/api/cron/recalculate-derived/route.ts:72-78). The key file
public/be0374e062dc4aaf9603541eb303e58d.txt is live and valid. Gaps:

- Archiving an article (deletion.ts:302-307) sends nothing.
- The 812 player pages change daily and are never submitted.
- The worker pings thin, noindex articles too.
- lib/indexnow.ts:67-70 returns without a log line when `INDEXNOW_KEY` is
  missing, the same silent no-op shape as the Resend email helper.

Why it matters: Bing and Copilot keep a removed article until they recrawl
it, and never hear that the largest section of the site changed.

How to fix it:

- Call `submitIndexNow([`/brief/${slug}`, "/brief"])` after the archive
  update in `approveDeletion`.
- In recalculate-derived, add the ranked player URLs (812, under the 10,000
  per-request cap). Submit only players whose value actually moved, if that
  is cheap to know.
- Gate `pingIndexNowForArticle` on `isArticleIndexable`.
- Log one `console.warn` when the key is missing.

Verify: the Bing Webmaster Tools IndexNow panel shows the submissions (G01).

#### A08. Sitemap dates and error handling

Severity: low. Effort: S.

What is wrong:

- All 812 player URLs share one lastmod, 2026-09-11T10:00:46.267Z, taken from
  the batch generated_at (lib/sitemap/sections.ts:433-445). The 14 rankings
  URLs share it too, which is defensible because the whole board does change
  in that sync.
- `publishedArticles` ignores its error (sections.ts:162-170) and
  `rankedPlayerSlugs` returns a partial list on an error (241-244). The
  response is cached for an hour with a day of stale-while-revalidate
  (589-591), so one bad read can serve a truncated sitemap for a day.
- The sitemap index listed articles.xml with a lastmod older than an entry
  inside it (a cached copy, Age 6142).

Why it matters: Google uses lastmod only when it is consistently accurate. An
identical daily stamp on 812 pages teaches it to ignore the file's dates.

How to fix it:

- Per player lastmod: the latest `player_value_trends` update where that
  player's value changed. Omit it when none exists.
- Throw on a query error so the route fails and the last good cached copy
  keeps serving.
- Compute the index's child lastmod from the same query the child uses, or
  omit it.

#### A09. Smaller crawl and index items

Severity: low. Effort: S each.

- Out-of-range pagination: /brief?page=999 is a 200 empty page with a
  self-canonical (app/brief/(feed)/page.tsx, components/beacon-brief/brief-feed.tsx:168-176),
  and the category, team and tag pages share the shape. Return
  `robots: { index: false, follow: true }` when the page number exceeds the
  page count, reading the count through the same React `cache()` the page
  uses.
- /login and /my-beacon are disallowed in robots.txt (app/robots.ts:46-47) but
  carry no noindex, so a linked URL can show as "Indexed, though blocked by
  robots.txt". Add `robots: { index: false }` to the login metadata and the
  my-beacon layout, then remove the two disallow lines.
- No root not-found page. The only one is app/leagues/[league_id]/not-found.tsx;
  the real 404s serve Next's default body with no links and an `<html>`
  without `lang`. Add app/not-found.tsx, with no data fetching, linking to
  /rankings, /tools and /brief.
- www: http://www.ffbeacon.com goes 308 to https://www, then 301 to the apex,
  two hops. In Vercel's domain settings, point www straight at
  https://ffbeacon.com. (Owner action, no code.)
- /players/patrick-mahomes (no id) is a 404. People and AI engines guess this
  shape. Optionally 308 a bare name to the canonical slug when exactly one
  player matches.
- An `X-Robots-Tag: noindex, follow` header from middleware for /leagues/* and
  /tools/manager-pulse/*. Google honours the body tag they carry today;
  engines that do not render may not see it. Belt and braces.
- Start/sit parameter URLs (`?p=a,b` from app/tools/who-should-i-start/toughest-calls.tsx:78-80
  and the BEAM links) are crawlable, and each runs a full board and an OG
  render. The canonical handles indexing. Watch Crawl Stats; add
  `Disallow: /tools/who-should-i-start?p=` in app/robots.ts only if they draw
  noticeable crawl.
- Signal boards: lib/sitemap/sections.ts:48 says boards are noindex, but only
  the not-found branch is (components/signal/board-view.tsx:32). Make the
  comment and the code agree after owner decision 3.
- The /tools share card still says "compare two players"
  (app/api/og/page/[key]/route.tsx:88), a leftover from the previous plan.
- Player breadcrumb JSON-LD points at /rankings?position=QB
  (app/players/[slug]/page.tsx:239), a non-canonical URL. Point it at
  /rankings (see F01).
- Added in step 1: the RSS feed's `managingEditor` holds the bare name
  "Michael" (app/brief/rss.xml/route.ts:113). RSS 2.0 expects an email
  address there, so feed validators flag it. Use a published contact address
  with the name in brackets, or drop the element. Do not invent an address.
- Added in step 1, optional: Amazonbot, meta-externalagent,
  meta-externalfetcher and MistralAI-User could join the list in
  lib/seo/html-limited-bots.ts.

### 6B. Titles, snippets and headings

The freeze from Part 3 applies: B01, B02 and D12 wait until the 2026-09-25
checkpoint. B04, B05 and the rest of B06 can ship now.

#### B01. The rankings pages rank on page one and are rarely clicked

Severity: high. Effort: S. Not before 2026-09-25.

What is wrong: dynasty-ppr-tep-sflex had 341 impressions at 8.6 and 1.2
percent click-through; dynasty-ppr-sflex 299 at 10.7 and 1.7 percent;
dynasty-ppr-std 143 at 14.1 and 0.7 percent. Meanwhile redraft-ppr-tep had
14.5 percent. Page details:

- `rankingsSeoCopy` (lib/rankings-formats.ts:114-117) carries no season, date
  or count.
- The update date appears only in a stat tile, as plain text with no `<time>`
  element (components/rankings/rankings-view.tsx:207-213), and the player
  count further down (:298-302).
- The live H1 starts in lower case: "redraft 1QB PPR fantasy football
  rankings".

Why it matters: at positions 8 to 11 the title and snippet decide the click.
"2026" is a common modifier on rankings searches, and a dated, specific first
sentence is what AI answers quote.

How to fix it:

- Title: prefix the season when `${season} ${phrase} Rankings` fits in 48
  characters before the " | FF Beacon" template, for example "2026 Dynasty
  Superflex PPR Rankings | FF Beacon".
- H1: sentence case, starting with a capital.
- First sentence, rendered on the server with the date through
  `formatEasternDate` inside a `<time dateTime>` element: "FF Beacon's
  dynasty superflex PPR rankings, updated {date}: {n} players ranked by
  {source display name} value, with 7-day trends and tiers."
- Pass the last-updated time, the row count and the source display name into
  the intro; the source label comes from `source_registry.display_name`,
  never the slug.

Verify: two weeks after deploy, compare CTR per format page against Part 2.

#### B02. Player titles run past 60 characters and miss the words people search

Severity: medium. Effort: S. Not before 2026-09-25.

What is wrong: app/players/[slug]/page.tsx:114 builds "{name} Fantasy
Football Stats, Trade Value, News", and the template at app/layout.tsx:39 adds
" | FF Beacon". Live: "Patrick Mahomes Fantasy Football Stats, Trade Value,
News | FF Beacon". Every player is over 60 characters. The player queries in
Part 2 use "fantasy value", "trade value", "outlook" and "projection"; the
title has no "projections" although the description promises them.

How to fix it: an absolute title with a length ladder, and the same pattern
for the per-tab titles in TAB_METADATA (lines 53-72):

```ts
const SUFFIX = " | FF Beacon";
const ladder = [
  `${name} Fantasy Value, Stats and Projections`,
  `${name} Fantasy Value and Projections`,
  `${name} Fantasy Value`,
];
const fit = ladder.find((t) => (t + SUFFIX).length <= 60) ?? ladder[ladder.length - 1];
const title = { absolute: fit + SUFFIX };
```

Keep "dynasty" and "trade value" in the description.

#### B03. The home title has no search terms

Severity: medium. Effort: S.

Status: title DONE 2026-09-11 (Part 0). The hero sentence below is still open
and is part of the Phase 2 carry-over.

What was wrong: app/page.tsx:47 was "FF Beacon - Your signal through the
fantasy noise.", and the H1 is the same slogan.

The fix: title "FF Beacon: Free Fantasy Football Rankings, Tools and News"
(57 characters, absolute), built. The slogan stays as the H1. Still to do:
open the hero paragraph (app/page.tsx, the paragraph under the H1) with one
sentence an engine can quote: "FF Beacon is a free fantasy football site:
rankings for every format, tools for trades, drafts, waivers and Sleeper
leagues, and plain English news."

#### B04. Section titles that are too long, doubly branded, or duplicated

Severity: medium. Effort: S. Can ship now.

- /brief: app/brief/(feed)/page.tsx line 8 is 64 characters and still gets
  the template, so it renders at 76. Use "Fantasy Football News: The Beacon
  Brief".
- Draft guide: app/guides/fantasy-football-draft-guide/page.tsx:58 renders at
  67. Use "Fantasy Football Draft Guide: Steals and Fades".
- Brief archives read "{X} News - The Beacon Brief | FF Beacon"
  (app/brief/(feed)/category/[slug]:34, team/[abbr]:35, tag/[tag]:116). Use
  `${team.name} Fantasy News` and let the template add the brand.
- Page 2 onward of /brief and every archive repeats page 1's title
  (app/brief/(feed)/page.tsx:24). Append ` (Page ${n})` when n > 1.
- Leave the FAAB title alone (61 characters rendered). It is the page that
  wins, at 8.4 percent click-through; only trim it if Search Console shows
  Google rewriting it.

#### B05. H1s that miss the phrase their page targets

Severity: medium. Effort: S. Can ship now (none of these changed yesterday).

| Page | File | Today | Suggested |
| --- | --- | --- | --- |
| /tools | app/tools/page.tsx:68 | Every tool you need, none of the noise. | Free fantasy football tools, none of the noise. |
| On The Clock | app/tools/on-the-clock/page.tsx:211 | (masthead) | Live draft helper for Sleeper drafts, by eye or by ear. |
| League Pulse | app/tools/league-pulse/page.tsx:422 | (masthead) | Sleeper League Pulse: every league you own, in one accessible table. |
| Manager Pulse | app/tools/manager-pulse/page.tsx:88, :143 | Manager Pulse | Manager Pulse: scout a Sleeper manager before you trade. |
| /games | app/games/page.tsx:67 | Play the data you already trust. | Free fantasy football games, built on data you already trust. |
| Draft guide | app/guides/fantasy-football-draft-guide/page.tsx:243 | The draft guide: who the room is late on | Fantasy football draft guide: who the room is late on |

Each change needs the accessibility review in Part 10: the H1 is the first
thing a screen reader announces on the page.

#### B06. Snippet controls and share tags

Severity: medium. Effort: S.

Status: first bullet DONE 2026-09-11, in the changed form shown below (Part
0). The other four bullets are open and part of the Phase 2 carry-over.

- Site-wide `max-image-preview:large` (DONE). Before step 1 only Brief
  articles and the three guides set it, and the root metadata set no
  `robots`. Discover shows large cards only with it. As built in
  app/layout.tsx, with no index or follow (they are the default, and listing
  them put "index" beside Next's own "noindex" on not-found pages):

  ```ts
  robots: {
    "max-image-preview": "large",
    "max-snippet": -1,
    "max-video-preview": -1,
  },
  ```

  A page that sets its own `robots` replaces the whole object, so every
  noindex page stays noindex. A page must OMIT the key rather than set it to
  undefined, or it wipes the default (components/signal/profile-view.tsx was
  fixed for exactly this).
- The Brief archives pass `path: "/brief"` to `pageShareMetadata`, so their
  og:url is /brief (app/brief/(feed)/category/[slug]/page.tsx:45,
  team/[abbr]/page.tsx:44, tag/[tag]/page.tsx:140, player/[slug]/page.tsx:53).
  Pass each page's own path (with `?page=N` when N > 1) and keep `key:
  "brief"` for the artwork. Split `key` (artwork) from `path` (URL) in
  lib/page-og.ts so this cannot recur.
- The root openGraph sets `url: SITE.url` (app/layout.tsx), so /privacy,
  /terms, /login and /tools/manager-pulse/[handle] share as the home page.
  Remove `url` from the root, and give privacy, terms and the Manager Pulse
  report their own share metadata.
- `pageShareMetadata` replaces openGraph wholesale (lib/page-og.ts:39-46) and
  drops `locale: "en_US"`. Add it there.
- The X handle appears only on /join (app/join/page.tsx:61-62). Add
  `site: "@ffbeacon"` to the root twitter object and to lib/page-og.ts.

### 6C. Trust: the Beacon Brief, authorship and accuracy

#### C01. Brief articles are model-drafted, autopublished and bylined to a person, with no disclosure

Severity: high. Effort: S to M.

Status: steps 1 and 2 DONE 2026-09-11 under owner decision 1, option (b)
(Part 0). Steps 3 to 5 are open and part of the Phase 2 carry-over.

What was wrong:

- `autopublish` defaults to true (lib/beacon-brief/settings.ts:173,
  overridable by `bb_autopublish`). The worker inserts the model's body text
  as a published article (lib/beacon-brief/worker.ts:1619-1636).
- The page showed "By Michael" and the NewsArticle JSON-LD named a Person
  "Michael" as author.
- Nothing on the article, the about page, the author page or the methodology
  guide mentions automation.
- No source credit renders on the article, although the llms text told answer
  engines that every story credits its reporter (C03, fixed).

Why it matters:

- Google permits AI-assisted content that meets Search Essentials, and asks
  sites to tell readers how content was made when a reader would reasonably
  wonder. Its guidance prefers an accurate byline plus a note on how the page
  was made over giving the automation a byline.
- A personal byline on unreviewed model output is the pattern scaled-content
  and site-reputation reviews look for. The February 2026 Discover update
  judges exactly this surface.
- Google News expects bylines, author information and publisher contact
  details.
- The Brief earned 1 click from at least 562 impressions (Part 2), so there
  was little traffic to lose and the domain's standing to protect.

How to fix it:

1. DONE. A byline "By FF Beacon" and, under it, "This story was written by FF
   Beacon's automated news desk. Michael built the desk and oversees it."
   (Michael linked to /author/michael, no rel="author"). Still to add: link the
   disclosure to the section in step 3 once it exists.
2. DONE. JSON-LD `author` is the Organization, `editor` is Michael; og
   article:author is "FF Beacon". When C05 lands, reference the Organization
   by `@id`.
3. OPEN (SA-T031). A "How the Beacon Brief is written" section in
   app/guides/how-ff-beacon-works/page.tsx: where stories come from, what the
   model does, what a human checks, how corrections are made, and a contact
   route. Link it from the about page and from the disclosure line.
4. OPEN (SA-T032). Render a source credit from data. worker.ts:1635 copies the
   ingestion metadata onto `articles.metadata`. If that metadata holds the
   post author, render "Original report: @handle on X" with a link. If it
   does not, store it there at ingestion first. This belongs in `metadata` per
   the Data Architecture rule; no new column.
5. OPEN. A one-line corrections note on any article whose `lastUpdated` came
   from a correction.

Verify: an accessibility review of the byline area (the disclosure must be
read in order after the byline, as text, not as a tooltip). Done for steps 1
and 2.

#### C02. Brief indexing should follow fantasy relevance, not publication

Severity: medium. Effort: S to M.

What is wrong: the Brief's impressions come mostly from queries a fantasy site
cannot win and should not want: team starting lineups, uniform releases,
"texans trade today", lawsuits. Desktop position 54.5, one click in 90 days.
llms.txt said 433 articles had been published; the sitemap lists 292, so the
index-quality gate (lib/beacon-brief/index-quality.ts) already drops 141. No
Discover impressions at all.

Why it matters: Google judges a site partly by the whole of what it indexes.
Hundreds of general NFL news pages that never earn a click dilute the signal
that this is a fantasy analysis site, and they are the pages most exposed to
the scaled-content policy.

How to fix it:

- Confirm the articles outside the sitemap actually carry noindex (the live
  check did not verify this).
- Add the relevance tier from migration 0153 to the index gate: index an
  article only when its fantasy impact is above the "no fantasy impact" tier.
  Articles below it stay published for readers and carry noindex, follow.
- Lead each indexed article with its fantasy consequence (the part only this
  site writes), which is what the Discover update rewards.
- Give articles the 16x9, 4x3 and 1x1 images Google's Article guidance asks
  for (F03), each at least 1200 px wide for Discover.

Verify: at the 2026-10-09 checkpoint, the Brief's click-through and average
position against Part 2.

#### C03. The llms files state things the code does not guarantee

Severity: high (for answer-engine accuracy). Effort: S.

Status: DONE 2026-09-11 (Part 0).

What was wrong:

- lib/llms/llms-full-txt.ts said Michael "is the byline on every Beacon Brief
  article... no other editorial staff" and that stories credit the reporter.
  lib/llms/context.ts repeated the credit claim in three places. No credit
  line renders.
- A context.ts comment said "the models themselves are not public"; the
  methodology guide now publishes the method.
- BEAM was described as a site-wide assistant; it is desktop only
  (components/site-header-controls.tsx:65-73).

Why it matters: these files exist so answer engines can quote them. A false
line there gets repeated under FF Beacon's name.

The fix, built: the text now describes the automated desk, the FF Beacon
byline and note, Michael as the person who built and oversees the desk and
writes the guides, a conditional credit ("where an article names the original
reporter"), the published method, and BEAM as desktop only. When C01 step 4
renders a credit, the conditional wording can become a firm one.

#### C04. The home page contradicts the methodology and the one-person facts

Severity: medium. Effort: S. Phase 2 carry-over.

What is wrong: the FF Beacon values card (app/page.tsx, around line 1000)
says "we keep the recipe behind the counter", "AI-powered analytics sweat the
close calls" and "our founder and team". lib/llms/context.ts says the site is
self funded by one person, and the methodology guide publishes the method.

How to fix it: "Our own number, with the method written out in plain English
in How FF Beacon works." Link the guide. Drop "team" and "AI-powered" unless
the guide describes them.

#### C05. The author is a thin, unlinked entity

Severity: medium. Effort: S.

What is wrong: app/author/michael/page.tsx emits a bare Person named
"Michael" with no image, sameAs or `@id`. The Organization founder
(lib/json-ld.ts:78-82), the NewsArticle editor and the guide authors are
separate anonymous Person nodes, and the NewsArticle author and publisher
repeat the Organization without an `@id`. The author page shows two "Nothing
to list yet" tiles.

Why it matters: Google documents ProfilePage with a Person as mainEntity for a
page about one person. Shared `@id`s let Google, Bing and AI engines resolve
every mention to one entity with one set of credentials.

How to fix it:

- In lib/json-ld.ts export `ORG_ID = `${SITE.url}/#organization``,
  `WEBSITE_ID = `${SITE.url}/#website`` and
  `AUTHOR_ID = `${SITE.url}/author/michael#person``. Put them on the
  Organization, WebSite (with `publisher: { "@id": ORG_ID }`) and every
  author, editor and publisher reference.
- The author page emits a ProfilePage whose `mainEntity` is the Person with
  `@id`, `name`, `image`, `jobTitle`, `worksFor: { "@id": ORG_ID }` and
  `sameAs` from `SOCIAL_LINKS` (only profiles that are really his).
- Hide the empty tiles until they have content.

#### C06. The methodology guide is not linked where its numbers appear

Severity: medium. Effort: S.

It is linked from the tool pages, /guides and the footer (lib/site.ts:310). It
is not linked from the rankings view (the call-to-action at
components/rankings/rankings-view.tsx:379 points to About), the player
profile, the about page's "Where the numbers come from" panel
(app/about/page.tsx:354-401), Brief articles, or the rail's Guides children
(lib/nav-tree.ts:122-137). Add one link in each, with varied anchors: "how
these values and ranks are calculated" (rankings), "the full methodology"
(about), "how FF Beacon projects and values players" (player overview).

#### C07. The glossary lacks the site's own terms

Severity: medium. Effort: S.

lib/guides/fantasy-football-terms.ts has Power Pulse (1029) and Beacon Verdict
(1038), and Positional WAR inside another entry (890). It has no entry for
Signal Check, the start/sit verdict, FF Beacon Values, the Manager Ledger or
BEAM, which are defined only in lib/llms/context.ts (BEACON_TERMS), a file
Google does not read. Add an "FF Beacon's own terms" group with anchor ids,
and make `BEACON_TERMS` the single source both files read. Positional WAR's
entry must follow the naming rule (the word "Positional" beside "WAR").

### 6D. Content that earns new searches

The season is in Week 2. Weekly in-season searches (waivers, start/sit, FAAB,
matchups) peak now through December; rookie and dynasty draft searches peak
from February to May. Build in that order.

Every new page must carry data only FF Beacon has, as dated text on the
server. None of them may be a template filled with a name. The August 2026
spam update case studies are the reason.

#### D01. FAAB: deepen the one page that already wins

Severity: high. Effort: M.

What is wrong: /tools/faab is at position 8.6 for "faab calculator" with 8.4
percent click-through, but its server HTML is the masthead (a 25-word
description) passed into the client `FaabForm`, plus one methodology
sentence, with no H2 (app/tools/faab/page.tsx:188-241). About 45 words
explain anything.

How to fix it:

- Copy the pattern of app/tools/trade-calculator/written-sections.tsx into
  app/tools/faab/written-sections.tsx. H2s: "How the FAAB calculator sets a
  bid", "How much of your FAAB budget should you spend on one player?", "FAAB
  in dynasty and redraft leagues", and a short FAQ answered from lib/faab's
  real logic.
- A FAAB strategy guide at /guides/faab-strategy, added to
  lib/guides/published.ts, with links both ways between guide and tool.
- Do not change the title or the URL.

Target: into the top five for "faab calculator" by the 2026-12-11 checkpoint.

#### D02. Weekly waiver wire and start/sit articles

Severity: high. Effort: M to L.

What is missing: nothing on the site targets "week {N} waiver wire", "waiver
wire pickups", or "week {N} start sit", the largest weekly searches in the
season. Plan section 4.5 of the previous plan listed the start/sit article
type; nothing in lib/beacon-brief mentions start/sit.

How to fix it: two Brief article types, one each per week, built from data the
site already computes:

- Waiver wire (Tuesday): the most-added or best-value free agents by position
  from the FAAB and projection data, each with a FAAB bid range from
  lib/faab, linking to /tools/faab and to each player page.
- Start/sit (Thursday): the week's toughest calls from
  lib/start-sit/toughest-calls.ts, linking to /tools/who-should-i-start with
  those players filled in (`?p=` links are fine in body copy; the tool page
  keeps its bare canonical).

Rules: one article of each per week, never per player or per team; carries
the C01 byline and disclosure; slug `week-{n}-waiver-wire-{season}` and
`week-{n}-start-sit-{season}`; NewsArticle markup; IndexNow on publish. Rank
data comes through the source and format resolvers; the article states which
format it assumes.

#### D03. League Pulse and On The Clock are thin in the server HTML

Severity: medium. Effort: S each.

- League Pulse: masthead, a 30-word connect card and one sentence
  (app/tools/league-pulse/page.tsx:195-395), about 200 to 250 words. Add a
  written section: "What League Pulse shows for each Sleeper league" and "How
  to find your Sleeper league" (Part 2 shows "sleeper league id" and "how to
  find sleeper league id" impressions already).
- On The Clock: masthead and eight feature chips of two to four words
  (app/tools/on-the-clock/page.tsx:128-156, :207-271), about 120 to 160 words.
  Add "How the live draft helper ranks the board" and "Rookie drafts and
  startups".

#### D04. /rankings duplicates /rankings/redraft-ppr-std

Severity: medium. Effort: M. Waits on owner decision 2.

The hub renders the full board for the resolved format (app/rankings/page.tsx),
and a crawler with no cookie gets the default, redraft-ppr-std
(lib/site.ts:358). Both URLs canonicalise to themselves, so they serve the
same 500 rows and compete for "fantasy football rankings" and "PPR rankings".
Recommended: make /rankings a hub. It carries the format directory grouped by
league type, the top 24 of the default format with "See all {n} redraft 1QB
PPR rankings", a dated intro sentence, and links to the glossary and the
methodology. This also shrinks the page far below A06's limit.

#### D05. Position rankings pages

Severity: medium. Effort: M.

Position is a query filter today that canonicalises back to the format page,
so "dynasty WR rankings" and "superflex QB rankings" have no page of their
own. Part 2 shows demand: "dynasty te rankings ppr" at 30, "superflex te
premium rankings" at 20.3, "fantasy football punter rankings" at 52.5.

How to fix it: `/rankings/[format]/[position]` for QB, RB, WR and TE on every
format, plus K and DEF on redraft formats, generated from a fixed list (about
70 URLs). Google's faceted navigation guidance is to make a fixed, small facet
set into real paths and keep the rest out. Each page gets its own title ("2026
Dynasty Superflex WR Rankings"), a dated intro and a link back to the full
board. Redirect `?position=` on the format page to the path with a 308, in
lib/rankings-format-redirect.ts beside the step 1 format rule. Add them to the
core sitemap and to IndexNow.

#### D06. Dynasty rookie rankings

Severity: medium. Effort: M. Build by 2027-01-15 for the spring peak.

No page exists for rookie rankings or the dynasty rookie draft. If the players
table carries a draft year (check `players.metadata.sleeper` for `years_exp`
or a rookie year), add `/rankings/[format]/rookies` for the dynasty formats,
same structure as D05. After the NFL draft the list becomes "2027 rookie
rankings" on the same URL.

#### D07. A dynasty trade value chart

Severity: medium. Effort: S to M.

"Dynasty trade value chart" is a common search that the site's data answers
directly, and plan section 4.5 listed it. A page per dynasty format listing
players and draft picks by value tier, dated, source-aware (source display
name, never the slug; pick values from `draft_pick_values` with the KTC
footnote when the pick source differs), linking to the trade calculator.
Suggested URL: `/rankings/[format]/trade-value-chart`, dynasty formats only.

#### D08. Fantasy points allowed by position

Severity: medium. Effort: M.

`nfl_defense_vs_position` already holds a real 0.80 to 1.25 spread computed
from `player_stats`. A public page, `/stats/points-allowed` with a table per
position, answers the weekly "fantasy points allowed by position" and
"defense vs position" searches. Real `<table>` with a `<caption>`, a dated
intro, and a row per team linking to the team's Brief page.

#### D09. Public explainers for Power Pulse and Positional WAR

Severity: low to medium. Effort: S.

`HowPowerPulseWorks` is still imported only by the league power-pulse page. A
public guide at /guides/power-pulse-and-positional-war, linked from the
glossary entries, gives answer engines a citable page for the site's own
models. The Positional WAR naming rule applies to every sentence.

#### D10. The accessible fantasy football guide

Severity: medium. Effort: M.

It is still a "Coming soon" card in app/guides/page.tsx. No competitor can
write it, it earns links from accessibility communities (G06), and it is the
clearest proof of the site's point of view. It needs the owner's own
experience and words; this plan does not draft it.

#### D11. Player pages: more unique text, and links in from the Brief

Severity: medium. Effort: M.

- The competitor pattern (FantasyPros, read 2026-09-11) stacks dated notes,
  rankings, projections and stats on one player URL. The FF Beacon profile's
  summary (lib/player-profile/summary.ts) is one sentence. Extend it into a
  short, dated paragraph built from the page's own figures: value and its 30
  day change by source, rank in the reader's format, next game's projection,
  and beat rate. Every number already on the page, nothing new invented.
- Brief article bodies do not link the players they mention; only the pills
  above do (app/brief/[slug]/page.tsx). Link the first mention of each tagged
  player in the article body to /players/{slug}.

#### D12. "Dynasty" on the trade calculator

Severity: low. Effort: S. Not before 2026-09-25.

"Dynasty" is missing from the trade calculator's title and H1
(app/tools/trade-calculator/page.tsx:42-44). Leave both alone (they changed
2026-09-10) and add an H2 to its written sections: "Dynasty trade calculator:
players and draft picks together".

#### D13. Deferred: static /compare/{a}-vs-{b} pages

Not recommended. They are combinatorial programmatic pages, the pattern the
2026 spam updates hit hardest, and the start/sit tool already answers the
intent from one canonical URL.

### 6E. Speed and page experience

Core Web Vitals are one signal among many and act as a tiebreaker, so this
part comes after 6A to 6D. Chrome field data (CrUX) includes signed-in
readers, so some of these matter even though Googlebot never sees them.

- E01 (medium, M). Rankings sort taps are likely slow on phones. About 1,000
  image elements (two per row), all rows in a client component, and a sort
  (components/rankings-table.tsx:153-169) that re-renders every row
  synchronously. Wrap sort and chip handlers in `startTransition`, render one
  headshot per row (A06), and group the tbody in blocks of 50 with
  `content-visibility: auto` and a `contain-intrinsic-size`. Keep all player
  links in the HTML.
- E02 (medium, S). The player portrait, the likely LCP element, loads from
  sleepercdn.com with no preconnect and no priority
  (components/player-profile/player-portrait.tsx:52-62). In
  app/players/[slug]/page.tsx call `preconnect("https://sleepercdn.com")`
  and `preload(src, { as: "image", fetchPriority: "high" })` from react-dom,
  and pass `fetchPriority="high"` and `loading="eager"` to the img.
- E03 (medium, S). The bookmark bar streams in with `fallback={null}` and
  pushes the page down for signed-in desktop readers (app/layout.tsx,
  components/bookmarks/bookmark-slots.tsx:48-57). The server knows
  `signedIn`, `barEnabled` and the bookmark count; render a fixed-height
  placeholder when all three hold.
- E04 (low, S). Both font families preload on every page (app/layout.tsx):
  Geist 69,436 bytes and Geist Mono 71,004 bytes. Declare them with
  next/font/local in app/fonts.ts and set `preload: false` on mono.
- E05 (low, S). The home hero animation runs at full cost for about 3.5
  seconds on slow phones before its probe switches to lite mode
  (components/hero-lava-lamp.tsx:281-283, :382-384). Start in lite mode when
  `navigator.hardwareConcurrency <= 4` or `deviceMemory <= 4`.
- E06 (low, S). `DiscordCta` calls /api/discord/membership on every page view,
  signed-out visitors included (components/discord-cta.tsx:75). Skip the call
  when no auth cookie is present.
- E07 (low, S). Middleware builds a Supabase client on every request. Return
  `NextResponse.next()` early when no session cookie is present (after the
  step 1 rankings rule and the A01 rewrite).
- E08 (low, S). Speed Insights is mounted (app/layout.tsx) but nothing
  records which element caused a slow INP or LCP. Add a small client
  component using `web-vitals/attribution` for the routes in the 2026-09-08
  performance plan's Part 9, and run that Part 9 field protocol, which has
  not been recorded.
- E09 (low, M). /tools/on-the-clock ships 577 KB raw, 169 KB gzip, 76 KB over
  the 500 KB target (PERF-T031).
- E10 (preventive). public/ads.txt names an AdSense publisher but no ad code
  exists. When ads ship: fixed min-height slots per breakpoint, no auto or
  anchor ads above content, next/script `lazyOnload`, and the ad domains in
  the CSP before it leaves report-only mode.

### 6F. Structured data

Every one of the 26 JSON-LD emitters already goes through `serializeJsonLd`
(lib/json-ld.ts:25-41), which escapes the characters that could break out of
the script tag. The items below are accuracy and linking, not safety.

- F01 (medium, S). Player JSON-LD (app/players/[slug]/page.tsx:197-243):
  `jobTitle` holds a position string, `memberOf` names the team by
  abbreviation only ("CIN"), there is no `image`, and the BreadcrumbList is
  Home > "WR" > name pointing at /rankings?position=WR while the visible trail
  is Home > Players > name. Use the `team` row already loaded at line 185 for
  `memberOf: { "@type": "SportsTeam", name: team.name, sport: "American
  football", url: /brief/team/{abbr} }`, add `image`, drop `jobTitle`, and
  make the trail Home > Rankings > name.
- F02 (low, S). The shared breadcrumb JSON-LD ignores registered labels
  (components/app-shell/breadcrumb-bar.tsx:56), so the rankings format crumb
  reads "Dynasty PPR Sflex". Give `breadcrumbJsonLd` an optional `lastLabel`
  and render `<SetBreadcrumbLabel value={copy.headline} />` from
  app/rankings/[format]/page.tsx.
- F03 (low, S). NewsArticle: fall back `dateModified` to `publishedAt` when
  `lastUpdated` is null; add 4x3 and 1x1 images through a `?ratio=` variant
  of app/api/og/brief/[slug]/route.tsx.
- F04. Entity `@id`s: covered in C05.
- F05 (low, S). Organization: `sameAs` includes the site's own /join page
  (lib/json-ld.ts:75-77, lib/site.ts:348); use the real Discord invite URL or
  drop it. The logo is 512x490 (public/img/ff-beacon-logo.png); use the
  square 512x512 ff-beacon-logo-email.png. Add `applicationName` to the root
  metadata. Keep SearchAction out: Google retired the sitelinks search box in
  November 2024.
- F06 (low, S). Rankings pages carry no list markup. Google shows nothing for
  a player ItemList, but Bing's guidance favours structured data. Emit
  `itemListJsonLd` (lib/json-ld.ts:155) over the first 100 rows actually in
  the HTML. Do not add Dataset (it implies a licence to redistribute
  third-party values, and Google Search no longer uses it).
- F07. FAQPage: add no more. Google ended FAQ rich results for every site on
  2026-05-07. The existing blocks mirror visible text and stay for Bing.
- F08 (low, S). No verification meta tags; Search Console is verified by DNS.
  Add `verification: { google, other: { "msvalidate.01": ... } }` from
  environment variables as a fallback if DNS verification ever lapses.

### 6G. Bing, answer engines and off-site signals

- G01 (high, owner action, 15 minutes). Bing Webmaster Tools: add the site
  (import from Search Console), submit https://ffbeacon.com/sitemap.xml,
  confirm IndexNow submissions arrive, and open the AI Performance report
  (citations, grounding queries, citation share). It is the only report that
  names which pages Copilot cited.
- G02 (high, owner action, monthly). Search Console: the generative AI
  performance report (AI Overviews, AI Mode and Discover AI impressions by
  page, worldwide since 2026-08-31) and the branded queries filter. The
  branded filter turns Part 2's 32 percent brand share into a tracked number.
- G03 (medium, S). robots.txt addresses no crawler by name (app/robots.ts:24-25
  allows everything under the wildcard, on purpose). After owner decision 4,
  write explicit groups so the policy is on the record: allow Googlebot,
  Bingbot, OAI-SearchBot, ChatGPT-User, Claude-SearchBot, Claude-User,
  PerplexityBot, Perplexity-User and Applebot; allow or disallow GPTBot,
  ClaudeBot, CCBot, Google-Extended and Applebot-Extended per the decision.
  Then check Vercel's Firewall and Bot Protection settings, which can block
  AI crawlers regardless of robots.txt. Remove the `Host:` line, which Google
  and Bing ignore.
- G04 (low). llms.txt stays, small and accurate (C03, done). It is 11,347
  bytes and linked only through `rel="describedby"` (app/layout.tsx). Google
  does not use it and most engines do not fetch it; spend no more on it.
- G05 (low, S). Google's preferred sources button (2026-08-20) on Brief
  articles and /brief, after owner decision 5. Only a whole domain qualifies,
  which ffbeacon.com is.
- G06 (medium, ongoing, owner-led). Off-site mentions. The research shows
  brand mentions tracking AI visibility more closely than links do (a
  correlation). Places where fantasy players already talk: r/DynastyFF,
  r/fantasyfootball and r/Sleeper where their self-promotion rules allow,
  Discord (already running), short screen-recorded tool demos on YouTube,
  podcast guest spots. The accessibility angle is unique: blind and
  low-vision communities and accessibility newsletters have no fantasy
  football site built for them. Never buy links or plant mentions; both are
  spam under Google's policies.
- G07 (watch). Chrome 151 measures soft navigations by default. Client-side
  moves between player pages will get their own LCP and INP in field data.
  Watch the Speed Insights numbers for /players/[slug] after it rolls out.

## 7. Build order

Phase 1, "Quick fixes": DONE 2026-09-11, not yet committed or deployed (Part
0). A03, A04, A02, B03 (title), B06 (first bullet), C03, C01 (steps 1 and 2).

Owner decisions 1 to 5: DONE 2026-09-11, not yet committed or deployed (Part
0b). That built D04 (the /rankings hub), G03 (robots), G05 (preferred sources),
removed the `editor` property from C01, and settled A09's Signal profile
question (they stay indexed). D04 therefore leaves Phase 4 below, and G03 and
G05 leave Phase 5.

Phase 2, CONTINUE HERE. Two blocks.

First, the step 1 leftovers. These were in the original Phase 1 but not on
the quick-fix list, and none depends on the freeze:

- Deploy step 1, then run the after-deploy checks in Part 0.
- Part 3's post-deploy steps from the previous plan, if not done.
- G01 and G02 (owner actions, no code).
- The www redirect in Vercel (A09, owner action).
- A09's small code items, including the RSS `managingEditor` fix.
- B03's hero sentence.
- B04 and B05.
- The four open bullets of B06.
- C04.
- C01 steps 3 to 5 (SA-T031, SA-T032, the corrections note).

Then the foundations, 2026-09-14 to 2026-10-02:

- A01 (static twins), with E07. This is also what fixes the page body order
  step 1 could not.
- A06 and E01 together (the rankings table).
- A05, A07, A08.

Phase 3, from the 2026-09-25 checkpoint:

- B01, B02 and D12, now that the 2026-09-10/11 titles have been seen.
- D01 (FAAB written sections and guide), D02 (weekly articles), D03.
- C02.

Phase 4, October:

- D04 (after decision 2), D05, D07, D08, D09.
- C05, C06, C07.
- F01 to F08.

Phase 5, November to January:

- D06 (rookies, by 2027-01-15), D10, D11.
- E02 to E10.
- G03 to G06, with G06 ongoing.

## 8. Measurement and checkpoints

Pull the same figures as Part 2 at each checkpoint, through the GSC connector:

- `get_performance_overview` (90 days) and `get_search_analytics` by date.
- `get_search_analytics` by page, and `get_search_by_page_query` for
  /tools/faab, /tools/who-should-i-start, /tools/trade-calculator and the two
  dynasty superflex format pages.
- `batch_url_inspection` for the URLs in Part 2, to track last-crawled dates.
- In the Search Console interface: the branded queries filter, the generative
  AI report, and Crawl Stats (average response time, host status). After the
  step 1 deploy, watch average response time: matched crawlers now wait for
  metadata before the first byte.
- In Bing Webmaster Tools: AI Performance and IndexNow.

Checkpoints:

- 2026-09-25: first read on the 2026-09-10/11 changes. Are the old slugs
  recrawled and consolidating? Are start/sit and trade calculator queries
  appearing? Lift the title freeze.
- 2026-10-09: first read on step 1 and on the foundations. Crawl Stats
  response time after A01. Last-crawled dates for rankings and players (the
  aim is days, not weeks). Soft 404 count in the Pages report. Record the
  step 1 deploy date here, since its effects count from that day.
- 2026-12-11: 90 days, compared window for window with Part 2.

What would show the plan is working (goals, not forecasts):

- Non-brand clicks grow faster than branded clicks, so the brand share falls
  from 32 percent.
- /tools/faab moves into the top five for "faab calculator".
- The dynasty format pages' click-through rises above 3 percent at similar
  positions.
- Rankings and player pages are recrawled within a few days of changing.
- Zero soft 404s in the Pages report.
- The start/sit and trade calculator pages appear for their head terms.
- The site appears in the generative AI report and in Bing's AI citations.

## 9. Task list

Atomic, in the progress.md shape, prefix SA-T. The completed step 1 tasks are
also recorded in progress.md.

```
SA-T001 | pending | Run the Part 3 post-deploy checks from the previous plan, if not done
        | files: none (curl, Search Console, npm run indexnow)
SA-T002 | pending | Bing Webmaster Tools: import, sitemap, IndexNow check, AI Performance baseline (owner)
        | files: none
SA-T003 | pending | Search Console: record branded share and generative AI report baseline (owner)
        | files: none
SA-T004 | pending | Deploy step 1 and run the after-deploy checks in Part 0
        | files: none | depends on: SA-T010 to SA-T035
SA-T010 | completed | Move the Brief loading boundary into app/brief/(feed)/ so a missing article is a real 404
        | files: app/brief/(feed)/page.tsx, app/brief/(feed)/loading.tsx, app/brief/(feed)/category, team, tag, player (git mv)
        | verified: 404 locally; implementation and SEO reviews; 2026-09-11
SA-T011 | completed | Middleware 308 for ?format= on /rankings and /rankings/[format]; delete the in-page redirect
        | files: middleware.ts, lib/rankings-format-redirect.ts, lib/rankings-format-redirect.test.ts, app/rankings/[format]/page.tsx, app/rankings/page.tsx
        | verified: tests; 308s locally; shape check instead of a static list (Part 0); 2026-09-11
SA-T012 | completed | htmlLimitedBots with search and answer crawlers, plus a regex test
        | files: next.config.ts, lib/seo/html-limited-bots.ts, lib/seo/html-limited-bots.test.ts
        | verified: title in head for Googlebot locally; 2026-09-11
SA-T013 | completed | Share the player metadata read; parallelise the Brief metadata reads
        | files: none. Found unnecessary: one indexed lookup alongside the page load; the Brief reads are dependent (Part 0)
SA-T014 | pending | Noindex out-of-range pagination on /brief and its archives
        | files: app/brief/(feed)/page.tsx, app/brief/(feed)/category/[slug]/page.tsx, team/[abbr]/page.tsx, tag/[tag]/page.tsx
SA-T015 | pending | Noindex /login and /my-beacon, then drop their robots.txt disallows
        | files: app/login/page.tsx, app/my-beacon/layout.tsx, app/robots.ts
SA-T016 | pending | Root not-found page with links out
        | files: app/not-found.tsx (new)
SA-T017 | pending | X-Robots-Tag noindex, follow header for /leagues/* and /tools/manager-pulse/*
        | files: middleware.ts
SA-T018 | pending | Fix the /tools share card copy ("compare two players")
        | files: app/api/og/page/[key]/route.tsx
SA-T019 | pending | Point www straight at the apex in Vercel domain settings (owner)
        | files: none
SA-T020 | completed | Home title
        | files: app/page.tsx | verified: locally; 2026-09-11
SA-T020b | pending | Home hero answer-first sentence (the rest of B03)
        | files: app/page.tsx
SA-T021 | pending | Brief, draft guide and archive titles; page number on paginated titles
        | files: app/brief/(feed)/page.tsx, app/guides/fantasy-football-draft-guide/page.tsx, app/brief/(feed)/category/[slug]/page.tsx, team/[abbr]/page.tsx, tag/[tag]/page.tsx
SA-T022 | pending | H1s for /tools, On The Clock, League Pulse, Manager Pulse, /games, draft guide
        | files: the six pages named in B05
SA-T023 | completed | Root robots with max-image-preview:large (no index or follow; general tag)
        | files: app/layout.tsx, components/signal/profile-view.tsx
        | verified: robots tags locally on a normal, a not-found, a noindex and a profile page; 2026-09-11
SA-T024 | pending | Split key from path in pageShareMetadata; fix archive og:url; add locale and twitter site
        | files: lib/page-og.ts, the four Brief archive pages, app/layout.tsx
SA-T025 | pending | Remove the root og:url; share metadata for privacy, terms and the Manager Pulse report
        | files: app/layout.tsx, app/privacy/page.tsx, app/terms/page.tsx, app/tools/manager-pulse/[handle]/page.tsx
SA-T026 | pending | RSS managingEditor: a real contact address with the name, or drop it
        | files: app/brief/rss.xml/route.ts
SA-T030 | completed | Brief byline, disclosure line and author JSON-LD per owner decision 1
        | files: app/brief/[slug]/page.tsx, app/page.tsx (comment), app/author/michael/page.tsx (comment)
        | verified: locally; two lines after the SEO review; 2026-09-11
SA-T031 | pending | "How the Beacon Brief is written" section, linked from the about page and the disclosure line
        | files: app/guides/how-ff-beacon-works/page.tsx, app/about/page.tsx, app/brief/[slug]/page.tsx
SA-T032 | pending | Store and render the original report credit from articles.metadata
        | files: lib/beacon-brief/worker.ts, app/brief/[slug]/page.tsx
SA-T033 | completed | Correct the llms context and full text to match the site
        | files: lib/llms/context.ts, lib/llms/llms-full-txt.ts, lib/llms/llms-txt.ts
        | verified: served text locally; 2026-09-11
SA-T034 | pending | Fix the home values card copy (C04)
        | files: app/page.tsx
SA-T035 | completed | Resolve the step 1 review findings
        | files: app/layout.tsx, components/signal/profile-view.tsx, app/brief/(feed)/loading.tsx, lib/rankings-format-redirect.ts, lib/seo/html-limited-bots.ts, lib/llms/context.ts, app/brief/[slug]/page.tsx, app/rankings/page.tsx, app/page.tsx, app/author/michael/page.tsx
        | verified: tsc, 5,053 tests, build, local curl checks; 2026-09-11
SA-T040 | pending | Reserve the static-render segment
        | files: scripts/check-reserved-routes.ts
SA-T041 | pending | Static twin: home
        | files: app/static-render/page.tsx (new) | depends on: SA-T040
SA-T042 | pending | Static twin: rankings hub and format pages
        | files: app/static-render/rankings/page.tsx, app/static-render/rankings/[format]/page.tsx (new) | depends on: SA-T040
SA-T043 | pending | Static twin: player profiles with top-ranked static params
        | files: app/static-render/players/[slug]/page.tsx (new) | depends on: SA-T040
SA-T044 | pending | Static twin: Brief index, articles, category and team pages, plus the Brief cache tag
        | files: app/static-render/brief/** (new), lib/beacon-brief/worker.ts | depends on: SA-T040
SA-T045 | pending | Static twins: guides, about, author, tools landing pages, games, legal
        | files: app/static-render/** (new) | depends on: SA-T040
SA-T046 | pending | Middleware rewrite to the twins for anonymous, parameter-free requests; 404 on direct hits
        | files: middleware.ts | depends on: SA-T041 to SA-T045
SA-T047 | pending | Early return in middleware when no session cookie is present
        | files: middleware.ts, lib/supabase/middleware.ts | depends on: SA-T046
SA-T050 | pending | One headshot and name block per rankings row; slimmer client props
        | files: components/rankings-table.tsx
SA-T051 | pending | startTransition on sort and chips; content-visibility row groups
        | files: components/rankings-table.tsx | depends on: SA-T050
SA-T052 | pending | HTML size guard for the largest rankings board
        | files: a new test or scripts/ step | depends on: SA-T050
SA-T053 | pending | Shared isPlayerIndexable predicate; noindex unranked players; test
        | files: lib/players/indexable.ts (new), lib/sitemap/sections.ts, app/players/[slug]/page.tsx
SA-T054 | pending | IndexNow on archive, for moved players, gated on indexability, warn on missing key
        | files: lib/beacon-brief/deletion.ts, app/api/cron/recalculate-derived/route.ts, lib/beacon-brief/worker.ts, lib/indexnow.ts
SA-T055 | pending | Per-player sitemap lastmod; throw on sitemap read errors
        | files: lib/sitemap/sections.ts
SA-T060 | pending | Rankings title season, capitalised H1, dated intro with time element (after 2026-09-25)
        | files: lib/rankings-formats.ts, components/rankings/rankings-view.tsx
SA-T061 | pending | Player title ladder, page and tabs (after 2026-09-25)
        | files: app/players/[slug]/page.tsx
SA-T062 | pending | Trade calculator dynasty H2 (after 2026-09-25)
        | files: app/tools/trade-calculator/written-sections.tsx
SA-T063 | pending | Relevance tier in the Brief index gate; verify the unlisted articles carry noindex
        | files: lib/beacon-brief/index-quality.ts
SA-T070 | pending | FAAB written sections and FAQ
        | files: app/tools/faab/written-sections.tsx (new), app/tools/faab/page.tsx
SA-T071 | pending | FAAB strategy guide
        | files: app/guides/faab-strategy/page.tsx (new), lib/guides/published.ts
SA-T072 | pending | Weekly waiver wire article type
        | files: lib/beacon-brief/ (new article type)
SA-T073 | pending | Weekly start/sit article type
        | files: lib/beacon-brief/ (new article type)
SA-T074 | pending | League Pulse written section
        | files: app/tools/league-pulse/written-sections.tsx (new), app/tools/league-pulse/page.tsx
SA-T075 | pending | On The Clock written section
        | files: app/tools/on-the-clock/written-sections.tsx (new), app/tools/on-the-clock/page.tsx
SA-T080 | completed | /rankings as a hub; a saved format lands on its board (owner decision 2, Part 0b)
        | files: app/rankings/page.tsx, lib/rankings-hub.ts, lib/rankings-hub.test.ts, lib/breadcrumbs.ts, app/rankings/(board)/[format] and app/rankings/(board)/loading.tsx (git mv)
SA-T081 | pending | Position rankings routes and the ?position= 308
        | files: app/rankings/[format]/[position]/page.tsx (new), lib/rankings-format-redirect.ts, lib/sitemap/sections.ts
SA-T082 | pending | Dynasty trade value chart
        | files: app/rankings/[format]/trade-value-chart/page.tsx (new)
SA-T083 | pending | Fantasy points allowed by position page
        | files: app/stats/points-allowed/page.tsx (new)
SA-T084 | pending | Power Pulse and Positional WAR public guide
        | files: app/guides/power-pulse-and-positional-war/page.tsx (new), lib/guides/published.ts
SA-T085 | pending | Glossary: FF Beacon's own terms from one source
        | files: lib/guides/fantasy-football-terms.ts, lib/llms/context.ts
SA-T086 | pending | Methodology links from rankings, player, about, Brief and the rail
        | files: components/rankings/rankings-view.tsx, player profile overview, app/about/page.tsx, app/brief/[slug]/page.tsx, lib/nav-tree.ts
SA-T087 | pending | Author ProfilePage and shared entity @ids
        | files: lib/json-ld.ts, app/author/michael/page.tsx, app/brief/[slug]/page.tsx
SA-T088 | pending | Player JSON-LD and breadcrumb
        | files: app/players/[slug]/page.tsx
SA-T089 | pending | Breadcrumb JSON-LD labels
        | files: components/app-shell/breadcrumb-bar.tsx, lib/breadcrumbs.ts, app/rankings/[format]/page.tsx
SA-T090 | pending | NewsArticle image ratios, dateModified fallback
        | files: app/brief/[slug]/page.tsx, app/api/og/brief/[slug]/route.tsx
SA-T091 | pending | Organization sameAs, square logo, applicationName, verification env
        | files: lib/json-ld.ts, lib/site.ts, app/layout.tsx
SA-T092 | pending | Rankings ItemList over the rendered rows
        | files: app/rankings/[format]/page.tsx
SA-T100 | pending | Dynasty rookie rankings (by 2027-01-15)
        | files: app/rankings/[format]/rookies/page.tsx (new)
SA-T101 | pending | Player summary paragraph from on-page figures
        | files: lib/player-profile/summary.ts
SA-T102 | pending | Link first mentions of tagged players in Brief bodies
        | files: components/beacon-brief/ (article markdown renderer)
SA-T103 | pending | Player portrait preconnect and priority
        | files: app/players/[slug]/page.tsx, components/player-profile/player-portrait.tsx
SA-T104 | pending | Bookmark bar placeholder
        | files: app/layout.tsx, components/bookmarks/bookmark-slots.tsx
SA-T105 | pending | Font preload: mono off
        | files: app/fonts.ts (new), app/layout.tsx
SA-T106 | pending | Hero animation starts lite on low-end devices
        | files: components/hero-lava-lamp.tsx
SA-T107 | pending | Skip the Discord membership call when signed out
        | files: components/discord-cta.tsx
SA-T108 | pending | Web vitals attribution logging
        | files: a new client component, app/layout.tsx
SA-T109 | completed | robots.txt per owner decision 4: training crawlers allowed, one wildcard group kept on purpose, Host line removed (Part 0b)
        | files: app/robots.ts | owner action still open: check Vercel Firewall and Bot Protection settings
SA-T110 | completed | Preferred sources link on every Brief article and listing page (owner decision 5, Part 0b)
        | files: lib/preferred-source.ts, lib/preferred-source.test.ts, components/beacon-brief/preferred-source-link.tsx, app/brief/[slug]/page.tsx, components/beacon-brief/brief-feed.tsx
SA-T111 | completed | Remove `editor` from the Brief NewsArticle markup (owner decision 1, second answer, Part 0b)
        | files: app/brief/[slug]/page.tsx, app/page.tsx (comment), app/author/michael/page.tsx (comment)
SA-T112 | completed | Keep public Signal profiles indexed; correct the sitemap comment about boards (owner decision 3, Part 0b)
        | files: lib/sitemap/sections.ts
```

The accessible fantasy football guide (D10) is not on the list because it is
the owner's to write.

## 10. Implementation rules

- Every task follows the Sub-Agent Workflow in CLAUDE.md: implementation
  review, accessibility review, security review, and a fix pass before the
  task is marked complete.
- Every copy change (titles, H1s, disclosure, written sections) gets the
  accessibility review, and every string gets the AI-writing check.
- Any page showing player data keeps the Source and Format Sync rules; a new
  page (D05 to D08) resolves format and source through lib/preferences.ts and
  lib/source.ts and labels sources by display name.
- Every visible date goes through lib/datetime.ts.
- The title freeze in Part 3 holds until 2026-09-25.
- Before marking any rendering task done: `npm run build` (check the route
  table), `npx tsc --noEmit`, `npx vitest run`, and the curl checks in its
  Verify line against production after deploy.
- A local production server started with `npx next start` in the background
  outlives a stopped task on Windows. Stop the node process that owns the port
  before rebuilding, or the next server fails with EADDRINUSE and curl checks
  silently hit the old build.
- A metadata `robots` key must be omitted, never set to undefined (B06).
- No change to how data is stored for display purposes, and no nightly cron
  that iterates leagues.

## 11. Sources

Research read on 2026-09-11. Dates are publication or last-updated dates.

- Google Search Status Dashboard, ranking update history:
  https://status.search.google.com/products/rGHU1u87FJnkP6W2GwMi/history
- Google core updates documentation (updated 2025-12-10):
  https://developers.google.com/search/docs/appearance/core-updates
- February 2026 Discover core update:
  https://developers.google.com/search/blog/2026/02/discover-core-update
- AI features and your website (updated 2025-12-10):
  https://developers.google.com/search/docs/appearance/ai-features
- Google AI optimisation guide (2026-05-15, updated 2026-07-10):
  https://developers.google.com/search/docs/fundamentals/ai-optimization-guide
- Robots meta tag documentation (updated 2026-03-24):
  https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag
- Google common crawlers, including Google-Extended (updated 2026-07-14):
  https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers
- Generative AI performance reports (2026-06-03; worldwide 2026-08-31):
  https://developers.google.com/search/blog/2026/06/gen-ai-performance-reports
- Preferred sources (updated 2026-09-10):
  https://developers.google.com/search/docs/appearance/preferred-sources
- Search Central updates log (FAQ retirement, breadcrumb change and others):
  https://developers.google.com/search/updates
- HowTo and FAQ changes (2023-08):
  https://developers.google.com/search/blog/2023/08/howto-faq-changes
- Simplifying search results (2025-06):
  https://developers.google.com/search/blog/2025/06/simplifying-search-results
- Structured data search gallery (updated 2026-06-15):
  https://developers.google.com/search/docs/appearance/structured-data/search-gallery
- Article structured data (updated 2026-09-08):
  https://developers.google.com/search/docs/appearance/structured-data/article
- ProfilePage structured data (updated 2026-09-08):
  https://developers.google.com/search/docs/appearance/structured-data/profile-page
- Web Vitals (updated 2024-10-31): https://web.dev/articles/vitals
- Page experience (updated 2025-12-10):
  https://developers.google.com/search/docs/appearance/page-experience
- Soft navigations (updated 2026-09-02):
  https://developer.chrome.com/docs/web-platform/soft-navigations
- JavaScript SEO basics (updated 2026-03-04):
  https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics
- Dynamic rendering (used in the step 1 review):
  https://developers.google.com/search/docs/crawling-indexing/javascript/dynamic-rendering
- HTTP status codes and network errors (used in the step 1 review):
  https://developers.google.com/search/docs/crawling-indexing/http-network-errors
- Consolidate duplicate URLs (updated 2026-07-10):
  https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls
- Faceted navigation (updated 2025-12-18):
  https://developers.google.com/crawling/docs/faceted-navigation
- Crawl budget (updated 2026-07-22):
  https://developers.google.com/crawling/docs/crawl-budget
- Googlebot, including the 2 MB limit (documented 2026-02-03):
  https://developers.google.com/search/docs/crawling-indexing/googlebot
- Build a sitemap (updated 2026-07-08):
  https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap
- Spam policies (updated 2026-08-28):
  https://developers.google.com/search/docs/essentials/spam-policies
- Using generative AI content:
  https://developers.google.com/search/docs/fundamentals/using-gen-ai-content
- Google Search and AI-generated content (2023-02):
  https://developers.google.com/search/blog/2023/02/google-search-and-ai-content
- Google Discover (updated 2026-03-09):
  https://developers.google.com/search/docs/appearance/google-discover
- IndexNow FAQ: https://www.indexnow.org/faq
- Bing snippet controls, including max-image-preview (2020-04):
  https://blogs.bing.com/webmaster/april-2020/Announcing-new-options-for-webmasters-to-control-their-snippets-at-Bing
- Bing AI Performance in Webmaster Tools (2026-02-10):
  https://blogs.bing.com/webmaster/February-2026/Introducing-AI-Performance-in-Bing-Webmaster-Tools-Public-Preview
- Bing AI visibility insights (2026-06):
  https://blogs.bing.com/search/June-2026/New-AI-Visibility-Insights-in-Bing-Webmaster-Tools-Intents-Topics-Citation-Share-Compare
- OpenAI crawlers: https://developers.openai.com/api/docs/bots
- Anthropic crawlers (2026-04-07): https://support.claude.com/en/articles/8896518
- Perplexity crawlers: https://docs.perplexity.ai/guides/bots
- Applebot (2026-09-04): https://support.apple.com/en-us/119829
- Ahrefs llms.txt study: https://ahrefs.com/blog/llmstxt-study/
- Ahrefs brand mentions and AI visibility (2026-05-26):
  https://www.businesswire.com/news/home/20260526119691/en/Across-75000-Brands-YouTube-Mentions-Are-the-Strongest-Signal-of-AI-Visibility-New-Ahrefs-Report-Reveals
- August 2026 spam update impact (industry):
  https://searchengineland.com/google-august-2026-spam-update-ranking-impact-485980
- August 2026 spam update case studies (industry):
  https://www.gsqi.com/marketing-blog/august-2026-google-spam-update-case-studies/
- Next.js generateMetadata and streaming metadata (updated 2026-08-25):
  https://nextjs.org/docs/app/api-reference/functions/generate-metadata
- Next.js htmlLimitedBots:
  https://nextjs.org/docs/app/api-reference/config/next-config-js/htmlLimitedBots
- Next.js cookies() (updated 2026-06-09):
  https://nextjs.org/docs/app/api-reference/functions/cookies
