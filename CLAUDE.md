# FF Beacon - Project Instructions for Claude Code

## Critical Rules (Read Every Session)

1. **Environment variables**: Always read .env.local FIRST at the start of every session. Echo back the variable names you find. The project uses NEW Supabase keys: SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY. NEVER use anon key or service_role key names.

2. **Never move config files**: .env.local, .env.local.example, .mcp.json, .claude/, CLAUDE.md, plan.md, progress.md stay in place permanently. Do not create backup copies.

3. **Reference project**: ~/Desktop/dynasty-price-check/ is READ-ONLY reference. Look at it for patterns. Never write to it.

4. **Supabase project ID**: This project uses Supabase project `cilvpyivysjxpxbudkfa` (the one wired into .mcp.json). Do not reference any other project IDs or credentials files on the user's desktop.

5. **Output handling**: This project owner uses a screen reader. Always:
   - Put copyable content in code blocks
   - Keep responses concise and direct
   - Reference UI elements with their on-screen location when giving instructions
   - Never use em-dashes in any content output

## Supabase MCP Workflow

The Supabase MCP server is connected. For all database operations:
- Apply schema changes directly via MCP (`mcp__supabase__apply_migration`)
- Save migration SQL to /supabase/migrations/[timestamp]_[name].sql for version control
- Regenerate TypeScript types via MCP after EVERY schema change
- Write generated types to /lib/database.types.ts
- Stale types cause runtime errors, regenerate immediately

## Row Level Security (RLS) - MANDATORY

This Supabase project has auto-RLS enabled. Every table is created with RLS active and ZERO policies by default, which means it blocks ALL access until policies exist.

RULE: Every table migration MUST include its RLS policies in the SAME migration file. A table without policies is broken by definition.

### RLS Policy Patterns by table type

**Public read-only data** (players, format_configs, rankings, player_value_history, player_value_trends, projections, player_stats, articles, news_items, vote_matchups, source_registry):
- Public SELECT for anyone (anon + authenticated)
- INSERT/UPDATE/DELETE only via service role (server-side cron/admin)
- No client-side writes allowed

**User-owned data** (user_preferences, votes):
- SELECT only own rows (auth.uid() = user_id)
- INSERT only own rows (auth.uid() = user_id on insert)
- UPDATE only own rows
- DELETE only own rows
- No anon access at all

**Join tables** (article_players):
- SELECT public
- Write via service role only

**auth.users references**:
- Never expose full auth.users via RLS
- Use user_preferences as the public projection layer

### Policy naming convention
- `{table}_select_public` for public reads
- `{table}_select_own` for owner-only reads
- `{table}_insert_own` for owner-only inserts
- `{table}_update_own` for owner-only updates
- `{table}_delete_own` for owner-only deletes
- `{table}_service_role_all` for admin operations

### Verification sequence after every table migration
1. Apply migration via MCP
2. Query `pg_policies` to confirm policies exist
3. Test SELECT as anon role to confirm public reads work (if applicable)
4. Test SELECT as a real authenticated user to confirm scoped reads work (if applicable)
5. Test write operations are blocked where expected
6. Document the access matrix in a comment at the top of the migration file
7. Only after all checks pass, mark the task complete in progress.md

Security sub-agent must explicitly verify RLS policies exist and work as expected before marking any schema task complete.

## Accessibility Requirements (Non-Negotiable)

Every UI element must be screen-reader accessible. This is the core differentiator of the entire site.

Apply these ARIA practices on every component:
- Use semantic HTML first (button, nav, main, article, section, aside)
- Add aria-label or aria-labelledby on all interactive elements without visible text
- Use aria-describedby for additional context
- Use aria-live regions for dynamic content updates
- Use aria-current="page" on active navigation items
- Use aria-expanded on collapsible elements
- Use aria-controls to link triggers to their targets
- Use role attributes only when semantic HTML cannot express the meaning
- Use aria-hidden="true" on decorative icons
- Ensure all interactive elements are keyboard navigable
- Provide skip-to-content links
- Maintain focus visible states (never remove outline without replacement)
- Use proper heading hierarchy (one h1 per page, no skipped levels)
- All form inputs must have associated labels
- All images must have meaningful alt text or alt="" if decorative
- Color contrast must meet WCAG AAA where possible, AA minimum
- Test against VoiceOver, NVDA, JAWS keyboard navigation patterns

