# Relays and Briefs: performance review

Read-only audit, 2026-09-17, against docs/beacon-brief/relays-and-briefs-plan.md
sections 4, 6, 9.2 and 12, and the memoTtl / unstable_cache / 1000-row notes in
docs/performance/site-speed-audit-and-plan.md. Round-trip cost is estimated at
45 to 50 ms per Supabase query, the figure that document uses.

Verified findings only. Every line number is from the working tree.

## Summary of severity counts

- Blocker: 0
- Major: 8
- Minor: 11

No caching leak was found. Every memoTtl key and every unstable_cache entry in
the new code holds public, RLS-identical data; the audit of that is recorded in
section "Caching" below.

## Major

### M1. The feed's player and team filters put up to 1000 uuids in one URL

lib/relays/load.ts:212-224 (relayIdsForPlayer, relayIdsForTeam), 249-257
(loadRelayFeed), 331-339 (loadRelaysForPlayer).

The file defines `ID_BATCH = 300` at line 41 with the comment "Most ids one
`.in()` filter carries; PostgREST puts them all in the URL", and `hydrate`
honours it. The three feed paths do not: they read every matching relay id
(capped at 1000) and pass `ids.slice(0, 1000)` straight into `.in("id", ...)`.

Cost: a uuid plus its comma is 37 bytes in the query string, so 300 ids is
about 11 KB of URL and 1000 ids is about 37 KB. PostgREST behind Kong rejects a
request line past roughly 8 KB with 414, which lands at about 210 ids. The
/brief/team/[abbr] page (app/brief/(feed)/team/[abbr]/page.tsx:56) is the one
that gets there first: a busy NFL team accumulates a few relays a week, so this
breaks that page permanently once the count passes about 210, and it breaks it
for every page of the feed, not only page 1.

Second cost, independent of the first: the id pre-query runs in full on every
page of the pagination, so page 8 of a team feed still transfers every id.

Fix: replace the two-hop filter with a single filtered read. Either
`.in("id", ...)` batched at ID_BATCH with the page applied after (still two
hops but bounded), or better, add an RPC / view that joins relay_teams to
relays so the filter, the order and the range happen in one statement. The
cheapest correct change that keeps the current shape is to page the JOIN table
by `source_posted_at` instead: select relay ids for the team ordered and
limited to the page window, then read those 30 relays.

Resolution: fixed in lib/relays/load.ts. The player and team feeds filter through relay_players and relay_teams with an inner join, so the filter, the order, the range and the exact count happen in one statement and no id list reaches the URL. The id pre-query functions are gone.

### M2. The admin editions list pulls every edition's full body to count words

app/admin/brief-desk/editions/page.tsx:35-41 and the `countArticleWords`
call at :54.

The select is `... articles(title, slug, status, content_md)` with `.limit(200)`
on a `force-dynamic` page (:10). `content_md` for an in-season edition is 1,800
to 4,000 words per plan section 8.4, about 12 to 26 KB of markdown. At 30
editions a year, two seasons in that is 60 rows and roughly 1 MB transferred on
every admin page load; at the 200-row cap it is 3 to 5 MB. The only use of the
column is a word count for a list row.

Fix: store `word_count` on `brief_editions` at insert time in
app/api/brief-desk/drafts/route.ts (the draft is already being validated for
word count there, per plan 9.3), and drop `content_md` from this select.
`validation_report` is also selected whole for a warnings count and could be
served by a stored integer the same way.

Resolution: fixed in app/admin/brief-desk/editions/page.tsx. content_md and the whole validation_report are out of the select; the word count comes from validation_report->>word_count, which the validator already stores, and the warnings count from validation_report->warnings. No migration was needed.

### M3. /brief/editions selects the whole `metadata` jsonb, which carries the block datasets

lib/relays/load.ts:408 (`BRIEF_SELECT` includes `metadata`), 424-433
(loadPublishedBriefs, default limit 200); app/brief/editions/page.tsx:54.

