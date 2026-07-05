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
T611 | completed | Phase 8 three sub-agent reviews (security primary + impl + a11y)
     | over the full Phase 8 diff (f1e16cf..72c4184). Spawned as agents, not
       reviewed inline. All three PASS, zero blockers/important.
     | security: PASS. follower_user_id always = auth.uid() (never client), own-row
       RLS backstop, delete pinned to caller; self-follow blocked (CHECK) + no UI
       path; error codes mapped to friendly copy (no raw leak); loadFollowList
       session-gated before the admin read + live-only filter (no private/draft
       handle leak); count read off the denormalized column; NO cache bust; no
       XSS/secret/open-redirect/SSRF. One MINOR: distinct-user follow-bombing is
       only soft-throttled (accepted; durable per-user cap belongs with the For You
       feed, which is deferred).
     | implementation: PASS. Fresh count read, idempotent toggle, scoped unfollow,
       request-sequence guard, live-only list w/ preserved order, props-derived
       display + router.refresh (reaction-bar parity), both viewer paths wired,
       database.types.ts unchanged. One MINOR (optimistic announcement count) +
       2 NITs.
     | accessibility: PASS. aria-pressed label-in-name toggle, aria-busy over
       disabled, single polite + single assertive region (no nested role=alert),
       anon sign-in link, owner has no follow button, count exposed to all, full
       focus-trap dialog (focus return guarded on isConnected), decorative avatars,
       no competing heading, AAA/AA contrast, 44px targets, no data hidden at any
       breakpoint, no AI-tell punctuation. One MINOR + 2 NITs.
     | fixes applied (this commit):
       - follow-control.tsx: the success announcement no longer includes an
         optimistic "+1" count (could overstate by one on a stale re-follow or a
         concurrent follow); it now announces the action only ("Following X." /
         "Unfollowed X."), and the authoritative count stays on the count button
         after router.refresh(). Flagged MINOR by both impl and a11y.
       - follow-list-modal.tsx: modal tab buttons bumped h-10 -> h-11 for full 44px
         tap-target consistency with the close button and list rows (a11y NIT).
     | accepted / not fixed (documented): the soft follow throttle (revisit with a
       durable cap when the For You feed ships); the "Showing 1 following" wording
       (grammatically fine, by design).
     | verified: yes (typecheck + build green after fixes; prebuild guard ran)
     | PHASE 8 FULLY REVIEWED + COMPLETE.

### SIGNAL BUILD COMPLETE (Phases 0-8)
The Signal creator-profile feature is complete end to end: schema/RLS/moderation
(0), handles + identity + image hardening + public Layout A (1), featured boards +
leagues + caching + OG + sitemap (2), customization: accent/links/favorites (3),
the full Wall: text + images + comments + GIFs + emoji + reactions + moderation
(4), the profile block builder + Layout A/B (5), mobile sidebar drawer + Layout C
Spotlight (6), root /{handle} canonical URLs (7), and following (8). The For You
feed remains intentionally DEFERRED (the follow graph that would power it is live;
only the feed UI is out of scope).

## Next milestone
- News pipeline (RSS ingestion -> news_items, AI summary via Claude)
- Vote matchups (/vs/[a]-vs-[b]) live
- Weekly content cron (waivers, start-sit, sleepers)
- IndexNow + sitemap generation
- AdSense readiness sweep
- Phase 12 follow-ups: real commissioner detection, edge runtime for OG,
  Geist woff2 fetch in OG cards, toast-style refresh feedback

---

## Phase 13 - The Beacon Brief (News Curation)
Scope: ONLY the Beacon Brief section of plan.md. Source-agnostic news curation
(X first) -> Anthropic score/categorize/tag -> create article when context_score=1
-> post original content to Discord via "Beacon Relay" webhook. Two crons
(curation every 5 min, worker every 1 min) + beacon_brief_queue. Migrations begin
at 0081 (latest pre-existing was 0080). Task IDs continue from T842.

### Migrations + types (one each, RLS in same migration, types regen after each)
T843 | completed | Migration 0081 discord_webhooks (table ONLY, no seed; secret URL inserted via MCP later). RLS service-role-only.
     | files: supabase/migrations/0081_discord_webhooks.sql, lib/database.types.ts
     | verified: yes (MCP apply ok; pg_policies shows rls_enabled=true + discord_webhooks_service_role_all; no anon/authed policy; types regen contains discord_webhooks)
T844 | completed | Migration 0082 news_sources (admin_label, source_type default 'x' CHECK, handle, external_account_id, last_cursor, last_polled_at, last_poll_status/error, metadata; unique(source_type,handle)). RLS service-role-only.
     | files: supabase/migrations/0082_news_sources.sql, lib/database.types.ts
     | verified: yes (MCP apply ok; pg_policies shows rls_enabled=true + news_sources_service_role_all only; types contain news_sources)
T845 | completed | Migration 0083 news_categories (slug unique, name, description, discord_role_ids[], display_order, is_active). RLS service-role-only (public read deferred with public reader).
     | files: supabase/migrations/0083_news_categories.sql, lib/database.types.ts
     | verified: yes (MCP apply ok; pg_policies rls_enabled=true + service_role_all only; types contain news_categories)
T846 | completed | Migration 0084 teams (+seed 32 NFL; abbreviation unique matches Sleeper players.team, conference/division CHECK, discord_role_ids[]). Public SELECT + service-role write.
     | files: supabase/migrations/0084_teams.sql, lib/database.types.ts
     | verified: yes (MCP apply ok; rls_enabled=true; teams_select_public anon+authed read + teams_service_role_all; team_count=32, conferences=2; types contain teams)
T847 | completed | Migration 0085 article_teams join (article_id+team_id PK, cascade FKs, mirrors article_players). Public SELECT + service-role write.
     | files: supabase/migrations/0085_article_teams.sql, lib/database.types.ts
     | verified: yes (MCP apply ok; rls_enabled=true; article_teams_select_public + service_role_all; types contain article_teams)
T848 | completed | Migration 0086 news_ingestions (UUID PK identity; UNIQUE(source_id, source_external_id) dedup net; media/quoted/retweeted jsonb; is_revision + self-FK; ai_result; context_score; status CHECK incl 'deleted'; article_id/discord_webhook_id/discord_message_id; metadata raw; source_id FK cascade). RLS service-role-only.
     | files: supabase/migrations/0086_news_ingestions.sql, lib/database.types.ts
     | verified: yes (MCP apply ok; rls_enabled=true; only service_role policy; unique_constraints=1; types contain news_ingestions)
T849 | completed | Migration 0087 beacon_brief_queue (job_type CHECK, payload, status CHECK, attempts, run_after, last_error; partial claim index where status='pending' ordered run_after). RLS service-role-only.
     | files: supabase/migrations/0087_beacon_brief_queue.sql, lib/database.types.ts
     | verified: yes (MCP apply ok; rls_enabled=true; service_role_all only; 3 indexes incl partial claim idx; types contain beacon_brief_queue)
T850 | completed | Migration 0088 beacon_brief_moderation (ingestion_id cascade FK, article_id set-null FK, type 'deletion', status pending/approved/rejected, detail jsonb, resolved_by). RLS service-role-only.
     | files: supabase/migrations/0088_beacon_brief_moderation.sql, lib/database.types.ts
     | verified: yes (MCP apply ok; rls_enabled=true; service_role_all only; types contain beacon_brief_moderation)
T851 | completed | Migration 0089 article_revisions (article_id cascade FK, unique(article_id, revision_number), title/content_md/tags/category_id snapshot, change_summary, source_ingestion_id). RLS service-role-only.
     | files: supabase/migrations/0089_article_revisions.sql, lib/database.types.ts
     | verified: yes (MCP apply ok; rls_enabled=true; service_role_all only; types contain article_revisions)
T852 | completed | Migration 0090 beacon_brief_logs (ingestion_id/source_id set-null FKs, stage CHECK 10 stages, level CHECK, message, request_payload/response_payload jsonb, model, token_usage, duration_ms; 4 indexes). RLS service-role-only.
     | files: supabase/migrations/0090_beacon_brief_logs.sql, lib/database.types.ts
     | verified: yes (MCP apply ok; rls_enabled=true; service_role_all only; types contain beacon_brief_logs)
T853 | completed | Migration 0091 articles extension (add metadata jsonb default {}, tags text[] default {}, category_id FK->news_categories set-null, origin text default 'manual' CHECK in (manual,beacon_brief); idx on category_id + origin). article_type kept. RLS unchanged from 0005.
     | files: supabase/migrations/0091_articles_beacon_brief_extension.sql, lib/database.types.ts
     | verified: yes (MCP apply ok; information_schema confirms metadata/tags/category_id/origin present; types regen)
T854 | completed | Migration 0092 beacon_settings bb_* rows (category 'beacon_brief'): bb_enabled, bb_discord_enabled, bb_web_search_enabled, bb_autopublish, bb_context_threshold, bb_followup_lookback_days, bb_queue_max_attempts, bb_discord_jobs_per_run, bb_model_article (sonnet-4-6), bb_model_triage (haiku-4-5), bb_webhook_id, + 6 editable prompts. Plain-ASCII prompts.
     | files: supabase/migrations/0092_beacon_brief_settings.sql, lib/database.types.ts
     | verified: yes (MCP apply ok; 17 bb_ rows = 4 toggles + 6 prompts + 4 numbers + 3 strings; npm run typecheck PASS)
     | NOTE: ALL 12 MIGRATIONS (0081-0092) COMPLETE. typecheck green.

### Post-migration manual step
T855 | completed | Inserted "News & Injuries" discord_webhooks row via MCP execute_sql (URL kept out of version control; not in any migration). Wired bb_webhook_id to webhook id 2de0121c-e0b0-475e-8446-ca7031550dfc. Idempotent insert (guarded by label).
     | files: none committed (data-only via MCP; secret URL not stored in repo)
     | verified: yes (bb_webhook_id = 2de0121c...; 1 active webhook row)

### Libs
T856 | completed | lib/beacon-brief/types.ts (BeaconBriefSourceItem contract + CategorizeResult, ArticleResult, RevisionRewriteResult, QueueJobType/Payload)
     | files: lib/beacon-brief/types.ts
     | verified: yes (typecheck deferred to end of libs batch)
T857 | completed | lib/x.ts (X v2 client; safeFetch mirror of lib/sleeper.ts; bearer auth; getXUserByUsername, getXUserTweets since_id+expansions, getXTweetsByIds for deletion check). null-on-failure.
     | files: lib/x.ts
     | verified: typecheck deferred to end of libs batch
T858 | completed | lib/discord.ts (postWebhookMessage ?wait=true returns msg id + patchWebhookMessage; Beacon Relay username + logo avatar on create; allowed_mentions parse:[] roles-only; DiscordResult carries status + retryAfterMs for 429 backoff).
     | files: lib/discord.ts
     | verified: typecheck deferred to end of libs batch
T859 | completed | lib/beacon-brief/ai.ts (logBeaconBrief shared logger; runStructuredCall strict-JSON via output_config.format; runWebSearchResearch web_search_20260209 free-text; both log exact request/response/model/usage; null on failure) + lib/beacon-brief/settings.ts (loadBeaconBriefSettings, BEACON_BRIEF_DEFAULTS).
     | files: lib/beacon-brief/ai.ts, lib/beacon-brief/settings.ts
     | verified: typecheck deferred to end of libs batch (note: confirm web_search_20260209 tool literal accepted by @anthropic-ai/sdk 0.104.1)
T860 | completed | lib/beacon-brief/ingest-x.ts (normalizeTimeline maps X v2 -> BeaconBriefSourceItem incl media/quoted/retweeted + native-edit chain; fetchSourceItems resolves account id, pulls since cursor, returns items+newestId+ok). Dedupe + AI follow-up detection happen in curate.
     | files: lib/beacon-brief/ingest-x.ts
     | verified: typecheck deferred to end of libs batch
T861 | completed | lib/beacon-brief/curate.ts (runCuration: per active source fetch+dedupe; native-edit + AI follow-up revision detection; inline categorize/context-score; resolveRefs maps names->category/player/team ids + role ids; routes by context_score and revision-critical -> enqueues discord_post/discord_patch/article_write; advances cursor + last_poll status; NO inline Discord/article writing). Team token sanitized for PostgREST or().
     | files: lib/beacon-brief/curate.ts
     | verified: typecheck deferred to end of libs batch
T862 | completed | lib/beacon-brief/worker.ts (runWorker: claims via bb_claim_jobs RPC FOR UPDATE SKIP LOCKED, discord jobs capped at settings.discordJobsPerRun + others separate; handlers for discord_post/discord_patch[+retract]/article_write[create 2-step web-search research+structuring | rewrite]/deletion_check; unique slug +5char; autopublish gate; links article_players/article_teams; snapshots article_revisions; schedules deletion_check; shadow-mode skip; failOrRetry backoff + email at max attempts). REQUIRED migration 0093_bb_claim_jobs (service_role-only SKIP LOCKED claim fn) applied + types regen.
     | files: lib/beacon-brief/worker.ts, supabase/migrations/0093_bb_claim_jobs.sql, lib/database.types.ts
     | verified: yes (npm run typecheck PASS; bb_claim_jobs in types; prettier-formatted)
T863 | completed | lib/beacon-brief/deletion.ts (handleDeletionCheck: re-verify source post via getXTweetsByIds, open pending moderation if gone, re-enqueue within 7d horizon; approveDeletion: archive article + status 'deleted' + enqueue discord_patch retract + close moderation; rejectDeletion: close as rejected. Nothing auto-deleted).
     | files: lib/beacon-brief/deletion.ts (worker imports handleDeletionCheck; admin Moderation action will use approve/reject)
     | verified: yes (typecheck PASS)

### Crons + CLI
T864 | completed | app/api/cron/beacon-brief/route.ts (nodejs, force-dynamic, maxDuration 300; Bearer CRON_SECRET; recordCronRun "beacon-brief-curate" -> runCuration). Matches sync-ktc pattern.
     | files: app/api/cron/beacon-brief/route.ts | verified: typecheck PASS
T865 | completed | app/api/cron/beacon-brief-worker/route.ts (same auth; recordCronRun "beacon-brief-worker" -> runWorker).
     | files: app/api/cron/beacon-brief-worker/route.ts | verified: typecheck PASS
T866 | completed | Added beacon-brief-curate + beacon-brief-worker to CronJobName union + CRON_JOBS registry (lib/cron-runs.ts); added both crons to vercel.json (curation */5 * * * *, worker * * * * *).
     | files: lib/cron-runs.ts, vercel.json | verified: typecheck PASS
T867 | completed | scripts/beacon-brief.ts (tsx; getServiceClient; runs curation then worker, or curate|worker arg) + npm run beacon-brief. SMOKE TEST PASSED at runtime (0 sources/0 jobs no-op; confirms tsx @/ alias resolution + bb_claim_jobs RPC + settings load + DB connectivity).
     | files: scripts/beacon-brief.ts, package.json | verified: yes (ran npm run beacon-brief; clean no-op output)

### Email
T868 | completed | lib/beacon-brief/email.ts sendBeaconBriefFailureEmail (reuses lib/email/layout buildBrandedEmail + lib/email/send; to michael@ffbeacon.com via BEACON_BRIEF_ALERT_TO; describes job type/id/attempts/error + button to /admin/beacon-brief/logs). Built early since worker depends on it.
     | files: lib/beacon-brief/email.ts
     | verified: yes (typecheck PASS)

### Admin UI (requireAdmin, colocated actions.ts, ActionResult/fail, screen-reader-first)
T869 | completed | admin-nav: added "The Beacon Brief" (/admin/beacon-brief) + "System Settings" (/admin/system) NAV_ITEMS; fixed active-check to path-boundary match so /admin/beacon no longer matches /admin/beacon-brief. lib/beacon-brief-admin-nav.ts (6 subpages) + components/admin/beacon-brief-subnav.tsx + beacon-brief-page-shell.tsx.
     | files: components/admin-nav.tsx, lib/beacon-brief-admin-nav.ts, components/admin/beacon-brief-subnav.tsx, components/admin/beacon-brief-page-shell.tsx
     | verified: typecheck PASS
T870 | completed | System Settings webhooks: app/admin/system/page.tsx (redirect -> /webhooks), app/admin/system/webhooks/page.tsx (masks URL to last-6 hint, never ships secret to client), app/admin/system/actions.ts (create/update[url optional=keep]/toggle/delete, https discord URL validation, created_by), components/admin/beacon-brief/webhooks-manager.tsx (add/edit/toggle/delete, aria-live, 44px, confirm on delete).
     | files: app/admin/system/page.tsx, app/admin/system/webhooks/page.tsx, app/admin/system/actions.ts, components/admin/beacon-brief/webhooks-manager.tsx
     | verified: typecheck PASS. SECURITY: webhook URL never sent to client (hint only).
T-actions | completed | app/admin/beacon-brief/actions.ts (sources/categories/articles assignments+content/moderation approve+reject via deletion lib). requireAdmin + ActionResult/fail + service-role + revalidatePath.
     | files: app/admin/beacon-brief/actions.ts | verified: typecheck PASS
T871 | completed | app/admin/beacon-brief/page.tsx Overview (stat cards: active sources, published articles, queue pending/failed, pending moderation; last curate+worker cron runs; recent 15 logs). 
     | files: app/admin/beacon-brief/page.tsx | verified: typecheck PASS
T871 | pending | /admin/beacon-brief (Overview)
T872 | completed | /admin/beacon-brief/sources/page.tsx + components/admin/beacon-brief/sources-manager.tsx (add/edit/toggle/delete; shows last_poll_status + last_polled_at + error per source; source_type select defaults X).
     | files: app/admin/beacon-brief/sources/page.tsx, components/admin/beacon-brief/sources-manager.tsx | verified: typecheck PASS
T873 | completed | /admin/beacon-brief/categories/page.tsx + components/admin/beacon-brief/categories-manager.tsx (add/edit/toggle/delete; discord_role_ids as comma list; display_order; shows slug).
     | files: app/admin/beacon-brief/categories/page.tsx, components/admin/beacon-brief/categories-manager.tsx | verified: typecheck PASS
T874 | completed | /admin/beacon-brief/articles/page.tsx + articles-manager.tsx (filters: status, category, player/team text -> article ids; per-article expandable editor: content via updateArticleContent + assignments via updateArticleAssignments; teams as 32 checkboxes; players via searchPlayers add/remove; revision history via getArticleDetail). Added searchPlayers + getArticleDetail read actions.
     | files: app/admin/beacon-brief/articles/page.tsx, components/admin/beacon-brief/articles-manager.tsx, app/admin/beacon-brief/actions.ts | verified: build PASS
