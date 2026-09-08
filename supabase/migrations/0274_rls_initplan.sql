-- Migration 0274: rewrite RLS policies to the initplan form
--
-- Access matrix statement: UNCHANGED on every table this migration touches.
-- This migration rewrites policy expressions only, and changes no policy
-- name, role, command or permissiveness.
--
-- Reason: docs/performance/site-speed-audit-and-plan.md section 4.16 and 6.3
-- (PERF-T014). A bare auth.uid() call inside a policy expression is evaluated
-- once per candidate row. Wrapped as (select auth.uid()) it is a scalar
-- subquery Postgres can hoist into an initplan and evaluate once per query.
-- Semantics are identical; only the evaluation count changes.
--
-- Policies touched: 58 across 21 tables:
--   beacon_custom_formats
--   league_bulk_sync_requests
--   league_sync_jobs
--   manager_pulse_run_leagues
--   manager_pulse_runs
--   signal_check_analyses
--   signal_comments
--   signal_follows
--   signal_post_images
--   signal_posts
--   signal_reactions
--   signal_reports
--   signal_scout_daily_scores
--   signal_scout_user_stats
--   signals
--   trade_suggestion_declines
--   trade_suggestion_saves
--   user_preferences
--   user_ranking_board_players
--   user_ranking_boards
--   votes
--
-- ALTER POLICY is used instead of DROP + CREATE so the name, roles, command
-- and permissiveness cannot drift: only the USING / WITH CHECK expression is
-- replaced.

-- beacon_custom_formats.beacon_custom_formats_delete_own (DELETE)
alter policy "beacon_custom_formats_delete_own" on public.beacon_custom_formats
  using (((select auth.uid()) = created_by));

-- beacon_custom_formats.beacon_custom_formats_insert_own (INSERT)
alter policy "beacon_custom_formats_insert_own" on public.beacon_custom_formats
  with check (((select auth.uid()) = created_by));

-- beacon_custom_formats.beacon_custom_formats_select_own (SELECT)
alter policy "beacon_custom_formats_select_own" on public.beacon_custom_formats
  using (((select auth.uid()) = created_by));

-- beacon_custom_formats.beacon_custom_formats_update_own (UPDATE)
alter policy "beacon_custom_formats_update_own" on public.beacon_custom_formats
  using (((select auth.uid()) = created_by))
  with check (((select auth.uid()) = created_by));

-- league_bulk_sync_requests.league_bulk_sync_requests_select_own (SELECT)
alter policy "league_bulk_sync_requests_select_own" on public.league_bulk_sync_requests
  using (((select auth.uid()) = user_id));

-- league_sync_jobs.league_sync_jobs_select_own (SELECT)
alter policy "league_sync_jobs_select_own" on public.league_sync_jobs
  using (((select auth.uid()) = user_id));

-- manager_pulse_run_leagues.manager_pulse_run_leagues_select_own (SELECT)
alter policy "manager_pulse_run_leagues_select_own" on public.manager_pulse_run_leagues
  using (((select auth.uid()) = user_id));

-- manager_pulse_runs.manager_pulse_runs_select_own (SELECT)
alter policy "manager_pulse_runs_select_own" on public.manager_pulse_runs
  using (((select auth.uid()) = user_id));

-- signal_check_analyses.signal_check_analyses_select_own (SELECT)
alter policy "signal_check_analyses_select_own" on public.signal_check_analyses
  using (((select auth.uid()) = user_id));

-- signal_comments.signal_comments_delete_own (DELETE)
alter policy "signal_comments_delete_own" on public.signal_comments
  using (((select auth.uid()) = author_user_id));

-- signal_comments.signal_comments_insert_own (INSERT)
alter policy "signal_comments_insert_own" on public.signal_comments
  with check ((((select auth.uid()) = author_user_id) AND (EXISTS ( SELECT 1
   FROM (signal_posts p
     JOIN signals s ON ((s.id = p.signal_id)))
  WHERE ((p.id = signal_comments.post_id) AND (p.hidden = false) AND (s.status = 'published'::text) AND (s.visibility = 'public'::text) AND (s.hidden = false))))));

