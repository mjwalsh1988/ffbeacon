# FF Beacon: site-wide speed audit, and the plan to make it faster

Status: AUDIT AND PLAN. Nothing in this document has been built. Written
2026-09-08 against `main` at `ffb32a7`, from the production build of
2026-09-06 (`BUILD_ID NfuePAErfvfFe9I-F9YwR`), the production database's
`pg_stat_statements` ledger (accumulating since 2026-05-16 21:56 UTC, 115
days), the Supabase API gateway logs for the 24 hours ending 2026-09-08 00:00
UTC, the Supabase performance advisors, and live `EXPLAIN ANALYZE` runs
against production. Revised the same day after owner review: the four
questions in Part 11 are answered there and the answers are folded into 4.3,
4.18, 4.19, 6.2, PERF-T015, PERF-T022 and the new PERF-T042. Task prefix for
the build: `PERF-T###` in `progress.md`. Next available migration number:
0271.

THIS DOCUMENT IS THE SPEC. Parts 1 to 7 say what is slow, with the evidence.
Part 8 says exactly which file changes, what the code is, what the SQL is,
and which test or measurement proves it. Whoever builds this follows Part 8
as written and records deviations in `progress.md` under the task id rather
than deciding differently in place. Where Part 8 shows code, the code is the
intent; names, signatures and orderings are not suggestions.

The Manager Pulse sync was audited separately on 2026-09-05
(`docs/manager-pulse/manager-pulse-audit-and-speed-plan.md`). This document
does not restate it; where the two overlap (the league sync worker), this one
only adds what that one did not cover.

---

## Part 1. What the owner asked for

1. A speed and performance audit of the whole project: the site as a whole,
   individual pages, and the background work behind them.
2. A plan, with full technical specs, of the changes that would make it
   faster, in the docs folder.
3. No code changes. Audit only.

---

## Part 2. How the audit was done, and what it could not see

Evidence sources, in the order they were trusted:

1. Production database statistics. `pg_stat_statements` (every query shape
   since 2026-05-16 with call counts, mean and maximum time), table sizes and
   scan counters from `pg_stat_user_tables`, index definitions, and the
   Supabase performance advisor (165 lints).
2. Live query plans. `EXPLAIN (ANALYZE, BUFFERS)` was run against production
   for the two worst query shapes, so the numbers in Part 4 for those two are
   measured, not estimated.
3. The API gateway log. Every request the site made to Supabase in a 24 hour
   window, grouped by table, with the origin response time. This is the
   closest thing the project has to a request-level trace today.
4. The production build output under `.next/`. Per-route client JavaScript
   was computed from `app-build-manifest.json` plus the chunk file sizes;
   package signatures were grepped out of the shared chunks.
5. The code. Every page in `app/` was mapped to its rendering mode and every
   library it reads through; the hot paths were read line by line.

What it could not see:

- There is no field data. `@vercel/analytics` is installed (page views) but
  `@vercel/speed-insights` is not, so there are no real-user Web Vitals to
  quote. Part 9 adds it first, so the next audit can.
- No Lighthouse or WebPageTest run was taken; the numbers in this document
  are server-side and bundle-side. The bundle sizes are raw (uncompressed)
  bytes; on the wire they gzip to roughly a third.
- No load test. Every figure is at the site's current traffic, which the
  gateway log shows is dominated by the two every-minute workers and the
  owner's own browsing.
- Eight parallel code-review sub-agents were launched for the page-by-page
  pass and all eight were terminated by a session rate limit before returning
  anything. The page-by-page pass in Part 5 was therefore done directly, and
  it is shallower on the admin area and the account area than on the public
  and league pages. Those two areas are marked as such.

---

## Part 3. The shape of the problem

Three facts explain most of what follows.

### 3.1 Every database read costs about 45 ms before the query runs

From the gateway log, the 24 hour mean origin time by table:

| Table | Requests / day | Mean ms | p95 ms |
| --- | --- | --- | --- |
| format_configs (13 rows) | 8,352 | 49 | 102 |
| source_registry (4 rows) | 6,889 | 51 | 106 |
| beam_settings (1 row) | 5,063 | 53 | 106 |
| articles | 6,927 | 46 | 90 |
| cron_runs | 6,656 | 58 | 120 |
| players | 11,590 | 72 | 352 |
| player_weekly_projections | 3,434 | 113 | 402 |
| player_stats | 749 | 143 | 471 |

A 13 row table read that Postgres answers in well under a millisecond costs
49 ms at the gateway. That is PostgREST plus the hop from Vercel's function
to Supabase (both in us-east-1, per the request origin in the log, so the
network part is already as short as it can be). The consequence: on this
stack the number of sequential reads a page makes is the page's latency.
Ten reads in series is 450 ms before a byte is sent, whatever the queries.

### 3.2 A handful of query shapes do all the damage

Total execution time since 2026-05-16, top shapes, with what they are:

| Shape | Calls | Mean ms | Total s | What it is |
| --- | --- | --- | --- | --- |
| Realtime WAL poll | 2,359,794 | 5.6 | 13,171 | Supabase Realtime polling the `on_the_clock_pick_cache` publication. Platform cost, see 4.18. |
| `get_player_positional_finishes` RPC | 7,857 | 686 | 5,393 | Signal Scout round start. 4.5 |
| players lookup with `slug like '%-id'` | ~9,400 | 300 to 605 | ~4,700 | League overview team cards, power rankings, trade analyzer, player exposure. 4.1 |
| player_value_history keyset page | 5,820 | 365 | 2,122 | calculate-trends reading the whole 2.07M row table nightly. Fine. |
| player_value_history insert | 4,334 | 435 to 519 | 2,094 | Nightly value syncs. Fine. |
| player_stats by player and season | 4,620 | 243 | 1,124 | Multi-player stat reads. 4.24 |
| `pg_timezone_names` | 2,317 | 329 | 762 | Not the app; the Supabase dashboard. Ignore. |
| player_value_history latest capture per source | 593 | 529 | 314 | No index starts with `source`. 4.8 |
| player_market_latest view | 491 | 611 to 859 | 371 | A DISTINCT ON view with an external disk sort. 4.6 |

### 3.3 Every page ships about 344 kB of raw JavaScript before its own code

From the build manifest, the JavaScript every route carries:

| Chunk | Raw kB | What it is |
| --- | --- | --- |
| framework | 185 | React and React DOM |
| main | 120 | Next.js client runtime |
| app/layout | 121 | The root layout's client components: search, BEAM chat, guide mount, Discord CTA, mobile nav, rail state |
| polyfills | 110 | Loaded only by browsers without ES module support; modern browsers skip it |
| CSS | 128 | The single Tailwind sheet |

Then per route, raw kB including the baseline above (polyfills counted):

| Route | Raw kB | Of which route-specific |
| --- | --- | --- |
| /tools/on-the-clock | 953 | 318 kB page chunk plus 242 kB Supabase browser client |
| /my-beacon/signal/wall | 640 | 242 kB Supabase browser client |
| /my-beacon/rankings/[boardId] | 629 | same |
| /login | 590 | same |
| /leagues/[id]/trade-ideas | 524 | 109 kB shared chunk 7394 |
| /leagues/[id] | 482 | |
| /tools/faab | 446 | 74 kB page chunk |
| /games/signal-scout | 429 | 77 kB page chunk |
| /players/[slug] | 421 | 46 kB page chunk |
| /rankings/[format] | 376 | |
| / (home) | 365 | |
| every admin page | 352 to 389 | |

The baseline is reasonable for a React 19 app. The outliers are On The
Clock and the account area, and both are explained by one thing: the
browser-side Supabase client (`@supabase/supabase-js` with its Realtime,
GoTrue and WebSocket dependencies, chunks `1613` and `44530001`, 242 kB raw)
is bundled into eight routes, and in seven of them it is only there to submit
a form.

---

## Part 4. Findings, ranked by what a reader would feel

Each finding gives the evidence, what it costs today, the fix, and the risk.
The task ids refer to Part 8.

### 4.1 The Sleeper-id player lookup defeats its own index (PERF-T010)

Evidence. Four callers resolve a list of Sleeper player ids to `players`
rows with one `.or()` chain that mixes an indexed predicate and a
leading-wildcard `LIKE`:

- `lib/league-view-data.ts:417` (`resolvePlayers`, every league overview
  Teams section render)
- `lib/league-power-rankings.ts:240` (the power rankings recompute)
- `lib/trade-analyzer.ts:566` (the transactions feed and the trade OG card)
- `lib/player-exposure.ts:328`

Each id contributes `external_ids->>sleeper.eq.{id},slug.like.*-{id}`. The
first half hits `idx_players_external_sleeper`. The second half is a
`LIKE '%-4046'` pattern, which no B-tree can serve, and because the two are
OR-ed the planner cannot use the index for either. Measured on production:

