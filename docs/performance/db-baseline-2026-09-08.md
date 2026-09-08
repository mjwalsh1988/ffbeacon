# Database baseline, 2026-09-08

PERF-T003. Recorded immediately before Phase 1 of the speed build, from the
production database (`cilvpyivysjxpxbudkfa`). `pg_stat_statements` had been
accumulating since 2026-05-16 21:56 UTC, 115 days. It was reset at the end of
this recording, so every figure below is the last reading of the old window and
everything measured after this file starts from zero.

The gateway per-table request counts are not repeated here; they are in Part 3
of `site-speed-audit-and-plan.md` and the gateway log is the only source for
them.

## The queries this file was made with

```sql
-- Top shapes by total execution time.
select
  round((total_exec_time/1000.0)::numeric, 1) as total_s,
  calls,
  round(mean_exec_time::numeric, 1) as mean_ms,
  round(max_exec_time::numeric, 1) as max_ms,
  left(regexp_replace(query, '\s+', ' ', 'g'), 150) as q
from pg_stat_statements
order by total_exec_time desc
limit 30;

-- Top shapes by mean, ignoring one-off shapes.
select
  round(mean_exec_time::numeric, 1) as mean_ms,
  calls,
  round((total_exec_time/1000.0)::numeric, 1) as total_s,
  left(regexp_replace(query, '\s+', ' ', 'g'), 120) as q
from pg_stat_statements
where calls > 20
order by mean_exec_time desc
limit 20;

-- Table sizes and scan counters.
select relname as table_name,
  pg_size_pretty(pg_total_relation_size(relid)) as total,
  n_live_tup as rows,
  seq_scan, n_dead_tup,
  to_char(last_autovacuum, 'YYYY-MM-DD') as last_autovacuum
from pg_stat_user_tables
order by pg_total_relation_size(relid) desc
limit 15;

-- The reset, run last.
select pg_stat_statements_reset();
```

## Top shapes by total time

| Total s | Calls | Mean ms | Max ms | What it is |
| --- | --- | --- | --- | --- |
| 13,170.6 | 2,359,794 | 5.6 | 14,016 | Realtime WAL poll. Platform cost, 4.18. |
| 5,392.9 | 7,857 | 686.4 | 3,000 | `get_player_positional_finishes` RPC. PERF-T011. |
| 3,207.2 | 77,530 | 41.4 | 7,882 | `player_value_history` read on the rankings page. PERF-T051. |
| 2,122.2 | 5,820 | 364.6 | 3,034 | `calculate-trends` keyset page over 2.07M rows. Expected. |
| 1,568.8 | 3,227 | 486.1 | 2,554 | `players` lookup with the slug-tail LIKE. PERF-T010. |
| 1,297.2 | 2,490 | 521.0 | 1,963 | `player_value_history` insert, nightly sync. Expected. |
| 1,195.6 | 9,993 | 119.6 | 2,961 | `player_value_history` by player. |
| 1,141.5 | 4,664 | 244.7 | 1,210 | `player_stats` by player and season. 4.21. |
| 983.9 | 1,685 | 583.9 | 2,593 | `players` lookup variant. PERF-T010. |
| 919.6 | 1,527 | 602.2 | 3,596 | `players` lookup variant. PERF-T010. |
| 880.3 | 1,683 | 523.1 | 2,326 | `players` lookup variant. PERF-T010. |
| 816.8 | 1,873 | 436.1 | 2,449 | `player_value_history` insert with offset. Expected. |
| 761.5 | 2,317 | 328.6 | 1,439 | `pg_timezone_names`. The Supabase dashboard, not the app. |
| 591.1 | 7,992 | 74.0 | 237 | `player_stats` by season and week. |
| 577.8 | 28,238 | 20.5 | 6,206 | `draft_pick_values`. |
| 572.5 | 33 | 17,349.7 | 24,591 | `rebuild_positional_finishes()`. Nightly, expected. |
| 537.2 | 40,038 | 13.4 | 495 | `player_value_history` value read. |
| 511.5 | 7,192 | 71.1 | 4,211 | `league_power_rankings_cache` insert. |
| 486.4 | 1,658 | 293.3 | 7,710 | `player_value_history` by player and format. |
| 451.8 | 1,520 | 297.3 | 2,514 | `players` lookup variant. PERF-T010. |
| 446.3 | 2,622 | 170.2 | 7,763 | `trade_values`. |
| 443.1 | 184,512 | 2.4 | 305 | `cron_runs` insert. PERF-T060. |
| 416.4 | 1,411 | 295.1 | 2,616 | `player_weekly_projections` by player. |
| 362.2 | 24,734 | 14.6 | 736 | `player_weekly_projections` by season and week. |
| 337.7 | 240 | 1,407.2 | 3,944 | `player_stats` wide read. 4.21. |
| 336.1 | 4,773 | 70.4 | 1,724 | `player_weekly_projections` id probe. |
| 335.1 | 220,736 | 1.5 | 447 | `claim_league_sync_jobs` RPC. PERF-T060. |
| 328.0 | 10,499 | 31.2 | 1,619 | `draft_pick_values` by season and round. |
| 323.3 | 602 | 537.0 | 7,489 | `player_value_history` latest per source. PERF-T013. |
| 310.1 | 373 | 831.3 | 5,687 | `player_market_latest` view. PERF-T012. |

