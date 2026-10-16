# Relays and Briefs: performance review, pass 2

Read-only audit, 2026-09-17, of the uncommitted working tree after the first
pass (docs/beacon-brief/reviews/performance.md) and after the same-day changes
the first pass never saw: the four sibling feed routes taking kind and week,
lib/relays/feed-params.ts, the bundle's sourceKey, and the About page count.
Same cost model as the first pass: 45 to 50 ms per Supabase round trip.

Every finding below was verified by reading the file. Where the finding is
about a query shape, it was also verified with EXPLAIN (ANALYZE, BUFFERS)
against the live project as the anon role, so RLS is in the plan. Nothing was
edited and nothing was written to the database.

Live table sizes at the time of the audit: 725 relays (660 published), 1,114
relay_players rows, 889 relay_teams rows, 528 articles, 0 published editions,
2 distinct weeks with published Relays.

## Scope

- Every "Resolution: fixed" in performance.md, checked against the code.
- The four feed routes under app/brief/(feed)/ and lib/relays/feed-params.ts.
- lib/brief-desk/bundle.ts sourceKey and the memo key.
- app/about/page.tsx loadSiteCounts.
- The rest of the build for what the first pass missed.

## Counts

- Blocker: 0
- Major: 2
- Minor: 9

## Verification of the first pass's fixes

- M1 and M4 (player and team feeds, loadRelaysForPlayer): applied as
  described. lib/relays/load.ts:245-246 define the inner-join embeds,
  :262-277 build the filtered select, :346-361 take five on the server. No id
  list reaches the URL. The fix is functionally correct. Its query plan is
  the subject of major finding 1 below.
- M2 (admin editions list): applied. app/admin/brief-desk/editions/page.tsx:36
  selects word_count as validation_report->>word_count and warnings as
  validation_report->warnings; content_md is not in the select.
- M3 (BRIEF_SELECT projects two keys out of metadata): applied.
  lib/relays/load.ts:436-437. Both loadLatestBrief (:440) and
  loadPublishedBriefs (:453) use it.
- M6 (GIN index on tags): applied. supabase/migrations/0288_relays_perf_indexes.sql:33
  and present in pg_indexes on the live project as idx_relays_tags.
- M7 first half (React cache around the permalink load): applied.
  app/brief/relay/[slug]/page.tsx:41. generateMetadata (:45) and the page
  (:64) share one load.
- m2 (loadRelayWeeks pages): applied. lib/relays/load.ts:561-572 loops on
  range() in pages of 1000 and stops on a short page. Memoised for 60 s on
  the key ref:relays:weeks:{season} (:555). Verified with EXPLAIN: an index
  scan backward on idx_relays_season_week_posted, 131 buffers, 0.3 ms.
- The composite idx_articles_brief (article_type, status, published_at desc)
  is applied and present in pg_indexes.

## Major

### 1. The embedded inner-join filter scans every published Relay, not the player's or team's

lib/relays/load.ts:262-281 (loadRelayFeed with playerId or teamId) and
:353-359 (loadRelaysForPlayer). Reached from app/brief/(feed)/player/[slug]/page.tsx:62,
app/brief/(feed)/team/[abbr]/page.tsx:63, app/brief/(feed)/page.tsx:82 with
?team= or ?player=, and components/player-profile/beacon-brief-tab.tsx:26 on
every view of a player profile's Beacon Brief tab (app/players/[slug]/page.tsx:328,
a force-dynamic page).

PostgREST implements a filter on an embedded to-many resource as a LATERAL
subquery on the child table, and a lateral subquery can only be evaluated
after its outer row exists. So the planner has no choice: relays is the
driving table, and idx_relay_players_player and idx_relay_teams_team are
never used by this shape. EXPLAIN as anon for the busiest player today (17
Relays):

- Index Scan using idx_relays_status_posted on relays, 660 rows.
- For each of the 660 rows, an Index Only Scan on relay_players_pkey for
  (relay_id, player_id) plus the RLS EXISTS probe on relays_pkey for each hit.