```
with the slug clause:    Seq Scan on players, Rows Removed by Filter: 10473,
                         Execution Time: 1319.836 ms
without the slug clause: BitmapOr over idx_players_external_sleeper,
                         Execution Time: 0.251 ms
```

`pg_stat_statements` holds five variants of this shape totalling about 9,400
calls at 300 to 605 ms mean; `players` shows 80,129 sequential scans reading
716 million tuples in 115 days, on a 10,481 row table.

Cost today. A 12 team league has about 300 rostered ids, which is two chunks
of 200, so the Teams section of `/leagues/[id]` waits 0.6 to 2.6 s on this
alone, every render, inside its Suspense boundary. The trade analyzer pays it
per transaction row set. The power rankings recompute pays it once per 24
hours per league.

Fix. Two passes, exactly as `lib/sleeper-player-lookup.ts:67
resolveSleeperPlayers` and `lib/power-pulse/load.ts:324` already do: the
indexed `external_ids->>sleeper` lookup first, then the slug-tail fallback
ONLY for ids that came back empty. Route the four callers through the
existing helper rather than writing a fifth copy. Then make the fallback
unnecessary: a one-off backfill that writes `external_ids.sleeper` from the
slug tail for any row missing it, after which the second pass runs only for
ids that are not in `players` at all (a rookie Sleeper added today), and a
stored generated column with an index so even that pass is indexed.

Risk. Low. The helper already exists and is tested. The backfill is
idempotent and touches only rows where the key is absent.

### 4.2 The page chrome reads four things before any page can start (PERF-T020, T021)

Evidence. `app/layout.tsx:82` renders `<SiteHeader />` outside any Suspense
boundary. `components/site-header.tsx:50` awaits, in parallel,
`getActiveFormats` (format_configs), `getAvailableSources`
(source_registry), `getNavViewer` (an auth round trip plus
`user_preferences`) and `loadBeamSettings` (beam_settings, through a second
client, `createAdminClient`, which is not React-cached and so opens its own
connection). All four are React `cache()`d, which dedupes within one render
and nothing across renders. The gateway log shows the result: 8,352
format_configs reads, 6,889 source_registry reads and 5,063 beam_settings
reads per day, at about 50 ms each, for tables that change when an admin
saves a form.

Cost today. 50 to 110 ms of wall time on every page before the HTML shell
can stream (the slowest of the four, and the slowest is usually the auth
call at 70 ms for a signed-in reader). Because the header is not in
Suspense, this sits in front of every page's own data, including pages that
are otherwise static text.

Fix. An in-process TTL memo for reference and settings reads (the pattern
`lib/discord-stats.ts:44` already uses), applied to the format and source
registries and to every `load*Settings` loader, with a 60 second TTL and an
explicit bust from the admin save actions. Then split the header: the frame
and the brand cell render synchronously, and the controls that need data
(format and source toggles, account menu, BEAM starters) render inside a
Suspense boundary with a fallback of the same height.

Risk. Low for the memo (60 seconds of staleness on a settings change, on
the instance that did not receive the save). Medium for the header split:
the fallback must reserve the exact height or the page shifts, and the
accessibility review must confirm the controls announce correctly when they
stream in.

### 4.3 A signed-in reader pays two auth round trips per navigation (PERF-T022)

Evidence. `lib/supabase/middleware.ts:31` calls `supabase.auth.getUser()` on
every matched request, and `lib/nav-viewer.ts:42` calls it again in the
render (a different client instance, so not shared). The gateway log shows
2,821 `GET /auth/v1/user` per day at 70 ms mean. Anonymous readers make no
call (no cookie, the SDK returns early), so this is a signed-in cost only.

Cost today. About 140 ms per navigation for a signed-in reader, 70 of it in
middleware before routing even happens.

Fix. In middleware, replace `getUser()` with `getClaims()`, which verifies
the token signature locally against the project's published public key and
only calls the auth server when the token is about to expire. Keep
`getUser()` in `getNavViewer` for the render, where the server-verified
identity is the one that gates admin. Also exclude from the middleware
matcher the routes that never read a session: `/sitemap.xml`, `/sitemaps/`,
`/brief/rss.xml`, `/llms.txt`, `/api/og/`, `/api/cron/`.

Why local verification is possible here, in plain terms. A session token is
a signed note. With the older Supabase setup the note is signed with a
shared secret that only the auth server holds, so the only way to check a
signature is to send the note back to the auth server, which is the 70 ms
round trip. With the newer setup the note is signed with a private key and
the matching PUBLIC key is published at
`/auth/v1/.well-known/jwks.json`, so any server can check the signature
itself in under a millisecond. Checked on 2026-09-08: this project already
publishes an ES256 public key (kid `568e36a4-...`), so the feature is on.
The one thing the dashboard cannot tell us from here is whether that key is
the CURRENT signing key or a standby waiting for rotation (Supabase
dashboard, Authentication, JWT signing keys). If it is current, `getClaims`
verifies locally today and no dashboard action is needed. If it is standby,
tokens are still signed with the legacy secret, `getClaims` falls back to
the network call, and one click ("Rotate" to make the ES256 key current)
turns the saving on. Readers keep their sessions across that rotation; the
legacy secret stays valid as a previous key.

Risk. Medium. This is a security-adjacent change and must go through the
security review sub-agent. `getClaims` is present in the installed
`@supabase/auth-js`.

### 4.4 The favicon is a 1.78 MB file, and two logos are a megabyte each (PERF-T030)

Evidence. `public/img/favicon.svg` is 1,778,077 bytes. It is not a vector: it
is an SVG wrapper around a base64 PNG of 782 by 749 pixels, generated by
RealFaviconGenerator. `app/layout.tsx:38` lists it FIRST in `icons.icon`,
so every browser that supports SVG icons (all of them) downloads it on the
first visit. `public/img/ff-beacon-logo.png` is 1,333,180 bytes at the same
782 by 749 and is the `logo` in the JSON-LD on every article and guide
(`app/brief/[slug]/page.tsx:252`), so crawlers fetch it.
`public/img/ff-beacon-logo-email.png` is 1,003,412 bytes and is embedded in
every receipt, Signal email and Discord post (`lib/email/layout.ts:113`,
`lib/discord.ts:25`).

Cost today. 1.78 MB on a first visit, on the slowest connection the reader
has, competing with the page's own assets. On a phone on a 4G connection
that is a second or two of bandwidth. The email logo makes every email a
megabyte.

Fix. Replace `favicon.svg` with a true vector (the mark is a simple shape;
if the source vector is not available, remove the SVG entry and keep the
16 kB PNG and the ICO). Resize the two logo PNGs to 512 px (about 40 kB
each). Nothing else changes.

Risk. None.

### 4.5 Signal Scout runs a 686 ms ranking query at every round start (PERF-T011)

Evidence. `lib/signal-scout/stats-bundle.ts:121` calls the
`get_player_positional_finishes` RPC for the round's player. The function
(migration 0118) ranks EVERY player at that position across EVERY season by
summing `player_stats.metadata` JSON per row and windowing the result: a
full scan of the 293k row `player_stats` table per call. It is the single
largest query by total time in the ledger: 7,857 calls, 686 ms mean, 5,393 s
total. The player profile stopped calling it in favour of the nightly
pre-calculated `player_positional_finishes` table
(`lib/player-profile.ts:233`, `lib/calculate-positional-finishes.ts:6`),
which holds the same (player, season, scoring, finish, players_ranked)
shape and is rebuilt by `rebuild_positional_finishes()` in the stats cron.

Cost today. Every Signal Scout round start waits 0.7 s (up to 3 s) for one
clue, on top of 22 other reads.

Fix. Read `player_positional_finishes` where `player_id = X and season in
(...) and scoring = 'pts_ppr'`, primary-key indexed. Keep the RPC as the
parity oracle it already is for the profile.

Risk. Low. The finishes for the current season lag by up to a day; the
profile accepted the same trade.

### 4.6 The draft market view sorts 106k rows on disk per call (PERF-T012)

Evidence. `player_market_latest` is a view: `SELECT DISTINCT ON (source,
season_type, sleeper_player_id) ... ORDER BY source, season_type,
sleeper_player_id, snapshot_date DESC` over `player_market_snapshots`
(106,617 rows). The unique index has `season` between `season_type` and
`sleeper_player_id`, so it cannot serve that ordering. Measured plan for the
call `lib/breakdown/load-extras.ts:412` makes:

```
Seq Scan on player_market_snapshots (rows=106617)  659 ms
Sort ... Sort Method: external merge  Disk: 16320kB
Unique (rows=3579)
Execution Time: 1330.481 ms
```

491 calls at 611 to 859 ms mean.

