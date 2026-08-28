# FF Beacon - Project Instructions for Claude Code

## Critical Rules (Read Every Session)

1. **Environment variables**: Always read .env.local FIRST at the start of every session. Echo back the variable names you find. The project uses NEW Supabase keys: SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY. NEVER use anon key or service_role key names.

2. **Never move config files**: .env.local, .env.local.example, .mcp.json, .claude/, CLAUDE.md, plan.md, progress.md stay in place permanently. Do not create backup copies.

3. **Reference project**: ~/Desktop/dynasty-price-check/ is READ-ONLY reference. Look at it for patterns. Never write to it. When porting features from DPC, preserve the FUNCTIONAL UX flow (inline expansion, modal patterns, navigation structure, side-by-side comparison, sticky toolbars) unless explicitly approved to diverge. The VISUAL style must always be FF Beacon brand (dark mode, purple #A855F7 + cyan #22D3EE, Geist fonts), never DPC's gold/violet on `#0c0c18`. Information density and interaction patterns travel; colors and typography do not.

   ABSOLUTE RULE: When porting features from DPC, the implementation is NOT COMPLETE until the actual UX behavior matches. Visual styling is FF Beacon brand. Functional behavior, layout structure, default states, filter behaviors, and interaction patterns MUST match DPC unless explicitly approved otherwise. Verify by opening DPC's implementation alongside the FF Beacon implementation and confirming each interaction works the same way. "Coming soon similar" or "partially matches" is not acceptable: either match it or get approval to diverge BEFORE declaring the work complete. Before marking any DPC port complete, walk through this checklist out loud in the final report and cite DPC file paths + line numbers as evidence:
   - Default state on first paint matches DPC?
   - Every filter/toggle behaves identically (action verb match: filter vs anchor-jump, expand vs navigate, multi-select vs single-select)?
   - Layout structure matches (rows vs cards, sections vs columns, sticky vs scrolling)?
   - Empty / loading / error states match?
   - Keyboard + screen-reader interaction patterns match (aria-pressed semantics, focus management, announcement quality)?
   - Mobile layout retains every piece of data the desktop version shows?
   If any answer is no, fix it before reporting complete. Re-attempts on a previously-shipped port must explicitly cite the DPC line numbers that prove parity.

4. **Supabase project ID**: This project uses Supabase project `cilvpyivysjxpxbudkfa` (the one wired into .mcp.json). Do not reference any other project IDs or credentials files on the user's desktop.

5. **Output handling**: This project owner uses a screen reader. Always:
   - Put copyable content in code blocks
   - Keep responses concise and direct
   - Reference UI elements with their on-screen location when giving instructions

6. **No AI-tell punctuation (ABSOLUTE RULE)**: Never use the em-dash (the long dash) or any other character that signals AI-generated writing. This applies EVERYWHERE: chat responses, code, comments, commit messages, UI copy, docs, alt text, ARIA labels, option labels, migration comments, and any generated content. Banned characters and the plain replacement to use instead:
   - Em-dash and en-dash: rewrite the sentence, or use a comma, colon, or parentheses. Use a hyphen only for genuinely hyphenated words.
   - Curly/smart quotes and apostrophes: use straight quotes (`"` and `'`).
   - Ellipsis character: use three periods only when truly needed.
   - Middle dot / bullet character used as inline separator: use a plain comma or the word "and".
   - Non-breaking spaces and any other typographic flourishes: use a normal space.
   Stick to plain ASCII punctuation. When in doubt, restructure the sentence so no special dash is needed. This rule is non-negotiable and overrides any stylistic habit.

7. **Never chain shell commands (ABSOLUTE RULE)**: Run every shell command as its own separate tool call. Do NOT join commands with `&&`, `;`, `||`, or pipe chains just to batch them, and do NOT use `cd ... ; command` prefixes. The project owner has to approve each command through a permission guard, and a chained command forces a fresh approval prompt for the whole string every time, which slows the dev loop badly. One command per tool call. The only exception is a genuine data pipeline where one command's output must feed directly into the next (for example `something | grep`) and there is no way to express it as separate calls; even then, prefer the dedicated Grep/Glob/Read tools over shell pipes. When you have several independent commands to run, issue them as multiple separate tool calls (in parallel when they do not depend on each other), never strung together in one shell line.

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

**Public read-only data** (players, format_configs, rankings, player_value_history, player_value_trends, projections, player_stats, articles, news_items, vote_matchups, source_registry, leagues, rosters, league_users, league_transactions, draft_pick_values, league_power_rankings_cache):
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


## Time Display (Non-Negotiable)

ABSOLUTE RULE: Every timestamp shown ANYWHERE on the front end (public pages, the admin panel, the Beacon Brief admin, OG images, emails, anything a human reads) MUST be displayed in the America/New_York timezone, regardless of the viewer's device zone or the server's zone (Vercel runs UTC). This is a DISPLAY concern only: stored timestamps stay in UTC, the database is never changed for display.

How to comply:
- Use the helpers in `lib/datetime.ts`. `formatEastern(iso)` renders a full date + time with the zone label (for example "Jun 12, 2026, 7:30 AM EDT"). The exported `SITE_TIME_ZONE` constant is `"America/New_York"`.
- NEVER call `new Date(x).toLocaleString()` / `toLocaleDateString()` / `toLocaleTimeString()` or construct a bare `new Intl.DateTimeFormat(...)` without a `timeZone`. In a client component a bare call uses the browser's zone; on the server it uses UTC. Both are wrong.
- For any custom `Intl.DateTimeFormat` or `toLocale*` formatter, pass `timeZone: SITE_TIME_ZONE`. When the output includes a time of day, also pass `timeZoneName: "short"` so the zone (EST/EDT) is visible. Note: `timeZoneName` cannot be combined with `dateStyle`/`timeStyle`, so use explicit component options (year/month/day/hour/minute) when you want the label.
- The label auto-switches between EST and EDT with daylight saving, do not hardcode "ET"/"EST"/"EDT".
- Relative formatters ("3 hours ago") are zone-independent and need no change.

Sub-agent reviews of any UI that renders a date or time must verify it resolves through `lib/datetime.ts` or carries an explicit `timeZone: SITE_TIME_ZONE`.


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

Tables currently subject to this rule: `player_value_history`, `rankings`, `projections`, `player_stats`, `news_items`, `players`, `leagues`, `rosters`, `league_users`, `league_transactions`, `draft_pick_values`, `player_market_snapshots`. Add to this list whenever a new ingestion table lands.

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

## League Pulse feature (continuous flow)

League Pulse is ONE continuous user journey, not multiple features. The journey:

1. `/tools/league-pulse` — entry point. User enters Sleeper username and season, sees their leagues. No DB writes happen here; data comes straight from Sleeper.
2. `/dashboard` — logged-in users persist their Sleeper username on user_preferences and see the same league list cached for fast return visits.
3. `/leagues/[sleeper_league_id]` — the deep view. Clicking "Open league" on any card from #1 or #2 is a plain `<Link>` navigation to the deep view, so the branded loading boundary shows immediately on click. The deep-view page calls `lib/league-pulse.ts pulseLeague` on every render (writes to `leagues`, `rosters`, `league_users`, `league_transactions` via service-role); the 60-minute cache inside `pulseLeague` short-circuits redundant Sleeper hits (power rankings recompute at most once per 24h on the cached path). A sync failure renders a branded retry state (`components/league-load-error.tsx`), not a redirect or 404.
4. `/leagues/[sleeper_league_id]?tab=teams` plus the full routes `/leagues/[sleeper_league_id]/schedules`, `/leagues/[sleeper_league_id]/power-pulse`, `/leagues/[sleeper_league_id]/trade-ideas` and `/leagues/[sleeper_league_id]/transactions` (the tabbed deep view). Overview and Teams render inline on the deep view; the other four are their own routes. Every tab renders from the synced rows; never re-derives from Sleeper.

Naming rules:
- Feature name in copy/docs: "League Pulse".
- Routes: `/tools/league-pulse` (entry), `/dashboard` (saved leagues), `/leagues/[sleeper_league_id]` (deep view), `/leagues/[sleeper_league_id]/schedules` (week and team schedule views), `/leagues/[sleeper_league_id]/schedules/[week]/[roster_id]` (one matchup, both starting lineups), `/leagues/[sleeper_league_id]/power-pulse` (expected performance), `/leagues/[sleeper_league_id]/positional-war` (the Positional WAR curve plus the upgrade what-if), `/leagues/[sleeper_league_id]/trade-ideas` (suggestions plus the trade builder), `/leagues/[sleeper_league_id]/transactions` (feed), `/leagues/[sleeper_league_id]/teams/[roster_id]` (team deep view, future phase).
- `/leagues/[sleeper_league_id]/trade-finder` was renamed to `trade-ideas`. `next.config.ts` holds a permanent 308 for the old path; keep it forever, shared links use it.
- Page titles: plain descriptive ("League Overview", "Power Rankings", "Team Roster", "Transactions"). No "Dynasty Decoder", "DPC", or any DPC-derived branding anywhere in code, UI, copy, or share artifacts.
- Tabs within `/leagues/[sleeper_league_id]` use plain functional labels.

Sync rules:
- `/leagues/[sleeper_league_id]/positional-war`, like every other section route, calls `pulseLeague` and never writes to league tables directly.
- All writes flow through `lib/league-pulse.ts`. Do not write to `leagues`, `rosters`, `league_users`, or `league_transactions` from anywhere else. If you need a one-off, run `npm run pulse:league -- <id>` or `npm run pulse:league -- <id> --force`.
- The sync has two halves, both in `lib/league-pulse.ts`. `pulseLeagueCore(supabase, sleeper_league_id, { force })` fetches the league, rosters, members, and drafts: everything a page must have before it can render. `pulseLeagueDerived(supabase, league_row_id, { force, resynced })` does transaction history, trade-value power rankings, and Power Pulse. `pulseLeague(...)` runs both and is what scripts and the refresh endpoint call. The deep view calls the halves separately so the header paints while the derived work streams in behind a Suspense boundary; any page that only needs one await should keep calling `pulseLeague`.
- Both halves coalesce per league in-process: concurrent renders (or a warm-up request that lands mid-render) share one execution instead of starting duplicate syncs.
- ABSOLUTE RULE: `leagues.last_pulsed_at` and `pulse_status='complete'` are stamped only AFTER the child rows are persisted, never before. Stamping first makes an interrupted sync look fresh, and the 60-minute cache then serves that half-written state back instead of retrying it. The in-progress marker is `'syncing'` (one of the four values `leagues_sync_status_check` permits: `pending`, `syncing`, `complete`, `error`).
- `/api/leagues/[league_id]/warm` starts a league's sync from a hover or focus on the entry list, via `lib/use-league-warmup.ts` and `components/league-open-link.tsx`. It is the same work the page does, so it needs no separate rate limit; the 60-minute cache bounds how often it can reach Sleeper.
- Cache TTL: 60 minutes (`LEAGUE_PULSE_TTL_MS`). `force=true` bypasses; `force=false` (default) skips the Sleeper refetch and returns cached: true if the DB row is fresh (last_pulsed_at within the TTL). Only a stale cache (over 60 minutes) or a league with no DB rows triggers a full Sleeper sync.
- Power rankings recompute TTL: 24 hours (`LEAGUE_POWER_RANKINGS_TTL_MS`). Power rankings depend on player values that sync once nightly, so `pulseLeague` recomputes them at most once per 24h per league (gated by the freshest `league_power_rankings_cache.generated_at`), on BOTH the cached and full-sync paths. The first load after the window elapses (or a league with no cache rows) recomputes; reloads inside the window serve the existing cache untouched. `force=true` always recomputes. Do not recompute power rankings unconditionally on every load.
- Format derivation lives in `lib/sleeper-to-format.ts`. If a Sleeper league's scoring or roster shape does not map cleanly to one of the 8 active `format_configs.slug` rows, the function returns null and `leagues.format_config_id` is left null. The UI must handle "Unmatched" gracefully (display the slug as Unmatched, do not crash).
- `pulseLeague` chains into `lib/league-power-rankings.ts calculateLeaguePowerRankings(supabase, league_id)` after a successful sync. The calc iterates every active (format, source) combo and upserts `league_power_rankings_cache` rows so the deep view can flip format/source without recomputing. A calc failure is logged but does NOT fail the parent sync — the cache row is non-critical.
- ABSOLUTE RULE: League power rankings are recomputed ONLY on demand, when a league deep view loads through `pulseLeague` (gated to at most once per 24h per league, on both the cached and full-sync paths; `force=true` always recomputes), or via the manual `npm run calculate:power-rankings`. NEVER wire per-league power-ranking recomputation into a nightly cron. The nightly `/api/cron/recalculate-derived` job rebuilds only the global `rankings` and `player_value_trends` tables; it must not iterate leagues. Recomputing every stored league nightly does not scale to tens of thousands of leagues, and unviewed leagues never need a cache row.
- Standalone recalc: `npm run calculate:power-rankings` (all leagues) or `npm run calculate:power-rankings -- --sleeper-league-id <id>` (one league). Run this after `npm run sync:ktc:full` if you want power rankings to reflect freshly-synced player values without re-running every league pulse.

Draft pick values:
- KTC publishes dynasty draft picks alongside players in the same scraped payload (position=RDP). `scripts/sync-ktc.ts` parses those rows via `lib/ktc-picks.ts parsePickName` and writes to `draft_pick_values` for `dynasty-ppr-std` and `dynasty-ppr-sflex`. The TEP-sflex pick values are copied byte-for-byte from `dynasty-ppr-sflex` because picks have no TE position so the TEP multiplier is a no-op.
- KTC does NOT publish redraft picks. Do not fabricate redraft pick rows; the power-rankings calc treats missing pick values as 0 contribution.
- Pick lookup uses (season, round, pick_position) as the key. The current sync writes `pick_position` as the bucket KTC publishes ("early", "mid", "late"); if a roster's pick descriptor lacks a slot we default to "mid" when reading.

Sleeper API access:
- All Sleeper endpoints live in `lib/sleeper.ts`. Do not call `api.sleeper.app` directly from pages, server actions, or other lib files. Add new endpoints to `lib/sleeper.ts` as exported functions with 20-second timeouts and null-on-failure semantics, matching the existing pattern.
- Sleeper sends transaction `draft_picks` as array OR object OR JSON string OR null. Always normalize via `lib/league-pulse.ts normalizeDraftPicks` (or copy the pattern) before persisting or rendering.
- Sleeper uses the string `"0"` as a placeholder for empty roster slots. Strip these out with `validPlayerId` before storing or rendering player IDs.

Admin:
- `user_preferences.is_admin` is the admin flag (migration 0018). A trigger blocks self-promotion; flipping the bit requires service_role.
- Admin-only actions (force-refresh) live behind both an auth gate AND a 60-second per-league rate limit. The endpoint at `app/api/leagues/[league_id]/refresh/route.ts` re-validates auth independently of the client — never trust the `RefreshButton` `isAuthorized` prop as a security boundary.
- Authorization is "admin OR commissioner of this league". Commissioner detection matches `user_preferences.sleeper_username` against `league_users.display_name` where `is_commissioner=true`. See `lib/league-auth.ts → getLeagueAdminContext()`.
- Rate limit ledger lives in `league_refresh_attempts` (migration 0025), service-role-only. The endpoint writes the timestamp BEFORE running the sync so concurrent requests fail with 429 instead of all hitting Sleeper.

## Power Pulse (League Pulse expected-performance score)

Power Pulse is the primary power ranking inside League Pulse. It estimates how many games a team should win from here, as a 1-99 score ranked WITHIN its own league. The trade-value ranking (`league_power_rankings_cache`) still exists and answers a different question: who owns the most.

ABSOLUTE RULE: Power Pulse NEVER counts draft picks. It is a competitive score, and a future pick cannot start in a lineup. Picks remain in the trade-value rankings only.

ABSOLUTE RULE: Power Pulse does NOT vary by value source or by `format_config_id`. It is computed from Sleeper's weekly projections rescored under the league's own literal `scoring_settings`, so there is exactly one row per (league, roster, season) in `league_power_pulse_cache`. Never add a format/source loop to it. The source toggle on a league page must not invalidate it.

ABSOLUTE RULE: The rankings table on `/leagues/[id]` defaults to Power Pulse ordering. `?rank=value` restores the trade-value ordering. Whichever mode is active, BOTH numbers stay visible (the Pulse column and the Value column with its rank), so switching never hides data.

ABSOLUTE RULE: Power Pulse is recomputed ONLY on demand through `pulseLeague` (gated by `POWER_PULSE_TTL_MS`, 12 hours, plus a recompute whenever the live NFL week passes the stored `through_week` or the stored `model_version` changes), or manually via `npm run calculate:power-pulse`. NEVER wire per-league Power Pulse into a nightly cron, for the same scaling reason as league power rankings.

ABSOLUTE RULE: never cache a Power Pulse computed without a real remaining schedule. `calculateLeaguePowerPulse` writes nothing when there are no unplayed regular-season games (no published slate, nothing drafted, season already over), and additionally clears any rows already stored for that league season, because a stale degenerate row outlives the run that produced it. Scoring an empty slate yields 0.0 projected wins and 0%/100% playoff odds for every team, which reads as a real answer and is not one.

ABSOLUTE RULE: a failed Sleeper request is not evidence about a league. `getSleeperMatchups` returns `null` on a failed request and `[]` only when Sleeper answered with no games, and `syncLeagueMatchups` reports `failedWeeks`. When any week failed, Power Pulse skips the run and leaves the existing cache alone rather than concluding the league has no schedule. Never collapse those two cases back together: doing so is what let a throttled fetch cache a whole league at 0.0 wins for the full 12-hour TTL.

Recency is a product requirement, not an implementation detail: in `player_projection_accuracy`, the CURRENT season's beat-rate and reliability data MUST outweigh prior seasons, because roles and offenses change year to year. The season weights live in `league_power_pulse_settings.settings.recency` and are admin-editable. Prior seasons still contribute at a reduced weight; they are never dropped.

Module map:
- `lib/league-scoring.ts` — scores any Sleeper stat/projection map under a league's own `scoring_settings` (a dot product; Sleeper emits `bonus_rec_te` / `bonus_rec_wr` / `bonus_rec_rb` and the kicker + defense buckets as stats, so TE premium and DEF scoring need no special cases). Reusable for the future custom-scoring feature.
- `lib/power-pulse/lineup.ts` — exact optimal lineup fill. Greedy by descending points with augmenting paths (a transversal matroid, so greedy is provably optimal). Plain greedy is WRONG for leagues with overlapping non-nested slots (WR_TE alongside WRRB_FLEX); do not "simplify" it back.
- `lib/power-pulse/simulate.ts` — seeded Monte Carlo season plus bracket. The seed is fixed on purpose so odds do not drift between recomputes.
- `lib/power-pulse/engine.ts` — the calculation. Pure; takes plain data.
- `lib/league-power-pulse.ts` — orchestrator + `refreshPowerPulse()` (never throws; a league page must render without it).
- `lib/league-matchups.ts` — Sleeper schedule sync. Sleeper publishes the FULL season schedule at league creation, so weeks 1-18 are available in the preseason. Fetch policy: full slate once, then only the current week plus two ahead (lineups move; the schedule does not).

Opponent strength is OURS, not Sleeper's. ABSOLUTE RULE: do not derive strength of schedule from Sleeper's weekly projections. They are effectively a season average repeated 18 times (measured spread across a 2026 player-season is only 2.6% to 5.4%), so any SOS built on them ranks every team identically. `nfl_defense_vs_position` is computed from `player_stats` (which carries `opponent` on every row back to 2020) and produces a real 0.80-1.25 spread.

Model config lives in `league_power_pulse_settings` (single `id='global'` row, service-role only) with code fallbacks in `lib/power-pulse/default-settings.ts`, admin-edited at `/admin/power-pulse`, validated server-side by `lib/power-pulse/validate.ts`. Saving does NOT fan out recomputes; bump `modelVersion` to force every league to rescore on next view.

Observability: `leagues.power_pulse_status` (`pending`, `ok`, `skipped`, `settled`, `error`) plus `power_pulse_detail`, `power_pulse_attempted_at` and `power_pulse_succeeded_at` (migration 0215). `refreshPowerPulse` writes the verdict rather than only logging it, backs off `POWER_PULSE_RETRY_MS` (15 minutes) after any non-`ok` verdict, and the panel reads the status so a reader is told which honest reason applies instead of "still calculating" forever. `/admin/system/league-health` lists both this and Positional WAR.

## Positional WAR (League Pulse positional scarcity)

Positional WAR is a multi-series curve, one line per position, showing wins over replacement by position rank, specific to the league being viewed. It answers "which positions are worth spending on in THIS league", and the shape of the line is the answer: steep means the position runs out fast, flat means the next player down is nearly as good.

ABSOLUTE RULE, the naming rule. The token "WAR" names exactly ONE metric in this product, the player-independent positional one, and it carries the word "Positional" adjacent to it on first use in any surface. Nothing that measures one specific roster may be called WAR, in code, in copy, in a column name, or in a chart axis. Team-specific work stays `winsDelta` / `expectedWins` in code and "projected wins" / "wins added" in copy. A surface that shows both must show both labels and must NOT place them in the same column. `lib/positional-war/naming.test.ts` enforces this: inside `lib/trade-impact/`, `lib/faab/` and `lib/power-pulse/`, every occurrence of the token `WAR` must have the literal `Positional` within 40 characters before it.

The two metrics, and why they legitimately disagree: Positional WAR is player-independent, evaluates every player against a league-average reference team and a league-average opponent, reads NO roster, and runs the lineup optimizer once per week per league. Projected wins is team-specific, depends on who owns whom, and reruns the optimizer per candidate (`lib/power-pulse/what-if.ts`, `lib/faab/marginal.ts`). A league where QB1 carries 0.65 Positional WAR still gives a reader who already starts QB2 almost no wins added by acquiring him.

ABSOLUTE RULE: the optimizer is NEVER rerun per player inside `lib/positional-war/`. Every quantity is read off ONE merged fill per week and the rest is arithmetic. A per-player refill loop would be 1,083 times more expensive AND would compute the team-specific metric under the Positional WAR name, which is exactly what the naming rule forbids.

ABSOLUTE RULE: Positional WAR does NOT vary by value source or by `format_config_id`, for the same reason Power Pulse does not. It is built from Sleeper projections scored under the league's own literal `scoring_settings`. Flipping the source toggle must not invalidate the cache, and `source` is deliberately absent from the fingerprint. Draft picks contribute nothing: a 2028 first cannot start.

ABSOLUTE RULE: recomputed ONLY on demand, through `pulseLeague` (gated by `POSITIONAL_WAR_TTL_MS`, 12 hours, plus a fingerprint change, a model version change, or the week window advancing), or manually via `npm run calculate:positional-war`. NEVER wire per-league Positional WAR into a nightly cron, for the same scaling reason as league power rankings. The nightly job's only Positional WAR work is a single seven-day prune of `positional_war_curves`, which iterates no leagues.

Structural versus weekly demand is a specification, not an implementation detail. `structural_demand` is one integer per position from the BYE-FREE fill, and it drives the x-axis, the depth cap, every label, and every sentence of copy. Weekly seated counts drive replacement level only, because a bye week genuinely lowers replacement and that is exactly the week a starter is worth most. A consequence that must be stated in the UI and must not be "fixed": the curve does not cross zero at `x = 1.0`, so the marker there is labeled with its real value (`war_at_demand`), never with an asserted zero.

Module map:
- `lib/positional-war/types.ts` — shared shapes, and the naming rule in its header.
- `lib/positional-war/fingerprint.ts` — the exact invalidation key. Pure, clock-free.
- `lib/positional-war/replacement.ts` — the merged fill, structural and weekly demand, replacement / avgSeated / deficit / muRef / sigmaRef.
- `lib/positional-war/war.ts` — PAR, the two lineups, and the win conversion. The anti-double-count lives here.
- `lib/positional-war/engine.ts` — `computeCurves()`. Pure; takes plain data.
- `lib/positional-war/load.ts` — the cached full-universe projection read, keyed `(season, fromWeek, toWeek, scoringBase)`.
- `lib/positional-war/chart-geometry.ts` — the path maths, shared by the on-page chart and the OG route so the two can never disagree about a league.
- `lib/league-positional-war.ts` — orchestrator + `refreshPositionalWar()` (never throws).

Storage: `league_positional_war_cache`, one row per (league, season, position), six rows for a normal league. `positional_war_curves` is keyed by fingerprint and shares the COMPUTE across leagues on the WRITE path only; the read path is unchanged, so every consumer still issues exactly one query against the per-league table. It is service-role only and nothing in the UI reads it.

Observability: `leagues.positional_war_status` / `_detail` / `_attempted_at` / `_succeeded_at` (migration 0212), `POSITIONAL_WAR_RETRY_MS` 15 minutes, and the `settled` verdict clears stored rows the same way Power Pulse does, because a degenerate answer outlives the run that produced it. `positional_war_detail` is server-written, never user-controlled, and rendered as text, never as HTML.

## Schedules (League Pulse)

`/leagues/[id]/schedules` is the week view and the team view, driven by
`?view=week&week=N` or `?view=team&roster=N`, so both are linkable.
`/leagues/[id]/schedules/[week]/[roster_id]` is one matchup with both starting
lineups. Keyed on week plus roster rather than `matchup_id`, because that column
is nullable when Sleeper leaves a roster unpaired.

ABSOLUTE RULE: Sleeper's `starters` array is POSITIONAL. `starters[i]` is the
player in the i-th startable slot of `roster_positions`, and an unfilled slot is
the string `"0"`. `lib/league-matchups.ts` stores it VERBATIM, placeholders
included, and every reader filters. Do not reintroduce a filter at write time:
it shifts every slot below the gap up by one and puts players in the wrong slots.
`lib/league-matchups.test.ts` and `lib/power-pulse/load.test.ts` both fail if it
comes back.

`lib/league-schedule/slots.ts alignedStartingSlots()` keeps every non-bench
token, including IDP. It deliberately differs from `lib/power-pulse/lineup.ts
startingSlots()`, which drops tokens it cannot project. Both are correct for
their own caller. Do not unify them.

ABSOLUTE RULE: a null projection is never a zero. Sleeper publishes projections
for QB, RB, WR, TE, K and DEF only (`PROJECTION_POSITIONS` in `lib/sleeper.ts`),
so IDP slots render the player with the words "No projection" and are excluded
from totals with a footnote saying how many. A zero would sum into the total and
be believed.

The board reads every projected number from `league_power_pulse_cache.weekly`
rather than recomputing, so the Schedule page and the Power Pulse page can never
report different projections for the same team and week. The matchup detail
projects about 60 players for ONE week. No new table, no cron.

Venue is never claimed. Sleeper's `opponent` is a bare team code with no home or
away marker, so `opponentLabel` renders the code as itself. A leading "@" is
honoured for the day `player_weekly_projections.game_id` gets parsed.

## Trade Ideas (League Pulse)

`/leagues/[id]/trade-ideas`, two modes on one page: `mode=suggested` (the
existing `lib/trade-finder/` engine, unchanged) and `mode=build` (any trade you
propose). Both render the same `TradeVerdict`, so a suggested trade and a built
one get the identical evaluation.

`lib/trade-impact/` is the impact model. It answers two questions that routinely
disagree and says both: VALUE (what the assets are worth) and WINS (the optimal
lineup week by week against the real remaining schedule, through the same Monte
Carlo season Power Pulse uses). A deal that adds value and costs wins is right
for a rebuilder and wrong for a contender, and the reasons say so.

ABSOLUTE RULE: rate limiting covers EVERY path that can run an evaluation, and
there are three: the server action, the SERVER RENDERED page path (`?mode=build`
decodes a trade from the URL and evaluates it during render, with no action id
and no JavaScript involved), and the streamed evaluation under the on-screen
suggestion. All three claim from ONE bucket via
`lib/trade-impact/rate-limit.ts claimTradeEvaluationSlot()`, at 10 per minute per
actor. One bucket, so alternating paths cannot buy a second budget.

ABSOLUTE RULE: validate BEFORE claiming a slot. Shape check, then ownership,
then the claim, then the expensive half. A stale link must not burn a reader's
budget and garbage input must gain an attacker nothing.

ABSOLUTE RULE: ownership is re-derived from `rosters.player_ids`, never trusted
from the caller. A forged proposal would otherwise produce a confident, fully
reasoned evaluation of a trade that cannot happen.

ABSOLUTE RULE: reasons are deterministic templates, never a language model.
Every sentence cites a figure present in the input, and a null figure means the
reason does not fire. Every sentence is checkable against the numbers on the same
screen, which a generated one would not be.

`lib/power-pulse/what-if.ts simulateWithReplacements()` is the one copy of the
before/after season simulation. FAAB and Trade Ideas both call it. If a change
there breaks `lib/faab/*.test.ts`, revert it rather than editing a FAAB test.

Only the two teams in a trade are projected. Every other team's weekly
distribution is read from `league_power_pulse_cache.weekly`. The two involved
teams use the freshly computed baseline on BOTH sides of the comparison, never
the cached one, or every difference between the two computations gets attributed
to the trade.

## League Pulse Format Resolution

ABSOLUTE RULE: Inside league views (`/leagues/[id]` and all descendants, plus `/api/og/*` routes that render values from those views), the format used for value calculations is derived from the league's actual Sleeper scoring settings, NOT the user's global format toggle. Source remains user-controlled. Pick values always fall back to KTC. The global header format toggle has no effect inside a league view. This will change when FF Beacon native rankings with custom scoring exist (see plan.md "Future: User Custom Scoring Formats").

The single source of truth is `lib/league-format-resolution.ts → resolveLeagueContext()`. Every page under `/leagues/[id]/**` and every `/api/og/*` route that needs values MUST call this resolver. Do not re-derive format from `?format=` URL params, cookies, or `user_preferences.default_format_config_id` inside a league view; those signals are ignored by contract.

The resolver returns a `LeagueContext` carrying:
- `formatSlug` / `formatDisplay` / `formatConfigId` — what to query against
- `sourceSlug` / `sourceDisplay` — the user's chosen source (or first-priority active source)
- `coverage` — `'exact'` | `'fallback'` | `'none'`
- `fallback` — when coverage is `'fallback'`, carries the original derived format the source can't cover (drives the explanatory banner)
- `derived` — the structural format derived from Sleeper (used for `describeDerived()` plain-language descriptions)
- `pickSource` — null when the player-value source covers picks; otherwise the (slug, display) of the source we'll use for picks. Today this is always KTC when set. UI surfaces a "Draft pick values powered by KTC" footnote when non-null.

ABSOLUTE RULE: Shareable images and social card metadata must never reference DPC or use DPC visual branding. All OG content uses FF Beacon brand: dark background (#07070D / #0F0F1A), purple→cyan beacon gradient, Geist font stack, "FF Beacon" wordmark, "ffbeacon.com" footer. Gold accents (DPC's signature) and `#0c0c18` (DPC's bg) are explicitly forbidden in OG output. Sub-agent reviews of OG routes must verify the brand check.

OG image routes:
- `/api/og/league/[league_id]` — league overview card (name, season, team count, top 3 by power ranking)
- `/api/og/team/[league_id]/[roster_id]` — team summary (record, total/starter/bench/picks values, top 5 players)
- `/api/og/trade/[transaction_id]` — trade analysis (both sides with values + differential + verdict)

All three use `next/og` `ImageResponse` at `runtime = 'nodejs'`, 1200x630, cached via `Cache-Control: public, s-maxage=3600, stale-while-revalidate=86400`. Values rendered inside the OG image use the league's contextual format per the rule above; pass `?source=` to override the source slug for shareable variants.

Transactions:
- Feed page: `/leagues/[sleeper_league_id]/transactions` — paginated, filterable by type / team / week / season.
- Tab on `/leagues/[sleeper_league_id]` shows the most recent 10 with a "View all transactions →" link.
- Shared row component: `components/transaction-row.tsx`. Trades render the side-by-side analyzer with per-side totals and a verdict. Non-trades render adds / drops / picks / FAAB lists.
- Trade analyzer lib: `lib/trade-analyzer.ts → analyzeTrade()`. Reads player values from `player_value_trends`; reads pick values from `draft_pick_values` keyed by the resolved pick source (always KTC today).

## Would You Rather (the trade voting game)

`/games/would-you-rather`. A real trade out of a synced Sleeper league, stripped
of every name that identifies the two managers, put in front of a reader who
calls the winner. After the vote: how the room voted, the full Signal Check
verdict, and what that league's own numbers say about the pieces.

ABSOLUTE RULE: NOTHING THAT HINTS AT THE ANSWER MAY REACH THE BROWSER BEFORE THE
VOTE IS RECORDED. `WyrRound` (the board) carries names, positions, pick seats and
the league's format, and carries no value, total, margin, verdict, confidence or
tally. `WyrReview` (the reveal) is assembled by the vote route AFTER the vote row
is written and returned in that response. Never pass review-shaped data to a
client component as a prop: anything handed to one is serialized into the page's
flight payload, where a reader can read it out of view-source before pressing a
button. This is the same trap the Signal Scout leaderboard rail had to be pulled
back out of.

ABSOLUTE RULE: A VOTE IS NEVER COUNTED TWICE, AND THE DATABASE IS WHAT GUARANTEES
IT. Two partial unique indexes on `would_you_rather_votes` (one keyed on
`user_id`, one on `guest_id`; a single composite would not work, because a null
in a unique tuple does not collide in Postgres). The insert is ATTEMPTED and a
23505 is read as "already voted"; a "have they voted?" SELECT followed by an
INSERT is a race two fast clicks win. A repeat returns the reveal for the side
originally picked and burns no free vote.

ABSOLUTE RULE: NOBODY IS NAMED. The two managers are Team A and Team B on the
page, in the Discord poll, in the announcements and in every sentence of the
review. `league_users` is never queried on this path, and the Power Pulse view's
`teamName` and `ownerHandle` are dropped rather than carried into the DTO. Which
roster is Team A is PINNED on the pool row (lowest Sleeper roster id first,
matching how `lib/league-signal-check.ts` orders sides), so the label means the
same roster everywhere, forever.

ABSOLUTE RULE: this feature only READS `league_positional_war_cache` and
`league_power_pulse_cache`. It never triggers a compute, and must never be made
to: those are on-demand-only through the league deep view, for the scaling
reasons stated in their own sections above. A league without curves gets an
honest "not built yet" line, not a fabricated zero.

The pool (`would_you_rather_trades`) holds only trades Signal Check has ALREADY
graded successfully, so serving a round is a cheap read rather than a discovery.
Topped up inline when it runs thin, in bulk by `npm run wyr:pool`, and from the
admin panel. Retiring a trade never deletes its votes.

Guests get `guest_vote_limit` rounds (2 by default) then the sign-in state. The
allowance is checked BEFORE any grading work, so a reader who cannot vote never
costs a query budget. It is a courtesy, not a security boundary; the tally's
integrity rests on the unique indexes, not on the cookie.

Module map:
- `lib/would-you-rather/types.ts`: the two DTOs, and the line between them.
- `lib/would-you-rather/settings.ts` / `default-settings.ts`: one global jsonb
  row, same shape as `signal_scout_settings`. Admin-edited at
  `/admin/would-you-rather`, validated server-side.
- `lib/would-you-rather/grade.ts`: the one wrapper over `analyzeLeagueTrades`,
  shared by the pool builder and the round loader so the pool can never admit a
  trade the round loader would fail on.
- `lib/would-you-rather/pool.ts`: sampling and grading. Random offset over uuid
  order rather than `order by random()`, which PostgREST cannot express.
- `lib/would-you-rather/round.ts`: selection, `loadRound`, `buildReview`.
- `lib/would-you-rather/identity.ts` / `vote.ts`: who is voting, and the write.
- `lib/would-you-rather/schedule.ts`: the Discord schedule, in Eastern. Pure.
- `lib/would-you-rather/routing.ts`: which channel a league type posts to, and
  which types are postable at all. Pure.
- `lib/discord-poll-voters.ts`: the bot-authenticated, paginated read of who
  voted on one poll answer. Every failure is a reason, never a throw, because
  the caller has an aggregate fallback.
- `lib/would-you-rather/side-names.ts`: Signal Check's templates say "Side A";
  this surface has no other name for the parties, so the sentence is renamed on
  the way out, and only here.

Discord poll:
- ONE HOURLY CRON, `/api/cron/would-you-rather-discord`, and the SCHEDULE lives
  in the admin panel. Ticking three hours is three posts a day; ticking one is
  one. It is deliberately not three fixed cron entries: a cron expression cannot
  express a time an admin picks without a deploy, and a UTC hour silently shifts
  by one twice a year, so a job pinned to 12:00 UTC is 8am Eastern for seven
  months and 7am for five with nobody told.
- Off by default. Nothing posts until an admin chooses a webhook and turns it on.
- A webhook, not the bot: Discord accepts a `poll` on a webhook execute, and
  `GET /webhooks/{id}/{token}/messages/{id}` returns that poll's results
  authenticated by the token already in the URL. No bot permission, channel id
  or gateway connection is involved.
- ONE CHANNEL PER LEAGUE TYPE. `settings.discord.routes` maps each of the four
  `lib/league-category.ts` buckets (dynasty, redraft, best-ball-dynasty,
  best-ball-redraft) to a webhook, with `settings.discord.webhook_id` as the
  fallback for any bucket left unset.
- ABSOLUTE RULE: THE TRADE IS PICKED FIRST AND THE CHANNEL FOLLOWS FROM IT. A
  scheduled hour posts exactly ONE trade, chosen on its own merits, and the
  channel is then read off the league that trade came out of. The channels are
  NOT a quota: never iterate the webhooks and find a trade for each. A week
  where the pool holds only dynasty trades is a week of dynasty-room posts, and
  that is correct.
- The pick, in `lib/would-you-rather/discord.ts pickTradeForPoll`: the newest
  trades Discord has never posted, then the least-voted half of that window, at
  random. Deliberately NOT the game page's `selectTradeId`, which answers a
  different question (what THIS reader has not voted on).
- ABSOLUTE RULE: A DISCORD VOTE IS COUNTED BY VOTER, NOT BY TOTAL, AND ONE
  PERSON COUNTS ONCE PER TRADE. The webhook can only read `answer_counts`, a
  number per answer, and a number cannot be deduplicated. The voters themselves
  come from a second, channel-scoped, BOT-authenticated endpoint,
  `GET /channels/{channel_id}/polls/{message_id}/answers/{answer_id}`, paginated
  100 at a time with `after` (`lib/discord-poll-voters.ts`). Each voter becomes a
  row in `would_you_rather_discord_votes`, and the unique index on
  (trade_id, discord_user_id) is the guarantee: a repeat vote on the same trade
  is not inserted and does not move the tally, however many polls that trade has
  had and however many times ingestion runs.
- ABSOLUTE RULE: capture `discord_channel_id` and the two `answer_id`s from the
  webhook CREATE response (`wait=true`) and store them on the poll row. The
  voters endpoint is channel-scoped and a webhook URL does not name its channel,
  so neither is recoverable afterwards. Read the answer ids back rather than
  assuming 1 and 2; `DEFAULT_ANSWER_ID` exists only for rows written before this
  was captured.
- ABSOLUTE RULE: when the bot cannot read a poll (not in that server, cannot see
  the channel, rate limited, no `DISCORD_BOT_TOKEN`), fall back to the aggregate
  counts AND set `would_you_rather_trades.discord_identity_gap`. That trade is
  never posted again: we do not know who voted on it, so a repeat voter on a
  later poll would be invisible. The flag is the line between the trades the
  guarantee covers and the ones it cannot, and it is why the second pick pass
  (bring a good trade back around) is safe at all.
- ABSOLUTE RULE: `recomputeDiscordTally` is a RECOMPUTE and the two halves must
  not overlap. One per distinct voter row, plus the raw totals from polls where
  `voters_resolved = false` only. Adding a resolved poll's totals on top of its
  own rows counts every one of its voters twice.
- A poll is closed as `'error'` ONLY when the message never reached Discord. One
  that reached Discord and then read back badly closes as `'ingested'` with the
  note saying what happened, because calling it an error would misdescribe a
  poll real people voted on. `pollCloseStatus()` is the one place that decides.
- Within one poll Discord enforces one vote per person for us: the post sets
  `allow_multiselect: false`. A voter appearing under BOTH answers is therefore
  impossible, and `discordVoteRows()` drops them rather than guessing a side.
- ABSOLUTE RULE: the league type is READ, never guessed. It is written onto
  `would_you_rather_trades.league_category` at pool time from the same
  `categorizeLeague` rule the rest of the site uses, and is null when the
  league's raw Sleeper object has not been stored. A null type routes to the
  fallback or nowhere. Posting a redraft trade into a dynasty room is worse than
  posting nothing.
- ABSOLUTE RULE: a bucket with no webhook of its own AND no fallback is not
  posted anywhere. It is never dropped into whichever channel happens to be
  configured, and it is excluded from the CANDIDATE SET rather than picked and
  then discarded, so an unroutable type never costs a scheduled hour. The admin
  panel says out loud which buckets are unrouted.
- ABSOLUTE RULE: posting is claimed by `slot_key`, a unique Eastern
  "YYYY-MM-DD-HH", and the row is written BEFORE the message is sent. A claim
  taken after the work is a claim that does not stop the work. `route_key`
  records which channel the poll went to and is deliberately NOT part of that
  key: keying on the pair would let two ticks in the same hour both post as long
  as they picked trades of different types.
- ABSOLUTE RULE: ingestion is claimed by a conditional update on
  `results_ingested_at`, and the trade's Discord totals are then RECOMPUTED as
  the SUM of its polls rather than incremented. A sum cannot drift; an increment
  run twice doubles a tally.
- Discord's counts are aggregates with no voter identities attached, which is why
  they live in their own columns rather than as rows in the votes table. Nothing
  pretends to know who voted on Discord.
- Answer order IS the mapping: Discord assigns answer id 1 to the first answer,
  and the ingestion reads id 1 as side A. Swapping the answers swaps every vote.