-- signal_comments.signal_comments_select_own (SELECT)
alter policy "signal_comments_select_own" on public.signal_comments
  using (((select auth.uid()) = author_user_id));

-- signal_comments.signal_comments_select_wall_owner (SELECT)
alter policy "signal_comments_select_wall_owner" on public.signal_comments
  using ((EXISTS ( SELECT 1
   FROM (signal_posts p
     JOIN signals s ON ((s.id = p.signal_id)))
  WHERE ((p.id = signal_comments.post_id) AND (s.user_id = (select auth.uid()))))));

-- signal_comments.signal_comments_update_own (UPDATE)
alter policy "signal_comments_update_own" on public.signal_comments
  using (((select auth.uid()) = author_user_id))
  with check (((select auth.uid()) = author_user_id));

-- signal_follows.signal_follows_delete_own (DELETE)
alter policy "signal_follows_delete_own" on public.signal_follows
  using (((select auth.uid()) = follower_user_id));

-- signal_follows.signal_follows_insert_own (INSERT)
alter policy "signal_follows_insert_own" on public.signal_follows
  with check (((select auth.uid()) = follower_user_id));

-- signal_post_images.signal_post_images_delete_own (DELETE)
alter policy "signal_post_images_delete_own" on public.signal_post_images
  using ((EXISTS ( SELECT 1
   FROM (signal_posts p
     JOIN signals s ON ((s.id = p.signal_id)))
  WHERE ((p.id = signal_post_images.post_id) AND (s.user_id = (select auth.uid()))))));

-- signal_post_images.signal_post_images_insert_own (INSERT)
alter policy "signal_post_images_insert_own" on public.signal_post_images
  with check ((EXISTS ( SELECT 1
   FROM (signal_posts p
     JOIN signals s ON ((s.id = p.signal_id)))
  WHERE ((p.id = signal_post_images.post_id) AND (s.user_id = (select auth.uid()))))));

-- signal_post_images.signal_post_images_select_own (SELECT)
alter policy "signal_post_images_select_own" on public.signal_post_images
  using ((EXISTS ( SELECT 1
   FROM (signal_posts p
     JOIN signals s ON ((s.id = p.signal_id)))
  WHERE ((p.id = signal_post_images.post_id) AND (s.user_id = (select auth.uid()))))));

-- signal_posts.signal_posts_delete_own (DELETE)
alter policy "signal_posts_delete_own" on public.signal_posts
  using ((EXISTS ( SELECT 1
   FROM signals s
  WHERE ((s.id = signal_posts.signal_id) AND (s.user_id = (select auth.uid()))))));

-- signal_posts.signal_posts_insert_own (INSERT)
alter policy "signal_posts_insert_own" on public.signal_posts
  with check ((EXISTS ( SELECT 1
   FROM signals s
  WHERE ((s.id = signal_posts.signal_id) AND (s.user_id = (select auth.uid()))))));

-- signal_posts.signal_posts_select_own (SELECT)
alter policy "signal_posts_select_own" on public.signal_posts
  using ((EXISTS ( SELECT 1
   FROM signals s
  WHERE ((s.id = signal_posts.signal_id) AND (s.user_id = (select auth.uid()))))));

-- signal_posts.signal_posts_update_own (UPDATE)
alter policy "signal_posts_update_own" on public.signal_posts
  using ((EXISTS ( SELECT 1
   FROM signals s
  WHERE ((s.id = signal_posts.signal_id) AND (s.user_id = (select auth.uid()))))))
  with check ((EXISTS ( SELECT 1
   FROM signals s
  WHERE ((s.id = signal_posts.signal_id) AND (s.user_id = (select auth.uid()))))));

