# Handoff: Signal Phase 4 sub-phases (a) + (b) complete

Phase 4 of Signal is being built in six sub-phases. THIS session shipped (a) text
posts + moderation and (b) post images. (c) through (f) are NOT started. Read
CLAUDE.md and the "Signal - Phase 4" sections of progress.md before continuing.

Commits on `main` (NOT pushed):
- 90f4634 Phase 4a Wall text posts + polymorphic moderation
- b43e7d1 Phase 4b post images with required alt text
- 4537173 Phase 4 review fixes (a11y focus + tap targets + alt counter)

`.claude/settings.local.json` is intentionally NOT committed.

## Approved architecture decisions (carry these forward)

1. DYNAMIC WALL. The public Wall is NOT folded into the cached signal:{handle}
   bundle. /u/[handle] is `export const dynamic = "force-dynamic"`; the identity
   bundle keeps its unstable_cache data cache; the Wall reads live via
   lib/signal-wall.ts loadWallPosts (admin client, explicit live-gating). This is
   deliberate so (c) comments + (f) reactions, written by arbitrary signed-in
   users, never bust the owner's whole profile cache. Keep the Wall dynamic.
2. POLYMORPHIC REPORTS. signal_reports(target_type in ('post','comment'),
   target_id, ...) replaced the empty signal_post_reports (migration 0070). One
   report endpoint (/api/signal/report) and one admin queue (/admin/signal/reports)
   cover both targets. The endpoint currently rejects target_type='comment' with a
   400; sub-phase (c) flips that on and reuses everything else.
3. POSTS = up to 4 images OR (sub-phase d) 1 GIF, mutually exclusive. COMMENTS =
   text + 1 GIF, NO image uploads. Comment body 1..1000, max 2 links.
4. CODE-POINT body cap with a grapheme-aware DISPLAY counter (lib/signal.ts
   codePointLength gates submit; graphemeLength is the friendly counter). Stated
   honestly in composer helper text. Reuse the same approach for comments.

## What shipped in (a) + (b)

DB (migrations + RLS verified via rolled-back anon/auth sims):
- 0070 signal_reports (polymorphic) + AFTER DELETE trigger
  signal_reports_dismiss_on_post_delete (auto-dismisses a deleted post's open
  reports; no FK cascade because polymorphic). signal_post_reports dropped.
- 0071 signal_post_images (alt_text CHECK 1..420, width/height > 0, ordinal 0..3
  unique per post = structural 4-image cap, join-gated RLS through post + signals).

Code:
- lib/signal.ts: POST_BODY_MAX/POST_LINKS_MAX + codePointLength/countLinks/
  graphemeLength.
- lib/signal-wall.ts: loadWallPosts (+ loadImagesForPosts), WallPost/WallImage.
- lib/signal/image-sniff.ts: shared magic-byte sniff (media route now imports it).
- app/my-beacon/signal/wall-actions.ts: createPost/updatePost/deletePost/
  setPostPinned (owner, session client + owner RLS, trigger-error mapping). createPost
  takes images and validates path is inside the caller's own "<uid>/posts/" folder.
- /api/signal/post-image: hardened upload (sniff + sharp re-encode WebP, fit inside
  1600, metadata stripped), returns path + url + dims, writes NO DB row.
- /api/signal/report: same-origin + auth + per-reporter rate limit + target gating.
- app/my-beacon/signal/{wall-composer,wall-manager}.tsx, components/signal/
  {wall,post-body,post-images,report-button}.tsx, components/admin/report-queue.tsx,
  app/admin/signal/{page,actions,reports}.
- Wall wired into /u/[handle] (public) and /my-beacon/signal (owner editor).

## Carryover / known deferred (do these where noted)

- IMAGES-XOR-GIF GUARD ships in sub-phase (d) migration 0073, BOTH directions.
  Spec is in the 0071 header: (1) image-insert side = BEFORE INSERT trigger on
  signal_post_images rejecting insert when the parent post has gif IS NOT NULL;
  (2) gif-set side = BEFORE UPDATE guard on signal_posts rejecting a gif set when
  the post already has signal_post_images rows. Do not forget direction (1).
