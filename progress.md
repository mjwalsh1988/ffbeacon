# FF Beacon Progress

Single source of truth for atomic task status. Update after every task. Task format:

```
T### | status | description
     | files: ...
     | verified: yes/no
```

Status: `pending` | `in_progress` | `blocked` | `completed`

---

## Phase 0 - Repo Foundation
T001-T006 | completed | CLAUDE.md, plan.md, progress.md, .env.local.example, .env.local, .gitignore

## Phase 1 - Next.js Scaffold
T007-T010 | completed | Scaffold, Geist fonts, Tailwind design tokens, next-themes toggle

## Phase 2 - Database Schema
T011-T018 | completed | 8 migrations, all RLS-enabled, 12 public tables, format_configs seeded

## Phase 3 - Supabase Wiring + Auth
T019 | completed | Supabase clients (browser/server/admin/middleware) with new key names
T020 | completed | OAuth login (Google, Discord, magic link), callback + signout routes
     | NEEDS DASHBOARD CONFIG: enable Google + Discord providers in Supabase Auth dashboard

## Phase 4 - Site Shell
T021 | completed | Header with logo, primary nav, theme toggle, format toggle, sign-in
     | files: components/site-header.tsx, components/header-nav-link.tsx, components/beacon-mark.tsx
T022 | completed | Mobile menu drawer with focus trap, ESC close, restore-focus
     | files: components/mobile-menu.tsx
T023 | completed | Footer with 4-column nav, social links, copyright, author byline
     | files: components/site-footer.tsx
T024 | completed | Format toggle dropdown + URL ?format= sync + localStorage persistence
     | files: components/format-toggle.tsx
T025 | completed | Wired SiteHeader + SiteFooter into root layout
     | files: app/layout.tsx
T026-T031 | completed | Homepage hero, tools grid, articles, position hub, format hub, trust strip
     | files: app/page.tsx

## Phase 5 - Data Ingestion
T032 | completed | Sleeper player sync script + run once
     | files: scripts/sync-sleeper-players.ts, scripts/_supabase.ts
     | result: 4368 players upserted with sleeper external_id
T033 | completed (script only) | Sleeper stats import script written
     | files: scripts/sync-sleeper-stats.ts
     | RUN PENDING: SEASON=2024 npm run sync:stats (deferred to keep build moving)
T034 | completed | KTC scraper + run once
     | files: scripts/sync-ktc.ts
     | result: 2878 trade_values across 8 formats (88% match rate)
     | note: KTC API uses oneQBValues/superflexValues with .value field; matching via
       lowercased name + position; superscript adjustments (tep=1) hit subdomain query params
T035 | completed | FF Beacon rankings seeded from KTC values
     | files: scripts/seed-rankings.ts
     | result: 299-461 ranking rows per format, 6 tier buckets

## Phase 6 - Rankings Page
T036 | completed | /rankings server page with format + position filters
     | files: app/rankings/page.tsx
T037 | completed | Rankings table client component with aria-sort, keyboard sort
     | files: components/rankings-table.tsx

## Phase 7 - Player Pages
T038 | completed | /players/[slug] template with generateStaticParams (top 200)
     | files: app/players/[slug]/page.tsx
     | result: 200 player pages SSG'd in production build
T039 | completed | Player sections: header, cross-format rankings, recent games, news
     | files: app/players/[slug]/page.tsx

## Phase 8 - Sleeper Tool + Dashboard
T040 | completed | /tools/league-pulse anonymous Sleeper username -> leagues
     | files: app/tools/league-pulse/page.tsx + league-pulse-form.tsx + league-results.tsx,
             lib/sleeper.ts
T041 | completed | /dashboard for logged-in users, saves Sleeper username
     | files: app/dashboard/page.tsx + save-username-form.tsx

## Phase 9 - FAAB
T042 | completed | /tools/faab calculator with player autocomplete + need-weighted bid
     | files: app/tools/faab/page.tsx + faab-form.tsx

## Phase 10 - About + Author
T043 | completed | /about site mission
     | files: app/about/page.tsx