Before marking any component complete, dispatch a sub-agent to audit accessibility against WCAG 2.2 AA and these rules.

## Mobile-First Layout Rule (Non-Negotiable)

ABSOLUTE RULE: Mobile-first means designing FOR mobile and adapting UP to larger screens, never hiding data on mobile to simplify display. When a feature has more data than fits on mobile naturally, find creative compact layouts (stacked cells, combined values with separators, two-line rows) rather than hiding columns. Every piece of data accessible on desktop must be accessible on mobile.

Apply this rule whenever a Tailwind responsive utility is reached for:

- `hidden sm:table-cell` / `sm:flex` / `md:block` patterns are acceptable ONLY when the data they hide is ALSO surfaced elsewhere in the mobile layout (a stacked context line, a merged cell, an expandable row, an inline pill, etc.).
- If you find yourself writing `hidden md:…` on a data column without a mobile equivalent, you are violating this rule. Restructure the row instead.
- Tap targets in the compact mobile layout must remain at least 44×44 CSS px for any interactive element.
- Sub-agent accessibility reviews must explicitly confirm "no data hidden at any breakpoint" on every UI change that touches responsive utilities.

## Sub-Agent Workflow

After completing any atomic task on progress.md:

1. **Implementation review sub-agent**: Verify the work matches plan.md requirements. Check:
   - Plan adherence
   - Schema correctness
   - Naming conventions
   - File placement

2. **Accessibility review sub-agent**: Audit the component/page for:
   - All ARIA rules above
   - Keyboard navigation
   - Screen reader announcement quality
   - Focus management

3. **Security review sub-agent**: Audit code changes for:
   - CORS configuration correctness
   - XSS (input sanitization, output encoding, dangerouslySetInnerHTML usage)
   - SQL injection (parameterized queries only, no string concatenation)
   - Authentication/authorization checks on API endpoints
   - Row Level Security (RLS) policies on Supabase tables, EXPLICITLY verify they exist and work
   - Secret/key exposure (publishable keys client-side only, secret keys server-side only)
   - Rate limiting on public endpoints
   - CSRF protection on state-changing operations
   - Open redirect vulnerabilities
   - Insecure direct object references (IDOR)
   - Server-side request forgery (SSRF)
   - Path traversal
   - Unsafe deserialization
   - Dependency vulnerabilities (npm audit)
   - Information disclosure in error messages
   - Improper session handling
   - Any other known security exploits relevant to the code being reviewed

If any sub-agent finds issues, fix them before marking the task complete.

## Progress Tracking

- **plan.md**: The full project plan. Read on session start. Do not modify without explicit approval.
- **progress.md**: Atomic task list. Update after every single task completion. Tasks must be atomic (one file, one feature, one migration), NEVER group multiple things into one task.
- **handoff.md**: Created at end of each session if work was interrupted. Document exactly what state things are in and what comes next.

### Progress task format

```
T### | status | description
     | files: path/to/file1, path/to/file2
     | depends on: T###, T###
     | verified: yes/no (RLS verified, a11y audited, security reviewed)
```

Status values: pending | in_progress | blocked | completed

## Project conventions

- TypeScript everywhere, strict mode
- App Router, Next.js 15
- Tailwind with custom theme tokens from plan.md section 2
- shadcn/ui for accessible primitives
- Geist Sans + Geist Mono via next/font
- Zustand for client state, URL params for filters
- React Hook Form + Zod for forms
- next-themes for dark/light, dark default
- File-per-component, kebab-case file names, PascalCase exports
- Migrations: numbered 0001, 0002... in /supabase/migrations/
- Database types: /lib/database.types.ts (generated, do not edit by hand)


