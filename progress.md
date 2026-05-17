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
T040 | completed | /tools/league-sync anonymous Sleeper username -> leagues
     | files: app/tools/league-sync/page.tsx + league-sync-form.tsx + league-results.tsx,
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

## Next milestone
- News pipeline (RSS ingestion -> news_items, AI summary via Claude)
- Vote matchups (/vs/[a]-vs-[b]) live
- Weekly content cron (waivers, start-sit, sleepers)
- IndexNow + sitemap generation
- AdSense readiness sweep