T044 | completed | /author/michael founder bio + Person JSON-LD
     | files: app/author/michael/page.tsx

## Index pages (added for nav coverage)
T045 | completed | /tools index
T046 | completed | /guides index (placeholder content blocks)
T047 | completed | /players index (top 12 per position)

## Build status
- `npx tsc --noEmit`: clean
- `npx next build`: green, 214 routes generated, 200 player pages SSG
- Bundle: shared 99.9 kB; routes mostly 109-110 kB First Load

## Open verification items
- Live OAuth round-trip (needs Supabase Auth dashboard config + Google/Discord client IDs)
- Anonymous SELECT smoke test via `npm run dev` against real format_configs read
- A11y audit on header, mobile drawer, rankings table, FAAB form
- Lighthouse run for accessibility 100 baseline
- Run `SEASON=2024 npm run sync:stats` to backfill player stats (deferred this session)
- KTC unmatched 399 entries: likely rookie draft picks (RDP). Skipping; revisit when implementing
  rookie draft pick value support.
- Position toggle on /rankings does not currently strip ?position when "All positions" is clicked
  from a URL that has it — confirm `FilterLink` logic. Same fix when adding more facets.

## Phase 11 - FF Beacon-native naming + pre-calculated trends
T048 | completed | Rename trade_values -> player_value_history, drop derived
     trend columns, add metadata jsonb to all external-ingestion tables,
     consolidate players source-specific columns into metadata /
     source_synced_at / internal_attributes
     | migration: 0012_ffbeacon_native_naming_and_metadata.sql
     | verified: yes (RLS preserved, all 4053 history rows + 4368 player rows
       carry merged jsonb, source_registry.data_type[] updated)
T049 | completed | Create player_value_trends pre-calc table + RLS + indexes
     | migration: 0013_player_value_trends.sql
     | verified: yes (2 RLS policies live, public SELECT + service-role ALL)
T050 | completed | scripts/calculate-trends.ts with bounded-staleness anchors
     and data-scarcity NULLs
     | files: scripts/calculate-trends.ts, package.json (calculate:trends,
       sync:ktc:full)
     | result: 1998 trend rows for 1998 (player, format, source) combos
T051 | completed | UI: TrendChip + RankingsTable TrendCell, gated on
     data_points_30d >= 7, aria-labels for screen readers
     | files: components/trend-chip.tsx, components/rankings-table.tsx,
       app/players/[slug]/page.tsx, app/rankings/page.tsx
T052 | completed | Rename remaining legacy PK/FK constraints
     | migration: 0014_rename_legacy_pvh_constraints.sql
T053 | completed | CLAUDE.md "Data Architecture Principles" section added;
     docs/data-sources.md updated with metadata + trends sections
T054 | completed | Impl review (general-purpose subagent) — 2 blockers + 3
     warnings surfaced and fixed
     | players.metadata.ktc now populated by sync-ktc.ts; source_synced_at
       always updates; TrendCell stricter null gating; valueAtOrBefore caps
       anchor staleness; PK/FK constraints renamed

## Build status
- `npx tsc --noEmit`: clean
- `npx next build`: green, 15 dynamic routes (player [slug] now dynamic)

## Phase 12 - League Pulse Phase 3 (transactions, trade analyzer, admin refresh, OG images)
T055 | completed | lib/league-format-resolution.ts - league-contextual format resolver
     | files: lib/league-format-resolution.ts
     | verified: build+typecheck clean. Resolves (format, source) per-league using
       Sleeper-derived rules; falls through via lib/format-fallback when source
       doesn't carry the ideal format; pickSource always KTC for picks.
T056 | completed | lib/trade-analyzer.ts - per-side value math + verdict
     | files: lib/trade-analyzer.ts
     | verified: build+typecheck clean. Player values from player_value_trends;
       pick values from draft_pick_values keyed by pickSourceSlug (KTC).
       Verdict thresholds: even <=5%, slight <=15%, won >15%. hasMissingValues
       flag drives a "Some values missing" warning.