app/api/brief-desk/drafts/route.ts:214-222 writes the edition's referenced
datasets into `articles.metadata.datasets`, whole. An in-season edition is
required to carry stat tiles, value movers, a top-scorers table, an injury
timeline, an action list and one interactive (plan 8.4 item 8), so that blob is
tens of kilobytes per edition. `loadPublishedBriefs` reads all of it to extract
two strings, `period_start` and `period_end` (briefFromRow, :383-406).

Cost: about 40 KB per edition times up to 200 rows. The page is
`revalidate = 300`, so it is paid once every five minutes per region rather
than per reader, which is why this is major and not a blocker. The same select
is used by `loadLatestBrief` (:411-421), which the /brief hub calls on every
request and the hub is dynamic (see M5), so there it is per-reader.

Fix: project the two keys in the select instead of the whole column:
`period_start:metadata->>period_start, period_end:metadata->>period_end`.
PostgREST supports that and it removes the blob from both readers.

Resolution: fixed in lib/relays/load.ts. BRIEF_SELECT projects period_start and period_end out of metadata instead of reading the column, so neither loadPublishedBriefs nor loadLatestBrief carries the dataset blob.

### M4. loadRelaysForPlayer reads every relay id for a player to take five

lib/relays/load.ts:326-341, called from
components/player-profile/beacon-brief-tab.tsx:26 with a limit of 5.

`relayIdsForPlayer` reads up to 1000 relay_players rows, then the second query
filters `.in("id", ids.slice(0, 1000))` and orders and limits to 5. The whole
id set is fetched and shipped in the URL so that 5 rows can come back, and the
tab is not cached (it uses the cookie client via `createClient()`).

Fix: order and limit at the join. relay_players has no timestamp, so either add
`source_posted_at` to the join table, or invert the hops: read the newest N
relays for the player through an embedded filter
(`.select("...").eq("relay_players.player_id", id)` is not expressible in
PostgREST, so a small RPC or a view is the clean answer). Failing that, at
minimum apply ID_BATCH.

Resolution: fixed in lib/relays/load.ts; loadRelaysForPlayer filters through the join and takes its five rows on the server.

### M5. The /brief hub is dynamic and now runs four more query groups per request

app/brief/(feed)/page.tsx:77 (`await createClient()`), 82-102.

The rendering mode did not change: the previous version (git HEAD) also used the
cookie-bound `createClient()`, so the hub was dynamic before and is dynamic now.
What changed is the work done per request. It is now, per reader:

- `loadRelaySidebar` (memoised 60 s, so near zero after the first miss)
- `loadRelayFeed` with `count: "exact"` plus `hydrate` (1 + 4 queries, and an
  exact count over the whole published set)
- `loadLatestBrief` (1 query, and it drags the `metadata` blob, see M3)
- `loadRelayWeeks` (memoised 60 s)
- `resolveTeam` / `resolvePlayer` when filters are present (1 each)

That is 6 to 8 uncached round trips per reader, roughly 300 to 400 ms of
database time, on the section's landing page.

Fix: the feed body is public data with no auth input. Move `loadRelayFeed`,
`loadLatestBrief` and the sidebar behind `createCachedReadClient()` and an
`unstable_cache` entry keyed on (filter, page) with a short revalidate and a
`relays` tag busted by `writeRelay`, exactly as lib/home-content.ts does for the
homepage. The only reason `createClient()` is needed here is habit; nothing on
this page reads the session.

Resolution: left. Moving the hub behind createCachedReadClient and an unstable_cache entry needs a tag busted by writeRelay and by every admin status change, and the rendering mode is unchanged from before this build. It is a caching design change, not a defect fix, and belongs in its own pass.

### M6. No index serves the tag feed's `contains` filter

lib/relays/load.ts:245 (`query.contains("tags", [filter.tag])`), reached from
app/brief/(feed)/tag/[tag]/page.tsx:62. Migration 0284_relays.sql:82-88 creates
five indexes on `relays` and none of them is on `tags`.

`tags @> '{x}'` without a GIN index is a sequential scan of `relays`, and the
page also asks for `count: "exact"`, which scans again. The sidebar surfaces 18
tags (lib/relays/load.ts:471-474), so these URLs are linked from every feed
page and will be crawled.

