-- Migration 0276: drop the thirteen indexes confirmed unused.
--
-- Access matrix: UNCHANGED on every table. This migration drops indexes only.
--
-- WHY (docs/performance/site-speed-audit-and-plan.md, 4.17 and 6.2)
--   All forty indexes flagged by the advisor together are under 5 MB;
--   thirty-six of them are 8 to 32 kB. Dropping them saves a negligible
--   amount of write time. This is hygiene, and it is the lowest priority
--   task in the whole plan: correctness beats completeness here, so each
--   drop below was re-derived independently on 2026-09-08 rather than taken
--   on the audit's word, against four checks:
--     1. idx_scan in pg_stat_user_indexes is 0. Note that pg_stat_statements
--        was reset on 2026-09-08, but the pg_stat_user_indexes scan counters
--        were NOT reset, so idx_scan is still the long-running total.
--     2. grep across lib/, app/, components/, scripts/ for the indexed
--        column, in .from() predicate chains (eq, in, order, gte, lte, is,
--        ilike, contains, overlaps) and in or() filter strings: no hit.
--     3. grep across supabase/migrations/*.sql, plus a query against
--        pg_proc.prosrc, for the same column: no hit outside the column's
--        own definition and the index's own creation statement.
--     4. information_schema.table_constraints / key_column_usage: the
--        column does not back a foreign key. Cross-checked against the
--        Supabase performance advisor's unindexed-foreign-key count before
--        and after the drop (53 before, verified unchanged after); a count
--        that rose would mean an index here was backing one.
--
-- Each statement below carries its own evidence and its own original
-- `create index` statement (read from pg_indexes.indexdef, which prints it
-- exactly), so a wrong call is reversible by copy and paste.
--
-- Created CONCURRENTLY, which cannot run inside a transaction block, so the
-- statements below were run by hand rather than through the migration
-- runner. Applied to production 2026-09-08.

-- articles.article_type: idx_scan 0, 16 kB. article_type is selected and
-- inserted (lib/home-content.ts, app/api/search/route.ts, app/page.tsx,
-- lib/beacon-brief-feed.ts, lib/beacon-brief/worker.ts) but never appears in
-- an eq/in/order predicate anywhere in lib/, app/, components/, scripts/, or
-- in a migration or pg_proc function body outside its own column and index
-- definitions (0005_articles.sql, 0091_..., 0151_...). Not a foreign key.
--
--   create index concurrently if not exists idx_articles_type
--     on public.articles using btree (article_type);
drop index concurrently if exists idx_articles_type;

-- beacon_custom_value_cache.computed_at: idx_scan 0, 8192 bytes.
-- beacon_custom_value_cache has no reader anywhere in the app (grep for the
-- table name finds only lib/database.types.ts and its own creation
-- migration 0045). Not a foreign key.
--
--   create index concurrently if not exists idx_beacon_custom_value_cache_computed
--     on public.beacon_custom_value_cache using btree (computed_at);
drop index concurrently if exists idx_beacon_custom_value_cache_computed;

-- beacon_custom_value_cache.run_id: idx_scan 0, 8192 bytes. Same table as
-- above, no reader anywhere in the app. Not a foreign key.
--
--   create index concurrently if not exists idx_beacon_custom_value_cache_run
--     on public.beacon_custom_value_cache using btree (run_id);
drop index concurrently if exists idx_beacon_custom_value_cache_run;

-- beacon_manual_signals (pick_season, pick_round) where target = 'pick':
-- idx_scan 0, 16 kB. lib/beacon/signals/manual.ts loadManualSignals selects
-- pick_season and pick_round but filters only on is_active and expires_at;
-- pick_season/pick_round/target are read out of the row in application code,
-- never used as a database predicate. Not a foreign key.
--
--   create index concurrently if not exists idx_beacon_manual_signals_pick
--     on public.beacon_manual_signals using btree (pick_season, pick_round)
--     where (target = 'pick'::text);
drop index concurrently if exists idx_beacon_manual_signals_pick;

-- beam_queries.question_normalized: idx_scan 0, 16 kB. lib/beam/log.ts only
-- inserts the column; app/admin/beam/gaps/page.tsx selects it and groups in
-- application memory (row.question_normalized || row.question as a map key),
-- never as a database filter or order. Not a foreign key.
--
--   create index concurrently if not exists idx_beam_queries_normalized
--     on public.beam_queries using btree (question_normalized);
drop index concurrently if exists idx_beam_queries_normalized;

-- manager_pulse_tendencies.dynasty_sample desc where dynasty_sample > 0:
-- idx_scan 0, 16 kB. Both readers (lib/manager-pulse/service.ts,
-- app/admin/manager-pulse/cache/page.tsx) select dynasty_sample for display
-- only; the admin page orders by generated_at, not by dynasty_sample. Not a
-- foreign key.
--
--   create index concurrently if not exists manager_pulse_tendencies_dynasty_idx
--     on public.manager_pulse_tendencies using btree (dynasty_sample desc)
--     where (dynasty_sample > 0);
drop index concurrently if exists manager_pulse_tendencies_dynasty_idx;

-- manager_pulse_tendencies.redraft_sample desc where redraft_sample > 0:
-- idx_scan 0, 16 kB. Same table and same reasoning as dynasty_sample above:
-- selected for display, never filtered or ordered on. Not a foreign key.
--
--   create index concurrently if not exists manager_pulse_tendencies_redraft_idx
--     on public.manager_pulse_tendencies using btree (redraft_sample desc)
--     where (redraft_sample > 0);
drop index concurrently if exists manager_pulse_tendencies_redraft_idx;

-- news_items.published_at desc nulls last: idx_scan 0, 8192 bytes.
-- news_items has no reader anywhere in the app (grep for the table name
-- finds only lib/database.types.ts). Not a foreign key.
--
--   create index concurrently if not exists idx_news_published
--     on public.news_items using btree (published_at desc nulls last);
drop index concurrently if exists idx_news_published;

-- nfl_game_odds (season, season_type, week, away_team): idx_scan 0, 32 kB.
-- Both readers (lib/build-beacon-projections.ts loadEnvironment,
-- lib/nfl-game-environment.ts loadGameEnvironment) filter on season,
-- season_type and week (loadGameEnvironment also filters on source);
-- away_team is read out of the returned rows, never a predicate column, so
-- it adds nothing on top of the (season, season_type, week) prefix. Not a
-- foreign key.
--
--   create index concurrently if not exists nfl_game_odds_away_team_idx
--     on public.nfl_game_odds using btree (season, season_type, week, away_team);
drop index concurrently if exists nfl_game_odds_away_team_idx;

-- signal_check_audit_log.created_at desc: idx_scan 0, 16 kB. Every call site
-- (app/admin/signal-check/actions.ts, regression-actions.ts) only inserts
-- into this table; nothing in the app selects it back, so nothing orders or
-- filters on created_at. Not a foreign key (the table's actor_user_id
-- foreign key is a separate, unindexed column left alone per 4.17: it is not
-- one of the thirteen and is not touched by this migration).
--
--   create index concurrently if not exists idx_signal_check_audit_log_created
--     on public.signal_check_audit_log using btree (created_at desc);
drop index concurrently if exists idx_signal_check_audit_log_created;

-- user_preferences ((sleeper_league_settings ->> 'featured_league_id')) where
-- the key exists: idx_scan 0, 16 kB. Every reader
-- (app/my-beacon/sleeper-leagues/page.tsx, app/my-beacon/layout.tsx,
-- lib/sleeper-league-settings.ts) selects the whole sleeper_league_settings
-- jsonb column and reads settings.featured_league_id in application code;
-- nothing issues a Postgres predicate on the ->> expression this index
-- covers. Not a foreign key (sleeper_league_settings is jsonb, not an id
-- column, and carries no constraint).
--
--   create index concurrently if not exists user_preferences_featured_league_id_idx
--     on public.user_preferences using btree (((sleeper_league_settings ->> 'featured_league_id'::text)))
--     where (sleeper_league_settings ? 'featured_league_id'::text);
drop index concurrently if exists user_preferences_featured_league_id_idx;

-- vote_matchups.is_active: idx_scan 0, 8192 bytes. vote_matchups has no
-- reader anywhere in the app (grep for the table name finds only
-- lib/database.types.ts and its creation migration 0006_votes.sql). Not a
-- foreign key.
--
--   create index concurrently if not exists idx_matchups_active
--     on public.vote_matchups using btree (is_active);
drop index concurrently if exists idx_matchups_active;

-- vote_matchups (season, week): idx_scan 0, 8192 bytes. Same table as
-- above, no reader anywhere in the app. Not a foreign key.
--
--   create index concurrently if not exists idx_matchups_week
--     on public.vote_matchups using btree (season, week);
drop index concurrently if exists idx_matchups_week;