T057 | completed | components/transaction-row.tsx - shared trade/move row
     | files: components/transaction-row.tsx
     | verified: build+typecheck clean. Side-by-side trade analyzer cards with
       per-asset value chips and winner highlight. Mobile-first stack via
       grid sm:grid-cols-2.
T058 | completed | lib/league-transactions-data.ts - server-side row prep
     | files: lib/league-transactions-data.ts
     | verified: build+typecheck clean. Pagination via .range() + count:exact,
       multi filter on type / roster_ids / week / season. Defense-in-depth:
       sleeperId regex filter before PostgREST .or() string interpolation.
T059 | completed | components/transaction-filters.tsx - client-side filter bar
     | files: components/transaction-filters.tsx
     | verified: build+typecheck clean. Multi-select chips for type + team,
       selects for week + season. router.replace on change; aria-busy on
       pending transition; has-[:focus-visible] outline on .sr-only checkbox
       chips for keyboard a11y; team list region has aria-label.
T060 | completed | /leagues/[league_id]/transactions feed page
     | files: app/leagues/[league_id]/transactions/page.tsx
     | verified: build green (2.68 kB route). Filters + paginated rows with
       prev/next + OG metadata wired to /api/og/league.
T061 | completed | Replace ComingSoonPanel on /leagues/[league_id] tab
     | files: app/leagues/[league_id]/page.tsx (TransactionsPanel)
     | verified: build green. Recent 10 transactions + "View all" link.
T062 | completed | League header now displays detected format + format-mismatch
     banner + KTC-picks footnote + no-coverage empty state
     | files: app/leagues/[league_id]/page.tsx
     | verified: page rewritten to use resolveLeagueContext; old
       reconcileFormatWithSource path retired inside league views.
T063 | completed | Admin force-refresh endpoint + button + rate limit
     | files: app/api/leagues/[league_id]/refresh/route.ts, components/refresh-button.tsx,
       lib/league-auth.ts, supabase/migrations/0025_league_refresh_attempts.sql,
       supabase/migrations/0026_try_claim_league_refresh.sql
     | verified: build green. Auth re-validated server-side (admin OR
       commissioner). Rate limit is atomic via SECURITY DEFINER function
       try_claim_league_refresh(); concurrent admins get 429 deterministically.
       CSRF: requires x-requested-with: ff-beacon header on POST.
       Error messages sanitized — raw DB errors logged server-side only.
T064 | completed | components/copy-link-button.tsx - shareable URL clipboard button
     | files: components/copy-link-button.tsx
     | verified: build green. Wired into /leagues/[id], /leagues/[id]/teams/[roster_id],
       and individual trade rows. aria-live announces "Link copied to clipboard";
       clipboard-permission failure shows a fallback "Press Ctrl+C" hint with
       a hidden focused input.
T065 | completed | /api/og/league/[league_id] - league OG image (1200x630)
     | files: app/api/og/league/[league_id]/route.tsx
     | verified: build green. FF Beacon brand only (purple→cyan gradient, no
       gold/violet). Uses resolveLeagueContext for the cache lookup so format
       matches the rest of the site.
T066 | completed | /api/og/team/[league_id]/[roster_id] - team OG image
     | files: app/api/og/team/[league_id]/[roster_id]/route.tsx
     | verified: build green. Shows record, total/starter/bench/picks values,
       top 5 players by value. Brand-compliant.
T067 | completed | /api/og/trade/[transaction_id] - trade OG image
     | files: app/api/og/trade/[transaction_id]/route.tsx
     | verified: build green. Both-sides side-by-side with verdict +
       differential + pick-source footnote. Brand-compliant.
T068 | completed | Wire OG metadata into league + team + transactions pages
     | files: app/leagues/[league_id]/page.tsx (generateMetadata),
       app/leagues/[league_id]/teams/[roster_id]/page.tsx (generateMetadata),
       app/leagues/[league_id]/transactions/page.tsx (generateMetadata)
     | verified: build green. openGraph + twitter card meta with 1200x630 images.