-- signal_reactions.signal_reactions_delete_own (DELETE)
alter policy "signal_reactions_delete_own" on public.signal_reactions
  using (((select auth.uid()) = user_id));

-- signal_reactions.signal_reactions_insert_own (INSERT)
alter policy "signal_reactions_insert_own" on public.signal_reactions
  with check ((((select auth.uid()) = user_id) AND signal_target_publicly_viewable(target_type, target_id) AND (EXISTS ( SELECT 1
   FROM signal_reaction_types rt
  WHERE ((rt.id = signal_reactions.reaction_type_id) AND (rt.is_active = true))))));

-- signal_reactions.signal_reactions_select (SELECT)
alter policy "signal_reactions_select" on public.signal_reactions
  using ((((select auth.uid()) = user_id) OR signal_target_publicly_viewable(target_type, target_id)));

-- signal_reports.signal_reports_insert_own (INSERT)
alter policy "signal_reports_insert_own" on public.signal_reports
  with check (((select auth.uid()) = reporter_user_id));

-- signal_reports.signal_reports_select_own (SELECT)
alter policy "signal_reports_select_own" on public.signal_reports
  using (((select auth.uid()) = reporter_user_id));

-- signal_scout_daily_scores.signal_scout_daily_scores_select_own (SELECT)
alter policy "signal_scout_daily_scores_select_own" on public.signal_scout_daily_scores
  using (((select auth.uid()) = user_id));

-- signal_scout_user_stats.signal_scout_user_stats_select_own (SELECT)
alter policy "signal_scout_user_stats_select_own" on public.signal_scout_user_stats
  using (((select auth.uid()) = user_id));

-- signals.signals_delete_own (DELETE)
alter policy "signals_delete_own" on public.signals
  using (((select auth.uid()) = user_id));

-- signals.signals_insert_own (INSERT)
alter policy "signals_insert_own" on public.signals
  with check (((select auth.uid()) = user_id));

-- signals.signals_select_own (SELECT)
alter policy "signals_select_own" on public.signals
  using (((select auth.uid()) = user_id));

-- signals.signals_update_own (UPDATE)
alter policy "signals_update_own" on public.signals
  using (((select auth.uid()) = user_id))
  with check (((select auth.uid()) = user_id));

-- trade_suggestion_declines.trade_suggestion_declines_delete_own (DELETE)
alter policy "trade_suggestion_declines_delete_own" on public.trade_suggestion_declines
  using (((select auth.uid()) = user_id));

-- trade_suggestion_declines.trade_suggestion_declines_insert_own (INSERT)
alter policy "trade_suggestion_declines_insert_own" on public.trade_suggestion_declines
  with check (((select auth.uid()) = user_id));

-- trade_suggestion_declines.trade_suggestion_declines_select_own (SELECT)
alter policy "trade_suggestion_declines_select_own" on public.trade_suggestion_declines
  using (((select auth.uid()) = user_id));

-- trade_suggestion_declines.trade_suggestion_declines_update_own (UPDATE)
alter policy "trade_suggestion_declines_update_own" on public.trade_suggestion_declines
  using (((select auth.uid()) = user_id))
  with check (((select auth.uid()) = user_id));

-- trade_suggestion_saves.trade_suggestion_saves_delete_own (DELETE)
alter policy "trade_suggestion_saves_delete_own" on public.trade_suggestion_saves
  using (((select auth.uid()) = user_id));

-- trade_suggestion_saves.trade_suggestion_saves_insert_own (INSERT)
alter policy "trade_suggestion_saves_insert_own" on public.trade_suggestion_saves
  with check (((select auth.uid()) = user_id));

-- trade_suggestion_saves.trade_suggestion_saves_select_own (SELECT)
alter policy "trade_suggestion_saves_select_own" on public.trade_suggestion_saves
  using (((select auth.uid()) = user_id));

-- trade_suggestion_saves.trade_suggestion_saves_update_own (UPDATE)
alter policy "trade_suggestion_saves_update_own" on public.trade_suggestion_saves
  using (((select auth.uid()) = user_id))
  with check (((select auth.uid()) = user_id));

