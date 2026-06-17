# Handoff: Signal Phase 7 COMPLETE (root /{handle} canonical alias)

Phase 7 is shipped and fully reviewed. A Signal profile now reads as a standalone
website: the public-facing canonical URL is ffbeacon.com/{handle}. The old
/u/{handle} paths are kept forever as permanent 308 redirects. This was purely a
routing/URL layer: the public render, RLS gating, layouts, and Wall are untouched
(the render was relocated verbatim into shared components).

Read CLAUDE.md and the "Signal - Phase 7" section of progress.md (T604-T607)
before continuing.

Commits on `main` (NOT pushed), in order:
- 57bb6ea  7.A reserve route segments + build-time collision guard
- bec2bb6  7.B root /{handle} alias via shared render (additive)
- df86b16  7.C flip canonical to root + 308 /u shims
- (this session) review fixes (handle hint + em-dash) + progress/handoff

`.claude/settings.local.json` is intentionally NOT committed.

## What Phase 7 delivers

RESOLUTION MECHANISM: a root dynamic segment, NOT a middleware rewrite.
- app/[handle]/page.tsx and app/[handle]/rankings/[boardId]/page.tsx are thin
  wrappers: they normalize the handle, reject it via validateHandleFormat (non-
  handle / dotted / file-like paths) and isReservedRouteSegment (defense in
  depth), then delegate to the shared render. Middleware (middleware.ts) was NOT
  touched: it still only does the OAuth ?code= forward + updateSession.
- WHY this is safe from shadowing: Next.js route precedence. Every literal
  top-level route with a page (/rankings, /about, /tools, /guides, /join,
  /login, /my-beacon, /privacy, /terms, /admin, ...) is matched by its own
  folder and never reaches [handle]. Folders with ONLY dynamic children and no
  index page (/players -> players/[slug], /leagues -> leagues/[league_id], /u,
  /auth, /api, /author, /actions) DO fall through to [handle]; every one of
  those names is reserved, so the route returns a noindex not-found, never a
  profile. This is exactly why the collision guard reserves EVERY top-level
  folder, not just ones with a page.

SHARED RENDER (byte-identical /u and root):
- components/signal/profile-view.tsx exports buildProfileMetadata(handle,
  {canonicalBase}) + async <ProfileView rawHandle canonicalBase>. It is a
  verbatim relocation of the old app/u/[handle]/page.tsx body.
- components/signal/board-view.tsx exports buildBoardMetadata + <BoardView>,
  a verbatim relocation of the old board page.
- canonicalBase is the ONLY behavioral parameter. It prefixes the canonical
  <link>, the casing 301 target, the handle-history 301 target, and (board view)
  the back-to-profile links. Root passes "" (canonical). The historical "/u"
  value is no longer passed by any route (the /u pages were deleted).

COLLISION SAFETY (single source of truth + build guard):
- lib/signal/reserved-routes.ts RESERVED_ROUTE_SEGMENTS is the canonical list of
  the 17 top-level route segments + isReservedRouteSegment() for the runtime
  resolver.
- Migration 0076 seeded the 5 that were missing from the 0059 seed (players,
  guides, join, auth, actions) into signal_reserved_handles (the table the 0068
  claim-time trigger enforces). Data-only INSERT, types unchanged.
- scripts/check-reserved-routes.ts runs as `prebuild`, so `npm run build` FAILS
  if (leg 1, always) any top-level app/ folder is missing from
  RESERVED_ROUTE_SEGMENTS, or (leg 2, when Supabase creds present) any constant
  entry is missing from signal_reserved_handles. Adding app/blog/ later cannot
  ship until 'blog' is added to the constant AND seeded.

CANONICAL + REDIRECTS:
- Root /{handle} is canonical. generateMetadata canonical, OG url, sitemap, and
  every internal link point at root.
- /u/{handle} and /u/{handle}/rankings/{boardId} are permanent 308 redirects to
  root, defined in next.config.ts redirects() (NOT a page shim). A streamed page
  component's permanentRedirect emits a soft 200 + meta-refresh, which would
  weaken the canonical signal, so the config-level redirect (real 308, runs
  before routing) is the correct mechanism. permanent:true (308) matches the
  existing /tools/league-sync redirect convention; SEO-equivalent to 301.

## Key files