- 1,942 shared buffers, 26.4 ms execution.

The same query written the other way round, driving from relay_players with
relays embedded (the shape the fix at the bottom describes):

- Bitmap Index Scan on idx_relay_players_player, 17 rows, then 17 PK probes
  on relays.
- 113 shared buffers, 3.5 ms.

Cost: the work is proportional to the published set, not to the entity's set,
and the count: "exact" half of the same statement cannot stop early, so every
page of a player or team feed walks the whole published table once for the
count and once more for the page. At 660 Relays that is 26 ms per request.
The plan's own rate (about 40 accepted posts a week, section 1) puts the table
at 3,000 by next spring and 10,000 or more a season later, at which point each
player feed page, each team feed page and each profile tab view is a 200 to
400 ms scan. team plus week is not affected: with a week filter the planner
drives from idx_relays_season_week_posted (19 rows, 5.5 ms) and the lateral
probe is cheap.

Fix: drive from the join table. Two ways, either is fine.

1. Flip the query. Select from relay_players (or relay_teams) with relays
   embedded as a to-one inner join, filter on the join table's own column,
   filter status on the embed, and order by the embedded column:
   `.from("relay_players").select("relays!inner(" + RELAY_SELECT + ")", { count: "exact" }).eq("player_id", id).eq("relays.status", "published").order("relays(source_posted_at)", { ascending: false }).range(from, to)`.
   PostgREST orders a parent by a to-one embedded column with the
   `relays(source_posted_at).desc` syntax; confirm the deployed version
   accepts it (it has since v10). Unwrap `row.relays` before hydrate.
   relay_players has a unique (relay_id, player_id), so the count stays a
   count of Relays.
2. A view, `relay_player_feed` and `relay_team_feed`, defined as the join of
   relays to its join table with `security_invoker = true` so the 0284
   policies still apply, and the same select, filter, order and range
   against it. This is the cleaner answer if the order syntax in 1 turns out
   to be awkward.

Either way the plan becomes the second EXPLAIN above, and the cost follows
the entity's own Relay count.

### 2. The hub runs a service-role head count on every request, after the page's data has loaded

components/beacon-brief/brief-feed.tsx:101-104 calls hasPublishedEditions()
(lib/sitemap/sections.ts:186-195) whenever active.type is "all", which is
every /brief hub request, filtered or paged. The function builds
createAdminClient() and runs an exact head count on articles. It is not
memoised and not wrapped in cache(). BriefFeed is rendered after
app/brief/(feed)/page.tsx:80-87 has awaited its four loads, so this round
trip is sequential, not parallel with them: it adds its full latency to the
hub's time to first byte.

Cost: one round trip, about 45 ms, per hub view, on top of the 6 to 8 the
first pass recorded under M5. The query itself is cheap (EXPLAIN: 2 buffers
through idx_articles_status); the cost is entirely the round trip.

The same function is called from /brief/editions generateMetadata (ISR, 300 s)
and from the sitemap index (ISR, 3600 s), where it costs nothing per reader.

Fix: the answer is public, identical for every reader, and changes only when
an edition is approved. Wrap the body of hasPublishedEditions in
memoTtl("ref:brief:has-editions", 60_000, ...) in lib/sitemap/sections.ts.
That serves all three callers. If a same-request answer is preferred over a
minute of lag, the hub already loads latestBrief on page 1 (page.tsx:83-85)
and `latestBrief !== null` is the same fact; pass it down and skip the call
when it is known. Either removes the round trip from the hub's critical
path. A separate note for the security reviewer, not a performance finding:
this is a service-role client built inside a public render path for a
question the anon client can answer.

## Minor

### m1. resolvePlayer runs twice per player-route request

app/brief/(feed)/player/[slug]/page.tsx:25 (generateMetadata) and :57 (the
page) each build their own client and call resolvePlayer
(lib/beacon-brief-feed.ts:270-295), which is neither memoTtl'd nor wrapped in
cache(). resolveCategory (:251) and resolveTeam (:303) are memoised for 60 s,
so the category and team routes pay nothing after the first minute; the
player route pays one extra round trip per request, and the hub pays it too
when ?player= is set (page.tsx:64), though there only once.