Cost today. Beacon Breakdown pays 0.6 to 1.3 s for its draft-market
column, inside its Suspense boundary.

Fix. Turn the view into a table, `player_market_latest`, maintained by the
market sync (`lib/sync-sleeper-market.ts`) with one upsert per (source,
season_type, sleeper_player_id) at the end of each run, primary key on
`player_id`. The read becomes a primary-key `IN`. The view definition is
kept as `player_market_latest_view` for one release so nothing breaks
mid-deploy.

Risk. Low. The sync already owns the snapshots table; this adds one
idempotent write per run.

### 4.7 The league overview makes nine reads in series before its header paints (PERF-T040)

Evidence. `app/leagues/[league_id]/page.tsx:152` to `:231`, in order:
`resolveSleeperViewer` (auth plus `user_preferences`), `pulseLeagueCore`
(one `leagues` read, then on a warm cache two `head: true` counts on
`rosters` and `league_users`, `lib/league-pulse.ts:171` and `:188`), a
second read of the same `leagues` row (`page.tsx:190`, the core already
returned the widened row internally but does not hand it back),
`resolveSourceSlug`, `resolveLeagueContext` (format_configs), then
`loadLeagueHeaderActions` which does a membership count and two `rosters`
reads and a `league_users` read (`lib/league-switcher-data.ts:54` to
`:91`). None of these depend on each other except the league row, and every
one is awaited on its own line.

Cost today. Nine to eleven round trips in series at about 45 ms each: 400 to
500 ms before the league name appears on a warm cache. The `counts` the two
head counts feed are consumed only by the bulk sync summary
(`lib/league-bulk-sync.ts:234`) and the pulse result, never by the page.

Fix. `pulseLeagueCore` returns the `leagues` row it already read; the page
reuses it. The two head counts move behind an option (`{ counts: true }`)
that only the bulk sync passes. The viewer, the source resolution and the
header actions run in one `Promise.all`. Target: three round trips in
series (league row, then the parallel wave, then the format row) before the
header.

Risk. Low. Pure re-ordering of reads that already happen.

### 4.8 Two "latest row" reads have no index that starts with their filter (PERF-T013)

Evidence.

- `player_value_history where source = $1 order by captured_at desc limit
  1`: 593 calls, 529 ms mean, 7.5 s max. Callers
  `lib/beacon/signals/source-value.ts:100`, `lib/seed-rankings.ts:113`,
  `app/admin/beacon/rankings/page.tsx:267`. The existing composite index
  starts with `format_config_id`, so a filter on `source` alone walks the
  `captured_at` index backwards until it finds a matching source.
- `rankings order by generated_at desc limit 1`: 978 calls, 152 ms mean.
  No index on `generated_at`.

Fix. Two indexes, created concurrently:

```sql
create index concurrently if not exists idx_player_value_history_source_captured
  on public.player_value_history (source, captured_at desc);
create index concurrently if not exists idx_rankings_generated_at
  on public.rankings (generated_at desc);
```

Risk. None at read time. The first index is about 60 MB on a 2.07M row
table and adds a small cost to the nightly inserts.

### 4.9 Site search makes two round trips per keystroke, one of them unindexed (PERF-T050)

Evidence. `lib/player-search.ts:110` filters `players` with
`full_name.ilike OR first_name.ilike OR last_name.ilike`. `full_name` and
`search_name` have trigram indexes; `first_name` and `last_name` do not, and
an OR with an unindexed arm is a sequential scan of the table (10k rows, so
tens of milliseconds, not seconds). Then `fantasyRelevantPlayerIds`
(`:83`) runs a second query against `rankings` with `.in(player_id, up to
200 ids)` and `.limit(50000)` to learn which of the name matches are ranked.
The client debounces (`components/site-search.tsx:125`), so this is per
settled keystroke, not per key.

Cost today. Two reads in series, roughly 100 to 150 ms per search, and the
`rankings` scan counter (8,992 sequential scans, 64M tuples) shows the second
query is not using the `player_id` index for large id lists.

Fix. One query: search on `search_name` only (it is built for this, with
the trigram index), and decide "ranked" from an in-process memo of the
ranked player-id set (about 11k uuids, rebuilt every 5 minutes from
`rankings.player_id`), the same TTL memo as 4.2. The second round trip
disappears.

Risk. Low. The relevance window semantics are preserved; the set is
computed with the same predicate.

### 4.10 On The Clock ships 953 kB of JavaScript (PERF-T031)

Evidence. `app/tools/on-the-clock/on-the-clock-client.tsx` is a 3,420 line
client component whose page chunk is 318 kB raw. It imports the
recommendation engine, the awards, the draft grades, the trade catalog and
the roster rollups at module top (`:59`, `:116` to `:119`), so they load
before the reader has picked a league. It also imports
`lib/supabase/client` (`:67`), whose only use is one Realtime channel for
pick updates (`:1771`), and that import brings the whole browser Supabase
client with GoTrue and WebSocket code: 242 kB raw across chunks `1613` and
`44530001`.

Cost today. 953 kB raw (roughly 300 kB on the wire) before the room is
interactive, on the tool most likely to be opened on a phone at a draft
party.

Fix. `next/dynamic` for the panels that are not on the first screen
(`TradeAnalyzer`, `RankingsAwards`, `DraftComplete`, `PlayerSpotlight`
extras) and for the engines they use; a dynamic import of the Supabase
client inside the effect that subscribes, so the 242 kB loads only when
`realtimeEnabled` is true and a draft is live. Expected: the route drops
to about 450 kB raw.

Risk. Medium. The draft room is stateful and the split must not introduce
a loading gap in the pick flow; every dynamically loaded panel needs a
same-height fallback and the accessibility review must check focus does not
jump when one mounts.

### 4.11 The account area ships the Supabase browser client to submit forms (PERF-T032)

Evidence. Thirteen client components import `lib/supabase/client`; twelve
are `/login` and `/my-beacon/**` forms (email, password, avatar, profile,
boards, wall composer, media uploader). Each of those routes carries the
same 242 kB raw. The rest of the site already uses server actions for
writes.

Cost today. Every `/my-beacon` page is 586 to 640 kB raw against a 352 kB
baseline.

Fix. Server actions for the form submissions (the avatar and media uploads
keep a browser client, loaded with a dynamic import at interaction time,
because they stream files to Storage). `/login` keeps the client for the
OAuth redirect but loads it dynamically on button press.

Risk. Medium. Each form needs its own accessibility and security review;
the work is routine but there are twelve of them.

### 4.12 The root layout hydrates chat, guide and CTA code on every page (PERF-T033)

Evidence. `app/layout.tsx` mounts `SiteSearch` (655 lines), `BeamLauncher`
which imports `BeamChat` (567 lines) statically
(`components/beam/beam-launcher.tsx:7`), `SignalGuideMount` which imports
`GuidePanel` statically (`components/signal-guide/signal-guide-mount.tsx:12`),
and `DiscordCta`. Together with the mobile nav and rail state these make
the 121 kB raw `app/layout` chunk. Nothing in it uses `next/dynamic`.
BEAM's launcher already does the right thing for its images (warms them on
intent, `beam-launcher.tsx:38`), it just does not do it for its code.

Cost today. About 60 to 80 kB raw of JavaScript parsed and hydrated on every
page for panels most readers never open.

Fix. `next/dynamic(() => import("./beam-chat"), { ssr: false })` inside the
launcher, mounted only after the first intent (the existing `warm`
callback); the same for `GuidePanel` and the Discord CTA body. The floating
buttons stay in the initial bundle.

Risk. Low. The launchers already gate on intent; only the import moves.

### 4.13 Settings and reference tables are re-read on every request that needs them (PERF-T020)

Evidence. None of the nine settings loaders memoises across requests
(`lib/beam/settings.ts`, `lib/manager-pulse/settings.ts`,
`lib/beacon/settings.ts`, `lib/power-pulse/settings.ts`,
`lib/signal-scout/settings.ts`, `lib/would-you-rather/settings.ts`,
`lib/faab/settings.ts`, `lib/on-the-clock/settings.ts`,
`lib/signal-check/settings.ts`: zero `cache(`, zero `unstable_cache`). The
gateway log for 24 hours: manager_pulse_settings 3,035 reads (the worker
reads it twice per tick, `app/api/cron/league-sync-worker/route.ts:69` and
`lib/league-bulk-sync.ts:836`), beacon_settings 2,252, nfl_teams 3,844,
news_categories 3,749, article_teams 3,620, league_power_pulse_settings
980. Every one at about 45 ms.

Cost today. One to three extra round trips on most tool pages and on every
worker tick. About 20,000 database requests a day that return the same
bytes they returned a minute earlier.

Fix. The TTL memo of 4.2, applied to all nine loaders and to the four
reference-table readers in `lib/beacon-brief-feed.ts:254`, `:293`, `:309`.

