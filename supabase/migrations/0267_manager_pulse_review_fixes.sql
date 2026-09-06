-- Migration 0267: three database findings from the 2026-09-05 review of the
-- Manager Pulse speed build
--
-- 1. THE QUEUE-AHEAD COUNT HAD NO INDEX. readCaptureProgress counts pending
--    jobs older than the run's own oldest pending job, once every two seconds
--    per reader. Nothing indexed (status, created_at): the partial index from
--    0172 is on run_after. Measured on a synthetic 10,000-row queue, that count
--    was a sequential scan of the WHOLE table (10,412 rows read, 5.5 ms) and it
--    grows with history, because nothing ever deletes a finished job. A partial
--    index on created_at makes it a range scan over the backlog instead.
--
-- 2. THE FAIR CLAIM RANKED THE WHOLE QUEUE. 0263 computed row_number() over
--    every pending job before taking twelve of them, so one claim sorted the
--    entire pending set twice (30 ms and 2.5 MB of sort memory at 10,000
--    pending, spilling to disk somewhere past 40,000). The interleaving only
--    needs a head of the queue: the oldest few hundred due jobs contain every
--    owner that could possibly be served next, so ranking is now done over a
--    bounded window taken by the index above. The observable behaviour is the
--    same and the cost stops growing with the backlog.
--
-- 3. THE CROSS-USER JOB LINK IGNORED job_kind. 0265 let a Manager Pulse
--    footprint run link to ANY in-flight job for a league, including a 'pulse'
--    job queued by Sync all. Those are not the same work: pulseLeagueDerived
--    only takes the capture set when the league is actually resynced, so a
--    'pulse' job on a league inside its 60-minute cache captures no
--    transactions, no brackets and no draft selections. The worker then closed
--    the linked league-season as done on that job's success, and the report
--    counted a league-season it had never actually captured and presented it as
--    covered. The link is now restricted to footprint jobs, which always take
--    the full set.
--
-- 4. A FIRST LOOKUP LARGER THAN THE BUDGET COULD NEVER RUN. maxLeaguesPerRun
--    is 250 and leaguesPerUserPerHour is 150, and the check refused any request
--    where used + requested exceeded the budget, with no partial admission. A
--    reader whose history holds 200 uncaptured league-seasons was refused on an
--    EMPTY window, and `min(requested_at)` over no rows is null, so the refusal
--    carried a null retry time and the page could not even say when to come
--    back. The budget's job is to meter REPEAT queueing within the hour;
--    maxLeaguesPerRun is what caps a single run. So a reader who has spent
--    nothing in the window is admitted whatever the size, and spends it.
--
-- Access matrix and grants: unchanged from 0263 and 0265. Both functions keep
-- their SECURITY setting, their pinned search_path, and service_role-only
-- EXECUTE, restated below because a create or replace does not carry them.
--
-- Rollback note (no down migration ships):
--   drop index if exists public.league_sync_jobs_pending_created_idx;
--   re-apply claim_league_sync_jobs from 0263 and both RPCs from 0265.

-- ---------------------------------------------------------------------------
-- 1. The queue-ahead count, and the window the fair claim ranks over
-- ---------------------------------------------------------------------------

create index if not exists league_sync_jobs_pending_created_idx
  on public.league_sync_jobs (created_at)
  where status = 'pending';

-- ---------------------------------------------------------------------------
-- 2. Rank a bounded head of the queue, not all of it
-- ---------------------------------------------------------------------------

create or replace function public.claim_league_sync_jobs(p_limit int)
returns setof public.league_sync_jobs
language sql
set search_path = public, pg_temp
as $fn$
  with due as (
    -- The oldest due jobs, and only those. Every owner with a job close enough
    -- to the front to be claimed next appears in this window, so ranking over
    -- it gives the same interleaving as ranking over the whole queue, at a
    -- cost that does not grow with the backlog behind it.
    select id, created_at, run_after, coalesce(manager_run_id, request_id) as owner_id
    from public.league_sync_jobs
    where status = 'pending'
      and run_after <= now()
    order by run_after, created_at
    limit 500
  ),
  ranked as (
    select id,
           created_at,
           row_number() over (
             partition by owner_id
             order by run_after, created_at
           ) as rank_in_owner
    from due
  ),
  claimed as (
    select r.id
    from ranked r
    join public.league_sync_jobs j on j.id = r.id
    order by r.rank_in_owner, r.created_at
    for update of j skip locked
    limit greatest(coalesce(p_limit, 0), 0)
  )
  update public.league_sync_jobs j
     set status = 'processing',
         updated_at = now()
    from claimed
   where j.id = claimed.id
  returning j.*;