T069 | completed | Team detail page uses league-contextual format + adds CopyLinkButton
     | files: app/leagues/[league_id]/teams/[roster_id]/page.tsx
     | verified: build green. Drops the old resolveFormatSlug+reconcile path
       in favor of resolveLeagueContext.
T070 | completed | Migration 0025 - league_refresh_attempts ledger
     | files: supabase/migrations/0025_league_refresh_attempts.sql
     | verified: applied via MCP. RLS enabled, service-role-only access.
T071 | completed | Migration 0026 - try_claim_league_refresh atomic function
     | files: supabase/migrations/0026_try_claim_league_refresh.sql
     | verified: applied via MCP. SECURITY DEFINER; EXECUTE granted to
       authenticated + service_role. Atomic insert/update that returns true
       only when caller wins the rate-limit window.
T072 | completed | docs/league-format-resolution.md + CLAUDE.md sections
     | files: docs/league-format-resolution.md, CLAUDE.md (League Pulse Format
       Resolution + admin auth model + OG brand rule + transactions section)
     | verified: present and human-readable.
T073 | completed | Sub-agent review pass (implementation + a11y + security)
     | findings + fixes:
       - is_commissioner no longer flagged from Sleeper is_owner (false positives
         would have granted force-refresh to every co-owner) — defaults to false
         until verified commissioner signal is implemented
       - Refresh TOCTOU race fixed via atomic Postgres function (migration 0026)
       - CSRF defense: x-requested-with header check on refresh POST
       - Sanitized error messages from refresh API (no raw DB error leakage)
       - SQL injection defense-in-depth: regex-validate sleeperIds before
         .or() interpolation in trade-analyzer + transactions-data
       - A11y: focus-visible outline on .sr-only filter chips via has-[:focus-visible]
       - A11y: team filter region wrapped with role+aria-label+tabIndex so
         the scrollable list is announced
       - A11y: removed redundant aria-live from static blocks (TransactionRow
         verdict, league header last-synced) that were re-announcing on every
         render
       - A11y: noValue chips now announce "value not available" instead of
         a misleading numeric value
       - Min-h-11 on filter chips to meet 44px tap target
       - Removed redundant date in article aria-label (date is announced once
         via the <time> child)
       - Dropped duplicate aria-label on <select>s that already have a <legend>
     | known deferred (not blocking ship):
       - OG routes run on runtime=nodejs (works with createAdminClient).
         Phase 3 prompt suggested edge runtime; nodejs is the safer choice
         because of supabase client dependencies and gives us full RLS context.
       - Refresh surfaces inline aria-live announcements + role=alert error
         instead of a CSS toast — better for screen readers than a transient
         popup but documented divergence from the spec wording.
       - Geist via woff2 fetch in OG images deferred — currently falls back
         to `sans-serif`. Will add once we have a proven low-latency CDN
         source for the woff2 file.

## Build status (after Phase 12)
- `npx tsc --noEmit`: clean
- `npx next build`: green, 22 dynamic routes
- New routes: /leagues/[league_id]/transactions, /api/leagues/[league_id]/refresh,
  /api/og/league/[league_id], /api/og/team/[league_id]/[roster_id],
  /api/og/trade/[transaction_id]

## Phase 13 - DynastyProcess source integration
T074 | completed | Migration 0033 - register dynastyprocess in source_registry
     | files: supabase/migrations/0033_add_dynastyprocess_source.sql
     | detail: priority 4, is_active=false initially (flipped true after audit),
       data_type ['rankings','player_value_history'] (NO draft_pick_values),
       supported_format_slugs ['dynasty-ppr-std','dynasty-ppr-sflex']
     | verified: yes (applied via MCP, row confirmed, pg_policies intact on
       source_registry/player_value_history/players: public SELECT + service ALL)
T075 | completed | Regenerate lib/database.types.ts via MCP
     | files: lib/database.types.ts (unchanged)
     | depends on: T074
     | verified: yes (0033 is a data-only INSERT, no DDL; generated types are
       byte-identical to the existing file, so nothing to write)