Risk. Low. Same staleness note as 4.2.

### 4.14 The rankings page reads value history without a bound (PERF-T051)

Evidence. `components/rankings/rankings-view.tsx:71` reads
`player_value_history` for a format and source ordered by `captured_at
desc` with no `.limit()`, no player filter (the comment at `:41` says why:
the URL would overflow), and no date bound. PostgREST caps it at 1,000
rows, which happens to be about one day of captures for a source, so the
page works. This is the query with 76,464 calls at 41 ms. It is
index-only, so it is fast, but it is fragile: any source that captures more
than 1,000 rows a day for a format (ffbeacon writes 6,852 a day across its
formats) returns a partial day.

Fix. Read the current value from `player_value_trends`, which the same
`Promise.all` already fetches (`:79`) and which carries the latest value
per (player, format, source) by construction. Drop the history read.

Risk. Low. `player_value_trends` is the pre-calculated table the rules in
`CLAUDE.md` say pages should read.

### 4.15 The every-minute worker costs twelve requests when the queue is empty (PERF-T060)

Evidence. `app/api/cron/league-sync-worker/route.ts` and
`lib/league-bulk-sync.ts:832`: a tick with no jobs writes a `cron_runs` row,
reads settings (twice), acquires the lease, renews it, reaps stale jobs,
reads computing runs, claims (RPC), counts pending jobs, releases the lease,
and updates the `cron_runs` row. The gateway log agrees: 5,763 lease
acquisitions, 3,102 `league_sync_jobs` reads, 3,035 settings reads and
6,656 `cron_runs` writes a day. `cron_runs` is 76 MB for 24,810 rows.

Cost today. About 19,000 requests a day, 500 ms of serial latency per tick,
for an idle queue. No reader feels this; the database does, and so does the
Vercel invocation count.

Fix. One RPC, `league_sync_tick(p_holder, p_lease_seconds, p_limit)`, that
acquires the lease, reaps, claims and returns the claimed jobs plus the
pending count in a single statement. Skip the `cron_runs` insert on a tick
that claimed nothing and finalised nothing (write one heartbeat row per
hour instead, so `cron-health` still sees the job alive). Read settings
once per tick.

Risk. Low. The lease semantics stay in SQL where they are now; the RPC
composes functions that already exist.

### 4.16 Row Level Security policies re-evaluate `auth.uid()` per row (PERF-T014)

Evidence. The advisor lists 58 policies across 22 user-scoped tables
(`votes`, `user_preferences`, `beacon_custom_formats`,
`user_ranking_boards`, `user_ranking_board_players`, `signals`,
`signal_posts`, `signal_follows`, `signal_reports`, `signal_post_images`,
`signal_comments`, `signal_reactions`, `signal_check_analyses`,
`signal_scout_user_stats`, `signal_scout_daily_scores`,
`league_bulk_sync_requests`, `league_sync_jobs`,
`trade_suggestion_declines`, `trade_suggestion_saves`,
`manager_pulse_runs`, `manager_pulse_run_leagues`) written as
`auth.uid() = user_id`, which Postgres evaluates once per candidate row
instead of once per query. Six tables also carry two permissive SELECT
policies for `authenticated` (own plus public), which are OR-ed per row.

Cost today. Small: these tables are user-scoped and small. It grows with
the Signal tables.

Fix. One migration rewriting each policy as `(select auth.uid()) = user_id`
(the initplan form), no semantic change. The double SELECT policies are
left alone: they are the design (own rows plus public rows), and merging
them would change the access matrix.

Risk. None functionally. The migration must re-run the RLS verification
sequence from `CLAUDE.md` on every touched table.

### 4.17 Sixty unindexed foreign keys and forty unused indexes (PERF-T015)

Evidence. The advisor. Most of the unindexed keys are `updated_by` and
`created_by` columns on settings tables and do not matter. Six are on hot
paths: `article_players.player_id` (the profile news teaser,
`lib/player-profile.ts:925`, and the Brief player pages),
`draft_market_adp.player_id`, `league_power_pulse_cache.roster_id`,
`league_power_rankings_cache.format_config_id` and `.source`,
`draft_pick_values.format_config_id`, `beacon_value_references.player_id`.
The forty unused indexes have not been read since the counters reset on
2026-05-16; each costs write time on every sync that touches its table.

Fix. Add the six indexes. Drop the unused ones after confirming, per
index, that no admin page or script issues the query it was built for
(the list is in Part 6).

Risk. Low. Index creation is `concurrently`; drops are reversible by
re-running the original migration's `create index`.

### 4.18 Housekeeping the database has been waiting for (PERF-T061)

Evidence.

- `player_value_history`: 1.76 GB (1.16 GB heap, 599 MB of indexes), 2.07M
  rows, last autovacuum 2026-08-11. The `ffbeacon` source writes 6,852 rows a
  day (eight formats), five times any other source; the table grows by about
  3.6M rows a year at today's rate.
- `player_stats`: 949 MB, 293k rows, 41,328 dead tuples, last autovacuum
  2026-07-24.
- `cron_runs`: 76 MB for 24,810 rows (about 3 kB per row; the `result` jsonb
  is the bulk), pruned weekly for the minute-workers and yearly otherwise.
- Realtime: the `supabase_realtime` publication carries
  `on_the_clock_pick_cache`; the Realtime poller is the top consumer by total
  time (13,171 s since May, about two minutes of database time a day). It
  runs whether or not a draft is live. This is the platform's cost of the
  feature and is noted, not fixed.

Fix. A one-off `VACUUM (ANALYZE)` on the two big tables; per-table
autovacuum settings for them (`autovacuum_vacuum_scale_factor = 0.02`,
`autovacuum_analyze_scale_factor = 0.01`) so a 2M row table is vacuumed
after 40k dead rows rather than 400k; cap the `cron_runs.result` payload at
2 kB in `lib/cron-runs.ts` and prune the minute-workers to three days.
Retention for `player_value_history` was decided by the owner on
2026-09-08: every row is kept, permanently, because the history is referred
back to. The consequence is planned for rather than avoided: the tighter
autovacuum thresholds above, the `(source, captured_at desc)` index from
4.8 so "latest per source" never walks the table, and a note in Part 11
that at about 3.6M new rows a year the table passes 10M rows in 2028, which
is when range partitioning by `captured_at` becomes worth a migration of
its own. Nothing in this plan deletes a value row.

Risk. None for vacuum and thresholds.

### 4.19 The home page and the static pages are rendered per request (PERF-T041)

Evidence. `app/page.tsx:60` is `force-dynamic`. It reads `articles`,
`format_configs` and `source_registry` (all public, all cacheable), then
`isDiscordMember` (auth) and `getDiscordGuildStats` (memoised for five
minutes). `/guides/fantasy-football-draft-guide/page.tsx:104` is also
`force-dynamic`. `/about`, `/tools`, `/games`, `/guides`, `/privacy`,
`/terms` are not marked, but the header's `cookies()` read makes every
route dynamic anyway.

Cost today. Every visit to the home page is a full server render: header
reads (4.2) plus three page reads plus the auth check, about 250 to 400 ms
of server time before the first byte, against 20 to 50 ms for a cached
response.

Fix. This document does NOT recommend Partial Prerendering (experimental in
Next 15) or restructuring the header to avoid cookies. It recommends making
the dynamic render cheap: 4.2 and 4.13 remove the reads, and the home page's
three content reads move into one `unstable_cache` entry with a five minute
TTL. The member-aware hero stays dynamic behind a Suspense boundary. The
draft guide drops `force-dynamic` (nothing in it needs it) and gains
`revalidate = 3600`.

The two Discord reads on the home page (`lib/discord-stats.ts:44`,
`lib/discord-membership.ts:41`) are memoised for five minutes per server
instance. The owner approved raising that to 24 hours on 2026-09-08. The
guild stats (member count, online count) move to `unstable_cache` with a
24 hour TTL so the memo is shared across instances and a cold start does
not pay the Discord call; the per-reader membership check keeps its
in-process map with a 24 hour TTL (it is keyed by the reader's Discord id
and must never be shared). PERF-T042.

Risk. Low.

### 4.20 Tool pages have no loading boundary (PERF-T034)

Evidence. `loading.tsx` exists for `/leagues`, the two games and the Manager
Pulse report. `/tools/*`, `/rankings/*`, `/players/[slug]`, `/brief/*` and
`/[handle]` have none, so a click from the rail shows the old page until
the new one's first byte arrives.

Cost today. The perceived wait is the full server time of the target page
with no feedback. The League Pulse work already proved the branded loading
boundary is what makes a click feel instant.