## Source and Format Sync Requirements

The site has two global preferences that flow through the user experience: data source (KTC, future: FantasyCalc, ffbeacon native, etc.) and league format (Redraft PPR, Dynasty Superflex, etc.).

These preferences are persisted via:
1. URL searchParams (transient override for shareable links)
2. user_preferences DB table (logged-in users, cross-device sync)
3. Cookies (anonymous users + logged-in user cache)
4. localStorage (backup layer)

ABSOLUTE RULE: Every new feature, page, component, or tool that displays player data, rankings, trade values, projections, or any format-dependent or source-dependent content MUST automatically respect the user's current source and format selection.

When building any new feature:

1. If it queries rankings, player_value_history, player_value_trends, projections, or any data with a source column OR a format_config_id column - it MUST call the appropriate resolver:
   - resolveFormatSlug() from lib/preferences.ts (URL → DB → cookie → DEFAULT_FORMAT_SLUG)
   - resolveSourceSlug() from lib/preferences.ts (URL → DB → cookie → registry default)
   - resolveSourceForFormat() from lib/source.ts (the table+format-aware source picker with fallback semantics)

2. Pages must read searchParams AND fall back to the resolver chain (URL → DB → cookie → default).

3. Components rendering format-aware data must accept the resolved format/source as props, not hardcode them.

4. New API endpoints that return source/format-dependent data must accept format and source as query params and apply the resolver chain if not provided.

5. New UI components showing source-attributed data must NOT display the raw source slug to users. Use display_name from source_registry for any user-facing source label.

The ONLY exceptions are:
- Pages explicitly building tools that ignore format/source (rare - like /about, /author/michael, generic guides)
- When the feature spec explicitly states "ignore source/format"
- Internal admin/dev pages

If you're unsure whether a new feature should respect format/source, the answer is YES, it should. Default to syncing.

When in doubt, ask: "Does this feature show player data that could differ between scoring formats or data sources?" If yes → must sync.

Test every new feature against this rule before marking complete. Sub-agent implementation review must verify format/source propagation on any feature touching player data.

### Sources declare what they actually support (non-negotiable)

ABSOLUTE RULE: Sources declare their supported formats via `supported_format_slugs` on `source_registry`. NEVER create placeholder rows for formats a source doesn't actually support. If a source only natively provides X formats, set `supported_format_slugs` to exactly those X. Do not duplicate data across unsupported formats.

`supported_format_slugs` is a `text[]` column on `source_registry`:
- `NULL` means "supports every active format" (use only when the source genuinely covers all of them).
- An array of slugs means "supports exactly these formats".
- An empty array means "supports nothing" — prefer `is_active=false` instead.

ABSOLUTE RULE: When implementing a new data source, pairwise-compare 50+ players' values across all claimed formats. If values are byte-for-byte identical when they shouldn't be (e.g., PPR matches Half PPR for non-TE players), the source does not actually support those formats — reduce `supported_format_slugs` accordingly. KTC's `fantasy-rankings` `?scoring=half|std`/`?tep=1` params look like server variants but are client-side JS filters; we verified this the hard way (see migration 0011 and `scripts/sync-ktc.ts` header comment). The same audit shape works for any new source: pull a fresh dump for each claimed format, compute per-player value diffs, and reject any pair that hits 100% identical.