Fix: `create index if not exists idx_relays_tags on public.relays using gin (tags);`
in a new migration.

Resolution: fixed in supabase/migrations/0288_relays_perf_indexes.sql (idx_relays_tags, a GIN index on tags), applied through the Supabase MCP and verified in pg_indexes.

### M7. The relay permalink loads the relay twice and hydrates three times

app/brief/relay/[slug]/page.tsx:31 (generateMetadata) and :50 (the page), then
:76 `loadRelayChain`.

Next calls generateMetadata and the component separately for one request.
`loadRelayBySlug` is not memoised, so the relay row and its full `hydrate` (2
join reads plus up to 3 lookup reads) run twice. `loadRelayChain`
(lib/relays/load.ts:297-323) then calls `hydrate` twice more, once for the
earlier chain and once for the later one.

Count for a page with a two-link chain: 2 x 6 for the double load, plus 2
sequential walk queries, plus 1 later query, plus 2 x 5 hydrate = about 27
round trips, roughly 1.2 s of database time. Six to eight would do it.

Fix: two changes, both already patterned in this codebase.
1. Wrap the load in React `cache()` keyed on the slug and build the client
   inside, exactly as app/brief/[slug]/page.tsx:91-94 does for `getArticle`,
   with the comment there explaining why.
2. Hydrate once: gather the relay, the earlier rows and the later rows into one
   array and call `hydrate` a single time, then split the result.

Resolution: half fixed. app/brief/relay/[slug]/page.tsx wraps the load in React cache(), so generateMetadata and the page share one load and one hydrate. The second half, hydrating the relay and both chain arms in one call, was left: it means reshaping loadRelayChain's return and splitting the hydrated array back out, which is a refactor rather than a local fix.

### M8. loadRelayChain walks the earlier chain one query at a time

lib/relays/load.ts:301-310.

The `while` loop issues one `maybeSingle()` per link, up to 8, strictly
sequentially because each read supplies the next cursor. At 45 ms each that is
up to 360 ms of pure latency on the permalink, on top of M7.

Fix: a recursive CTE behind an RPC (`with recursive chain as (...)`) returns the
whole ancestor list in one round trip and is the only way to do this without
denormalising. A cheaper alternative, if the depth is genuinely small: store a
`root_relay_id` on `relays` at write time and read the chain with one
`eq("root_relay_id", ...)`.

Resolution: left. The sequential ancestor walk needs a recursive CTE behind an RPC or a root_relay_id column written at insert time; both are schema work with their own migration and neither is local. The chain is bounded at 8 links and the permalink's doubled cost is gone with M7.

## Minor

### m1. `select("*")` on `relays` in four places

lib/beacon-brief/curate.ts:220, lib/relays/write.ts:359 and :393,
scripts/backfill-relays.ts:135 (on `news_ingestions`, which carries the raw
source object in `metadata`).

`relays` carries a jsonb `facts` column and a 240-character headline, so `*` is
not catastrophic, but write.ts:393 and curate.ts:220 run on the curation hot
path once per post. The `news_ingestions` one in the backfill pulls the full
stored X payload per row. Name the columns; every other select in this build
does.

### m2. loadRelayWeeks silently caps at 1000 rows

lib/relays/load.ts:525-537. The select is `week` filtered by status and season
with `.limit(1000)`, then distinct in JS. A regular season at the plan's
measured rate (about 40 accepted posts a week, plan section 1) reaches 720 in
season and passes 1000 with the off-season and playoffs. Ordering is `week desc`
so the weeks that fall off are the earliest ones, which is the least bad
failure, but the week filter will quietly stop offering week 1. Use a
`select("week")` with `.order("week")` plus a distinct RPC, or read
`min(week)`/`max(week)` and enumerate.

### m3. relayIdsForPlayer and relayIdsForTeam cap at 1000 with no signal

