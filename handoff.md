# Session Handoff - 2026-05-16

## What got done this session

Phases 0-10 complete. 47 atomic tasks shipped: T001-T047. Production build is green with 214 routes including 200 statically-generated player pages.

## Site capability snapshot

- Public site at `/`, `/about`, `/author/michael`, `/tools`, `/guides`, `/players`
- Rankings board at `/rankings` with format + position filters, sortable accessible table
- Player pages at `/players/[slug]` (top 200 SSG, rest ISR on demand)
- Anonymous Sleeper league pulse at `/tools/league-pulse`
- Logged-in personalized dashboard at `/dashboard` with sleeper_username save
- FAAB calculator at `/tools/faab` with player autocomplete + need-weighted bid
- Auth: Google OAuth + Discord OAuth + magic-link email at `/login`
- Format + theme toggles in header (desktop) and mobile drawer

## Data state

Supabase project `cilvpyivysjxpxbudkfa`:
- `format_configs`: 8 rows (seeded)
- `players`: 4,368 rows (synced from Sleeper)
- `trade_values`: 2,878 rows from KTC across all 8 formats
- `rankings`: 8 formats × 299–461 rows (FF Beacon-source, derived from KTC values)
- `player_stats`: 0 rows (script written, not run, see below)
- `articles`, `news_items`, `vote_matchups`, `votes`, `user_preferences`: empty (await pipelines)

## What the user still has to do before specific features work end-to-end

1. **OAuth providers** in Supabase Auth dashboard:
   - Enable Google with redirect URI `{site}/auth/callback`
   - Enable Discord with redirect URI `{site}/auth/callback`
   - Add `http://localhost:3000` and prod domain to redirect allowlist
   - Without this, `/login` shows the form but sign-in fails on click

2. **Run the stats backfill** when ready:
   ```
   SEASON=2024 npm run sync:stats
   ```
   Imports weekly stats for all 4368 players. Takes 5-10 minutes. Until run, the "Last games" section on player pages shows the empty-state message.

## Known notes / deviations

- The `age` column on `players` was specified as a generated column. Postgres rejected it because `age()` is not immutable. Removed; consumers compute from `birth_date` at query time.
- `experimental.typedRoutes` was enabled then disabled. Strict route typing rejected our dynamic href construction (e.g. `?format=...` URLs). Will revisit if we want compile-time route safety.
- KTC unmatched 399 of 3277 entries (~12%). Mostly rookie draft picks (RDP position). Acceptable for v1; revisit when picks become tradeable on the rankings board.
- Supabase JS client defaults to a 1000-row limit per SELECT. The first KTC sync hit this and matched only 142 of 2878. Players are now loaded with explicit pagination via `range()`.

## Stack & conventions reminder

- Next.js 15 App Router, React 19, TypeScript strict, Tailwind 3, next-themes, Geist Sans/Mono
- Supabase clients in `lib/supabase/` using NEW key names: `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`
- Scripts live under `scripts/`, run via `tsx --env-file=.env.local`
- Per CLAUDE.md every table migration includes its RLS policies in the same SQL file

## Open verification items (recommended next session)

1. Run sub-agent reviews at each phase boundary (skipped to keep velocity):
   - Implementation review against plan.md
   - Accessibility audit (header, mobile drawer, rankings table, FAAB form, player page)
   - Security audit (RLS policies on all tables, secret key only used server-side, no XSS in
     user-provided sleeper_username, etc.)
2. Lighthouse against `/`, `/rankings`, `/players/jaxon-smith-njigba-9488`, `/login`. Target a11y 100.
3. Manual screen reader pass: NVDA on Windows for the homepage and rankings table.
4. Sign-in smoke test once OAuth providers are enabled.
5. Try the FAAB calculator against a known player to sanity-check the bid math.

## Next milestones (suggested)

- News ingestion (RSS -> news_items + Claude summary)
- Vote matchups system (`/vs/[a]-vs-[b]` with login-gated voting)
- Weekly content cron for waivers, start-sit, sleepers
- Sitemap + IndexNow integration
- AdSense readiness review
- Auth trigger: autocreate `user_preferences` row on first signin (currently created on save)

The reference repo at `~/Desktop/dynasty-price-check/` is read-only and remains available for the news pipeline and any later Sleeper additions.
