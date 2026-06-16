# Handoff: Signal feature, Phase 3 complete

Phases 0, 1, 2, and 3 are done and committed to `main` (NOT pushed). Read
CLAUDE.md and the "Signal" sections of progress.md before continuing.

## Where things stand

- Phase 0 (commit 3e7fdca): schema, RLS, abuse triggers. Migrations 0059-0067.
- Phase 1 (commit 4b6cb6f): handle lifecycle (0068), My Signal identity editor,
  image-hardening route, minimal Layout A public profile at /u/[handle].
- Phase 2 (commit 72b6567): featured boards + featured leagues BY REFERENCE,
  shared <SignalBlock> renderer, public read-only board view, tag-based caching,
  OG image, sitemap. Tasks T778-T788.
- Phase 3 (commit 594b8b2): customization. Accent palette, custom links, favorite
  team/player editors on /my-beacon/signal, plus public render on /u/[handle].
  Tasks T789-T795. Migration 0069.

`.claude/settings.local.json` is intentionally NOT committed.

## Phase 3 architecture (what the next session inherits)

- Accent palette: lib/signal/accents.ts is the single source of truth (fixed
  10-slug AAA set, beacon default). HARD contrast rule is baked into the helpers:
  accentFillStyle(slug) returns the LOCKED {backgroundColor, color:textOnFill}
  pair (black text on fill, always; white-on-accent is impossible at call sites);
  accentInkColor(slug) is the accent-as-text/border/icon-on-dark path;
  accentGradient(slug) derives a decorative banner gradient from the single hex.
  lib/signal.ts re-exports these for existing import sites. REUSE these helpers
  for any new accent-colored chip in Phase 4 (e.g. Wall author accents).
- DB: migration 0069 moved signals.accent to the new 10-slug CHECK and added a
  function-backed links shape guard (signal_links_valid + signals_links_shape_check:
  array <=10, each {label 1..40 string, url <=2048 string matching ^https://}).
  No new columns, so database.types.ts was NOT regenerated.
- Server actions (app/my-beacon/signal/actions.ts, "use server"): saveAccent,
  saveLinks, saveFavorites, searchPlayers. Shared constants + types live in
  app/my-beacon/signal/customization.ts because a "use server" file may only
  export async functions. Every write calls revalidateProfileCaches().
- Editors (client): accent-picker.tsx (native-radio radiogroup, arrow-key, live
  preview, aria-live), links-editor.tsx (add/edit/remove + accessible move up/down
  reusing the boards-manager pattern), favorites-editor.tsx (labeled team select +
  WAI-ARIA combobox typeahead over searchPlayers, debounced, clear-to-null). Wired
  into page.tsx as Appearance / Links / Favorites sections.
- Public render: lib/signal-profile.ts loadProfileBundle now also returns links
  (parsed, https-guarded on read) + resolved favorite team/player. signal-block.tsx
  adds LinksBlock (rel=noopener noreferrer target=_blank, label-not-URL, new-tab
  announced) + FavoritesBlock (accent-fill chips). Rendered in app/u/[handle]/page.tsx.

## Phase 2 architecture (still load-bearing)

- Data layer: lib/signal-profile.ts. loadProfileBundle(handle) is the cookie-free,
  admin-client, unstable_cache bundle tagged signal:{handle}. loadBoardTopN and
  loadPublicBoard are tagged board:{id}. revalidateProfileCaches(supabase, userId)
  busts signal:{handle} AND every board:{id} for that user; call it from ANY server
  action / route that changes anything the public profile shows.
- Public profile app/u/[handle]/page.tsx: live path reads NO cookies (cacheable +
  ISR revalidate=3600); owner-preview path reads cookies and re-checks ownership.
- Featured boards render no player values and no source slugs. League cards never
  call Sleeper / pulseLeague; leader comes from league_power_rankings_cache via the
  default source.

## Phase 4 (next session): the Wall + reporting / moderation

The schema is ALREADY built and hardened from Phase 0. Phase 4 is UI + endpoints.

- signal_posts (migration 0061): the Wall. Columns include moderation
  hidden/hidden_reason/hidden_at/hidden_by (service_role only via column GRANTs).
  A BEFORE INSERT trigger enforces rate limits (15s between posts, 10/hour,
  40/day) and max 3 links per post; it is SECURITY DEFINER so hidden posts still
  consume quota. created_at is forced to now() and the max-3-links cap also applies
  on UPDATE (migration 0067). The trigger is the backstop; the post composer must
  still validate client-side + server-side and surface the friendly rate-limit copy.
- signal_post_reports (migration 0062): report/flag. Authenticated-only insert,
  one row per (post, reporter) via unique constraint, admin queue via service_role.
  The per-reporter rate limit (15s/10h/40d) is NOT in a trigger; it must be
  enforced server-side in the report endpoint this phase builds.
- signal_follows (migration 0063): graph + denormalized signals.follower_count via
  AFTER trigger. The follow button + For You feed UI are likely a later phase, but
  the follower_count is already public and could surface on the profile now.

Suggested Phase 4 surface (confirm scope with owner before planning):
1. Post composer on /my-beacon/signal (or a dedicated Wall editor): text + up to 3
   links, client mirror of the trigger limits, aria-live on post/limit/error.
2. Wall render block on /u/[handle] (reuse <SignalBlock>; hide hidden posts on the
   public path; owner sees their own hidden posts flagged).
3. Report endpoint (app/api/signal/report or a server action): same-origin/CSRF
   guard + auth + per-reporter rate limit (mirror the league_refresh_attempts
   pattern or the in-trigger window approach), generic error copy.
4. Cache: posting / hiding a post must bust signal:{handle} (extend
   revalidateProfileCaches or add a wall:{handle} tag).
5. Admin moderation surface (hide/unhide) if in scope.

## Reusable patterns to lean on

- revalidateProfileCaches(supabase, userId) for all cache invalidation.
- <SignalBlock> (components/signal/signal-block.tsx) for any new public profile
  section: self-contained <section> + heading, returns null when empty.
- Accessible move up/down + aria-live reorder: profile-boards-manager.tsx and the
  new links-editor.tsx.
- WAI-ARIA combobox: favorites-editor.tsx PlayerTypeahead (and tools/faab faab-form).
- Accent chips: accentFillStyle / accentInkColor (NEVER hand-pick a foreground).
- Server-side validation is authoritative; DB trigger/CHECK is the backstop; map
  trigger RAISE tokens to friendly copy (see mapHandleError in signal actions).

## Carryover / known deferred

- searchPlayers (Phase 3) has no server rate limit: session-gated, public player
  data only, capped at 20 rows, client-debounced. Accepted low-risk; revisit if abused.
- Per-user upload rate-limiting on /api/signal/media: size-capped + auth-gated, no
  throttle yet.
- Site-wide token contrast: ink-subtle (#6B6B7D) fails AA for body text;
  signal-danger misses AAA. Whole-app design-system pass, decide with owner.
- Public full-board view caps at 1000 players (Supabase default). Page with
  .range() if a board ever exceeds that.
- Phase 12 follow-ups (unrelated to Signal): real commissioner detection, edge
  runtime for OG, Geist woff2 in OG cards, toast-style refresh feedback.

## Verification gate (every session)

`npm run typecheck` then `npm run build`. Lint is not configured. No em-dashes /
AI-tell punctuation anywhere (CLAUDE.md rule 6). One shell command per tool call.
Apply schema via MCP AND save the SQL to supabase/migrations; regenerate
lib/database.types.ts after any DDL that changes columns/tables. Commit to main,
do not push until the session is complete. Close with the three sub-agent reviews
(implementation, accessibility, security).