Fix. A `loading.tsx` for `app/tools`, `app/rankings`, `app/players`,
`app/brief` and `app/[handle]`, reusing the existing branded skeleton
pattern from `app/leagues/loading.tsx`.

Risk. None.

### 4.21 Smaller items, in one place

- `player_stats` reads for several players at once (`player_id = ANY,
  season = ANY, season_type = $3, order by player_id, season, week`; 4,620
  calls, 243 ms) return every stat column. The `(player_id, season)` index
  serves the filter; the 243 ms is payload. Callers should name only the
  columns they render (`lib/league-lineups/data.ts` and
  `lib/manager-ledger/load.ts` are the first to check).
- `sync-sleeper-players` does not call `revalidateTag(CACHE_TAGS.playerDepth)`
  after writing `players`, so the depth chart cache relies on its 24 hour
  TTL. One line in `app/api/cron/sync-sleeper-players/route.ts`.
- Two pairs of crons share a minute in `vercel.json`: `sync-sleeper-stats`
  and `sync-dynastyprocess` at 09:00 UTC; `beacon-reference-rebuild` and
  `sync-nfl-odds` at 13:00 UTC. Neither pair reads the other's tables, so
  this is a database CPU overlap, not a correctness issue. Stagger by 15
  minutes.
- The site has no `@vercel/speed-insights`, so there is no field Web Vitals
  data. Part 9 adds it.
- `lib/database.types.ts` is types only and erases; no client bundle
  carries it. Checked, fine.
- Fonts: Geist Sans and Mono through `next/font`, self-hosted, no external
  font requests. Checked, fine.
- Icons: `lucide-react` named imports throughout; Next 15 optimises that
  package by default. Checked, fine.
- Tailwind: content globs cover `app`, `components`, `lib`; the 128 kB sheet
  is the whole design system plus 26 keyframe animations in `globals.css`.
  Not a target.
- Sleeper fetches use `cache: "no-store"` (`lib/sleeper.ts:65`). Correct;
  the 60 minute league TTL is the cache.
- OG routes load no fonts from disk per request (system font stacks) and
  the static ones set long cache headers. Checked, fine.
- Every cron route exports `maxDuration`; the syncs upsert in chunks of 200
  to 500 rows; `calculate-trends` pages the history table by keyset. Checked,
  fine.
- Client polling loops (`league-sync-all` 2 s, Manager Pulse progress 2 s
  with backoff, On The Clock draft sync, the capture clock at 1 s) all stop
  when their state is not active. Checked, fine.
- Region: the gateway log shows the Vercel function calling from
  us-east-1 and the Supabase edge answering from IAD. Same region. Fine.

---

## Part 5. Page by page

Rendering mode, what is awaited before the first byte, the client
JavaScript, and which findings apply. "Before first byte" counts round
trips in series on a warm cache, header included. The admin and account
areas were read at a lower depth than the rest (Part 2) and are marked.