ABSOLUTE RULE: Format gating in dropdowns is asymmetric and deliberate.
- The **Format** dropdown MUST filter out formats the current source doesn't support. Picking a format that has no data is never useful; hide those entries.
- The **Source** dropdown MUST show every active source, but options that don't support the current format MUST render with a pre-click warning: a visible `(changes format)` note, an expanded `aria-label` ("Warning: selecting this will switch your format from {Current} to {Fallback} because {Source} doesn't provide values for {Current}."), and a `role="tooltip"` element wired up via `aria-describedby` that names the fallback format. The user can still pick the warned source; the existing fall-through then performs the format swap. We do not hide warned sources because users have a legitimate reason to pick them (they want that source even if it means a format change), and silent filtering hides the choice entirely.
This prevents users from accidentally selecting combinations that have no real data while preserving the explicit "I want that source even if my format must change" path. Pages MUST also reconcile via `reconcileFormatWithSource()` in `lib/source.ts` so URL-driven mismatches (shareable links with a stale `?format=…`) gracefully fall through to a supported format with a banner, without persisting the swap to cookie/DB.

ABSOLUTE RULE: When a source's UI option would cause a format mismatch on selection, the dropdown must warn the user in advance via visual indicator + aria-label + tooltip. Silent fall-through is acceptable only AFTER explicit user action (the post-click banner); the pre-click warning is mandatory. Sub-agent accessibility reviews must verify the warning renders for screen readers, not just visually.

The fall-through preference chain (defined in `lib/format-fallback.ts`):
1. Same `league_type` (redraft/dynasty)
2. Same `scoring_type` (ppr/half_ppr/standard)
3. Same `is_superflex`
4. Lowest `display_order` among the source's supported formats

