# FF Beacon - Project Instructions

This file holds only what cannot be learned by reading the project. For how a
feature works, read its code, the header comments in its lib/ modules and its
plan in docs/completed/ before changing it. Trust the code over any document.
Do not add feature documentation to this file.

## Session basics

- At session start, read .env.local and note which variable names are set
  (names only, never values). The Supabase keys are SUPABASE_PUBLISHABLE_KEY
  and SUPABASE_SECRET_KEY. Never use the anon or service_role key names.
- The Supabase project is cilvpyivysjxpxbudkfa (wired into .mcp.json). Ignore
  any other project id or credentials file on this machine.
- These files stay where they are, with no backup copies: .env.local,
  .env.local.example, .mcp.json, .claude/, CLAUDE.md, plan.md, progress.md.
  plan.md is not modified without approval.
- One shell command per tool call. No &&, ;, || or cd prefixes. Use a pipe
  only when one command's output must feed the next, and prefer the Grep, Glob
  and Read tools over shell pipes.
- ~/Desktop/dynasty-price-check is a read-only reference. A feature ported
  from it must match its behavior, layout, default states and interactions
  (cite its file paths and line numbers in the final report), and always uses
  FF Beacon visuals: dark mode, purple #A855F7, cyan #22D3EE, Geist fonts.
  Diverge only with approval given beforehand.

## Punctuation

- Plain ASCII punctuation everywhere: chat, code, comments, commits, UI copy,
  ARIA labels, docs. No em or en dashes, curly quotes, ellipsis character,
  middle dots or non-breaking spaces. Rewrite the sentence instead.
- When code genuinely needs one of those characters, write it as a JavaScript
  escape generated from character codes in a script. The editing tools turn a
  typed escape into the literal character.

## Supabase

- Standing approval: run any query or migration against this project through
  the Supabase MCP tools without asking, destructive statements included. Do
  not stop to confirm. Say in the final report what was changed.
- Schema change: apply it with apply_migration, save the same SQL as the next
  numbered file in supabase/migrations/, then regenerate types into
  lib/database.types.ts (generated, never edited by hand).
- Auto-RLS is on, so a new table blocks all access until it has policies.
  Every table's policies ship in the same migration as the table, with the
  access matrix in a comment at the top of the file.
  - Public data: SELECT for anyone, writes by service role only.
  - User-owned data: select, insert, update and delete own rows only
    (auth.uid() = user_id), no anon access.
  - Admin or internal data: service role only, no client policies.
  - Policy names: {table}_select_public, {table}_select_own,
    {table}_insert_own, {table}_update_own, {table}_delete_own,
    {table}_service_role_all.
- RLS is row level, not column level. Nothing meant for the admin alone goes
  on a table a customer can read. Never expose auth.users.
- After a table migration, confirm the policies in pg_policies and test that
  anon and authenticated reads and writes behave as intended.

## Accessibility (the reason the site exists)

- Every element works with a screen reader and a keyboard, to WCAG 2.2 AA at
  minimum. Semantic HTML first, ARIA only where HTML cannot say it.
- Accessible names on every control, labels on every input, one h1 and no
  skipped heading levels, visible focus, aria-live for dynamic updates,
  aria-expanded and aria-controls on disclosures, aria-current on active nav,
  aria-hidden only on decorative icons, meaningful alt text or alt="".
- A figure is one real text node. Never draw a number twice as an aria-hidden
  copy plus an sr-only copy.
- A chart is role="img" with a summary and a real table under a disclosure.
- Tap targets are at least 44 by 44 CSS px.

## Mobile first

- Never hide data at a small breakpoint. Everything visible on desktop is
  reachable on mobile through a compact layout (stacked cells, two-line rows,
  expandable rows). A hidden-until-sm or hidden-until-md class on data is only
  acceptable when the same data appears elsewhere in the mobile layout.

## Time display

- Every timestamp a person reads is shown in America/New_York, through
  lib/datetime.ts (formatEastern, SITE_TIME_ZONE). Never call a toLocale date
  method or build an Intl.DateTimeFormat without timeZone. Show the zone label
  when a time of day is shown and never hardcode ET, EST or EDT. Storage
  stays UTC.

