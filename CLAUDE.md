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

### Dialog placement

`components/slide-up-dialog.tsx` is the house dialog and it moves in two
different directions by breakpoint, on purpose. Below `sm` it rises from the
bottom edge, which is where a thumb is. From `sm` up it slides IN FROM THE RIGHT
as a full-height side panel, because a desktop reader has a wide viewport and a
page they were already reading, and a centred box drops on top of the thing they
opened it from.

`desktopPlacement="center"` is the opt-out and it is for a dialog that is a
DECISION rather than a detail view (a confirm), where covering the page is the
point and a full-height rail holding two sentences would be mostly empty. The
two Signal Scout confirms pass it.

Only the geometry differs. The focus trap, the Escape handler, the backdrop, the
scroll lock and the accessible name are identical either way, so nothing about
how a dialog is operated depends on the viewport.

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

## Projection Engine Source (separate from the value source)

There are TWO independent "sources" in this product and they are routinely
confused. The VALUE source (KTC, FantasyCalc, FF Beacon values) is chosen by the
READER and is covered by the Source and Format Sync section above. The
PROJECTION source is chosen by an ADMIN, lives in
`league_power_pulse_settings.settings.beaconProjections.enabled`, and decides
whether a weekly projection comes from Sleeper or from our own engine
(`lib/projections/`). They are unrelated, and a surface showing both must name
them apart.

ABSOLUTE RULE: every read of `player_weekly_projections` or
`player_projection_accuracy` names exactly one source. Both tables hold an
ffbeacon row beside every sleeper one, so an unfiltered read is not merely stale,
it is AMBIGUOUS: a reader keying a Map by (player, week) takes whichever row
Postgres returned last, one pushing to an array doubles the universe, and one
that POOLS rows (BEAM's reliability) doubles every sample size and blends two
engines into a figure reported as one engine's record. Two repo-wide guards hold
this line: `lib/projections/source-guard.test.ts` (every `loadProjections` /
`loadAccuracy` call names a source) and `lib/projections/raw-column-guard.test.ts`
(nothing reads `projected_pts_*` outside the shared read path). An allow-list
entry in either is a debt ledger line with a reason, never a way to pass the test.

ABSOLUTE RULE: the source comes from `lib/projections/source.ts
resolveProjectionSourceForWindow` for a read, and from
`lib/projections/current-source.ts currentProjectionSourceCached` for a surface
that only needs to NAME the engine. Both make ZERO queries while the feature is
disabled, so wiring one in is free today and correct the moment it is enabled.
The only sources that may be pinned to `SLEEPER_SOURCE` are ENUMERATION reads
(which season do we hold projections for, who exists at this position): Sleeper
is the coverage baseline every other source is measured against, our builder
mirrors its rows rather than adding any, so those are the same answer through
half the rows. Every such pin carries that reason in a comment.

ABSOLUTE RULE: the source is part of every cache key, fingerprint and etag that
outlives a flip. `on_the_clock_projection_cache`'s data version, its in-process
memo key and the Draft Pulse payload etag; the player profile's two
`unstable_cache` entries; the FAAB position curve's 24-hour entry; the Positional
WAR fingerprint. Without it the switch takes a day to show up, or never does.

ABSOLUTE RULE: a heading that names a projection engine renders the RESOLVED
one's display name (`projectionSourceDisplay` in
`lib/projections/source-constants.ts`), never a hardcoded word. A card that says
"Sleeper projected points" over our own numbers is worse than an unadjusted
number honestly labelled, and it is a lie nobody on the page can catch.

