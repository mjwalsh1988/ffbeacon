-- Migration 0129: signal_scout_daily_scores (per-user per-ET-day score
-- rollup for the Signal Scout hidden-player guessing game)
--
-- Access matrix:
--   anon          : NONE
--   authenticated : SELECT own rows only (auth.uid() = user_id)
--   service_role  : ALL
--   client writes : BLOCKED
--
-- This table mirrors the signal_scout_user_stats RLS pattern exactly. Owners
-- may read their own daily rows; every write is a lazy service-role upsert
-- performed by the server round-completion path, never a direct client
-- write.
--
-- Guests never get rows here; guest identity is not durable across
-- sessions, so daily rollups only exist for signed-in users.
--
-- Powers the Today's Top Scouts leaderboard. Leaderboard queries run
-- server-side via the service-role client, joining signal_scout_user_stats
-- to exclude hidden/admin-excluded users. This table intentionally has no
-- hidden flag of its own; hiding is a per-user lifetime decision that lives
-- once on signal_scout_user_stats, not duplicated per day here.
--
-- first_play_at is set once, at the first completed round of the ET day,
-- and never updated on later rounds that day. It is the leaderboard
-- tie-breaker: among users tied on points for the day, the earlier
-- first_play_at ranks higher.

create table if not exists public.signal_scout_daily_scores (
  user_id uuid not null references auth.users(id) on delete cascade,
  game_date date not null,
  points integer not null default 0 check (points >= 0),
  rounds integer not null default 0 check (rounds >= 0),
  wins integer not null default 0 check (wins >= 0),
  first_play_at timestamptz not null default now(),
  primary key (user_id, game_date)
);

create index if not exists signal_scout_daily_scores_date_points_idx
  on public.signal_scout_daily_scores (game_date, points desc);

alter table public.signal_scout_daily_scores enable row level security;

drop policy if exists signal_scout_daily_scores_select_own on public.signal_scout_daily_scores;
create policy signal_scout_daily_scores_select_own on public.signal_scout_daily_scores
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists signal_scout_daily_scores_service_role_all on public.signal_scout_daily_scores;
create policy signal_scout_daily_scores_service_role_all on public.signal_scout_daily_scores
  for all to service_role using (true) with check (true);

comment on table public.signal_scout_daily_scores is
  'Per-user per-ET-day score rollup for Signal Scout, primary key (user_id, game_date). Powers the Today''s Top Scouts leaderboard. Guests never get rows (identity is not durable across sessions). Owners may SELECT their own rows (auth.uid() = user_id); all writes are service-role upserts from the server round-completion path, no client writes of any kind. first_play_at is set once at the day''s first completed round and serves as the leaderboard tie-breaker (earlier first play ranks higher on equal points). Leaderboard queries run server-side via service role and join signal_scout_user_stats to exclude hidden/admin-excluded users; this table has no hidden flag of its own by design, since hiding is a per-user lifetime decision.';
