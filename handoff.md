# Handoff: Long Shot build

Plan: docs/completed/long-shot/long-shot-plan.md (section 30 lists what shipped differently; section 31 is the 2026-11-08 question-variety, scoring and history-pool build). Task lines: progress.md, heading "## Long Shot".

## State

- Last task completed: LS-T065 (fourteen question families with a source and position rule, two-board market questions, banded scoring, the nflverse history pool and its sync, the typeahead over retired players)
- Build complete and reviewed: f98613d shipped the game, 63bd15f the post-ship review, the LS-T065 commit carries this build
- Half-finished: none
- Last gate: after LS-T065 (typecheck clean, lint 0 errors 0 warnings, npm test green, npm run build succeeds)

## What was built

- Migrations 0363 to 0370, all applied to cilvpyivysjxpxbudkfa through the Supabase MCP. 0370 adds history_players, history_player_seasons and history_player_season_stats (service role only) and drops the players foreign keys on long_shot_answers.player_id and long_shot_answer_tallies.player_id, because an answer may now be a history id.
- lib/long-shot/ (model, generator with fourteen prompt families, attempt engine, settlement, boards, profile links, client, history helpers), the routes under app/api/games/long-shot/, two crons (long-shot-generate 17:00 UTC, long-shot-settle 05:30 UTC), the page at /games/long-shot with the signed-out demo, the admin page at /admin/long-shot, the shared player combobox.
- scripts/sync-nfl-history.ts (npm run sync:nfl-history) fills the history pool from the nflverse releases; scripts/long-shot-generate.ts (npm run long-shot:generate) writes a day from the command line; scripts/long-shot-dry-run.ts prints one without writing.

## Owner checks after the push deploys

1. Play today's puzzle: the day was regenerated after this build and every attempt, answer, tally and stats row was cleared, so every account starts fresh.
2. Confirm the first long-shot-generate run in cron_runs (17:00 UTC) built tomorrow with five families from five sources (the admin page's try log shows the sources skipped as "source already asked").
3. Type a retired player's name in the picker (four letters) and confirm the note shows his years and franchises.
4. The next morning, confirm the long-shot-settle run (05:30 UTC) and the Yesterday panel.
5. Once a year, after the season ends, run npm run sync:nfl-history to add the finished season to the pool.

## Blocked

- nothing blocked

## Choices made where the plan was silent

All recorded under their tasks in progress.md and summarized in plan sections 30 and 31.