T875 | completed | /admin/beacon-brief/moderation/page.tsx + moderation-manager.tsx (pending deletion reviews; approve -> approveModeration / reject -> rejectModeration; confirm on approve).
     | files: app/admin/beacon-brief/moderation/page.tsx, components/admin/beacon-brief/moderation-manager.tsx | verified: build PASS
T876 | completed | /admin/beacon-brief/logs/page.tsx (data-heavy; GET-form filters stage+level; native <details> disclosure for request/response payloads = keyboard accessible; per-entry cards (no data hidden on mobile); link to Settings for prompt editing).
     | files: app/admin/beacon-brief/logs/page.tsx | verified: build PASS
T877 | completed | /admin/beacon-brief/settings/page.tsx (reuses SettingField + updateBeaconSetting for bb_* in fixed order; bb_webhook_id via custom WebhookSelectField populated from discord_webhooks).
     | files: app/admin/beacon-brief/settings/page.tsx, components/admin/beacon-brief/webhook-select-field.tsx | verified: build PASS
     | NOTE: ALL CODING COMPLETE. npm run typecheck + npm run build PASS. Smoke test (npm run beacon-brief) green.

### Final review (Beacon-Brief-scoped only)
T878 | completed | 4 independent read-only sub-agents ran (implementation, security, performance, accessibility), each scoped to Beacon Brief only. NO Blockers from any. Implementation: matches plan (2 minor deviations: no "Run now" UI [CLI only]; Logs filters stage+level not source+ingestion). Security: strong, no Blocker/Important (minor: .or() blocklist sanitize, non-constant-time cron compare; nit: webhook host regex narrow). Performance: 2 Important (curation serial inline AI per item, no per-run item budget + cursor advances only at source-end; missing pg_trgm index on players.full_name/teams.name + per-name N+1 in resolveRefs), minor (logs loads full jsonb x100; heavy-bucket hardcoded 25). Accessibility: 4 Important (h4 heading skip in articles editor; moderation no link to view article; player search results not aria-live announced; dead source-type select), minors (checkbox group labels, x button 44px, errors not assertive).
     | verified: reviews complete; findings surfaced to owner for fix decisions (no silent auto-fix of major items).

## Phase 13b - Review-driven fixes + curation safeguards (owner-approved)
T879 | completed | Curation safeguard (one coherent change): migration 0094 adds bb_backfill_count(0), bb_max_items_per_run(50), bb_max_post_age_minutes(180), bb_article_jobs_per_run(5) + sets bb_enabled=false (system stays OFF). curate.ts: cold-start (uninitialized = null cursor -> watch from now, process only backfillCount newest; 0 = nothing); per-run shared item budget; incremental per-item cursor advance (persist after each item, reconcile at end); age cutoff (stale posts ingested as dropped_no_context, never routed). settings.ts + Settings page ORDER updated. unique(source_id, source_external_id) still backstops.
     | files: supabase/migrations/0094_*, lib/beacon-brief/curate.ts, lib/beacon-brief/settings.ts, app/admin/beacon-brief/settings/page.tsx | verified: typecheck + build PASS
T880 | completed | Performance: migration 0095 pg_trgm + GIN indexes on players.full_name & teams.name; resolveRefs batched (teams loaded once + matched in JS, players single ilike-any query); worker heavy bucket now uses bb_article_jobs_per_run.
     | files: supabase/migrations/0095_*, lib/beacon-brief/curate.ts, lib/beacon-brief/worker.ts | verified: build PASS
T881 | completed | Security minors: constant-time CRON_SECRET compare (timingSafeEqual) in both cron routes; widened webhook host regex (discord.com/ptb/canary/discordapp.com).
     | files: app/api/cron/beacon-brief/route.ts, app/api/cron/beacon-brief-worker/route.ts, app/admin/system/actions.ts | verified: build PASS
T882 | completed | Accessibility: articles editor h4->h3 (heading skip); moderation now shows article slug + "Open in Articles to review" link before destructive approve; player search results wrapped in aria-live polite + "No players found" empty state; sources source-type select disabled (no longer a dead control).
     | files: components/admin/beacon-brief/{articles-manager,moderation-manager,sources-manager}.tsx | verified: build PASS
     | DEFERRED (lower-priority, noted to owner): Logs jsonb lazy-load (perf minor 4); a11y minors (player remove "x" 44px hit area, team/player checkbox group fieldset/legend, assertive role=alert for error statuses), Discord inter-send pacing (perf minor 6).