T076 | completed | Dependency-free quoted-CSV parser
     | files: lib/csv.ts
     | detail: RFC-4180-ish, handles quoted fields with embedded commas + CRLF
     | verified: yes (typecheck clean, parses live DP CSVs end to end)
T077 | completed | DynastyProcess sync pipeline (library form)
     | files: lib/sync-dynastyprocess.ts
     | depends on: T075, T076
     | detail: fetch values-players.csv + db_playerids.csv crosswalk; match
       fp_id->fantasypros_id->sleeper_id->player, name|position fallback; two
       batches (value_1qb->dynasty-ppr-std, value_2qb->dynasty-ppr-sflex);
       captured_at = scrape_date T12:00:00Z; merge external_ids.fantasypros +
       source_synced_at.dynastyprocess + metadata.dynastyprocess; non-fatal
       must-differ canary; fatal on zero rows written
     | verified: yes (live run: 1398 rows, 699/format, 4 unmatched, 699 merged.
       Added per-player dedupe: two DP rows can resolve to one player and would
       collide on the conflict key since captured_at is constant; keep the
       better-ranked row and warn)
T078 | completed | CLI wrapper script
     | files: scripts/sync-dynastyprocess.ts
     | depends on: T077
     | verified: yes (npm run sync:dynastyprocess succeeds)
T079 | completed | Cron endpoint
     | files: app/api/cron/sync-dynastyprocess/route.ts, lib/cron-runs.ts
     | depends on: T077
     | detail: CRON_SECRET bearer auth, recordCronRun; added 'sync-dynastyprocess'
       to CronJobName union + CRON_JOBS registry (admin health panel)
     | verified: yes (typecheck clean, mirrors sync-fantasycalc route exactly)
T080 | completed | One-time historical backfill from git history
     | files: scripts/backfill-dynastyprocess-history.ts
     | depends on: T077
     | detail: walk GitHub commits API for files/values-players.csv newest->old;
       schema-drift hard stop on header mismatch/404; 3-year absolute ceiling;
       per-snapshot zero-rows stop; cache crosswalk once; rate-limit backoff;
       NEVER wired to nightly cron
     | verified: yes (live run: 148 weekly snapshots 2023-06-16..2026-06-12,
       170262 rows / 85131 per format, stopped cleanly at 3-year ceiling, no
       schema drift in window, match rates high on old snapshots)
T081 | completed | Wire npm scripts + vercel cron
     | files: package.json, vercel.json
     | depends on: T078, T079, T080
     | detail: sync:dynastyprocess + backfill:dynastyprocess added; folded into
       sync:full + backfill:all; vercel cron "0 9 * * *" (after fantasycalc 08:00,
       before recalculate-derived 10:00)
     | verified: yes (typecheck clean)
T082 | completed | Pre-launch pairwise audit + flip is_active=true
     | detail: value_1qb != value_2qb for 452 players (avg 962, the meaningful
       tier); 247 "identical" are the floored tail (avg value 3, max 72).
       DP vs KTC 0/477 identical; DP vs FantasyCalc 0/433 identical. Genuine
       two-format source, not the fake-format footgun. Flipped is_active=true.
     | depends on: T077
     | verified: yes (rankings reseeded: 699/format DP rows; trends recomputed)
T083 | resolved | DP weekly cadence vs data_points_30d>=7 UI trend gate
     | detail: superseded by the cadence-aware bookend gate below (T084-T089).
       Old count-based gate (data_points_30d>=7) replaced entirely.
     | verified: yes (see T084-T089)

## Phase 14 - Cadence-aware bookend trend gate (replaces data_points_30d>=7)
T084 | completed | Migration 0034 - source cadence + per-window show flags
     | files: supabase/migrations/0034_trend_bookend_gate.sql
     | detail: source_registry.update_cadence ('daily'|'weekly', default 'daily',
       DP='weekly'); player_value_trends.show_trend_7d/30d/90d boolean not null
       default false (one flag per window, gates value + rank movement)
     | verified: yes (applied via MCP; RLS/access matrix unchanged on both tables)