Fix: in the player route, `const getPlayer = cache(async (slug: string) => resolvePlayer(await createClient(), slug))`
and call it from both places, the pattern app/brief/relay/[slug]/page.tsx:41
already uses. Do not memoTtl it: the key would be a URL-controlled string
(see m6).

### m2. The edition page reads the article and its two join tables twice

app/brief/[slug]/page.tsx:172 loads the article through getArticle, then
:183 calls getEdition, which calls loadPublishedEdition
(lib/brief-desk/edition-data.ts:106-109), which calls loadArticle again:
the articles row plus article_players plus article_teams, three round trips
already paid. It then reads articles a third time at :118 for metadata,
season and week.

Cost: three duplicate round trips, about 140 ms, per revalidation of an
edition page (the route is ISR at 300 s with generateStaticParams, so this is
per five minutes per edition, not per reader), and the same three on the
first request after deploy for every prerendered edition.

Fix: give loadPublishedEdition an optional `article?: FullArticle` parameter
and pass the one getArticle already holds; fold season and week into the
metadata read (they are on the same row) so :118 stays one query.

### m3. The OG route selects the whole metadata jsonb for three tiles and two dates

app/api/og/brief/[slug]/route.tsx:55-59 selects `metadata`, and for an
edition parseEditionMetadata (lib/brief-desk/edition-metadata.ts:93) parses
every dataset in it to use statTiles, periodStart, periodEnd, phase and
formats. The datasets are the tens of kilobytes the first pass's M3 was
about.

Cost: about 40 KB transferred and parsed per render, three ratio variants
per edition, cached for an hour at the edge and 300 s in the browser. Small
in absolute terms, listed because it is the one remaining reader of the
whole column that does not need it.

Fix: project the keys the card uses, as BRIEF_SELECT does:
`period_start:metadata->>period_start, period_end:metadata->>period_end, phase:metadata->>phase, stat_tiles:metadata->stat_tiles, formats:metadata->formats`,
and feed those to a small parse rather than parseEditionMetadata. Fall back
to the tiles dataset only if stat_tiles is empty, which today means a second,
rare read.

### m4. The admin Relays page's week list is capped at 1000 with no signal

app/admin/brief-desk/relays/page.tsx:42 reads `week` from every Relay of
every status and season, ordered week desc, `.limit(1000)`, then dedupes in
JS. This is the shape the first pass's m2 fixed in loadRelayWeeks; the admin
copy kept it. Past 1000 Relays the earliest weeks fall off the filter
silently, and it is not filtered by season, so week 2 of two seasons is one
option.

Cost: correctness of the filter rather than time; the read itself is one
index scan.

Fix: page it the way loadRelayWeeks does (lib/relays/load.ts:561-572), or
scope it to the current season with `.eq("season", currentNflSeason())`,
which also makes the option list mean one thing. An admin page can also
afford a `select distinct` through a tiny RPC.

### m5. Bundle memo entries are never evicted once their key stops being asked for

lib/brief-desk/bundle.ts:691-693 builds the key from the period, the override
flag and the sources; lib/memo-ttl.ts:28-38 stores the promise and only ever
replaces an entry when the SAME key misses. An expired entry under a key
nobody asks for again is never deleted. Every new period, every source flip
and every distinct override therefore leaves the previous bundle (a few
hundred KB, plan 9.2 says under 300 KB) referenced for the life of the
process.

Cost: bounded. About 30 periods a season, a handful of override keys, at
most a few sources: single-digit MB per long-lived process, and a Vercel
function instance does not live that long. Listed because the first pass
recorded the footprint as "all expiring in ten minutes", which is true of
the TTL and not of the memory.

Fix: in buildBundle, call `bustMemo(BUNDLE_MEMO_PREFIX)` before `memoTtl(key, ...)`
whenever the key is not the one currently stored (one live bundle at a time
is the intent), or teach memoTtl to delete expired entries it walks past.
The second is a change to a shared helper and belongs in its own pass.