lib/relays/load.ts:217 and :222. Same silent-truncation class as m2 and the
memory note on the 1000-row PostgREST default. Once a team passes 1000 relays
the feed starts omitting the oldest ones with no error. Subsumed by the M1 fix
if that is done properly.

### m4. loadLatestArticle passes up to 500 uuids in one `.in()`

lib/player-profile.ts:929-936. About 18 KB of URL at the cap, which is over the
practical PostgREST limit; and it fetches every id to take one row. Same shape
as M4, but it is wrapped in `unstable_cache` keyed on playerId with a five
minute revalidate (lib/player-profile-cache.ts:141-147), so the cost is paid
once per player per five minutes rather than per reader. That is why it is
minor rather than major.

### m5. `count: "exact"` on every feed page

lib/relays/load.ts:240. An exact count re-scans the matching set on every page
view, on a table that will reach tens of thousands of rows. The pagination UI
needs a total, so this is a deliberate trade, but `count: "planned"` or
`"estimated"` is the standard answer once the table is large. Revisit when
`relays` passes about 20,000 rows.

### m6. The permalink's 410 path spends an extra admin round trip on every miss

app/brief/relay/[slug]/page.tsx:53. Correct by design (a retracted relay is
invisible to the public policy), and it only runs when the public read missed,
so it costs nothing on the happy path. Noted so it is not mistaken for a bug.

### m7. writeRelay is about ten sequential round trips per accepted post

lib/relays/write.ts:86-94 (reference names, parallel), :130 (slug collision
check), :217 (existing relay), :242 (unique slug), :244 (insert), :270 (race
re-read), :291 and :301 (join upserts), :312-321 (moderation and log), :337
(queue insert). Most are strictly sequential. At 45 ms each that is roughly
450 ms per post.

This runs inside the five-minute curation cron against at most a handful of
posts per tick, so it is not a user-facing cost. The two cheap wins are running
the join upserts in one `Promise.all` (they are independent) and folding the
slug collision check into the insert with an `on conflict` retry, which removes
two of the ten.

### m8. The curation path's added reads per post, and which are memoised

Measured from lib/beacon-brief/curate.ts:

- `loadBriefDeskSettings(admin)` at :111, once per post inside
  `buildClassifySystemPrompt`. Memoised through `memoTtl` for 60 s
  (lib/brief-desk/settings.ts imports memo-ttl and the header says so), so this
  is 1 round trip per minute per process, not per post.
- `nflStateOrNull()` at :1103 and :1366, which calls `getNflState()`. Memoised
  inside lib/sleeper.ts:632-644 with a TTL and an in-flight coalescer. Zero
  extra HTTP per post after the first.
- The grounding check, `checkRelayGrounding`, is pure. Zero round trips.
- The Relay duplicate passes (lib/relays/duplicates.ts) add, per post, exactly
  one of three paths: exact match (1 ingestion read + 1 relays read + 2 join
  reads = 4), overlap (same 4, and it now runs in `Promise.all` beside the
  article pass at curate.ts:132-142), or recent fallback (same 4). So 4 extra
  round trips per post, about 180 ms, and never more than one path.
- `writeRelay` adds the ten in m7.

Total added per accepted post: about 14 round trips, roughly 630 ms, of which
none are per-post-avoidable except the m7 items. Neither settings nor NFL state
is re-read per post. This is well inside a five-minute cron budget.

`recentRootIngestions` (duplicates.ts:83-100) filters
`is_revision`, `status in (...)`, `created_at >= cutoff` and optionally
`event_key like 'kind:%'`. The prefix LIKE cannot use
`news_ingestions_event_key_idx` (0177:118) because that index is a default
collation btree, but `idx_news_ingestions_created` (0086:78) serves the
`created_at` bound and the 72-hour window is about 120 rows, so no new index is
needed. Noted because it looks like a missing index and is not one.

### m9. The worker's extra reads per Discord job