## Source and format

- Anything showing player values, rankings or projections respects the
  reader's chosen value source and league format, resolved through
  lib/preferences.ts and lib/source.ts (URL, then DB, then cookie, then
  default). Never hardcode either one. Show a source's display_name, never
  its slug.
- Inside a league view (/leagues/[id] and its OG images) the format comes from
  the league's own Sleeper settings through resolveLeagueContext in
  lib/league-format-resolution.ts. The global format toggle is ignored there.
- A source lists only the formats it really provides in
  source_registry.supported_format_slugs. No placeholder rows. When adding a
  source, compare 50 or more players across its claimed formats and drop any
  format whose values are identical to another.
- The projection engine source is a separate, admin-chosen setting. Every read
  of player_weekly_projections or player_projection_accuracy names exactly one
  source, resolved through lib/projections/source.ts, and that source is part
  of every cache key.

## Data rules

- Names describe the data in our product, never the outside source it came
  from. A source name is allowed only in operational columns (last_x_sync,
  external ids, external urls).
- Every table that ingests outside data keeps the full original object in a
  jsonb column named metadata (keyed by source slug on merged tables such as
  players). The one exception is personal data from a system of record such
  as Stripe: store an allow-listed projection, never a deny-list.
- Derived tables are rebuilt by scripts chained after the sync, not by
  triggers, and pages read the derived table.
- A backfill is a one-time, idempotent script and is never scheduled. For a
  source that also has a nightly sync it writes only the days the sync missed.
- Supabase reads that may pass 1,000 rows are paged with range and a stable
  order.

## Invariants that span features

- All Sleeper requests go through lib/sleeper.ts and its call budget in
  lib/sleeper-budget.ts. Never add a sleep as a rate limit.
- A failed Sleeper request is not an empty answer. Keep null (failed) and []
  (nothing there) apart, and never cache a result built on a failure.
- All writes to leagues, rosters, league_users and league_transactions go
  through lib/league-pulse.ts. A league is stamped complete only after its
  child rows are saved.
- Per-league models (power rankings, Power Pulse, Positional WAR, Manager
  Ledger, Blueprint) are computed on demand when a league is viewed. No cron
  ever iterates leagues. A degenerate result (no schedule, no settled weeks)
  is never cached.
- A page that shows a figure another model owns reads that model's cache. It
  never recomputes the figure a second way.
- A null value or projection is shown in words ("No projection", "No market
  value"), never as zero.
- "WAR" names only Positional WAR. Team-specific figures are "projected wins"
  or "wins added".
- A defender is never scored from a stored pts column. Use lib/idp/ and
  lib/site.ts.
- Game answers and anything hinting at them never reach the browser before
  the player's answer is recorded. That includes props passed to client
  components.
- Prices, ownership and identity are re-derived on the server, never trusted
  from the request. Validate first, then claim a rate limit slot, then do the
  expensive work.
- Guard tests (the guard.test.ts and naming.test.ts files) enforce many of
  these. Fix the code when one fails. Never edit the test or add an
  allow-list entry to pass it.
- No DPC branding anywhere. Share images use FF Beacon brand only.
- Every AI prompt is stored in the database and editable in admin.

## Workflow

- The gate, in order: npm run typecheck, npm run lint, npm test, npm run
  build. Lint finishes with zero errors and zero warnings. A lint exception is
  an eslint-disable-next-line comment with the reason on the line above it.
- After a task, run review sub-agents for implementation, accessibility and
  security (RLS, auth checks, input handling, secrets, rate limits), and fix
  what they find. When the owner names a reviewer count, use that count.
- After a change to a League Pulse loader or engine, run
  npm run verify:idp-invariant.
- Update progress.md after each completed task, one atomic task per entry, in
  the format the file already uses.
- docs/ holds documents only. Nothing a program reads or writes lives there
  (use data/<feature>/). A built plan moves to docs/completed/.
- Conventions: TypeScript strict, Next.js 15 App Router, Tailwind with the
  theme tokens, shadcn/ui, kebab-case file names, one component per file.
