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

## Next milestone
- News pipeline (RSS ingestion -> news_items, AI summary via Claude)
- Vote matchups (/vs/[a]-vs-[b]) live
- Weekly content cron (waivers, start-sit, sleepers)
- IndexNow + sitemap generation
- AdSense readiness sweep
- Phase 12 follow-ups: real commissioner detection, edge runtime for OG,
  Geist woff2 fetch in OG cards, toast-style refresh feedback
