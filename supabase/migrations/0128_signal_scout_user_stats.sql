-- Migration 0128: signal_scout_user_stats (lazy-upserted per-user lifetime
-- aggregates for the Signal Scout hidden-player guessing game)
--
-- Access matrix:
--   anon          : NONE
--   authenticated : SELECT own row only (auth.uid() = user_id)
--   service_role  : ALL
--   client writes : BLOCKED
--
-- This is the first Signal Scout table with a client-readable policy. Owners
-- may read their own aggregate row to power /me/stats. There is no
-- insert/update/delete policy for authenticated: every write is a lazy
-- service-role upsert performed by the server round-completion path, never
-- a direct client write.
--
-- Guests never get a row here; guest identity is not durable across
-- sessions, so lifetime aggregates only exist for signed-in users.
--
-- last_played_date is the ET game date of the most recent completed round
-- and powers the Daily Scout Streak (current_daily_streak /
-- best_daily_streak), distinct from current_signal_streak /
-- best_signal_streak which track consecutive correct rounds regardless of
-- day-to-day cadence.
--
-- hidden_from_leaderboards and the accompanying hidden_reason / hidden_at /
-- hidden_by columns let an admin exclude a user's row from public
-- leaderboard queries (e.g. suspected cheating) without deleting their
-- stats. The two leaderboard-ordering indexes below are partial on
-- hidden_from_leaderboards = false so hidden rows never need to be filtered
-- out at query time.

create table if not exists public.signal_scout_user_stats (
  user_id uuid primary key references auth.users(id) on delete cascade,
  total_points integer not null default 0 check (total_points >= 0),
  rounds_played integer not null default 0 check (rounds_played >= 0),
  rounds_won integer not null default 0 check (rounds_won >= 0),
  rounds_solved_late integer not null default 0 check (rounds_solved_late >= 0),
  rounds_failed integer not null default 0 check (rounds_failed >= 0),
  rounds_skipped integer not null default 0 check (rounds_skipped >= 0),
  rounds_burned integer not null default 0 check (rounds_burned >= 0),
  total_hints integer not null default 0 check (total_hints >= 0),
  total_wrong_guesses integer not null default 0 check (total_wrong_guesses >= 0),
  current_signal_streak integer not null default 0 check (current_signal_streak >= 0),
  best_signal_streak integer not null default 0 check (best_signal_streak >= 0),
  current_daily_streak integer not null default 0 check (current_daily_streak >= 0),
  best_daily_streak integer not null default 0 check (best_daily_streak >= 0),
  last_played_date date null,
  hidden_from_leaderboards boolean not null default false,
  hidden_reason text null,
  hidden_at timestamptz null,
  hidden_by uuid null references auth.users(id) on delete set null,
  first_played_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists signal_scout_user_stats_points_idx
  on public.signal_scout_user_stats (total_points desc)
  where hidden_from_leaderboards = false;

create index if not exists signal_scout_user_stats_streak_idx
  on public.signal_scout_user_stats (best_signal_streak desc)
  where hidden_from_leaderboards = false;

alter table public.signal_scout_user_stats enable row level security;

drop policy if exists signal_scout_user_stats_select_own on public.signal_scout_user_stats;
create policy signal_scout_user_stats_select_own on public.signal_scout_user_stats
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists signal_scout_user_stats_service_role_all on public.signal_scout_user_stats;
create policy signal_scout_user_stats_service_role_all on public.signal_scout_user_stats
  for all to service_role using (true) with check (true);

comment on table public.signal_scout_user_stats is
  'Lazy-upserted per-user lifetime aggregates for Signal Scout. Guests never get a row (identity is not durable across sessions). Owners may SELECT their own row (auth.uid() = user_id) to power /me/stats; all writes are service-role upserts from the server round-completion path, no client writes of any kind. hidden_from_leaderboards lets an admin exclude a user from public leaderboards without deleting their stats; signal_scout_user_stats_points_idx and signal_scout_user_stats_streak_idx are partial on hidden_from_leaderboards = false to serve leaderboard queries directly. last_played_date (ET) drives the Daily Scout Streak columns, distinct from the Signal Streak columns which track consecutive correct rounds.';