| Route | Mode | Before first byte | Raw JS kB | Findings |
| --- | --- | --- | --- | --- |
| / | force-dynamic | header wave (4) + page wave (3) + auth | 365 | 4.2, 4.13, 4.19 |
| /rankings, /rankings/[format] | force-dynamic | header wave + format row + source resolve + rankings/values/trends wave | 376 | 4.2, 4.14 |
| /players/[slug] | force-dynamic | header wave + player row + team and finishes; tabs behind Suspense, seven `unstable_cache` domains | 421 | 4.2, 4.17 (article_players) |
| /brief | dynamic | header wave + sidebar wave + feed page (range) | 378 | 4.2, 4.13 (news_categories, nfl_teams) |
| /brief/[slug] | static, revalidate 300 | none at request time (ISR) | 378 | 4.4 (JSON-LD logo) |
| /[handle] | force-dynamic | header wave + signal row + boards + featured leagues (unstable_cache) | 420 | 4.2 |
| /tools | dynamic | header wave | 356 | 4.2, 4.20 |
| /tools/league-pulse | force-dynamic | header wave + handle gate (auth + prefs) + Sleeper user + leagues | 444 | 4.2, 4.20 |
| /tools/on-the-clock | force-dynamic | header wave + settings + handle gate + member check | 953 | 4.10, 4.13, 4.20 |
| /tools/faab | force-dynamic | header wave + settings + format + source + registry + handle gate (parallel) | 446 | 4.13, 4.20 |
| /tools/trade-calculator | force-dynamic | header wave + handle gate | 426 | 4.20 |
| /tools/beacon-breakdown (now /tools/who-should-i-start) | force-dynamic | header wave + player lookup; analysis behind Suspense | 410 | 4.6, 4.13, 4.20 |
| /tools/manager-pulse/[handle] | force-dynamic | header wave + cache or progress read | 400 | covered by the 2026-09-05 audit |
| /leagues/[id] | force-dynamic | 9 to 11 in series (4.7); sections behind Suspense | 482 | 4.1 (Teams), 4.7 |
| /leagues/[id]/power-pulse | force-dynamic | league core + context; pulse cache read | 454 | 4.7 |
| /leagues/[id]/positional-war | force-dynamic | league core + context; curve cache read | 441 | 4.7 |
| /leagues/[id]/lineups | force-dynamic | league core + context; roster, matchup, projections, WAR, ledger and free-agent waves | 435 | 4.7, 4.21 (player_stats columns) |
| /leagues/[id]/schedules | force-dynamic | league core + context; matchups + pulse weekly | 402 | 4.7 |
| /leagues/[id]/decisions | force-dynamic | league core + context; ledger compute opt-in inside Suspense | 413 | 4.7 |
| /leagues/[id]/trade-ideas | force-dynamic | league core + context; `?mode=build` evaluates during render, rate limited | 524 | 4.7 |
| /leagues/[id]/transactions | force-dynamic | league core + context; feed page + trade analyzer per trade | 398 | 4.1 (trade analyzer), 4.7 |
| /games/signal-scout | force-dynamic | header wave + round (23 reads + RPC) | 429 | 4.5 |
| /games/would-you-rather | force-dynamic | header wave + round (15 reads) | 403 | 4.2 |
| /my-beacon/** (lower depth) | force-dynamic | auth + prefs + signal + boards + post count | 586 to 640 | 4.3, 4.11 |
| /login | dynamic | header wave | 590 | 4.11 |
| /admin/** (lower depth) | force-dynamic | header wave + admin gate + page reads | 352 to 389 | 4.13 |
| /api/og/* | nodejs, cached 1 h at the edge | league context + values | n/a | 4.1 (trade card) |
| /api/search | dynamic | two reads in series | n/a | 4.9 |
| /sitemap.xml, /sitemaps/*, /brief/rss.xml, /llms.txt | revalidate 3600 | none | n/a | 4.3 (matcher) |

---

## Part 6. Database detail

### 6.1 Indexes to add

| Table | Index | Reason |
| --- | --- | --- |
| player_value_history | (source, captured_at desc) | 4.8 |
| rankings | (generated_at desc) | 4.8 |
| players | (sleeper_slug_tail) on a stored generated column | 4.1, the fallback pass |
| article_players | (player_id) | FK, profile news teaser and Brief player pages |
| draft_market_adp | (player_id) | FK |
| league_power_pulse_cache | (roster_id) | FK |
| league_power_rankings_cache | (format_config_id), (source) | FK; the read path filters (league_id, format, source) and is covered, these serve cascades and admin filters |
| draft_pick_values | (format_config_id) | FK |
| beacon_value_references | (player_id) | FK |

### 6.2 Indexes reported unused since 2026-05-16

Checked on 2026-09-08, at the owner's request, by matching each index's
columns against every `.from("<table>")` call chain in `lib/`, `app/`,
`scripts/` and `components/` (the predicate methods `eq`, `in`, `order`,
`gte`, `lte`, `is`, `ilike` and the `or()` filter strings), against the SQL
function bodies in the migrations, and against the foreign keys in
`information_schema`. First, the honest scale: all forty together are under
5 MB (thirty-six are 8 to 32 kB; the largest is
`idx_player_market_snapshots_sleeper_id` at 4.2 MB). Dropping them saves a
negligible amount of write time. This is hygiene, and it is the lowest
priority task in the plan.

Keep, the code issues the query (19). The columns appear in a live
predicate on that table; the planner has been choosing a sequential scan
because the table is tiny, or the query has not run since the counters
reset: `idx_beacon_reference_versions_recent`,
`idx_beam_learning_requests_ip_created`, `idx_discord_webhooks_active`,
`draft_pick_observations_picker_idx`, `draft_pick_observations_season_idx`,
`idx_league_relay_posts_league`, `league_sync_jobs_kind_pending_idx` (also
used inside a SQL function), `manager_pulse_runs_status_idx` (also SQL),
`manager_pulse_tendencies_version_idx`, `idx_news_sources_active`,
`idx_nfl_teams_name_trgm`, `idx_on_the_clock_draft_snapshots_finalized`,
`idx_player_market_snapshots_sleeper_id` (also SQL, and the read path of
4.6), `idx_signal_posts_signal` (also SQL), `idx_user_ranking_boards_profile`
(also SQL), `signal_scout_user_stats_points_idx`,
`signal_scout_user_stats_streak_idx`, `idx_wyr_trades_discord_repostable`,
`idx_wyr_votes_actor`.

Keep, the column is a foreign key (8). Dropping would make deletes on the
parent table scan the child, and the advisor would re-flag them as
unindexed keys: `beacon_ai_cache_player_idx`,
`idx_beacon_manual_signals_player`, `idx_on_the_clock_pick_snapshots_player`,
`idx_signal_reactions_type`, `signal_scout_guesses_player_idx`,
`idx_votes_matchup`, `idx_wyr_discord_polls_trade`,
`idx_wyr_discord_votes_poll`.

Drop (13). No predicate anywhere in the code or the SQL functions uses the
indexed column, and none backs a foreign key: `idx_articles_type`
(`article_type` is selected, never filtered),
`idx_beacon_custom_value_cache_computed` and
`idx_beacon_custom_value_cache_run` (the table has no reader in the app),
`idx_beacon_manual_signals_pick`, `idx_beam_queries_normalized`,
`manager_pulse_tendencies_dynasty_idx`,
`manager_pulse_tendencies_redraft_idx`, `idx_news_published` (`news_items`
has no reader in the app), `nfl_game_odds_away_team_idx`,
`idx_signal_check_audit_log_created`,
`user_preferences_featured_league_id_idx` (the code reads the JSON column
whole and never filters on the key), `idx_matchups_active` and
`idx_matchups_week` (`vote_matchups` has no reader in the app).

Three tables surfaced by this check have no reader anywhere in the app:
`beacon_custom_value_cache`, `news_items`, `vote_matchups` (and its child
`votes`). Whether those tables should be retired is a separate question,
recorded in Part 11; this plan drops their indexes only.

### 6.3 Policies to rewrite in the initplan form

All 58 listed in 4.16, one migration, pattern:

```sql
-- before
using (auth.uid() = user_id)
-- after
using ((select auth.uid()) = user_id)
```

Same for `with check`. Policy names, roles and commands do not change, so
the access matrix at the top of the migration is copied from the migration
that created each table.

### 6.4 Table statistics that matter

| Table | Total | Rows | Seq scans | Note |
| --- | --- | --- | --- | --- |
| player_value_history | 1,763 MB | 2,065,502 | 3,636 | 4.18 |
| player_stats | 949 MB | 292,916 | 43 | 4.18 |
| league_power_rankings_cache | 222 MB | 96,552 | 22 | fine |
| player_market_snapshots | 166 MB | 106,617 | 551 | 4.6, every scan is the view |
| league_matchups | 142 MB | 76,812 | 26 | fine |
| player_weekly_projections | 108 MB | 51,530 | 819 | the universe reads; cached daily |
| cron_runs | 76 MB | 24,810 | 778 | 4.15, 4.18 |
| players | 52 MB | 10,481 | 80,129 | 4.1 |
| rankings | 11 MB | 11,836 | 8,992 | 4.9 |
| beacon_brief_queue | 1 MB | 4,160 | 59,801 | tiny table, 0.8 ms; fine |

Connections: 25 of 60 in use at the time of the audit. The Auth server is
capped at 10 connections (advisor); not a limit today.

---

## Part 7. Background work

The nightly chain in `vercel.json` runs from 06:00 to 16:00 UTC, which is
02:00 to 12:00 Eastern, so none of it overlaps the evening peak. The two
minute-workers and the five-minute Brief curate run all day. Findings:

| Job | Schedule (UTC / EDT) | maxDuration | Observation |
| --- | --- | --- | --- |
| sync-sleeper-players | 06:00 / 02:00 | 300 | 300 row upserts; does not bust `playerDepth` (4.21) |
| sync-ktc | 07:00 / 03:00 | 300 | 200 row upserts; fine |
| sync-fantasycalc | 08:00 / 04:00 | 300 | fine |
| sync-dynastyprocess | 09:00 / 05:00 | 300 | collides with sync-sleeper-stats (4.21) |
| sync-sleeper-stats | 09:00 / 05:00, Jan, Feb, Aug to Dec | 300 | `rebuild_positional_finishes` 17 s per run; fine |
| recalculate-beacon | 09:30 / 05:30 | 300 | fine |
| recalculate-derived | 10:00 / 06:00 | 300 | busts `playerValues`; keyset pages 2.07M rows, about 19 s of database time a day; fine |
| sync-sleeper-market | 11:00 / 07:00 | 300 | becomes the maintainer of `player_market_latest` (4.6) |
| sync-weekly-projections | 12:00 / 08:00 | 300 | busts `playerProjections`; fine |
| beacon-reference-rebuild | 13:00 / 09:00 | 300 | collides with sync-nfl-odds (4.21) |
| sync-nfl-odds | 13:00 / 09:00 | 120 | fine |
| beacon-reference-drift | 14:00 / 10:00 | 300 | fine |
| build-beacon-projections | 14:30 / 10:30 | 300 | fine |
| rebuild-draft-value | 15:00 / 11:00 | 300 | fine |
| cron-health | 16:00 / 12:00 | 300 | prunes `cron_runs`; fine |
| beacon-brief | every 5 min | 300 | idle tick is cheap (bb_claim_jobs 1.5 ms) |
| beacon-brief-worker | every minute | 300 | idle tick is cheap |
| league-sync-worker | every minute | 300 | idle tick is twelve requests (4.15) |
| would-you-rather-discord | hourly | 120 | fine |
| league-relay | every 15 min | 300 | fine |

Nothing runs per league on a schedule; the on-demand-only rules in
`CLAUDE.md` hold.

---

## Part 8. The build

Six phases. Phase 0 is measurement and goes first so every later phase can
show its number. Phases 1 and 2 are where the reader-visible time is.
Phases 3 to 5 are independent of each other and of one another's order.

Every task: one file or one migration, per the atomic task rule. Every UI
task ends with the accessibility review sub-agent; every migration with the
RLS verification sequence; every middleware or auth task with the security
review sub-agent.

### Phase 0. Measure (PERF-T001 to T003)

PERF-T001. Field data. Add `@vercel/speed-insights` and mount
`<SpeedInsights />` beside `<Analytics />` in `app/layout.tsx`. One
dependency, one line. This is the only way the next audit gets Web Vitals
from real readers.

PERF-T002. Bundle report. `scripts/measure-bundle.ts`, run as
`npm run measure:bundle` after `next build`. It reads
`.next/app-build-manifest.json`, sums the chunk sizes per route (raw and
gzip, using `zlib.gzipSync`), and prints the table from Part 3 plus the ten
largest chunks. Output goes to stdout and to
`docs/performance/bundle-<date>.txt` so a before and after can be diffed.

```ts
import { readFileSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";

const manifest = JSON.parse(readFileSync(".next/app-build-manifest.json", "utf8"));
const size = (f: string) => {
  const buf = readFileSync(join(".next", f));
  return { raw: buf.length, gz: gzipSync(buf).length };
};
const rows = Object.entries(manifest.pages as Record<string, string[]>).map(([route, files]) => {
  const js = files.filter((f) => f.endsWith(".js")).map(size);
  return { route, raw: js.reduce((a, s) => a + s.raw, 0), gz: js.reduce((a, s) => a + s.gz, 0) };
});
rows.sort((a, b) => b.raw - a.raw);
for (const r of rows) console.log(`${r.route} | ${(r.raw / 1024).toFixed(0)} kB raw | ${(r.gz / 1024).toFixed(0)} kB gz`);
```

PERF-T003. Database baseline. Record, in
`docs/performance/db-baseline-<date>.md`, the top 30 query shapes by total
time and by mean time from `pg_stat_statements`, the gateway per-table
table from Part 3, and the table sizes. Then `select
pg_stat_statements_reset()` so the post-build comparison is clean. The
queries are the ones this audit ran; they are recorded in that file.

### Phase 1. The database (PERF-T010 to T015)

PERF-T010. The player lookup (4.1). Three parts, one task each in
`progress.md` but listed together because they are one change.

(a) Migration `0271_players_sleeper_slug_tail.sql`:

```sql
-- Access matrix: unchanged. players is public SELECT, service-role writes.
alter table public.players
  add column if not exists sleeper_slug_tail text
  generated always as (substring(slug from '-([0-9]+)$')) stored;
create index concurrently if not exists idx_players_sleeper_slug_tail
  on public.players (sleeper_slug_tail) where sleeper_slug_tail is not null;
-- One-off backfill: any row whose slug carries a Sleeper id but whose
-- external_ids does not. Idempotent.
update public.players
   set external_ids = external_ids || jsonb_build_object('sleeper', substring(slug from '-([0-9]+)$'))
 where substring(slug from '-([0-9]+)$') is not null
   and not (external_ids ? 'sleeper');
```

Regenerate `lib/database.types.ts` after applying.

(b) `lib/sleeper-player-lookup.ts resolveSleeperPlayers`: the second pass
changes from `.or(chunk.map((id) => \`slug.like.*-${id}\`).join(","))` to
`.in("sleeper_slug_tail", missing)`. Same result, indexed. The test in
`lib/sleeper-player-lookup.test.ts` gains a case asserting the second pass
is skipped when the first pass resolved every id.

(c) Replace the four private resolvers with the helper:
`lib/league-view-data.ts:407` `resolvePlayers` becomes a thin adapter over
`resolveSleeperPlayers` that maps `PlayerLookupEntry` to `ResolvedPlayer`
(it needs `birth_date` and `years_experience`, so the helper's select list
gains those two columns, which are cheap); `lib/league-power-rankings.ts:228`,
`lib/trade-analyzer.ts:556` and `lib/player-exposure.ts:318` likewise. A
guard test, `lib/players/sleeper-lookup-guard.test.ts`, fails the suite if
the string `slug.like.*-` appears anywhere under `lib/` or `app/` outside
the helper, the same shape as `lib/sleeper-handle/guard.test.ts`.

Proof: the `EXPLAIN` from 4.1 re-run after deploy shows a Bitmap scan; the
league overview Teams section time in the Vercel function log drops from
seconds to under 100 ms.

PERF-T011. Signal Scout finishes (4.5). `lib/signal-scout/stats-bundle.ts
loadFinishes` reads:

```ts
const { data, error } = await supabase
  .from("player_positional_finishes")
  .select("season, finish, players_ranked")
  .eq("player_id", playerId)
  .eq("scoring", "pts_ppr")
  .in("season", seasons)
  .order("season", { ascending: false });
```

The `FinishRow` mapping and the empty-result tolerance stay. The test in
`lib/signal-scout/stats-bundle.test.ts` (new if absent) feeds both shapes
and asserts identical `bestFinish`.

PERF-T012. The market table (4.6). Migration `0272_player_market_latest_table.sql`:

```sql
-- Access matrix: public SELECT (anon + authenticated), service-role writes.
alter view public.player_market_latest rename to player_market_latest_view;
create table public.player_market_latest (
  player_id uuid primary key references public.players(id) on delete cascade,
  sleeper_player_id text not null,
  source text not null,
  season integer not null,
  season_type text not null,
  snapshot_date date not null,
  adp numeric,
  projected_pts_ppr numeric,
  projected_pts_half_ppr numeric,
  projected_pts_std numeric,
  updated_at timestamptz not null default now()
);
alter table public.player_market_latest enable row level security;
create policy player_market_latest_select_public on public.player_market_latest
  for select to anon, authenticated using (true);
create policy player_market_latest_service_role_all on public.player_market_latest
  for all to service_role using (true) with check (true);
-- Seed from the view once.
insert into public.player_market_latest
  (player_id, sleeper_player_id, source, season, season_type, snapshot_date,
   adp, projected_pts_ppr, projected_pts_half_ppr, projected_pts_std)
select player_id, sleeper_player_id, source, season, season_type, snapshot_date,
       adp, projected_pts_ppr, projected_pts_half_ppr, projected_pts_std
  from public.player_market_latest_view
 where player_id is not null
on conflict (player_id) do nothing;
```

`lib/sync-sleeper-market.ts` ends each run with one upsert of the latest
row per player into the table. `lib/breakdown/load-extras.ts:412` and
`lib/beacon-breakdown.ts` read the table (no code change beyond the type
regen, the name is the same). The view is dropped in a later migration once
the sync has run at least once in production.

PERF-T013. The two indexes from 4.8, migration `0273_latest_row_indexes.sql`,
both `create index concurrently`.

PERF-T014. The initplan rewrite from 6.3, migration `0274_rls_initplan.sql`.
Then the RLS verification sequence on every touched table, and
`pg_policies` diffed against the pre-migration list to prove the names and
commands are unchanged.

PERF-T015. FK indexes from 6.1 in `0275_hot_fk_indexes.sql`; the thirteen
drops from 6.2 in `0276_drop_unused_indexes.sql`, each with the grep
evidence in the migration comment and the original `create index` statement
beside it so the drop is reversible by copy and paste. Lowest priority in
the phase; do it last.

### Phase 2. The request path (PERF-T020 to T023, T040, T041)

PERF-T020. `lib/memo-ttl.ts`:

```ts
type Entry = { value: Promise<unknown>; expires: number };
const store = new Map<string, Entry>();

/**
 * In-process memo with a TTL, for reads whose answer changes when an admin
 * saves a form and at no other time. One instance, one copy; a different
 * instance sees the change on its next miss, at most ttlMs later. Never for
 * user-scoped reads.
 */