## Top shapes by mean time, calls over 20

| Mean ms | Calls | Total s | What it is |
| --- | --- | --- | --- |
| 17,349.7 | 33 | 572.5 | `rebuild_positional_finishes()`, nightly |
| 4,788.7 | 23 | 110.1 | `player_stats` wide read |
| 3,389.3 | 71 | 240.6 | player RPC |
| 2,037.7 | 27 | 55.0 | `player_stats` wide read |
| 1,407.2 | 240 | 337.7 | `player_stats` wide read |
| 1,270.1 | 111 | 141.0 | `player_stats` insert |
| 1,267.8 | 115 | 145.8 | `player_value_history` read |
| 1,010.2 | 276 | 278.8 | player RPC |
| 893.7 | 254 | 227.0 | `player_value_history` by player and format |
| 858.8 | 41 | 35.2 | `player_market_latest` view. PERF-T012. |
| 831.3 | 373 | 310.1 | `player_market_latest` view. PERF-T012. |
| 707.9 | 207 | 146.5 | `player_stats` wide read |
| 686.4 | 7,857 | 5,392.9 | `get_player_positional_finishes`. PERF-T011. |
| 644.1 | 23 | 14.8 | `players` lookup. PERF-T010. |
| 618.9 | 21 | 13.0 | `players` lookup. PERF-T010. |
| 611.5 | 104 | 63.6 | `player_market_latest` view. PERF-T012. |
| 602.2 | 1,527 | 919.6 | `players` lookup. PERF-T010. |
| 595.2 | 28 | 16.7 | `players` lookup. PERF-T010. |
| 583.9 | 1,685 | 983.9 | `players` lookup. PERF-T010. |
| 583.8 | 299 | 174.5 | `player_value_history` read |

## Table sizes and scan counters

| Table | Total | Rows | Seq scans | Dead tuples | Last autovacuum |
| --- | --- | --- | --- | --- | --- |
| player_value_history | 1,771 MB | 2,073,269 | 3,637 | 29,251 | 2026-08-11 |
| player_stats | 949 MB | 292,916 | 43 | 41,328 | 2026-07-24 |
| league_power_rankings_cache | 224 MB | 97,320 | 22 | 10,000 | 2026-09-07 |
| player_market_snapshots | 171 MB | 109,754 | 580 | 369 | 2026-09-05 |
| league_matchups | 145 MB | 78,504 | 26 | 1,674 | 2026-09-07 |
| player_weekly_projections | 108 MB | 51,530 | 871 | 0 | 2026-09-08 |
| cron_runs | 76 MB | 24,269 | 778 | 439 | 2026-09-08 |
| league_transactions | 72 MB | 60,852 | 156 | 4,375 | 2026-09-07 |
| draft_selections | 57 MB | 62,374 | 278 | 294 | 2026-09-07 |
| players | 49 MB | 10,481 | 81,321 | 721 | 2026-09-08 |
| draft_pick_values | 31 MB | 29,052 | 1,013 | 0 | 2026-08-17 |
| beacon_brief_logs | 23 MB | 7,871 | 9 | 1 | 2026-08-30 |
| league_activity | 19 MB | 22,470 | 26 | 0 | 2026-09-08 |
| positional_war_curves | 17 MB | 1,436 | 12 | 225 | 2026-09-07 |
| player_positional_finishes | 14 MB | 48,615 | 43 | 0 | 2026-09-08 |

Two numbers to watch after the build. `players` shows 81,321 sequential scans
on a 10,481 row table, which is PERF-T010 and nothing else; that counter should
stop climbing. `player_stats` had not been autovacuumed since 2026-07-24 with
41,328 dead tuples, which is PERF-T061.

## Reset

`select pg_stat_statements_reset();` was run after the three queries above.
The comparison run for Part 9 should re-run the same three.
