# Handoff: Signal Phase 4 sub-phases (a)-(e) complete; only (f) remains

Phase 4 of Signal is being built in six sub-phases. Shipped: (a) text posts +
moderation, (b) post images, (c) comments, (d) GIFs via GIPHY, (e) inline emoji.
The ONLY remaining Phase 4 work is (f) custom reactions + admin catalog. Read
CLAUDE.md and the "Signal - Phase 4" sections of progress.md before continuing.

Commits on `main` (NOT pushed):
- 90f4634 Phase 4a Wall text posts + polymorphic moderation
- b43e7d1 Phase 4b post images with required alt text
- 4537173 Phase 4 review fixes (a11y focus + tap targets + alt counter)
- 796331b Phase 4c Wall comments + polymorphic comment moderation
- 1082abf Phase 4d GIFs via GIPHY (posts + comments, images-xor-gif)
- (this session) Phase 4e inline emoji (see latest "feat(signal): Phase 4e" commit)

`.claude/settings.local.json` is intentionally NOT committed.

## Carried-forward action items (do NOT lose these)

1. GIPHY PRODUCTION KEY (from d): we are on a GIPHY BETA key (`GIPHY_API_KEY` in
   .env.local, server-only). A PRODUCTION key must be applied for before public
   launch. The required "Powered by GIPHY" attribution is already built in (in the
   GIF picker near results AND on every rendered GIF) so we pass review. Treat that
   attribution as permanent UI, not chrome.
2. DOUBLE-ANNOUNCE a11y sweep (from c/d): the Signal composer suite uses an
   aria-live wrapper AND an inner role="alert" on its error regions, which can
   double-announce on some screen readers. It is consistent across wall-composer,
   comment-section, wall-manager, gif-picker, and (now) is NOT present in the new
   emoji-picker error-free flow. If you sweep it, do the WHOLE suite at once (keep
   the wrapper live region, drop the inner role="alert", or vice versa). Not started.

## Approved architecture decisions (carry these forward)

1. DYNAMIC WALL. The public Wall is NOT folded into the cached signal:{handle}
   bundle. /u/[handle] is `export const dynamic = "force-dynamic"`; the identity
   bundle keeps its unstable_cache data cache; the Wall (posts AND comments) reads
   live via lib/signal-wall.ts (admin client, explicit live-gating). Comment / GIF /
   emoji writes by arbitrary signed-in users do NOT revalidate the profile bundle
   (the mutations only router.refresh()). Owner POST writes still call
   revalidateProfileCaches. Keep the Wall dynamic.
2. POLYMORPHIC REPORTS. signal_reports(target_type in ('post','comment'), ...). One
   report endpoint (/api/signal/report) and one admin queue (/admin/signal/reports)
   cover both targets. (f) reactions are a SEPARATE system from reports.
3. POSTS = up to 4 images OR exactly 1 GIF, mutually exclusive (DB-enforced both
   directions, migration 0073). COMMENTS = text + optional 1 GIF, NO image uploads.
   Emoji are plain Unicode in the body text (sub-phase e), NOT reactions.
4. CODE-POINT body cap with a grapheme-aware DISPLAY counter (lib/signal.ts
   codePointLength gates submit; graphemeLength is the friendly counter). Inserted
   emoji are just body text counted the same way.

## What shipped in (e) - inline emoji

NO migration, NO storage, NO schema change (kept strictly distinct from f).
- lib/signal/emoji-data.ts: bundled curated emoji dataset by category (char + name).
  No external CDN, no runtime fetch, no new npm dependency. name doubles as the
  accessible label and search keyword.
- lib/signal/insert-at-cursor.ts: pure caret-insertion helper (replaces the active
  selection, returns the caret offset after the inserted text).
- components/signal/emoji-picker.tsx: NVDA-operable. Search box, category buttons
  (aria-pressed), roving-tabindex emoji group (role="group", COLUMNS=6 matches
  grid-cols-6; Arrow/Home/End move, Enter/Space inserts; each cell labeled by emoji
  name, glyph aria-hidden). Focus to search on open / textarea after insert /
  trigger on close; polite aria-live result count; 44px targets.
- Wired into the post composer (wall-composer.tsx), the comment composer, and the
  comment edit form (comment-section.tsx). Opening the emoji picker closes the GIF
  picker and vice versa (coherent toolbar). Submit still gates on codePointLength.

Three sub-agent reviews: security CLEAN, implementation CLEAN, accessibility one
IMPORTANT fixed (role="grid" -> role="group") + two minors.

## Remaining sub-phase (the ONLY remaining Phase 4 work)

(f) CUSTOM REACTIONS + admin catalog. This is a real schema + admin feature,
    distinct from inline emoji (e) and from reports.
    - Migration 0074 signal_reaction_types (admin catalog: slug, label required,
      kind image|text, char or image_path, display_order, is_active; public SELECT
      incl disabled rows so historical counts stay labeled; service_role writes).
    - Migration 0075 signal_reactions (polymorphic target_type post|comment +
      target_id, reaction_type_id, user_id; unique(target_type, target_id,
      reaction_type_id, user_id) so a user cannot apply the same type twice) +
      signal_reaction_counts (denormalized counts, AFTER INSERT/DELETE SECURITY
      DEFINER trigger, mirrors the follower_count pattern).
    - New PUBLIC bucket signal-reaction-emojis (admin-only writes, static images
      only, sharp animated:false, small size cap), for kind=image reactions.
    - Admin catalog UI under /admin/signal (the index already anticipates it).
    - Reaction picker + counts on posts AND comments: keyboard operable, each
      reaction announced by its label, image reactions MUST carry accessible text.
      Disabling a type hides it from the picker but keeps historical counts shown +
      labeled (FK on delete restrict prevents deleting a type that has history).
    - Reuse the established patterns: per-table RLS verified via a rolled-back DO
      block; denormalized counter via SECURITY DEFINER trigger (see follower_count
      0063 and the dangling-report triggers); admin actions behind requireAdmin +
      service role. The Wall stays dynamic; reaction writes router.refresh() and do
      NOT revalidate the profile bundle.

## Verification gate (every session)

`npm run typecheck` then `npm run build`. Lint is not configured. No em-dashes /
AI-tell punctuation anywhere (CLAUDE.md rule 6); plain ASCII. One shell command per
tool call (no && chaining). Apply schema via MCP AND save SQL to supabase/migrations;
regenerate lib/database.types.ts after any DDL (the generator output is JSON-wrapped
and too large to read inline: extract .types with node, write the file, then
`npx prettier --write`). Run anon/auth RLS verification for EVERY new table (rolled-
back DO block with set local role + request.jwt.claims; seed one row per signal/
author or disable enforce triggers to dodge the rate triggers because now() is the
transaction timestamp; raise at the end to roll back, or CLEAN UP probe rows because
MCP execute_sql auto-commits). Commit to main, do not push. Close with the three
sub-agent reviews.