### m6. memoTtl keys built from URL-controlled slugs, with no eviction

lib/beacon-brief-feed.ts:260 (`ref:brief:category:${slug}`) and :308
(`ref:brief:team:${key}`) memoise on whatever the address bar supplied, and
the team route (app/brief/(feed)/team/[abbr]/page.tsx:25 and :58) passes the
raw segment with no length cap (the hub slices it to four characters at
page.tsx:63; the route does not). Combined with m5's no-eviction property, a
crawler walking /brief/team/{anything} adds one small entry per distinct
string to the process Map for as long as the process lives.

This shape predates the build (both memos are in git HEAD), and the entries
are tiny, so it is a note rather than a defect in this build. The new
feed-params.ts caps the hub's values (:55-56) but the four routes take their
segment from params, not from it.

Fix: cap the segment in the route before resolving (`abbr.toUpperCase().slice(0, 4)`,
`slug.slice(0, 80)`), and prefer React cache() over memoTtl for anything
keyed on request input, as m1 says.

### m7. loadLatestArticle, recorded as m4 in the first pass and left, has a cheaper fix than it did

lib/player-profile.ts:924-648 (the relay_players read at :928-934 and the
relays read at :936-943) still reads up to 500 relay ids for a player with no
order, then `.in("id", ids)`. The first
pass left it because lib/player-profile-cache.ts:141-147 wraps it in a five
minute unstable_cache per player. Not re-argued here. Noted only because the
fix for major finding 1 is the same fix: one query from relay_players with
relays embedded, `.order("relays(source_posted_at)", { ascending: false }).limit(1)`,
which also removes the unordered 500-row read.

### m8. About page counts that could come from memoised reference reads

app/about/page.tsx:85-100 runs three uncached round trips per request on a
dynamic page: a head count of active format_configs, the active
source_registry names, and the published editions head count (the one
change this build made, :96-99). getActiveFormats and getAvailableSources
(lib/source.ts:39 and :62) already hold the first two for 60 s in every
process and would answer `formats.length` and the display names with no
round trip. The editions count is served by idx_articles_status today and by
idx_articles_brief as the table grows; it is correctly indexed.

Cost: two of three round trips, about 90 ms per /about view. The shape
predates this build; only the filter is new.

Fix: `const [formats, sources] = await Promise.all([getActiveFormats(supabase), getAvailableSources(supabase)])`
and keep only the editions count as a live query, or memoTtl that count
alongside major finding 2's fix.

### m9. The 404 path of /brief/[slug] now costs a service-role lookup

app/brief/[slug]/page.tsx:175-179 calls lookupLegacyArticleRedirect with an
admin client when the public read misses. Correct by design (the table is
service-role only, migration 0286) and it runs only on a miss, keyed by the
primary key on article_slug. Same class as the first pass's m6: recorded so
it is not mistaken for a bug.

## sourceKey in lib/brief-desk/bundle.ts, verified

lib/brief-desk/bundle.ts:617-634 runs before the memo on every buildBundle
call. Its round trips:

- getAvailableSources(admin) (lib/source.ts:39): memoTtl "ref:sources", 60 s,
  and React cache() inside a request. One round trip per minute per process.
- loadPowerPulseSettings(admin) (lib/power-pulse/settings.ts:32): memoTtl
  "settings:power_pulse", 60 s. One round trip per minute per process.
- resolveProjectionSourceForWindow (lib/projections/source.ts:229-247):
  returns SLEEPER_SOURCE with zero queries while settings.beaconProjections.enabled
  is false, which is production today. Once enabled, two head counts per
  window, memoised 60 s in coverageMemo with a 24-entry cap (:129-131).
- resolveSourceForFormat is pure.

So sourceKey is zero to two round trips per minute, and zero per call inside
the minute. The key is `${values.join(",")}|${projection}` where values is one
slug per EDITION_FORMAT_SLUGS entry (two) drawn from the fixed registry, and
projection is one of two constants or "none". It cannot grow without bound.
The whole memo key, with the period and the override flag, is bounded by
periods times sources; see m5 for what happens to entries the key stops
naming.

