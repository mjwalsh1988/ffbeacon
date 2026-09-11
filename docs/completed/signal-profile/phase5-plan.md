# Signal Phase 5 - Profile block builder (approved plan)

This file exists so a context reset can never wipe the approved Phase 5 breakdown
again. It is the single source of truth for Phase 5 scope. Build 5.1 -> 5.6 in
order, one commit per step, each verified with `npm run typecheck` + `npm run
build` (no push).

## Feature summary

Today the public profile (`app/u/[handle]/page.tsx`) renders identity blocks in a
hardcoded order (Favorites, Boards, Leagues, Links, Wall) in a single column. The
`signals.layout` column (`feed | sidebar | spotlight`) and `signals.layout_config`
jsonb already exist but are unused at render time. Phase 5 replaces the hardcoded
order with a configurable, accessible block builder driven by `layout_config`.

Block types: `about`, `links`, `favorites`, `board_top_n`, `league_card`, `text`.
`value_movers` and `recent_posts` are explicitly CUT from Phase 5 (both can return
later; `value_movers` correctly belongs with a future source/format-context
decision).

## Approved steps (5.1 -> 5.6)

- **5.1 Block data layer**: typed block schema stored in `layout_config` (block
  types above), an isomorphic parser/validator, and a seeder that derives default
  blocks from existing signal data (seed an `about` block when `bio` exists so the
  bio is never lost, plus links/favorites/boards/leagues as they exist today).
  Server-side resolver that drops any block whose referenced entity is gone or no
  longer public (graceful degrade, see rule below).

- **5.2 Public render**: render blocks in `layout_config` order. Layout A
  (single column / `feed`) vs Layout B (`sidebar`: a full-width header above two
  columns). The about-block replaces the inline bio in Layout B. DOM order =
  visual order. Every block degrades to nothing on a missing/private reference.

- **5.3 Builder shell** in `/my-beacon/signal`: a single reorderable block list,
  an add-menu (with `links` / `favorites` / `about` as singletons, disabled in
  the add-menu with a spoken reason when already present), remove, reorder
  (accessible move up/down), and a Layout A/B switch. Uses the single
  re-announcing live-region pattern (`useAdminAnnouncer` from
  `components/admin/admin-controls.tsx`); never reintroduce the double-announce
  pattern.

- **5.4 Per-block config editors**: about text; board picker that lists ONLY
  already-`profile_visible` boards (decoupled - selecting a board for a block must
  NOT flip its visibility, no implicit mutation of another entity); league-card
  picker (synced leagues only).

- **5.5 Persistence**: `saveLayout` server action + server-side validation +
  `revalidateProfileCaches`.

- **5.6 Accessibility review (primary)** + implementation + security sub-agents,
  fixes, full verification, then update `progress.md` + `handoff.md` and ship the
  final commit.

## Resolved ambiguities

1. **The Wall stays FIXED** below the header in the main column. It is NOT a
   builder block, not reorderable, and not stored in `layout_config`.

2. **Auto-place blocks by type** - users do NOT assign columns. The builder is
   one-dimensional (a single reorderable list) so the accessible move up/down model
   stays simple. In Layout B: `board_top_n` and `league_card` render in/adjacent to
   the main area; `links`, `favorites`, `about`, and `text` render in the sidebar.
   Manual column assignment is a possible later enhancement, not Phase 5.

## Graceful-degrade rule (applies to EVERY block type, non-negotiable)

Graceful degrade must hold for every block type, not just boards. A `league_card`
pointing at a league the owner later un-synced, and a `board_top_n` for a board
later made private, must BOTH render nothing on the public page (never error,
never leak). State this in 5.1 / 5.2 and include it in the RLS / degrade
verification.

## Build constraints

- One commit per step, verified with `npm run typecheck` + `npm run build`. No push.
- Reuse the post-sweep shared admin primitives and the single re-announcing
  live-region pattern. Do NOT reintroduce the double-announce pattern.
- Migration-free unless proven otherwise. If schema is touched: apply via MCP, save
  SQL to `supabase/migrations`, regenerate `lib/database.types.ts`, and run
  anon/auth RLS verification.
- Accessibility is the primary review at 5.6: builder + rendered sidebar fully
  NVDA-operable, single h1, correct landmarks, AAA contrast, 44px targets, DOM
  order = visual order with nothing hidden at any breakpoint.
- No em-dashes or AI-tell punctuation anywhere (CLAUDE.md rule 6).
