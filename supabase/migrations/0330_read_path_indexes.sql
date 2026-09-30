-- Migration 0330: indexes for four read paths and five foreign keys.
--
-- Access matrix: UNCHANGED on every table. This migration adds indexes only,
-- creates no table, and touches no policy or grant. Safe to apply at any time,
-- in any order relative to the code that benefits from it.
--
-- WHY
--   league_power_rankings_cache (league_id, generated_at desc)
--     lib/league-pulse.ts powerRankingsAreStale reads the newest generated_at
--     for one league on every deep-view load. The only league-leading index is
--     (league_id, format_config_id, source), so the read fetched every row the
--     league holds (768 for a busy league, one per roster per format per
--     source) from the heap and sorted them to keep one. This index answers it
--     with a single index entry.
--
--   player_projection_accuracy (computed_at desc)
--     lib/positional-war/load.ts loadAccuracySnapshot reads the newest
--     computed_at with no filter. EXPLAIN on production: a sequential scan of
--     all 16,688 rows and a top-N sort, 6 ms. With this index it is one entry.
--
--   draft_pick_values (format_config_id, source, captured_at desc)
--     lib/league-power-rankings.ts and lib/trade-finder-data.ts now read the
--     newest capture per (format, source) and then that one capture, instead
--     of every row ever captured. Both steps are this index.
--
--   Foreign keys on a read path with no index leading on the column:
--     vote_matchups.player_a_id, vote_matchups.player_b_id
--     signals.favorite_player_id
--     signal_reaction_counts.reaction_type_id  (the primary key is
--                                              (target_type, target_id,
--                                              reaction_type_id), which does not
--                                              lead with it)
--     user_preferences.default_format_config_id
--   Each was checked against pg_indexes on 2026-09-29 and has no covering index.
--
-- Every table here is small except league_power_rankings_cache (about 200k
-- rows), which builds in seconds. Run by hand with CONCURRENTLY if you want to
-- avoid the brief write lock on that one:
--   create index concurrently if not exists idx_lprc_league_generated
--     on public.league_power_rankings_cache (league_id, generated_at desc);

create index if not exists idx_lprc_league_generated
  on public.league_power_rankings_cache (league_id, generated_at desc);

create index if not exists idx_player_projection_accuracy_computed_at
  on public.player_projection_accuracy (computed_at desc);

create index if not exists idx_draft_pick_values_format_source_captured
  on public.draft_pick_values (format_config_id, source, captured_at desc);

create index if not exists idx_vote_matchups_player_a
  on public.vote_matchups (player_a_id);

create index if not exists idx_vote_matchups_player_b
  on public.vote_matchups (player_b_id);

create index if not exists idx_signals_favorite_player
  on public.signals (favorite_player_id);

create index if not exists idx_signal_reaction_counts_reaction_type
  on public.signal_reaction_counts (reaction_type_id);

create index if not exists idx_user_preferences_default_format
  on public.user_preferences (default_format_config_id);
