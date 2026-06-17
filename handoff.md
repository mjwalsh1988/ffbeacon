# Handoff: Signal Phase 8 COMPLETE (following) - SIGNAL BUILD COMPLETE

Phase 8 (following) is shipped and fully reviewed. With it, the entire Signal
creator-profile feature (Phases 0-8) is COMPLETE. The For You feed remains
intentionally DEFERRED: the follow graph that would power it is live, only the
feed UI is out of scope.

Read CLAUDE.md and the "Signal - Phase 8" + "SIGNAL BUILD COMPLETE" sections of
progress.md (T608-T611) before continuing.

Commits on `main` (NOT pushed), in order:
- 72c4184  feat(signal): Phase 8 following (follow button + count + list modal)
- (this session) Phase 8 sub-agent review fixes + progress/handoff

`.claude/settings.local.json` is intentionally NOT committed.

## What Phase 8 delivers

No migration: it wires UI to the EXISTING Phase 0 data layer (migration 0063):
the signal_follows graph (PK (follower, followee), CHECK follower <> followee, RLS
anon-none / authed-select-all / insert+delete-own where auth.uid()=follower /
service-all) and the denormalized signals.follower_count maintained by the
SECURITY DEFINER AFTER INSERT/DELETE trigger signal_follows_sync_count.

- Follow / unfollow on the public profile (root /{handle} and the /u 308 alias):
  aria-pressed toggle, signed-in non-owners only. Anonymous non-owners get a
  "Sign in to follow" link (never a broken button). The owner sees the count +
  list but no follow button (self-follow has no UI path and is blocked by the DB
  CHECK).
- Follower COUNT is public, read FRESH from the denormalized follower_count (never
  a live row count), so it is not baked into the cached profile bundle and a
  stranger's follow never busts the owner's cache.
- Follower / following LIST is AUTHENTICATED-ONLY (anon sees the count, not the
  list), surfaced in a focus-trapped modal dialog opened from the count. It
  returns only LIVE public profiles, so a private/draft handle is never exposed
  through the graph. Capped at 100, recency-ordered.
- Writes go through session-gated server actions; follower_user_id is ALWAYS the
  authenticated user (never client-supplied). Idempotent toggle; light best-effort
  in-memory throttle (durable state is bounded by the PK regardless). NO profile-
  cache bust; the client repaints with router.refresh() (Wall-reactions decision).

## Key files (Phase 8)

- lib/signal-follow.ts: loadFollowState(profileUserId, viewerUserId) - fresh count
  + the viewer's own follow row (admin client, fed the session-resolved viewer id).
- app/u/[handle]/follow-actions.ts: followProfile / unfollowProfile / loadFollowList
  server actions.
- components/signal/follow-control.tsx: public count + Follow/Unfollow toggle +
  list trigger + sign-in link.
- components/signal/follow-list-modal.tsx: authed-only follower/following dialog
  (mobile-menu focus-trap model, two aria-pressed tabs, request-sequence guard).
- components/signal/profile-view.tsx: threads loadFollowState into the header on
  BOTH the live path and the owner-preview path.

## Review (three sub-agents over f1e16cf..72c4184, security primary)

All three PASS, zero blockers/important.
- Security: PASS. Ownership anchored to the session, no impersonation, no raw
  error leak, list session-gated + live-only, no cache-bust abuse, no XSS/secret/
  redirect/SSRF. MINOR: follow-bombing distinct users is only soft-throttled
  (accepted; durable cap belongs with the deferred For You feed).
- Implementation: PASS. Fresh count, idempotent toggle, scoped unfollow,
  request-sequence guard, reaction-bar parity, both viewer paths wired, types
  unchanged. MINOR (optimistic count) + 2 NITs.
- Accessibility: PASS. aria-pressed label-in-name toggle, aria-busy over disabled,
  single polite + single assertive region (no nested role=alert), full focus-trap
  dialog, 44px targets, AAA/AA contrast, no data hidden at any breakpoint.
- Fixes applied: dropped the optimistic "+1" from the success announcement (now
  announces the action only; the count button is authoritative after refresh);
  bumped the modal tab buttons to a full 44px.

## RLS + trigger verification (Phase 8, via MCP, against real users)

owner 5d99293a "mjwalsh" (count 0), other dbdeffcf:
- trigger INCREMENT 0 -> 1 on insert; DECREMENT 1 -> 0 on delete.
- self-follow blocked (CHECK 23514) even for the owner.
- follow-on-behalf-of blocked (RLS 42501) when follower_user_id != the caller.
- legit own follow ALLOWED under RLS with_check.
- anon SELECT on signal_follows returns 0 rows even with a row present (list is
  authenticated-only).
- DB left clean (0 follow rows, count 0).

## Verification gate (every session)

`npm run typecheck` then `npm run build`. The build runs the prebuild collision
guard (scripts/check-reserved-routes.ts) automatically. Lint is not configured.
No em-dashes / AI-tell punctuation (CLAUDE.md rule 6); plain ASCII. One shell
command per tool call (no && chaining). Schema via MCP + saved migration + types
regen + anon/auth RLS verification (Phase 8 added NO migration; no types regen).
Commit to main, do not push.

## Carry-forwards

1. GIPHY PRODUCTION KEY: still on a GIPHY BETA key. Apply for a production key
   before public launch. The "Powered by GIPHY" attribution is built in.
2. LIVE-PROFILE MANUAL TEST (from Phase 7, still pending): the dev signals table
   has had no published+public profile, so the following flow, the root-canonical
   casing/handle-history redirects, and the OG cards have only been exercised via
   RLS/trigger simulation and route-level checks, not against a real live profile
   end to end. When a published profile exists, manually verify:
   - follow/unfollow toggles aria-pressed + the count updates after refresh;
   - the follower/following modal lists live profiles and traps focus;
   - anon sees the count but not the list, and gets the sign-in link;
   - the owner sees no follow button on their own profile;
   - /u/{handle} -> 308 -> /{handle}; casing + historical handles redirect to root.

## Possible later enhancements (NOT built)

- For You feed (the follow graph is live; only the feed UI is deferred). When it
  ships, add a durable per-user follow cap (the current throttle is best-effort
  in-memory only) and revisit follow-bomb protection.
- Follower/following list pagination beyond the first 100 (recency-ordered today).

## Next milestone (unchanged)

News pipeline (RSS -> news_items, AI summary via Claude), vote matchups
(/vs/[a]-vs-[b]), weekly content cron, IndexNow + sitemap generation, AdSense
readiness sweep, and the Phase 12 follow-ups (real commissioner detection, edge
runtime for OG, Geist woff2 in OG cards, toast-style refresh feedback).
