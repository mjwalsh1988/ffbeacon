-- Migration 0322: two Supabase advisor findings.
--
-- 1. public.beam_search_players had a mutable search_path. Every reference in
--    its body is already schema-qualified (public.players, public.similarity,
--    operator(public.%)), so pinning the path to empty changes nothing about
--    what it resolves and removes the lint. The pg_trgm extension living in
--    public and the intended SECURITY DEFINER functions flagged by the same
--    advisor are deliberately left as they are.
--
-- 2. Covering indexes for six foreign keys to auth.users and beam_queries that
--    had none. Without one, deleting a user (or a query) scans each referencing
--    table, and every "my rows" read on these tables is a sequential scan.
--
-- Safe to apply BEFORE the code deploys: no behaviour change.
--
-- Access matrix: unchanged on every table touched. No table is created, and no
-- grant or policy is added or removed.

alter function public.beam_search_players(text, integer, real) set search_path = '';

create index if not exists idx_beam_queries_user_id
  on public.beam_queries (user_id);

create index if not exists idx_beam_learning_requests_submitted_user_id
  on public.beam_learning_requests (submitted_user_id);

create index if not exists idx_beam_learning_requests_query_id
  on public.beam_learning_requests (query_id);

create index if not exists idx_manager_pulse_run_leagues_user_id
  on public.manager_pulse_run_leagues (user_id);

create index if not exists idx_guide_question_submissions_submitted_user_id
  on public.guide_question_submissions (submitted_user_id);

create index if not exists idx_signal_check_audit_log_actor_user_id
  on public.signal_check_audit_log (actor_user_id);
