-- Migration 0366: long_shot_attempts (one row per play of a Long Shot puzzle,
-- Hurry-Up or Film Room). Plan: docs/completed/long-shot/long-shot-plan.md 15.4.
--
-- Access matrix:
--   anon          : none
--   authenticated : SELECT own rows (auth.uid() = user_id)
--   service_role  : ALL (every write goes through the game routes)
--   client writes : BLOCKED
--
-- One Hurry-Up per user per game date, enforced by a partial unique index.
-- timer_seconds freezes the limit in force when the attempt started (null for
-- Film Room), so a settings change mid-day does not alter a running clock.

create table if not exists public.long_shot_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  puzzle_id uuid not null references public.long_shot_puzzles(id) on delete cascade,
  game_date date not null,
  mode text not null check (mode in ('hurry_up','film_room')),
  status text not null default 'active' check (status in ('active','completed','abandoned')),
  current_position integer not null default 1 check (current_position between 1 and 6),
  base_points integer not null default 0 check (base_points >= 0),
  bonus_points integer not null default 0 check (bonus_points >= 0),
  total_points integer not null default 0 check (total_points >= 0),
  timer_seconds integer,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  stats_recorded_at timestamptz,
  settled_at timestamptz
);

create unique index if not exists long_shot_attempts_one_hurry_up_per_day
  on public.long_shot_attempts (user_id, game_date) where mode = 'hurry_up';
create index if not exists long_shot_attempts_daily_board
  on public.long_shot_attempts (game_date, total_points desc, completed_at asc)
  where mode = 'hurry_up' and status = 'completed';
create index if not exists long_shot_attempts_user
  on public.long_shot_attempts (user_id, game_date desc);
create index if not exists long_shot_attempts_active
  on public.long_shot_attempts (user_id) where status = 'active';
create index if not exists long_shot_attempts_puzzle
  on public.long_shot_attempts (puzzle_id);

alter table public.long_shot_attempts enable row level security;

drop policy if exists long_shot_attempts_select_own on public.long_shot_attempts;
create policy long_shot_attempts_select_own on public.long_shot_attempts
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists long_shot_attempts_service_role_all on public.long_shot_attempts;
create policy long_shot_attempts_service_role_all on public.long_shot_attempts
  for all to service_role using (true) with check (true);

revoke insert, update, delete, truncate on public.long_shot_attempts from anon, authenticated;
revoke all on public.long_shot_attempts from anon;

comment on table public.long_shot_attempts is
  'One play of a Long Shot puzzle. Owner may SELECT own rows; every write is service-role through the game routes.';