-- user_preferences.user_preferences_delete_own (DELETE)
alter policy "user_preferences_delete_own" on public.user_preferences
  using (((select auth.uid()) = user_id));

-- user_preferences.user_preferences_insert_own (INSERT)
alter policy "user_preferences_insert_own" on public.user_preferences
  with check (((select auth.uid()) = user_id));

-- user_preferences.user_preferences_select_own (SELECT)
alter policy "user_preferences_select_own" on public.user_preferences
  using (((select auth.uid()) = user_id));

-- user_preferences.user_preferences_update_own (UPDATE)
alter policy "user_preferences_update_own" on public.user_preferences
  using (((select auth.uid()) = user_id))
  with check (((select auth.uid()) = user_id));

-- user_ranking_board_players.user_ranking_board_players_delete_own (DELETE)
alter policy "user_ranking_board_players_delete_own" on public.user_ranking_board_players
  using ((EXISTS ( SELECT 1
   FROM user_ranking_boards b
  WHERE ((b.id = user_ranking_board_players.board_id) AND (b.user_id = (select auth.uid()))))));

-- user_ranking_board_players.user_ranking_board_players_insert_own (INSERT)
alter policy "user_ranking_board_players_insert_own" on public.user_ranking_board_players
  with check ((EXISTS ( SELECT 1
   FROM user_ranking_boards b
  WHERE ((b.id = user_ranking_board_players.board_id) AND (b.user_id = (select auth.uid()))))));

-- user_ranking_board_players.user_ranking_board_players_select_own (SELECT)
alter policy "user_ranking_board_players_select_own" on public.user_ranking_board_players
  using ((EXISTS ( SELECT 1
   FROM user_ranking_boards b
  WHERE ((b.id = user_ranking_board_players.board_id) AND (b.user_id = (select auth.uid()))))));

-- user_ranking_board_players.user_ranking_board_players_update_own (UPDATE)
alter policy "user_ranking_board_players_update_own" on public.user_ranking_board_players
  using ((EXISTS ( SELECT 1
   FROM user_ranking_boards b
  WHERE ((b.id = user_ranking_board_players.board_id) AND (b.user_id = (select auth.uid()))))))
  with check ((EXISTS ( SELECT 1
   FROM user_ranking_boards b
  WHERE ((b.id = user_ranking_board_players.board_id) AND (b.user_id = (select auth.uid()))))));

-- user_ranking_boards.user_ranking_boards_delete_own (DELETE)
alter policy "user_ranking_boards_delete_own" on public.user_ranking_boards
  using (((select auth.uid()) = user_id));

-- user_ranking_boards.user_ranking_boards_insert_own (INSERT)
alter policy "user_ranking_boards_insert_own" on public.user_ranking_boards
  with check (((select auth.uid()) = user_id));

-- user_ranking_boards.user_ranking_boards_select_own (SELECT)
alter policy "user_ranking_boards_select_own" on public.user_ranking_boards
  using (((select auth.uid()) = user_id));

-- user_ranking_boards.user_ranking_boards_update_own (UPDATE)
alter policy "user_ranking_boards_update_own" on public.user_ranking_boards
  using (((select auth.uid()) = user_id))
  with check (((select auth.uid()) = user_id));

-- votes.votes_delete_own (DELETE)
alter policy "votes_delete_own" on public.votes
  using (((select auth.uid()) = user_id));

-- votes.votes_insert_own (INSERT)
alter policy "votes_insert_own" on public.votes
  with check (((select auth.uid()) = user_id));

-- votes.votes_select_own (SELECT)
alter policy "votes_select_own" on public.votes
  using (((select auth.uid()) = user_id));

-- votes.votes_update_own (UPDATE)
alter policy "votes_update_own" on public.votes
  using (((select auth.uid()) = user_id))
  with check (((select auth.uid()) = user_id));
