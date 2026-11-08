-- Migration 0368: long_shot_answer_tallies, long_shot_user_stats and the three
-- Long Shot RPCs. Plan: docs/completed/long-shot/long-shot-plan.md 15.6 and 16.
--
-- Access matrix:
--   long_shot_answer_tallies
--     anon / authenticated : none
--     service_role         : ALL
--   long_shot_user_stats
--     anon                 : none
--     authenticated        : SELECT own row, EXCEPT hidden_reason and
--                            hidden_at (column grants revoked; RLS is row
--                            level, not column level)
--     service_role         : ALL
--   RPCs (long_shot_increment_tally, long_shot_trade_counts,
--         long_shot_complete_attempt)
--     security definer, search_path pinned, EXECUTE revoked from public,
--     anon and authenticated by name, granted to service_role only.
--
-- Tallies count Hurry-Up answers only (correct or not); the room line and
-- the most-given list read them. Stats are Hurry-Up only; Film Room never
-- writes here (lib/long-shot/film-room-guard.test.ts).

create table if not exists public.long_shot_answer_tallies (
  prompt_id uuid not null references public.long_shot_prompts(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  count integer not null default 0 check (count >= 0),
  primary key (prompt_id, player_id)
);

alter table public.long_shot_answer_tallies enable row level security;

drop policy if exists long_shot_answer_tallies_service_role_all on public.long_shot_answer_tallies;
create policy long_shot_answer_tallies_service_role_all on public.long_shot_answer_tallies
  for all to service_role using (true) with check (true);

revoke all on public.long_shot_answer_tallies from anon, authenticated;

create table if not exists public.long_shot_user_stats (
  user_id uuid primary key references auth.users(id) on delete cascade,
  days_played integer not null default 0,
  total_points integer not null default 0,
  best_day_points integer not null default 0,
  long_shots integer not null default 0,
  lone_signals integer not null default 0,
  last_completed_date date,
  current_streak integer not null default 0,
  best_streak integer not null default 0,
  first_completed_at timestamptz,
  hidden_from_leaderboards boolean not null default false,
  hidden_reason text,
  hidden_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists long_shot_user_stats_points_idx
  on public.long_shot_user_stats (total_points desc, days_played desc)
  where hidden_from_leaderboards = false;
create index if not exists long_shot_user_stats_streak_idx
  on public.long_shot_user_stats (current_streak desc, best_streak desc)
  where hidden_from_leaderboards = false;
create index if not exists long_shot_user_stats_streak_reset_idx
  on public.long_shot_user_stats (last_completed_date) where current_streak > 0;

alter table public.long_shot_user_stats enable row level security;

drop policy if exists long_shot_user_stats_select_own on public.long_shot_user_stats;
create policy long_shot_user_stats_select_own on public.long_shot_user_stats
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists long_shot_user_stats_service_role_all on public.long_shot_user_stats;
create policy long_shot_user_stats_service_role_all on public.long_shot_user_stats
  for all to service_role using (true) with check (true);

revoke all on public.long_shot_user_stats from anon;
revoke insert, update, delete, truncate on public.long_shot_user_stats from authenticated;
-- A table-level SELECT grant covers every column, so a column revoke alone
-- does nothing. Revoke the table grant and re-grant the readable columns.
revoke select on public.long_shot_user_stats from authenticated;
grant select (
  user_id, days_played, total_points, best_day_points, long_shots,
  lone_signals, last_completed_date, current_streak, best_streak,
  first_completed_at, hidden_from_leaderboards, updated_at
) on public.long_shot_user_stats to authenticated;

-- 16.1: both counters move together in one function.
create or replace function public.long_shot_increment_tally(p_prompt_id uuid, p_player_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_player_id is not null then
    insert into public.long_shot_answer_tallies (prompt_id, player_id, count)
    values (p_prompt_id, p_player_id, 1)
    on conflict (prompt_id, player_id)
    do update set count = public.long_shot_answer_tallies.count + 1;
  end if;
  update public.long_shot_prompts
    set answered_total = answered_total + 1
    where id = p_prompt_id;
end;
$$;

-- 16.2: leagues that traded each Sleeper player since p_since.
create or replace function public.long_shot_trade_counts(p_since timestamptz)
returns table (sleeper_player_id text, league_count int)
language sql
stable
security definer
set search_path = public
as $$
  select key as sleeper_player_id, count(distinct t.league_id)::int as league_count
  -- A non-object adds (null, or an array from an odd Sleeper payload) is read
  -- as no adds, inside the call, so no plan order can raise on it.
  from public.league_transactions t,
    jsonb_object_keys(
      case when jsonb_typeof(t.adds) = 'object' then t.adds else '{}'::jsonb end
    ) as key
  where t.type = 'trade' and t.status = 'complete'
    and t.created_at_sleeper >= p_since
  group by key
  having count(distinct t.league_id) > 10
$$;

-- 16.3: completion keyed on prompt_count, never the literal 5.
create or replace function public.long_shot_complete_attempt(p_attempt_id uuid)
returns setof public.long_shot_attempts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.long_shot_attempts;
begin
  update public.long_shot_attempts a
    set status = 'completed', completed_at = now(), total_points = a.base_points
    where a.id = p_attempt_id and a.status = 'active'
      and a.current_position = (
        select p.prompt_count from public.long_shot_puzzles p where p.id = a.puzzle_id
      ) + 1
    returning a.* into v_row;
  if v_row.id is null then
    return;
  end if;
  if v_row.mode = 'hurry_up' then
    update public.long_shot_puzzles
      set completed_attempts = completed_attempts + 1
      where id = v_row.puzzle_id;
  end if;
  return next v_row;
end;
$$;

revoke execute on function public.long_shot_increment_tally(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.long_shot_trade_counts(timestamptz) from public, anon, authenticated;
revoke execute on function public.long_shot_complete_attempt(uuid) from public, anon, authenticated;
grant execute on function public.long_shot_increment_tally(uuid, uuid) to service_role;
grant execute on function public.long_shot_trade_counts(timestamptz) to service_role;
grant execute on function public.long_shot_complete_attempt(uuid) to service_role;

comment on table public.long_shot_answer_tallies is
  'Hurry-Up answer counts per (prompt, player), correct or not. Service-role only. Written only by long_shot_increment_tally.';
comment on table public.long_shot_user_stats is
  'Long Shot Hurry-Up stats, one row per user. Owner may SELECT own row except hidden_reason and hidden_at.';