$fn$;

comment on function public.claim_league_sync_jobs(int) is
  'Atomically claims up to p_limit due league_sync_jobs (FOR UPDATE SKIP LOCKED) and flips them to processing, interleaving owners over a bounded head of the queue so one large request cannot hold every other one behind it and one claim cannot cost the whole backlog. SECURITY INVOKER: runs as the caller and respects league_sync_jobs RLS. service_role-only EXECUTE.';

revoke all on function public.claim_league_sync_jobs(int) from public;
revoke execute on function public.claim_league_sync_jobs(int) from anon, authenticated;
grant execute on function public.claim_league_sync_jobs(int) to service_role;

-- ---------------------------------------------------------------------------
-- 3. The budget admits a first lookup of any size
-- ---------------------------------------------------------------------------

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

  -- v_used > 0 is the point. This budget meters REPEAT queueing inside the
  -- window; the cap on any ONE run is maxLeaguesPerRun, applied by the enqueue.
  -- Refusing a reader who has spent nothing yet, purely because their own
  -- history is larger than an hour's allowance, made the feature permanently
  -- unreachable for exactly the people it was built for, and told them so with
  -- a null retry time, since min(requested_at) over no rows is null.
  if p_leagues_requested > 0
     and v_used > 0
     and v_used + p_leagues_requested > p_league_budget then
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
  'Atomically meters a reader Manager Pulse budget in league-seasons queued per rolling window and opens a manager_pulse_runs row, or returns the run already open for the same question. A reader who has spent nothing in the window is admitted whatever the size, because maxLeaguesPerRun is what caps one run. Linked and fresh league-seasons cost nothing. service_role-only EXECUTE.';

revoke all on function public.try_claim_manager_pulse(uuid, text, text, int, int, int, int, int) from public;
revoke execute on function public.try_claim_manager_pulse(uuid, text, text, int, int, int, int, int)
  from anon, authenticated;
grant execute on function public.try_claim_manager_pulse(uuid, text, text, int, int, int, int, int)
  to service_role;

-- ---------------------------------------------------------------------------
-- 4. The cross-user link only ever links to a job that takes the capture set
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
      --
      -- job_kind MATTERS. Only a 'footprint' job takes the whole capture set
      -- unconditionally. A 'pulse' job from Sync all runs pulseLeagueDerived,
      -- which takes the set only when the league is actually resynced, so a
      -- league inside its 60-minute cache gets none of it. Linking to one and
      -- then closing the league-season as done on its success reported a
      -- league-season as covered that had never been captured.
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
          -- Lost a race against another enqueue in the same instant, or this
          -- user already has a non-footprint job in flight for this league and
          -- league_sync_jobs_active_unique refused the insert. Either way, take
          -- whatever footprint job now exists; a null here means the league is
          -- being synced by a job that does not take the capture set, and the
          -- honest answer is to record the league-season as not captured rather
          -- than to link to work that will not do it.
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
  'Records the league-seasons one Manager Pulse run needs and queues footprint jobs only for leagues nobody is already capturing WITH A FOOTPRINT JOB. Links to any reader in-flight footprint job first, so a second reader on the same handle queues nothing and is charged nothing, and never links to a Sync all job that would not take the capture set. Counts rows actually STORED. service_role-only EXECUTE.';

revoke all on function public.enqueue_manager_pulse_capture(uuid, jsonb, int) from public;
revoke execute on function public.enqueue_manager_pulse_capture(uuid, jsonb, int)
  from anon, authenticated;
grant execute on function public.enqueue_manager_pulse_capture(uuid, jsonb, int)
  to service_role;
