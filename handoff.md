# Handoff: Signal Phase 4 sub-phases (a) + (b) + (c) + (d) complete

Phase 4 of Signal is being built in six sub-phases. Shipped so far: (a) text
posts + moderation, (b) post images, (c) comments, (d) GIFs via GIPHY. (e) and (f)
are NOT started. Read CLAUDE.md and the "Signal - Phase 4" sections of progress.md
before continuing.

Commits on `main` (NOT pushed):
- 90f4634 Phase 4a Wall text posts + polymorphic moderation
- b43e7d1 Phase 4b post images with required alt text
- 4537173 Phase 4 review fixes (a11y focus + tap targets + alt counter)
- 796331b Phase 4c Wall comments + polymorphic comment moderation
- (this session) Phase 4d GIFs via GIPHY (see latest "feat(signal): Phase 4d" commit)

`.claude/settings.local.json` is intentionally NOT committed.

## PROVIDER CHANGE recorded in (d): Tenor -> GIPHY

The original handoff named Tenor for GIFs. Tenor is discontinued (closed to new
API clients as of Jan 2026, service ends June 30 2026), so (d) was built on GIPHY.
Everything else about the sub-phase held; only the provider changed.

GIPHY KEY STATUS (action item before public launch): we are on a GIPHY BETA key
(`GIPHY_API_KEY` in .env.local, server-only). A PRODUCTION key must be applied for
before public launch. The required "Powered by GIPHY" attribution is already built
in (in the picker near results AND on every rendered GIF) specifically so we pass
GIPHY's production-key review. Treat that attribution as permanent UI, not chrome.

## Approved architecture decisions (carry these forward)

1. DYNAMIC WALL. The public Wall is NOT folded into the cached signal:{handle}
   bundle. /u/[handle] is `export const dynamic = "force-dynamic"`; the identity
   bundle keeps its unstable_cache data cache; the Wall (posts AND comments) reads
   live via lib/signal-wall.ts (admin client, explicit live-gating). Comment and
   GIF writes by arbitrary signed-in users do NOT revalidate the profile bundle
   (the mutations only router.refresh()). Owner POST writes still call
   revalidateProfileCaches. Keep the Wall dynamic.
2. POLYMORPHIC REPORTS. signal_reports(target_type in ('post','comment'), ...). One
   report endpoint (/api/signal/report) and one admin queue (/admin/signal/reports)
   cover both targets.
3. POSTS = up to 4 images OR exactly 1 GIF, mutually exclusive (enforced at the DB
   in BOTH directions by migration 0073 triggers, plus an app-layer friendly-copy
   guard in createPost). COMMENTS = text + optional 1 GIF, NO image uploads. Comment
   body 1..1000, max 2 links; post body 1..2000, max 3 links.
4. CODE-POINT body cap with a grapheme-aware DISPLAY counter (lib/signal.ts
   codePointLength gates submit; graphemeLength is the friendly counter).

## What shipped in (d) - GIFs via GIPHY

DB (migration 0073, RLS/guards verified via rolled-back DO block, 8 checks):
- gif jsonb (nullable) on signal_posts AND signal_comments, shaped
  { giphy_id, url, preview_url, alt, width, height } and guarded by the
  function-backed signal_gif_valid CHECK (mirrors signal_links_valid in 0069). alt
  is REQUIRED non-empty (1..420): a GIF is never stored without accessible text.
  urls are https-only; dims 1..10000.
- IMAGES-XOR-GIF in BOTH directions:
  * Direction A (set gif on a post with images): BEFORE INSERT OR UPDATE trigger on
    signal_posts -> signal_posts_block_gif_when_images.
  * Direction B (insert image into a post with a gif): BEFORE INSERT trigger on
    signal_post_images -> signal_post_images_block_when_gif.
  Both SECURITY DEFINER, EXECUTE revoked from anon/auth/public.
- Column grants: insert(gif) on signal_posts; insert(gif)+update(gif) on
  signal_comments (posts set gif at create only; comments can change/remove on edit).

Code:
- lib/signal.ts: SignalGifInput, GIF_ALT_MAX, validateGifInput (write-time validation
  mirroring the DB CHECK).
- lib/signal/giphy.ts: normalizeGiphySearch. url = animated rendition, preview_url =
  STATIC still, PAIRED from the same rendition family so stored dims match the still.
  alt = alt_text else title else "". The raw GIPHY payload never reaches the client.
- app/api/signal/gif/search/route.ts: GIPHY_API_KEY server-only; rating=g LOCKED
  server-side; same-origin + session gate; in-memory per-user throttle (best-effort,
  with eviction); offset paging capped at 200; 8s timeout; search-on-query only (no
  trending endpoint, which would need a client-side call).
