# Handoff: Signal feature, Phase 2 complete

Phases 0, 1, and 2 are done and committed to `main` (NOT pushed). Read CLAUDE.md
and the "Signal" sections of progress.md before continuing.

## Where things stand

- Phase 0 (commit 3e7fdca): schema, RLS, abuse triggers. Migrations 0059-0067.
- Phase 1 (commit 4b6cb6f): handle lifecycle (0068), My Signal identity editor,
  image-hardening route, minimal Layout A public profile at /u/[handle].
- Phase 2 (this commit): featured boards + featured leagues BY REFERENCE, shared
  <SignalBlock> renderer, public read-only board view, tag-based caching, OG
  image, sitemap. Tasks T778-T788 in progress.md.

NOTE: this commit also includes the T760/T761 foundation it builds on
(profile-display controls on user_ranking_boards): migration
0058_ranking_board_profile_display.sql plus the edits to
app/my-beacon/rankings/page.tsx and profile-boards-manager.tsx. 0058 is a hard
dependency of the already-committed 0064, and Phase 2 scope explicitly wires
profile_top_n into the boards manager, so they are committed together rather
than left dangling. `.claude/settings.local.json` is intentionally NOT committed.

## Phase 2 architecture (for the next session)

- Data layer: lib/signal-profile.ts. loadProfileBundle(handle) is the
  cookie-free, admin-client, unstable_cache bundle tagged signal:{handle}
  (signal row any-state + featured-board metadata + featured-league cards).
  loadBoardTopN(boardId, updatedAt, limit) and loadPublicBoard(boardId) are
  tagged board:{id}. revalidateProfileCaches(supabase, userId) busts
  signal:{handle} AND every board:{id} for that user; call it from any server
  action / route that changes publish state, handle, identity, avatar/banner,
  featured leagues, or featured-board curation.
- Public profile: app/u/[handle]/page.tsx. Live path reads NO cookies (cacheable
  via the bundle's data cache + ISR revalidate=3600). Owner-preview path reads
  cookies and re-checks ownership; it is the only way a non-live profile renders.
  The route shows as Dynamic in the build because of that branch, but anon hits
  are served from the tag-cached data layer.
- Public board view: app/u/[handle]/rankings/[boardId]/page.tsx (gated on owner
  live + board profile_visible).
- OG: app/api/og/signal/[handle]/route.tsx (brand-locked, non-live = generic
  fallback). Sitemap: app/sitemap.ts (live profiles only).
- Featured boards render no player values and no source slugs (ordering is the
  owner's opinion). League cards show name/season/teams/format display name +
  power-ranking leader from league_power_rankings_cache via the default source;
  the public page NEVER calls Sleeper or pulseLeague.
- Editors: My Signal (/my-beacon/signal) has a Featured-leagues section
  (signal-leagues-manager.tsx + saveSignalLeagues, stores ordered
  signal_league_ids in user_preferences.sleeper_league_settings). The boards
  manager has a per-board Top-N control (profile_top_n).

## Reviews

Implementation + accessibility + security sub-agents run; all findings fixed
(see progress.md T788). No outstanding blockers.

## Not yet built (likely next phases per the Signal plan)

- Wall / signal_posts UI (schema + abuse triggers exist from Phase 0; report
  endpoint + rate-limit enforcement still to wire).
- signal_follows / For You feed UI (graph + follower_count trigger exist).
- Additional profile layouts (B/C) reusing <SignalBlock>.
- Root-level /[handle] alias (Phase 7).
- Accent picker + favorite team/player on the public profile.

## Carryover / known deferred

- Site-wide token contrast: ink-subtle (#6B6B7D) fails AA for body text;
  signal-danger misses AAA. Whole-app design-system pass, decide with owner.
- Public full-board view caps at 1000 players (Supabase default; fantasy boards
  rarely exceed a few hundred). Page with .range() if that ever changes.
- Per-user upload rate-limiting on /api/signal/media (size-capped + auth-gated,
  no throttle yet).

## Verification gate (every session)

`npm run typecheck` then `npm run build`. Lint is not configured. No em-dashes /
AI-tell punctuation anywhere. One shell command per tool call. Commit to main,
do not push until the session is complete. Close with the three sub-agent reviews.
