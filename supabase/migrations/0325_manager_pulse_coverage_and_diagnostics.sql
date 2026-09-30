-- Migration 0325: Manager Pulse coverage counts, run diagnostics, and an
-- honest status for a league the enqueue could not queue
--
-- 1. manager_pulse_runs.leagues_skipped. Discovery caps a history at
--    maxLeaguesPerRun, most recent first, and used to throw the count of what it
--    dropped away, so a report built from 250 of 400 league-seasons said
--    nothing about the other 150. capture.ts now records the count on the run
--    before the enqueue, and finalize.ts carries it into report.limits.
--
-- 2. manager_pulse_run_errors. finalize.ts closes a failed run with one fixed
--    sentence in manager_pulse_runs.detail, and that column is owner-readable
--    and handed to the page by the progress poll, so it cannot carry a raw
--    error message. The real message now lands here, one row per run,
--    service-role only, for whoever has to diagnose the failure.
--
-- 3. enqueue_manager_pulse_capture: a league it could not queue is FAILED, not
--    DONE. When this reader already has a non-footprint ('pulse', from Sync all)
--    job in flight for a league, league_sync_jobs_active_unique refuses the
--    footprint insert. 0267 said the honest answer was to record that
--    league-season as not captured, and then wrote status 'done', which counted
--    it as covered: the report presented a league-season it had never captured
--    as part of the history. It is now 'failed', with a detail saying why,
--    counted into leagues_failed, and finalize.ts reports it as a coverage gap
--    and withholds the tendency row. Linking to the pulse job instead is still
--    wrong for 0267's reason: a 'pulse' job inside its cache takes no capture set.
--
-- Access matrix
--   manager_pulse_runs.leagues_skipped : same as the table (0250). authenticated
--                                        SELECT own rows; service_role ALL.
--   manager_pulse_run_errors           : anon none, authenticated none,
--                                        service_role ALL. RLS on, one
--                                        service_role policy. Table privileges
--                                        revoked from anon and authenticated by
--                                        name.
--   enqueue_manager_pulse_capture      : unchanged. SECURITY DEFINER, pinned
--                                        search_path, service_role-only EXECUTE,
--                                        restated below because create or
--                                        replace does not carry grants.
--
-- Safe to apply before the code deploys: the column has a default, the table is
-- new, and the function keeps its signature and return shape. The deployed code
-- reads leagues_skipped and writes manager_pulse_run_errors defensively, so the
-- code is also safe to deploy before this migration (the count reads zero and
-- the diagnostics write is dropped).
--
-- Rollback note (no down migration ships):
--   drop table if exists public.manager_pulse_run_errors;
--   alter table public.manager_pulse_runs drop column if exists leagues_skipped;
--   re-apply enqueue_manager_pulse_capture from 0267.

-- ---------------------------------------------------------------------------
-- 1. The cap-dropped count
-- ---------------------------------------------------------------------------

alter table public.manager_pulse_runs
  add column if not exists leagues_skipped int not null default 0;

alter table public.manager_pulse_runs
  drop constraint if exists manager_pulse_runs_leagues_skipped_sane;
alter table public.manager_pulse_runs
  add constraint manager_pulse_runs_leagues_skipped_sane check (leagues_skipped >= 0);

comment on column public.manager_pulse_runs.leagues_skipped is
  'League-seasons discovery found and dropped for exceeding maxLeaguesPerRun or maxLeaguesPerSeason. Written by capture.ts before the enqueue; carried into report.limits.leagueSeasonsSkipped by finalize.ts.';

-- ---------------------------------------------------------------------------
-- 2. Server-side diagnostics for a failed run
-- ---------------------------------------------------------------------------

create table if not exists public.manager_pulse_run_errors (
  run_id uuid primary key references public.manager_pulse_runs(id) on delete cascade,
  stage text not null default 'finalize',
  message text not null,
  stack text,
  created_at timestamptz not null default now()
);

comment on table public.manager_pulse_run_errors is
  'The underlying error for a Manager Pulse run that closed as error. manager_pulse_runs.detail is owner-readable and carries only a fixed sentence; this holds the real message. Service-role only.';

alter table public.manager_pulse_run_errors enable row level security;

drop policy if exists manager_pulse_run_errors_service_role_all on public.manager_pulse_run_errors;
create policy manager_pulse_run_errors_service_role_all
  on public.manager_pulse_run_errors
  for all
  to service_role
  using (true)
  with check (true);

