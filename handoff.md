# Handoff: Signal Phase 4 sub-phases (a) + (b) + (c) complete

Phase 4 of Signal is being built in six sub-phases. Shipped so far: (a) text
posts + moderation, (b) post images, (c) comments. (d) through (f) are NOT
started. Read CLAUDE.md and the "Signal - Phase 4" sections of progress.md before
continuing.

Commits on `main` (NOT pushed):
- 90f4634 Phase 4a Wall text posts + polymorphic moderation
- b43e7d1 Phase 4b post images with required alt text
- 4537173 Phase 4 review fixes (a11y focus + tap targets + alt counter)
- (this session) Phase 4c comments (see latest "feat(signal): Phase 4c" commit)

`.claude/settings.local.json` is intentionally NOT committed.

## Approved architecture decisions (carry these forward)

1. DYNAMIC WALL. The public Wall is NOT folded into the cached signal:{handle}
   bundle. /u/[handle] is `export const dynamic = "force-dynamic"`; the identity
   bundle keeps its unstable_cache data cache; the Wall (posts AND comments) reads
   live via lib/signal-wall.ts (admin client, explicit live-gating). Comment
   writes (by arbitrary signed-in users) intentionally do NOT revalidate the
   profile bundle. Keep the Wall dynamic. The page now resolves the viewer
   (getUser + getIsAdmin) on BOTH the live and owner-preview paths so the comment
   composer + author edit/delete + owner/admin moderation controls render
   correctly; viewer identity never enters the cached bundle.
2. POLYMORPHIC REPORTS. signal_reports(target_type in ('post','comment'),
   target_id, ...). One report endpoint (/api/signal/report) and one admin queue
   (/admin/signal/reports) cover both targets. As of (c) the endpoint accepts
   target_type='comment' (with comment-specific live-gating) and the admin queue
   renders a post/comment discriminated union.
3. POSTS = up to 4 images OR (sub-phase d) 1 GIF, mutually exclusive. COMMENTS =
   text + 1 GIF (d), NO image uploads. Comment body 1..1000, max 2 links.
4. CODE-POINT body cap with a grapheme-aware DISPLAY counter (lib/signal.ts
   codePointLength gates submit; graphemeLength is the friendly counter). Same
   approach used for comments. Constants: POST_BODY_MAX/POST_LINKS_MAX (2000/3),
   COMMENT_BODY_MAX/COMMENT_LINKS_MAX (1000/2).

## What shipped in (c)

DB (migration 0072, RLS verified via rolled-back anon/auth sim, 10 checks):
- signal_comments (post_id FK cascade, author_user_id references auth.users, body
  1..1000, hidden* moderation columns service-role-only by column grant).
- Per-author BEFORE INSERT/UPDATE trigger: 15s/10h/40d counting hidden rows,
  created_at forced now(), link cap 2 on insert AND update, SECURITY DEFINER. It
  is a faithful port of the hardened posts trigger (0067) keyed on
  author_user_id, NOT signal_id.
- AFTER DELETE dangling-report trigger (signal_reports_dismiss_on_comment_delete)
  mirrors the posts-side trigger for target_type='comment'.
- RLS: public read gated through comment+post+signal live; author
  select/update/delete own (non-moderation cols only); wall-owner select any
  state.

Code:
- lib/signal.ts: COMMENT_BODY_MAX/COMMENT_LINKS_MAX.
- lib/signal-wall.ts: WallComment + loadCommentsForPosts (author identity from
  signals, live-only @handle link) + loadWallPosts now loads comments
  (includeHiddenComments param).
- app/u/[handle]/comment-actions.ts: createComment/updateComment/deleteComment
  (author, session client + author RLS) + moderateComment (owner-or-admin
  re-validate, then admin client writes hidden*; hide resolves open comment
  reports to actioned). The Wall is dynamic so NO profile-cache revalidation.
- components/signal/comment-section.tsx: composer + list + author edit/delete +
  owner/admin hide/restore + Report. NVDA-operable (labeled, describedby
  counters, aria-live, focus management, per-comment article aria-label, 44px,
  AA contrast via ink-muted).
- components/signal/wall.tsx + app/u/[handle]/page.tsx wired for viewer context;
  app/my-beacon/signal/page.tsx WallPost mapping gets comments:[] (owner editor
  manager is posts-only; owner moderates comments on the public Wall).
- app/api/signal/report/route.ts (comment target), components/admin/report-queue
  (union), app/admin/signal/reports/page.tsx (loads both targets), report-button
  (legend + aria-label by target type).

## Carryover / known deferred (do these where noted)