lib/beacon-brief/worker.ts, from the diff: `loadRelayForJob` (1 read) plus
`buildRelayDiscordMessage` which calls the reference-name loader (2 reads).
A `discord_patch` for a merge does it twice, once per side, plus
`loadRelayForIngestion` for the new side. So 3 extra reads on a post job and up
to 7 on a patch job, about 135 to 315 ms, on a worker that drains one job a
minute. The Brief post path (`postBriefDiscord`) adds an article read, a
`brief_editions` read and a conditional claim update, which is 3 reads once per
published edition.

### m10. The bundle's season-to-date read is the largest single query in the build

lib/brief-desk/bundle.ts:321-341. `loadSeasonToDate` pages `player_stats` for
every player for every week up to the current one: roughly 2,000 players times
18 weeks is 36,000 rows at the end of a season, 36 pages at `PAGE = 1000`, about
1.6 s and a few MB. `loadWeekLines` (:304-316) adds about 2 more pages, and the
two `loadFormatTrend` calls (:274-300) add about 2 pages each.

The whole `assemble` is memoised for ten minutes on the period key
(BUNDLE_TTL_MS at :60, the memo at :644-645), and the route is rate limited to
10 per hour per token, so this is paid once a week plus retries. `MAX_PAGES = 80`
(:62) leaves headroom over the 36 pages. This is correct as built; it is listed
so the cost is on the record and so nobody moves this read onto a request path.

### m11. The two one-off scripts page correctly but are N+1 inside the page

scripts/backfill-relays.ts:201-208 pages `news_ingestions` with
`range(from, from + 999)` in a `for` loop, correct. Inside the row loop it then
issues 3 to 4 reads per article (:253-255 article_players, article_teams,
articles category) plus the `select("*")` at :135, so a 316-article backfill is
roughly 1,300 round trips, about 60 s. scripts/archive-legacy-articles.ts:32-39
pages correctly and then does 2 reads per article at :51-58, about 1,000 round
trips.

Both are one-off, both are explicitly not wired into a cron, and the CLAUDE.md
rule about backfills is respected. The fix if either is ever re-run at scale is
to batch the per-article reads by chunking the ids at 300, the same ID_BATCH
this build already uses everywhere else. Not worth doing for a script that runs
once.

## Index coverage, query by query

New query shapes against migrations 0284, 0286 and 0287.

| Query | Filter and order | Index | Covered |
| --- | --- | --- | --- |
| loadRelayFeed, unfiltered | status = published, order source_posted_at desc | idx_relays_status_posted | yes |
| loadRelayFeed + kind | status, kind, order source_posted_at desc | idx_relays_status_posted, kind filtered in the heap | partly; fine at current size |
| loadRelayFeed + season/week | status, season, week, order source_posted_at desc | idx_relays_season_week_posted | yes |
| loadRelayFeed + tag | status, tags @> | none | NO, see M6 |
| loadRelayFeed + player/team | status, id in (...) | primary key | yes, but see M1 |
| loadRelayBySlug | slug | unique constraint on slug | yes |
| loadRelayChain, earlier | id | primary key | yes |
| loadRelayChain, later | follows_relay_id, status, order source_posted_at | idx_relays_follows | yes |
| loadRelaysByIds | id in (...), status | primary key | yes |
| loadRelayWeeks | status, season, week not null, order week desc | idx_relays_season_week_posted | yes |
| loadRelaySidebar recent | status, order source_posted_at desc, limit 200 | idx_relays_status_posted | yes |
| relayIdsForPlayer | relay_players.player_id | idx_relay_players_player | yes |
| relayIdsForTeam | relay_teams.team_id | idx_relay_teams_team | yes |
| relaysByIngestion (duplicates) | ingestion_id in (...), status in (...) | unique on ingestion_id | yes |
| countPeriodRelays, loadPeriodRelays | status in (...), source_posted_at range | idx_relays_status_posted | yes |
| loadPeriodEditions | brief_editions season, period_end | idx_brief_editions_period | yes |
| extendForRolledPeriods | brief_editions article_id in (...) | unique on article_id | yes |
| loadPublishedEdition | brief_editions article_id | unique on article_id | yes |
| loadLatestBrief, loadPublishedBriefs | articles status, article_type, order published_at desc | idx_articles_status, idx_articles_type, idx_articles_published_at (three single-column) | partly; the planner will pick one and filter. A composite on (article_type, status, published_at desc) would serve every edition read on the site |
| legacy redirect lookup | legacy_article_redirects | see 0286 | not audited beyond the table existing |