- Editing a post's images is not supported (delete + repost). Add if desired.
- Report endpoint rate-limit is check-then-insert (TOCTOU). Low stakes given the
  unique(target_type,target_id,reporter) constraint. Tighten with an atomic claim
  if abused (see lib try_claim_league_refresh pattern).
- No per-user throttle on /api/signal/post-image and no orphan-object reaper
  (uploaded-but-never-attached WebPs). Same posture as the existing /api/signal/media
  route. Add a light per-user upload window + a reaper before heavy launch.

## Remaining sub-phases (build in this order; one fresh session each is safest)

(c) COMMENTS. New migration: signal_comments (post_id FK cascade, author_user_id
    references auth.users, body 1..1000, gif jsonb added in d, hidden* moderation
    columns service-role-only via column grants, created_at forced now(),
    per-author rate-limit BEFORE INSERT/UPDATE trigger 15s/10h/40d counting hidden,
    link cap 2 on insert AND update). RLS: public read gated through post + signal
    live; author read/insert/update/delete own (non-moderation cols); owner-of-Wall
    read own-wall comments any state. Comments-side dangling-report trigger
    (mirror signal_reports_dismiss_on_post_delete for 'comment'). Moderation:
    author hard-deletes own; Wall owner OR admin soft-hide via a moderateComment
    server action that re-validates "owner of parent signal OR admin" then writes
    hidden* with the admin client (do NOT try to express owner moderation in RLS).
    Flip the report endpoint to accept target_type='comment'. Comment composer +
    list under each post; reuse PostBody.

(d) TENOR GIFs in post + comment composers. TENOR_API_KEY server-only. Proxy route
    /api/signal/gif/search (contentfilter=high LOCKED server-side, media_filter to
    limit payload). Store gif jsonb {tenor_id, url, preview_url, alt, width, height}
    on signal_posts AND signal_comments with a function-backed shape CHECK (mirror
    signals_links_valid in 0069). Migration 0073 also adds BOTH images-xor-gif
    guards (see carryover). Render: static preview by default, explicit play
    control, NEVER autoplay, respect prefers-reduced-motion (we have hit this with
    the branded loader before). Alt from Tenor content_description. "GIF via Tenor"
    attribution. Picker fully keyboard operable, results labeled.

(e) INLINE EMOJI picker in both composers. Self-hosted emoji set (no external CDN).
    Inserts characters at the textarea cursor, no new storage. Distinct from
    reactions. Body cap stays code-point based (already wired). Keyboard operable,
    trigger labeled.

(f) CUSTOM REACTIONS + admin catalog. Migrations: 0074 signal_reaction_types
    (admin catalog: slug, label required, kind image|text, char or image_path,
    display_order, is_active; public SELECT incl disabled for labeling historical
    counts; service_role writes). 0075 signal_reactions (polymorphic target,
    unique(target_type,target_id,reaction_type_id,user_id) so a user cannot apply
    the same type twice) + signal_reaction_counts (denormalized, AFTER INSERT/DELETE
    SECURITY DEFINER trigger, mirrors follower_count). New PUBLIC bucket
    signal-reaction-emojis (admin-only writes, static only, sharp animated:false,
    small cap). Admin catalog UI under /admin/signal (the index already anticipates
    it). Reaction picker on posts + comments: keyboard operable, each reaction
    announced by its label, image reactions MUST carry accessible text. Disabling a
    type hides it from the picker but keeps historical counts shown + labeled
    (FK on delete restrict prevents deleting a type with history).

## Verification gate (every session)

`npm run typecheck` then `npm run build`. Lint is not configured. No em-dashes /
AI-tell punctuation anywhere (CLAUDE.md rule 6); plain ASCII. One shell command per
tool call (no && chaining). Apply schema via MCP AND save SQL to
supabase/migrations; regenerate lib/database.types.ts after any DDL (the generator
output is JSON-wrapped and too large to read inline: extract .types with node,
write the file, then `npx prettier --write`). Run anon/auth RLS verification for
EVERY new table (rolled-back DO block with set local role + request.jwt.claims).
Commit to main, do not push. Close with the three sub-agent reviews.
