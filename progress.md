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

## FF Beacon Value Engine (plan v3.1)

Proprietary signal-pipeline value + ranking source. Plan approved through v3.1.
ffbeacon source row stays is_active=false until Phase 1-3 audits pass + owner
sign-off. All tunables are DB-backed from the start (admin surface is Phase 6).

### Phase B0 - Migrations + tunable foundation (completed)
T700 | completed | format_configs: is_bestball column + 4 new presets (dynasty-ppr-tep, 3 best-ball)
     | files: supabase/migrations/0035_format_configs_bestball_and_presets.sql
     | note: is_bestball is orthogonal to league_type (deviation from v3.1 wording, justified)
     | verified: yes (12 formats, 3 bestball)
T701 | completed | source_registry: ffbeacon row, priority 1, is_active=false, 9 supported formats
     | files: supabase/migrations/0036_source_registry_ffbeacon.sql
     | verified: yes (ffbeacon_active=false, gated)
T702 | completed | beacon_settings (global tunable KV) + 10 seeded defaults (staleness, factor, normalization, AI)
     | files: supabase/migrations/0037_beacon_settings.sql
     | verified: yes (RLS service-role-only, 10 rows)
T703 | completed | beacon_signal_weights (per-signal/source) + 7 seeds; ai_adjust seeded disabled
     | files: supabase/migrations/0038_beacon_signal_weights.sql
     | verified: yes (RLS service-role-only, 7 rows)
T704 | completed | beacon_value_bands (format-aware) + 6 global seeds (skill 0-10000, K/DEF 0-1500)
     | files: supabase/migrations/0039_beacon_value_bands.sql
     | verified: yes (RLS service-role-only, 6 rows)
T705 | completed | beacon_manual_signals (player/pick, silent toggle, set_value, decay)
     | files: supabase/migrations/0040_beacon_manual_signals.sql
     | verified: yes (RLS service-role-only)
T706 | completed | beacon_value_runs (run_id source, source_freshness, skipped_no_signal, factor_saturated)
     | files: supabase/migrations/0041_beacon_value_runs.sql
     | verified: yes (RLS service-role-only)
T707 | completed | beacon_format_status (placeholder badge) + 3 best-ball baseline seeds
     | files: supabase/migrations/0042_beacon_format_status.sql
     | verified: yes (public SELECT + service role; baselines auto-resolved)
T708 | completed | beacon_stat_profiles (scoring-invariant stat vector, K/DEF incl, no IDP)
     | files: supabase/migrations/0043_beacon_stat_profiles.sql
     | verified: yes (RLS service-role-only)
T709 | completed | beacon_custom_formats (per-user saved custom formats, user-owned RLS)
     | files: supabase/migrations/0044_beacon_custom_formats.sql
     | verified: yes (own-row CRUD policies)
T710 | completed | beacon_custom_value_cache (run_id-keyed on-demand cache)
     | files: supabase/migrations/0045_beacon_custom_value_cache.sql
     | verified: yes (RLS service-role-only)
T711 | completed | player_value_history.formula_offset column (silent-change trend exclusion)
     | files: supabase/migrations/0046_player_value_history_formula_offset.sql
     | verified: yes (column present, default 0, inherits table RLS)
T712 | completed | Regenerate database.types.ts; typecheck clean
     | files: lib/database.types.ts
     | verified: yes (tsc --noEmit passes; beacon tables + is_bestball + formula_offset present)

### Phase B1 - Engine v1 (completed)
T713 | completed | Engine pure core: types, freshness (cadence cutoffs), settings loader (live DB), engine combine (weightedAverage null guard, bounded factor, set_value short-circuit, offset)
     | files: lib/beacon/types.ts, lib/beacon/freshness.ts, lib/beacon/settings.ts, lib/beacon/engine.ts
     | verified: yes (reliability tests pass)
T714 | completed | Normalization: trimmed P99 + median canonical curve + quantile matching + KS/Spearman helpers + MIN_PLAYERS_FOR_QUANTILE
     | files: lib/beacon/normalize.ts
     | verified: yes (audit: convergence, fidelity, outlier, non-identity all pass)
T715 | completed | source_value producer (self-excluded + staleness-gated, freshness report) + manual producer (overrides + decay)
     | files: lib/beacon/signals/source-value.ts, lib/beacon/signals/manual.ts
     | verified: yes
T716 | completed | Orchestrator: mint run_id, live settings, per-format normalize+combine, all-stale skip, KTC-baselined picks, finalize with source_freshness
     | files: lib/calculate-beacon-values.ts, scripts/calculate-beacon-values.ts
     | verified: yes (705 players, 2507 rows, 0 skipped, 0 saturated; ffbeacon is_active still false)
T717 | completed | Reliability tests (staleness exclusion, single-signal valid, all-stale skip) + normalization audit harness
     | files: scripts/beacon-reliability-tests.ts, scripts/beacon-normalization-audit.ts
     | verified: yes (12/12 reliability pass; audit ALL PASS)
     | note: B1 writes 5 source-backed formats; dynasty-ppr-tep + best-ball formats write 0 (skip path) until Phase 3 stat_value / baseline inheritance

### Phase B2 - Offset-aware trends (completed)
T718 | completed | calculate-trends offset-aware: marketValue helper; current_value=published; all change/trend/rank/volatility on market (value - formula_offset); per-day rankings on market; bookend gate unchanged
     | files: lib/calculate-trends.ts
     | verified: yes (real run 7854 combos; ffbeacon current_value matches published, 0 mismatch; external offset 0 = no-op parity)
T719 | completed | Players page: headline uses published (only consumer is latestValue[0]); comment added so a future sparkline uses the market series. No sparkline exists today.
     | files: app/players/[slug]/page.tsx
     | verified: yes (7a audit)
T720 | completed | Offset-trends verification via production computeTrendRows: silent change=no chip, true-signal=chip, external parity
     | files: scripts/beacon-offset-trends-test.ts
     | verified: yes (12/12 pass); real-data engine demo confirmed silent offset!=0 / true offset=0, then reverted
     | note: value-read audit (7a) signed off; every call site decided published vs market

### Phase B3 - stat_value (K/DEF) + format-aware bands (completed)
T721 | completed | Stat scoring (kicking + team-defense), admin-tunable via beacon_signal_weights.params; migration 0047 seeds the scoring config
     | files: lib/beacon/scoring.ts, supabase/migrations/0047_beacon_stat_value_scoring_params.sql
     | verified: yes (eyeball sane)
T722 | completed | stat_value producer: recency-weighted K/DEF re-score from player_stats; range() pagination (fixed 1000-row truncation that under-counted K/DEF)
     | files: lib/beacon/signals/stat-value.ts
     | verified: yes (58 K + 32 DEF valued, was truncated to 36/16 before fix)
T723 | completed | Orchestrator: shared emit closure + K/DEF stat_value pools per format (only on formats with a skill board)
     | files: lib/calculate-beacon-values.ts
     | verified: yes (795 players, 2957 rows, 0 skipped)
T724 | completed | Format-aware K/DEF bands: dynasty compressed to 0-250, redraft global 0-1500 (migration 0048)
     | files: supabase/migrations/0048_beacon_kdef_dynasty_bands.sql
     | verified: yes (Aubrey 1499 redraft / 250 dynasty; Broncos D 1466 / 244)
T725 | completed | Outage simulation: total external outage leaves K/DEF alive (degraded board, not dead)
     | files: scripts/beacon-outage-sim.ts
     | verified: yes (skill survivors 0, K/DEF 58+32 alive, all sources dropped)
     | note: 4 formats still empty (dynasty-ppr-tep + 3 best-ball) - no skill base yet, pending TEP derivation / best-ball baseline inheritance (later phase)

### Phase B4 - stat_performance + stat profiles (completed)
T726 | completed | Skill scoring map + PROFILE_COLUMNS in scoring.ts (re-score skill components under any config)
     | files: lib/beacon/scoring.ts
     | verified: yes
T727 | completed | beacon_stat_profiles nightly materialization (scoring-invariant components, range-paged)
     | files: lib/beacon/stat-profiles.ts
     | verified: yes (1025 profiles, 637 with 2 seasons)
T728 | completed | stat_performance producer: bounded YoY skill trajectory adjustment, confidence-damped; params seeded (migration 0049)
     | files: lib/beacon/signals/stat-performance.ts, supabase/migrations/0049_beacon_stat_performance_params.sql
     | verified: yes (adj bounded to +/-0.10; risers Lawrence/Wilson, fallers Darnold/Burrow; conf damping confirmed)
T729 | completed | Orchestrator: materialize profiles, gather perf, thread adjustInputs through emit closure (skill only)
     | files: lib/calculate-beacon-values.ts
     | verified: yes (795 players, 2957 rows, 0 skipped, 0 saturated, 146 perf-adjusted)

### Phase B5 - fill 4 empty formats + full-board audit (completed)
T730 | completed | Derivation: dynasty-ppr-tep (TE-premium boost from dynasty-ppr-std) + 3 best-ball identity inherits; stat-driven TE boost; TEP settings (migration 0050)
     | files: lib/beacon/derive.ts, lib/calculate-beacon-values.ts, supabase/migrations/0050_beacon_tep_derivation_settings.sql
     | verified: yes (TEs boosted 6.8-10.4%, best-ball identity exact, picks inherited)
T731 | completed | Full-board audit across all 9 formats (in-band, positions populated, derivation invariants)
     | files: scripts/beacon-board-audit.ts
     | verified: yes (ALL PASS)
T732 | completed | FIX: unordered range() pagination on players loads silently dropped ~100 players (incl elite TEs) from position maps; added .order("id") across all beacon producers
     | files: lib/beacon/stat-profiles.ts, lib/beacon/signals/{source-value,stat-value,stat-performance}.ts, lib/beacon/derive.ts, scripts/beacon-board-audit.ts
     | verified: yes (profiles 1025 -> 1125, perfAdjusted 181 -> 239, elite TEs now boosted)

### ALL 9 FORMATS POPULATED - ready for owner end-to-end ranking review
- 5363 value rows + 180 picks across 9 formats; trends 10710 combos.
- is_active STILL FALSE. Awaiting owner review of every format's rankings + sign-off.

### Phase B6 - admin control surface /admin/beacon (completed)
T733 | completed | All crons registered in one place: recalculate-beacon added to CRON_JOBS + cron route + vercel.json (09:30). Future jobs: add to CRON_JOBS + a route and they auto-appear.
     | files: lib/cron-runs.ts, app/api/cron/recalculate-beacon/route.ts, vercel.json
     | verified: yes (build)
T734 | completed | Server actions (requireAdmin): updateBeaconSetting, updateSignalWeight, toggleSource, upsertValueBand, createManualSignal, setManualSignalActive, recomputeBeacon
     | files: app/admin/beacon/actions.ts
     | verified: yes (typecheck + build)
T735 | completed | Settings UI: source toggles, signal weights table, scalar settings (factor/staleness/normalization/TEP/AI), format-aware bands editor, manual composer (silent vs true-signal explained)
     | files: components/admin/{recompute-bar,source-toggles,setting-field,signal-weights-table,value-bands-editor,manual-composer}.tsx
     | verified: yes
T736 | completed | Visibility UI: all-cron monitoring, beacon_value_runs report (freshness/skipped/saturation), rankings review (filter by format+position, expandable signal breakdown, placeholder badge), recompute-now + staleness indicator
     | files: components/admin/rankings-review.tsx, app/admin/beacon/page.tsx, components/admin-nav.tsx
     | verified: yes (build; review query returns data)
     | note: screen-reader-first - role=switch/aria-checked toggles, aria-live status, captioned tables w/ scope, keyboard nav, no visual-only state

### Phase B6.1 - admin IA restructure (completed)
T737 | completed | Split the single /admin/beacon page into a parent index + 7 focused sub-pages, each its own route/title/H1, screen-reader-first. Renamed section to "Player Values & Sources".
     | files: app/admin/beacon/{page,rankings,sources,weights,bands,settings,manual,runs}/page.tsx, lib/beacon-admin-nav.ts, lib/beacon-admin.ts, components/admin/{beacon-subnav,beacon-page-shell,manual-signals-list}.tsx, components/admin-nav.tsx
     | verified: yes (typecheck + build; 8 routes compiled)
     | note: shared BeaconPageShell (subnav + heading + RecomputeBar); recompute affordance + staleness warning on rankings/sources/weights/bands/settings/manual. Server actions + engine unchanged.

### Phase B7 - AI signal (ai_adjust) wired to Claude (completed, shipped OFF)
T738 | completed | Migration 0051: beacon_ai_cache (input-hash keyed AI response cache so unchanged inputs never re-bill). RLS enabled, service_role_all only.
     | files: supabase/migrations/0051_beacon_ai_cache.sql, lib/database.types.ts
     | verified: yes (RLS confirmed: rowsecurity on, single service_role ALL policy, no anon/auth access)
T739 | completed | Migration 0052: AI settings into beacon_settings (category 'ai') - ALL admin-editable on /admin/beacon/settings. ai_system_prompt (full prompt template, DB-backed, {bound} substituted live), ai_max_calls (60), ai_min_spread (0.15), ai_min_mover (0.05).
     | files: supabase/migrations/0052_beacon_ai_settings.sql
     | verified: yes (7 ai rows present; prompt visible + editable)