- IMAGES-XOR-GIF GUARD ships in sub-phase (d) migration 0073, BOTH directions.
  Spec is in the 0071 header: (1) image-insert side = BEFORE INSERT trigger on
  signal_post_images rejecting insert when the parent post has gif IS NOT NULL;
  (2) gif-set side = BEFORE UPDATE guard on signal_posts rejecting a gif set when
  the post already has signal_post_images rows. Do not forget direction (1).
- Editing a post's images is not supported (delete + repost). Comments have no
  image uploads (by design); comment edit is text-only (and, after d, GIF).
- Report endpoint rate-limit is check-then-insert (TOCTOU). Low stakes given the
  unique(target_type,target_id,reporter) constraint. Tighten with an atomic claim
  if abused (see lib try_claim_league_refresh pattern). Also the endpoint does not
  block self-reporting (the UI hides Report on your own content); pre-existing
  posts posture, capped by the unique constraint.
- hidden_reason has no DB length CHECK on signal_comments (or signal_posts). The
  moderate actions slice to 300 and the admin/owner inputs maxLength=300. Add a
  char_length CHECK on a future migration if you want a DB backstop.
- No per-user throttle on /api/signal/post-image and no orphan-object reaper
  (uploaded-but-never-attached WebPs). Same posture as /api/signal/media. Add a
  light per-user upload window + a reaper before heavy launch.
- The prior-shipped report-button trigger label and wall-composer counters still
  use ink-subtle (3.65-3.85:1, below AA for 12px normal). The (c) comment UI was
  moved to ink-muted; consider sweeping the older Signal composer/report-button
  counters to ink-muted (or darkening the ink-subtle token) for consistency.

## Remaining sub-phases (build in this order; one fresh session each is safest)

(d) TENOR GIFs in post + comment composers. TENOR_API_KEY server-only. Proxy
    route /api/signal/gif/search (contentfilter=high LOCKED server-side,
    media_filter to limit payload). Store gif jsonb {tenor_id, url, preview_url,
    alt, width, height} on signal_posts AND signal_comments with a function-backed
    shape CHECK (mirror signals_links_valid in 0069). Migration 0073 also adds
    BOTH images-xor-gif guards (see carryover). Render: static preview by default,
    explicit play control, NEVER autoplay, respect prefers-reduced-motion (we have
    hit this with the branded loader before). Alt from Tenor content_description.
    "GIF via Tenor" attribution. Picker fully keyboard operable, results labeled.

(e) INLINE EMOJI picker in both composers. Self-hosted emoji set (no external
    CDN). Inserts characters at the textarea cursor, no new storage. Distinct from
    reactions. Body cap stays code-point based (already wired). Keyboard operable,
    trigger labeled.

(f) CUSTOM REACTIONS + admin catalog. Migrations: 0074 signal_reaction_types
    (admin catalog: slug, label required, kind image|text, char or image_path,
    display_order, is_active; public SELECT incl disabled for labeling historical
    counts; service_role writes). 0075 signal_reactions (polymorphic target,
    unique(target_type,target_id,reaction_type_id,user_id) so a user cannot apply
    the same type twice) + signal_reaction_counts (denormalized, AFTER
    INSERT/DELETE SECURITY DEFINER trigger, mirrors follower_count). New PUBLIC
    bucket signal-reaction-emojis (admin-only writes, static only, sharp
    animated:false, small cap). Admin catalog UI under /admin/signal (the index
    already anticipates it). Reaction picker on posts + comments: keyboard
    operable, each reaction announced by its label, image reactions MUST carry
    accessible text. Disabling a type hides it from the picker but keeps
    historical counts shown + labeled (FK on delete restrict prevents deleting a
    type with history).

## Verification gate (every session)

`npm run typecheck` then `npm run build`. Lint is not configured. No em-dashes /
AI-tell punctuation anywhere (CLAUDE.md rule 6); plain ASCII. One shell command
per tool call (no && chaining). Apply schema via MCP AND save SQL to
supabase/migrations; regenerate lib/database.types.ts after any DDL (the generator
output is JSON-wrapped and too large to read inline: extract .types with node,
write the file, then `npx prettier --write`). Run anon/auth RLS verification for
EVERY new table (rolled-back DO block with set local role + request.jwt.claims;
note the per-author/per-signal rate triggers fire on seed within one transaction
because now() is the transaction timestamp, so disable the enforce triggers during
seeding and re-enable before the RLS tests, then CLEAN UP probe rows because MCP
execute_sql auto-commits). Commit to main, do not push. Close with the three
sub-agent reviews.
