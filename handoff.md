# Handoff: Signal Phase 4f COMMIT 1 done; COMMIT 2 (public picker + counts) pending

Phase 4 of Signal is being built in six sub-phases. Shipped: (a) text posts +
moderation, (b) post images, (c) comments, (d) GIFs via GIPHY, (e) inline emoji,
and now (f) custom reactions + admin catalog COMMIT 1 (data layer + admin catalog).
The ONLY remaining Phase 4 work is (f) COMMIT 2: the public reaction picker +
counts on posts and comments. Read CLAUDE.md and the "Signal - Phase 4f" sections
of progress.md before continuing.

Commits on `main` (NOT pushed):
- 90f4634 Phase 4a Wall text posts + polymorphic moderation
- b43e7d1 Phase 4b post images with required alt text
- 4537173 Phase 4 review fixes (a11y focus + tap targets + alt counter)
- 796331b Phase 4c Wall comments + polymorphic comment moderation
- 1082abf Phase 4d GIFs via GIPHY (posts + comments, images-xor-gif)
- deea896 Phase 4e inline emoji in post + comment composers
- (this session) Phase 4f COMMIT 1 custom reactions data layer + admin catalog

`.claude/settings.local.json` is intentionally NOT committed.

## Carried-forward action items (do NOT lose these)

1. GIPHY PRODUCTION KEY (from d): we are on a GIPHY BETA key (`GIPHY_API_KEY` in
   .env.local, server-only). A PRODUCTION key must be applied for before public
   launch. The required "Powered by GIPHY" attribution is already built in (in the
   GIF picker near results AND on every rendered GIF) so we pass review. Treat that
   attribution as permanent UI, not chrome.
2. DOUBLE-ANNOUNCE a11y sweep (from c/d): the Signal composer suite uses an
   aria-live wrapper AND an inner role="alert" on its error regions, which can
   double-announce on some screen readers. If you sweep it, do the WHOLE suite at
   once (keep the wrapper live region, drop the inner role="alert", or vice versa).
   Not started. Do NOT do it piecemeal.
3. SUITE-WIDE admin a11y polish (new, from 4f COMMIT 1 review, deferred on purpose):
   the admin switch (components/admin/sources-manager.tsx AND the new
   reactions-manager.tsx) uses a 28px-tall role="switch" hit area and a single-string
   aria-live region. These are the established, already-reviewed admin pattern. If you
   want strict 44px switches and a re-announcing (nonce/queue) live region, do it as
   ONE deliberate admin-suite pass across sources-manager + reactions-manager, not by
   diverging a single component.

## What shipped in (f) COMMIT 1 - data layer + admin catalog

Migrations 0074 + 0075 (applied via MCP, saved to supabase/migrations, types
regenerated). RLS verified for all three new tables via a rolled-back DO block
(15 checks + a focused counts-gate check, all PASS, zero probe-row leakage).

- 0074 signal_reaction_types: admin-managed catalog. slug unique (lowercase kebab
  1..40), label required 1..60, kind image|text, char (1..32 when text), image_path
  (1..400, ^reactions/<uuid>.webp$ when image), display_order, is_active, timestamps;
  payload-matches-kind CHECK enforces the char/image_path xor. RLS: public SELECT
  incl disabled rows (historical counts stay labeled) + service_role ALL, NO client
  write path. New PUBLIC bucket signal-reaction-emojis (image/webp only, 256 KB cap,
  no LIST policy; service-role writes only).
- 0075 signal_reactions + signal_reaction_counts + count trigger +
  signal_target_publicly_viewable helper. reactions: unique(target_type,target_id,
  reaction_type_id,user_id); reaction_type_id ON DELETE RESTRICT (used types must be
  disabled, not deleted); user_id cascade. counts: PK (target_type,target_id,
  reaction_type_id); reaction_type_id ON DELETE CASCADE (zeroed-row cleanup). AFTER
  INSERT/DELETE SECURITY DEFINER trigger upserts count +1 / floored -1 (mirrors
  follower_count 0063). RLS: reactions authenticated SELECT (own OR target publicly
  viewable), INSERT own (target publicly viewable AND reaction type is_active),
  DELETE own, NO UPDATE, service_role ALL; counts public SELECT GATED on
  signal_target_publicly_viewable (so hidden/draft/private engagement metadata never
  leaks), service_role ALL. The helper is SECURITY DEFINER, search_path pinned,
  STABLE, EXECUTE granted to anon/authenticated/service_role (required for RLS use).
- Admin upload route POST /api/admin/signal/reaction-emoji: same-origin + getIsAdmin
  + Content-Length ceiling + size cap + magic-byte sniff (reuses lib/signal/image-
  sniff) + sharp animated:false STATIC re-encode to WebP (<=256x256, metadata
  stripped, quality step-down to ~100 KB) + service-role upload. Writes NO DB row.