T883 | completed | Re-review (3 independent agents, Phase-13b-scoped). NO Blockers. Impl: all 8 safeguard reqs MET, cursor logic verified (no skips/reprocess), system OFF confirmed. Perf: prior (a)(b)(c) resolved; 1 Important (batched player OR substring over-match + limit truncation) -> FIXED (limit scales with token count; substring accepted since prompt returns full names + admin-editable). A11y: 3 fixes verified correct, no regressions. typecheck PASS.
     | files: lib/beacon-brief/curate.ts | verified: typecheck PASS
     | ACCEPTED / DEFERRED (surfaced to owner): cold-start backfill capped at 20 by X page size (doc note); worker has no wall-clock deadline / no stale-'processing' reaper (minor); redundant last_cursor in final source UPDATE (nit); failed item advances cursor past itself (won't retry that item - nit); logs jsonb lazy-load; a11y minors (x button 44px, checkbox group fieldset/legend, assertive error roles); Discord inter-send pacing; h1->h3 (could be h2).

## Phase 13c - Deferred minor fixes (owner-approved this session)
T884 | completed | Curate cursor fixes: (1) failed item no longer advances the cursor past itself - on a processItem throw the source stops for the run (logs a warn) so the next poll re-fetches from the last success and retries the failed item (unique constraint dedupes already-ingested ones); (2) removed the redundant final last_cursor write - the per-item incremental advance already persists it, so the end-of-source UPDATE only writes poll status, and sets last_cursor solely in the cold-start-with-nothing-to-process case (advance to newestId / watch forward).
     | files: lib/beacon-brief/curate.ts | depends on: T879 | verified: typecheck + build PASS
T885 | completed | Articles editor a11y minors: (1) player remove "x" button is now a 44x44 tap target (h-11 w-11 flex-centered; chip min-h-[44px]) with a focus-visible ring; (2) Teams + Players control groups are now <fieldset>/<legend> so each is announced as a labeled group (Tailwind preflight zeroes the default fieldset border/padding); (3) action status uses two live regions - success announces politely (role=status), failures announce assertively (role=alert / aria-live=assertive); (4) Revision history heading h3 -> h2 (it follows the page h1 directly, no skipped level).
     | files: components/admin/beacon-brief/articles-manager.tsx | verified: typecheck + build PASS
T886 | completed | Logs page jsonb lazy-load: the list query no longer selects request_payload/response_payload (a 100-row page could otherwise ship up to 200 large blobs). It now selects metadata only plus two existence-only probes (select id where payload is not null, constrained to the page ids) to know which disclosures to render. New client component LogPayloads fetches the actual jsonb once, on first expand, via a new getBeaconBriefLogPayload(id) server action (admin-guarded). aria-busy/aria-live on the loading pre.
     | files: app/admin/beacon-brief/logs/page.tsx, components/admin/beacon-brief/log-payloads.tsx, app/admin/beacon-brief/actions.ts | verified: typecheck + build PASS
T887 | completed | Worker reliability + Discord pacing (one coherent change): migration 0096 adds bb_worker_max_runtime_ms(50000), bb_stale_processing_minutes(10), bb_discord_pace_ms(1000) - data rows only, no schema change, no type regen. worker.ts: (1) stale-processing reaper at run start reclaims jobs left in processing past the window (worker crash/timeout) via the existing failOrRetry path (attempts++, retry-or-fail+email) so a poison job cannot loop; (2) soft wall-clock deadline stops processing when the runtime budget is hit and releases claimed-but-unreached jobs back to pending (run_after=now) so the next run grabs them immediately; (3) Discord inter-send pacing (delay between consecutive discord sends, never past the deadline) so a burst stays under the webhook limit. discord jobs are ordered first so pacing covers the contiguous batch. settings.ts (interface/defaults/loader) + Settings page ORDER updated. WorkerSummary gains reaped/released counts. System stays OFF (bb_enabled=false verified).
     | files: supabase/migrations/0096_*, lib/beacon-brief/worker.ts, lib/beacon-brief/settings.ts, app/admin/beacon-brief/settings/page.tsx | depends on: T862 | verified: typecheck + build PASS; migration 0096 applied + rows confirmed; bb_enabled still false
T888 | completed | Review (a11y + perf sub-agents, scoped to ONLY the T884-T887 changes). NO Blockers. Fixed the 2 a11y Important + 1 perf Important + 1 nit: (a) log-payloads <pre> now tabIndex=0 + aria-label so keyboard users can scroll tall JSON; (b) dropped the misleading aria-live on that <pre> (kept aria-busy; native <details> conveys state); (c) added an error state to LogPayloads so a failed fetch no longer shows "Loading..." forever; (d) worker failOrRetry now guards every transition with status='processing' (+ stale cutoff for the reaper path) and reports "lost" when a concurrent run already handled the job, closing the reap-vs-reclaim double-attempt/double-email race; reaper select bounded with order+limit(200). typecheck + build PASS.
     | files: components/admin/beacon-brief/log-payloads.tsx, lib/beacon-brief/worker.ts | verified: typecheck + build PASS
     | ACCEPTED / DOCUMENTED (reviewers rated acceptable, not fixed): poison item that throws every run permanently stalls its source (cursor never advances past it) - bounded because processItem swallows most soft failures (only an uncaught DB/network error throws); a future per-item attempt cap on news_ingestions would quarantine it. Also left as-is: two id-only existence probes on the logs page (one extra round trip, bounded to 100 ids); per-item cursor UPDATE fires on pure dedupes (N small no-op writes per run).

## Phase 13d - Confident reference matching + match moderation (owner-approved this session)
GOAL: never auto-link a guessed player/team. Only auto-link an exact, unambiguous match; everything non-confident opens a moderation row (with ranked candidate suggestions) and emails a per-run digest for manual resolution.
T889 | completed | Migration 0097: extend beacon_brief_moderation for reference-match review. type CHECK now allows 'deletion','player_match','team_match' (type encodes the ref kind, no separate ref_kind col); added raw_name text + candidates jsonb (default '[]') columns; added idx_beacon_brief_moderation_type_status. article_id already nullable FK (set once the worker writes the article). RLS unchanged (service_role-only). Types regenerated.
     | files: supabase/migrations/0097_beacon_brief_reference_moderation.sql, lib/database.types.ts | verified: migration applied; constraint name confirmed before alter; types regen + prettier
T890 | completed | Migration 0098: bb_player_match_candidates(p_name, p_limit, p_threshold) RPC. plpgsql/stable; uses set_config('pg_trgm.similarity_threshold', local) + the % operator (GIN trigram index from 0095) so it is index-assisted; ranks by similarity desc, active-first on ties; returns id, full_name, status, team, pos, sim. Output col 'pos' (not 'position', which is reserved in RETURNS TABLE). service_role execute only (revoked from public/anon/authenticated). Smoke-tested with 'Josh Allen' (exact at sim 1.0 + near-misses). Types regenerated.
     | files: supabase/migrations/0098_bb_player_match_candidates.sql, lib/database.types.ts | verified: migration applied; RPC smoke test PASS; types regen
T891 | completed | Migration 0099: settings rows bb_match_similarity_threshold(0.3) + bb_match_candidate_limit(8) (data rows, no schema change/no type regen). These only affect the moderation candidate SUGGESTION list; auto-linking always requires an exact normalized match, never fuzzy.
     | files: supabase/migrations/0099_beacon_brief_match_settings.sql | verified: migration applied; rows inserted
T892 | completed | lib/beacon-brief/match.ts: the confident reference matcher. normalizeName (lowercase, strip punctuation, collapse whitespace, drop trailing generational suffix jr/sr/ii-v). Category: exact active slug. Teams: exact normalized abbreviation OR name only (no substring); else moderation with dice-bigram-ranked team suggestions. Players: exactly ONE current (active/ir) player whose normalized full_name == normalized AI name -> auto-link; multiple current exacts -> disambiguate by a referenced team (one match -> link, else moderation); no current exact -> never auto-link, moderation with top trigram candidates (via bb_player_match_candidates RPC). Returns confident ids + roleIds + pending[] for review. settings.ts gains matchSimilarityThreshold/matchCandidateLimit; types.ts gains MatchCandidate/PendingReferenceMatch/ReferenceMatchResult; Settings page ORDER updated.
     | files: lib/beacon-brief/match.ts, lib/beacon-brief/types.ts, lib/beacon-brief/settings.ts, app/admin/beacon-brief/settings/page.tsx | depends on: T890, T891 | verified: typecheck PASS
T893 | completed | curate.ts rewired: replaced the old substring resolveRefs with matchReferences. Stores ai_result.resolved (same shape the worker reads) + ai_result.pending (audit). When an article is created, openMatchModeration inserts one beacon_brief_moderation row per non-confident ref (type player_match/team_match, raw_name, candidates jsonb, article_id null) and collects them; one batched digest email per run via sendBeaconBriefMatchDigestEmail. Confident refs still auto-link unchanged.
     | files: lib/beacon-brief/curate.ts | depends on: T889, T892, T895 | verified: typecheck PASS
T894 | completed | worker.ts: after creating a Beacon Brief article, backfill article_id onto this ingestion's pending player_match/team_match moderation rows (where article_id is null) so one-click resolution can write the join. Confident joins unchanged.
     | files: lib/beacon-brief/worker.ts | depends on: T889 | verified: typecheck PASS
T895 | completed | lib/beacon-brief/email.ts: sendBeaconBriefMatchDigestEmail - ONE batched digest per run (not per name) to BEACON_BRIEF_ALERT_TO (michael@ffbeacon.com) listing each unmatched ref (kind + raw name + candidate count, capped at 25 shown + overflow note) with a button to the Moderation page. Reuses the existing branded email shell + Resend sender (no-ops if RESEND unset).
     | files: lib/beacon-brief/email.ts | verified: typecheck PASS
T896 | completed | Resolution lib + actions. lib/beacon-brief/match-resolution.ts: resolveReferenceMatch (validate pending + correct type + article_id present + chosen id exists; upsert article_players/article_teams ignoreDuplicates; close row approved with resolved_ref_id in detail) and dismissReferenceMatch (close row rejected, no link); both guard status='pending'. actions.ts: resolveMatch(moderationId, chosenId) + dismissMatch(moderationId) server actions (requireAdmin -> userId, wrap lib, revalidate). Reuses existing searchPlayers for the player picker; teams loaded server-side on the page.
     | files: lib/beacon-brief/match-resolution.ts, app/admin/beacon-brief/actions.ts | depends on: T889 | verified: typecheck + build PASS
T897 | completed | Moderation UI for reference matches. moderation-manager.tsx now renders a discriminated union (deletion vs player_match/team_match). MatchResolver shows the raw name, article context + readiness note, ranked candidate buttons (one-click Link), a player search (reuses searchPlayers, aria-live results + empty state) for player rows or a labeled team <select> for team rows, and a Dismiss button. Shared dual status regions (polite success + assertive role=alert errors). All controls >=44px; fieldset/legend on the suggestions group. moderation/page.tsx fetches the union (type, raw_name, candidates, article_id, articles join) + all teams and maps to the typed items.
     | files: components/admin/beacon-brief/moderation-manager.tsx, app/admin/beacon-brief/moderation/page.tsx | depends on: T896 | verified: typecheck + build PASS; bb_enabled still false; moderation columns confirmed
T898 | completed | Review (impl + perf + a11y sub-agents, scoped to ONLY the T889-T897 change). NO Blockers. Fixed all 3 Important + 3 cheap Minors: (1 perf) migration 0100 adds an exact case-insensitive tie-break to bb_player_match_candidates ORDER BY so a true exact match is never crowded out of the top-N by a common surname (verified: 'Josh Allen' returns exact first at sim 1.0); (2 a11y) player-search result "Link X" buttons now use btnClass (real 44x44 target, not a bare underline) + aria-busy on the results region while searching; (3 impl) worker failOrRetry now closes (rejects) an ingestion's pending null-article player_match/team_match moderation rows when its article_write job is marked failed, so they never strand unresolvable; (minor) dedupeNames keys on normalizeName ("Mahomes"/"Mahomes II" collapse); (minor) moderation page pending query bounded with .limit(500). Verified article_players/article_teams have composite PKs backing the resolution upsert onConflict (impl Important #4 - no change needed). typecheck + build PASS; bb_enabled still false.
     | files: supabase/migrations/0100_bb_player_match_candidates_exact_first.sql, lib/beacon-brief/worker.ts, lib/beacon-brief/match.ts, components/admin/beacon-brief/moderation-manager.tsx, app/admin/beacon-brief/moderation/page.tsx | verified: typecheck + build PASS; RPC tie-break smoke-tested
     | ACCEPTED / DOCUMENTED (reviewers rated Minor, not fixed): focus is not restored after an item resolves and disappears (announcement still fires; matches the existing articles-manager pattern - candidate for a future focused a11y pass); one sequential RPC round-trip per unique player name (index-assisted, fine at the 5-min cron cadence; batch later only if post volume grows).

## On The Clock (live Sleeper draft helper) - building from ON-THE-CLOCK-PLAN.md

CURRENT PHASE: Phase 1 (Supabase cache foundation). Phase 0 done.
RESUME RULE: do not start Phase 2 until owner approves. Update progress.md +
handoff.md after EVERY task. Do not commit/push.

### Phase 0 - Safety audit + setup (completed)
OTC-T000 | completed | Read ON-THE-CLOCK-PLAN.md in full (1042 lines). No blockers,
     no security contradiction, no plan/codebase conflict found. Plan is internally
     consistent and maps onto existing patterns (FAAB settings, try_claim_* lock,
     MCP type-regen). Safe to proceed.
OTC-T001 | completed | Real next migration number determined = 0106.
     | evidence: highest migration file on disk is 0105_faab_calculator_settings.sql,
       and mcp list_migrations confirms it applied (version 20260626204055, last in
       ledger). Duplicate FILE-NUMBER prefixes exist (0028, 0029, 0100, 0101, 0102,
       0103 each appear twice) but the DB ledger keys on timestamp versions, so the
       collisions are cosmetic-on-disk only, NOT a DB conflict. 0106+ is free.
       On The Clock will use 0106..0113 (see plan task split below).
OTC-T002 | completed | FAAB settings pattern captured (template for on_the_clock_settings).
     | source: supabase/migrations/0105_faab_calculator_settings.sql + lib/faab/.
       Shape: `id text primary key default 'global' check (id = 'global')`, `settings
       jsonb not null`, created_at/updated_at timestamptz default now(), `updated_by
       uuid references auth.users(id) on delete set null`. RLS enabled, single policy
       `<t>_service_role_all for all to service_role using(true) with check(true)`,
       NO anon/auth policies. Defaults live in code; missing row degrades to code
       defaults. Access-matrix comment block at top of migration.
OTC-T003 | completed | Durable lock RPC pattern captured (template for the sync lock).
     | source: supabase/migrations/0026_try_claim_league_resync.sql (+0025 ledger).
       Shape: `create or replace function ... returns boolean language plpgsql
       security definer set search_path = public`; CTE upsert with a conditional
       ON CONFLICT ... DO UPDATE ... WHERE last_attempt_at < now() - make_interval(...)
       so only the window-winner updates; `select exists(select 1 from upsert)`.
       Then `revoke all on function ... from public; grant execute ... to
       authenticated, service_role;` + comment. The ledger table (0025) is
       service-role-only RLS, single service_role_all policy.
OTC-T004 | completed | Type-regen workflow confirmed.
     | MCP generate_typescript_types returns JSON-wrapped output; extract the `.types`
       field, write to lib/database.types.ts, then `npx prettier --write`. (Matches
       memory project_mcp_types_regen_workflow + the Beacon Brief handoff notes.)
OTC-T005 | completed | Realtime publication: no existing supabase_realtime migration in
     the repo (grep clean). Supabase provisions the publication by default, so the
     Realtime task uses `alter publication supabase_realtime add table
     public.on_the_clock_pick_cache;` (idempotent-guarded).
OTC-T006 | completed | progress.md + handoff.md updated for On The Clock (this section
     + a fresh handoff.md; prior Beacon Brief handoff state is fully captured in the
     T843-T898 entries above, so handoff.md is repurposed for the active feature).

### Phase 1 - Supabase cache foundation (migrations DONE, verified; types regen in progress)
All migrations applied via MCP apply_migration AND written to supabase/migrations/.
One atomic migration per file. Next free number was 0106.
- 0106 on_the_clock_settings (single-row JSONB, service-role-only) [DONE]
- 0107 on_the_clock_draft_cache (one row/draft + lock cols, public SELECT, 4 indexes) [DONE]
- 0108 on_the_clock_pick_cache (one row/pick, cascade from draft, public SELECT, player_id idx) [DONE]
- 0109 on_the_clock_lookup_attempts (durable lookup guard ledger, service-role) [DONE]
- 0110 sync-lock RPCs claim/complete/release (SECURITY DEFINER, returns-table claim) [DONE]
- 0111 try_claim_on_the_clock_lookup RPC (SECURITY DEFINER) [DONE]
- 0112 enable Realtime on on_the_clock_pick_cache (publication add + REPLICA IDENTITY FULL) [DONE]
- 0113 cleanup_on_the_clock_cache TTL function (deletion only, NOT cron-wired) [DONE]
- 0114 RPC EXECUTE hardening (revoke anon/authenticated; service_role only) [DONE]

OTC-T007 | completed | 0106 on_the_clock_settings applied + file written (FAAB pattern).
OTC-T008 | completed | 0107 on_the_clock_draft_cache applied + file written.
OTC-T009 | completed | 0108 on_the_clock_pick_cache applied + file written (FK cascade to draft, player_id uuid -> players.id).
OTC-T010 | completed | 0109 on_the_clock_lookup_attempts applied + file written.
OTC-T011 | completed | 0110 sync-lock RPCs applied + file written.
     | FIX during verification: claim_on_the_clock_sync hit "column reference last_synced_at
       is ambiguous" (RETURNS TABLE out-cols shadow table cols in the UPDATE WHERE).
       Fixed by aliasing the UPDATE target `as c` and qualifying c.last_synced_at /
       c.sync_locked_until. Re-applied via create-or-replace (preserves ACL); 0110 file updated.
OTC-T012 | completed | 0111 try_claim_on_the_clock_lookup applied + file written.
OTC-T013 | completed | 0112 Realtime publication for pick_cache applied + file written.
OTC-T014 | completed | 0113 cleanup_on_the_clock_cache applied + file written.
OTC-T015 | completed | 0114 RPC EXECUTE hardening applied + file written.
     | SECURITY FIX during verification: `revoke all ... from public` did NOT remove the
       anon/authenticated EXECUTE that Supabase grants by default privilege. Since these
       are SECURITY DEFINER, anon could have called cleanup (wipe cache) / claim (grief lock).
       0114 explicitly revokes EXECUTE from public, anon, authenticated on all 5 functions.
       Re-verified ACL = postgres + service_role only.

### Phase 1 verification (all PASS, via MCP execute_sql)
- RLS enabled on all 4 tables (relrowsecurity = true).
- Policies: draft_cache + pick_cache = select_public (anon, authenticated) + service_role_all;
  settings + lookup_attempts = service_role_all only. No anon/auth write policy anywhere.
- Function ACLs after 0114: claim/complete/release/try_claim_lookup/cleanup = postgres +
  service_role EXECUTE only (anon + authenticated removed).
- Realtime: on_the_clock_pick_cache is in the supabase_realtime publication; REPLICA IDENTITY FULL.
- Lock semantics (live RPC test, throwaway draft, cleaned up after):
  * claim #1 on fresh draft -> claimed=true, last_synced_at null, remaining 0, locked_by_other false.
  * claim #2 immediately -> claimed=false, locked_by_other=true (exactly one winner; concurrency safe).
  * complete(5,'drafting') -> advances last_synced_at; next claim -> claimed=false, remaining 27,
    locked_by_other false (30s cooldown enforced; advances only on success).
  * second draft: claim -> release -> claim -> claimed=true again (release clears lock WITHOUT
    advancing last_synced_at, so retry allowed before cooldown).
  * try_claim_on_the_clock_lookup: same key within window false, different key true.
  * cleanup_on_the_clock_cache(0,0) deleted 2 stale drafts AND cascaded the seeded pick (0 orphans).
- Anon role simulation (set local role anon):
  * SELECT: settings=0 (blocked), draft_cache=1 (visible, seeded), pick_cache=0, lookup_attempts=0 (blocked).
  * INSERT into draft_cache -> ERROR 42501 RLS violation (write blocked).
  * EXECUTE claim_on_the_clock_sync -> ERROR 42501 permission denied (hardening confirmed).
- All test/probe rows cleaned (drafts/settings/lookups all 0 after teardown).

OTC-T016 | completed | Regenerated lib/database.types.ts via MCP generate_typescript_types
     (delegated to a sub-agent to keep the large output out of context). 3835 lines,
      prettier-formatted. Confirmed present: on_the_clock_settings, on_the_clock_draft_cache,
      on_the_clock_pick_cache, on_the_clock_lookup_attempts (tables) + claim/complete/release_
      on_the_clock_sync, try_claim_on_the_clock_lookup, cleanup_on_the_clock_cache (functions).
     | verified: `npm run typecheck` clean after regen.

PHASE 1 COMPLETE. STOP POINT. Do NOT start Phase 2 (server utilities + settings layer)
until owner approves. No app/lib/UI code written yet. Value pipelines untouched.

### Phase 2 - Server utilities + settings layer (owner-approved; in progress)
Boundaries: NO API routes, NO /tools UI, NO /admin UI, NO value-pipeline changes.
OTC-T017 | completed | lib/on-the-clock/types.ts - settings types (nested groups) + shaped
     cache payload types (ShapedDraftCache/Pick/Roster/LeagueUser) + SyncStatus/SyncOutcome.
OTC-T018 | completed | lib/on-the-clock/default-settings.ts - DEFAULT_ON_THE_CLOCK_SETTINGS.
     | feature.enabled defaults FALSE (ships OFF, project convention). defaultFormatFallback
       reuses DEFAULT_FORMAT_SLUG ("redraft-ppr-std") from @/lib/site. cooldown 30s / lock 15s,
       cache 24h/168h, maxLeagues 10 / maxAvail 100, balanced weights 0.6/0.4/0.15, DST/K
       suppress_until_need with round gates 10/12, SF QB x1.25, TEP TE x1.15.
OTC-T019 | completed | lib/on-the-clock/settings.ts - zod schema (per-field .default), 
     validateOnTheClockSettings + loadOnTheClockSettings (reads on_the_clock_settings id='global',
     degrades to defaults on missing/invalid). Refinements: defaultPool in enabledPools,
     lockSeconds <= cooldownSeconds. FAAB pattern exactly.
OTC-T020 | completed | lib/on-the-clock/validation.ts - isValidUsername/Season/LeagueId/DraftId,
     normalizeUsername (lookup-key), sanitizeSleeperPlayerId + sanitizeSleeperPlayerIds (allowlist
     ^[A-Za-z0-9]{1,16}$, dedupe, drop "0"). Regexes match plan section 12.
OTC-T021 | completed | lib/sleeper.ts - added SleeperDraftPick type + getSleeperDraftPicks(draftId)
     (GET /draft/{id}/picks, safeFetch 20s, [] on failure). No other change to sleeper.ts.
OTC-T022 | completed | lib/players/sleeper-map.ts - mapSleeperToPlayerIds(client, ids): sanitize +
     dedupe, chunk by 200, partial-tolerant, never throws. Handles numeric + DST team-code ("BUF").
     DEVIATION (documented): used sanitized .or() not .in() - the sleeper id is at the json path
     external_ids->>'sleeper', which supabase-js .in() cannot express type-safely; sanitized .or()
     is the proven, injection-safe pattern already used in trade-analyzer.ts / league-view-data.ts.
OTC-T023 | completed | lib/on-the-clock/cache.ts - RPC wrappers (claimSync/completeSync/releaseSync/
     claimLookup, service-role client) + readDraftCache + shapeDraftCache (whitelist-only wire shaping
     of draft meta, users, rosters, picks). No Sleeper calls. FIX: complete RPC p_status is
     string|undefined (SQL default null), coerced null->undefined.
OTC-T024 | completed | lib/on-the-clock/sleeper-sync.ts - performDraftSync (server-only). Full flow:
     resolve league/season -> claim -> fetch draft/picks/users/rosters -> map ids ONCE -> upsert
     draft+pick cache -> complete; release + safe error on Sleeper failure; returns SyncOutcome with
     cached shape regardless of status. NOT wired to any route (Phase 3).
OTC-T025 | completed | Tests: lib/on-the-clock/validation.test.ts, settings.test.ts,
     lib/players/sleeper-map.test.ts. Cover: username/season/league/draft accept+reject; BUF allowed;
     hostile + "0" dropped; settings defaults parse + partial-merge + reject (lock>cooldown, bad pool,
     wrong type, bad enum); sleeper-map round-trip (numeric+BUF+kicker), unknown id absent (partial),
     hostile never in filter string, empty input issues no query, chunk error never throws.
OTC-T026 | completed | Checks: `npm run typecheck` clean; full `npm test` = 14 files / 108 tests pass
     (23 new + no regressions). lib/sleeper.ts change confirmed non-breaking.

PHASE 2 COMPLETE. STOP POINT. Do NOT start Phase 3 (API routes) until owner approves.
No API routes, no /tools UI, no /admin UI, no value-pipeline changes written.

### Phase 3 - API routes (owner-approved; complete)
Boundaries honored: NO /tools UI, NO /admin UI, NO recommendation UI, NO value-pipeline change.
All three routes use createAdminClient() server-side only (service role never reaches the
client), require the x-requested-with: ff-beacon header, validate input via
lib/on-the-clock/validation, gate on settings.feature.enabled (ships OFF -> 503), and set
Cache-Control: private, no-store.
OTC-T027 | completed | lib/sleeper.ts SleeperLeague extended with draft_id + avatar (top-level
     Sleeper league fields) so the leagues route reads draft_id without a per-league drafts call.
     lib/on-the-clock/types.ts gains the LeagueCard wire type (leagueId+draftId+season+name+
     totalRosters+avatar+draftStatus).
OTC-T028 | completed | app/api/on-the-clock/leagues/route.ts (GET ?username=&season=).
     Header guard -> input validation (username/season regex) -> settings.enabled gate ->
     durable claimLookup guard (IP + normalized username, 10s window, FAIL CLOSED on error) ->
     getSleeperUser (404 if unknown) -> getSleeperLeagues. Active-draft filter uses ONLY the
     league objects (status in {drafting,pre_draft} AND draft_id present), drafting-first,
     capped at settings.limits.maxActiveLeagues with a truncated flag. private/no-store +
     Referrer-Policy: no-referrer. DEVIATION (documented): no per-league getSleeperLeagueDrafts
     fan-out - the league object's own status + draft_id is a reliable zero-extra-call signal,
     which satisfies "do not over-hit Sleeper". One getSleeperUser + one getSleeperLeagues per lookup.
OTC-T029 | completed | app/api/on-the-clock/draft/route.ts (GET ?draft_id=). READ-ONLY.
     Header guard -> draft_id validation -> enabled gate -> readDraftCache (NO Sleeper on warm
     path). Cold cache only: one warm performDraftSync through the lock, then return. 404 if a
     cold draft cannot be warmed. private/no-store.
OTC-T030 | completed | app/api/on-the-clock/draft/sync/route.ts (POST {draft_id, league_id?,
     season?}). Header guard -> JSON parse (400 on malformed) -> draft_id required + optional
     league_id/season validated -> enabled gate -> performDraftSync. Returns 200 with the
     SyncStatus union (synced|cooldown|synced-by-other|served-cache|error) + cache + cooldown
     seconds + lastSyncedAt; ok=false on error status; 500 only on an unexpected throw. Passing
     league_id+season lets the claim happen with no pre-fetch.
OTC-T031 | completed | Route tests (vitest, vi.mock): leagues.route.test.ts (8),
     draft/sync/route.test.ts (9), draft/route.test.ts (6). Cover: header-missing 403, bad-input
     400, feature-disabled 503, lookup-guard 429, unknown-user 404, card shaping/filter/sort/
     truncation, sync status passthrough (synced/cooldown/synced-by-other/error), malformed JSON
     400, and the KEY assertions that the rejected paths NEVER call Sleeper/performDraftSync and
     that a WARM draft read does NOT trigger a sync (no Sleeper on the read path).
     | vitest.config.ts include extended to app/**/*.test.ts so route tests are discovered.
     | NOTE: route tests mock @/lib/on-the-clock/sleeper-sync because its real module imports
       "server-only" (throws when imported directly in a node test).
OTC-T032 | completed | Checks: `npm run typecheck` clean; full `npm test` = 17 files / 131 tests
     pass (23 new route tests, no regressions); `npm run build` green (prebuild reserved-route
     guard passed; .next emitted leagues + draft + draft/sync route.js).

PHASE 3 COMPLETE. STOP POINT. Do NOT start Phase 4 (mocked UI shell) until owner approves.
No UI, no admin, no value-pipeline change. Live-draft behavior NOT yet tested against a real
active draft (requires a live Sleeper draft; deferred to the live-wiring phase).

### Phase 4 - Mocked UI shell (owner-approved; complete)
Boundaries honored: FIXTURES ONLY (no Sleeper/Supabase from UI), NO live wiring, NO admin pages,
NO recommendation engine (placeholders), NO value-pipeline change. All files under
app/tools/on-the-clock/. Brand: dark + purple/cyan beacon gradient, Geist, matches League Pulse /
Signal Check design language.
OTC-T033 | completed | fixtures.ts - mock data mirroring Phase 2/3 shaped types (LeagueCard[],
     ShapedDraftCache snake 8-team/5-round/11-picks, RankedPlayer[] incl DST/K + rookies,
     RecommendationCardData placeholders, connected user, sync status). NOTHING calls Sleeper/Supabase.
OTC-T034 | completed | states.tsx - shared LoadingCard (role=status), ErrorCard (role=alert),
     EmptyCard (dashed) blocks. No color-only state.
OTC-T035 | completed | username-gate.tsx - League-Pulse-style username+season form; MOCK onConnect
     (no network). 44px button, focus rings, described-by help.
OTC-T036 | completed | league-picker.tsx - active-draft league cards (Open draft) + empty state +
     Refresh; status pills carry text ("Drafting now"/"Not started").
OTC-T037 | completed | sync-button.tsx - Sync Draft button + cooldown countdown (mock 30s) +
     polite aria-live status line (the polite sync live-region stub).
OTC-T038 | completed | command-header.tsx - sticky Draft Command Header: status/format/source chips,
     pool toggle (aria-pressed), teams/rounds/picks (mobile disclosure via aria-expanded, never
     hidden outright), last-pick line, embedded SyncButton, and the ASSERTIVE "your turn" live-region
     stub (role=alert, sr-only, empty unless your turn).
OTC-T039 | completed | recommendation-cards.tsx - Best Available + Team Need placeholder cards;
     aligned -> single "Value and need align" card; chips carry text; PlayerHeadshot (fallback-safe).
OTC-T040 | completed | available-list.tsx - semantic <table> (caption, scope, aria-sort on sortable
     columns, sort buttons in <th>), search, position filter chips (aria-pressed), Show more
     pagination (NOT virtualized), polite live region announcing visible count + sort state.
OTC-T041 | completed | draft-board.tsx - native <table>, STABLE seat columns (<th scope=col>), rounds
     rows (<th scope=row>), serpentine pick numbers in cell text + aria-label; "On the clock"/"Your
     pick"/"Last pick"/"Open slot" all TEXT (no color-only); horizontal scroll keeps all seats on mobile.
OTC-T042 | completed | pick-list.tsx - chronological picks as a semantic table (a11y peer of the board);
     unmapped picks render from cached name fields with a "(not in our database)" note.
OTC-T043 | completed | my-draft.tsx - connected user's picks + roster-shape position counts; empty state.
OTC-T044 | completed | on-the-clock-client.tsx - client root state machine (connect -> pick-league ->
     room) + APG tabs view switcher (Recommend/Available/Board/Picks/Mine) with roving tabindex +
     ArrowLeft/Right/Home/End + aria-controls/aria-selected; pool gating filters Available to rookies.
OTC-T045 | completed | page.tsx - server shell (force-dynamic), hero (one h1, gradient, bullets),
     Phase-4 preview notice, renders OnTheClockClient with currentNflSeason(). No Sleeper/Supabase.
OTC-T046 | completed | Registered the tool: lib/site.ts (TOOLS_NAV + FOOTER_COLUMNS) and
     app/tools/page.tsx (TOOLS array + href union + Timer icon).
OTC-T047 | completed | Accessibility basics verified by construction + build: APG tabs (keyboard),
     focus-visible outlines everywhere, semantic tables (caption/scope/aria-sort), no color-only
     states (text markers), polite + assertive live-region stubs, aria-pressed toggles, 44px targets
     (min-h-11), one h1/page, mobile disclosure keeps all data. NOTE: full interactive screen-reader /
     axe audit is deferred to Phase 8 (not claimed done here).
OTC-T048 | completed | Checks: `npm run typecheck` clean; `npm run build` green (/tools/on-the-clock
     10.5 kB compiled, all 3 api routes intact); full `npm test` = 17 files / 131 tests pass (no
     regressions from the site.ts / tools page edits). `next lint` is NOT configured in this repo
     (prompts interactive setup), so lint was skipped per "lint only if appropriate".

PHASE 4 COMPLETE. STOP POINT. Do NOT start Phase 5 (live data wiring) until owner approves.
UI runs entirely on fixtures; no live Sleeper/Supabase wiring; no live-draft behavior claimed.

### Phase 4.5 - Premium draft-cockpit visual/UX refinement (owner-requested; in progress)
Goal: make On The Clock feel like a premium draft HQ / command center, not a generic tabbed tool
page. NO live wiring, NO API/DB/engine changes, accessibility preserved. Fixtures only.
OTC-T049 | completed | fixtures.ts - added MOCK-ONLY spotlight fields to RankedPlayer
     (yearsExperience, age, recentFinishes[], shortNote) + an ENRICH map keyed by name; spread into
     the board build. Structured so Phase 5/6 hides any missing section (never blocks the feature).
OTC-T050 | completed | panel.tsx - cockpit Panel primitive (bordered surface, top beacon hairline,
     structured header eyebrow+heading+helper+action, optional glow, real h2/h3/h4) + StatReadout
     (big accent-number metric). The dashboard's visual backbone.
OTC-T051 | completed | player-spotlight.tsx - premium broadcast-style featured recommendation
     (PlayerSpotlight: big headshot, big name, exp/age line, bold accent value/posrank/tier readouts,
     reason + shortNote, "Last positional finishes" accent-number strip hidden when absent) +
     SecondaryPick (compact). Variants best (Pure Value) / need (Roster Need) / aligned. No color-only.
OTC-T052 | completed | step-rail.tsx - onboarding stepper (1 Connect -> 2 Choose -> 3 Sync ->
     4 Draft) as <ol> with aria-current="step" + sr-only state word per step (not color-only).
OTC-T053 | completed | dashboard-panels.tsx - DraftRoomStatus (status/on-the-clock/last-pick +
     teams/rounds/picks StatReadouts) + BestRemainingByPosition (top value per position at a glance).
OTC-T054 | completed | sync-button.tsx - polished: transient "Syncing..." state with reduced-motion-
     safe spin, clearer cooldown copy, polite aria-live status. (Sync lives in the command bar.)
OTC-T055 | completed | command-header.tsx - reworked into a premium CONTROL BAR: sticky, beacon
     hairline, identity + status + your seat, a prominent broadcast-style "on the clock" banner
     (reduced-motion-safe pulse), format/source chips, pool toggle (aria-pressed), embedded Sync.
     Keeps the assertive "your turn" live region. Counts moved to the Room status rail panel.
OTC-T056 | completed | on-the-clock-client.tsx - reworked from tab-first into a DASHBOARD: sticky
     command bar; setup steps now use StepRail + guidance; room is a room-container with a Draft
     Signal hero (dominant spotlight + secondary, or one aligned spotlight), a wide main column
     (Big board / Draft board / All picks as cockpit Panels), and a sticky right rail (Room status /
     Best remaining / Your draft). A section jump-nav replaces primary tabs (no section hidden).
     Removed the old APG tabs + the now-unused recommendation-cards.tsx (deleted).
OTC-T057 | completed | page.tsx unchanged hero retained; preview notice kept and intentional. Tool
     registration (lib/site.ts, app/tools/page.tsx) unchanged from Phase 4.
OTC-T058 | completed | Accessibility preserved + extended: semantic tables intact (caption/scope/
     aria-sort), real heading outline via Panel h2/h3, aria-current step rail, aria-pressed toggles,
     assertive + polite live regions, reduced-motion-safe pulses/spin (motion-reduce:animate-none),
     focus-visible everywhere, 44px targets, landmarks (nav/aside/section). Jump-nav is anchor links
     (keyboard-usable). NOTE: full screen-reader/axe pass still deferred to Phase 8.
OTC-T059 | completed | Checks: `npm run typecheck` clean; `npm run build` green (/tools/on-the-clock
     12.9 kB); `npm test` 17 files / 131 tests pass (no regressions). VISUAL VERIFICATION done in a
     real browser (dev server + Chrome): walked connect -> league picker -> room; confirmed the
     command bar, on-the-clock banner, Pure Value spotlight (headshot + accent numbers + finish strip
     WR6/WR14/WR8), Roster Need secondary, Big board table, native Draft board (serpentine numbers,
     Your pick / On the clock / Last pick markers), and right-rail panels all render premium + correct.

PHASE 4.5 COMPLETE. STOP POINT. Do NOT start Phase 5 (live data wiring) until owner approves.
UI runs entirely on fixtures; no live Sleeper/Supabase wiring; no live-draft behavior claimed.

### Phase 4.6 - Cockpit UX refinements (owner-requested; complete)
Fixtures only; no API/DB/engine change; accessibility preserved + verified in browser.
OTC-T060 | completed | View switcher replaces the section jump-nav. The room content area now
     SWITCHES views in place instead of one long scroll: "Who to pick" (Draft Signal hero +
     Available big board, default) and "Drafted players" (a Board <-> List sub-toggle showing the
     native draft board OR the pick list). Built as WAI-ARIA tabs (roving tabindex + arrow keys,
     aria-selected/aria-controls); sub-toggle is an aria-pressed segmented control (LayoutGrid/List
     icons). Right rail (Room status / Best remaining / Your draft) stays persistent across views.
     | files: app/tools/on-the-clock/on-the-clock-client.tsx
OTC-T061 | completed | Player-pool toggle is now CARD-STYLE with icons: Everyone (Users icon, "All
     ranked players") + Rookies only (Baby icon, "This year's class"), aria-pressed, 44px, in the
     command bar. Replaced the old segmented pill.
     | files: app/tools/on-the-clock/command-header.tsx
OTC-T062 | completed | List view (All picks): pick/round number column narrowed (w-px whitespace-
     nowrap, compact "{N} R{r}.{p}") and Player moved ahead of Team, so the player name sits right
     beside the number instead of being pushed far across the row.
     | files: app/tools/on-the-clock/pick-list.tsx
OTC-T063 | completed | Checks: `npm run typecheck` clean; `npm run build` green (/tools/on-the-clock
     13.8 kB); browser-verified the view switcher (swaps in place), Board/List sub-toggle, card pool
     toggle, and the narrowed list columns. (Tests unchanged: still 131 pass.)

### Phase 4.7 - Cockpit visual additions (owner-requested; complete)
Fixtures only; no API/DB/engine change; accessibility preserved; browser-verified.
OTC-T064 | completed | Draft board (board view only) now renders a small PlayerHeadshot next to each
     DRAFTED player. The headshot is aria-hidden (decorative) because the cell aria-label already
     names the player; unmapped/mock ids fall back to the shared avatar (never a broken image). Open
     slots / on-the-clock / empty cells stay photo-free. List view unchanged (no photos, by request).
     | files: app/tools/on-the-clock/draft-board.tsx
OTC-T065 | completed | New OnTheClockCard above the Who-to-pick content: a broadcast-style card with a
     big gradient pick number in round.pick form (e.g. 02.04) + overall #, which team is up, and a
     "picks below are for this slot / Sync if your draft moved" nudge. Makes it obvious the
     recommendations target that specific pick. Reduced-motion-safe pulse.
     | files: app/tools/on-the-clock/on-the-clock-card.tsx (new), on-the-clock-client.tsx (wired into
       the pick tabpanel)
OTC-T066 | completed | Checks: `npm run typecheck` clean; `npm run build` green (/tools/on-the-clock
     14.4 kB); browser-verified the ON THE CLOCK card (02.04 overall #12, Team 5) and board-view
     headshots (real photos where the CDN resolves, clean avatar fallback otherwise).

PHASE 4.7 COMPLETE.

### Phase 4.6 (Trade Analyzer) - mocked draft-room Trade Analyzer panel (owner-requested; complete)
Fixtures only; NO Phase 5 live wiring, NO real Signal Check API call, NO new DB tables, NO API
route changes, NO admin settings, NO live Sleeper data. UI/mock only before Phase 5. Pool-aware:
the analyzer mode switches on the existing player-pool toggle (Everyone -> Startup Value Check,
Rookies only -> Rookie Draft Signal Check).
OTC-T067 | completed | fixtures.ts - added MOCK-ONLY Trade Analyzer fixtures: TradeItemKind /
     TradeItemOption / TradeItemGroup types; MOCK_FUTURE_PICK_GROUP (2027/2028 1st-3rd Early/Mid/Late
     buckets); MOCK_STARTUP_TRADE_GROUPS (startup picks 1.05..4.06, each with a projected
     player/value, + future buckets); MOCK_ROOKIE_TRADE_GROUPS (rookie players, current-year rookie
     picks 1.01..3.05 with FF Beacon bucket values, + future buckets). All values illustrative, not
     engine output; header comment documents the future startup board-fill + Signal Check reuse.
     | files: app/tools/on-the-clock/fixtures.ts
OTC-T068 | completed | trade-analyzer.tsx (new) - the cockpit Trade Analyzer panel. Heading "Trade
     Analyzer" + helper "Check a draft-room trade before you accept it." + pool-aware mode badge +
     amber "Sample data only" preview note. Two labeled columns (Side A / Side B), each with a
     grouped <select> + Add button (optgroups by asset kind), removable item rows (44px X buttons
     with aria-label "Remove {asset} from {side}"), and a big accent Total value. ResultPanel: big
     side-by-side totals (lead marked with "(leads)" text + border, never color alone), a single
     polite aria-live region carrying the headline + plain-English explanation. Startup framing is
     "value check, not a demand"; rookie framing carries the "Powered by Signal Check logic" preview
     note. Even/slight/clear verdict from percentage difference. "Clear both sides" reset.
     | files: app/tools/on-the-clock/trade-analyzer.tsx
OTC-T069 | completed | on-the-clock-client.tsx - wired the Trade Analyzer in as a THIRD room view.
     Added "Trade Analyzer" (ArrowLeftRight icon) to the VIEWS tablist (View union now
     pick|drafted|trade) and a matching role=tabpanel that renders <TradeAnalyzer pool={pool} />, so
     it lives inside the draft HQ (available after a league is selected) and reuses the existing
     WAI-ARIA tabs keyboard model. The pool prop comes from the existing command-bar pool toggle.
     | files: app/tools/on-the-clock/on-the-clock-client.tsx
OTC-T070 | completed | Checks: `npm run typecheck` clean; `npm run build` green (/tools/on-the-clock
     17.2 kB, up from 14.4); full `npm test` = 17 files / 131 tests pass (unchanged). No Sleeper/
     Supabase/Signal-Check calls added; Phase 5 remains safe and untouched.

PHASE 4.6 (Trade Analyzer) COMPLETE. STOP POINT. Do NOT start Phase 5 (live data wiring) until
owner approves.

### Phase 5 - Live data wiring (owner-approved; IN PROGRESS)
Scope: wire the existing cockpit UI to the existing Phase 3 routes + Supabase Realtime. NO UI
redesign, NO Phase 6 recommendation engine, NO real Trade Analyzer / Signal Check wiring, NO admin
pages, NO value-pipeline changes, NO automatic Sleeper polling, NO commits/pushes.

OTC-T071 | completed | Task 1: inspected the mocked UI + data flow before changing code.
     | Findings (the exact mocked reads to swap):
       - ALL fixture reads live in on-the-clock-client.tsx: MOCK_LEAGUES (connect),
         MOCK_DRAFT_CACHE / MOCK_CONNECTED_USER / MOCK_SYNC_STATUS (room), MOCK_AVAILABLE +
         MOCK_RECOMMENDATIONS (value side).
       - connect() ignores the typed username and loads MOCK_LEAGUES; selectLeague() just sets
         state; the room derives on-the-clock + last pick from MOCK_SYNC_STATUS/MOCK_DRAFT_CACHE.
       - SyncButton owns a self-contained MOCK 30s countdown (no network).
       - UsernameGate already calls onConnect(username, season) + has a `pending` prop (no error
         prop yet). LeaguePicker takes leagues + onSelect + onRefresh (sync; no loading/error/
         truncated states yet). CommandHeader renders SyncButton internally and only passes
         syncLabel.
       - Phase 3 routes return: leagues GET -> { ok, season, leagues: LeagueCard[], truncated }
         (does NOT currently return the resolved Sleeper user_id); draft GET -> { ok, cache }
         (warms cold cache via one locked sync); sync POST -> { ok, status, cooldownRemainingSeconds,
         lastSyncedAt, cache, error? }. All require header x-requested-with: ff-beacon; all 503
         while settings.feature.enabled=false.
       - cache.ts shapePick (metadata-aware) is the canonical pick shaper but is NOT exported;
         Realtime needs the same shaping for a raw on_the_clock_pick_cache row.
       - Browser Supabase client = lib/supabase/client.ts createClient() (createBrowserClient,
         SUPABASE_PUBLISHABLE_KEY forwarded to the bundle via next.config env; URL is
         NEXT_PUBLIC_SUPABASE_URL). Realtime has NEVER been used in the UI before; OTC is first.
       - Tests run in vitest `environment: "node"` (no jsdom/RTL). Phase 5 tests must be pure
         function / fetch-wrapper units (lib/**/*.test.ts or app/**/*.test.ts), not React renders.
     | Scope decisions locked from the prompt + handoff (so the room is coherent + honest):
       - LIVE-wire: leagues lookup, draft cache load (warm + cold), Sync button, Realtime pick
         merge, draft board, pick list, My Draft, on-the-clock status, AND my-team detection.
         Task 5 lists "My Draft view" among the realtime-updated surfaces, so my-team detection is
         in scope. It needs the resolved Sleeper user_id, which only the server has -> add an
         additive top-level `userId` to the leagues route response (existing fields unchanged;
         backward compatible with the route test). This is the ONLY route change.
       - STAYS MOCK (clearly "Sample data" labeled): the available Big Board, Best Available /
         Team Need spotlight, Best remaining by position, and the Trade Analyzer. Per task 6 +
         handoff, the real ranked-board loader + recommendation engine are the next phase. The
         "if available" qualifier in task 5 confirms the available board may stay mock.
     | files: (none changed - inspection only)
     | verified: n/a (read-only pass)

OTC-T072 | completed | Foundation for live wiring (shared, testable, no UI redesign).
     | - cache.ts: renamed internal shapePick -> exported shapePickRow so the Realtime handler
         reuses the SAME pick shaper as the read path (zero drift). shapeDraftCache unchanged.
       - lib/on-the-clock/draft-derive.ts (NEW, pure, browser-safe, no Sleeper/Supabase/fetch):
         mapRealtimePickRow, mergePick/mergePicks (idempotent fold by pick_no), seatForPick (snake,
         mirrors draft-board.tsx pickNoFor), deriveDraftState (on-the-clock pick/seat/round + last
         pick + my-roster/my-seat detection + complete), teamNameForSeat, lastPickLabel,
         relativeTime/formatLastSynced/syncStatusLine (status copy).
       - lib/on-the-clock/client.ts (NEW, browser fetch wrappers): fetchLeagues/fetchDraft/syncDraft.
         Always attach x-requested-with: ff-beacon + cache:no-store; map HTTP status -> typed
         ApiErrorCode (feature-disabled/throttled/not-found/bad-input/forbidden/server/network) with
         the route message; sync wrapper passes the 200 status union through. Exactly one fetch per
         call (no polling).
     | files: lib/on-the-clock/cache.ts, lib/on-the-clock/draft-derive.ts, lib/on-the-clock/client.ts
     | verified: typecheck clean

OTC-T073 | completed | Task 2: username/search flow -> GET /api/on-the-clock/leagues.
     | - leagues route: added additive top-level `userId` (resolved Sleeper user_id) to the 200 body
         for connected-team detection. Existing fields unchanged (route test still green).
       - UsernameGate: added optional `error` prop (ErrorCard above the help text); already had
         pending + defaultUsername. Saved-username prefill flows from the server page.
       - Client connect() now calls fetchLeagues(username, season); shows pending (Finding...),
         inline error on the gate for user-not-found/throttled/feature-disabled/network, and only
         advances to pick-league on success. NO direct Sleeper call, NO route bypass.
     | files: app/api/on-the-clock/leagues/route.ts, app/tools/on-the-clock/username-gate.tsx,
       app/tools/on-the-clock/on-the-clock-client.tsx
     | verified: typecheck + build green; leagues route test passes

OTC-T074 | completed | Task 3: league selection -> GET /api/on-the-clock/draft?draft_id=.
     | - LeaguePicker: added loading / error / refreshing / truncated states (Refresh disabled +
         spinner while in flight; truncated note; LoadingCard/ErrorCard). Refresh re-requests the
         leagues route via the stored lookup (respects the durable lookup guard).
       - selectLeague() uses the card's draftId/leagueId/season and loads the room via fetchDraft
         (the read route warms a cold cache once server-side through the lock). 404/503/error render
         the branded ErrorCard + a "Try again" retry; the premium cockpit layout is unchanged.
     | files: app/tools/on-the-clock/league-picker.tsx, app/tools/on-the-clock/on-the-clock-client.tsx
     | verified: typecheck + build green

OTC-T075 | completed | Task 4: Sync Draft button -> POST /api/on-the-clock/draft/sync.
     | - SyncButton is now CONTROLLED presentational (no internal mock timer/network): props
         syncing/cooldownRemaining/statusMessage/onSync. CommandHeader threads a `sync` control
         object through to it (replaced the old syncLabel prop).
       - onSync sends { draft_id, league_id, season } so the server claims the lock with no
         pre-fetch. Statuses handled: synced (full cooldown starts), cooldown / synced-by-other
         (server's reported remaining seconds), served-cache, error. syncStatusLine renders "Updated
         just now", "Synced by another viewer Ns ago", "Last synced ... Next sync available in Ns",
         etc. Returned shaped cache replaces room state. The per-second countdown is a UI timer only
         (NOT polling; never calls Sleeper).
     | files: app/tools/on-the-clock/sync-button.tsx, app/tools/on-the-clock/command-header.tsx,
       app/tools/on-the-clock/on-the-clock-client.tsx
     | verified: typecheck + build green

OTC-T076 | completed | Task 5: Supabase Realtime (Postgres Changes on on_the_clock_pick_cache).
     | - Client subscribes via the browser client (lib/supabase/client.ts createClient) to channel
         otc-draft-{draftId} on table on_the_clock_pick_cache filtered sleeper_draft_id=eq.{draftId},
         event "*". On INSERT/UPDATE it maps payload.new via mapRealtimePickRow and folds it into
         local picks with mergePick (NO Sleeper, NO sync route, NO DB round-trip). Board, pick list,
         My Draft, on-the-clock status all recompute from the merged picks. pickCount bumps to the
         merged length. Cleanup: supabase.removeChannel on draft change / unmount. liveStatus drives
         a subtle "Live updates unavailable. Use Sync draft to refresh." note when not SUBSCRIBED;
         realtimeEnabled=false skips the subscription entirely (manual Sync only).
     | files: app/tools/on-the-clock/on-the-clock-client.tsx
     | verified: typecheck + build green (live propagation needs a real active draft - NOT yet tested)

OTC-T077 | completed | Task 6: recommendations + Trade Analyzer stay MOCK (clearly labeled).
     | - Available Big Board, Best Available / Team Need spotlight, Best remaining by position, and
         the Trade Analyzer still read fixtures. Added a "Sample data" badge to the Draft signal +
         Available players panels and explanatory copy; the page carries a partial-live notice. NO
         Phase 6 engine, NO Signal Check / trade endpoint wiring. Drafted board / picks / My Draft /
         on-the-clock are the live parts.
     | files: app/tools/on-the-clock/on-the-clock-client.tsx, app/tools/on-the-clock/page.tsx
     | verified: typecheck + build green

OTC-T078 | completed | Task 7: feature-flag (503) clean state + documented enable path.
     | - Server page loads on_the_clock_settings; when feature.enabled=false it renders a clean
         "On The Clock is not enabled yet." panel (no gate) with a League Pulse link. When enabled it
         passes realtimeEnabled + cooldownSeconds + savedUsername to the client. Defense-in-depth: if
         a route still returns 503 (settings flip mid-session), the client maps it to the same clean
         message. The 503 gate in the routes is NOT removed/bypassed.
       - Enable for local/manual testing (service role / SQL editor), single-row upsert:
         insert into on_the_clock_settings (id, settings)
         values ('global', '{"feature":{"enabled":true}}'::jsonb)
         on conflict (id) do update set settings = on_the_clock_settings.settings
           || jsonb_build_object('feature', jsonb_build_object('enabled', true)),
           updated_at = now();
         (loadOnTheClockSettings deep-merges over DEFAULT_ON_THE_CLOCK_SETTINGS, so only the feature
         flag needs to be set; everything else falls back to code defaults. Set back to false to
         disable.)
     | files: app/tools/on-the-clock/page.tsx
     | verified: typecheck + build green (FeatureOffNotice renders by default since no settings row)

OTC-T079 | completed | Task 8: tests + checks.
     | - lib/on-the-clock/draft-derive.test.ts (NEW): seatForPick snake math; deriveDraftState
         on-the-clock + my-team detection + complete; mapRealtimePickRow (shapes a raw row, null on
         bad payload, no Sleeper); mergePick/mergePicks idempotent fold; status copy.
       - lib/on-the-clock/client.test.ts (NEW): username flow calls the leagues route with the header
         guard; 503->feature-disabled, 429->throttled, 404->not-found, network->network; fetchDraft
         404; syncDraft POSTs draft_id+league_id+season and passes the synced/cooldown/synced-by-
         other/served-cache/error status union through; 500->server. Each wrapper makes exactly one
         fetch (asserts no polling).
     | checks: `npm run typecheck` clean; `npm test` = 19 files / 158 tests pass (was 17/131, +27);
       `npm run build` green (/tools/on-the-clock 20.8 kB, 190 kB First Load - the Realtime client
       adds the bundle).
     | files: lib/on-the-clock/draft-derive.test.ts, lib/on-the-clock/client.test.ts
     | verified: yes (all green)

PHASE 5 (live data wiring) COMPLETE for fixtures/mocked verification. NOT yet verified against a
real active Sleeper draft (live pick propagation, real my-team detection, snake/3RR ordering, two-
browser single-fetch). Available board + recommendations + Trade Analyzer remain MOCK by design;
the real ranked-board loader + recommendation engine are the next phase. No commits, no pushes.

### Phase 6A - real ranked-board loader (owner-approved; IN PROGRESS)
Scope: replace MOCK_AVAILABLE with the real FF Beacon ranked-board loader (consume-only). NO Team
Need engine (6B), NO real Trade Analyzer (6C), NO admin, NO value-pipeline changes, NO auto polling,
NO commits/pushes.

OTC-T080 | completed | Task 1: inspected the mocked board usage + the canonical query shape.
     | Findings:
       - MOCK_AVAILABLE (RankedPlayer[], defined in fixtures.ts alongside DraftPosition +
         RecommendationCardData) is consumed by AvailableList (players), BestRemainingByPosition
         (players), and via MOCK_RECOMMENDATIONS by PlayerSpotlight/SecondaryPick (player is a
         RankedPlayer). In on-the-clock-client.tsx, poolPlayers = MOCK_AVAILABLE filtered by
         isRookie. THIS is the exact read to replace.
       - Canonical query shape = app/rankings/page.tsx:114-228: rankings !inner join players
         (id, slug, first/last, position, team, status, external_ids), filter format_config_id +
         source + season + week is null, order overall_rank limit 500; per-table source resolution
         via resolveSourceForFormat("rankings") AND ("player_value_history"); latest value per player
         from player_value_history; 7d movement from player_value_trends. NOTE the rankings page
         HARDCODES SEASON=2025 (the R-risk the plan calls out).
       - DB reality: rankings has ONLY season=2025 rows (sources dynastyprocess, fantasycalc,
         ffbeacon, ktc). currentNflSeason() returns 2026 in June 2026, so a STRICT dynamic-season
         query returns an empty board today. DECISION: the loader resolves the season as "requested
         (currentNflSeason()) if it has rows for (format, source), else the latest season that does"
         and exposes a no-rankings empty state only when the (format, source) has NO rows in ANY
         season. This satisfies "dynamic season, never hardcode 2025" AND keeps the board working
         today (2026 -> 2025 fallback), auto-upgrading when 2026 rankings land. Documented deviation
         from a strict "empty when missing for current season".
       - players columns available: birth_date (age), draft_year, years_experience, external_ids
         (sleeper). Rookie derivation: years_experience === 0 (fallback draft_year === rookieSeason
         when years_experience is null). rookieSeason = currentNflSeason() (the incoming class),
         distinct from the value-board season.
       - Positions: only ffbeacon ranks K + DEF (K 522, DEF 288); KTC/FC/DP rank QB/RB/WR/TE only.
         ffbeacon is is_active=false (gated), so getAvailableSources excludes it and K/DEF are absent
         from the board by default TODAY. The loader includes K/DEF "when present" (coerces position
         to the 6 DraftPosition values, maps DST->DEF defensively); they surface once a K/DEF-ranking
         source is active.
       - format/source: OTC is a /tools/ page, so per CLAUDE.md's global source/format-sync rule the
         loader resolves via the standard chain (resolveFormatSlug/resolveSourceSlug +
         reconcileFormatWithSource + resolveSourceForFormat), NOT the /leagues/ league-derived path.
         League-auto-detected format needs the rich Sleeper league object (scoring_settings/
         roster_positions), which is NOT cached today; that is a later enhancement, documented.
       - RankedPlayer/DraftPosition/RecommendationCardData will move to lib/on-the-clock/board-types
         (so the server loader and client share one type); fixtures.ts re-exports them so existing
         component imports ("./fixtures") are unchanged. Drafted-exclusion + pool-filter run
         client-side (picks change via Realtime), so they go in the browser-safe draft-derive.ts.
     | files: (none changed - inspection only)
     | verified: n/a (read-only; DB facts confirmed via MCP execute_sql)

OTC-T081 | completed | Task 2: real ranked-board loader.
     | - NEW lib/on-the-clock/board-types.ts: DraftPosition, RankedPlayer (+ optional age/
         yearsExperience/7d-movement), RecommendationCardData, BoardStatus, BoardResult. fixtures.ts
         now re-exports DraftPosition/RankedPlayer/RecommendationCardData from here (component imports
         from "./fixtures" unchanged).
       - NEW lib/on-the-clock/board-loader.ts loadRankedBoard(supabase, {formatSlug,
         requestedSourceSlug, season, rookieSeason}): replicates the Rankings Board query shape
         (rankings !inner players join + latest player_value_history value + player_value_trends 7d),
         per-table source resolution via resolveSourceForFormat("rankings"/"player_value_history"),
         dynamic season with fallback (requested if it has rows, else latest season that does;
         seasonFellBack flag), position coercion to the 6 buckets (toDraftPosition, DST->DEF, drops
         IDP), rookie derivation (years_experience===0, fallback draft_year===rookieSeason), age from
         birth_date, sleeperId from external_ids.sleeper. Returns typed BoardResult with ok /
         no-rankings / error. Read-only (no writes). Does NOT touch the Rankings Board or any value
         pipeline.
     | files: lib/on-the-clock/board-types.ts, lib/on-the-clock/board-loader.ts,
       app/tools/on-the-clock/fixtures.ts
     | verified: typecheck clean

OTC-T082 | completed | Task 3: drafted-player exclusion (browser-safe, pure).
     | - draft-derive.ts excludeDrafted(board, picks): exclude by resolved player_id (exact), then
         Sleeper id, then a normalized-name guard for unmapped picks (no player_id). DST/K excluded
         the same way once drafted, present until then. Garbage/empty picks do not crash.
     | files: lib/on-the-clock/draft-derive.ts
     | verified: typecheck + tests

OTC-T083 | completed | Task 4: player pool filtering.
     | - draft-derive.ts filterPool(players, pool): Everyone = all undrafted ranked; Rookies = only
         RankedPlayer.isRookie. Missing rookie flags read false (empty Rookies pool, no crash). The
         room defaults the pool to "rookies" when draft.draftType === "rookie", user can override via
         the command-bar toggle. ASSUMPTION (documented): rookie = first-year player (years_experience
         ===0; fallback draft_year===currentNflSeason()); "current draft class" uses currentNflSeason()
         independent of the value-board season.
     | files: lib/on-the-clock/draft-derive.ts, app/tools/on-the-clock/on-the-clock-client.tsx
     | verified: typecheck + tests

OTC-T084 | completed | Task 5: wire the real board into the UI.
     | - page.tsx: resolves format/source via the standard global chain (resolveFormatSlug/
         resolveSourceSlug + reconcileFormatWithSource) and calls loadRankedBoard; passes BoardResult
         to the client (only when feature enabled). Added searchParams {format, source}.
       - on-the-clock-client.tsx: available = filterPool(excludeDrafted(board.players, picks), pool).
         AvailableList + BestRemainingByPosition now render the REAL board. Best Available =
         pickBestByValue(available) (real, deterministic). Team Need stays a clearly-labeled SAMPLE
         (SampleBadge + copy) until 6B. Command-bar Format/Source chips now show the resolved
         board.formatLabel / board.sourceLabel (no more hardcoded "Dynasty SF" / "KTC"). Empty/error/
         season-fallback states render in the Available panel. Premium cockpit layout preserved;
         Trade Analyzer untouched (mock).
     | files: app/tools/on-the-clock/page.tsx, app/tools/on-the-clock/on-the-clock-client.tsx
     | verified: typecheck + build green

OTC-T085 | completed | Task 6: draft-shape snake / linear / 3RR.
     | - draft-derive.ts: DraftShape + draftShapeFromMeta + isReversedRound + generalized
         seatForPick(pickNo, teams, shape) + pickNoForSeat(round, seat, teams, shape). linear never
         reverses; snake reverses even rounds; 3RR (settings.reversal_round) keeps the reversal round
         reversed then alternates. deriveDraftState now passes the shape; draft-board.tsx uses the
         shared pickNoForSeat (seat COLUMNS stay stable for a11y; only the serpentine pick number per
         cell changes). Auction treated as linear for seat math (board read-only).
     | files: lib/on-the-clock/draft-derive.ts, app/tools/on-the-clock/draft-board.tsx
     | verified: typecheck + tests (snake/linear/3RR + inverse round-trip)

OTC-T086 | completed | Tasks 7 + 8: tests + checks.
     | - lib/on-the-clock/board-loader.test.ts (NEW): toDraftPosition / deriveIsRookie /
         ageFromBirthDate; loadRankedBoard with a mocked Supabase chain - no-rankings empty state,
         season fallback (2026->2025), uses requested season when present, drops IDP + keeps K/DEF.
         The mock's write methods throw, proving the loader never mutates (no value-pipeline change).
       - lib/on-the-clock/draft-derive.test.ts (EXTENDED): draft-shape snake/linear/3RR +
         seat<->pickNo inverse round-trip; excludeDrafted by player_id / sleeper id / name guard +
         no-crash + K/DEF kept; filterPool Everyone vs Rookies + empty-not-crash; pickBestByValue
         deterministic tie-break + empty.
       - Checks: `npm run typecheck` clean; `npm test` = 20 files / 181 tests (was 19/158, +23);
         `npm run build` green (/tools/on-the-clock 21.6 kB, 191 kB First Load).
     | files: lib/on-the-clock/board-loader.test.ts, lib/on-the-clock/draft-derive.test.ts
     | verified: yes (all green)

PHASE 6A (real ranked board) COMPLETE at the code level. The available big board + Best Available
are now real FF Beacon data; Team Need stays a labeled SAMPLE (6B), Trade Analyzer stays mock (6C).
NOT yet verified against a real active Sleeper draft. KNOWN: by default the board shows only QB/RB/
WR/TE (only ffbeacon ranks K/DEF and it is is_active=false); format/source come from the global
chain, not league-auto-detected (deferred). No commits, no pushes.

OTC-T087 | completed | Season-behavior audit + fix (owner-requested, pre-6B).
     | Audit (MCP-verified, no value-pipeline changes): the Phase 6A report's "fallback to 2025 /
       showing 2025 values / 2026 not published" framing was WRONG and implied staleness. Findings:
       - rankings.season=2025 for ALL active sources, but rankings.generated_at = 2026-06-26 10:00
         (TODAY) - rankings are regenerated daily. season=2025 is a fixed board-season LABEL, not a
         freshness signal. Both the writer (lib/seed-rankings.ts: const SEASON = 2025) and the reader
         (app/rankings/page.tsx: const SEASON = 2025) hardcode the same label.
       - player_value_history.captured_at = 2026-06-26 (today) for every source;
         player_value_trends.updated_at = 2026-06-26 (today). Values are fully current daily data.
       - player_value_history has NO season column; the latest value per (player, format, source) is
         always used, independent of the rankings.season label. So values are current regardless.
     | Answers: (1) production Rankings Board hardcodes SEASON=2025, not dynamic. (2) yes, daily
       values flow from value_history/trends even though rankings.season=2025. (3) it is a LABEL, not
       stale. (4) yes - OTC should use the latest available ranking season per (format, source), not
       currentNflSeason(). (5) yes - the UI must NOT say "2025 values".
     | Fix (loader now matches production behavior):
       - board-loader.ts: board season = the LATEST published ranking-season partition for the
         (format, source) via the existing max(season) query. Dropped the currentNflSeason() request +
         count probe + fallback semantics. Dropped the `season` param (kept `rookieSeason` =
         currentNflSeason() for rookie-class derivation only - that is correctly calendar-based).
       - board-types.ts: BoardResult dropped requestedSeason + seasonFellBack; `season` is now
         documented as a label only.
       - on-the-clock-client.tsx: removed the misleading "Showing 2025 values..." note; the Available
         panel helper now reads "sorted by current FF Beacon value".
       - page.tsx: loadRankedBoard call updated (no season; rookieSeason only).
       - board-loader.test.ts: updated - no-rankings empty state, "uses the latest published ranking
         season as the board label (values stay current)", drops IDP + keeps K/DEF. Removed the
         obsolete "requested season" test.
     | files: lib/on-the-clock/board-loader.ts, lib/on-the-clock/board-types.ts,
       app/tools/on-the-clock/{on-the-clock-client,page}.tsx, lib/on-the-clock/board-loader.test.ts
     | checks: typecheck clean; npm test = 20 files / 180 tests pass; build green (/tools/on-the-clock
       21.5 kB). No value-pipeline changes. No commits/pushes.
     | verified: yes

### Phase 6A.2 - force FF Beacon source + auto-detect league format + DEF/K fix (owner-approved; IN PROGRESS)
Scope: force OTC value source to FF Beacon, auto-detect closest league format from Sleeper (like
Signal Check), remove user-facing source/format selectors, fix DEF/K loading. NOT 6B/6C, NO admin,
NO value-pipeline changes, NO commits/pushes.

OTC-T088 | completed | Task 1: audit of the source/format flow + Signal Check detection + DEF/K.
     | Findings:
       - OTC resolves format/source via the GLOBAL chain in app/tools/on-the-clock/page.tsx
         (resolveFormatSlug/resolveSourceSlug + reconcileFormatWithSource), then loadRankedBoard uses
         resolveSourceForFormat, which filters is_active and therefore picks the default KTC and NEVER
         ffbeacon (is_active=false). This is the root cause of DEF/K missing: KTC ranks no K/DEF.
       - No real source/format DROPDOWNS exist in the OTC UI; command-header.tsx shows read-only
         <Chip>s fed by board.formatLabel / board.sourceLabel. But URL ?format=/?source= + prefs still
         drive them via the global chain. "Remove selectors" = stop using the global chain, force
         ffbeacon, derive format from the league, show locked chips.
       - Signal Check detection lives in lib/sleeper-to-format.ts (deriveLeagueFormat, deriveFormatSlug,
         mapToFormatSlug, describeDerivedFormat, pickClosestSupportedFormat) + lib/signal-check/format.ts
         (FFBEACON_SOURCE_SLUG = "ffbeacon", FFBEACON_SOURCE_DISPLAY = "FF Beacon"; candidate list =
         ffbeacon.supported_format_slugs INTERSECT active format_configs). Signal Check reads ffbeacon
         values REGARDLESS of the source's is_active flag (it only gates on the FORMAT being active).
       - DB facts (MCP): ffbeacon ranks K (58 players, numeric sleeper ids, values up to 1499) and DEF
         (32 teams, external_ids.sleeper = team code like "ARI"/"BUF", values up to 1466). So DEF id
         mapping works (board.sleeperId = team code; drafted DEF pick.sleeperPlayerId = team code ->
         exclusion by sleeperId matches). toDraftPosition already maps DEF/DST->DEF and K/PK->K.
       - SleeperLeague type carries scoring_settings + roster_positions + settings + previous_league_id;
         the leagues route already fetches these via getSleeperLeagues, so format is detectable there
         with ZERO extra Sleeper calls (Task 4). The draft cache does NOT store league scoring, but we
         do not need it if detection happens in the leagues route.
     | Files in scope: app/tools/on-the-clock/{page,on-the-clock-client,command-header}.tsx,
       lib/on-the-clock/{board-loader,board-types,types}.ts, app/api/on-the-clock/leagues/route.ts,
       lib/sleeper-to-format.ts, lib/signal-check/format.ts.
     | Plan: force source=ffbeacon in the loader (reuse FFBEACON_SOURCE_SLUG, read the row regardless
       of is_active like Signal Check; render an admin note when is_active=false; graceful error only
       when the row/data is missing). Detect format per league in the leagues route. Move board load to
       a per-league GET /api/on-the-clock/board route fetched client-side on league select. Lock the
       UI chips. Fix DEF/K via the forced source (loader coercion already correct).
     | files: (none changed - inspection only)
     | verified: n/a (read-only; DB facts confirmed via MCP)

OTC-T089 | completed | Task 2: force value source to FF Beacon.
     | - board-loader.ts now FORCES source='ffbeacon' (FFBEACON_SOURCE_SLUG from lib/signal-check/
         format.ts; display "FF Beacon"). Dropped the global resolveSourceForFormat path (which
         filtered is_active and picked KTC). Reads the ffbeacon source row regardless of is_active
         (mirrors Signal Check); is_active=false -> BoardResult.sourceActive=false (admin note, not a
         block). Missing ffbeacon row -> status "source-unavailable" (graceful dev/admin message).
         loadRankedBoard signature is now { formatSlug, rookieSeason } (no requestedSourceSlug).
       - board-types.ts: BoardStatus adds "source-unavailable"; BoardResult adds sourceActive.
       - UI shows a locked "Values: FF Beacon" chip (command-header) + an admin note when
         sourceActive=false. No user-facing source dropdown exists.
     | files: lib/on-the-clock/board-loader.ts, lib/on-the-clock/board-types.ts,
       app/tools/on-the-clock/command-header.tsx, app/tools/on-the-clock/on-the-clock-client.tsx
     | verified: typecheck + tests (source-unavailable, sourceActive false-but-loads, sourceSlug=ffbeacon)

OTC-T090 | completed | Task 3 + 4: auto-detect closest league format from Sleeper (route context).
     | - NEW lib/on-the-clock/format-detect.ts: ffbeaconFormatCandidates (ffbeacon supported_format_slugs
         INTERSECT active format_configs, as FormatCandidate[]) + detectLeagueFormat(league, candidates)
         = exact deriveFormatSlug when ffbeacon carries it, else pickClosestSupportedFormat (never
         crosses redraft/dynasty). Reuses lib/sleeper-to-format.ts (the Signal Check toolkit).
       - leagues route detects the format PER league from the rich SleeperLeague object it ALREADY
         fetched via getSleeperLeagues (scoring_settings/roster_positions). ZERO extra Sleeper calls
         (one Supabase candidate read). LeagueCard gains formatSlug/formatLabel/formatDerivedLabel/
         formatIsClosest (lib/on-the-clock/types.ts). Task 4: the leagues route is the right place;
         no cache schema change needed.
       - UI: locked "Format: {label}" chip + helper "Format detected from your Sleeper league. Values
         always come from FF Beacon." (+ "Closest FF Beacon format used" when formatIsClosest).
     | files: lib/on-the-clock/format-detect.ts, lib/on-the-clock/types.ts,
       app/api/on-the-clock/leagues/route.ts, app/tools/on-the-clock/command-header.tsx
     | verified: typecheck + tests (exact/closest/never-cross-type/superflex)

OTC-T091 | completed | Task 5: remove user-facing selectors; board fetched per-league.
     | - The board is now format-specific per the SELECTED league, so it moved out of page.tsx into a
         new per-league GET /api/on-the-clock/board?format=<slug> route (header-guarded + feature-
         gated; forces FF Beacon in the loader). page.tsx no longer resolves global format/source and
         no longer loads the board. The client fetches the board on league select (fetchBoard in
         lib/on-the-clock/client.ts) and holds it in state, recomputing available = filterPool(
         excludeDrafted(board.players, picks)). Command-header chips are locked (Format auto-detected,
         Values=FF Beacon); no dropdowns. Global Rankings Board / Signal Check / other tools untouched
         (they still use their own resolvers).
     | files: app/api/on-the-clock/board/route.ts, lib/on-the-clock/client.ts,
       app/tools/on-the-clock/{page,on-the-clock-client,command-header}.tsx
     | verified: typecheck + build green

OTC-T092 | completed | Task 6 + 7: DEF/K audit + fix.
     | Audit (MCP): FF Beacon ranks K (58, numeric sleeper ids) + DEF (32, external_ids.sleeper =
       team code like "BUF"/"ARI"), values up to ~1499/1466. toDraftPosition already maps DEF/DST->DEF
       and K/PK->K; excludeDrafted matches DEF team-code ids via sleeperId. So DEF/K were missing for
       TWO independent reasons: (1) the global resolver picked KTC (no K/DEF) - fixed by forcing
       ffbeacon (OTC-T089); (2) K/DEF sit LOW by value (overall_rank ~509-797 for dynasty-SF, total
       797 ranked) and the board's 500-row cap truncated them out BEFORE reaching K/DEF.
     | Fix: raised BOARD_ROW_CAP 500 -> 1500 (largest ffbeacon format = 797 ranked, comfortable
       headroom; the available list is paginated client-side so the row count costs nothing visually).
       DEF/K now load when FF Beacon has values, appear in the available list + draft board + pick list
       + My Draft, and drop when drafted (exclusion). They are NOT recommended (Best Available is pure
       value; DEF/K almost never top it). Late-round DEF/K roster-need gating is Phase 6B.
     | files: lib/on-the-clock/board-loader.ts
     | verified: typecheck + tests (K/DEF kept, IDP dropped, DEF team-code id round-trips) + MCP row counts

OTC-T093 | completed | Task 8: tests + checks.
     | - NEW lib/on-the-clock/format-detect.test.ts (exact / closest / never-cross-type / superflex).
       - NEW app/api/on-the-clock/board/route.test.ts (header guard 403, bad slug 400, feature 503, ok
         returns ffbeacon board; route never passes a source - loader forces FF Beacon).
       - board-loader.test.ts rewritten for forced FF Beacon: source-unavailable when row missing;
         no-rankings; ok with sourceSlug/valueSourceSlug=ffbeacon + sourceActive; loads even when
         is_active=false (sourceActive=false); drops IDP + keeps K/DEF + DEF team-code id round-trips.
       - leagues route test: stubs format-detect, asserts the card carries the detected format.
       - Checks: typecheck clean; npm test = 22 files / 191 tests (was 20/180, +11); build green
         (/tools/on-the-clock 22 kB; new /api/on-the-clock/board route).
       - "Other tools unaffected": the global source/format chain is untouched; only OTC's loader +
         page were changed. Rankings Board, Signal Check, FAAB still resolve via their own paths.
     | files: lib/on-the-clock/format-detect.test.ts, app/api/on-the-clock/board/route.test.ts,
       lib/on-the-clock/board-loader.test.ts, app/api/on-the-clock/leagues/route.test.ts
     | verified: yes (all green)

PHASE 6A.2 COMPLETE at the code level. OTC value source is FORCED to FF Beacon (ffbeacon, now
is_active=true in the DB so it renders fully); format is auto-detected per league from Sleeper
(exact or closest); no user-facing source/format selectors (locked chips). DEF/K now load (forced
source + raised cap). NOT yet verified against a real active Sleeper draft. Team Need (6B) + Trade
Analyzer (6C) remain sample/mock. No value-pipeline changes. No commits/pushes.

---

PHASE 6B - Team Need recommendation engine (in progress, code only, no commits)

OTC-T094 | completed | Task 1: audit current recommendation/card flow (before changes).
     | Findings:
       - Best Available: pickBestByValue(available) in lib/on-the-clock/draft-derive.ts:117, called in
         app/tools/on-the-clock/on-the-clock-client.tsx:444. available = filterPool(excludeDrafted(
         boardPlayers, draftCache.picks), pool) (client line 441). boardPlayers = board.players when
         board.status==="ok".
       - Sample Team Need card: on-the-clock-client.tsx:454-463 (needSample = available.find(p !==
         bestPlayer)); rendered lines 580-586 via SecondaryPick + SampleBadge + "sample until engine".
       - Card prop shape: RecommendationCardData (lib/on-the-clock/board-types.ts:42) = { kind:
         "best"|"need", player: RankedPlayer|null, reason, decidingFactor: value|need|reach|none,
         filledSlot: string|null }. Rendered by player-spotlight.tsx PlayerSpotlight/SecondaryPick
         (uses data.player, data.reason, data.filledSlot).
       - Draft state (deriveDraftState, draft-derive.ts:212): onTheClockPickNo/Slot/Round/PickInRound,
         lastPick, myRosterId, mySlot, complete.
       - My picks: cache.picks.filter(pickedBy===myUserId || draftSlot===mySlot). Pick carries
         position (ShapedPick.position) + playerId. Seed roster: cache.rosters.find(mine).players =
         Sleeper ids; positions resolved via board RankedPlayer.sleeperId -> position.
       - Slot counts: ShapedDraftMeta.settings (Record<string,number>) carries Sleeper draft slots_qb/
         slots_rb/slots_wr/slots_te/slots_flex/slots_super_flex/slots_k/slots_def + teams/rounds. This
         is the roster_positions source; falls back to settings.positionFallbackTargets when absent.
       - Settings to client: page.tsx currently passes ONLY realtimeEnabled + cooldownSeconds. The 6B
         engine needs recommendation.weights, dstk gate, positionAdjust, positionFallbackTargets,
         recommendation.teamNeedEnabled - must be threaded through to the client.
     | files: (audit only, no changes)
     | verified: n/a (read-only audit)

OTC-T095 | completed | Tasks 2-5: recommendation engine (recommend.ts), scoring, slot model, DST/K gate.
     | NEW lib/on-the-clock/recommend.ts - pure, browser-safe, deterministic. Exports recommend()
       plus tested helpers (buildSlotModel, assignToSlots, slotFitFor, tallyPositions,
       isSuperflexFormat, isTepFormat, dstkRecommendable, reachScoreFor).
     | Task 3 (Team Need scoring): one canonical equation on 0-100 components -
         blended = wValue*valueScore + wNeed*needScore - wReach*reachScore.
       - valueScore: raw FF Beacon value rescaled 0-100 across the available board.
       - VORP: replacement[pos] = value of the league-wide last startable AVAILABLE player at that
         position (depth = teams * startableDepth(pos); FLEX/SF folded into skill spots; QB depth gets
         SF only when superflex). vor = max(0, value - replacement); vorScore rescaled 0-100.
       - needScore: slotFit.factor * formatMult * (0.5*valueScore + 0.5*vorScore), rescaled 0-100.
         slotFit: dedicated open slot 1.0, FLEX/SF 0.7, bench-only 0.25. So need is value-AWARE, never
         blind positional need, and never just the top value player again.
       - Deterministic tie-break: blended -> raw value -> better position_rank -> lowest player id.
     | Task 4 (slot model): buildSlotModel reads Sleeper draft.settings slots_qb/rb/wr/te/flex/
       super_flex/k/def (slots_rec_flex folded into FLEX); falls back to settings.positionFallbackTargets
       when no slot keys present. assignToSlots greedily fills dedicated -> FLEX (RB/WR/TE) ->
       SUPER_FLEX (QB/RB/WR/TE), so a drafted QB reduces SF need. have = my drafted + seeded (dynasty)
       positions. DEF/DST and K/PK normalization is handled upstream by board-loader toDraftPosition.
     | Task 5 (DST/K gate): dstkRecommendable() - "never" => never; "always_allowed" => always;
       "suppress_until_need" (default) => currentRound >= minRoundForDst/minRoundForK AND
       (requireStartingSlot ? league has the slot) AND team lacks one. Gated DST/K are removed from the
       Team-Need eligible pool but stay in available + Best Available (pure value can still surface a
       high-value one if the user position-filters). Defaults: minRoundForDst 10, minRoundForK 12.
     | Format logic: isSuperflexFormat (SUPER_FLEX slot OR slug ~ /sflex|superflex/) applies
       superflexQbMultiplier to QB need; isTepFormat (slug ~ /tep/) applies tePremiumMultiplier to TE
       need. Rookie-only pool just runs on whatever players are in `available` (caller pre-filters); no
       full-dynasty starter overreaction because need rescales within the eligible pool.
       reachScoreFor is POSITIONAL + tier-gated (only bites > maxReachTierBreak tiers below the best
       same-position option), so a needed position is never vetoed by an unrelated global top.
     | Graceful degrade: rosterKnown=false => need card shows the scarcity/value pick with the
       "No clear roster-need edge yet" copy; teamNeedEnabled=false or empty pool => safe fallback cards.
     | files: lib/on-the-clock/recommend.ts
     | verified: pending (tests + typecheck in OTC-T097/T098)

OTC-T096 | completed | Task 6: wire real Team Need into the UI (remove sample badge/copy).
     | - page.tsx now passes the full admin `settings` object to OnTheClockClient (new prop). Partial-
       live notice updated: only the Trade Analyzer is sample now (both rec cards are live).
     | - on-the-clock-client.tsx: removed pickBestByValue + SampleBadge + the needSample stand-in.
       Added coercePosition() (Sleeper pos string -> DraftPosition). Computes engine inputs from live
       data: detectedFormatSlug (board/league), isDynasty (slug ~ /dynasty/), myDraftedPositions (my
       picks via pickedBy/draftSlot), seededPositions (dynasty only: my roster's Sleeper ids -> position
       via the board's sleeperId map), rosterKnown (mySlot>0 || any picks/seed), currentRound. Calls
       recommend({...}); bestCard = rec.best, needCard = rec.need.
     | - Draft signal section: when rec.aligned, render ONE PlayerSpotlight variant="aligned" (no
       demotion to a runner-up). Otherwise the Best Available spotlight + the Team Need SecondaryPick
       (plain "Team Need" label, no Sample badge). Reason copy is plain English from the engine
       (decidingFactor-driven): "You are light at running back...", "Superflex leagues lean hard on
       quarterbacks...", "Tight end premium...", late "your lineup still needs a defense...", and the
       graceful "No clear roster-need edge yet. Best Available is your safest signal." fallback.
     | files: app/tools/on-the-clock/page.tsx, app/tools/on-the-clock/on-the-clock-client.tsx
     | verified: typecheck + build green

OTC-T097 | completed | Task 7: tests for the engine + UI wiring.
     | NEW lib/on-the-clock/recommend.test.ts (33 tests): Best Available is pure value; Team Need
       differs when the top value sits at a saturated position; superflex flips an equal-value tie to
       QB; TE premium flips an equal-value tie to TE; empty RB/WR/TE room recommends a sensible (not
       bottom-tier) player; rookies-only pool runs without crashing; dynasty seeded QBs reduce QB need
       so a non-QB wins; drafted players are never resurrected (engine only sees the caller's pool);
       K/DEF are in Best Available but gated out of early Team Need, and recommendable late only when
       rules require + team lacks one; "never"/"always_allowed" behaviors; missing roster settings fall
       back to fallback targets; rosterKnown=false uses the no-edge copy; empty pool -> empty cards;
       teamNeedEnabled=false disables Team Need but not Best Available; aligned flag + copy; reach is
       positional + tier-gated (a needed QB is not penalized for an unrelated top WR).
     | No-regression coverage: no source/format selector behavior touched (OTC still forces FF Beacon,
       format auto-detected); Trade Analyzer untouched (still mock); no value-pipeline file changed.
     | files: lib/on-the-clock/recommend.test.ts
     | verified: 33/33 pass

OTC-T098 | completed | Task 8: run checks.
     | - npm run typecheck: clean.
     | - npm test: 23 files / 224 tests pass (was 22/191 in 6A.2; +1 file, +33 tests).
     | - npm run build: green. /tools/on-the-clock 24.5 kB (was 22 kB). No new routes.
     | - No value-pipeline changes; no Sleeper polling added; no admin UI; no commits/pushes.
     | files: (checks only)
     | verified: yes (all green)

PHASE 6B COMPLETE at the code level. Team Need is a real value-aware recommendation (VORP + slot-fill
+ format multipliers + tier-gated reach + DST/K late gate) in lib/on-the-clock/recommend.ts, wired
into the cockpit (sample badge removed). Best Available stays pure value. Trade Analyzer (6C) remains
mock. No value-pipeline / source-format / polling changes. NOT yet verified against a real active
Sleeper draft. No commits/pushes.

---

PHASE 6C - Trade Analyzer (real value analyzer, code only, no commits)

OTC-T099 | completed | Task 1: audit current Trade Analyzer mock (before changes).
     | Findings:
       - Mock UI: app/tools/on-the-clock/trade-analyzer.tsx (TradeAnalyzer({pool})). Builds Side A/B
         from MOCK_STARTUP_TRADE_GROUPS / MOCK_ROOKIE_TRADE_GROUPS (app/tools/on-the-clock/fixtures.ts),
         sums option.value per side, describeResult() does the 5%/15% verdict. Pure UI shapes:
         TradeItemOption {id,label,detail?,value,kind} + TradeItemGroup {label,options[]}.
       - Cockpit nav: VIEWS in on-the-clock-client.tsx includes { id:"trade", label:"Trade Analyzer" };
         the trade tabpanel renders <TradeAnalyzer pool={pool} />. Keep this placement.
       - Already available in the client: `available` (post-exclusion + pool-filtered RankedPlayer[]),
         board.players (pre-exclusion full format board), board.formatSlug/formatLabel, league (season,
         formatSlug), draftCache.draft.settings (teams/rounds/slots/reversal_round), derived
         (onTheClockPickNo/Round, mySlot), draftCache.picks. pool state. recommend() already wired.
       - Reusable shape helpers (pure, lib/on-the-clock/draft-derive.ts): draftShapeFromMeta,
         seatForPick, pickNoForSeat, DraftShape (snake/linear/3RR already handled).
       - Signal Check / lib/trade-analyzer.ts analyzeTrade(): SERVER-side (queries player_value_trends +
         draft_pick_values, Sleeper-transaction shaped). NOT reusable client-side without a DB round
         trip and it pulls KTC pick values (would break OTC's force-FF-Beacon + project-from-board
         posture). REUSE only the verdict thresholds (<=5% even, <=15% slight edge, else won) as the
         pattern; do NOT import it. Signal Check pipeline modules are its own engine; leave untouched.
       - Decision: build a self-contained PURE module (lib/on-the-clock/trade-analyzer.ts) that values
         every asset from the board the client already holds (players = FF Beacon value; current picks =
         board projection via draft shape; future buckets = discounted board projection, clearly
         labeled estimated). No new routes, no DB, no pipeline change, browser-safe + testable.
     | files: (audit only, no changes)
     | verified: n/a (read-only audit)

OTC-T100 | completed | Tasks 2,3,4,6: pure trade-analyzer module (catalog + projection + verdict).
     | NEW lib/on-the-clock/trade-analyzer.ts - pure, browser-safe, deterministic. Exports TradeMode,
       TradeItemOption/TradeItemGroup (with `estimated` flag + computed value), buildTradeCatalog(),
       analyzeTradeSides(), plus tested helpers bucketSlot/futureDiscount and the documented constants
       FALLBACK_PICK_VALUE (50) + PLAYER_PICKER_CAP (200).
     | Task 2 (analyze): analyzeTradeSides(a,b) -> { totalA, totalB, diff, diffPct, lean, headline,
       detail, hasEstimates }. Lean buckets: fair (<=5%), a-lean/b-lean (<=15%), a-strong/b-strong
       (>15%), empty (nothing placed). Thresholds mirror the site trade analyzer; plain-English detail
       with a "value signal, not a recommendation" disclaimer and an estimate note when any pick is in.
     | Task 3 (startup): buildTradeCatalog mode="startup" -> groups: "Available players" (FF Beacon
       value, not estimated, top 200 by value), "Your upcoming startup picks" (the connected user's
       remaining picks via pickNoForSeat; generic mid-seat per round when mySlot unknown), "Future pick
       buckets". Startup pick value = projected player at that board slot (see Task 6). No board
       mutation, no DB.
     | Task 4 (rookie): mode="rookie" -> same shape but the board passed in is the rookies-only pool, so
       "Rookie players" + "Current rookie picks" + "Future rookie pick buckets" all project from the
       rookie board. Reuses the SAME projection + verdict (no duplicate business logic). Did NOT import
       Signal Check (its analyzeTrade is server-side + KTC-pick-based, which would break OTC force-FF-
       Beacon); reused only the verdict-threshold pattern. Signal Check untouched.
     | Task 6 (projection): current pick value = availSorted[max(0, overallPickNo - onTheClockPickNo)]
       (0 = on the clock; uses the existing snake/linear/3RR shape via pickNoForSeat). Already-made
       picks are excluded (only upcoming picks are offered). Future bucket value =
       poolSorted[(round-1)*teams + bucketSlot(bucket) - 1] * futureDiscount(yearsAhead) where
       futureDiscount = 0.85^yearsAhead; bucketSlot maps early/mid/late to ~15%/50%/85% of the round.
       Future picks project from the PRE-exclusion pool board (not depleted by the current draft) and
       are always estimated=true. Empty/thin board -> FALLBACK_PICK_VALUE, still flagged estimated.
       DEF/K are valued at their plain FF Beacon value (no boost), same as any player.
     | files: lib/on-the-clock/trade-analyzer.ts
     | verified: pending (tests + typecheck in OTC-T103/T104)

OTC-T101 | completed | Task 5: UI wiring (replace mock Trade Analyzer with real value check).
     | - trade-analyzer.tsx rewritten: takes { pool, groups, boardReady }. Removed the "Sample data
       only" amber note; mode framing (Startup Trade Builder / Rookie Draft Signal Check) + a plain note
       that picks are projected/estimated and this is a value signal not a recommendation. Builds Side A
       and Side B from the real `groups`; per-side add (native <select> with <optgroup>s = type-ahead
       search + full keyboard/screen-reader support, zero custom-widget risk) and remove; per-side total;
       a ResultPanel with the 5-bucket verdict (Fair / Slight edge to A|B / Strong edge to A|B), big
       side-by-side totals ("(leads)" text, not color alone), and an aria-live polite result region.
       Estimated picks carry an "est." marker on the chip + in the option label. Empty/board-not-ready ->
       graceful EmptyCard "Trade values are not available yet."
     | - on-the-clock-client.tsx: builds tradeGroups = buildTradeCatalog({ mode from pool, available,
       poolBoard = filterPool(boardPlayers, pool), draftSettings, shape = draftShapeFromMeta, onTheClock
       PickNo, mySlot, currentSeason }) when board.status==="ok"; passes groups + boardReady. Premium
       cockpit design + the existing "trade" tab placement preserved.
     | - fixtures.ts: removed the dead MOCK_*_TRADE_GROUPS / TradeItem* mock block (no consumers left).
     | - page.tsx + client header comment updated: no mock panels remain; Trade Analyzer is live with
       projected/estimated pick values.
     | files: app/tools/on-the-clock/trade-analyzer.tsx, app/tools/on-the-clock/on-the-clock-client.tsx,
       app/tools/on-the-clock/fixtures.ts, app/tools/on-the-clock/page.tsx
     | verified: typecheck clean

OTC-T102 | completed | Task 7: Trade Analyzer state handling.
     | - Reset on league switch AND pool switch: <TradeAnalyzer key={`${league.draftId}-${pool}`}> so
       changing leagues or Everyone<->Rookies remounts the analyzer and clears both sides (no carryover
       of players/picks between drafts).
     | - Board reload safe: placed items SNAPSHOT their TradeItemOption (label + value + estimated) at
       add time, so a sync/Realtime board reload only refreshes the add catalog, never mutating an
       already-placed asset.
     | - Drafted-mid-build behavior (documented): a player who gets drafted after being placed STAYS on
       the side with the value it had when added (safest: no surprise removal, no crash). They simply
       drop out of the add catalog (which reads from `available`). This is the chosen, documented
       behavior.
     | - No DB writes anywhere (MVP). No Sleeper calls.
     | files: app/tools/on-the-clock/on-the-clock-client.tsx, app/tools/on-the-clock/trade-analyzer.tsx
     | verified: typecheck clean

OTC-T103 | completed | Task 8: tests for the trade analyzer.
     | NEW lib/on-the-clock/trade-analyzer.test.ts (23 tests): startup player-for-player totals; startup
       pick projection from the available board; future bucket valuation (discounted board projection,
       exact value check vs bucketSlot*futureDiscount); rookie player-for-pick trade; rookie future
       buckets; fair/lean/strong-edge thresholds (<=5% / <=15% / >15%); snake/linear/3RR shapes do not
       crash; drafted players are not double-counted (current picks project only from `available`, never
       exceed the best available value); switching modes back to back is safe; empty board returns no
       groups (graceful unavailable); DEF/K valued at face value with no boost; documented fallback
       value used when a bucket cannot project. bucketSlot + futureDiscount unit tested.
     | No-regression: Signal Check untouched (its tests still pass); no value-pipeline file changed.
     | files: lib/on-the-clock/trade-analyzer.test.ts
     | verified: 23/23 pass

OTC-T104 | completed | Task 9: run checks.
     | - npm run typecheck: clean (test casts go through `unknown`).
     | - npm test: 24 files / 247 tests pass (was 23/224 after 6B; +1 file, +23).
     | - npm run build: green. /tools/on-the-clock 23.6 kB (slightly smaller; mock fixtures removed).
       Signal Check 14 kB unchanged (not broken). No new routes.
     | - No value-pipeline changes; no Sleeper polling; no admin UI; no source/format change; no commits.
     | files: (checks only)
     | verified: yes (all green)

PHASE 6C COMPLETE at the code level. The Trade Analyzer is a real, pool-aware value check
(lib/on-the-clock/trade-analyzer.ts): Everyone = Startup Trade Builder, Rookies = Rookie Draft Signal
Check style. Players use FF Beacon value; current picks project from the board via the existing
snake/linear/3RR shape; future buckets are discounted board projections, all flagged estimated. No mock
panels remain in On The Clock. No value-pipeline / source-format / polling changes. Signal Check
untouched. NOT yet verified against a real active Sleeper draft. No commits/pushes.

---

PHASE 6C.1 - Trade Analyzer pick ownership + transaction-aware pick values (code only, no commits)

OTC-T105 | completed | Task 1: audit current Trade Analyzer pick catalog (before changes).
     | Findings (the limitation to fix):
       - Current pick options are built in lib/on-the-clock/trade-analyzer.ts buildTradeCatalog() via
         upcomingPicks(), which ONLY generates the connected user's seat (mySlot) picks AND only
         upcoming ones (overall >= onTheClockPickNo). Generic mid-seat fallback when mySlot unknown.
         => It excludes: already-made picks, other teams' picks, and any traded-pick ownership.
       - Already-made picks ARE in cache.picks (ShapedPick: pickNo, round, draftSlot, rosterId, pickedBy,
         sleeperPlayerId, playerId, position, team) but the catalog ignores them entirely.
       - Future buckets: generic Early/Mid/Late x rounds 1-3 x 2 seasons, discounted board projection;
         not ownership-aware.
       - Available cached data: ShapedDraftMeta.slotToRosterId (slot->roster = original draft order),
         settings (teams/rounds/reversal_round), draftType; cache.picks (made picks w/ roster_id +
         picked_by + player_id); cache.rosters (rosterId/ownerId/coOwners/players); cache.users
         (userId/displayName). NO traded_picks fetched or cached yet. draft order = slot_to_roster_id.
     | files: (audit only)
     | verified: n/a

OTC-T106 | completed | Task 2: audit Sleeper transaction data already available.
     | - lib/sleeper.ts already has getSleeperTradedPicks(leagueId) -> SleeperTradedPick[]
       { season:string, round:number, roster_id:number (ORIGINAL owner/slot), previous_owner_id:number,
       owner_id:number (CURRENT owner) }. Also getAllSleeperTransactions / getSleeperWeekTransactions
       (raw trades with draft_picks) and getSleeperTradedPicks's sibling getSleeperTradedPicks.
       traded_picks is the AUTHORITATIVE materialized ownership state (cumulative result of every pick
       trade incl. current AND future seasons), simpler + safer than replaying transactions. Covers the
       owner clarification ("ownership changed through transactions/trades").
       - Existing parsers: lib/trade-analyzer.ts parsePicks (transaction draft_picks), lib/league-pulse.ts
         normalizeDraftPicks, lib/league-pick-slots.ts (inverts slot_to_roster_id -> slotFor). Reusable
         patterns; no need to duplicate.
       - Decision: use getSleeperTradedPicks in the EXISTING server sync path (sleeper-sync.ts). No new
         Sleeper utility needed, no client-side Sleeper calls, exactly ONE extra fetch per sync (added to
         the existing Promise.all), failure-tolerant (null -> [] -> partial status). Defensive parsing
         for missing/loosely-typed fields in the ownership module.
     | files: (audit only)
     | verified: n/a

OTC-T107 | completed | Task 3: pure draft-pick ownership model.
     | NEW lib/on-the-clock/pick-ownership.ts - pure, browser-safe, deterministic. Exports:
       - normalizeTradedPicks(raw): defensively parse the cached traded_picks jsonb (Sleeper rows
         { season, round, roster_id=ORIGINAL, owner_id=CURRENT, previous_owner_id }); coerces string/
         number, skips incomplete rows, never throws.
       - resolveCurrentDraftPicks({teams,rounds,shape,slotToRosterId,madePicks,tradedPicks,currentSeason})
         -> CurrentDraftPick[] for EVERY pick (overall 1..teams*rounds, all seats), each with overall/
         round/pickInRound/slot, originalRosterId (slot_to_roster_id), currentOwnerRosterId, ownershipKnown,
         made + madePick. Ownership priority: made pick's actual rosterId (authoritative) > traded_picks
         owner for (currentSeason, round, originalRoster) > original roster. Unknown seat mapping leaves
         ownership unknown (not guessed), pick still usable. Uses seatForPick (snake/linear/3RR).
       - resolveTradedFuturePicks(tradedPicks, currentSeason) -> concrete future-season picks that
         changed hands (season > current, owner != original), sorted, for owner-labeled future assets.
     | files: lib/on-the-clock/pick-ownership.ts
     | verified: pending (tests in OTC-T112)

OTC-T108 | completed | Task 4: sync + cache traded picks during the manual draft sync.
     | - Migration 0115_on_the_clock_draft_cache_traded_picks.sql: add traded_picks jsonb NOT NULL
       default '[]' to on_the_clock_draft_cache (RLS inherited from 0107: public SELECT, service-role
       write; client writes blocked). Applied via MCP; column verified (jsonb, NOT NULL, default '[]').
     - lib/database.types.ts: added traded_picks to the table Row (Json) + Insert/Update (Json?),
       targeted edit (full MCP type dump exceeded the token cap; column-level patch matches the schema).
     - lib/on-the-clock/sleeper-sync.ts: getSleeperTradedPicks(leagueId) added to the existing
       Promise.all (ONE extra Sleeper call per sync, inside the same durable lock/cooldown). It returns
       [] on any failure, so a traded-picks outage degrades to "no traded picks" (ownership falls back to
       the original draft order) WITHOUT breaking picks/board/sync = the partial-safe behavior. Written
       to the new traded_picks column on the draft upsert.
     - lib/on-the-clock/types.ts: ShapedTradedPick (snake_case, matches Sleeper + the normalizer) +
       ShapedDraftCache.tradedPicks.
     - lib/on-the-clock/cache.ts: shapeTradedPicks() validates + shapes the column; shapeDraftCache
       includes tradedPicks. The read route + Realtime path both surface it, so co-viewers get the
       updated ownership after any sync (read path re-shapes the freshly-written row).
     - Updated the two ShapedDraftCache literals (fixtures MOCK_DRAFT_CACHE, draft-derive.test cacheWith)
       with tradedPicks: [].
     | files: supabase/migrations/0115_on_the_clock_draft_cache_traded_picks.sql, lib/database.types.ts,
       lib/on-the-clock/sleeper-sync.ts, lib/on-the-clock/types.ts, lib/on-the-clock/cache.ts,
       app/tools/on-the-clock/fixtures.ts, lib/on-the-clock/draft-derive.test.ts
     | verified: migration applied + column verified via MCP; typecheck pending (OTC-T113)

OTC-T109 | completed | Tasks 5,6,7: catalog values made/upcoming/future picks (ownership-aware).
     | Rewrote buildTradeCatalog (lib/on-the-clock/trade-analyzer.ts) to consume the ownership model
       instead of the user-only upcomingPicks helper. New input: currentPicks (CurrentDraftPick[]),
       tradedFuturePicks, valueBoard (full board, any position), teamNameByRosterId, myRosterId.
     | Task 5 (made picks): "Made picks" group from currentPicks.filter(made). Value = the selected
       player's current FF Beacon value looked up by playerId then sleeperId in the FULL valueBoard;
       estimated=false (real value). Label "{round}.{pickInRound} - {Player}"; detail "Made pick, {pos}
       and {owner}". Unmapped player -> value 0, estimated=true, detail "value unavailable" (graceful,
       no fake value).
     | Task 6 (upcoming picks): "Upcoming picks" group from currentPicks.filter(!made), ANY owner.
       Value = projectAt(availSorted, max(0, overall - onTheClockPickNo)) (post-exclusion board, existing
       snake/linear/3RR overall math), estimated=true. Detail "Projected: {name}, {pos} and {owner}".
     | Task 7 (future): generic "Future pick buckets" unchanged (Early/Mid/Late x 1st/2nd/3rd x 2
       seasons, discounted board projection, estimated). NEW "Traded future picks" group built from
       resolveTradedFuturePicks: concrete owner-aware future picks valued at the round's mid bucket *
       futureDiscount, labeled "{season} {ordinal} - {owner}", estimated. Generic buckets vs concrete
       traded picks are separate groups = visually distinct. Owner labels: "Your pick" / team name /
       "owner unknown" (never invented). User's picks sort to the top of Made + Upcoming.
     | files: lib/on-the-clock/trade-analyzer.ts
     | verified: typecheck clean

OTC-T110 | completed | Task 8: UI shows all current draft picks grouped, with owners.
     | The TradeAnalyzer component already renders any `groups` as <optgroup>s, so the new groups
       (Available/Rookie players, Made picks, Upcoming picks, Future pick buckets, Traded future picks)
       appear automatically with owner labels in each option's detail line + the est. marker on
       estimated assets. on-the-clock-client.tsx now builds the catalog from the ownership model:
       normalizeTradedPicks(cache.tradedPicks) -> resolveCurrentDraftPicks + resolveTradedFuturePicks;
       builds teamNameByRosterId from cache.rosters + cache.users; passes valueBoard=boardPlayers (full),
       currentPicks, tradedFuturePicks, teamNameByRosterId, myRosterId=derived.myRosterId. Either side
       can add any pick. Native <select>+optgroup kept for accessibility. User's picks sorted first +
       labeled "Your pick" (easy to find, not the only option).
     | files: app/tools/on-the-clock/on-the-clock-client.tsx (trade-analyzer.tsx unchanged - generic)
     | verified: typecheck + build green

OTC-T111 | completed | Task 9: tests.
     | NEW lib/on-the-clock/pick-ownership.test.ts (12 tests): normalizeTradedPicks (string-season
       coercion, skip-incomplete, never-throw); ownership defaults to seat's roster (snake + linear);
       made pick authoritative; traded current pick changes owner; future-season trade NOT applied to
       current draft; unknown seat -> ownershipKnown false (no crash); teams/rounds 0 -> []; traded
       future picks filtered.
     | Rewrote lib/on-the-clock/trade-analyzer.test.ts for the ownership API: includes Made + Upcoming +
       Future groups; upcoming picks for ALL teams (not just the user); made pick valued by selected
       player's value; unmapped made pick -> 0/estimated/unavailable; upcoming projects from
       post-exclusion board; generic future buckets + owner-aware Traded future picks group; rookie mode
       (rookie-pick kind); snake/linear/3RR no crash; empty board -> []; partial-sync (empty traded
       picks) still builds full catalog; DEF/K summed at face value. analyzeTradeSides thresholds kept.
     | League-switch reset is covered by the client `key` (OTC-T102, unchanged); Signal Check + value
       pipelines untouched (full suite still green).
     | files: lib/on-the-clock/pick-ownership.test.ts, lib/on-the-clock/trade-analyzer.test.ts
     | verified: 31/31 in these files; full suite green

OTC-T112 | completed | Task 10: run checks.
     | - npm run typecheck: clean.
     | - npm test: 25 files / 255 tests pass (was 24/247 after 6C; +1 file, +8 net).
     | - npm run build: green. /tools/on-the-clock 24.5 kB; Signal Check 14 kB UNCHANGED (untouched).
     | - One new Sleeper call per sync (getSleeperTradedPicks, inside the existing lock); no polling; no
       value-pipeline/source/format change; no admin UI; no commits/pushes.
     | files: (checks only)
     | verified: yes (all green)

PHASE 6C.1 COMPLETE at the code level. The Trade Analyzer now offers EVERY current draft pick (made +
upcoming, any owner) plus generic and traded future picks. Made picks are valued by the selected
player's FF Beacon value; upcoming picks project from the post-exclusion board; ownership is
transaction-aware via Sleeper traded_picks cached on each manual sync (failure-tolerant). NOT yet
verified against a real active Sleeper draft. No value-pipeline / source-format / polling changes.
Signal Check untouched. No commits/pushes.

# On The Clock - PHASE 6D (Admin Settings UI) - in progress

OTC-T113 | completed | Task 0: carry-forward verification of Phase 6C.1 Trade Analyzer UI.
     | Verified (no code change needed): trade-analyzer.tsx renders ALL groups from buildTradeCatalog
       (Made picks, Upcoming picks, Future buckets, Traded future picks), not limited to the connected
       user (6C.1 rewrite). Owner labels ("Your pick" / team name / "owner unknown") come from
       buildTradeCatalog in lib/on-the-clock/trade-analyzer.ts. Estimated values are clearly labeled:
       option labels show "(value, est.)", placed chips show an "est." badge, and the mode blurb states
       picks are projected/estimated. No obvious bug; left as-is.
     | files: (verification only)
     | verified: yes

OTC-T114 | completed | Task 1: audit current On The Clock settings structure (no code change).
     | Source of truth: lib/on-the-clock/{types,default-settings,settings}.ts (single jsonb row
       on_the_clock_settings, id='global', service-role RLS, zod per-field defaults + deep-merge loader).
     | ACTIVELY USED settings (wired into running code):
       - feature.enabled -> all 4 routes gate (leagues/draft/sync/board) + page.tsx cockpit vs off-state.
       - sync.cooldownSeconds -> draft + sync routes (claim cooldown) + client countdown.
       - sync.lockSeconds -> draft + sync routes (in-progress lock).
       - sync.realtimeEnabled -> page.tsx + client Realtime subscription.
       - limits.maxActiveLeagues -> leagues route cap.
       - recommendation.teamNeedEnabled -> recommend.ts (gates Team Need card).
       - recommendation.weights.{value,need,reach} -> recommend.ts blended score.
       - recommendation.maxReachTierBreak -> recommend.ts reachScoreFor.
       - dstk.recommendBehavior / requireStartingSlot / minRoundForDst / minRoundForK -> recommend.ts
         dstkRecommendable gate.
       - positionAdjust.superflexQbMultiplier / tePremiumMultiplier -> recommend.ts format multipliers.
       - positionFallbackTargets.* -> recommend.ts slot model when roster_positions unmatched.
     | DEFINED BUT NOT YET WIRED into running code:
       - sourceFormat.defaultRankingSource -> SUPERSEDED by the Phase 6A.2 hard FF Beacon lock
         (board-loader forces 'ffbeacon'). Not read anywhere. Keep code-only; surface as a read-only note.
       - sourceFormat.defaultFormatFallback -> format-detect picks the closest supported format; this
         fallback slug is not consumed. Code-only.
       - pools.enabledPools / pools.defaultPool -> client hardcodes "everyone" then overrides from draft
         type; settings.pools is not read. Code-only.
       - limits.maxAvailablePlayers -> available list is not yet paginated against this. Code-only.
       - cache.activeTtlHours / completedRetentionHours -> consumed only as params by
         cleanup_on_the_clock_cache() (migration 0113), which is NOT cron-wired yet. Expose under
         Maintenance, labeled as taking effect when the cleanup job runs.
       - dstk.includedInRoom -> board always includes DST/K; flag not read. Surface as a read-only note.
       - mappingVisibility.showUnmappedPanel -> the unmapped-ids admin panel is not built. Code-only.
     | CODE-ONLY constants (NOT in settings, intentionally): Trade Analyzer projection constants live in
       lib/on-the-clock/trade-analyzer.ts (FALLBACK_PICK_VALUE=50, PLAYER_PICKER_CAP=200, future discount
       0.85^n, bucket slot %s, fair<=5% / lean<=15% thresholds). Per boundaries (no Trade Analyzer
       algorithm change), these stay code-only this phase; documented in the admin Trade Analyzer card.
     | EXPOSE in admin UI: the ACTIVELY-USED list above, plus cache TTLs (maintenance, with the caveat).
       Read-only informational: FF Beacon source lock, DST/K always-in-room. Unwired keys are preserved
       through save untouched (the manager edits a full settings object; only exposed fields change).
     | files: (audit only)
     | verified: yes

OTC-T115 | completed | Task 2: design admin settings groups (layman-friendly).
     | 1. Feature status: On/off master toggle (feature.enabled) + plain status copy.
     | 2. Sync & Sleeper limits: sync cooldown seconds, in-progress lock seconds, Realtime on/off, max
          active leagues returned. Cache TTLs moved to Maintenance.
     | 3. Board & player pool: read-only notes (values locked to FF Beacon; format auto-detected per
          league; DST/K always in the room). No editable controls here this phase (unwired).
     | 4. Recommendation engine: Team Need on/off, aggressiveness preset (seeds weights), value/need/
          reach weights, max acceptable reach (tier break), Superflex QB multiplier, TE premium
          multiplier, and DST/K recommendation gates (behavior, require starting slot, min round for DEF,
          min round for K). Advanced (collapsed): position fallback targets.
     | 5. Trade Analyzer: informational card explaining values are projected/estimated and the projection
          constants are code-only for now (no controls).
     | 6. Maintenance / debug: cache TTLs (active + completed, with "applies when cleanup runs" note),
          last updated timestamp (America/New_York), settings JSON preview, reset to defaults.
     | All numeric fields get plain-English labels + hints and are clamped to safe ranges on save.
     | files: (design only)
     | verified: yes

OTC-T116 | completed | Tasks 3+5: admin route/page + MVP controls.
     | NEW app/admin/on-the-clock/page.tsx (requireAdmin -> loadOnTheClockSettings via service role +
       reads on_the_clock_settings.updated_at; force-dynamic; mirrors /admin/faab).
     | NEW app/admin/on-the-clock/on-the-clock-settings-manager.tsx ("use client", mirrors the FAAB
       manager primitives: NumberInput text-buffer, Field/Toggle with aria-describedby hints,
       SectionCard, CollapsibleSection via native details/summary). Exposed (wired) controls: feature
       enabled toggle; sync cooldown / lock seconds + Realtime toggle + max active leagues; Team Need
       toggle, aggressiveness preset (seeds value+need weights), value/need/reach weights, max reach
       tier break, superflex QB + TE premium multipliers, DST/K behavior + require starting slot + min
       round DEF/K; advanced position fallback targets; maintenance cache TTLs. Read-only LockedNotes:
       FF Beacon source lock, auto-detected format, DST/K always in room. Informational: Trade Analyzer
       constants are code-only. a11y: one h1 (page), section headings, labels+hints linked via
       aria-describedby, native details disclosure, 44px controls, aria-live status, color never the
       only signal.
     | files: app/admin/on-the-clock/page.tsx, app/admin/on-the-clock/on-the-clock-settings-manager.tsx
     | verified: typecheck clean; build green (/admin/on-the-clock 6.97 kB)

OTC-T117 | completed | Task 4: settings read/write server action + clamp helper.
     | lib/on-the-clock/settings.ts: added clampOnTheClockSettings (coerces every numeric field into a
       safe range and forces lockSeconds <= cooldownSeconds; preserves unwired/unknown keys via spread).
     | NEW app/admin/on-the-clock/actions.ts: saveOnTheClockSettings (requireAdmin -> clamp -> validate
       -> service-role upsert with server-set updated_by; revalidates admin + tool) and
       resetOnTheClockSettings (restores code defaults but KEEPS current feature.enabled). Flow is
       clamp-first then validate so a valid-but-out-of-range payload is rescued while bad enums/types
       still fail safely. Service-role-only RLS unchanged; no anon/auth write path added.
     | files: lib/on-the-clock/settings.ts, app/admin/on-the-clock/actions.ts
     | verified: typecheck clean; unit tests below

OTC-T118 | completed | Tasks 6+7: reset-to-defaults behavior + admin nav.
     | Manager has three actions: Save settings; Reset form to defaults (local, keeps enabled, requires
       explicit Save); Reset to defaults and save (window.confirm, calls resetOnTheClockSettings, keeps
       enabled, upserts the row rather than deleting it). components/admin-nav.tsx: added the "On The
       Clock Settings" nav item (Timer icon, href /admin/on-the-clock) before System Settings.
     | files: app/admin/on-the-clock/on-the-clock-settings-manager.tsx, components/admin-nav.tsx
     | verified: build green (nav renders; page reachable)

OTC-T119 | completed | Tasks 8+9: tests + checks.
     | lib/on-the-clock/settings.test.ts: +1 round-trip-preservation test (pools / maxAvailablePlayers /
       mappingVisibility survive validate) and +5 clamp tests (defaults unchanged; too-low cooldown
       raised to 5; lock clamped <= cooldown and result re-validates; negative weight -> 0 + huge board
       cap -> 2000; superflex multiplier 50 -> 5).
     | NEW app/admin/on-the-clock/actions.test.ts (8): requireAdmin gating on save AND reset (throws ->
       no write); valid save stamps updated_by + id=global; unsafe lock/cooldown is clamped before
       write; malformed enum rejected without write; db error surfaced; reset keeps enabled=true from
       the current row and restores other defaults; reset with no row -> enabled false.
     | Checks: npm run typecheck clean; npm test 26 files / 269 tests pass (was 25/255, +1 file, +14
       tests); npm run build green. /tools/on-the-clock 24.5 kB UNCHANGED; Signal Check 14 kB UNCHANGED;
       value pipelines, FF Beacon source behavior, and league-format detection untouched. No commits/
       pushes.
     | files: lib/on-the-clock/settings.test.ts, app/admin/on-the-clock/actions.test.ts
     | verified: yes (all green)

PHASE 6D (Admin Settings UI) COMPLETE at the code level. /admin/on-the-clock exposes every wired On The
Clock setting in plain-English groups, gated by requireAdmin, validated + clamped + service-role-written,
with reset-to-defaults that preserves launch state. Unwired settings stay code-only and round-trip
untouched. No value-pipeline / source-format / polling change. Next: end-to-end live-draft QA.

OTC-T120 | completed | Sleeper draft-market ingestion (ADP + projections), nightly + historical.
     | NEW supabase/migrations/0120_player_market_snapshots.sql: player_market_snapshots (one row per
       source/season_type/season/sleeper_player_id/snapshot_date; adp jsonb map keyed by normalized
       format key with the 999 sentinel stripped; projected_pts_ppr/half/std columns; metadata jsonb =
       full raw Sleeper object; player/date/source indexes; RLS public-select + service-role-all) plus
       the player_market_latest security_invoker view for current lookups. Applied via MCP; policies
       verified via pg_policies; types regenerated to lib/database.types.ts.
     | NEW lib/sync-sleeper-market.ts (runSleeperMarketSync: one call to the undocumented
       api.sleeper.com/projections/nfl/{season} endpoint, rows stored only when they carry a real ADP
       or projection, zero-row and all-sentinel writes throw, batched idempotent upserts) + NEW
       scripts/sync-sleeper-market.ts (npm run sync:market) + NEW app/api/cron/sync-sleeper-market
       (CRON_SECRET + recordCronRun) + vercel.json 0 11 * * * + lib/cron-runs.ts registry entry +
       lib/sleeper.ts getSleeperSeasonProjections. docs/data-sources.md documents the endpoint shape
       and the no-historical-access limitation.
     | verified: yes (first run stored 672 rows, 100% player match, 10 ADP formats; re-run idempotent
       at 672 rows / 1 date partition)

OTC-T121 | completed | Completed-draft snapshot system (schema + finalizer + route).
     | NEW supabase/migrations/0121_on_the_clock_draft_snapshots.sql: on_the_clock_draft_snapshots (one
       row per draft: frozen board/draft/transactions/awards jsonb + provenance columns
       value/adp_snapshot_source+date, adp_format_key, player_pool, snapshot_confidence, checks) and
       on_the_clock_pick_snapshots (relational per-pick beacon value/rank, sleeper_adp,
       pick_value_delta, value_verdict; cascade). RLS public-select + service-role-all, verified.
     | NEW lib/on-the-clock/history-lookup.ts (server-only): resolveHistoricalBoard (re-ranks
       player_value_history source=ffbeacon at/before the draft completion time, paginated + bounded,
       falls forward then to current; classifies exact/during_draft/previous/next_available/
       current_fallback) + resolveAdpSnapshot (nearest player_market_snapshots partition, ordered adp
       key candidates) + deriveSnapshotConfidence. NEW lib/on-the-clock/snapshot-types.ts (pure payload
       types). NEW lib/on-the-clock/draft-snapshot.ts getOrCreateDraftSnapshot (snapshot-first; builds
       once from frozen inputs incl. trades via shared shaping and awards computed at finalize). NEW
       app/api/on-the-clock/draft/snapshot route (existing snapshots unthrottled; create path behind
       the durable claim). NEW lib/on-the-clock/transactions-shape.ts extracted from the transactions
       route so live + snapshot shaping is identical.
     | verified: typecheck + tests + build green (live end-to-end finalize needs a real completed
       draft; see handoff)

OTC-T122 | completed | On The Clock UX: ADP everywhere, inferred pool, grouped league search, awards.
     | Leagues route + picker: every league with a draft id now returns, staged Actively Drafting >
       Pre-Draft > Completed/In-Season (per-stage caps; completed cards dimmed with a Draft complete
       badge). LeagueCard.stage added.
     | Pool: manual Everyone/Rookies toggle REMOVED. inferPlayerPool (redraft/chopped -> everyone;
       dynasty <= 6 rounds -> rookies else everyone; best ball follows league type) +
       describeInferredPool + one-time accessible PoolNotice dialog (localStorage-keyed per draft,
       focus-managed, Escape/backdrop dismiss).
     | ADP: board route attaches latest Sleeper ADP per format market (adpFormatKeyCandidates maps
       format slug -> adp key; rookie pools prefer rookie ADP). Available list gains a sortable Sleeper
       ADP column with plain-English Beacon-vs-ADP comparison; draft board cells show Gem (good value)
       / AlertTriangle (reach) icons with the comparison written into the cell aria-label; pick list
       gains a Value vs ADP column ("Great value: taken 14 picks after ADP"). Threshold admin-tunable
       (valueIndicators.thresholdPicks, default 6, clamped 1..100).
     | Awards: Best Drafter (North Star) now = most total draft value vs Sleeper ADP (sum of pick_no -
       ADP over non-keeper picks with known ADP; pending without ADP data; copy updated). Worst Drafter
       unchanged. Snapshot mode renders the awards LOCKED at finalize.
     | Snapshot mode client: completed drafts load the finalized snapshot (frozen board/cache/trades/
       awards), hide Sync + Realtime, and show a "Final results" provenance banner (Eastern-time
       formatted). Fallback to live values only when a snapshot cannot be built, with a visible
       warning. Player photos in On The Clock are rounded-square (no circles).
     | Admin: /admin/on-the-clock gains the ADP value indicators setting + a read-only
       Completed-draft snapshots panel (finalized time, value/ADP dates + how chosen, confidence).
     | verified: yes (typecheck clean; 29 files / 314 tests pass incl. new adp/pool/awards/leagues
       tests; production build green; no commits, no pushes)

OTC-T123 | completed | Lost Signal award mirror + review-driven hardening.
     | lib/on-the-clock/awards.ts: Worst Drafter (The Lost Signal Award) now mirrors North Star
       exactly: LOWEST total (pick_no - ADP) over ADP-known non-keeper picks (the drafter who reached
       earliest / lost the most value against the market). Same pending rules (no ADP data, under two
       eligible teams, all-tied) and the same signed "picks of ADP value" metric. Old
       lowest-drafted-value logic removed. Tests updated + expanded (mirror scenario, biggest-net-reach
       winner, both-pending on no ADP / keepers-only / exact tie).
     | Review fixes (unbiased sub-agent findings on the T120-T122 work):
       1. history-lookup.ts pagination now has a deterministic secondary sort (.order("id")) so tied
          captured_at rows can never be duplicated/skipped across pages and silently drop players from
          a permanently frozen board.
       2. Snapshot payload carries thresholdPicks (the neutral band the draft was GRADED with);
          snapshot-mode board icons and list verdicts classify against the frozen threshold, so a
          later admin tuning can never change finalized results (matches the admin copy).
       3. on-the-clock-client.tsx: activeDraftIdRef staleness guard on loadDraft/loadBoard/loadSnapshot
          continuations (switching leagues mid-flight can no longer land league A's frozen snapshot
          inside league B's room); loading flags reset on select.
       4. draft-snapshot.ts freezes only trades with createdAt <= draft completion, so locked trade
          awards reflect the draft window instead of whenever the draft was first opened (cutoff +
          counts recorded in snapshot metadata).
       Also: available-list "no ADP" dash uses sr-only text instead of aria-label-on-span; CLAUDE.md
       ingestion-table list gains player_market_snapshots; pool-notice message uses the finalizer's
       format in snapshot mode.
     | files: lib/on-the-clock/awards.ts, lib/on-the-clock/awards.test.ts,
       lib/on-the-clock/history-lookup.ts, lib/on-the-clock/draft-snapshot.ts,
       lib/on-the-clock/snapshot-types.ts, app/tools/on-the-clock/on-the-clock-client.tsx,
       app/tools/on-the-clock/available-list.tsx, CLAUDE.md
     | verified: yes (typecheck clean; 29 files / 314 tests pass; production build green; no commits,
       no pushes)

T899 | completed | Migration 0120: merge the two overlapping NFL-team dimension tables (teams 0084 +
       nfl_teams 0117) into one canonical nfl_teams table. Both held all 32 teams keyed on
       abbreviation. Because article_teams.team_id FKs teams.id (and nothing referenced nfl_teams.id),
       the branding columns (primary/secondary/tertiary_color, chant) were absorbed into teams, the
       old nfl_teams was dropped, then teams was renamed to nfl_teams so the FK rides the rename with
       ids preserved. Constraints/indexes/policies renamed to nfl_teams_*. A guard aborts the copy if
       any branding is null or the row counts do not match; verified 32/32 rows carry both editorial
       (conference, division, discord_role_ids) and branding fields, 0 bad hex, article_teams FK now
       points to nfl_teams, all 14 tag rows survived. Code: 6 .from("teams") sites repointed to
       nfl_teams; 3 PostgREST article_teams embeds teams(...) -> nfl_teams(...) with their consumer
       property access updated .teams -> .nfl_teams. Types regenerated (teams removed, nfl_teams
       gains the 3 editorial columns, FK referencedRelation updated) and prettier-formatted.
     | files: supabase/migrations/0120_merge_teams_into_nfl_teams.sql, lib/database.types.ts,
       lib/beacon-brief-feed.ts, lib/beacon-brief/match.ts, lib/beacon-brief/match-resolution.ts,
       app/admin/beacon-brief/articles/page.tsx, app/admin/beacon-brief/moderation/page.tsx,
       app/admin/beacon-brief/actions.ts
     | verified: yes (MCP apply ok; data + FK + RLS + renamed objects verified via SQL; typecheck
       clean; 29 files / 314 tests pass; review sub-agent PASS on completeness, false positives,
       consumer correctness, migration sanity, punctuation; no commits pushed)