T740 | completed | Producer lib/beacon/signals/ai-adjust.ts: callClaudeForAdjustment (official @anthropic-ai/sdk, structured-output json_schema, clamp to [-bound,bound] + [0,1]) + gatherAiAdjustments (sha256 cache check, live calls capped at maxCalls, cache upsert). DEFAULT_AI_SYSTEM_PROMPT is fallback only.
     | files: lib/beacon/signals/ai-adjust.ts, lib/beacon/settings.ts
     | verified: yes (typecheck)
T741 | completed | Orchestrator wiring: candidates from flagship dynasty-ppr-sflex skill slice, gated by source spread >= ai_min_spread OR abs(perf) >= ai_min_mover, ranked by contestedness, capped at ai_max_calls. AI folded into skill adjustInputs alongside stat_performance; metadata.ai_adjust = {adjustment_pct, confidence, rationale, cached}. ai_calls written to beacon_value_runs + CalculateBeaconResult. OFF unless ai_enabled AND ai_adjust weight enabled AND ANTHROPIC_API_KEY set.
     | files: lib/calculate-beacon-values.ts
     | verified: yes (typecheck + build)
T742 | completed | SettingField textarea: string settings whose key includes 'prompt' (or value > 60 chars) render a full-width monospace textarea (col-span-2) so the prompt is fully visible + editable, never truncated. AI group description updated.
     | files: components/admin/setting-field.tsx, app/admin/beacon/settings/page.tsx
     | verified: yes (build)
T743 | completed | Smoke test scripts/beacon-ai-smoke.ts + npm run beacon:ai-smoke: reads live prompt/model/bound, one Haiku call, prints parsed/clamped result. Ran ONCE: valid model id, strict JSON parsed, clamp held (adjustment 0.03 in [-0.12,0.12], confidence 0.55). AI left OFF.
     | files: scripts/beacon-ai-smoke.ts, package.json
     | verified: yes (live call succeeded)

### Sources management + a11y pass (completed)
T747 | completed | DEFAULT SOURCE as its own concept. Migration 0053: source_registry.is_default (seeded to ktc to preserve current behavior) + atomic set_default_source(text) RPC (SECURITY DEFINER, service_role-only EXECUTE). resolveSourceForFormat + new pickDefaultSource() honor is_default; resolveSourceSlug + site-header use it. Removed hardcoded DEFAULT_SOURCE_SLUG. Per-user saved pref still wins (resolved earlier in the chain). Default cannot be deactivated (toggleSource blocks it).
     | files: supabase/migrations/0053_source_default_flag.sql, lib/source.ts, lib/preferences.ts, lib/site.ts, components/site-header.tsx, lib/database.types.ts, app/admin/beacon/actions.ts
     | verified: yes (exactly one default; RPC anon/authenticated have no EXECUTE; typecheck + build)
T748 | completed | DISPLAY ORDER control (reuses priority). moveSource(slug, up|down) swaps priority with the adjacent source. Keyboard up/down buttons (no drag), aria-live announces new position. Public picker reads priority order.
     | files: app/admin/beacon/actions.ts, components/admin/sources-manager.tsx
     | verified: yes
T749 | completed | FORMAT DISPLAY NAMES editor. updateFormatDisplayName(formatId, name) writes format_configs.display_name (public UI reads it live). Per-format labeled input + Save + aria-live. Raw slug shown only as dimmed admin reference.
     | files: app/admin/beacon/actions.ts, components/admin/format-names-editor.tsx, app/admin/beacon/sources/page.tsx
     | verified: yes
T750 | completed | New SourcesManager component (replaces source-toggles.tsx, deleted): active switch + set-as-default + reorder per row, shared aria-live region, optimistic updates with revert-on-failure, 44px targets, full keyboard nav. Sources page split into "Value sources" + "Format display names" sections.
     | files: components/admin/sources-manager.tsx, components/admin/format-names-editor.tsx, app/admin/beacon/sources/page.tsx; removed components/admin/source-toggles.tsx
     | verified: yes
T751 | completed | a11y fixes from audit: manual-signals-list deactivate now announces via aria-live + moves focus to next button (or empty-state) instead of dropping it; unique H1 per admin sub-page (BeaconPageShell h2->h1, crons h2->h1) with the shared hero H1 scoped to /admin index (new components/admin/admin-hero.tsx, removed from layout); aria-current=page added to crons JobFilter (incl. All jobs) and subnav Overview (done previously).
     | files: components/admin/{beacon-page-shell,admin-hero,manual-signals-list}.tsx, app/admin/layout.tsx, app/admin/page.tsx, app/admin/crons/page.tsx
     | verified: yes (typecheck + build)
T752 | completed | Deep-tail $0 fix. Migration 0054: skill band floors (QB/RB/WR/TE global) 0 -> 1. Recomputed beacon + rankings + trends: zero $0 skill rows (min now 9-77 by position). ~0.01% compression vs 10000 ceiling, negligible. K/DEF left at 0. is_active + ai_enabled untouched (false).
     | files: supabase/migrations/0054_skill_band_floor.sql
     | verified: yes (no skill value = 0 post-recompute)

### Pre-launch audit (security / a11y / data integrity) - completed
T744 | completed | BLOCKER fixed: seed-rankings filtered sources by is_active, so ffbeacon rankings were never seeded; flipping is_active would have exposed an empty rankings board (ffbeacon is priority 1 = default). Decoupled ranking seeding from is_active (rankings is a derived cache; reads are is_active-gated by resolveSourceForFormat). Pre-staged all 9 ffbeacon ranking formats (5363 rows) with is_active still FALSE.
     | files: lib/seed-rankings.ts
     | verified: yes (rankings now has ffbeacon for 9 formats)
T745 | completed | BLOCKER fixed: seed-rankings silently swallowed a transient PostgREST statement_timeout (caught vErr, continue), dropping an entire (source,format) from rankings with no failure signal (hit on ffbeacon/dynasty-ppr-tep-sflex). Wrapped the value fetch in withRetry; persistent errors now throw instead of shipping a missing format.
     | files: lib/seed-rankings.ts
     | verified: yes (retry recovered tep-sflex; loud failure on exhaustion)
T746 | completed | a11y + rule-6: removed banned em-dash / middle-dot chars across admin (signal-weights, runs, rankings-review, manual-signals-list), added aria-current to subnav Overview chip, surfaced ai_adjust (adj %, confidence, rationale, cached) in rankings-review breakdown + ai_calls in runs monitoring.
     | files: components/admin/{signal-weights-table,rankings-review,manual-signals-list,beacon-subnav}.tsx, app/admin/beacon/runs/page.tsx
     | verified: yes (typecheck + build)
     | RLS audit: all 15 beacon/value/config tables RLS-enabled with correct posture (service-role writes, public SELECT only on data tables, own-row CRUD on custom_formats, no client write path to config/settings/engine tables). Secret key + ANTHROPIC_API_KEY server-only (next.config forwards only the publishable key). Every /admin/beacon page + server action behind requireAdmin (validates JWT + service-role-only is_admin). Cron routes gated by CRON_SECRET, fail closed. No XSS (reason/labels are escaped JSX; no dangerouslySetInnerHTML on user input).

### B7 state: AI integration complete and proven, shipped OFF
- ai_enabled = false, ai_adjust weight is_enabled = false, source_registry.ffbeacon.is_active = false. Nothing flipped.
- EVERY AI prompt is visible + editable in the admin AI settings (the ai_system_prompt textarea on /admin/beacon/settings shows the exact template sent on every call; {bound} is the only runtime substitution).
- Owner reviews all 9 formats via /admin/beacon, tunes, then authorizes is_active flip + the recalculate-beacon cron goes live. Enable AI later to test effectiveness against the non-AI baseline.

### My Rankings - profile display controls (completed, pending owner review)
T760 | completed | Migration 0058: profile-display columns on user_ranking_boards (profile_visible, profile_is_primary, profile_sort). Check constraint primary-implies-visible + partial unique index (one primary per user) + partial index for the featured-in-order read path. Access matrix unchanged from 0056 (owner-only). Types regenerated.
     | files: supabase/migrations/0058_ranking_board_profile_display.sql, lib/database.types.ts
     | verified: yes (constraint + both partial indexes confirmed in pg)
T761 | completed | ProfileBoardsManager client component on /my-beacon/rankings: feature a board on/off, pick ONE primary, reorder secondary boards (up/down). Owner-only RLS writes via browser client; controls disabled during in-flight writes so the ordered multi-statement updates never overlap. First featured board auto-becomes primary; removing the primary auto-promotes the first secondary. aria-live announcements + assertive error region, 44px tap targets, ol for the ranked featured list. Cards show On profile / Primary badges.
     | files: app/my-beacon/rankings/profile-boards-manager.tsx, app/my-beacon/rankings/page.tsx
     | verified: yes (typecheck passed)

### Signal - Phase 0 (data model + RLS) - completed
Public creator-profile feature ("Signal"). Phase 0 is database-only: schema,
RLS, triggers, seeded reserved handles, public media bucket, regenerated types.
No UI shipped (Phase 1 = My Signal editor + public profile at /u/[handle]).
T762 | completed | Migration 0059: signals table (public profile root, one row/user, user_id unique FK auth.users) + signal_reserved_handles (57 seeded) + signal_handle_history (301 redirects). citext handle, bounded accent (8) / layout (feed,sidebar,spotlight), favorite_team (current 32 NFL codes), favorite_player_id FK players, links + layout_config jsonb, status draft/published, visibility public/private only (no unlisted), hidden trio + follower_count. RLS: anon SELECT only published+public+not-hidden; owner reads own any state; column-level GRANTs block owner writes to hidden*/follower_count.
     | files: supabase/migrations/0059_signals.sql, lib/database.types.ts
     | verified: yes (RLS enabled; column-grant matrix; anon/owner/non-owner read sim all correct)
T763 | completed | Migration 0060: public signal-media storage bucket (8MB cap, image mime allowlist) + owner-folder-scoped write RLS. Images re-encoded/EXIF-stripped server-side in Phase 1 before upload.
     | files: supabase/migrations/0060_signal_media_bucket.sql
     | verified: yes (bucket public; folder-scoped writes)
T764 | completed | Migration 0061: signal_posts (Wall) + moderation columns (hidden/hidden_reason/hidden_at/hidden_by) + BEFORE INSERT trigger (rate limits 15s/10per-hour/40per-day, max 3 links). SECURITY DEFINER so the window counts include hidden posts (a hidden post still consumes quota). Column GRANTs block owner writes to hidden*.
     | files: supabase/migrations/0061_signal_posts.sql
     | verified: yes (link cap, 15s, and hourly-cap-incl-4-hidden-of-10 all enforced)
T765 | completed | Migration 0062: signal_post_reports (report/flag). Authenticated-only insert, one per (post, reporter) via unique constraint; admin queue via service_role. Per-reporter rate limit (15s/10h/40d) enforced server-side in the Phase 4 report endpoint.
     | files: supabase/migrations/0062_signal_post_reports.sql
     | verified: yes (anon blocked; reporter scoped to own rows)
T766 | completed | Migration 0063: signal_follows graph (for future For You feed; feed UI deferred) + AFTER trigger maintaining denormalized signals.follower_count. Follower count public via the counter; follower list authenticated-only; insert/delete own follower rows only.
     | files: supabase/migrations/0063_signal_follows.sql
     | verified: yes (follower-count trigger SECURITY DEFINER; self-follow blocked)
T767 | completed | Migration 0064: profile_top_n on user_ranking_boards + public-read RLS for featured boards and board players, gated on owner Signal published+public+not-hidden AND profile_visible. The 0056 owner-only policies remain and OR with this. Phase 2 wraps the read in unstable_cache so the EXISTS subquery runs only on cache miss, never per anon request.
     | files: supabase/migrations/0064_ranking_boards_profile_top_n_and_public_read.sql
     | verified: yes (anon sees featured board only when signal published+public; hidden under unpublished)
T768 | completed | Migration 0065: Phase 0 security-advisor hardening. citext relocated to extensions schema; broad signal-media LIST SELECT policy dropped (public bucket serves via object URL); EXECUTE revoked on both trigger functions from anon/authenticated/public.
     | files: supabase/migrations/0065_signal_phase0_hardening.sql
     | verified: yes (advisor shows zero new warnings; citext still resolves for anon after move)
T769 | completed | Migration 0066: handle CHECK cast to text. Because handle is citext, the ~ operator matched case-insensitively, so the original check wrongly accepted uppercase and would store non-canonical handles. Cast to text makes the regex case-sensitive (lowercase-only); CI uniqueness retained via the citext unique index.
     | files: supabase/migrations/0066_signal_handle_lowercase_check.sql
     | verified: yes (uppercase handle rejected on insert; single handle check + unique index confirmed)
T770 | completed | Migration 0067: trigger hardening from security + implementation reviews. Force created_at = now() on insert (a client could otherwise backdate created_at to evade the rate-limit windows); apply the max-3-links cap on UPDATE too (was insert-only, so an edit could add links). Rate-limit windows remain insert-only.
     | files: supabase/migrations/0067_signal_posts_trigger_hardening.sql
     | verified: yes (backdate overridden to now; 4-link UPDATE blocked, 3-link UPDATE allowed)
     | reviews: implementation + security + accessibility sub-agents run. a11y PASS (no UI shipped; Phase 1 obligations recorded). Security + impl findings (backdating, link-cap-on-update, doc drift) fixed in 0067 + 0060 header note.