The player profile is the one surface that deliberately shows an engine's OWN
published number rather than our adjusted opinion of it, because its per-stat
beat/miss comparison grades exactly that number against what happened. WHICH
engine is still resolved, and both of its headings say so.

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
- Routes: `/tools/league-pulse` (entry), `/dashboard` (saved leagues), `/leagues/[sleeper_league_id]` (deep view), `/leagues/[sleeper_league_id]/lineups` (one team's starters and bench for one week, plus the optimiser), `/leagues/[sleeper_league_id]/schedules` (week and team schedule views), `/leagues/[sleeper_league_id]/schedules/[week]/[roster_id]` (one matchup, both starting lineups), `/leagues/[sleeper_league_id]/power-pulse` (expected performance), `/leagues/[sleeper_league_id]/positional-war` (the Positional WAR curve plus the upgrade what-if), `/leagues/[sleeper_league_id]/decisions` (the Manager Ledger), `/leagues/[sleeper_league_id]/trade-ideas` (suggestions plus the trade builder), `/leagues/[sleeper_league_id]/transactions` (feed), `/leagues/[sleeper_league_id]/teams/[roster_id]` (team deep view, future phase).
- `/leagues/[sleeper_league_id]/trade-finder` was renamed to `trade-ideas`. `next.config.ts` holds a permanent 308 for the old path; keep it forever, shared links use it.
- `/leagues/[sleeper_league_id]/activity` was REMOVED. It rendered the same `LeagueActivityPanel`, from the same `loadLeagueActivity`, that the league overview already carries; the only thing the route added was the per-team filter, which now renders on the panel itself behind a `<details>` disclosure. `next.config.ts` holds a permanent 308 to the overview; keep it forever, the Copy link button published that path. There is deliberately no Activity entry in `LEAGUE_NAV_ITEMS`.
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

## Manager Ledger (League Pulse decision grading)

`/leagues/[id]/decisions`, nav label "Decisions". Every other model in League
Pulse measures a ROSTER: the trade-value rankings say who owns the most, Power
Pulse says what each roster should win from here, Positional WAR says which
positions are scarce. This one measures the person operating the roster, by
grading the decisions they actually made against what was actually available at
the moment they made it.

Four ledgers, one page: lineups set, waiver claims, trades, draft picks.

ABSOLUTE RULE: every figure is RETROSPECTIVE and SETTLED. Read only from
`league_matchups` rows marked `is_final`, which carry the actual points every
rostered player scored that week, bench included. Nothing here is a projection,
an estimate or a simulation. A week that has not settled contributes nothing
rather than contributing a partial score: a lineup decision graded against a
Sunday-afternoon scoreboard is a decision that has not finished happening.

ABSOLUTE RULE: this model does NOT vary by value source or `format_config_id`,
for the same reason Power Pulse and Positional WAR do not. Every quantity is
points scored under the league's own literal scoring, so there is exactly one
row per (league, season, roster) in `league_manager_ledger_cache`. `source` is
deliberately absent from the fingerprint and the toggle must never invalidate
it. A trade containing draft picks is therefore graded on its players only and
flagged (`trade_any_picks`); pricing a pick would require a value source and
would break the guarantee.

ABSOLUTE RULE: the token "WAR" names exactly one metric in this product and it
is nothing in this feature. Everything here is team-specific by construction, so
it uses the vocabulary reserved for team-specific work: "wins left on the bench",
"best-lineup record", "points". Never "WAR", in code, copy, a column name or a
chart axis.

ABSOLUTE RULE: recomputed ONLY on demand, through `pulseLeague` (gated by
`MANAGER_LEDGER_TTL_MS`, 12 hours, plus a fingerprint or model version change),
or manually via `npm run calculate:manager-ledger`. NEVER wired into a nightly
cron, for the same scaling reason as league power rankings.

ABSOLUTE RULE: never cache a ledger computed without settled weeks. A league
with nothing final produces zero for every figure and 100% efficiency for every
manager, which reads as a real answer and is not one.
`calculateLeagueManagerLedger` writes nothing in that case AND clears any rows
already stored for that league season.

ABSOLUTE RULE: the optimiser is `buildOptimalLineup` from
`lib/power-pulse/lineup.ts`, unchanged. Power Pulse feeds it PROJECTED points to
predict a week; this feeds it ACTUAL points to grade one. Same algorithm, one
copy, so the prediction and the retrospective can never disagree about a league.

ABSOLUTE RULE: the best legal lineup may only contain players the manager could
actually have started. `league_matchups.player_points` scores every player ON a
roster, injured reserve and taxi squad included, so without the filter the
optimum seats a taxi rookie and the page tells a manager they left a win on the
bench by not starting someone Sleeper would not have let them start. Two guards
bound the imperfection: the IR and taxi lists are the roster's CURRENT ones
(Sleeper publishes no per-week history), so anyone who ACTUALLY STARTED a week
is treated as eligible that week regardless, and the limitation is stated on the
page rather than left to be discovered.

ABSOLUTE RULE: both sides of the lineup comparison come from the SAME candidate
pool. Scoring the set lineup straight off `player_points` while the optimum came
from the resolved pool let a starter our `players` table had not caught up with
land in the numerator and not the denominator, which reported a perfect manager
on a week that could not be measured.

ABSOLUTE RULE: `includeManagerLedger` on `pulseLeagueDerived` defaults to FALSE,
the opposite polarity to its siblings. Defaulting it on put a full season of
reads on the critical path of eight other pages, the hover warm-up endpoint and
two crons, none of which display it. A surface that DOES render ledger figures
opts in explicitly AND awaits both the compute and the reads inside its own
Suspense boundary. Two do today: `/decisions`, which is the ledger's home, and
`/lineups`, whose season section is one roster's slice of the same cache.
`pulseLeague` opts in too, because it is the do-everything entry point with no
boundary to protect.

ABSOLUTE RULE: a surface that shows a season-long manager figure READS this
cache; it never recomputes one. Lineup efficiency, the best-lineup record, wins
left on the bench and the efficiency and scoring ranks all exist here already,
and a second implementation would have two League Pulse pages disagreeing about
the same manager with nothing to say which is right.
`components/manager-ledger/format.ts` supplies the wording for the same reason.

`LedgerWeek` stores `setPoints`, `optimalPoints` and `ungradedSlots` as of
`ledger-4`. They were computed and dropped until the Lineups page drew a
per-week efficiency chart, and there is no honest way to derive one without
them: `officialPoints / (officialPoints + pointsLeft)` adds the ungradable IDP
slots to both halves of the ratio, which pulls it toward 1 and flatters every
manager in an IDP league.

ABSOLUTE RULE: the staleness gate never builds the compute context. Every field
in the fingerprint except the slot list is a count or a maximum, so the warm
path is four `head: true` counts and a league row. Building the whole season of
matchups, transactions, picks and players to answer "nothing changed" is what
`buildFingerprintInput` exists to prevent, and it is the same split
`lib/league-positional-war.ts` makes for the same reason.

Both sides of the lineup comparison are measured over the SAME gradable slot
subset. `startingSlots` drops the tokens it has no position eligibility for
(IDP), so measuring the set lineup over every slot and the optimum over some of
them would invent a deficit that is really the linebackers. The head-to-head
result adds the deficit onto the league's own official score rather than
rebuilding the total from parts, and the ungraded slots are counted and stated
in the UI.

The best-lineup comparison is ONE-SIDED on purpose: the opponent's score is used
exactly as it happened and their bench is left alone. A reader cannot set their
opponent's lineup, and the figure exists to say what was in their own hands.

Each ledger counts what it counts and never the same thing twice. A waiver claim
is credited with what the player scored FOR THE CLAIMING ROSTER from the week of
the claim. A trade is credited with what the incoming players scored for their
new owner minus what the outgoing ones scored for theirs. The draft is credited
with the player's production IN THE LEAGUE, for anyone, because the draft
decision was which player to take and what happened to him afterward is the
trade ledger's business. Keepers are excluded from the draft ledger and from its
round baselines, because a keeper is carried at a slot the league's rules set
rather than chosen off the board.

There is deliberately NO composite score. The output is four ledgers and four
ranks plus a fifth for total points scored. Scoring rank is the ROSTER,
efficiency rank is the MANAGER, and the all-play luck figure on the Schedule
page is the SCHEDULE. Those three side by side are what answer the question the
page exists for.

Module map:
- `lib/manager-ledger/types.ts` — shared shapes, and the rules above in its header.
- `lib/manager-ledger/default-settings.ts` — cache policy and display caps only. No model settings row, because this model makes no arguable modelling choice: it reads settled results and does arithmetic.
- `lib/manager-ledger/lineup.ts` — slot planning, per-week grading, the biggest available swap, the season roll-up. Pure.
- `lib/manager-ledger/moves.ts` — `LedgerIndex` (the ownership-and-scoring primitive) plus the waiver, trade and draft ledgers. Pure.
- `lib/manager-ledger/engine.ts` — `computeLedger()`. Pure; takes plain data.
- `lib/manager-ledger/fingerprint.ts` — the exact invalidation key. Pure, clock-free.
- `lib/manager-ledger/load.ts` — every read, and no Sleeper request ever. Transactions and draft selections are PAGED; the 1000-row PostgREST cap truncates silently.
- `lib/league-manager-ledger.ts` — orchestrator + `refreshManagerLedger()` (never throws).
- `lib/league-manager-ledger-data.ts` — the read path for the page. Identities resolved at render time, never stored. Named columns, not `select("*")`, and wrapped in React `cache()` so the page's two consumers share one result.
- `lib/request-coalesce.ts` — the in-flight deduplicator, extracted from `lib/league-pulse.ts` when the ledger needed it too. league-pulse imports the ledger, so importing the helper back the other way would close a cycle.

ABSOLUTE RULE: the empty state's worked example is offered ONLY when the ledger
is genuinely going to fill in. `ledgerEmptyState()` decides, and `settled` (the
league's starting slots cannot be graded, so no figure will ever appear) and
`error` (the last run failed) both get the explanation and no example. A preview
is a promise about what a reader will see, and neither of those readers is going
to see it. `lib/manager-ledger/empty-state.test.ts` holds that line.

ABSOLUTE RULE: the example is the only place in the product that puts invented
numbers on a page about a real league, so it is fenced by five independent
signals, and the three that matter most are WORDS rather than styling, because a
badge and a dashed border are exactly what a screen reader cannot use. The team
names are themselves the label ("Example team A" cannot be read as a Sleeper
handle, so a screenshot of the table alone still says so), plus a Sample badge,
a heading that says these are not this league's numbers, and the table's own
`<caption>`, which is the first thing announced on entering it. It is
deliberately NOT the real `LedgerTable`: a reader who can expand invented rows
into a full invented ledger has been handed something that behaves exactly like
the real thing.

Observability: `leagues.manager_ledger_status` / `_detail` / `_attempted_at` /
`_succeeded_at` (migration 0245), `MANAGER_LEDGER_RETRY_MS` 15 minutes, listed
at `/admin/system/league-health` beside Power Pulse and Positional WAR.
`manager_ledger_detail` is server-written, never user-controlled, and rendered
as text, never as HTML.

Power Pulse correction: `settings.lineupRealism` (admin-editable at
`/admin/power-pulse`, validated server-side) discounts each team's projected
weekly mean toward their measured efficiency. Power Pulse otherwise projects
every remaining week from the OPTIMAL lineup, which assumes every manager
extracts every point their roster can produce for the rest of the season.
OFF BY DEFAULT and it must stay that way unless someone decides otherwise: it is
a judgement call rather than a bug fix, it is partly a claim about future
behaviour rather than about a roster, and it is noisy early in a season. When it
is off, no ledger read happens at all. Bump `modelVersion` when changing it.

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

Lineups:
- `/leagues/[id]/lineups`, nav label "Lineups". ONE team, ONE week: every startable slot grouped by position block, then the bench, injured reserve and the taxi squad, with the projection, the matchup, the game's implied team total, the beat rate and the Positional WAR behind each player. `?roster=` and `?week=` are both linkable; with neither, the searched Sleeper handle picks the team and the live week picks the week.
- ABSOLUTE RULE: this section introduces NO model of its own. The slot list is `lib/league-schedule/slots.ts alignedStartingSlots`, the set lineup is `lib/league-schedule/lineups.ts`, every projection is `lib/power-pulse/project.ts projectPlayerWeek` on the source `lib/projections/source.ts` resolves, the optimal fill is `lib/power-pulse/lineup.ts buildOptimalLineup`, rest-of-season totals come through `lib/projections/read.ts`, free agency from `lib/faab/free-agents.ts` and market values from `lib/faab/league-load.ts`. A number on this page and the same number on the Schedules or Power Pulse page are the same number by construction.
- ABSOLUTE RULE: THE OPTIMISER IS RUN ONCE AND DIFFED ON LINEUP MEMBERSHIP, never on slot assignment. `buildOptimalLineup` is free to seat the same nine players in different slots than the manager did (RB1 and RB2 swapping, a receiver moving to the flex); none of that changes the score, and reporting it would bury the one move worth eleven points under four worth nothing. This is deliberately a different question from `lib/league-schedule/matchup.ts`, which lists the best INDEPENDENT single swaps and says out loud that theirs do not sum. Do not unify them.
- ABSOLUTE RULE: an incoming player is paired with an outgoing one who is ELIGIBLE FOR THE SLOT HE TAKES, cheapest such starter first. Pairing purely by value (biggest addition against weakest starter) prints sentences that are not moves: in a lineup where a QB slot and an RB slot are both being upgraded it said "start the running back over the quarterback" and attached a gain belonging to neither swap. The gains over ALL pairs sum to exactly `pointsLeftOnBench`; the DISPLAYED list is filtered by `MIN_MOVE_GAIN`, so it can sum to less, and the remainder is reported as `unlistedGain` and said out loud rather than leaving two figures on one screen that do not reconcile.
- ABSOLUTE RULE: both totals come from the SAME candidate pool. A roster can hold a Sleeper id our `players` table has not caught up with, and Sleeper still scores him. Counting his points in the set total while the optimal fill cannot use him understates the optimum, floors the gap at zero and makes the page say "you set the best lineup you had" about a week it could not measure. `gradableSleeperIds` is decided first and the set lineup is scored by looking each starter up in it; ungradable slots are excluded from both sides and counted in `ungradedSlotCount`. Same rule, same reason, as the Manager Ledger.
- ABSOLUTE RULE: a player currently in an unprojectable (IDP) slot is excluded from the candidate pool, and an IR or taxi player is never seated. An optimum a manager cannot actually set in Sleeper is not an optimum.
- A settled week is graded on RESULTS, an unplayed one on projections, through the one `grade()` switch in `lib/league-lineups/build.ts`. The headline "Scored" figure prefers the league's own official `league_matchups.points` over re-adding the parts, for the same reason the Manager Ledger does.
- Sleeper's starters array is POSITIONAL and `rosters.starter_ids` CANNOT be used for it: `lib/league-pulse.ts` filters the "0" placeholders out before storing, which shifts every slot below a gap up by one. The week's `league_matchups` row is read first (`rawStarterIds`), and a week Sleeper has not published falls back to `rosters.metadata.starters`, which holds the raw array. That fallback is stated on the page (`usedRosterFallback`), never hidden.
- The cut list and the free agent list are framed by `lib/league-team-status.ts` (Contender / Bubble / Rebuilder). A contender is ranked on points this week; a dynasty rebuilder on overall rank. A redraft league is ALWAYS contending, whatever the record: there is no next season to hold an asset for.
- ABSOLUTE RULE: a dynasty or keeper roster is never told to cut a player still carrying real market value (`DYNASTY_KEEP_VALUE`), and nobody the optimiser seats this week is ever offered as a cut. The seated set comes from the FILL (`optimalSleeperIds`), never from the displayed move list, which is threshold-filtered and therefore omits a player the optimum genuinely seats by less than half a point. Whether a cut is permanent comes from `loadLeagueValueContext` (which leads on the derived format), never from Sleeper's `settings.type` alone: a dynasty league with missing metadata would otherwise have the guard stand down. The panel says which players it declined to name and why, rather than returning an empty list.
- The free agent panel is metered (`lib/league-lineups/rate-limit.ts`), claimed after validation and only when it is going to do the work. It is the one unbounded-ish thing on an unauthenticated GET. Only that panel is metered, never the page: `claimRateLimitSlot` fails closed, and a limiter outage must not turn every league's lineup into an error state. A refusal is its own state (`waiversState`), not an empty list.
- Module map: `lib/league-lineups/types.ts` (shapes, and `LineupPlayer` extends `SchedulePlayer` so the existing player dialog is reused rather than duplicated), `build.ts` (pure), `advice.ts` (pure, the cut list and the waiver framing), `weeks.ts` (pure, the picker), `data.ts` (every read). `lib/nfl-game-environment.ts` is the implied-team-total reader shared with anything else that wants one.
- ABSOLUTE RULE: this page READS `league_positional_war_cache`, `league_power_pulse_cache` and `league_manager_ledger_cache` and never recomputes any of them, for the same scaling reasons as every other on-demand model. A league with no curve gets an honest "not built yet" line, not a fabricated zero.
- ONE PAGE, TWO QUESTIONS, DECIDED BY THE WEEK. Before the games it is a lineup helper: a projection per player, the optimiser, the waiver wire and the cut list. After them it is a REPORT: what was scored, the best lineup that was available, whether the difference cost the game, who came through, and what the week did to the season. `lib/league-lineups/status.ts` decides which, and every panel reads that one decision rather than testing `isFinal` for itself.
- ABSOLUTE RULE: "in progress" means POINTS ARE ON THE BOARD, not that the calendar says so. Sleeper publishes the current week's matchup row from Tuesday with every score at zero, so a phase decided by week number alone labels four quiet days as live and shows a roster of 0.0s as though those were results. `hasLivePoints` is the test.
- ABSOLUTE RULE: `actualsVisible` and `isFinal` are DIFFERENT SWITCHES and must stay that way. A week in progress DISPLAYS real points; the optimum, the gap and every move stay graded on projections until the week settles. Grading a Sunday afternoon against partial scores tells a manager they left forty points on the bench because three of their starters play at four o'clock. For the same reason the optimiser panel does not render at all during a live week.
- On a week with results the headline figure on every row is the SCORE, with the projection kept beside it in small type and the difference signed. Neither number is dropped: "18.4, projected 11.2, plus 7.2" is the story of a Sunday and half of it is not.
- ABSOLUTE RULE: "best you had" on a settled week is the optimiser's deficit ADDED TO SLEEPER'S OWN OFFICIAL TOTAL, never `optimalTotal` printed raw. The optimiser measures over gradable slots only, so in an IDP league the raw figure sits below the score beside it. Same arithmetic, same reason, as `lib/manager-ledger/lineup.ts`.
- The best-lineup result is ONE-SIDED. The opponent scored what they scored and their bench is left alone, because a reader cannot set their opponent's lineup. "You lost a game your own bench would have won" is the loudest sentence on the page when it is true and absent when it is not.
- The season charts are two, not one, and they are drawn apart on purpose: scored against best available is a DECISION gap, scored against projected is VARIANCE. Layering them invites a reader to read one as the other. Every chart is `role="img"` with a summary for its name and a real `<table>` under a disclosure carrying the numbers.
- A past week's projection is rebuilt from the row published for that week, adjusted with TODAY's opponent and reliability figures. That is a fair read on whether the model was about right; it is not a snapshot of what the page showed that Sunday, and the footnote says so.
- The slot label beside each starter is a BUTTON that opens a what-if: swap him for anyone on the bench and see the projected points, the chance of beating this week's opponent and the remaining gap to the best lineup, before and after. `lib/league-lineups/simulate.ts` is pure and client-safe.
- ABSOLUTE RULE: the what-if introduces NO model and makes NO server call. A swap moves the set total by exactly (in minus out); variances add, per `lib/power-pulse/lineup.ts lineupSigma`; the probability is `lib/power-pulse/math.ts winProbability`, the same function the Schedules board uses for the same matchup. The optimum does not depend on which nine are seated, so the remaining bench gap is `optimalTotal` minus the new set total and the optimiser is NEVER rerun per candidate.
- ABSOLUTE RULE: the what-if is offered on the BENCH only, and never on a settled week. IR and taxi cannot start without a roster move, so an optimum seating one is an optimum a manager cannot set; a starter-to-starter shuffle is worth exactly zero, which the optimiser panel already says out loud; and a week that has been played cannot be changed, which is the Decisions page's question and is graded there on what players actually did.
- The what-if's win probability is the reader's SET lineup against the opponent's BEST one (`league_power_pulse_cache.weekly`, the same figure the Schedules board reads, so the two pages cannot disagree about the opponent). That deliberately differs from the Schedules number, which assumes both teams start their best nine, and the panel says so rather than leaving two win probabilities on the site with no explanation for the gap.
- ABSOLUTE RULE: nothing visible on this board is `aria-hidden`. Every figure is one real text node with only the MISSING words appended as `sr-only` INSIDE THE SAME ELEMENT, and the metric chips are SIBLINGS of the player button rather than children of it. Drawing a number twice (an aria-hidden span for the eye, an sr-only twin for the ear) reads correctly line by line and goes silent the moment a reader points at it, because a screen reader following the pointer finds a hidden object and falls back to an ancestor; a button flattens its contents into one name, so a chip inside one can only ever be clause nine of a sentence about the whole player. `aria-hidden` survives on icons, the decorative hairline, and the slot abbreviations, whose spelled-out form is the accessible name on the same element.
- ABSOLUTE RULE: the slot button's accessible name IS the row header. A `<th scope="row">` takes its name from its subtree and a descendant button contributes its accessible name rather than its text, so anything said there is echoed onto every cell in the row during table navigation. It is the spelled-out slot description plus four words, and nothing else. `aria-describedby` does not solve this: the element it points at has to live somewhere, and inside the `th` it lands back in the row header.

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
- `lib/would-you-rather/poll-text.ts`: Discord's 300 and 55 character caps, the
  short format label behind the question, and the condensing ladder behind the
  answers. Pure.

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
- ABSOLUTE RULE: a SCHEDULED post is claimed by `slot_key`, a unique Eastern
  "YYYY-MM-DD-HH", and the row is written BEFORE the message is sent. A claim
  taken after the work is a claim that does not stop the work. `route_key`
  records which channel the poll went to and is deliberately NOT part of that
  key: keying on the pair would let two ticks in the same hour both post as long
  as they picked trades of different types.
- A MANUAL post from the admin panel is NOT rate limited and must not be. It
  passes `{ manual: true }`, skips the hour gate, and writes a NULL `slot_key`;
  the unique index covers non-null keys only (migration 0232). The once-per-hour
  rule exists to stop a retried CRON TICK from posting an hour twice, and a
  person pressing a button is not a duplicate cron tick. A null slot_key is also
  how a row says it claimed no schedule slot, so no extra column is needed.
- ABSOLUTE RULE: every poll must reach a terminal state. A 404 on read-back
  means the Discord message is GONE, which is a settled fact rather than a bad
  moment, so the poll closes as `status = 'deleted'` with zeroes. Left open it
  would be retried hourly forever AND hold a place in the ingestion sweep, which
  reads the 25 oldest unresolved polls: twenty five of them would stop ingestion
  for every other poll. `INGEST_GIVE_UP_MS` (14 days, far beyond the 6-hour
  finalize grace) is the same backstop for every other permanent failure.
- A deleted poll does NOT set `discord_identity_gap`, and its trade can go out
  again. That is safe precisely because it contributed nothing: a fresh poll
  counts each person once. A poll ABANDONED after 14 days does set the gap when
  it had a message id, because that message may still exist and may have been
  voted on.
- ABSOLUTE RULE: ingestion is claimed by a conditional update on
  `results_ingested_at`, and the trade's Discord totals are then RECOMPUTED as
  the SUM of its polls rather than incremented. A sum cannot drift; an increment
  run twice doubles a tally.
- Discord's counts are aggregates with no voter identities attached, which is why
  they live in their own columns rather than as rows in the votes table. Nothing
  pretends to know who voted on Discord.
- Answer order IS the mapping: Discord assigns answer id 1 to the first answer,
  and the ingestion reads id 1 as side A. Swapping the answers swaps every vote.
- ABSOLUTE RULE: Discord's poll limits are HARD REJECTIONS, not truncations: 300
  characters for the question and 55 for EACH answer
  (https://docs.discord.com/developers/resources/poll). `lib/would-you-rather/
  poll-text.ts` owns both numbers and everything that fits a trade inside them.
- The QUESTION is the league format in short forms, "Who wins? Dynasty 12T SF
  PPR TEP, start 9". A first-round pick in a 10-team redraft is not the asset it
  is in a 12-team superflex dynasty, and the poll button is where the reader is
  actually deciding, with no page around it. Parts that do not apply are dropped
  rather than negated: no "SF No". Keeper leagues read as Keeper even though
  they PRICE as redraft.
- The ANSWERS are the assets, full player names wherever they fit, picks as
  "27 1 (E)" (two-digit year, round, one letter for early/mid/late). Condensed
  one rung at a time, first rung that fits wins: group identical picks, then
  first initial and surname, then picks without their slot, then surnames only,
  then picks as a count.
- ABSOLUTE RULE: the LOSSLESS rung comes before any lossy one. Grouping two
  identical picks says exactly what listing them twice said; shortening a name
  does not. Do not reorder these so a name is shortened while an ungrouped pick
  list is still on screen.
- ABSOLUTE RULE: NOTHING IS EVER DROPPED FROM A SIDE TO MAKE IT FIT. No "and 2
  more", no truncation of an answer. When no rung fits, `buildPollAnswer`
  returns null, `buildPollMessage` returns null, and the poster takes a
  DIFFERENT TRADE (up to `POST_ATTEMPTS`). An answer listing three of a side's
  five players describes a trade nobody proposed, and a reader cannot tell that
  from the real thing.
- A rung that would make two people read the same is skipped, not used. Two
  Browns become "Brown, Brown" at the surname rung, which is a worse thing to
  say rather than a shorter way of saying the same thing.
