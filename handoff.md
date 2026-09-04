# Handoff

Session of 2026-09-04. Build: **Manager Pulse**. Plan of record:
`docs/manager-pulse-plan.md` (its section 15 records where the plan and the
shipped code differ). Tasks: `progress.md`, prefixes `MP-T###` and `MP-R###`.

The previous entry (the Projection Engine build, session of 2026-09-01) is
complete and lives in git history of this file.

## State

**Nothing is committed. Nothing is pushed.** Everything is in the working tree,
by instruction.

All six build waves are complete, all four Opus reviews are complete, and every
finding they raised has been fixed.

Green as of the last run:

- `npx tsc --noEmit` exits 0
- `npx vitest run`: 271 files, 4,226 tests, all passing
- `npm run build` clean, all seven new routes registered
- Banned-character scan clean across all 120 changed files. The only matches are
  inside `lib/manager-pulse/narrative.test.ts`, which lists them because it is
  the test asserting narrative output contains none of them.

## What Manager Pulse is

Type a Sleeper handle, get that person's fantasy footprint across several
seasons: what they win, how they draft, who they keep buying, what they overpay
for, and how to approach them in a trade. Signed-in only; guests get a sign-in
prompt and a clearly-fenced sample report.

One engine, two consumers. `/tools/manager-pulse` is the first. League Pulse
Trade Ideas is the second, which is why the engine is a service rather than a
page.

## Rules that are easy to break by accident

1. **Dynasty and redraft never pool** for a value-priced figure. `PerTypeStat<T>`
   has no `all` field on purpose, so the type system carries the rule.
2. **Every limit is admin-editable.** No cap, cooldown, TTL, window, threshold
   or sample floor may be a constant in a lib module or a page. The
   settings-coverage test fails the build if a key is added without a form field.
3. **A server component must never call a function from a "use client" module.**
   `components/manager-shell/client-boundary.test.ts` enforces this. See below.
4. **Nothing triggers a compute it should only read.** Manager Pulse reads
   `league_manager_ledger_cache`; `getManagerTendencies` is cache-only and never
   queues a capture.

## The bug most worth knowing about

`lens-switch.tsx` carries `"use client"`, and six server components imported its
five pure helpers. Next turns every export of a client module into a client
reference, so those calls threw at render and both the report page and the
signed-out sample page returned 500. `tsc` passed, because the types are
correct. Every unit test passed, because a test imports the module directly and
never crosses the boundary that breaks it. It was found by grepping the BUILT
server chunk for the throwing proxy.

The helpers now live in `components/manager-shell/lens.ts`, which has no
directive. `client-boundary.test.ts` stops it recurring, and distinguishes
rendering a client component (correct, and the point of the boundary) from
calling a client module's function (broken).

Being free of React and of fetch is not what makes a function server-safe. Not
living in a client module is.

## Live on production

Twelve migrations applied to `cilvpyivysjxpxbudkfa`, 0249 through 0260, each
verified with the project's RLS sequence (policy inventory, anon and
authenticated role simulation, function grant inspection). Section 15 of the
plan lists them and explains the three that were not in the plan.

`lib/database.types.ts` is regenerated and prettier-formatted.

## What Sleeper can and cannot give us

Probed live; do not re-litigate:

- Multi-season league history works, verified 2019 through 2026.
- `winners_bracket` gives the champion through the `p:1` match.
- **There is no per-pick draft timestamp anywhere**, in REST or in GraphQL. Both
  were introspected. Whole-draft pace is a fact about the ROOM and is labelled as
  one; per-manager timing is measured going forward into
  `draft_pick_observations` and starts empty by construction.

## Known limitations, recorded rather than hidden

- The sync queue is FIFO and site-wide, so one large lookup still delays what is
  behind it. Throughput was improved (batch of 8, footprint jobs paced faster)
  but the queue is not FAIR. Per-owner round-robin in the claim RPC is the real
  fix and is not built.
- Draft grades are null everywhere. `draft_selections` stores no grade and the On
  The Clock grader is a compute over a live board, so `avgDraftGrade` is honestly
  absent rather than reimplemented here.
- The Avoids list judges opportunity from one CURRENT league-wide roster rate
  rather than a per-season one, so it can overstate opportunity for a player who
  entered the league mid-window.
- `finish` is 1 for a champion, 2 for a runner-up, null otherwise. A fuller
  placement read needs the whole bracket walked. Null is deliberate; a finish is
  never guessed from the regular-season record.
- The report is one atomic document behind one Suspense boundary. Splitting the
  service into independently-resolving sections is possible and not built.
- `npm audit` reports 7 pre-existing vulnerabilities (5 high, 2 low) in `next`,
  `sharp`, `postcss`, `nanoid`, `browserslist`, `esbuild` and
  `postcss-selector-parser`. `package.json` and `package-lock.json` are untouched
  by this build, so none were introduced here. Needs a separate dependency pass.

## If you pick this up cold

Read `docs/manager-pulse-plan.md` sections 1 to 3 for what the feature is, then
its section 15 for what actually shipped, then the `MP-R###` entries at the end
of `progress.md`, which are the review findings and what was done about each.

## Standing instructions

- Do not commit. Do not push.
- Update `progress.md` as each task lands, never batched.
- No em dash, no en dash, no curly quotes, no ellipsis character, no emoji.
  Straight ASCII only, everywhere.