- app/[handle]/page.tsx, app/[handle]/rankings/[boardId]/page.tsx: root wrappers
  (format + reserved gate, delegate to shared view, canonicalBase "").
- components/signal/profile-view.tsx, components/signal/board-view.tsx: the
  shared renders (verbatim relocation + canonicalBase).
- lib/signal/reserved-routes.ts: RESERVED_ROUTE_SEGMENTS + isReservedRouteSegment.
- scripts/check-reserved-routes.ts: prebuild collision guard.
- supabase/migrations/0076_signal_reserve_route_segments.sql: reserved seed.
- next.config.ts: the two /u -> root 308 redirects.
- app/u/[handle]/: now holds ONLY comment-actions.ts + reaction-actions.ts (Wall
  server actions, still imported by components). The page files were deleted.
- Flipped to root: app/sitemap.ts, components/signal/signal-block.tsx,
  components/signal/comment-section.tsx, app/my-beacon/signal/page.tsx,
  app/my-beacon/signal/publish-controls.tsx, app/my-beacon/signal/handle-manager.tsx.

## Review (three sub-agents over 2c0d2e6..df86b16, security primary)

- Security: PASS, no blockers/important. Route-collision defense, preserved RLS
  gating (verbatim extraction), no open redirect, 0076 data-only, safe catch-all
  input handling, no secret/XSS/CSRF/IDOR. One pre-existing em-dash noted.
- Implementation: PASS. Byte-identical relocation, canonicalBase correct (no
  double slash), guard + constant + prebuild + 0076 all correct, no dead code
  beyond the kept action files.
- Accessibility: one IMPORTANT fixed. Render a11y structure byte-identical; no
  new interactive elements; no data hidden at any breakpoint.
- Fixes applied: handle-manager.tsx:109 hint /u/your-handle -> /your-handle
  (static string the /u/ grep missed); next.config.ts:14 em-dash -> comma.

## Verification gate (every session)

`npm run typecheck` then `npm run build`. The build runs the prebuild collision
guard automatically. Lint is not configured. No em-dashes / AI-tell punctuation
(CLAUDE.md rule 6); plain ASCII. One shell command per tool call (no && chaining).
Schema via MCP + saved migration + types regen + anon/auth RLS verification (this
phase: one data-only seed, no DDL, so types unchanged). Commit to main, do not push.

## Known characteristics (pre-existing, documented, not bugs)

1. Nonexistent root handles and the /players,/leagues fall-throughs render the
   not-found UI with HTTP 200 (soft 404), the same force-dynamic behavior
   /u/[handle] and /leagues/[league_id] already had. robots noindex,nofollow is
   applied, so there is no index leak. If a hard 404 status is wanted later, it
   would need a non-streaming approach (out of Phase 7 scope).
2. The in-page casing + handle-history redirects at root keep Phase 1's soft
   (200 + meta-refresh) redirect behavior because they fire mid-stream in a
   force-dynamic page. The canonical <link> still points at the correct root URL,
   so SEO is preserved. Only the new /u migration uses a hard 308 (config).
   Could not be exercised live in dev (signals table is empty: no published
   profile to trigger a casing/history redirect); the logic is a verbatim port
   of the Phase 1 code with canonicalBase "".

## Carry-forwards (unchanged)

1. GIPHY PRODUCTION KEY: still on a GIPHY BETA key. Apply for a production key
   before public launch. The "Powered by GIPHY" attribution is built in.

## How to verify Phase 7 live (when a published profile exists)

Run `npm run build` then `PORT=3100 npm run start` and check:
- /u/{handle} -> 308 -> /{handle}; /u/{handle}/rankings/{boardId} -> 308 -> root.
- /{handle} canonical <link> is the root URL; OG image still /api/og/signal/...
- /u/{Mixed} and a historical handle redirect to the canonical root handle.
- /rankings, /players, /about, /tools, /sitemap.xml all 200 and serve real pages.
- /?code=test still 307 -> /auth/callback.
- A reserved-but-pageless path (/players, /leagues) renders noindex not-found.

## Next milestone (unchanged)

News pipeline, vote matchups, weekly content cron, IndexNow + sitemap, AdSense
readiness, and the Phase 12 follow-ups (real commissioner detection, edge runtime
for OG, Geist woff2 in OG cards, toast-style refresh feedback).
