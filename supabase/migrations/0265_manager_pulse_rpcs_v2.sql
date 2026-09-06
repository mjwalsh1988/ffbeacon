-- Migration 0265: the cooldown becomes a league-season budget, and the enqueue
-- links across readers
--
-- Two changes, both from the 2026-09-05 audit
-- (docs/manager-pulse/manager-pulse-audit-and-speed-plan.md, task MPS-T045):
--
-- 1. try_claim_manager_pulse charged one hour per RUN, whatever its size, so a
--    reader with one league and a reader with two hundred paid the same and a
--    single large lookup locked its owner out for an hour. It now meters
--    LEAGUE-SEASONS QUEUED in a rolling window
--    (manager_pulse_runs.leagues_charged), so joining a capture somebody else
--    started, or reading a set of leagues that are already fresh, costs nothing
--    at all. It also RESUMES an open run for the same question rather than
--    refusing it, which is what used to show a reader the Throttled page after
--    waiting twenty minutes in a busy queue.
--
-- 2. enqueue_manager_pulse_capture looked for an in-flight job to link to only
--    among the CALLING USER's jobs, and only after its own insert had been
--    rejected. Two readers looking up the same handle therefore queued two full
--    sets of jobs for the same leagues. The link lookup now runs FIRST and
--    considers a job from ANY user, so the second reader queues nothing, waits
--    on the first reader's jobs, and spends no budget.
--
-- Access matrix and grants: unchanged in kind from 0257. Both functions stay
-- SECURITY DEFINER with a pinned search_path, revoked from public, anon and
-- authenticated BY NAME, granted to service_role only. The new eight-argument
-- try_claim_manager_pulse signature carries its own grants; the old
-- six-argument one is dropped so no caller can reach the cooldown behaviour.
--
-- Rollback note (no down migration ships):
--   drop function if exists public.try_claim_manager_pulse(uuid, text, text, int, int, int, int, int);
--   re-apply try_claim_manager_pulse from 0257 and enqueue_manager_pulse_capture from 0260;
--   alter table public.manager_pulse_runs drop column if exists leagues_charged;

alter table public.manager_pulse_runs
  add column if not exists leagues_charged int not null default 0;

comment on column public.manager_pulse_runs.leagues_charged is
  'League-seasons this run actually queued work for. The budget in try_claim_manager_pulse sums this over the rolling window. Linked and fresh league-seasons are zero, so joining another reader capture is free.';

create index if not exists manager_pulse_runs_budget_idx
  on public.manager_pulse_runs (user_id, requested_at desc)
  where leagues_charged > 0;

drop function if exists public.try_claim_manager_pulse(uuid, text, text, int, int, int);

create or replace function public.try_claim_manager_pulse(
  p_user_id uuid,
  p_sleeper_user_id text,
  p_sleeper_handle text,
  p_season_from int,
  p_season_to int,
  p_leagues_requested int,
  p_league_budget int,
  p_budget_window_seconds int default 3600
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_now timestamptz := now();
  v_open uuid;
  v_used int;
  v_oldest timestamptz;
  v_run_id uuid;
begin
  if p_user_id is null then return jsonb_build_object('claimed', false, 'reason', 'no_user'); end if;
  if coalesce(btrim(p_sleeper_user_id), '') = '' then return jsonb_build_object('claimed', false, 'reason', 'no_subject'); end if;

  perform pg_advisory_xact_lock(hashtext('manager_pulse:' || p_user_id::text));

  -- A run this reader already has open for this exact question is the answer
  -- to a repeat of it. Resumed, never re-claimed, however long it has waited.
  select id into v_open
  from public.manager_pulse_runs
  where user_id = p_user_id
    and sleeper_user_id = btrim(p_sleeper_user_id)
    and season_from = p_season_from
    and season_to = p_season_to
    and status in ('pending', 'capturing', 'computing')
  order by requested_at desc
  limit 1;
  if found then
    return jsonb_build_object('claimed', true, 'run_id', v_open, 'resumed', true);
  end if;

  -- The budget: league-seasons this reader has QUEUED in the window. Linked
  -- and fresh leagues never counted, so joining someone else's capture is free.
  select coalesce(sum(leagues_charged), 0), min(requested_at)
    into v_used, v_oldest
  from public.manager_pulse_runs
  where user_id = p_user_id
    and leagues_charged > 0
    and requested_at > v_now - make_interval(secs => p_budget_window_seconds);

  if p_leagues_requested > 0 and v_used + p_leagues_requested > p_league_budget then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'budget',
      'budget_used', v_used,
      'budget_total', p_league_budget,
      'retry_after_seconds',
        greatest(1, ceil(extract(epoch from (v_oldest + make_interval(secs => p_budget_window_seconds) - v_now)))::int)
    );
  end if;

  insert into public.manager_pulse_runs (user_id, sleeper_user_id, sleeper_handle, season_from, season_to, status)
  values (p_user_id, btrim(p_sleeper_user_id), nullif(btrim(coalesce(p_sleeper_handle, '')), ''), p_season_from, p_season_to, 'pending')
  returning id into v_run_id;

  return jsonb_build_object('claimed', true, 'run_id', v_run_id, 'resumed', false);
end;
$fn$;

comment on function public.try_claim_manager_pulse(uuid, text, text, int, int, int, int, int) is
  'Atomically meters a reader Manager Pulse budget in league-seasons queued per rolling window and opens a manager_pulse_runs row, or returns the run already open for the same question. Linked and fresh league-seasons cost nothing. service_role-only EXECUTE.';