- lib/signal/reactions.ts: isomorphic helper (ReactionType type, reactionImageUrl,
  validateReactionType, the slug/label/char/image_path validators).
- Admin catalog at /admin/signal/reactions (requireAdmin), linked from the
  /admin/signal index. Server actions (app/admin/signal/reactions/actions.ts) all
  requireAdmin -> service role: create/update (return the persisted row), set-active,
  move (display-order swap), delete (RESTRICT-backed friendly message + bucket
  cleanup). components/admin/reactions-manager.tsx: list with role="switch" toggle,
  keyboard up/down reorder + shared aria-live, add/edit form (kind radio fieldset,
  char input OR image upload, useId-scoped field ids), inline delete confirm with
  focus management.

Three sub-agent reviews run; fixes applied (see progress.md "Phase 4f COMMIT 1
sub-agent review"). Net: counts SELECT gated on visibility, image_path tightened to
a strict UUID, form preview alt text, useId field ids, delete-confirm focus.

## REMAINING: (f) COMMIT 2 - public reaction picker + counts (NOT STARTED)

Build the public-facing half. Spec (from the owner's original Phase 4f prompt):

- Reaction picker on each post AND comment, populated from the ACTIVE catalog
  (is_active=true only). Keyboard-operable toolbar; each reaction is a button with
  aria-label = the catalog label and aria-pressed reflecting the viewer's own
  reacted state. Image reactions use <img alt=""> INSIDE the labeled button (NEVER
  image-only; the catalog label is the accessible name). aria-live announces
  "Reacted with X, N total" / "Removed X".
- Count display reads from signal_reaction_counts (NEVER count signal_reactions
  rows live). Disabled-but-existing reaction types STILL show their historical
  counts with their label (keep the label even when is_active=false). Public sees
  counts; reactor lists are authenticated-only.
- React / un-react via server actions (own-row INSERT/DELETE under RLS; the unique
  constraint makes a double-react a no-op toggle). Reaction writes keep the Wall
  DYNAMIC: NO profile-cache bust, only router.refresh() (matches the comments/GIF/
  emoji cache decision; the Wall is force-dynamic on /u/[handle]).
- Verify: typecheck + build, RLS verification for the reaction read/write paths
  (the counts gate + reactions own-write are already proven in COMMIT 1; re-verify
  the end-to-end picker path). Three sub-agent reviews, apply fixes. Update
  progress.md (mark Phase 4 COMPLETE) + handoff.md. COMMIT 2 to main, do NOT push.

Implementation pointers for COMMIT 2:
- The public Wall loader is lib/signal-wall.ts (loadWallPosts + loadCommentsForPosts,
  admin client, explicit live-gating). Extend it to also load: (a) active catalog
  types, (b) signal_reaction_counts for the loaded post/comment ids, (c) the viewer's
  own reactions on those ids (only when a viewer is signed in). Because the loader
  uses the admin client (service role), it bypasses the counts visibility gate, which
  is fine since the loader already only returns visible posts/comments.
- The disabled-but-counted case: counts may reference a reaction_type_id whose
  is_active=false. Load ALL catalog types (active + the ones referenced by counts),
  render the picker from active types only, but render the count chips for every type
  that has a count, labeled. signal_reaction_types public SELECT returns disabled
  rows for exactly this.
- Reaction server actions belong on the public side (e.g. app/u/[handle]/reaction-
  actions.ts), session client + own-row RLS, mapping any RLS/constraint error to
  friendly copy, router.refresh() only (no revalidateProfileCaches).
- Use lib/signal/reactions.ts reactionImageUrl() + ReactionType in the public picker.

## Verification gate (every session)

`npm run typecheck` then `npm run build`. Lint is not configured. No em-dashes /
AI-tell punctuation anywhere (CLAUDE.md rule 6); plain ASCII. One shell command per
tool call (no && chaining). Apply schema via MCP AND save SQL to supabase/migrations;
regenerate lib/database.types.ts after any DDL (the generator output is JSON-wrapped
and too large to read inline: parse .types with node, write the file, then
`npx prettier --write`). Run anon/auth RLS verification for EVERY new table (rolled-
back DO block with set local role + set_config('request.jwt.claims',...,true); use
`set local session_replication_role = replica` while seeding to dodge the rate
triggers, then `= default` before testing the count trigger; accumulate results into
the final RAISE message because MCP execute_sql swallows NOTICE and auto-commits, so
RAISE EXCEPTION at the end to roll back). Commit to main, do not push. Close with the
three sub-agent reviews.
