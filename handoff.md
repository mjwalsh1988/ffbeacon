# Handoff: Signal Phase 6 COMPLETE (mobile sidebar drawer + Layout C "Spotlight")

Phase 6 of Signal is shipped. Two parts:

1. PART 1 (Layout B mobile): below the lg breakpoint, Layout B's secondary
   sidebar (about, text, links, favorites) now collapses into an accessible
   "Profile info" drawer behind a top-bar trigger instead of stacking below the
   main column. This is an intentional change from the Phase 5 "nothing hidden"
   stacking rule, resolved as hidden-but-accessible. Layout A is unchanged (it
   has no sidebar; its blocks are the primary timeline). Desktop Layout B (lg+)
   is unchanged.
2. PART 2 (Layout C): signals.layout = "spotlight" now renders a centered
   landing page reusing the same resolved bundle.blocks as A/B.

Read CLAUDE.md, docs/phase5-plan.md (the Phase 5 block model is the foundation),
and the "Signal - Phase 6" section of progress.md before continuing.

Commits on `main` (NOT pushed), in order:
- 5221536 6.1 mobile profile-info drawer (Layout B)
- 0870217 6.2 Spotlight (Layout C) render layer
- 555b21a 6.3 expose Layout C in the builder
- (this session) 6.4 sub-agent review fixes + progress/handoff

`.claude/settings.local.json` is intentionally NOT committed.

## What Phase 6 delivers

PART 1 - mobile sidebar drawer (Layout B only):
- components/signal/sidebar-shell.tsx (new, client): owns the Layout B body. It
  renders the sidebar blocks EXACTLY ONCE, switching the whole subtree on mount +
  breakpoint state (matchMedia "(max-width: 1023px)", matching the
  lg:grid-cols-[2fr_1fr] split) rather than CSS. Rendering twice (a desktop aside
  plus a CSS-hidden mobile drawer) would put duplicate hard-coded ids in the DOM
  (signal-favorites-heading, signal-links-heading, ...) and break aria-labelledby.
- Progressive enhancement: SSR / first client render / no-JS renders the inline
  two-column tree exactly as Phase 5 (sidebar stacks below on small screens, so
  nothing is lost without JS). After mount, below lg, it collapses into the
  drawer; desktop keeps the inline aside.
- The drawer reuses the proven mobile-menu focus model: portal to document.body,
  role=dialog + aria-modal, Tab focus trap (both directions), Escape, body scroll
  lock (saves/restores prevOverflow), focus return. Focus is deferred 80ms so a
  screen reader does not land on an off-screen panel. The slide is motion-safe
  only (reduced motion = instant). aria-controls is conditional on open (the
  portal dialog only exists while open, so it is never a dangling IDREF). The
  trigger's visible text "Profile info / Bio, links, and more" is its accessible
  name (no aria-label clobbering the hint).

PART 2 - Layout C "Spotlight":
- ProfileLayout union now includes "spotlight" (lib/signal/blocks.ts). The
  signals.layout CHECK already permitted it (migration 0059), so Phase 6 is
  MIGRATION-FREE: no schema change, no types regen, no new RLS to verify.
  isProfileLayout / resolveLayout accept it; PROFILE_LAYOUTS includes it so the
  builder offers a third radio.
- app/u/[handle]/page.tsx SpotlightLayout: centered hero (avatar/name/headline
  centered via heroInner), the about block rendered as a centered editorial lede
  (extracted from blocks and EXCLUDED from the card list, so no double render),
  every other block in the owner's order wrapped in a BeaconCard, a wrapping
  StatsStrip (boards/leagues/favorite team/Wall post counts from already-loaded
  bundle data, no new query), and the Wall behind a labeled disclosure.
- components/signal/beacon-card.tsx (new, server): luminous card chrome wrapping
  any existing block component without changing its semantics. The glow is FULLY
  STATIC (accent box-shadow + an aria-hidden top hairline, no keyframes), so
  reduced motion has nothing to disable and contrast is unaffected (text inside
  keeps its own colors; the accent is decorative only).
