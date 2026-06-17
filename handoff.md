# Handoff: Signal Phase 5 COMPLETE (profile block builder + Layout A/B)

Phase 5 of Signal is shipped. The public profile (/u/[handle]) is now a composable
set of owner-arranged blocks driven by signals.layout_config (jsonb) + signals.layout,
and the owner arranges them in a fully accessible builder at /my-beacon/signal.
Read CLAUDE.md, docs/phase5-plan.md, and the "Signal - Phase 5" section of
progress.md before continuing.

The approved plan is persisted at docs/phase5-plan.md (committed first, on purpose,
so a future context reset cannot wipe it).

Commits on `main` (NOT pushed), in order:
- 9074d28 docs: persist approved Phase 5 plan
- 3b0a379 5.1 block data layer + graceful-degrade resolver
- 46f4030 5.2 public render (Layout A + B)
- 3f23212 5.3 builder shell (add/remove/reorder + Layout A/B)
- f2cecb4 5.4 board + league pickers
- 88b14fb 5.5 persist layout + mount the builder
- (this session) 5.6 review fix (empty-layout re-seed) + progress/handoff

`.claude/settings.local.json` is intentionally NOT committed.

## What Phase 5 delivers

- Block types: about (renders the bio), text (own copy), links, favorites,
  board_top_n, league_card. value_movers + recent_posts were cut.
- Layout A ("feed"): single column, blocks in order, Wall fixed at the bottom.
  Layout B ("sidebar"): full-width header over two columns; blocks auto-placed by
  type (boards + leagues in main, about/text/links/favorites in the sidebar); Wall
  fixed at the bottom of the main column. Users do NOT assign columns (one
  reorderable list; placement is by type, see lib/signal/blocks.ts blockColumn).
- The Wall is FIXED below the blocks in the main column. It is not a builder block,
  not reorderable, and not stored in layout_config.
- Graceful degrade for EVERY block type: the server resolver
  (lib/signal-profile.ts resolveProfileBlocks) drops any block whose referenced
  entity is gone or no longer public (board no longer profile_visible, league
  un-synced, empty bio/links/favorites), so it renders nothing, never errors, never
  leaks.
- Singletons: about, links, favorites can each appear once; their add buttons
  disable with a spoken reason when present.
- Decoupling: the board picker lists only already-profile_visible boards and the
  league picker only featured synced leagues; selecting one NEVER flips the
  entity's visibility (no implicit mutation).
- MIGRATION-FREE: signals.layout + signals.layout_config shipped in 0059 and are
  both in the owner-writable column grants (verified). No schema change, no
  types regen, no new RLS to verify; signals RLS is unchanged from prior phases.

## Key files

- lib/signal/blocks.ts: isomorphic block model, coercion, Layout A/B helpers,
  blockColumn auto-placement, seedBlocksFromProfile, hasStoredBlocks,
  serialize/parse.
- lib/signal-profile.ts: SignalProfileRow gains `layout`; ProfileBundle gains
  `layout` + resolved `blocks`; resolveProfileBlocks does the graceful-degrade
  resolution; seeds defaults ONLY when never configured (hasStoredBlocks).
- app/u/[handle]/page.tsx: FeedLayout (A) + SidebarLayout (B), renderBlock.
- components/signal/signal-block.tsx: one-per-entity blocks (AboutBlock, TextBlock,
  FeaturedBoardBlock, FeaturedLeagueBlock) + LinksBlock + FavoritesBlock; SignalBlock
  is width-agnostic now (the page column owns width/padding).
- app/my-beacon/signal/layout-builder.tsx: the builder (reorder, add-menu,
  singletons, board/league pickers, Layout A/B switch, single re-announcing live
  region, focus management).
- app/my-beacon/signal/actions.ts: saveLayout (validate + coerce + filter
  references to the owner's own featured entities + revalidateProfileCaches).
- app/my-beacon/signal/page.tsx: loads picker options, seeds the builder when never
  configured, mounts LayoutBuilder under a Profile layout section.

## Review (5.6)

Inline review, accessibility primary, plus implementation + security. No blockers.
- Accessibility PASS: public single h1, h2 block headings, aside landmark only in
  Layout B, DOM order = visual order, nothing hidden at any breakpoint; builder
  fully keyboard/NVDA-operable (fieldset radios, labeled move/remove with focus
  management, disclosure pickers with Escape + focus return, single re-announcing
  live region via useAdminAnnouncer, 44px targets, AA ink-muted).
- Security PASS: owner-RLS writes (column grants verified), untrusted input coerced
  and references filtered to the owner's own entities (no IDOR/leak), plain-text
  render (no XSS), generic error copy.
- Fix applied: an intentionally-empty saved layout used to be indistinguishable
  from never-configured and would re-seed defaults on the public page. hasStoredBlocks
  fixes it (a configured layout always carries a blocks array).

## Verification gate (every session)

`npm run typecheck` then `npm run build`. Lint is not configured. No em-dashes /
AI-tell punctuation (CLAUDE.md rule 6); plain ASCII. One shell command per tool
call (no && chaining). Schema via MCP + saved migration + types regen + anon/auth
RLS verification (none needed this phase: migration-free). Commit to main, do not
push.

## Carry-forwards (unchanged from Phase 4)

1. GIPHY PRODUCTION KEY: still on a GIPHY BETA key. Apply for a production key
   before public launch. The "Powered by GIPHY" attribution is built in.

## Possible later enhancements (NOT Phase 5)

- Manual column assignment in Layout B (today placement is by type).
- The "spotlight" layout value exists in the signals.layout CHECK but is not
  implemented; resolveLayout clamps it to "feed".
- Re-introducing value_movers (belongs with a future source/format-context
  decision) and recent_posts blocks.

## Next up

The next milestone items are at the bottom of progress.md ("Next milestone"): news
pipeline, vote matchups, weekly content cron, IndexNow + sitemap, AdSense
readiness, and the Phase 12 follow-ups.
