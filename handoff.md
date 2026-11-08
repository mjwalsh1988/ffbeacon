# Handoff: Long Shot build

Plan: docs/completed/long-shot/long-shot-plan.md (section 30 lists what shipped differently, and its "Post-ship review" subsection lists the 2026-11-08 review changes). Task lines: progress.md, heading "## Long Shot".

## State

- Last task completed: LS-T064 (the post-ship review, the owner's typeahead change, the second device pass, the single reviewer sub-agent)
- Build complete and reviewed: f98613d shipped the game; the LS-T064 commit carries the review fixes
- Half-finished: none
- Last gate: after LS-T064 (typecheck clean, lint 0 errors 0 warnings, npm test green, npm run build succeeds)

## What was built

- Seven migrations, 0363 to 0369, all applied to cilvpyivysjxpxbudkfa through the Supabase MCP and verified (RLS probe in one rollback block; every RPC service-role only). Types regenerated.
- lib/long-shot/ (model, generator with seven prompt families, attempt engine, settlement, boards, profile links, client), the routes under app/api/games/long-shot/, two crons (long-shot-generate 17:00 UTC, long-shot-settle 05:30 UTC, both in vercel.json and lib/cron-runs.ts), the page at /games/long-shot with the signed-out demo, the admin page at /admin/long-shot, the shared player combobox (Signal Scout now uses it too), registration in the catalog, nav, search, footer, games page, homepage, OG card and sitemap, and a CLAUDE.md section.
- Device pass screenshots in data/long-shot/device-pass/.

## The 2026-11-08 post-ship review (LS-T064)

- The player picker is a typeahead only, in the game and the demo: nothing is listed until four letters are typed (SEARCH_MIN_LENGTH in lib/long-shot/types.ts), the search route enforces the same floor, and the demo's native select is gone.
- Ten defects fixed; each is listed under LS-T064 in progress.md and in the plan's Post-ship review subsection.
- Production is clean: every row the review's test play created was deleted and the day's counters reset, so the owner's account can play today's puzzle.

## Owner checks after the push deploys

1. Confirm the first long-shot-generate run in cron_runs (17:00 UTC) built tomorrow; the admin page shows it under Status and the try log.
2. Play one Hurry-Up and one Film Room day in production.
3. The next morning, confirm the long-shot-settle run (05:30 UTC) and that the Yesterday panel shows the settled day.
4. Run the launch checklist in plan section 24.
5. Not verified in a browser: the OS reduced-motion setting. Worth one manual look.

## Blocked

- nothing blocked

## Choices made where the plan was silent

All recorded under their tasks in progress.md and summarized in plan section 30.
