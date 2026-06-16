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
     | verified: yes (build; /u/[handle] now ƒ dynamic)
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

## Next milestone
- News pipeline (RSS ingestion -> news_items, AI summary via Claude)
- Vote matchups (/vs/[a]-vs-[b]) live
- Weekly content cron (waivers, start-sit, sleepers)
- IndexNow + sitemap generation
- AdSense readiness sweep
- Phase 12 follow-ups: real commissioner detection, edge runtime for OG,
  Geist woff2 fetch in OG cards, toast-style refresh feedback
