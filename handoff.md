# Handoff

Session of 2026-09-08. Build: **the site speed plan**. Plan of record:
`docs/performance/site-speed-audit-and-plan.md`, whose Part 8 is the build.
Tasks: `progress.md`, prefix `PERF-T###`, at the very end of that file.

The previous entry (Manager Pulse, session of 2026-09-04) is complete and lives
in the git history of this file.

## State

**Nothing is committed. Nothing is pushed.** Everything is in the working tree,
by instruction.

Migrations 0271 through 0278 are APPLIED TO PRODUCTION. They are not revertible
by discarding the working tree, so read the next section before assuming a
`git checkout` puts things back.

## What is already on the production database

| Migration | What it did | Reversible by |
| --- | --- | --- |
| 0271 | `players.sleeper_slug_tail` generated column plus its index, and a backfill that touched zero rows | dropping the column and index |
| 0272 | `player_market_latest` view renamed to `..._view`, real table created, seeded | dropping the table and renaming the view back |
| 0273 | two indexes: player_value_history (source, captured_at desc), rankings (generated_at desc) | dropping them |
| 0274 | 58 RLS policies rewritten to the initplan form, by ALTER POLICY | re-running the original expressions; the before snapshot is in the migration's comment |
| 0275 | seven foreign-key indexes | dropping them |
| 0276 | thirteen unused indexes dropped, each with its original CREATE beside it | copy and paste the recorded CREATE |
| 0277 | `league_sync_tick` function | dropping the function; the worker code must go back at the same time |
| 0278 | autovacuum thresholds on player_value_history and player_stats | resetting the reloptions |

Also run by hand and NOT in a migration, because neither is repeatable DDL:
`vacuum (analyze)` on `player_value_history` and `player_stats`, and
`pg_stat_statements_reset()` (see the next section).

## The measurement baseline, and why the reset matters

`docs/performance/db-baseline-2026-09-08.md` is the last reading of the old
`pg_stat_statements` window (115 days) plus the exact SQL that produced it. The
ledger was RESET at the end of that recording, per PERF-T003, so the comparison
window starts from 2026-09-08. Re-run the three queries in that file for the
after-run; do not expect the old totals back.

`docs/performance/bundle-<date>.txt` is written by `npm run measure:bundle`,
which needs a `next build` first.

## Rules that are easy to break by accident

1. **Never run `git stash` in this tree while other work is in flight.** It
   happened once in this session: an agent took a baseline that way and briefly
   removed every other agent's uncommitted work. Nothing was lost, but the
   recovery cost half an hour. If you want a before state, take the numbers
   already recorded above.

2. **`resolveSleeperPlayers` is the only place allowed to run the slug-tail
   fallback.** `lib/players/sleeper-lookup-guard.test.ts` fails the suite if the
   string `slug.like.*-` reappears in code anywhere under app, components, lib
   or scripts. If you need a column the helper does not return, widen it there
   once rather than writing a seventh copy.

3. **`memoTtl` is never for a user-scoped read.** The store is one global Map in
   one process. A key built from a reader's id would hand that reader's answer
   to the next person who asks. `lib/memo-ttl.ts` says so at length; the warning
   is load-bearing.

4. **`pulseLeagueCore` returns zeroes for `counts` unless asked.** That is the
   documented contract, not a measurement. Only `pulseLeague` asks, because only
   its own result type promises them.

5. **`pulseLeagueCore.league` can be null.** Every caller keeps a fallback read.
   The null branch is not dead code.

6. **The rankings page still reads one row of `player_value_history`.** It is
   the "Values as of" date and it is not derivable from the trends row, whose
   `updated_at` is when the nightly calculation ran. Do not "finish the job" by
   deleting it.

## What is not done

- **PERF-T032, the account forms.** Twelve forms under `/login` and
  `/my-beacon/**` still import `lib/supabase/client` to submit, which puts the
  242 kB browser Supabase client on eight routes. Each form needs its write
  moved into a server action, and the avatar and media uploaders keep a client
  behind a dynamic import because they stream files to Storage. This is the
  largest remaining item and it is twelve separate reviews.
- **`app/players/loading.tsx` and `app/[handle]/loading.tsx`**, deliberately
  skipped. See the PERF-T034 entry in `progress.md` for the soft-404 reasoning
  and what closing it properly would take.
- **`player_market_latest_view`** is still there. The plan says to drop it in a
  later migration once `sync-sleeper-market` has run at least once in
  production. It has not run yet.
- **The JWT signing key question.** `getClaims()` is in the middleware and is
  correct either way, but it only saves the round trip if the project's ES256
  key is the CURRENT signing key rather than a standby. That is one look in the
  Supabase dashboard under Authentication, JWT signing keys. See the PERF-T022
  entry.
- **Three tables have no reader in the app at all**: `beacon_custom_value_cache`,
  `news_items`, and `vote_matchups` with `votes`. Their indexes were dropped;
  whether the tables should be retired is the owner's call, recorded in Part 11
  of the plan.

## Where to pick up

`progress.md`, the `PERF-T###` section at the end. Every deviation from the plan
is recorded there under its task id with the reason, which is the point: several
of them are places where the plan's draft SQL or column names did not match the
live database, and following the plan literally would have been wrong.