The cheap due-checks (loadPeriodEditions, two round trips; extendForRolledPeriods
and countPeriodRelays, off-season only) still run outside the memo as the
first pass recorded.

## Index coverage, every new or changed query shape

Verified with EXPLAIN (ANALYZE, BUFFERS) as anon on the live project unless
marked "by inspection".

- loadRelayFeed, no filter: idx_relays_status_posted in order. Covered.
- loadRelayFeed, kind only (hub, and every route with ?kind=): idx_relays_status_posted
  in order, kind filtered in the heap. For kind=contract, 341 rows were
  skipped to find 30, 311 buffers, 0.5 ms. Covered well enough; the exact
  count walks the published set regardless.
- loadRelayFeed, season plus week (hub ?week=, every route ?week=):
  idx_relays_season_week_posted. Covered.
- loadRelayFeed, category plus week: BitmapAnd of idx_relays_season_week_posted
  and idx_relays_category, 9 buffers, 1.5 ms. Covered.
- loadRelayFeed, category plus kind, no week: idx_relays_category or
  idx_relays_status_posted with heap filters, by inspection. Covered.
- loadRelayFeed, tag, tag plus kind, tag plus week: idx_relays_tags (GIN) is
  present. The planner chose a sequential scan at 725 rows (109 buffers,
  0.65 ms), which is the right choice at this size; it will move to a bitmap
  scan on the GIN as the table grows. Covered.
- loadRelayFeed, player or team, no week: NOT served by idx_relay_players_player
  or idx_relay_teams_team. Driving scan is the whole published set on
  idx_relays_status_posted with a lateral PK probe per row. See major 1.
- loadRelayFeed, team plus kind plus week: idx_relays_season_week_posted
  drives (19 rows), lateral probe on relay_teams_pkey per row, 87 buffers,
  5.5 ms. Covered.
- loadRelaysForPlayer: same shape as player feed, no week. See major 1.
- loadRelayWeeks: idx_relays_season_week_posted backward, 131 buffers,
  0.3 ms. Covered.
- hydrate: relay_players_pkey and relay_teams_pkey by relay_id prefix,
  news_categories, relays and articles by primary key. Covered, by inspection.
- loadRelayChain: relays_pkey and idx_relays_follows. Covered, by inspection.
- loadLatestBrief, loadPublishedBriefs, rss.xml, sitemap sections,
  bundle previous_editions, extendForRolledPeriods: idx_articles_brief
  (article_type, status, published_at desc). Covered.
- About page editions head count: the planner used idx_articles_status and
  filtered article_type (1 row removed, 2 buffers); idx_articles_brief is
  available when the published set is large enough to prefer it. Covered.
- hasPublishedEditions: same as the About count. Covered; the cost is the
  round trip (major 2), not the plan.
- loadPeriodEditions: idx_brief_editions_period (season, period_end desc).
  Covered.
- Admin editions list, order by period_end desc with no filter: no index
  serves a plain period_end order; at the 200-row cap it is a small sort.
  Acceptable.
- Admin Relays list: status, kind, week, headline ilike, optional team
  embed: idx_relays_status_posted or idx_relays_season_week_posted, ilike in
  the heap. The team embed has the same shape as major 1, on an admin page
  at 50 rows a page. Acceptable for an admin surface.
- lookupLegacyArticleRedirect: legacy_article_redirects_pkey. Covered.
- countPeriodRelays, loadPeriodRelays: status in (...) plus a source_posted_at
  range: idx_relays_status_posted. Covered, by inspection.

## Caching, every memoTtl and unstable_cache key touched by the build

- ref:relays:sidebar, 60 s: public, RLS-identical for anon and authenticated.
  Correct (unchanged from pass 1).
- ref:relays:weeks:{season}, 60 s: confirmed at lib/relays/load.ts:555, now
  called by all five feed routes. Correct.
- ref:brief:category:{slug} and ref:brief:team:{abbr}, 60 s: public; see m6
  for the key-growth note.
