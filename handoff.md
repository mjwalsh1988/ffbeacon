# Handoff: Long Shot build

Plan: docs/completed/long-shot/long-shot-plan.md (section 30 lists what shipped differently). Task lines: progress.md, heading "## Long Shot".

## State

- Last task completed: LS-T062 (this file, the plan moved, the docs/README.md row moved to Completed)
- Next task: LS-T063, the one commit and push to main
- Half-finished: none
- Last gate: after the LS-T061 fixes (typecheck clean, lint 0 errors 0 warnings, npm test 596 files 7985 tests, npm run build succeeds)

## What was built

- Seven migrations, 0363 to 0369, all applied to cilvpyivysjxpxbudkfa through the Supabase MCP and verified (RLS probe in one rollback block; every RPC service-role only). Types regenerated.
- lib/long-shot/ (model, generator with seven prompt families, attempt engine, settlement, boards, profile links, client), the routes under app/api/games/long-shot/, two crons (long-shot-generate 17:00 UTC, long-shot-settle 05:30 UTC, both in vercel.json and lib/cron-runs.ts), the page at /games/long-shot with the signed-out demo, the admin page at /admin/long-shot, the shared player combobox (Signal Scout now uses it too), registration in the catalog, nav, search, footer, games page, homepage, OG card and sitemap, and a CLAUDE.md section.
- Device pass screenshots in data/long-shot/device-pass/.

## Production data the build left behind

- Today's (2026-11-08) puzzle exists, generated inline by the device pass.
- The owner's account has a completed Hurry-Up for 2026-11-08 (150 points; two prompts timed out while the agent drove the page), stats of 1 day, 150 points, streak 1, and two abandoned Film Room attempts. These are real rows from playing the game as the plan's device pass directs. To play today yourself, delete them:
  `delete from long_shot_attempts where user_id = '5d99293a-e91e-463f-b348-f3a0ae8df08e';`
  `delete from long_shot_user_stats where user_id = '5d99293a-e91e-463f-b348-f3a0ae8df08e';`
- All seeded test rows were deleted and verified gone.

## Owner checks after the push deploys

1. Confirm the first long-shot-generate run in cron_runs (17:00 UTC) built tomorrow; the admin page shows it under Status and the try log.
2. Play one Hurry-Up and one Film Room day in production.
3. The next morning, confirm the long-shot-settle run (05:30 UTC) and that the Yesterday panel shows the settled day.
4. Run the launch checklist in plan section 24.
5. Not verified by the agent: clicking through the signed-out demo (checked by fetching the HTML instead) and the OS reduced-motion setting. Worth one manual look each.

## Blocked

- nothing blocked

## Choices made where the plan was silent

All recorded under their tasks in progress.md and summarized in plan section 30.