revoke all on function public.try_claim_manager_pulse(uuid, text, text, int, int, int, int, int) from public;
revoke execute on function public.try_claim_manager_pulse(uuid, text, text, int, int, int, int, int)
  from anon, authenticated;
grant execute on function public.try_claim_manager_pulse(uuid, text, text, int, int, int, int, int)
  to service_role;

-- ---------------------------------------------------------------------------
-- Enqueue: link to any reader's in-flight job before queueing a second one
-- ---------------------------------------------------------------------------

create or replace function public.enqueue_manager_pulse_capture(
  p_run_id uuid,
  p_leagues jsonb,
  p_max_leagues int default 60
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_run public.manager_pulse_runs%rowtype;
  v_league jsonb;
  v_league_id text;
  v_season int;
  v_needs boolean;
  v_job_id uuid;
  v_status text;
  v_inserted int;
  v_seen int := 0;
  v_cap int;
  v_stored int := 0;
  v_queued int := 0;
  v_linked int := 0;
  v_fresh int := 0;
begin
  select * into v_run from public.manager_pulse_runs where id = p_run_id;
  if not found then
    return jsonb_build_object('error', 'no_run');
  end if;

  -- A cap of zero or below is not a cap, it is a mistake. Falling back to the
  -- default is the only reading that cannot produce a run which reports itself
  -- complete over nothing.
  v_cap := coalesce(nullif(greatest(coalesce(p_max_leagues, 0), 0), 0), 60);

  for v_league in select * from jsonb_array_elements(coalesce(p_leagues, '[]'::jsonb))
  loop
    exit when v_seen >= v_cap;

    v_league_id := btrim(coalesce(v_league->>'sleeper_league_id', ''));
    continue when v_league_id = '';

    v_season := nullif(v_league->>'season', '')::int;
    continue when v_season is null;

    v_needs := coalesce((v_league->>'needs_capture')::boolean, true);
    v_job_id := null;
    v_seen := v_seen + 1;

    if v_needs then
      -- The link lookup runs FIRST and ignores who owns the job. A league
      -- already being captured for anybody is a league this run waits on, not
      -- one it queues again. The oldest such job is preferred because it is the
      -- one closest to finishing.
      select id into v_job_id
      from public.league_sync_jobs
      where sleeper_league_id = v_league_id
        and status in ('pending', 'processing')
      order by created_at
      limit 1;

      if v_job_id is null then
        insert into public.league_sync_jobs
          (manager_run_id, user_id, sleeper_league_id, league_name, job_kind)
        values
          (p_run_id, v_run.user_id, v_league_id,
           nullif(btrim(coalesce(v_league->>'league_name', '')), ''), 'footprint')
        on conflict do nothing
        returning id into v_job_id;

        if v_job_id is null then
          -- Lost a race against another enqueue in the same instant. Whoever
          -- won it holds the job this run links to.
          select id into v_job_id
          from public.league_sync_jobs
          where sleeper_league_id = v_league_id
            and status in ('pending', 'processing')
          order by created_at
          limit 1;
        end if;
      end if;

      if v_job_id is null then
        v_status := 'done';
      else
        v_status := 'queued';
      end if;
    else
      v_status := 'fresh';
    end if;

    -- The tallies come from whether the row was actually STORED, not from the
    -- loop, so a duplicate (league, season) in the payload counts once here and
    -- once in the progress bar rather than once and twice.
    insert into public.manager_pulse_run_leagues
      (run_id, user_id, sleeper_league_id, season, league_name, league_category,
       status, job_id)
    values
      (p_run_id, v_run.user_id, v_league_id, v_season,
       nullif(btrim(coalesce(v_league->>'league_name', '')), ''),
       nullif(btrim(coalesce(v_league->>'league_category', '')), ''),
       v_status, v_job_id)
    on conflict (run_id, sleeper_league_id, season) do nothing;

    get diagnostics v_inserted = row_count;
    if v_inserted > 0 then
      v_stored := v_stored + 1;
      if v_status = 'fresh' or v_status = 'done' then
        v_fresh := v_fresh + 1;
      elsif v_job_id is not null and v_status = 'queued' then
        -- A job this call created versus one it linked to. `v_needs` alone
        -- cannot tell them apart after the fact.
        if exists (
          select 1 from public.league_sync_jobs
          where id = v_job_id and manager_run_id = p_run_id
        ) then
          v_queued := v_queued + 1;
        else
          v_linked := v_linked + 1;
        end if;
      end if;
    end if;
  end loop;

  update public.manager_pulse_runs
     set leagues_total = v_stored,
         leagues_done = v_fresh,
         status = case when v_queued + v_linked = 0 then 'computing' else 'capturing' end,
         counts_against_cooldown = (v_queued > 0),
         leagues_charged = v_queued,
         updated_at = now()
   where id = p_run_id;

  return jsonb_build_object(
    'leagues', v_stored,
    'queued', v_queued,
    'fresh', v_fresh,
    'linked', v_linked
  );
end;
$fn$;

comment on function public.enqueue_manager_pulse_capture(uuid, jsonb, int) is
  'Records the league-seasons one Manager Pulse run needs and queues footprint jobs only for leagues nobody is already capturing. Links to any reader in-flight job first, so a second reader on the same handle queues nothing and is charged nothing. Counts rows actually STORED. service_role-only EXECUTE.';

revoke all on function public.enqueue_manager_pulse_capture(uuid, jsonb, int) from public;
revoke execute on function public.enqueue_manager_pulse_capture(uuid, jsonb, int)
  from anon, authenticated;
grant execute on function public.enqueue_manager_pulse_capture(uuid, jsonb, int)
  to service_role;