### Signal - Phase 1 (handle, identity editor, image hardening, public Layout A) - completed
First user-facing Signal surface. Editor at /my-beacon/signal; public profile at
/u/[handle]. signal-media bucket confirmed public-read (object URLs serve to anon;
0065 only removed listing). Added sharp dependency.
T771 | completed | Migration 0068: authoritative handle lifecycle triggers. BEFORE INSERT/UPDATE guard rejects reserved handles, blocks reclaim of another profile's historical handle (own-reclaim allowed), and rate-limits renames to one per 30 days. AFTER UPDATE records the old handle in signal_handle_history (301 source) and removes the now-active handle from history. SECURITY DEFINER, search_path includes extensions (citext operator), EXECUTE revoked.
     | files: supabase/migrations/0068_signal_handle_lifecycle.sql
     | verified: yes (7-case rolled-back sim: reserved block, valid claim, history record, rename rate limit, cross-profile reclaim block, own-reclaim allowed, active-handle removed from history)
T772 | completed | lib/signal.ts: isomorphic helpers (handle format validation, normalize, length limits, accent slug->gradient map). Used by client editor and server actions.
     | files: lib/signal.ts
     | verified: yes (typecheck)
T773 | completed | Server actions for the editor: checkHandleAvailability (service-role read so it sees draft handles; now requires a session per security review), claimHandle, updateHandle, saveIdentity, setPublishState (stamps published_at once). Writes go through the session client so owner RLS applies; DB triggers are the backstop; trigger errors mapped to friendly copy.
     | files: app/my-beacon/signal/actions.ts
     | verified: yes (typecheck + build)