- components/signal/animated-gif.tsx: static preview by default for everyone
  (honors prefers-reduced-motion), explicit labeled play/pause (aria-pressed, never
  autoplay), alt always present, visible + SR "Powered by GIPHY" on every GIF.
- components/signal/gif-picker.tsx: NVDA-operable. Search-on-query (debounced),
  labeled search box, result buttons labeled by description, aria-live status, focus
  to search on open / textarea on insert / trigger on close, optional alt field
  (required when empty, pre-filled from GIPHY), "Powered by GIPHY", offset paging.
- lib/signal-wall.ts: WallGif (+giphyId so an edit re-sends an unchanged gif),
  parseWallGif read-path guard, gif on WallPost/WallComment selects + maps.
- app/my-beacon/signal/wall-actions.ts: createPost takes gif (images-XOR-gif app
  guard); app/u/[handle]/comment-actions.ts: createComment/updateComment take gif.
- WallComposer + comment Composer + comment edit get the picker; AnimatedGif renders
  in wall.tsx, comment-section, wall-manager, and the owner editor page mapping.

## Carryover / known deferred

- GIPHY PRODUCTION KEY: apply before public launch (attribution already in place).
- Pre-existing suite-wide a11y pattern (NOT changed in (d) to avoid divergence): the
  error region uses an aria-live wrapper AND an inner role="alert", which can
  double-announce on some screen readers. It is consistent across the whole Signal
  composer suite (wall-composer, comment-section, wall-manager, gif-picker). If you
  sweep it, do the whole suite at once (keep the wrapper live region, drop the inner
  role="alert", or vice versa).
- Editing a post's images is still not supported (delete + repost). A post's gif is
  likewise creation-time only (no post-gif edit); comment gifs ARE editable.
- GIF orphan handling: a GIF is stored by reference (GIPHY URL), so there is no
  uploaded object to reap (unlike post images). No reaper needed for GIFs.
- The GIF route throttle is in-memory per instance (best-effort); the client also
  debounces. If abused, move to a DB ledger like /api/signal/report.
- Report-endpoint rate-limit TOCTOU, hidden_reason length CHECK, and the per-user
  image-upload throttle / orphan reaper are still the same deferred items from (a)-(c).

## Remaining sub-phases (build in this order; one fresh session each is safest)

(e) INLINE EMOJI picker in both composers. Self-hosted emoji set (no external CDN).
    Inserts characters at the textarea cursor, no new storage. Distinct from
    reactions. Body cap stays code-point based (already wired). Keyboard operable,
    trigger labeled. NOTE: this inserts into the SAME textareas the GIF picker sits
    beside; keep the composer toolbar (Add image / Add GIF / Add emoji) coherent and
    keyboard-navigable, and the emoji picker must not fight the GIF picker for the
    open/close + focus-return contract already established in (d).

(f) CUSTOM REACTIONS + admin catalog. Migrations: 0074 signal_reaction_types
    (admin catalog: slug, label required, kind image|text, char or image_path,
    display_order, is_active; public SELECT incl disabled for labeling historical
    counts; service_role writes). 0075 signal_reactions (polymorphic target,
    unique(target_type,target_id,reaction_type_id,user_id)) + signal_reaction_counts
    (denormalized, AFTER INSERT/DELETE SECURITY DEFINER trigger, mirrors
    follower_count). New PUBLIC bucket signal-reaction-emojis (admin-only writes,
    static only, sharp animated:false, small cap). Admin catalog UI under
    /admin/signal. Reaction picker on posts + comments: keyboard operable, each
    reaction announced by its label, image reactions MUST carry accessible text.
    Disabling a type hides it from the picker but keeps historical counts shown +
    labeled (FK on delete restrict prevents deleting a type with history).

## Verification gate (every session)

`npm run typecheck` then `npm run build`. Lint is not configured. No em-dashes /
AI-tell punctuation anywhere (CLAUDE.md rule 6); plain ASCII. One shell command per
tool call (no && chaining). Apply schema via MCP AND save SQL to supabase/migrations;
regenerate lib/database.types.ts after any DDL (the generator output is JSON-wrapped
and too large to read inline: extract .types with node, write the file, then
`npx prettier --write`). Run anon/auth RLS verification for EVERY new table (rolled-
back DO block with set local role + request.jwt.claims; disable enforce triggers
during seeding or seed one row per signal/author to dodge the rate triggers because
now() is the transaction timestamp; raise at the end to roll back, or CLEAN UP probe
rows because MCP execute_sql auto-commits). Commit to main, do not push. Close with
the three sub-agent reviews.