Two recommendations fall out of this table: the GIN index in M6, and a
composite `create index idx_articles_brief on public.articles (article_type,
status, published_at desc)`, which serves loadLatestBrief, loadPublishedBriefs,
the bundle's `previous_editions` read (bundle.ts:536-543) and
`extendForRolledPeriods` (:156-162).

## Caching

Audited every memoTtl key and unstable_cache entry the build adds or changes.
No user-scoped or auth-dependent read is memoised across readers. Nothing here
is a blocker.

memoTtl keys:

- `ref:relays:sidebar`, 60 s, lib/relays/load.ts:443. Public relay and category
  data. The client captured in the closure is the first caller's cookie-bound
  client, which is the same pattern the previous `loadSidebar` used. RLS gives
  anon and authenticated identical results here (0284's `relays_select_public`
  is `status = 'published'` for both roles), so the shared answer is the same
  answer for every reader. Safe, and matches the memo-ttl header's rule.
- `ref:relays:weeks:{season}`, 60 s, :526. Same reasoning.
- `settings:brief_desk` via loadBriefDeskSettings, 60 s. Admin-editable global
  settings, busted by the save action. This is exactly the case memo-ttl exists
  for.
- `brief-desk:bundle:{periodStart}|{periodEnd}|{live|override}`, 10 minutes,
  bundle.ts:59-60 and 644-645. The key is the period plus whether an override
  was used, which is the right key: an override can name a different period and
  is deliberately kept apart from the live answer. The bundle contains no
  reader-scoped data (the only caller is the desk token). The `previous_attempt`
  and `instructions` fields are deliberately re-read outside the memo and
  spliced over the cached object at :648, which is correct and is commented.
  Memory footprint is bounded: one live key plus at most a few override keys,
  each a few hundred KB, all expiring in ten minutes.
- `ref:sources` and `ref:formats`, reached from bundle.ts:275 and :547. Already
  memoised in lib/source.ts:39 and :62 behind React `cache()` as well, so the
  six calls `assemble` makes cost one round trip each per TTL.

unstable_cache:

- lib/home-content.ts:90, key `home-content-v2`, revalidate 300, tag `home`.
  The key was correctly bumped from `home-content` because the shape changed;
  without that bump the first render after deploy would have read an article
  array as a brief. The tag is busted by lib/brief-desk/publish.ts on approve,
  which the header documents. Reads through `createCachedReadClient()` so no
  cookies are touched. Correct.
- lib/player-profile-cache.ts:141, key `["player-latest-article", playerId]`,
  revalidate 5 minutes, tag `playerArticles`. Public, keyed on the player.
  Correct. One note, not a performance finding: nothing in `writeRelay` calls
  `revalidateTag(CACHE_TAGS.playerArticles)`, so a new relay takes up to five
  minutes to reach the profile teaser. That is the documented TTL behaviour,
  not a regression.

Revalidate values on changed pages:

- /brief (hub) and its four filter siblings: no revalidate, dynamic via
  `createClient()`. Unchanged from before, see M5.
- /brief/[slug]: `revalidate = 300` and `generateStaticParams`, unchanged. The
  edition branch (:134 onward) is added inside the same cached route, so
  editions inherit the 300 s ISR and the prerender. Correct.
- /brief/editions: `revalidate = 300`. New, correct.
- /brief/relay/[slug]: no revalidate, dynamic. This is the one new public route
  with no caching at all, and it is the one with the worst per-view cost (M7,
  M8). A `revalidate = 300` here would be safe (the content is a frozen record
  of one report) and would remove both findings' cost for repeat views.
- /brief/rss.xml `revalidate = 3600`, /brief/relays.xml `revalidate = 900`,
  both reading through `createCachedReadClient()`. Correct, and relays.xml's
  100-row limit stays under ID_BATCH so its hydrate is one batch.