T774 | completed | POST/DELETE /api/signal/media image hardening route. Same-origin header + auth; Content-Length ceiling before buffering; magic-byte sniff (JPEG/PNG/WebP, SVG rejected, client Content-Type not trusted); per-kind size caps; sharp re-encode to WebP (EXIF/metadata stripped, .rotate() first); avatar 512x512, banner 1600x500 cover; delete-on-replace via admin client (bucket has no SELECT policy so list/remove needs service role, scoped to the caller's own folder); owner-folder upload via session client (RLS-enforced).
     | files: app/api/signal/media/route.ts
     | verified: yes (typecheck + build; bucket public-read confirmed)
T775 | completed | My Signal editor page + client components: handle-manager (claim/change, debounced live availability, aria-live), identity-form (display name/headline/bio), media-uploader (avatar+banner, aria-live), publish-controls (publish toggle with aria-pressed + public/private radio fieldset, assertive announcement of the resulting state). Editor sections use h2 under the layout h1. My Signal nav entry added.
     | files: app/my-beacon/signal/page.tsx, app/my-beacon/signal/{handle-manager,identity-form,media-uploader,publish-controls}.tsx, components/my-beacon-nav.tsx
     | verified: yes (typecheck + build)
T776 | completed | Public profile /u/[handle] (minimal Layout A): banner + avatar + display_name (single h1) + @handle + headline + bio. generateMetadata (title/description/canonical/OG/twitter; noindex for draft/private/hidden). 301 redirect for historical handles + casing canonicalization; notFound for missing; owner preview banner for draft/private/hidden (admin takedown surfaced). Renders inside root layout (global skip link -> main#main). Dynamic for now; caching is Phase 2.
     | files: app/u/[handle]/page.tsx
     | verified: yes (typecheck + build; RLS gates private/draft from non-owners)
T777 | completed | Phase 1 review fixes: delete-on-replace switched to admin client (no bucket SELECT policy); checkHandleAvailability now requires a session (closes unauthenticated draft-handle enumeration); Content-Length ceiling on the media route; public page reads hidden and surfaces moderator takedown to the owner; public @handle contrast bumped ink-subtle->ink-muted (AA); removed redundant fieldset aria-describedby.
     | files: app/api/signal/media/route.ts, app/my-beacon/signal/actions.ts, app/u/[handle]/page.tsx, app/my-beacon/signal/publish-controls.tsx
     | verified: yes (typecheck + build pass after fixes)
     | reviews: implementation + accessibility + security sub-agents run. a11y verdict strong (landmarks, single-h1, fieldset/legend, labeled file inputs, live regions all correct); one AA contrast fix applied; site-wide ink-subtle/signal-danger token contrast flagged as a separate design-system pass (not changed in this phase). Security: 2 mediums (enumeration, pre-cap buffering) fixed; owner-folder scoping, RLS read gating, SECURITY DEFINER triggers, magic-byte+sharp, CSRF header all verified sound.

### Signal - Phase 2 (featured boards + leagues by reference, SignalBlock, public board view, caching, OG, sitemap) - completed
No schema change this phase: signal_league_ids is a new jsonb key on the
existing user_preferences.sleeper_league_settings, and profile_top_n + the
featured-board public-read RLS already shipped in Phase 0 (migration 0064). So
no types regen. Public read paths use createAdminClient (cookie-free, cacheable)
with explicit published+public+not-hidden gating in app code; migration 0064
anon RLS remains as defense-in-depth for direct anon API access (verified in
Phase 0 T767).
T778 | completed | lib/sleeper-league-settings.ts: added ordered signal_league_ids
     string[] to the typed settings + parse (de-dupe, drop non-strings). merge
     helper already key-agnostic.
     | files: lib/sleeper-league-settings.ts
     | verified: yes (typecheck)
T779 | completed | lib/signal-profile.ts: server-only cached data layer.
     loadProfileBundle(handle) tagged signal:{handle} (signal row any-state via
     admin + featured-board metadata + featured-league cards); loadBoardTopN
     keyed board_id+updated_at+limit tagged board:{id} (tag, not key, is the
     real invalidator since player-only edits don't bump updated_at);
     loadPublicBoard tagged board:{id}; resolveHistoricalHandle. League cards
     never call Sleeper; leader resolved from league_power_rankings_cache via
     the default source. isProfileLive gate.
     | files: lib/signal-profile.ts
     | verified: yes (typecheck + build)
T780 | completed | components/signal/signal-block.tsx: shared SignalBlock section
     wrapper + FeaturedBoardsBlock (Top-N by reference, parallel per-board cached
     reads, empty board skipped) + FeaturedLeaguesBlock (synced-only cards,
     unsynced ids skipped). No player values, no raw source slugs.
     | files: components/signal/signal-block.tsx
     | verified: yes (build)
T781 | completed | app/u/[handle]/page.tsx rewritten: live path is cookie-free
     (cacheable; reads only loadProfileBundle), owner-preview path reads cookies
     and re-checks ownership; historical 301; casing canonicalization; OG image
     wired to /api/og/signal/[handle]; ISR revalidate=3600. Blocks appended.
     | files: app/u/[handle]/page.tsx
     | verified: yes (build; route renders dynamic because owner-preview branch
       reads cookies, but the heavy DB reads are tag-cached so anon hits are
       served from the data cache - deliberate split per handoff item 5)
T782 | completed | app/u/[handle]/rankings/[boardId]/page.tsx: public read-only
     board view. loadPublicBoard gates on owner live + profile_visible; tier
     grouping with continuous numbering; canonical-handle 301; noindex when not
     resolvable.
     | files: app/u/[handle]/rankings/[boardId]/page.tsx
     | verified: yes (build)
T783 | completed | app/api/og/signal/[handle]/route.tsx: 1200x630 brand-locked OG
     (accent gradient, avatar, name, @handle, headline). nodejs runtime, s-maxage
     3600 + swr 86400. Non-live profiles return a generic branded fallback (never
     leak existence). No DPC gold / #0c0c18.
     | files: app/api/og/signal/[handle]/route.tsx
     | verified: yes (build)
T784 | completed | app/sitemap.ts: core static pages + only live (published+
     public+not-hidden) /u/{handle}; revalidate hourly.
     | files: app/sitemap.ts
     | verified: yes (build; /sitemap.xml prerendered, 1h revalidate)
T785 | completed | Caching invalidation wiring. signal editor actions now
     revalidateTag(signal:{handle}) on claim/rename(both old+new)/identity/publish
     + saveSignalLeagues. New app/my-beacon/rankings/actions.ts: revalidateBoardCache
     (re-verifies board ownership, busts board:{id} + owner signal tag) called by
     board-editor on every save path; revalidateMySignal called by the boards
     manager after every curation write.
     | files: app/my-beacon/signal/actions.ts, app/my-beacon/rankings/actions.ts,
       app/my-beacon/rankings/[boardId]/board-editor.tsx
     | verified: yes (typecheck + build)
T786 | completed | profile_top_n control on the boards manager (per featured
     board <select>: Default(10/5) or Top 5/10/15/20/25/50), writes via browser
     client under owner RLS then revalidateMySignal. page.tsx loads profile_top_n.
     | files: app/my-beacon/rankings/profile-boards-manager.tsx, app/my-beacon/rankings/page.tsx
     | verified: yes (typecheck + build)
T787 | completed | Featured-leagues editor in My Signal: server resolves the
     owner's synced leagues (saved Sleeper username -> getSleeperUser -> league_users
     -> leagues; editor MAY call Sleeper, public page never does), client manager
     features/removes/reorders, saveSignalLeagues persists ordered ids (digit-only,
     deduped, capped 12) + revalidates.
     | files: app/my-beacon/signal/page.tsx, app/my-beacon/signal/signal-leagues-manager.tsx, app/my-beacon/signal/actions.ts
     | verified: yes (typecheck + build)
T788 | completed | Phase 2 review fixes (implementation + a11y + security sub-agents).
     | fixes:
       - BLOCKER (impl): avatar/banner edits never busted the profile cache. Added
         a shared revalidateProfileCaches(supabase, userId) in lib/signal-profile.ts
         (busts signal:{handle} AND every board:{id} for the user) and call it from
         the media route POST+DELETE.
       - WARNING (security): loadPublicBoard was tagged board:{id} only, so an
         unpublish (busts signal tag) left a board view cached up to 1h = a
         time-bounded leak after going private; and featuring a previously-hidden
         board left its cached-null view 404ing up to 1h. Fixed by routing publish
         state, handle rename, identity (display_name shows on board view), featured
         leagues, and the boards-manager curation through revalidateProfileCaches so
         board caches are busted too.
       - NIT (security): replaced unicode ellipsis with "..." in the OG clip (rule 6).
       - NIT (impl): dropped max-age=300 from the signal OG cache-control to match
         the handoff spec (s-maxage only).
       - WARNING (a11y): ink-subtle -> ink-muted (AA) for board rank numbers, player
         position/team metadata, and tier section headings on the public board view +
         FeaturedBoardsBlock. Replaced the middle-dot position/team separator with a
         comma (rule 6).
     | files: lib/signal-profile.ts, app/my-beacon/signal/actions.ts,
       app/my-beacon/rankings/actions.ts, app/api/signal/media/route.ts,
       app/api/og/signal/[handle]/route.tsx, components/signal/signal-block.tsx,
       app/u/[handle]/rankings/[boardId]/page.tsx
     | verified: yes (typecheck + build green after fixes)
     | reviews summary: impl review PASS after BLOCKER fix (cache coverage,
       no-Sleeper-in-public-path, skip-on-missing-reference, no source/format leak,
       naming, OG brand all confirmed). security review: no BLOCKER; the one real
       WARNING (unpublish/feature board stale-cache) fixed; IDOR/enumeration,
       OG/sitemap non-live gating, server-side input validation, secret-key
       isolation, no XSS, no open-redirect all verified. a11y review: no BLOCKER;
       single-h1/landmarks/aria-live/44px targets/focus-visible all correct; the
       four contrast+separator WARNINGs fixed. Known carryover: site-wide
       ink-subtle/signal-danger token contrast is a separate design-system pass.
     | deferred (non-blocking): public full-board view caps at 1000 players
       (Supabase default; fantasy boards rarely exceed a few hundred); loadPublicBoard
       relies on tag invalidation rather than an updated_at key (now comprehensively
       covered by revalidateProfileCaches).

### Signal - Phase 3 (customization: accent palette, custom links, favorites) - completed
Accent picker, custom links, and favorite team/player editors on /my-beacon/signal,
with matching public render on /u/[handle]. Every save path routes through
revalidateProfileCaches(). One migration was needed after all (the accent CHECK had
to move to the new 10-slug set and links gained a real DB shape guard); owner
reviewed and approved 0069.
T789 | completed | Migration 0069: accent CHECK -> Phase 3 fixed 10-slug palette
     (beacon/violet/azure/cyan/mint/lime/amber/ember/rose/magenta) + function-backed
     signals_links_shape_check (signal_links_valid: array <=10, each {label 1..40
     string, url <=2048 string matching ^https://}). signals table empty so no
     backfill. EXECUTE on the validator granted to authenticated+service_role,
     revoked from anon/public (constraint is evaluated by the writing role).
     | files: supabase/migrations/0069_signal_customization.sql
     | verified: yes (both constraints live; validator returns correct booleans for
       valid/empty-label/http/javascript/over-10 cases; authenticated can execute it;
       no DDL adding columns so database.types.ts unchanged)
T790 | completed | lib/signal/accents.ts: SIGNAL_ACCENTS source of truth (10 AAA
     accents, every textOnFill #07070D) + SIGNAL_ACCENT_SLUGS + DEFAULT_ACCENT +
     ACCENT_SPOKEN_NAME + helpers. accentFillStyle returns the LOCKED
     {backgroundColor, color:textOnFill} pair so white-on-accent is impossible;
     accentInkColor for accent-as-text/border/icon on dark; accentGradient derives a
     decorative banner gradient from the single hex. lib/signal.ts re-exports these;
     OG route updated to resolveAccent().hex (old accent.to gone).
     | files: lib/signal/accents.ts, lib/signal.ts, app/api/og/signal/[handle]/route.tsx
     | verified: yes (typecheck + build)
T791 | completed | lib/nfl-teams.ts: canonical 32-team code+name list, exactly matching
     the signals.favorite_team CHECK. NFL_TEAM_CODES set + isNflTeamCode + nflTeamName.
     | files: lib/nfl-teams.ts
     | verified: yes (32 codes byte-match the 0059 CHECK)
T792 | completed | Server actions + shared constants. saveAccent (isSignalAccent
     gate), saveLinks (https-only, URL parse, label 1..40, max 10), saveFavorites
     (team in 32-list, player uuid + existence, null clears), searchPlayers
     (session-gated typeahead, sanitized single .ilike, no .or interpolation). Constants
     + types live in customization.ts because a "use server" file may only export async
     functions. Every write calls revalidateProfileCaches().
     | files: app/my-beacon/signal/actions.ts, app/my-beacon/signal/customization.ts
     | verified: yes (typecheck + build)
T793 | completed | Editor client components. accent-picker (native-radio radiogroup,
     arrow-key, live preview using fill + ink helpers, aria-live); links-editor
     (add/edit/remove + accessible move up/down reusing the boards-manager pattern,
     client mirror of the https/label/max-10 validation, unsaved-changes hint);
     favorites-editor (labeled team select + WAI-ARIA combobox typeahead with
     aria-activedescendant, debounced searchPlayers, clear-to-null announced). Wired
     into /my-beacon/signal as Appearance/Links/Favorites sections loading current values.
     | files: app/my-beacon/signal/{accent-picker,links-editor,favorites-editor,page}.tsx
     | verified: yes (typecheck + build; /my-beacon/signal 12.5 kB)
T794 | completed | Public render. loadProfileBundle extended with links (parsed,
     https-guarded on read) + resolved favorite team/player; LinksBlock (rel=noopener
     noreferrer target=_blank, label-not-URL, "(opens in a new tab)") + FavoritesBlock
     (accent-as-fill chips, black text always; player chip links to /players/[slug])
     rendered on /u/[handle].
     | files: lib/signal-profile.ts, components/signal/signal-block.tsx, app/u/[handle]/page.tsx
     | verified: yes (typecheck + build)
T795 | completed | Three sub-agent reviews (implementation + accessibility + security).
     | result: zero BLOCKERs across all three.
     | fixes applied:
       - rule 6: replaced a pre-existing middle-dot separator in FeaturedLeaguesBlock
         with a comma (file Phase 3 touched)
       - a11y: non-option status rows ("Searching..."/"No players match") in the
         combobox listbox given role="presentation"; clear() now also closes the listbox
       - a11y: links-editor move announcement computed outside the setRows updater so
         rapid moves announce reliably
       - security: parseProfileLinks now drops any non-https url on the public read
         path (defense in depth beyond the write-time + DB CHECK guards)
     | accepted (non-blocking): searchPlayers has no server rate limit. It is
       session-gated, returns only public player data, caps at 20 rows, and is
       client-debounced; treated as low-risk read-only. Revisit if abused.
     | a11y verified: radiogroup + combobox patterns, descriptive move/remove labels,
       aria-live confirmations, AAA fill-with-black-text everywhere, 44px targets,
       single-h1 hierarchy, no data hidden at any breakpoint.

### Signal - Phase 4a (text posts + moderation) - completed
The Wall ships as TEXT posts first. Architectural decision (owner-approved): the
public Wall renders DYNAMICALLY (not folded into the cached signal:{handle}
bundle). /u/[handle] is now force-dynamic; loadWallPosts reads live via the admin
client with explicit live-gating, while the identity bundle keeps its
unstable_cache data cache. This avoids stale posts and avoids stranger
comments/reactions (sub-phase c onward) busting the owner's whole profile cache.
Reporting is polymorphic from the start (posts + comments) so sub-phase c reuses
the same endpoint + admin queue with no rework.
T796 | completed | Migration 0070: polymorphic signal_reports (target_type post|comment,
     target_id, reporter, reason, details, status, unique per target+reporter) +
     drop empty signal_post_reports + AFTER DELETE trigger on signal_posts that
     auto-resolves a deleted post's open reports to 'dismissed' (no FK cascade
     because the table is polymorphic, so dangling reports are prevented by
     trigger, keeping an audit trail). Per-reporter rate limit stays server-side.
     | files: supabase/migrations/0070_signal_reports_polymorphic.sql, lib/database.types.ts
     | verified: yes (RLS enabled + 3 policies; rolled-back anon/auth scoping sim:
       anon sees 0, each user sees only own; trigger present; old table dropped;
       types regenerated, signal_reports present + signal_post_reports gone)
T797 | completed | lib/signal.ts: POST_BODY_MAX(2000)/POST_LINKS_MAX(3) +
     codePointLength (matches Postgres char_length, the authoritative cap) +
     countLinks (mirrors the trigger https?:// count) + graphemeLength (Intl.Segmenter,
     friendly counter). Honest note: cap is CODE-POINT based, counter is grapheme-aware.
     | files: lib/signal.ts
     | verified: yes (typecheck)
T798 | completed | lib/signal-wall.ts: server-only live Wall loader (loadWallPosts,
     pinned-first, includeHidden gate so public never leaks a taken-down post).
     | files: lib/signal-wall.ts
     | verified: yes (typecheck)
T799 | completed | Owner post server actions (createPost/updatePost/deletePost/
     setPostPinned), session client + owner RLS, body+link validation mirror,
     trigger RAISE -> friendly copy, revalidateProfileCaches on each write.
     | files: app/my-beacon/signal/wall-actions.ts
     | verified: yes (typecheck + build)
T800 | completed | Composer + owner manager: WallComposer (grapheme counter,
     code-point gate, aria-live), WallManager (edit/delete-with-confirm/pin,
     hidden-by-moderator flag, aria-live), PostBody (safe linkify, no
     dangerouslySetInnerHTML). Wired into /my-beacon/signal Wall section.
     | files: app/my-beacon/signal/{wall-composer,wall-manager}.tsx,
       components/signal/post-body.tsx, app/my-beacon/signal/page.tsx
     | verified: yes (build)
T801 | completed | Public Wall render: WallBlock on /u/[handle] (dynamic),
     ReportButton (viewer-agnostic, resolves auth at submit). Page switched to
     force-dynamic; signal id added to ProfileBundle for the live posts read.
     | files: components/signal/{wall,report-button}.tsx, app/u/[handle]/page.tsx,
       lib/signal-profile.ts
     | verified: yes (build; /u/[handle] now renders dynamically)
T802 | completed | Report endpoint /api/signal/report: same-origin header + auth +
     per-reporter rate limit (15s/10h/40d) + target-publicly-reportable check +
     unique-violation -> alreadyReported. Posts only this phase (comments rejected
     until sub-phase c).
     | files: app/api/signal/report/route.ts
     | verified: yes (build)
T803 | completed | Admin moderation: /admin/signal index + /admin/signal/reports
     queue (grouped by post), hidePost/unhidePost/setReportStatus actions
     (requireAdmin + service role), Signal nav entry. Hiding resolves open reports
     to 'actioned' and busts the owner's profile caches.
     | files: app/admin/signal/{page,actions}.tsx, app/admin/signal/reports/page.tsx,
       components/admin/report-queue.tsx, components/admin-nav.tsx
     | verified: yes (build)

### Signal - Phase 4b (post images) - completed
Up to 4 images per post, each with REQUIRED alt text. Reuses the signal-media
bucket (owner-folder scoped) under "<uid>/posts/<uuid>.webp". The 4-image cap is
structural (ordinal 0..3 + unique(post_id, ordinal)), no trigger needed. Images
are creation-time only this phase; editing a post's images is deferred (delete +
repost). IMAGES-XOR-GIF guard is a sub-phase (d) task (no gif column yet); both
enforcement directions are specified in the 0071 header and the handoff.
T804 | completed | Migration 0071: signal_post_images (post_id FK cascade, alt_text
     CHECK 1..420, width/height > 0, ordinal 0..3 unique per post). RLS: public
     SELECT join-gated through post + parent Signal live; owner SELECT/INSERT/DELETE
     own via the same join; service_role ALL.
     | files: supabase/migrations/0071_signal_post_images.sql, lib/database.types.ts
     | verified: yes (rolled-back RLS sim: anon + other-user see image only while
       parent live, owner sees own, anon sees 0 after unpublish, cross-user insert
       blocked by RLS; types regenerated, signal_post_images present)
T805 | completed | lib/signal/image-sniff.ts: shared magic-byte sniff extracted;
     /api/signal/media refactored to import it (no duplication).
     | files: lib/signal/image-sniff.ts, app/api/signal/media/route.ts
     | verified: yes (typecheck + build)
T806 | completed | /api/signal/post-image upload route: same-origin + auth +
     Content-Length ceiling + size cap + sniff + sharp re-encode to WebP (fit
     inside, longest edge 1600, withoutEnlargement, metadata stripped). Returns
     path + public URL + dimensions; writes NO DB row (composer attaches on submit).
     | files: app/api/signal/post-image/route.ts
     | verified: yes (build)
T807 | completed | createPost extended with images: server-side validation (<=4,
     path must be inside caller's own "<uid>/posts/" + .webp, alt 1..420, positive
     int dims); inserts signal_post_images with ordinal; rolls back the post if the
     image insert fails so no half-posted text-only row remains.
     | files: app/my-beacon/signal/wall-actions.ts
     | verified: yes (typecheck + build)
T808 | completed | Composer image UI (upload one at a time, required alt per image,
     remove, submit gated until every image is described) + PostImages render grid
     (1 full / 2+ two-col, creator alt, lazy) shown on public Wall + owner manager;
     owner page + loadWallPosts load images.
     | files: app/my-beacon/signal/wall-composer.tsx, components/signal/post-images.tsx,
       components/signal/wall.tsx, app/my-beacon/signal/wall-manager.tsx,
       lib/signal-wall.ts, app/my-beacon/signal/page.tsx
     | verified: yes (typecheck + build)

### Signal - Phase 4 a/b sub-agent review (completed)
Three reviews (implementation, accessibility, security) over the 4a+4b diff.
- Security: NO blockers. RLS on signal_reports + signal_post_images verified sound
  (join-gated public read cannot leak a draft/hidden parent; moderation columns
  service-role-only; admin actions re-validate requireAdmin; report endpoint
  IDOR/enumeration/rate-limit/CSRF correct; image route sniff + sharp re-encode +
  path scoping correct; no dangerouslySetInnerHTML; secrets server-only).
- Implementation: NO blockers. Cache model, polymorphic reports, dangling-report
  trigger, and the structural 4-image cap all verified.
- Accessibility: one BLOCKER fixed (report panel focus return) + 44px target bumps
  + alt counter, all in commit 4537173.
- Deferred (documented in handoff, consistent with the existing media-route
  posture): report-endpoint rate-limit TOCTOU (unique constraint makes it
  low-stakes); per-user image-upload throttle + orphan-object reaper; editing a
  post's images (delete + repost for now); WebP FourCC sniff tightening (sharp
  re-encode already mitigates).
Commits (main, NOT pushed): 90f4634 (4a), b43e7d1 (4b), 4537173 (review fixes).

### Signal - Phase 4c (comments) - completed
Comments on Wall posts, written by ANY signed-in user (not just the profile
owner), so signal_comments carries an explicit author_user_id and the rate limit
is per author. Text only this sub-phase (GIF/emoji/reactions are d-f). The Wall
stays DYNAMIC: comment writes never bust the cached signal:{handle} bundle (the
mutations only router.refresh()). Reporting reuses the polymorphic signal_reports,
the one report endpoint, and the one admin queue (now a post/comment union).
T809 | completed | Migration 0072: signal_comments (post_id FK cascade,
     author_user_id references auth.users, body 1..1000, hidden* moderation
     columns service-role-only via column grants). Per-author rate-limit BEFORE
     INSERT/UPDATE trigger (15s/10h/40d counting hidden rows, created_at forced
     now(), link cap 2 on insert AND update, SECURITY DEFINER), a faithful port of
     the hardened posts trigger (0067) keyed on author_user_id. AFTER DELETE
     dangling-report trigger mirroring 0070 for target_type='comment'. RLS: public
     read gated through comment+post+signal live; author select/update/delete own;
     wall-owner select any state.
     | files: supabase/migrations/0072_signal_comments.sql, lib/database.types.ts
     | verified: yes (7 policies; INSERT/UPDATE column grants exclude hidden*;
       rolled-back anon/auth sim, 10 checks: anon sees only visible-on-live, wall
       owner sees hidden, other user sees 1, insert-on-live allowed, insert-on-
       hidden-post blocked, cross-user update/delete 0 rows, own update 1 row,
       hidden-column write denied, anon sees 0 after unpublish; probe data cleaned;
       types regenerated, signal_comments present)
T810 | completed | lib/signal.ts: COMMENT_BODY_MAX(1000)/COMMENT_LINKS_MAX(2),
     reusing codePointLength/countLinks/graphemeLength.
     | files: lib/signal.ts
     | verified: yes (typecheck)
T811 | completed | lib/signal-wall.ts: WallComment type + loadCommentsForPosts
     (oldest-first, includeHidden gate, author identity resolved from signals with
     a live-only @handle link), loadWallPosts now loads comments + new
     includeHiddenComments param.
     | files: lib/signal-wall.ts
     | verified: yes (typecheck + build)
T812 | completed | app/u/[handle]/comment-actions.ts: createComment/updateComment/
     deleteComment (author, session client + author RLS, trigger-error mapping) +
     moderateComment (re-validates owner-of-parent-signal OR admin, then writes
     hidden* via admin client; hide resolves open comment reports to actioned).
     No profile-cache revalidation (Wall is dynamic).
     | files: app/u/[handle]/comment-actions.ts
     | verified: yes (typecheck + build)
T813 | completed | components/signal/comment-section.tsx: composer (grapheme
     counter, code-point gate, aria-live) + comment list with author edit/delete
     (confirm) and owner/admin hide/restore + Report. NVDA: labeled fields,
     describedby counters, focus management on edit + delete-confirm, per-comment
     article aria-label, 44px targets, AA contrast (ink-muted).
     | files: components/signal/comment-section.tsx
     | verified: yes (typecheck + build)
T814 | completed | Wire-up: WallBlock renders CommentSection per post and threads
     viewer context; /u/[handle] resolves viewer (userId + isAdmin) on both live
     and owner-preview paths and gates includeHiddenComments on owner||admin; owner
     editor WallPost mapping gets comments:[] (manager is posts-only).
     | files: components/signal/wall.tsx, app/u/[handle]/page.tsx,
       app/my-beacon/signal/page.tsx
     | verified: yes (build; /u/[handle] still dynamic)
T815 | completed | Report endpoint accepts target_type='comment' (comment-specific
     live-gating join); admin queue is now a post/comment union (report-queue.tsx
     discriminated groups + moderateComment for comment hide/restore); reports page
     loads both targets + comment authors. ReportButton legend + trigger aria-label
     vary by target type.
     | files: app/api/signal/report/route.ts, components/admin/report-queue.tsx,
       app/admin/signal/reports/page.tsx, components/signal/report-button.tsx
     | verified: yes (typecheck + build)

### Signal - Phase 4c sub-agent review (completed)
Three reviews (implementation, accessibility, security) over the (c) diff.
- Implementation: NO blockers/important. Trigger is a faithful per-author port of
  0067; RLS + column grants + moderation authz + dynamic-wall cache model all
  verified. Minor: endpoint does not block self-reporting (pre-existing posts
  posture, capped by the unique constraint).
- Security: NO blockers/important. RLS, SECURITY DEFINER trigger, moderateComment
  re-validate-then-elevate authz (no IDOR), report endpoint gating, XSS (PostBody,
  no dangerouslySetInnerHTML, handle CHECK blocks href breakout), no auth.users
  exposure, dangling-report trigger all verified. Minor: hidden_reason has no DB
  length CHECK (the action slices to 300; parity with signal_posts which also has
  none); report rate-limit TOCTOU (capped by unique constraint, matches 0062/0070
  decision).
- Accessibility: 3 IMPORTANT fixed in-session: (1) helper/counter text moved off
  ink-subtle to ink-muted for AA; (2) each comment row wrapped in an
  article[aria-label="Comment by {author}, {date}"] so repeated Edit/Delete/Hide/
  Report controls are announced in a named context; (3) delete-confirm now moves
  focus to "Yes, delete" (group-labeled) and returns focus to the Delete trigger
  on Keep. Also wired edit-textarea aria-describedby to its counters. Confirmed
  clean: keyboard nav + visible focus, 44px public tap targets, decorative icons
  aria-hidden, no data hidden at any breakpoint.

### Signal - Phase 4d (GIFs via GIPHY) - completed
GIFs on Wall posts and comments via a server-side GIPHY proxy. Provider change
from the original handoff: Tenor is discontinued (closed to new API clients Jan
2026, service ends June 30 2026), so this uses GIPHY. GIPHY_API_KEY is server-only
(read only in the proxy route, never forwarded to the client). We are on a GIPHY
BETA key; a PRODUCTION key must be applied for before public launch (the required
"Powered by GIPHY" attribution is already built in to pass review).
T816 | completed | Migration 0073: gif jsonb (nullable) on signal_posts AND
     signal_comments + function-backed signal_gif_valid CHECK ({giphy_id, url,
     preview_url, alt, width, height}; alt REQUIRED 1..420; https-only urls; dims
     1..10000), mirroring signals_links_valid (0069). IMAGES-XOR-GIF in BOTH
     directions: Direction A = BEFORE INSERT OR UPDATE trigger on signal_posts
     (signal_posts_block_gif_when_images) rejects a gif when the post has images;
     Direction B = BEFORE INSERT trigger on signal_post_images
     (signal_post_images_block_when_gif) rejects an image when the post has a gif.
     Both SECURITY DEFINER, EXECUTE revoked from anon/auth/public. Column grants:
     insert(gif) on posts; insert(gif)+update(gif) on comments.
     | files: supabase/migrations/0073_signal_gif.sql, lib/database.types.ts
     | verified: yes (rolled-back DO block, 8 checks: valid gif ok, empty-alt
       rejected on BOTH tables, Direction A blocked, Direction B blocked, comment
       valid gif ok, anon sees gif on live post=1, anon sees 0 after unpublish;
       types regenerated, gif present on both tables + signal_gif_valid fn)
T817 | completed | lib/signal.ts: SignalGifInput type + GIF_ALT_MAX + validateGifInput
     (https-only urls, giphy_id 1..64, alt required 1..420, integer dims 1..10000).
     | files: lib/signal.ts
     | verified: yes (typecheck)
T818 | completed | lib/signal/giphy.ts: normalizeGiphySearch -> {id, url, preview_url,
     alt, width, height} + hasMore. url = animated rendition, preview_url = STATIC
     still, PAIRED from the same rendition family so stored dims match the still. alt
     = alt_text else title else "". Raw GIPHY payload never reaches the client.
     | files: lib/signal/giphy.ts
     | verified: yes (typecheck + build)
T819 | completed | GET /api/signal/gif/search: GIPHY_API_KEY server-only; rating=g
     LOCKED server-side (never from client); same-origin + session gate; light
     best-effort per-user throttle (in-memory, with eviction); offset paging capped
     at 200; 8s timeout; search-on-query only (no trending endpoint).
     | files: app/api/signal/gif/search/route.ts
     | verified: yes (build; route compiled)
T820 | completed | components/signal/animated-gif.tsx: static preview by default for
     everyone (honors prefers-reduced-motion), explicit labeled play/pause (aria-
     pressed, never autoplay), alt always present, visible + SR "Powered by GIPHY"
     on every GIF. 44px control.
     | files: components/signal/animated-gif.tsx
     | verified: yes (build)
T821 | completed | components/signal/gif-picker.tsx: NVDA-operable picker. Search-on-
     query (debounced), labeled search box, result buttons labeled by description,
     aria-live status, focus to search on open / textarea on insert / trigger on
     close, optional alt field (required when empty), "Powered by GIPHY" attribution,
     offset paging (Show more).
     | files: components/signal/gif-picker.tsx
     | verified: yes (build)
T822 | completed | Wire-up: lib/signal-wall.ts WallGif (+giphyId) + parseWallGif read-
     path + gif on WallPost/WallComment selects/maps; wall-actions createPost gif
     (images-XOR-gif app guard + revalidateProfileCaches); comment-actions create/
     update gif (resolveGif; Wall stays dynamic, no profile-cache revalidation);
     WallComposer + comment Composer + comment edit get the picker; AnimatedGif
     rendered in wall.tsx, comment-section, wall-manager, owner page mapping.
     | files: lib/signal-wall.ts, app/my-beacon/signal/{wall-actions.ts,wall-composer.tsx,
       wall-manager.tsx,page.tsx}, app/u/[handle]/comment-actions.ts,
       components/signal/{comment-section.tsx,wall.tsx}
     | verified: yes (typecheck + build green)

### Signal - Phase 4d sub-agent review (completed)
Three reviews (security, accessibility, implementation) over the (d) diff.
- Security: CLEAN, no blocker/important. Confirmed GIPHY_API_KEY server-only,
  rating=g locked server-side, same-origin+auth+throttle, https-only at write
  (validateGifInput) + DB CHECK + read (parseWallGif), no dangerouslySetInnerHTML,
  fixed-host fetch (no SSRF), images-xor-gif enforced at DB both directions,
  accessible-text invariant has no bypass. Applied minors: throttle-map eviction +
  offset/hasMore cap.
- Implementation: CLEAN. Applied minor: paired the still rendition to the chosen
  animated family so stored dims match the still (CLS); two comment rewordings.
- Accessibility: no blockers. Fixed one IMPORTANT: load-bearing ink-subtle ->
  ink-muted (AA) in wall-composer (help/counters/alt-hint/remove buttons/image
  counter). Confirmed: keyboard + NVDA picker, focus management, 44px targets,
  default-static GIF + labeled play/pause, "Powered by GIPHY" on every GIF, no data
  hidden at any breakpoint, no em-dashes. Known carryover (pre-existing suite-wide
  pattern, not changed to avoid divergence): error region uses aria-live wrapper +
  inner role="alert" (possible double-announce) across the Signal composer suite.

### Signal - Phase 4e (inline emoji) - completed
Inline emoji in the post and comment composers. Emoji are plain Unicode inserted
into the existing body text: NO migration, NO new storage, NO schema change, and
strictly distinct from the (f) custom-reaction system. The dataset is bundled
in-app (no external CDN, no runtime fetch, no new npm dependency).
T823 | completed | lib/signal/emoji-data.ts: bundled curated emoji dataset by
     category (char + name; name doubles as the accessible label and search
     keyword). Includes a sports/football-leaning Activities category.
     | files: lib/signal/emoji-data.ts
     | verified: yes (typecheck)
T824 | completed | lib/signal/insert-at-cursor.ts: pure caret-insertion helper
     (uses selectionStart/selectionEnd, replaces the active selection, returns the
     caret offset after the inserted text).
     | files: lib/signal/insert-at-cursor.ts
     | verified: yes (typecheck)
T825 | completed | components/signal/emoji-picker.tsx: NVDA-operable picker. Search
     box (filters by name), category buttons (aria-pressed), and a roving-tabindex
     emoji group (COLUMNS=6 matches grid-cols-6 so Up/Down moves one visual row;
     Arrow/Home/End move, Enter/Space inserts; each cell labeled by emoji name with
     the glyph aria-hidden). Focus to search on open; polite aria-live result count;
     44px targets. Review fix: role="group" (not a malformed role="grid" without
     row/gridcell); dead regionId removed; ref array reset each render.
     | files: components/signal/emoji-picker.tsx
     | verified: yes (typecheck + build)
T826 | completed | Wire-up into BOTH composers AND comment edit: insertAtCursor +
     setSelectionRange place the emoji at the caret and return focus to the textarea;
     trigger labeled "Insert emoji" with aria-expanded; opening the emoji picker
     closes the GIF picker and vice versa (coherent toolbar). Submit still gates on
     codePointLength (matches the DB char_length CHECK); the counter stays
     grapheme-aware; helper text does not imply a grapheme cap.
     | files: app/my-beacon/signal/wall-composer.tsx, components/signal/comment-section.tsx
     | verified: yes (typecheck + build green)

### Signal - Phase 4e sub-agent review (completed)
Three reviews (accessibility, implementation, security) over the (e) diff.
- Security: CLEAN, no findings. Client-only feature; emoji ride the existing
  create/update actions and the code-point body CHECK is authoritative server-side;
  no new network call/CDN/secret, no dangerouslySetInnerHTML, no prototype-pollution
  surface in insertAtCursor.
- Implementation: CLEAN. No migration/storage; bundled dataset; cursor insertion;
  three integration points; code-point gating preserved; coherent toolbar; same
  controlled state. Emoji chars spot-checked valid.
- Accessibility: one IMPORTANT fixed (role="grid" lacked required row/gridcell
  structure -> switched to role="group", keeping the roving tabindex), plus minors
  (removed a dead regionId; reset the ref array each render). Confirmed: keyboard +
  NVDA roving grid, labeled trigger/search/categories, focus to search on open /
  textarea after insert / trigger on close, polite live count, 44px targets, no data
  hidden at any breakpoint, no em-dashes.

### Signal - Phase 4f COMMIT 1 (custom reactions data layer + admin catalog) - completed
The final Phase 4 sub-phase, split into two commits to stay within budget. COMMIT 1
is the data layer plus the admin reaction catalog. COMMIT 2 (public reaction picker
+ counts on posts and comments) is STILL PENDING (see handoff.md).
T827 | completed | Migration 0074: signal_reaction_types (admin catalog) +
     signal-reaction-emojis public bucket. slug unique (lowercase kebab, 1..40),
     label required 1..60, kind in ('image','text'), char required+1..32 when text,
     image_path required+1..400 when image (payload-matches-kind CHECK enforces the
     xor), display_order, is_active, timestamps. RLS: public SELECT incl disabled
     rows (so historical counts stay labeled) + service_role ALL, NO client write
     path. Bucket: public, image/webp only, 256 KB cap (defense in depth over the
     route's ~100 KB), no LIST policy (public reads via object URL, service-role
     writes only), matching signal-media post-0065 posture.
     | files: supabase/migrations/0074_signal_reaction_types.sql, lib/database.types.ts
     | verified: yes (applied via MCP; pg_policies shows public SELECT + service ALL;
       bucket confirmed public/webp/256KB; RLS enabled)
T828 | completed | Migration 0075: signal_reactions + signal_reaction_counts +
     SECURITY DEFINER count trigger + signal_target_publicly_viewable helper.
     signal_reactions(target_type post|comment, target_id, reaction_type_id FK ON
     DELETE RESTRICT, user_id FK auth.users cascade, unique(target_type,target_id,
     reaction_type_id,user_id)). signal_reaction_counts(PK (target_type,target_id,
     reaction_type_id), count; reaction_type_id FK ON DELETE CASCADE for zeroed-row
     cleanup). AFTER INSERT/DELETE trigger upserts count +1 / floored -1, mirroring
     follower_count (0063). RLS: reactions authenticated SELECT (own OR target
     publicly viewable), INSERT own (target publicly viewable AND reaction type
     active), DELETE own, NO UPDATE, service_role ALL; counts public SELECT GATED on
     signal_target_publicly_viewable (review fix: prevents enumerating engagement
     metadata for hidden/draft/private targets), service_role ALL.
     signal_target_publicly_viewable(text,uuid): SECURITY DEFINER, search_path pinned,
     STABLE, EXECUTE granted to anon/authenticated/service_role (required for use
     inside RLS), revoked from public; predicate matches the 0071/0072 public-read
     gating.
     | files: supabase/migrations/0075_signal_reactions.sql, lib/database.types.ts
     | verified: yes (rolled-back DO block, 15 checks all PASS: react own active on
       public post/comment, duplicate blocked by unique, inactive-type blocked,
       hidden-post blocked, impersonation blocked, own+public SELECT scope, no UPDATE
       (0 rows), cross-user delete 0 rows, anon sees 0 reactions, anon reads public
       counts, anon counts-write blocked, trigger +1/-1; plus a focused gate check:
       anon sees counts for a public target, 0 for a hidden target. All probe rows
       rolled back, zero leakage)
T829 | completed | Admin reaction-emoji upload route + shared catalog helper.
     POST /api/admin/signal/reaction-emoji: same-origin header + getIsAdmin (never
     trusts client) + Content-Length ceiling + size cap + magic-byte sniff (reuses
     lib/signal/image-sniff, rejects SVG) + sharp animated:false STATIC re-encode to
     WebP (<=256x256, metadata stripped, quality step-down to ~100 KB) + service-role
     upload to signal-reaction-emojis. lib/signal/reactions.ts: isomorphic helper
     (ReactionType type, reactionImageUrl, validateReactionType mirroring the DB
     CHECKs; image_path validated to the strict ^reactions/<uuidv4>.webp$ shape so a
     reaction can never point at an arbitrary object).
     | files: app/api/admin/signal/reaction-emoji/route.ts, lib/signal/reactions.ts
     | verified: yes (typecheck + build)
T830 | completed | Admin catalog UI /admin/signal/reactions + server actions.
     actions.ts (all requireAdmin -> service role): createReactionType/
     updateReactionType (return the persisted row so optimistic UI uses real ids),
     setReactionTypeActive, moveReactionType (display-order swap with tie-break,
     mirrors moveSource), deleteReactionType (ON DELETE RESTRICT backstop -> friendly
     "disable instead" message; cleans up the bucket object on delete/replace).
     reactions-manager.tsx: list (label, slug, kind, preview, position), role="switch"
     active toggle, keyboard up/down reorder with shared aria-live, add/edit form
     (label, slug, kind radio fieldset, char input OR image upload via the admin
     route), disable vs delete with inline confirm. page.tsx + the Reactions card on
     the /admin/signal index.
     | files: app/admin/signal/reactions/actions.ts, components/admin/reactions-manager.tsx,
       app/admin/signal/reactions/page.tsx, app/admin/signal/page.tsx
     | verified: yes (typecheck + build; /admin/signal/reactions 9.27 kB route)

### Signal - Phase 4f COMMIT 1 sub-agent review (completed)
Three reviews (implementation, accessibility, security) over the commit-1 diff.
- Implementation: NO blockers. Count trigger +/-1, on-conflict upsert, reorder
  tie-break, create/update-returns-row, validateReactionType mirror all verified.
- Security: NO blockers. The one real IMPORTANT (signal_reaction_counts public
  SELECT leaked engagement metadata for hidden/draft/private targets) FIXED by
  gating the counts SELECT on signal_target_publicly_viewable (migration 0075 +
  live DB). Tightened image_path regex to a strict UUID shape. Upload hardening,
  RLS posture, SECURITY DEFINER search_path pinning, FK RESTRICT/CASCADE strategy,
  no secret exposure, no XSS all verified sound.
- Accessibility: one BLOCKER fixed (form preview <img> had alt="" with no adjacent
  label -> alt="Reaction image preview"); IMPORTANT fixed (useId() so duplicated
  form field ids cannot mis-associate labels); MINOR fixed (focus moves to "Yes,
  delete" on confirm open and back to the Delete trigger on Keep; delete eligibility
  copy made accurate). Verified clean: role="switch"+aria-checked, fieldset/legend
  radios, labeled inputs, keyboard reorder, 44px action targets, decorative icons
  aria-hidden, no data hidden at any breakpoint, no em-dashes.
- Accepted / consistent-with-existing (not changed, to avoid diverging a single
  component from the already-reviewed sources-manager): the 28px switch hit area,
  the verbose switch aria-label, and the single-string aria-live region are the
  established admin pattern (components/admin/sources-manager.tsx). The suite-wide
  44px-switch and live-region-nonce questions belong to a deliberate suite pass, not
  a one-component divergence here.
- Advisor: get_advisors(security) flags signal_target_publicly_viewable as
  anon/authenticated EXECUTE-able SECURITY DEFINER. EXPECTED and required: the
  function is referenced inside RLS policies, so the querying roles MUST have
  EXECUTE. search_path is pinned; it returns only a boolean matching the public-read
  gating; same accepted posture as the pre-existing try_claim_league_refresh.

### Signal - Phase 4f COMMIT 2 (public reaction picker + counts) - completed
The final piece of Phase 4. No schema changes (tables shipped in COMMIT 1); pure
read layer + public server actions + UI. Phase 4 (Wall) is now COMPLETE.
T831 | completed | Reaction read layer on the public Wall loader. lib/signal-wall.ts
     loadReactionsForTargets(targets, viewerUserId): admin client; loads the full
     catalog (active drives the picker, disabled kept only to label historical
     counts), reads denormalized signal_reaction_counts (never tallies rows live),
     and the viewer's own signal_reactions for aria-pressed/toggle. Returns
     WallReactions { activeTypes, byTarget: Map<key, { counts, viewerReactionTypeIds }> };
     reactionTargetKey + EMPTY_REACTION_TARGET exported. Counts sorted by catalog
     display_order; only count>0 surfaced; disabled types labeled via the catalog.
     | files: lib/signal-wall.ts
     | verified: yes (typecheck + build; loader uses service role so it bypasses the
       counts visibility gate, only ever fed already-gated targets)
T832 | completed | Public reaction server actions. app/u/[handle]/reaction-actions.ts
     addReaction/removeReaction: session client + own-row RLS (insert sets user_id =
     the authenticated user, never the client; delete is user_id-scoped on top of
     RLS). Maps 23505 (unique) to a no-op success so the toggle is idempotent, 42501/
     row-level-security to friendly copy, everything else to a generic retry (no raw
     DB message leaks). No profile-cache bust (router.refresh() only, per the Wall
     dynamic decision).
     | files: app/u/[handle]/reaction-actions.ts
     | verified: yes (rolled-back DO block, 14 end-to-end checks all PASS: react
       active on public post/comment + count trigger +1, duplicate blocked by unique,
       inactive-type blocked, hidden-post blocked, anon reads public counts but 0
       reaction rows and 0 counts on a hidden target, cross-user SELECT of a public
       reaction, un-react own + count floored to 0, and un-react a now-disabled type
       you own still allowed so nobody is stuck. All probe rows rolled back)
T833 | completed | Reaction picker + counts UI wired into posts and comments.
     components/signal/reaction-bar.tsx: keyboard-operable role="toolbar" with roving
     tabindex (Arrow/Home/End), one toggle button per ACTIVE type, aria-pressed =
     viewer state, aria-label = catalog label, image reactions as <img alt=""> inside
     the labeled button (never image-only), polite aria-live "Reacted with X, N total"
     / "Removed X" + assertive error region. Disabled-but-counted types render as
     labeled read-only chips. Anon/view-only (hidden post/comment, owner preview) see
     counts read-only; anon gets a "Sign in to react" link. 44px toggle targets.
     Wired into wall.tsx (posts) and comment-section.tsx (comments); page.tsx loads
     reactions for every post + comment target and threads WallReactions through
     ProfileBody -> WallBlock.
     | files: components/signal/reaction-bar.tsx, components/signal/wall.tsx,
       components/signal/comment-section.tsx, app/u/[handle]/page.tsx
     | verified: yes (typecheck + build; /u/[handle] 7.92 kB)

### Signal - Phase 4f COMMIT 2 sub-agent review (completed)
Three reviews (implementation, accessibility, security) over the commit-2 diff.
- Implementation: NO blockers/important. Counts-from-denormalized-table, active-only
  picker, disabled-labeled chips, idempotent toggle, no cache bust, service-role
  loader fed only gated targets, schema untouched all verified. MINORs (disabled-type
  un-react not exposed in UI, optimistic announce number) accepted as by-design.
- Accessibility: one IMPORTANT FIXED - toolbar buttons used disabled={pending}, which
  drops focus mid-toggle and strands keyboard/SR users. Fixed by keeping buttons
  enabled (focus retained) and guarding double-fire with an `if (pending) return`
  in toggle() (the write is idempotent); swapped to aria-busy={pending}, added a
  Math.min clamp on the roving tab stop. Verified clean: toolbar roving tabindex,
  labeled buttons + image-inside-button alt, aria-pressed, live regions, anon
  sign-in path, read-only labeled chips, no data hidden at any breakpoint, no
  em-dashes. The assertive-wrapper + inner role="alert" double-announce is the KNOWN
  deferred suite-wide item (consistent with comment-section), not changed here.
- Security: NO blockers/important. Server-side re-auth (user_id never from client),
  own-scoped delete, parameterized queries, no error-detail leak, loader gate posture
  sound, no secret/XSS, CSRF covered by server-action posture. MINORs (no reaction
  rate limiting, no id-shape validation) accepted: the unique constraint bounds
  durable state and RLS is authoritative; a per-user reaction limiter is a future
  option if abuse appears.

### Signal - Accessibility cleanup (the two deferred suite-wide sweeps) - completed
Dedicated a11y session, no feature work. Both deferred carry-forwards from the
Phase 4 handoff are now done; the GIPHY production-key item remains the only
carry-forward.
T834 | completed | SWEEP 1: double-announce fix. The Signal surfaces wrapped errors
     in an aria-live="assertive" <div> that ALSO contained an inner <p role="alert">;
     role="alert" is an implicit assertive live region, so the nesting double-announced
     on NVDA. Fix applied identically to all four occurrences: keep the wrapper as the
     single live region, drop role="alert" from the inner paragraph (the error text
     and danger styling are unchanged). Separate polite role="status" success regions
     left untouched. Inventory was grep-driven so the fix is comprehensive.
     | files: components/signal/reaction-bar.tsx, components/signal/comment-section.tsx,
       components/signal/gif-picker.tsx, components/admin/report-queue.tsx
     | verified: yes (typecheck + build; a11y sub-agent confirmed one error live region
       per surface, polite regions not doubled)
T835 | completed | SWEEP 2: reconcile the two admin list managers to one shared a11y
     pattern. New components/admin/admin-controls.tsx exports AdminSwitch (role="switch"
     + aria-checked toggle whose CLICKABLE button is a 44x44 px hit target wrapping the
     same compact, now aria-hidden, visual pill; previously each manager had a 28px
     switch that was both visual and hit area) and useAdminAnnouncer (returns { announce,
     region }; region is two sr-only aria-live="polite" paragraphs and announce
     alternates which one carries the text so identical consecutive messages still
     re-announce, which a single fixed region would not). sources-manager.tsx and
     reactions-manager.tsx refactored to use both; aria-label wording, activation and
     "moved to position N of M" reorder announcements preserved. Removed dead local
     `refresh` in reactions-manager while there. Extracted shared primitives (rather
     than fixing inline) so future admin managers inherit the correct pattern instead
     of re-diverging; other admin managers (manual-signals-list, recompute-bar) can
     adopt them in a future pass, out of scope here.
     | files: components/admin/admin-controls.tsx (new),
       components/admin/sources-manager.tsx, components/admin/reactions-manager.tsx
     | verified: yes (typecheck + build green; a11y sub-agent review CLEAN, no
       blockers/important; quick impl + security pass confirmed no behavior/visual
       regression and no new security surface)

### Signal - Phase 5 (profile block builder: composable blocks + Layout A/B) - completed
The public profile becomes a composable, owner-arranged set of blocks driven by
the existing signals.layout_config jsonb + signals.layout column. MIGRATION-FREE
(both columns shipped in 0059; the owner-writable column grants already include
layout + layout_config, verified). Approved plan persisted at docs/phase5-plan.md
(committed first so a context reset cannot wipe it again). Block types: about
(renders the bio), text (own copy), links, favorites, board_top_n, league_card.
value_movers + recent_posts were cut. The Wall stays FIXED below the blocks in the
main column (not a block, not reorderable). Built 5.1 -> 5.6, one commit each,
typecheck + build green at every step, not pushed.
T836 | completed | 5.1 block data layer + graceful-degrade resolver
     | files: lib/signal/blocks.ts (new), lib/signal-profile.ts
     | detail: isomorphic SignalBlock model, coercion (shape + singleton uniqueness
       + id dedupe + MAX_BLOCKS cap), Layout A/B helpers, type-based column
       auto-placement (blockColumn), (de)serialization, seedBlocksFromProfile.
       resolveProfileBlocks resolves blocks against the cached bundle and DROPS any
       block whose referenced entity is gone or no longer public (board no longer
       profile_visible, league un-synced, empty bio/links/favorites), so missing
       references render nothing, never error, never leak. Seeds defaults only when
       never configured.
     | verified: yes (typecheck + build)
T837 | completed | 5.2 public render (Layout A feed + Layout B sidebar)
     | files: app/u/[handle]/page.tsx, components/signal/signal-block.tsx
     | detail: render bundle.blocks in order; refactored to one-per-entity blocks
       (AboutBlock renders bio replacing the inline bio, TextBlock headingless
       prose, FeaturedBoardBlock + FeaturedLeagueBlock single-entity, kept
       LinksBlock + FavoritesBlock). SignalBlock no longer owns width/padding (the
       page column does). Layout A single column + Wall at bottom. Layout B
       full-width header over a two-col grid, blocks auto-placed by type (boards +
       leagues main, about/text/links/favorites sidebar), Wall fixed at the bottom
       of main. DOM order = main then aside = visual order; columns stack on mobile,
       nothing hidden.
     | verified: yes (typecheck + build)
T838 | completed | 5.3 builder shell (add/remove/reorder + Layout A/B switch)
     | files: app/my-beacon/signal/layout-builder.tsx (new)
     | detail: single reorderable list, accessible move up/down (focus follows the
       moved block; shifts to the sibling button at an end so focus is never
       dropped), remove, Layout A/B fieldset radios, add-menu with about/links/
       favorites as singletons disabled with a spoken reason. Text block inline
       textarea + counter. Shared single re-announcing live region
       (useAdminAnnouncer); assertive role="alert" for save errors (no
       double-announce). Not mounted yet.
     | verified: yes (typecheck + build)
T839 | completed | 5.4 board + league pickers
     | files: app/my-beacon/signal/layout-builder.tsx
     | detail: accessible disclosure pickers in the add-menu. Board picker lists
       only profile_visible boards; league picker lists only featured synced
       leagues; picking adds a reference and NEVER mutates the entity (no implicit
       visibility flip). Each entity referenced by at most one block; placed
       entities drop out; trigger disables with a spoken reason when empty.
       fieldset/legend list of buttons (not an ARIA menu), opens focus on first
       item, Escape closes + returns focus to trigger, post-pick focus returns to
       trigger (or Save when the trigger disables).
     | verified: yes (typecheck + build)
T840 | completed | 5.5 persistence + mount
     | files: app/my-beacon/signal/actions.ts, app/my-beacon/signal/page.tsx
     | detail: saveLayout (session client + owner RLS) validates layout, coerces
       blocks, and filters board/league references to the owner's own featured
       entities (profile_visible boards + signal_league_ids leagues), then
       revalidateProfileCaches. Mounted LayoutBuilder under a new Profile layout
       section; the page loads the picker option lists and seeds the builder's
       initial state from current data when never configured, so the builder
       mirrors exactly what the public resolver renders.
     | verified: yes (typecheck + build)
T841 | completed | 5.6 review (a11y primary) + fixes + docs
     | files: lib/signal/blocks.ts, lib/signal-profile.ts, app/my-beacon/signal/page.tsx,
       app/my-beacon/signal/layout-builder.tsx, progress.md, handoff.md
     | review: inline review (accessibility primary, plus implementation +
       security). Accessibility PASS: public single h1 + h2 blocks + aside landmark
       only in Layout B, DOM order = visual order, nothing hidden at any breakpoint;
       builder fully keyboard/NVDA-operable (fieldset radios, labeled move/remove,
       focus management, disclosure pickers with Escape + focus return, single
       re-announcing live region, 44px targets, AA ink-muted). Security PASS:
       owner-RLS writes (layout + layout_config in the 0059 owner-writable grants,
       verified), untrusted input coerced + references filtered to the owner's own
       entities (no IDOR/leak), plain-text render (no XSS), generic error copy.
       Implementation PASS after one fix.
     | fix: an intentionally-empty saved layout was indistinguishable from
       never-configured and would wrongly re-seed defaults on the public page.
       Added hasStoredBlocks (a stored layout always carries a blocks array) so the
       resolver + editor seed ONLY when never configured and respect an empty
       layout as empty.
     | verified: yes (typecheck + build green; migration-free, so no schema/RLS
       regen needed; signals RLS unchanged from prior phases)
T842 | completed | 5.6 dedicated three-sub-agent review pass (impl + a11y + security)
     | over the full Phase 5 diff (3b0a379..f91482b).
     | security: PASS, CLEAN. saveLayout session-gated + owner-scoped, input
       coerced, board/league refs filtered to the owner's own featured entities;
       no IDOR/cross-tenant leak reachable (resolver matches only the owner's own
       profile_visible boards + synced featured leagues, double-layered with the
       write-time filter); empty-vs-unset fix holds; plain-text render (no XSS);
       links https-gated 3 ways; no SSRF/redirect/injection/secret exposure.
     | accessibility: one IMPORTANT fixed - FavoritesBlock dt labels used
       text-ink-subtle (#6B6B7D ~3.4:1, fails AA); switched to text-ink-muted
       (~7.8:1). Everything else PASS: builder reorder focus management, singleton
       disabling with spoken reason, picker disclosure semantics + focus return,
       fieldset radios, single re-announcing live region + single assertive
       save-error region; Layout B single h1 + h2 blocks + labeled aside, DOM order
       = visual order, nothing hidden at any breakpoint, 44px targets, accent fills
       lock near-black text.
     | implementation: one IMPORTANT fixed - hasLinks SeedInput mismatch (resolver
       counted https-filtered links, the editor counted unfiltered), so a profile
       with only legacy non-https links would seed the builder differently from the
       public render; the editor now applies the same https filter. Everything else
       PASS: graceful degrade verified for all six block types (double-layered on
       boards/leagues), hasStoredBlocks seeding fix consistent on both paths, Layout
       A non-regression, coercion (singletons/id dedupe/cap/league-id regex),
       blockColumn auto-placement matches SidebarLayout.
     | minors accepted/noted (not blocking): visible save-success confirmation is
       polite-live-only; signal-danger error text is AA not AAA; Layout B reading
       order places the Wall before the sidebar About (matches the DOM=visual
       contract, flagged for a future product call); ProfileBundle raw-collections
       comment corrected.
     | files: components/signal/signal-block.tsx, app/my-beacon/signal/page.tsx,
       lib/signal-profile.ts
     | verified: yes (typecheck + build green after fixes). PHASE 5 FULLY REVIEWED
       + COMPLETE.

### Signal - Phase 6 (mobile sidebar drawer + Layout C "Spotlight") - completed

Two parts. Part 1 changes Layout B's mobile behavior: below the lg breakpoint
the secondary sidebar (about, text, links, favorites) collapses into an
accessible "Profile info" drawer behind a top-bar trigger instead of stacking
below the main column (an intentional change from the Phase 5 "nothing hidden"
stacking; Layout A is unchanged, it has no sidebar). Part 2 makes Layout C
("spotlight") render: a centered landing page reusing the same resolved
bundle.blocks as A/B (one presentational path).

T600 | completed | 6.1 mobile profile-info drawer (Layout B)
     | files: components/signal/sidebar-shell.tsx (new),
       app/u/[handle]/page.tsx
     | SidebarShell renders the sidebar blocks exactly once, switching the whole
       subtree on mount + breakpoint state (matchMedia max-width:1023px, matching
       the lg grid split) rather than CSS, so the hard-coded block ids
       (signal-favorites-heading, ...) never appear twice in the DOM. Progressive
       enhancement: SSR / first client render / no-JS renders the inline
       two-column tree (sidebar stacks, nothing lost without JS); JS collapses it
       into the drawer on mount. Drawer reuses the mobile-menu focus model:
       portal to document.body, role=dialog + aria-modal, Tab focus trap, Escape,
       body scroll lock (save/restore prevOverflow), focus return. Slide is
       motion-safe only.
     | depends on: Phase 5
     | verified: yes (typecheck + build green)

T601 | completed | 6.2 Spotlight (Layout C) render layer
     | files: lib/signal/blocks.ts, components/signal/beacon-card.tsx (new),
       components/signal/wall-disclosure.tsx (new), app/u/[handle]/page.tsx
     | ProfileLayout union gains "spotlight" (isProfileLayout / resolveLayout
       accept it; the signals.layout CHECK already permitted it, so
       MIGRATION-FREE, no types regen). SpotlightLayout: centered hero
       (avatar/name/headline centered), the about block as a centered editorial
       lede (excluded from cards, no double render), every other block in owner
       order inside a luminous BeaconCard, a wrapping StatsStrip from
       already-loaded bundle data (no new query), and the Wall behind a labeled
       disclosure. Reuses existing block components, caches (loadBoardTopN), and
       graceful degrade. DOM order = visual order (single column). Beacon glow is
       FULLY STATIC (accent box-shadow + aria-hidden hairline, no keyframes), so
       reduced motion has nothing to disable and contrast is unaffected.
       WallDisclosure is SSR-expanded and collapses on mount via the hidden
       attribute: collapsed it leaves the tab order + a11y tree (keyboard user
       skips past without expanding); expanded its controls sit in natural,
       untrapped tab order; aria-expanded/controls correct, region id always in
       the DOM, no hydration mismatch. Mounted only when posts > 0.
     | depends on: T600
     | verified: yes (typecheck + build green)

T602 | completed | 6.3 expose Layout C in the builder
     | files: lib/signal/blocks.ts, app/my-beacon/signal/layout-builder.tsx
     | Added spotlight to PROFILE_LAYOUTS so the builder offers a third radio
       ("Layout C (spotlight)"), updated the helper copy to describe all three
       layouts (incl. the mobile Profile info panel for B), and a spoken
       confirmation via the existing single re-announcing live region
       (LAYOUT_ANNOUNCE map). saveLayout already validates via isProfileLayout.
     | depends on: T601
     | verified: yes (typecheck + build green)

T603 | completed | 6.4 three sub-agent reviews + fixes + ship
     | reviews: accessibility (primary), implementation, security over the full
       Phase 6 diff (4a23567..555b21a).
     | security: PASS, CLEAN at every severity. Presentational diff reusing the
       existing gated bundle + owner-only saveLayout write path. BeaconCard inline
       style hex comes only from accentInkColor -> fixed palette (unknown slug
       falls back to default), no attacker-controlled CSS; lede/stats are
       React-escaped text from the gated bundle; no dangerouslySetInnerHTML, no
       new network/secret/redirect/SSRF; client effects all clean up listeners +
       body style. DB CHECK confirmed allows 'spotlight' (migration-free claim
       verified).
     | accessibility (primary): no blockers. Two IMPORTANT fixed in
       sidebar-shell.tsx - (1) aria-controls on the trigger was a dangling IDREF
       while the portal dialog is closed, now conditional on open; (2) focus
       return on a resize-to-desktop-while-open could target a detached node, now
       guarded with isConnected. One MINOR fixed - the trigger aria-label clobbered
       the visible "Bio, links, and more" hint, removed so the visible text is the
       accessible name. Confirmed: focus trap both directions, Escape, scroll lock,
       no duplicate ids, single h1, h2 hierarchy (no double Wall heading), static
       glow, hidden-attribute Wall disclosure skip-past/natural-order, 44px
       targets, contrast (no white-on-accent), fieldset radios + single announcer.
     | implementation: no blockers. Same aria-controls IMPORTANT (fixed) + a dead
       triggerRef (removed). Confirmed: RSC pattern (async server blocks passed as
       children/props into client SidebarShell/WallDisclosure + server BeaconCard),
       breakpoint matches the grid, no-sidebar fallback preserves prior B, about
       extracted once, WallDisclosure gated on posts>0 (agrees with WallBlock's
       null-on-zero), stats from bundle w/ no new query, all PROFILE_LAYOUTS
       consumers consistent, no em-dashes / AI-tell punctuation, Layout A + desktop
       B non-regression.
     | files: components/signal/sidebar-shell.tsx
     | verified: yes (typecheck + build green after fixes). PHASE 6 FULLY REVIEWED
       + COMPLETE.

### Signal - Phase 7 (root /{handle} alias) - in progress
Adds ffbeacon.com/{handle} as the public-facing URL for a Signal so a profile
reads as a standalone website. Profiles live today at /u/{handle}; this phase
makes root /{handle} canonical, 301s /u/{handle} -> /{handle}, and keeps /u
forever as a 301 shim. Pure routing/URL layer: the public render, RLS gating,
layouts, and Wall are untouched. Resolution is a root dynamic segment
app/[handle], NOT a middleware rewrite: Next.js route precedence (literal
segments beat the dynamic segment) means a handle can never shadow a real route
at runtime. Built in three staged commits.

T604 | completed | Stage A: reservation seed + single-source collision guard
     | files: supabase/migrations/0076_signal_reserve_route_segments.sql,
       lib/signal/reserved-routes.ts, scripts/check-reserved-routes.ts,
       package.json
     | detail: 0076 seeds the 5 remaining top-level route segments (players,
       guides, join, auth, actions) into signal_reserved_handles; the 0059 seed
       already covered the rest. lib/signal/reserved-routes.ts is the ONE source
       of truth for route segments (RESERVED_ROUTE_SEGMENTS, 17 entries) +
       isReservedRouteSegment for the runtime resolver. scripts/check-reserved-
       routes.ts is the build-time collision guard wired into prebuild (so
       `npm run build` fails on drift): leg 1 (always) asserts every top-level
       app/ folder is in the constant; leg 2 (when Supabase creds present)
       asserts every constant entry is seeded in signal_reserved_handles. Data-
       only migration, so database.types.ts unchanged.
     | depends on: Phase 0 (signal_reserved_handles), Phase 6
     | verified: yes (guard reports 17 folders covered + seeded; typecheck +
       build green; build triggers the prebuild guard)

T605 | completed | Stage B: shared render extracted + root /{handle} routes
     | files: components/signal/profile-view.tsx (new),
       components/signal/board-view.tsx (new), app/u/[handle]/page.tsx,
       app/u/[handle]/rankings/[boardId]/page.tsx, app/[handle]/page.tsx (new),
       app/[handle]/rankings/[boardId]/page.tsx (new)
     | detail: the profile and board renders moved verbatim into
       components/signal/{profile-view,board-view}.tsx, each exporting a
       buildXMetadata(handle, {canonicalBase}) + an async <XView> server
       component. canonicalBase parameterizes ONLY the canonical URL + the
       casing/handle-history 301 targets. /u/[handle] and /u/[handle]/rankings/
       [boardId] are now thin wrappers (canonicalBase "/u", still canonical).
       New root app/[handle] + app/[handle]/rankings/[boardId] delegate to the
       same renders (also canonicalBase "/u" in Stage B, so root SERVES but /u
       stays canonical). Root routes add two in-process guards before any load:
       validateHandleFormat (non-handle paths incl. dotted/file-like 404) and
       isReservedRouteSegment (defense in depth). Resolution is a root dynamic
       segment, NOT middleware: middleware untouched.
     | depends on: T604
     | verified: yes (typecheck + build green; prebuild guard ran; runtime
       smoke test on `next start`:
         - literal routes WITH a page (/about,/rankings,/tools,/guides,/join,
           /privacy,/terms,/login,/my-beacon,/admin) serve their REAL content,
           never the handle route -> no working route shadowed;
         - /players and /leagues have only dynamic children (no index page), so
           they fall through to [handle]; both names are reserved so the route
           returns a noindex not-found, never a profile (this is why the guard
           must reserve EVERY top-level folder);
         - OAuth /?code= still 307s to /auth/callback;
         - root /{handle} renders byte-identical to /u/{handle} except the
           per-route page chunk filename; not-found sets robots noindex,nofollow
           on both.
     | known characteristic (pre-existing, flagged for review): nonexistent
       handles + the /players,/leagues fall-throughs render the not-found UI with
       HTTP 200 (soft 404), the same force-dynamic behavior /u/[handle] and
       /leagues/[league_id] already have. noindex is applied, so no index leak.

T606 | completed | Stage C: flip canonical to root + 301 (308) /u shims
     | files: app/[handle]/page.tsx, app/[handle]/rankings/[boardId]/page.tsx,
       next.config.ts, app/sitemap.ts, components/signal/signal-block.tsx,
       components/signal/comment-section.tsx, app/my-beacon/signal/page.tsx,
       app/my-beacon/signal/publish-controls.tsx,
       app/my-beacon/signal/handle-manager.tsx; removed app/u/[handle]/page.tsx
       + app/u/[handle]/rankings/[boardId]/page.tsx (action files kept)
     | HARD GATE (ran first): SELECT from signals where handle in the 17 route
       segments returned 0 rows, so no existing profile is shadowed by the flip.
     | detail: root routes now pass canonicalBase "" (root is canonical: the
       canonical <link>, casing 301, and handle-history 301 anchor at root). The
       /u -> root permanent redirect is done in next.config.ts redirects() (runs
       before routing, emits a real 308) rather than a page shim, because a
       streamed page component's permanentRedirect emits a soft 200 + meta-
       refresh, which would undermine the canonical signal. The two /u page
       files were deleted (the config redirect supersedes them); the Wall server-
       action files in app/u/[handle]/ stay (imported by components). Internal
       links flipped to root: FeaturedBoardBlock "view full board", comment
       author handle, sitemap profile URLs, the editor publicUrl (now derived via
       new URL(publicUrl).pathname), and the handle-manager confirmation copy.
     | depends on: T605
     | verified: yes (typecheck + build green; runtime smoke on `next start`:
         - /u/{handle} -> 308 -> /{handle}; /u/{handle}/rankings/{boardId} ->
           308 -> /{handle}/rankings/{boardId} (real HTTP 308, Location correct);
         - root /{handle} canonical metadata anchors at root; nonexistent root
           handle is robots noindex,nofollow;
         - /about,/rankings,/players,/leagues,/tools all 200;
         - OAuth /?code= still 307 -> /auth/callback.
     | known characteristic (parity, pre-existing): the in-page casing + handle-
       history redirects at root keep Phase 1's soft (200 + meta-refresh) behavior
       because they fire mid-stream in a force-dynamic page; the canonical <link>
       still points at the correct root URL, so SEO is preserved. Only the new
       /u migration uses a hard 308 (config). Using permanent:true (308, method-
       preserving) matches the existing /tools/league-sync redirect convention; it
       is SEO-equivalent to 301.

T607 | completed | Phase 7 three sub-agent reviews (security primary + impl + a11y)
     | over the full Phase 7 diff (2c0d2e6..df86b16). Spawned as agents, not
       reviewed inline.
     | security: PASS, no blockers/important. Verified route-collision defense
       (router precedence + format gate + reserved set + build guard + seed
       migration), RLS gating preserved verbatim in the extracted views, no open
       redirect (all targets are canonicalBase "" + DB-validated handle/board id),
       0076 data-only, catch-all input safely format-gated (dotted/encoded/over-
       length -> notFound), no secret/XSS/CSRF/IDOR, guard script dev/build-only.
     | implementation: PASS. Byte-identical relocation confirmed (diffed against
       2c0d2e6 originals), canonicalBase path-building correct (no double slash),
       guard folder-filter + 17-segment constant + prebuild wiring correct, 0076
       applied + all 17 seeded, next.config single-segment redirects correct, dead
       code only the kept action files.
     | accessibility: one IMPORTANT (now fixed). Otherwise PASS: render a11y
       structure byte-identical (single h1, landmarks, status banner, sr-only
       stats, tier sections), no new interactive elements, no data hidden at any
       breakpoint, no AI-tell punctuation in Phase 7 additions.
     | fixes applied (review-fixes commit):
       - app/my-beacon/signal/handle-manager.tsx:109 stale handle-input hint still
         read "{SITE.url}/u/your-handle" (a static string my /u/ grep missed); a
         screen-reader user claiming a handle heard the legacy address. Flipped to
         "{SITE.url}/your-handle" so the announced/visible public address matches
         the new canonical root URL. (Flagged IMPORTANT by a11y, MINOR by impl.)
       - next.config.ts:14 pre-existing em-dash in a Phase-7-touched file (rule 6);
         rewritten with a comma.
     | verified: yes (typecheck + build green after fixes; prebuild guard ran;
       git grep "/u/" clean except action-file imports + redirect source patterns)
     | PHASE 7 FULLY REVIEWED + COMPLETE. Root /{handle} is canonical; /u 308s
       forever; no route can collide with a handle (build-guarded).

### Signal - Phase 8 (following) - COMPLETE
Wires UI to the EXISTING follow data layer from Phase 0 (no migration): the
signal_follows graph (PK (follower, followee), self-follow CHECK, RLS anon-none /
authed-select-all / insert+delete-own / service-all) and the denormalized
signals.follower_count maintained by the signal_follows_sync_count AFTER trigger
(migration 0063). The For You feed stays DEFERRED (not built). Confirmed clean git
status + the data layer before building.

T608 | completed | Follow read layer + server actions
     | files: lib/signal-follow.ts (new), app/u/[handle]/follow-actions.ts (new)
     | detail: loadFollowState(profileUserId, viewerUserId) reads follower_count
       FRESH (denormalized counter, not from the cached bundle) + the viewer's own
       follow row, via the admin client fed the session-resolved viewer id (mirrors
       loadReactionsForTargets). follow-actions: followProfile/unfollowProfile use
       the session client + own-row RLS (follower_user_id ALWAYS = auth.uid(), never
       client-supplied); 23505 (dup) -> idempotent no-op success, 23514 (self-follow
       CHECK) + 23503 (FK) + 42501 (RLS) -> friendly copy; needsAuth when logged out;
       light best-effort in-memory throttle (12 / 10s per user, consistent with the
       GIF route; durable state is bounded by the PK regardless). loadFollowList
       (authed-only; needsAuth otherwise) returns only LIVE public profiles (private/
       draft handles never exposed via the graph), capped at 100, recency-ordered.
       NO profile-cache bust (a stranger's follow must not bust the owner bundle).
     | depends on: Phase 0 (0063 signal_follows + counter trigger)
     | verified: yes (typecheck + build green)
T609 | completed | Follow control + list modal UI + profile wiring
     | files: components/signal/follow-control.tsx (new),
       components/signal/follow-list-modal.tsx (new),
       components/signal/profile-view.tsx (header + ProfileBody props + both viewer
       paths thread loadFollowState)
     | detail: FollowControl renders the public count always (button -> list dialog
       for authed viewers, plain text for anon); Follow/Unfollow toggle only for a
       signed-in non-owner (aria-pressed, visible label IS the accessible name, no
       aria-label override -> Label-in-Name safe); anon non-owner gets a "Sign in to
       follow" link (never a broken button); owner sees count + list, no follow
       button (self-follow has no UI path). Derives display from props + router
       .refresh() after a write (no local optimistic-state footgun; no cache bust),
       matching reaction-bar. Single polite success region + single assertive error
       region (no nested role=alert, post-sweep pattern). 44px targets. FollowList
       Modal reuses the mobile-menu focus model (portal, role=dialog aria-modal, Tab
       trap both directions, Escape, body scroll lock, focus return guarded on
       isConnected); two aria-pressed tabs (Followers/Following) fetch via
       loadFollowList on open/tab-change with a request-sequence guard against slow
       responses; polite live region announces the loaded count; entries link to
       /{handle}.
     | depends on: T608
     | verified: yes (typecheck + build green; /[handle] 10.6 kB)
T610 | completed | RLS + trigger verification (anon/auth follow read/write)
     | detail: against real users (owner 5d99293a "mjwalsh" count 0, other dbdeffcf):
       trigger INCREMENT 0->1 on insert; DECREMENT 1->0 on delete; self-follow blocked
       (CHECK 23514) even for the owner; follow-on-behalf-of blocked (RLS 42501, acting
       as one user with follower_user_id = someone else); legit own follow ALLOWED
       under RLS with_check; anon SELECT on signal_follows returns 0 rows even with a
       row present (list is authenticated-only). DB left clean (0 rows, count 0).
     | depends on: T608
     | verified: yes

## Next milestone
- News pipeline (RSS ingestion -> news_items, AI summary via Claude)
- Vote matchups (/vs/[a]-vs-[b]) live
- Weekly content cron (waivers, start-sit, sleepers)
- IndexNow + sitemap generation
- AdSense readiness sweep
- Phase 12 follow-ups: real commissioner detection, edge runtime for OG,
  Geist woff2 fetch in OG cards, toast-style refresh feedback
