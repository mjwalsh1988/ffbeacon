-- Migration 0369: Long Shot atomic writes (fixes from the LS-T061 review).
-- Plan: docs/completed/long-shot/long-shot-plan.md; findings in progress.md
-- under LS-T061.
--
-- Access matrix (unchanged tables; new functions only):
--   long_shot_insert_puzzle, long_shot_record_completion,
--   long_shot_settle_attempt: security definer, search_path pinned, EXECUTE
--   revoked from public, anon and authenticated by name, granted to
--   service_role only.
--   long_shot_attempts_one_active: a partial unique index, no policy change.
--
-- Why each exists:
--   insert_puzzle      the puzzle row and its prompts land in ONE transaction,
--                      so no other instance can read a puzzle with no prompts,
--                      and a failed prompt insert never cascades into a
--                      player's attempt.
--   record_completion  the stats_recorded_at anchor and the stats upsert land
--                      together, so a failed stats write leaves the anchor null
--                      and the page-state heal retries it.
--   settle_attempt     the settled_at guard, the Lone Signal marks and the
--                      stats bonus land together, so a crash cannot settle an
--                      attempt without paying it.
--   one_active         at most one active attempt per user across both modes,
--                      enforced by the database rather than a read-then-insert.

create unique index if not exists long_shot_attempts_one_active
  on public.long_shot_attempts (user_id) where status = 'active';

create or replace function public.long_shot_insert_puzzle(
  p_game_date date,
  p_status text,
  p_prompt_count integer,
  p_seed_salt integer,
  p_generated_by text,
  p_model_version integer,
  p_prompts jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.long_shot_puzzles (game_date, status, prompt_count, seed_salt, generated_by, model_version)
  values (p_game_date, p_status, p_prompt_count, p_seed_salt, p_generated_by, p_model_version)
  returning id into v_id;
  insert into public.long_shot_prompts (puzzle_id, position, template_key, prompt_text, params, answers, answer_count)
  select v_id,
         (e->>'position')::int,
         e->>'template_key',
         e->>'prompt_text',
         coalesce(e->'params', '{}'::jsonb),
         e->'answers',
         (e->>'answer_count')::int
  from jsonb_array_elements(p_prompts) as e;
  return v_id;
end;
$$;

create or replace function public.long_shot_record_completion(
  p_attempt_id uuid,
  p_user_id uuid,
  p_days_played integer,
  p_total_points integer,
  p_best_day_points integer,
  p_long_shots integer,
  p_last_completed_date date,
  p_current_streak integer,
  p_best_streak integer,
  p_first_completed_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.long_shot_attempts
    set stats_recorded_at = now()
    where id = p_attempt_id and user_id = p_user_id and mode = 'hurry_up'
      and status = 'completed' and stats_recorded_at is null;
  if not found then
    return false;
  end if;
  insert into public.long_shot_user_stats (
    user_id, days_played, total_points, best_day_points, long_shots,
    last_completed_date, current_streak, best_streak, first_completed_at, updated_at
  ) values (
    p_user_id, p_days_played, p_total_points, p_best_day_points, p_long_shots,
    p_last_completed_date, p_current_streak, p_best_streak, p_first_completed_at, now()
  )
  on conflict (user_id) do update set
    days_played = excluded.days_played,
    total_points = excluded.total_points,
    best_day_points = excluded.best_day_points,
    long_shots = excluded.long_shots,
    last_completed_date = excluded.last_completed_date,
    current_streak = excluded.current_streak,
    best_streak = excluded.best_streak,
    first_completed_at = excluded.first_completed_at,
    updated_at = now();
  return true;
end;
$$;

create or replace function public.long_shot_settle_attempt(
  p_attempt_id uuid,
  p_bonus integer,
  p_lone_ids uuid[],
  p_pay_stats boolean
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_n integer := coalesce(array_length(p_lone_ids, 1), 0);
begin
  update public.long_shot_attempts
    set bonus_points = p_bonus, total_points = base_points + p_bonus, settled_at = now()
    where id = p_attempt_id and settled_at is null
    returning user_id into v_user;
  if v_user is null then
    return false;
  end if;
  if v_n > 0 then
    update public.long_shot_answers set lone_signal = true
      where attempt_id = p_attempt_id and id = any(p_lone_ids);
  end if;
  if p_pay_stats and (p_bonus > 0 or v_n > 0) then
    insert into public.long_shot_user_stats (user_id, total_points, lone_signals, updated_at)
    values (v_user, p_bonus, v_n, now())
    on conflict (user_id) do update set
      total_points = public.long_shot_user_stats.total_points + excluded.total_points,
      lone_signals = public.long_shot_user_stats.lone_signals + excluded.lone_signals,
      updated_at = now();
  end if;
  return true;
end;
$$;

revoke execute on function public.long_shot_insert_puzzle(date, text, integer, integer, text, integer, jsonb) from public, anon, authenticated;
revoke execute on function public.long_shot_record_completion(uuid, uuid, integer, integer, integer, integer, date, integer, integer, timestamptz) from public, anon, authenticated;
revoke execute on function public.long_shot_settle_attempt(uuid, integer, uuid[], boolean) from public, anon, authenticated;
grant execute on function public.long_shot_insert_puzzle(date, text, integer, integer, text, integer, jsonb) to service_role;
grant execute on function public.long_shot_record_completion(uuid, uuid, integer, integer, integer, integer, date, integer, integer, timestamptz) to service_role;
grant execute on function public.long_shot_settle_attempt(uuid, integer, uuid[], boolean) to service_role;