ABSOLUTE RULE: When a source explicitly publishes derived formats as algorithmic transformations of base data (KTC's TEP+ rankings are computed client-side from the base superflex values, not a separate dataset), reproduce the algorithm in our sync pipeline rather than scraping the derived view. The source slug stays the same (`'ktc'`) because the data origin is the same — we're applying the source's own published math, not introducing new opinion. KTC TEP is the canonical example: `lib/ktc-tep.ts` ports the community-maintained formula, and `scripts/sync-ktc.ts` derives `dynasty-ppr-tep-sflex` rows from the freshly-scraped `dynasty-ppr-sflex` batch. We do NOT hit a `?tep=1` URL; that toggle is client-side JS and would return identical bytes (see migration 0011 footgun).

## Data Architecture Principles

### Naming Schemes

Table, column, function, file, and variable names use FF Beacon-native terminology that accurately reflects what the data represents in OUR product. Never import naming conventions from external data sources (KTC, FantasyCalc, Sleeper, etc).

When adding a new table or column, ask:
- Does this name accurately describe what the data IS in OUR product?
- Would a new developer understand the purpose without knowing the source?
- Is it scalable - does the name still make sense when we add 5 more data sources?
- Is it organized - does it follow the established patterns (snake_case, descriptive, plural for tables, specific for columns)?

If the answer to any of these is no, choose a better name. NEVER default to the external source's terminology just because that's where the data came from.

Examples of correct naming:
- `player_value_history` (not `trade_values` - "trade" is KTC-specific framing)
- `player_rankings` (not `power_rankings` or `trade_rankings`)
- `player_stats` (not `sleeper_stats` - source-agnostic)
- `player_news` (not `nfl_news` or `sleeper_news`)

Examples of incorrect naming we must avoid:
- `ktc_values`, `fantasycalc_data`, `sleeper_players` (source name in table name)
- `trade_calculator_results` (named after external feature, not our concept)

### Source Names in Column Names (Hybrid Rule)

Source names ARE allowed in **operational/utility** columns where they describe a specific external operation or mapping:
- `last_X_sync` (operational timestamp for a specific source)
- `X_id` / `external_ids.X` (external identifier mapping for a specific source)
- `external_X_url` (specific external resource reference)

Source names are NOT allowed in **data** columns where the data itself should be source-agnostic and scalable:
- `X_raw` / `X_data` (use `metadata` jsonb keyed by source instead)
- `X_value` (use `value` column with source identifier row instead)

When in doubt, ask: does this column hold DATA from the source, or does it describe OPERATIONS against the source?
- Holds data → use jsonb keyed by source name
- Describes operations → individual named column is fine

Examples:
- `last_sleeper_sync` ✓ (operational timestamp)
- `external_ids.sleeper` ✓ (external identifier mapping)
- `sleeper_raw` ✗ (data, should be `metadata.sleeper`)
- `trade_values` ✗ (concept named after external product, should be `player_value_history`)
- `ktc_value` column ✗ (data, should be `value` column with source row identifier)

This rule scales: adding new sources requires zero schema migrations to data columns. Only the `metadata` jsonb gets a new key.

### Original Source Object Preservation

Every external data ingestion table MUST include a `metadata` jsonb column that preserves the original raw object from the source. This is mandatory for:
- Audit trails (proving what we received vs what we stored)
- Backfill capabilities (re-deriving fields if our extraction logic changes)
- Bug diagnosis (inspecting the raw source data when a value looks wrong)
- Future feature development (extracting fields we didn't initially care about)
- Schema migrations (preserving original data through structural changes)

The `metadata` column:
- Type: `jsonb`
- Nullable: yes for per-row ingestion tables (internal calculations may not have a source object); `not null default '{}'::jsonb` on `players`, which is a multi-source merged dimension
- Naming convention: exactly `metadata` — not `raw_data`, `source_data`, `sleeper_stats`, `sleeper_raw`, etc.
- Populated: at insert time, by the sync script that brought the data in
- Never modified: once written for a given (source, row) snapshot, the metadata reflects what we received at that moment

For canonical merged tables like `players` where one row represents the union of multiple sources, store `metadata` as a jsonb map keyed by source slug: `{"sleeper": {...}, "ktc": {...}}`. The sync script for each source updates only its own key — merge before upsert so other sources' payloads aren't clobbered.

NEVER drop raw source data on the floor during ingestion. Even if we "only need 3 fields right now," store the full object.

Tables currently subject to this rule: `player_value_history`, `rankings`, `projections`, `player_stats`, `news_items`, `players`. Add to this list whenever a new ingestion table lands.

### Pre-Calculated (Derived) Tables

Pre-calculated tables (`player_value_trends`, and any future siblings) are derived from raw history tables. They get recalculated by scheduled scripts (e.g. `scripts/calculate-trends.ts`), not via triggers. Pages should read from these pre-calc tables for performance, not calculate on the fly from raw history.

Pre-calc tables do NOT need a `metadata` jsonb column since they are derived from internal data, not external sources. Their provenance is the script that produced them, recorded in the script's git history.

When the underlying raw table changes (e.g. a value sync writes new rows to `player_value_history`), the corresponding pre-calc table must be recalculated. Chain the recalc into the relevant sync script (see `npm run sync:ktc:full`). Data scarcity is handled gracefully: when not enough history exists for a window (e.g. fewer than 7 days), the corresponding `*_ago` / `change_*` / `trend_*` fields are NULL. UI consumers gate display on `data_points_30d` (default threshold: 7).

### Historical backfill on source integration

When integrating a new data source, investigate historical API access during the same session. If historical data is available, write a backfill script and run it BEFORE the source goes live in nightly syncs. This avoids users seeing empty trend data after launch. If no historical access exists, document the limitation in `docs/data-sources.md` and accept that trends will accumulate from launch date forward.

ABSOLUTE RULE: Backfill is a one-time operation. NEVER wire it into the nightly cron. Re-runs must be idempotent via the relevant unique constraint, but should not be scheduled — they would burn the public endpoint's resources for no new data.

The backfill script for an existing source lives at `scripts/backfill-<source>-history.ts` and is invoked via `npm run backfill:<source>`. The canonical post-backfill chain (`npm run backfill:all`) runs every available backfill script and then `scripts/calculate-trends.ts` so the derived `player_value_trends` table reflects the freshly-imported snapshots.

### When These Rules Apply

- Every new table that ingests external data
- Every new column on existing tables
- Every refactor of existing tables
- Sub-agent implementation reviews must verify these rules on any schema work
- If you find existing tables that violate these rules, fix them