revoke all on table public.manager_pulse_run_errors from public;
revoke all on table public.manager_pulse_run_errors from anon, authenticated;
grant all on table public.manager_pulse_run_errors to service_role;

-- ---------------------------------------------------------------------------
-- 3. A league the enqueue could not queue is not a league it covered
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
  v_detail text;
  v_inserted int;
  v_seen int := 0;
  v_cap int;
  v_stored int := 0;
  v_queued int := 0;
  v_linked int := 0;
  v_fresh int := 0;
  v_failed int := 0;
begin
  select * into v_run from public.manager_pulse_runs where id = p_run_id;
  if not found then
    return jsonb_build_object('error', 'no_run');
  end if;

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
    v_detail := null;
    v_seen := v_seen + 1;

    if v_needs then
      -- The link lookup runs FIRST and ignores who owns the job. A league
      -- already being captured for anybody is a league this run waits on, not
      -- one it queues again. Footprint jobs only: see 0267.
      select id into v_job_id
      from public.league_sync_jobs
      where sleeper_league_id = v_league_id
        and job_kind = 'footprint'
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
          -- Lost a race against another enqueue in the same instant: take the
          -- footprint job that now exists.
          select id into v_job_id
          from public.league_sync_jobs
          where sleeper_league_id = v_league_id
            and job_kind = 'footprint'
            and status in ('pending', 'processing')
          order by created_at
          limit 1;
        end if;
      end if;

      if v_job_id is null then
        -- No footprint job exists and none could be queued: this user already
        -- has a Sync all job in flight for the league, and
        -- league_sync_jobs_active_unique refused the insert. That job does not
        -- take the capture set, so linking to it would count a league-season
        -- that is never captured. Recorded as not read, and said so.
        v_status := 'failed';
        v_detail := 'Another sync of this league was already running, so it was not read this time.';
      else
        v_status := 'queued';
      end if;
    else
      v_status := 'fresh';
    end if;

    -- The tallies come from whether the row was actually STORED, not from the
    -- loop, so a duplicate (league, season) in the payload counts once.
    insert into public.manager_pulse_run_leagues
      (run_id, user_id, sleeper_league_id, season, league_name, league_category,
       status, job_id, detail)
    values
      (p_run_id, v_run.user_id, v_league_id, v_season,
       nullif(btrim(coalesce(v_league->>'league_name', '')), ''),
       nullif(btrim(coalesce(v_league->>'league_category', '')), ''),
       v_status, v_job_id, v_detail)
    on conflict (run_id, sleeper_league_id, season) do nothing;

    get diagnostics v_inserted = row_count;
    if v_inserted > 0 then
      v_stored := v_stored + 1;
      if v_status = 'fresh' then
        v_fresh := v_fresh + 1;
      elsif v_status = 'failed' then
        v_failed := v_failed + 1;
      elsif v_job_id is not null and v_status = 'queued' then
        -- A job this call created versus one it linked to.
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
         leagues_failed = v_failed,
         status = case when v_queued + v_linked = 0 then 'computing' else 'capturing' end,
         counts_against_cooldown = (v_queued > 0),
         leagues_charged = v_queued,
         updated_at = now()
   where id = p_run_id;

  return jsonb_build_object(
    'leagues', v_stored,
    'queued', v_queued,
    'fresh', v_fresh,
    'linked', v_linked,
    'failed', v_failed
  );
end;
$fn$;

comment on function public.enqueue_manager_pulse_capture(uuid, jsonb, int) is
  'Records the league-seasons one Manager Pulse run needs and queues footprint jobs only for leagues nobody is already capturing WITH A FOOTPRINT JOB. Links to any reader in-flight footprint job first, so a second reader on the same handle queues nothing and is charged nothing. A league it can neither link nor queue (the user already has a Sync all job for it) is recorded as failed, never as done. Counts rows actually STORED. service_role-only EXECUTE.';

revoke all on function public.enqueue_manager_pulse_capture(uuid, jsonb, int) from public;
revoke execute on function public.enqueue_manager_pulse_capture(uuid, jsonb, int)
  from anon, authenticated;
grant execute on function public.enqueue_manager_pulse_capture(uuid, jsonb, int)
  to service_role;