export function memoTtl<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expires > now) return hit.value as Promise<T>;
  const value = fn().catch((err) => {
    store.delete(key);
    throw err;
  });
  store.set(key, { value, expires: now + ttlMs });
  return value;
}

export function bustMemo(prefix: string): void {
  for (const key of store.keys()) if (key.startsWith(prefix)) store.delete(key);
}
```

Applied, with `ttlMs = 60_000`, in: `lib/source.ts getActiveFormats` and
`getAvailableSources` (key `ref:formats`, `ref:sources`); the nine settings
loaders (key `settings:<name>`); `lib/beacon-brief-feed.ts` categories,
teams and players lookups (key `ref:brief:<name>`). Each admin save action
in `app/admin/**/actions.ts` calls `bustMemo("settings:<name>")` after its
write. A unit test, `lib/memo-ttl.test.ts`, covers hit, expiry, error
eviction and prefix bust. The gateway log after deploy should show
format_configs and source_registry under 500 reads a day.

PERF-T021. Header split (4.2). `components/site-header.tsx` becomes: the
synchronous frame (brand cell, skip link target, rail toggle, mobile nav
trigger) and `<Suspense fallback={<HeaderControlsFallback />}>` around a
new `components/site-header-controls.tsx` that does today's
`loadHeaderData` and renders the toggles, search, BEAM, donate and account
controls. The fallback renders the same containers, same height, with the
controls disabled and `aria-busy="true"` on the region. Accessibility
review must confirm: no layout shift, the region's name does not change,
focus is not stolen when the controls stream in.

PERF-T022. Middleware (4.3). `lib/supabase/middleware.ts`: `getClaims()` in
place of `getUser()`; `middleware.ts` matcher gains the exclusions listed
in 4.3. Manual step first, recorded in `progress.md` with the date: open
Supabase dashboard, Authentication, JWT signing keys, and confirm the ES256
key `568e36a4-...` is marked current. If it is standby, rotate it to
current. Then verify from the code: log `claims.alg` once in a dev render
and confirm it reads `ES256`, not `HS256`; a test in
`lib/supabase/middleware.test.ts` asserts the middleware makes no network
call for a token signed with the published key. Security review before
merge.

PERF-T023. `createAdminClient` is not React-cached (`lib/supabase/server.ts:60`),
so a render that calls it three times builds three clients. Wrap it in
`cache()` the same way `createClient` is. One line; no behaviour change.

PERF-T040. League overview first byte (4.7). `pulseLeagueCore` returns
`league: existing` on the cached branch and the upserted row on the sync
branch (type `LeagueCoreRow`, the widened select), and takes
`options.counts?: boolean` (default false) for the two head counts;
`lib/league-bulk-sync.ts` passes `counts: true`. `app/leagues/[league_id]/page.tsx`
drops the second `leagues` read and runs `resolveSleeperViewer`,
`resolveSourceSlug` and `loadLeagueHeaderActions` in one `Promise.all`
after the core. The other nine league routes get the same treatment where
they re-read the row. `lib/league-pulse.test.ts` asserts the cached branch
issues exactly one query when `counts` is false.

PERF-T041. Home page (4.19). The three content reads in `app/page.tsx:153`
move into `lib/home-content.ts loadHomeContent()` wrapped in
`unstable_cache(..., ["home-content"], { revalidate: 300, tags: ["home"] })`
using `createCachedReadClient`. The Beacon Brief worker calls
`revalidateTag("home")` when it publishes. The draft guide page drops
`force-dynamic` and gains `export const revalidate = 3600`.

PERF-T042. Discord reads at 24 hours (4.19, owner-approved 2026-09-08).
`lib/discord-stats.ts`: `fetchGuildStats` is wrapped in
`unstable_cache(fetchGuildStats, ["discord-guild-stats"], { revalidate:
86_400 })` and the module-level `CACHE_TTL_MS` memo is removed (the
Next cache replaces it and survives cold starts). `lib/discord-membership.ts`:
`CACHE_TTL_MS` becomes `24 * 60 * 60 * 1000`; the per-reader map stays
in-process because it is keyed by a reader's Discord id and must not be
shared. The existing tests for both files gain a case at the new TTL. A
reader who joins the server sees the member state on the home page within a
day; the admin "refresh" action, if one is wanted later, is a
`revalidateTag("discord-guild-stats")`.

### Phase 3. Assets and bundles (PERF-T030 to T034)

PERF-T030. Images (4.4). Replace `public/img/favicon.svg` with a vector
under 5 kB or remove the SVG entry from `app/layout.tsx:38`; resize
`ff-beacon-logo.png` and `ff-beacon-logo-email.png` to 512 px with `sharp`
(already a dependency; `scripts/optimize-beam-mascot.ts` is the pattern).
Check both renders in an email client and in a Discord embed.

PERF-T031. On The Clock (4.10). In `on-the-clock-client.tsx`:
`const TradeAnalyzer = dynamic(() => import("./trade-analyzer"))`, likewise
`RankingsAwards`, `DraftComplete`, and the spotlight extras; the Supabase
client import moves inside the realtime effect:

```ts
useEffect(() => {
  if (!realtimeEnabled || !draftId) return;
  let channel: RealtimeChannel | null = null;
  let cancelled = false;
  void import("@/lib/supabase/client").then(({ createClient }) => {
    if (cancelled) return;
    const supabase = createClient();
    channel = supabase.channel(/* unchanged */);
    /* unchanged subscription body */
  });
  return () => { cancelled = true; if (channel) void channel.unsubscribe(); };
}, [realtimeEnabled, draftId]);
```

Each dynamic panel has a fallback that reserves its height and carries
`aria-busy`. Measured by PERF-T002 before and after; target under 500 kB
raw for the route.

PERF-T032. Account forms (4.11). One task per form, twelve tasks, each
moving the write into a server action in the matching `actions.ts` and
removing the `lib/supabase/client` import. The avatar and media uploaders
keep the client behind a dynamic import on first interaction.

PERF-T033. Layout chrome (4.12). `components/beam/beam-launcher.tsx`
imports `BeamChat` with `dynamic(..., { ssr: false })` and mounts it only
once `primed` is true (the existing state). `components/signal-guide/signal-guide-mount.tsx`
does the same for `GuidePanel`. `components/discord-cta.tsx` splits its
body from its trigger the same way.

PERF-T034. Loading boundaries (4.20). `app/tools/loading.tsx`,
`app/rankings/loading.tsx`, `app/players/loading.tsx`,
`app/brief/loading.tsx`, `app/[handle]/loading.tsx`, each the branded
skeleton from `app/leagues/loading.tsx` with the section's own heading
text. Accessibility review: the skeleton announces "Loading" once, and the
page heading replaces it.

### Phase 4. Background work (PERF-T060 to T062)

PERF-T060. The worker tick (4.15). Migration `0277_league_sync_tick.sql`
defines `league_sync_tick(p_holder text, p_lease_seconds integer, p_limit
integer) returns table (job league_sync_jobs, pending_count integer)` which
calls `try_acquire_league_sync_lease`, `claim_league_sync_jobs` and a
pending count in one body. `lib/league-bulk-sync.ts runLeagueSyncWorker`
calls it once per loop; `app/api/cron/league-sync-worker/route.ts` stops
pre-acquiring the lease. `lib/cron-runs.ts recordCronRun` gains
`{ quietWhen: (result) => boolean }`; the worker passes a predicate that is
true when nothing was claimed and nothing finalised, and the ledger row is
skipped, with one heartbeat row per hour so `cron-health` still sees the
job. `lib/cron-health.test.ts` covers the heartbeat.

PERF-T061. Housekeeping (4.18). Migration `0278_autovacuum_thresholds.sql`:

```sql
alter table public.player_value_history set (
  autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.01);
