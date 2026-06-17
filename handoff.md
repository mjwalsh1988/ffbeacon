# Handoff: Signal Phase 4 COMPLETE (Wall: posts, images, comments, GIFs, emoji, reactions)

Phase 4 of Signal (the public Wall on /u/[handle]) is now fully shipped across six
sub-phases: (a) text posts + moderation, (b) post images, (c) comments, (d) GIFs via
GIPHY, (e) inline emoji, and (f) custom reactions + admin catalog (COMMIT 1 data
layer + admin catalog, COMMIT 2 public picker + counts). There is no remaining
Phase 4 work. Read CLAUDE.md and the "Signal - Phase 4" sections of progress.md
before continuing to the next milestone.

Commits on `main` (NOT pushed):
- 90f4634 Phase 4a Wall text posts + polymorphic moderation
- b43e7d1 Phase 4b post images with required alt text
- 4537173 Phase 4 review fixes (a11y focus + tap targets + alt counter)
- 796331b Phase 4c Wall comments + polymorphic comment moderation
- 1082abf Phase 4d GIFs via GIPHY (posts + comments, images-xor-gif)
- deea896 Phase 4e inline emoji in post + comment composers
- 5315f3c Phase 4f COMMIT 1 custom reactions data layer + admin catalog
- (this session) Phase 4f COMMIT 2 public reaction picker + counts

`.claude/settings.local.json` is intentionally NOT committed.

## Carried-forward action items (do NOT lose these)

1. GIPHY PRODUCTION KEY (from d): we are on a GIPHY BETA key (`GIPHY_API_KEY` in
   .env.local, server-only). A PRODUCTION key must be applied for before public
   launch. The required "Powered by GIPHY" attribution is already built in (in the
   GIF picker near results AND on every rendered GIF) so we pass review. Treat that
   attribution as permanent UI, not chrome.

The two a11y carry-forwards (double-announce sweep + suite-wide admin a11y polish)
are DONE as of the accessibility cleanup session below. See "What shipped in the
accessibility cleanup".

## What shipped in the accessibility cleanup (the two deferred a11y sweeps)

Dedicated a11y-only session, no feature work. Both deferred a11y carry-forwards are
now resolved. Verified with typecheck + build green and a CLEAN accessibility
sub-agent review (no blockers/important) plus a quick impl + security pass.

- SWEEP 1 (double-announce): the Signal error surfaces wrapped the error in an
  `aria-live="assertive"` <div> that ALSO held an inner `<p role="alert">`. Since
  role="alert" is an implicit assertive live region, the nesting double-announced on
  NVDA. Chosen mechanism, applied identically everywhere: keep the wrapper as the
  single live region, drop role="alert" from the inner paragraph (text + danger
  styling unchanged). Fixed in components/signal/reaction-bar.tsx,
  components/signal/comment-section.tsx, components/signal/gif-picker.tsx, and
  components/admin/report-queue.tsx. Standalone single-region role="alert" elsewhere
  (e.g. league-load-error.tsx, refresh-button.tsx, the reaction form error) was NOT
  the double pattern and was left alone.
- SWEEP 2 (admin manager reconciliation): new components/admin/admin-controls.tsx
  exports AdminSwitch (role="switch" + aria-checked toggle with a 44x44 px hit target
  wrapping the same compact aria-hidden pill; previously a 28px switch) and
  useAdminAnnouncer (returns { announce, region }; a re-announcing double-region
  live area so identical consecutive messages still speak). sources-manager.tsx and
  reactions-manager.tsx both now use these shared primitives. Extracted on purpose so
  future admin managers inherit the correct pattern; manual-signals-list.tsx and
  recompute-bar.tsx still have their own inline live regions and can adopt the shared
  primitives in a future pass (out of scope for this session).

## What shipped in (f) COMMIT 2 - public reaction picker + counts

No schema changes (the three tables shipped in COMMIT 1: signal_reaction_types,
signal_reactions, signal_reaction_counts, migrations 0074/0075). COMMIT 2 is the
public-facing read layer + server actions + UI.

- lib/signal-wall.ts loadReactionsForTargets(targets, viewerUserId): service-role
  admin client; loads the full catalog (active types drive the picker, disabled
  types are kept only to label historical counts), reads denormalized
  signal_reaction_counts (NEVER tallies signal_reactions rows live), and the viewer's
  own reactions for aria-pressed/toggle. Returns WallReactions { activeTypes,
  byTarget }. Exports reactionTargetKey + EMPTY_REACTION_TARGET. Because the loader
  uses service role it bypasses the counts visibility gate, which is fine: the page
  only ever feeds it targets it already gates (visible posts/comments, or the owner's
  own preview).
- app/u/[handle]/reaction-actions.ts addReaction/removeReaction: session client +
  own-row RLS. The insert sets user_id from the authenticated session (never the
  client) and is gated by RLS to a publicly-viewable target + active type; 23505
  (unique) maps to a no-op success so the toggle is idempotent; 42501 maps to friendly
  copy. The delete is user_id-scoped on top of delete-own RLS. router.refresh() only,
  NO profile-cache bust (matches the Wall dynamic decision).
- components/signal/reaction-bar.tsx: keyboard-operable role="toolbar" with roving
  tabindex (Arrow/Home/End), one toggle button per ACTIVE type (aria-pressed = viewer
  state, aria-label = catalog label, image reactions as <img alt=""> inside the
  labeled button), polite aria-live "Reacted with X, N total" / "Removed X" + an
  assertive error region. Disabled-but-counted types render as labeled read-only
  chips. Anon and view-only (hidden post/comment, owner preview) see counts read-only;
  anon gets a "Sign in to react" link. 44px toggle targets. Buttons stay enabled
  during the write (focus preserved) and double-fire is guarded by the pending flag.
- Wired into components/signal/wall.tsx (posts) and components/signal/comment-section.tsx
  (comments); app/u/[handle]/page.tsx loads reactions for every post + comment target
  and threads WallReactions through ProfileBody -> WallBlock.

Three sub-agent reviews run; the one IMPORTANT (focus dropped because toolbar buttons
were disabled mid-toggle) is FIXED (buttons stay enabled, double-fire guarded, roving
tab stop clamped). All other findings were MINOR/by-design. End-to-end RLS re-verified
via a rolled-back DO block (14 checks, all PASS, zero leakage). See progress.md
"Phase 4f COMMIT 2".

## Verification gate (every session)

`npm run typecheck` then `npm run build`. Lint is not configured. No em-dashes /
AI-tell punctuation anywhere (CLAUDE.md rule 6); plain ASCII. One shell command per
tool call (no && chaining). Apply schema via MCP AND save SQL to supabase/migrations;
regenerate lib/database.types.ts after any DDL. Run anon/auth RLS verification for
every new table (rolled-back DO block with set local role + set_config of
request.jwt.claims; use `set local session_replication_role = replica` while seeding
to dodge rate triggers, then `= default` before testing a count trigger; accumulate
results and RAISE EXCEPTION at the end to roll back, because MCP execute_sql swallows
NOTICE and auto-commits). Commit to main, do not push. Close with the three sub-agent
reviews.

## Next up

Phase 4 (Wall) is done. The next milestone items are tracked at the bottom of
progress.md ("Next milestone"): news pipeline, vote matchups, weekly content cron,
IndexNow + sitemap, AdSense readiness, and the Phase 12 follow-ups. Pick up there.