- settings:brief_desk, settings:power_pulse, ref:sources, ref:formats, 60 s:
  admin-edited reference data. Correct.
- brief-desk:bundle:{start}|{end}|{live|override}|{sources}, 10 min: the
  source is in the key, which satisfies the CLAUDE.md rule for a cache that
  outlives a flip. See m5 for eviction.
- home-content-v2, 300 s, tag home: public, cookie-free client, busted on
  approve. Correct.
- player-latest-article, 300 s per player: public. Correct.
- No unstable_cache or memoTtl entry in the build holds a user-scoped or
  cookie-dependent read. Nothing new here is cached that should not be. The
  things that could be cached and are not are major 2 and m1.

## Client bundle and RSC payload

Unchanged from the first pass: the only client components in the build are
components/brief-desk/blocks/top-scorers.tsx, format-toggle.tsx and
return-planner.tsx, plus the two admin managers (relays-manager.tsx,
edition-review.tsx) and the admin subnav. Every Relay component
(components/relays/*), brief-feed.tsx, relay-filters.tsx, edition-page.tsx
and render-block.tsx are server components. RelayFilters is a plain GET form
with no client state, which is the right shape for a shareable filter.

The client blocks receive one BundleDataset each as props, capped by the
validator at 20 rows per position and 15 movers per format, so the flight
payload stays in the tens of KB. The admin edition review page passes the
whole draft, research log and cited Relays to a client component, which is
an admin page and fine.

## What is right and should not be changed

- The inner-join fix for M1 and M4 is the right shape for the URL; only the
  join direction needs to change (major 1). Do not go back to the id list.
- loadRelayWeeks paging (lib/relays/load.ts:561-572) is correct and the
  memo key is right. Leave it.
- feed-params.ts is pure, bounds every value it parses, and is the single
  parser for all five routes. Leave it.
- BRIEF_SELECT's jsonb projection is the model for m3. Leave it.
- The bundle's sourceKey runs before the memo on purpose and costs zero round
  trips inside a minute; it must stay before the memo, because a key computed
  after the memo lookup cannot invalidate anything.
- hydrate stays four batched reads per page at ID_BATCH. Leave it.
- The cheap due-checks outside the memo and the heavy assembly inside it.
  Leave the split.
- The retracted-permalink lookup and the legacy-redirect lookup both run
  only on a public miss. Leave them.
- app/brief/editions/page.tsx reads through createCachedReadClient with
  revalidate 300, and relays.xml through the same client at 900 with a
  100-row limit under ID_BATCH. Both correct.
- The five admin pages and the two API routes are force-dynamic, which is
  right for both.

## Writing check

Ran the AI-writing checklist over this file. Two patterns were in the first
draft and were changed: a heading read "not the entity's set, but the whole
table", which is negative parallelism, and now states the two plans side by
side; and one sentence opened with "Ultimately", which was cut. No em dashes,
en dashes, curly quotes, ellipsis characters or emoji appear in this file.

## Resolutions, 2026-09-17

- Major 1: fixed. lib/relays/load.ts loadFeedThroughJoin drives the player
  and team feeds from relay_players or relay_teams with the Relay embedded,
  ordered by the embedded column, ranged and counted on the server; both
  filters together ride on a nested inner join. loadRelaysForPlayer and
  lib/player-profile.ts loadLatestArticle use the same shape. Every shape was
  probed against the live project with the anon key before the change landed.
- Major 2: fixed. hasPublishedEditions is memoised for a minute and busted
  by approveEdition.
- m1: fixed (React cache() around resolvePlayer on the player route).
- m2: fixed (loadPublishedEdition takes the already-loaded article).
- m4: fixed (the admin week list is paged).
- m5: fixed (the bundle evicts its predecessors; memoTtl sweeps expired keys).
- m6: fixed (the team segment is bounded and shaped before resolveTeam).
- m7: fixed with major 1.
- m3, m8, m9: left. m3 because the OG route's fallback tiles come from the
  datasets key it would have to drop; m8 is the About page, outside this
  build; m9 is correct by design.