- The five admin pages and the two API routes are all `force-dynamic`, which is
  right for both.

## Client bundle weight

Three client blocks, all under components/brief-desk/blocks/:

- top-scorers.tsx, 182 lines, `useState` plus three lucide icons.
- format-toggle.tsx, 121 lines, `useId` and `useState`.
- return-planner.tsx, 111 lines, `useId` and `useState`.

About 414 lines, call it 4 to 6 KB gzipped plus three tree-shaken lucide icons.
No chart library, no date library, no state manager crosses the boundary. All
three take plain serialised data, and each renders its default state on the
server, which is what plan 11.2 requires.

Nothing server-renderable was made a client component. The two checks that
matter both pass:

- return-planner.tsx imports `TimelineRow` from ./injury-timeline as
  `import type`, so the 190-line injury-timeline module is erased at compile
  time and does not follow the client boundary. If that ever becomes a value
  import, injury-timeline joins the client bundle.
- The relay components (relay-card, relay-chain, relay-filters,
  latest-brief-panel, 386 lines) are all server components, as is
  components/beacon-brief/brief-feed.tsx. Correct.

One weight note that is not a client-bundle cost but is a payload cost: the
client blocks receive their whole `BundleDataset` as props, which is serialised
into the RSC flight payload for the page. `top_scorers` is capped at 20 rows per
position across six positions and `value_movers_by_format` at 15, so the worst
case is a few tens of KB. Acceptable, and bounded by the validator's own limits
in plan 11.2. Worth re-checking if a future block kind accepts an unbounded
dataset.

## What is right, and should not be changed

Recorded so a later pass does not "fix" these.

- `hydrate` (lib/relays/load.ts:119-209) is four batched reads for a whole page
  of cards, never one per card, and it chunks at ID_BATCH. This is the correct
  shape and the header says so.
- `pageAll` in bundle.ts:85-98 builds a fresh query per page through a factory,
  which is the right way to page PostgREST (the builder mutates), and stops on
  a short page. Every read in that file that can exceed 1000 rows goes through
  it, which is the 1000-row rule honoured.
- The bundle's cheap due-checks run outside the memo and the heavy assembly runs
  inside it (bundle.ts:615-648). That is the correct split: the answer to "is an
  edition due" moves the moment a draft lands, without rebuilding 40 pages of
  player stats.
- The duplicate passes run the article and relay lookups in one `Promise.all`
  (curate.ts:132-142 and :153-157) rather than serially.
- `loadPublishedEdition` (lib/brief-desk/edition-data.ts:112-131) runs its two
  independent reads in parallel and then its two dependent reads in parallel,
  and it names its columns on the admin-client read so the review material never
  leaves the database.

## Writing check

Ran the AI-writing checklist over this document. One pattern was in the first
draft and was changed: the M5 heading read "not just slower, but slower per
reader", which is negative parallelism. It now states the count of round trips
instead. No em dashes, en dashes, curly quotes, ellipsis characters or emoji
appear in this file.

## Resolution of the minors

- m2: fixed. loadRelayWeeks pages rather than capping at 1000, so the early
  weeks of a busy season stay in the filter.
- m3: fixed by the M1 change; the id pre-queries no longer exist.
- m1, m4, m5, m6, m7, m8, m9, m10, m11: left. m1 would change what
  loadRelayForIngestion and updateRelayText return, which is the RelayRow
  contract rather than a local select. m4 is already bounded by a five-minute
  unstable_cache entry per player. m5 is a deliberate trade the report agrees
  with and is not due until relays passes about 20,000 rows. m6, m9 and m10 are
  recorded as correct by design. m7 saves two of ten round trips on a
  five-minute cron. m8 and m11 are measurements, not findings.

An index the report did not ask for but the table implied was added in the same
migration: idx_articles_brief on (article_type, status, published_at desc),
which serves loadLatestBrief, loadPublishedBriefs, the bundle's
previous_editions read and extendForRolledPeriods.