T085 | completed | Sync database.types.ts to the 0034 schema
     | files: lib/database.types.ts
     | depends on: T084
     | verified: yes (update_cadence + show_trend_* added to Row/Insert/Update;
       typecheck clean. Hand-edited to match generator output, kept in sync)
T086 | completed | calculate-trends: bookend gate computation
     | files: lib/calculate-trends.ts
     | depends on: T084
     | detail: per (player,format,source,window) show flag = start bookend within
       tol of (now-W) AND end bookend within tol of now. tol = min(intervalDays,
       floor((W-1)/2)); intervalDays daily=1 weekly=7. Cap makes 7d-weekly tol=3
       (the flagged small-window case). Numeric change fields untouched (parity).
     | verified: yes (recomputed 5347 rows)
T087 | completed | UI gate refactor + weekly label
     | files: components/trend-chip.tsx, components/rankings-table.tsx
     | depends on: T086
     | detail: replaced data_points_30d<7 with show_trend_* booleans; player tile
       renders gated 7d/30d/90d chips; TrendChip + rankings cells get a weekly
       aria-label/title; cadence denormalized onto each RankingsRow
     | verified: yes (build green)
T088 | completed | Page queries: select flags + cadence, drop count gate
     | files: app/rankings/page.tsx, app/players/[slug]/page.tsx, lib/source.ts
     | depends on: T087
     | detail: select show_trend_* + change_90d/pct; getAvailableSources now
       returns update_cadence; pages resolve source cadence and pass to components
     | verified: yes (build green)
T089 | completed | Recompute trends + per-source show/hide verification
     | depends on: T086, T087, T088
     | detail: per-source results below. All show/hide outcomes trace to real data
       coverage (gate working), not bugs.
     | verified: yes

## Phase 14 verification (per-source, computed 2026-06-13)
- KTC (daily, 894 distinct days = genuinely daily): show_7d 1915 / show_30d 1926
  / show_90d 1881 of 2085. ~92% at 7d vs 99% under the old count gate. The ~8%
  now hidden are players lacking a KTC point within +/-1 day of the exact
  bookend (intermittently-ranked players near KTC's top-N cutoff). Healthy daily
  behaves as intended.
- FantasyCalc (daily): ALL hidden in THIS dev DB because dev FC has only 8
  sporadic sync days (2026-05-17,18,25, 06-09..13), no point within +/-1 of the
  7d/30d bookends. NOT a code regression: in production the daily cron lands a
  point every day, so both bookends are satisfied and chips show. Documented so
  this is not mistaken for a regression.
- DynastyProcess (weekly, tol +/-7 capped to +/-3 at 7d): show_7d 1398 / show_30d
  1372 / show_90d 0 of 1566.
  - 7d + 30d SHOW: last DP update was 1 day ago and prior weekly points land near
    the 7d/30d bookends. DP chips carry the "updated weekly" label.
  - 90d HIDES (currently): DP pauses in the deep offseason. It has data through
    2026-02-27 then nothing until 2026-04-30. 90-days-ago (2026-03-15) falls in
    that gap, so no start bookend within +/-7 (nearest is 16 days off). The gate
    correctly suppresses a misleading 90d chip (the old change_90d would anchor
    on a point 16+ days stale). DP's 90d chip will begin showing once 90-days-ago
    advances past the offseason gap (after ~2026-07-29).
- FLAGGED (7d-weekly tolerance): the 7-day window is <= 14d, so a weekly +/-7
  would overlap the bookends. calculate-trends caps tol at floor((W-1)/2) = 3 for
  the 7d window (roughly half the 7-day interval, as proposed). Implemented, not
  silently using +/-7. Raise/lower via the cap if you want different behavior.

## Next milestone
- News pipeline (RSS ingestion -> news_items, AI summary via Claude)
- Vote matchups (/vs/[a]-vs-[b]) live
- Weekly content cron (waivers, start-sit, sleepers)
- IndexNow + sitemap generation
- AdSense readiness sweep
- Phase 12 follow-ups: real commissioner detection, edge runtime for OG,
  Geist woff2 fetch in OG cards, toast-style refresh feedback