- components/signal/wall-disclosure.tsx (new, client): SSR-expanded, collapses on
  mount. Toggles the HTML `hidden` attribute on a stable useId region. Collapsed:
  the region (composer, comment, reaction controls) leaves the tab order + a11y
  tree, so a keyboard user tabs the single toggle and skips past without
  expanding. Expanded: the controls sit in natural, untrapped tab order.
  aria-expanded/controls track state; the region id is always in the DOM (no
  dangling ref); no hydration mismatch (first client render == SSR). Mounted only
  when posts > 0 (WallBlock returns null on 0 posts, so the guards agree).
- It reads the SAME resolved bundle.blocks as A/B (one presentational path):
  existing block components, caches (loadBoardTopN tagged board:{id}), and
  graceful degrade are all reused. DOM order = visual order (single column).

## Key files

- components/signal/sidebar-shell.tsx: Layout B shell + mobile drawer.
- components/signal/beacon-card.tsx: Spotlight static-glow card wrapper.
- components/signal/wall-disclosure.tsx: Spotlight Wall disclosure.
- app/u/[handle]/page.tsx: ProfileBody (isSpotlight hero), SpotlightLayout,
  StatsStrip, SidebarLayout now delegating to SidebarShell.
- lib/signal/blocks.ts: ProfileLayout gains "spotlight"; PROFILE_LAYOUTS,
  isProfileLayout, resolveLayout updated.
- app/my-beacon/signal/layout-builder.tsx: Layout C radio + helper copy +
  LAYOUT_ANNOUNCE.

## Review (6.4)

Three sub-agents over the full Phase 6 diff (4a23567..555b21a). No blockers.
- Security: PASS, CLEAN at every severity. Presentational, reuses the gated
  bundle + owner-only saveLayout write path. BeaconCard inline-style hex comes
  only from the fixed accent palette (unknown slug -> default), no
  attacker-controlled CSS; lede/stats are React-escaped text from the gated
  bundle; no dangerouslySetInnerHTML, no new network/secret/redirect/SSRF; client
  effects all clean up. DB CHECK confirmed allows 'spotlight'.
- Accessibility (primary): two IMPORTANT fixed in sidebar-shell.tsx (dangling
  aria-controls -> conditional on open; focus return on resize-while-open ->
  isConnected guard) plus one MINOR (trigger aria-label clobbered the visible
  hint -> removed). Everything else PASS.
- Implementation: same aria-controls IMPORTANT (fixed) + a dead triggerRef
  (removed). RSC pattern, breakpoint match, no-sidebar fallback, about extracted
  once, stats with no new query, all confirmed. Layout A + desktop B
  non-regression confirmed.

## Verification gate (every session)

`npm run typecheck` then `npm run build`. Lint is not configured. No em-dashes /
AI-tell punctuation (CLAUDE.md rule 6); plain ASCII. One shell command per tool
call (no && chaining). Schema via MCP + saved migration + types regen + anon/auth
RLS verification (none needed this phase: migration-free). Commit to main, do not
push.

## Carry-forwards (unchanged)

1. GIPHY PRODUCTION KEY: still on a GIPHY BETA key. Apply for a production key
   before public launch. The "Powered by GIPHY" attribution is built in.

## Possible later enhancements (NOT Phase 6)

- Manual column assignment in Layout B (today placement is by type via
  lib/signal/blocks.ts blockColumn).
- A live layout preview in the builder (Spotlight, like A/B, has none today).
- Re-introducing value_movers (belongs with a future source/format-context
  decision) and recent_posts blocks.
- In Spotlight, the about block becomes a lede with no "About" heading/landmark
  (deliberate editorial hero, flagged as a MINOR parity divergence from A/B).

## Next up

The next milestone items are at the bottom of progress.md ("Next milestone"):
news pipeline, vote matchups, weekly content cron, IndexNow + sitemap, AdSense
readiness, and the Phase 12 follow-ups.