alter table public.player_stats set (
  autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.01);
```

Then, by hand through the SQL console (not a migration, it is not
repeatable DDL): `vacuum (analyze) public.player_value_history;` and the
same for `player_stats`. `lib/cron-runs.ts` truncates `result` to 2 kB
before the update.

PERF-T062. Cron staggering and the missing tag (4.21). `vercel.json`:
`sync-dynastyprocess` to `15 9 * * *`, `sync-nfl-odds` to `15 13 * * *`.
`app/api/cron/sync-sleeper-players/route.ts` adds
`revalidateTag(CACHE_TAGS.playerDepth)` after a successful write.

### Phase 5. Search and rankings (PERF-T050, T051)

PERF-T050. Search (4.9). `lib/player-search.ts searchFantasyPlayers` becomes
one query on `search_name` (`.ilike("search_name", \`%${escaped}%\`)`), and
`fantasyRelevantPlayerIds` becomes `rankedPlayerIdSet()` memoised with
`memoTtl("ref:ranked-ids", 300_000, ...)` reading `rankings.player_id` with
the same 90 day window. `lib/player-search.test.ts` keeps its current
cases.

PERF-T051. Rankings values (4.14). `components/rankings/rankings-view.tsx:71`
drops the `player_value_history` read; the current value comes from the
`player_value_trends` rows already fetched at `:79` (`value` column, added
to that select). The `valuesResult` consumers read the trends map.

---

## Part 9. Measurement protocol

Before Phase 1 and after each phase, on production:

1. Field: Speed Insights (PERF-T001) LCP, INP and TTFB p75 for `/`,
   `/rankings/[format]`, `/players/[slug]`, `/leagues/[id]`,
   `/tools/on-the-clock`, `/games/signal-scout`. Seven days of data.
2. Server: the Vercel function log's duration for the same six routes, p50
   and p95, 24 hours.
3. Database: the gateway per-table request counts and mean origin time (the
   query in PERF-T003), and `pg_stat_statements` top 30 after the reset.
4. Bundle: `npm run measure:bundle` diffed against the Phase 0 file.

Targets, chosen from the evidence rather than from a guideline:

| Measure | Today | Target |
| --- | --- | --- |
| League overview Teams section, warm | 0.6 to 2.6 s | under 150 ms |
| League overview first byte, warm | 400 to 500 ms | under 200 ms |
| Signal Scout round start, server | about 1.2 s | under 400 ms |
| Beacon Breakdown market column | 0.6 to 1.3 s | under 50 ms |
| format_configs reads per day | 8,352 | under 500 |
| Auth server calls per signed-in navigation | 2 | 1 |
| First-visit icon bytes | 1.78 MB | under 20 kB |
| /tools/on-the-clock raw JS | 953 kB | under 500 kB |
| /my-beacon/* raw JS | 586 to 640 kB | under 400 kB |
| Worker requests per idle minute | about 12 | 3 |

---

## Part 10. Deliberately not proposed

- Partial Prerendering. Experimental in the installed Next 15.5, and the
  header's cookie read would need restructuring first. Revisit when it is
  stable.
- Moving off PostgREST to a direct Postgres connection. The 45 ms floor is
  real, but a connection pool from Vercel functions has its own failure
  modes and the whole codebase is written against the Supabase client.
  Cutting the number of reads per page (Phase 2) recovers most of the same
  time.
- Retention on `player_value_history`. It is the audit trail the data
  rules require, and the owner confirmed on 2026-09-08 that every row is
  kept for referring back. No compaction, no pruning.
- Disabling Realtime. On The Clock uses it during live drafts.
- A CDN cache layer in front of league pages. They are per-reader (saved
  handle, source cookie) and the 60 minute pulse TTL already bounds the
  expensive part.

---

## Part 11. Decisions recorded 2026-09-08

The four questions the first draft asked, and the owner's answers.

1. `player_value_history` retention. Every daily row is kept, permanently;
   the history is referred back to. Recorded in 4.18 and Part 10. Growth
   note: at about 3.6M rows a year the table passes 10M rows during 2028;
   range partitioning by `captured_at` is the right tool at that point and
   should be planned as its own migration then, not now.
2. JWT signing keys. The owner had not turned anything on, and did not need
   to: the project already publishes an ES256 public key. The remaining
   check (current versus standby) is written into PERF-T022, with the plain
   language explanation in 4.3.
3. Unused indexes. Checked against the codebase; the result is 6.2 (19
   keep because the code queries them, 8 keep because they back a foreign
   key, 13 drop). New question for the owner, no urgency: three tables have
   no reader in the app at all (`beacon_custom_value_cache`, `news_items`,
   `vote_matchups` with `votes`). Retire them, or keep them for a feature
   that is still coming?
4. Discord cache. A 24 hour lag on the member count is fine. PERF-T042.
