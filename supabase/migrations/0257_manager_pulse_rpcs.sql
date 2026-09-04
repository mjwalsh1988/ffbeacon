-- Migration 0257: the two Manager Pulse RPCs
--
-- Access matrix
--   anon          : no EXECUTE on either function
--   authenticated : no EXECUTE on either function
--   service_role  : EXECUTE on both
--   tables touched: manager_pulse_runs, manager_pulse_run_leagues,
--                   league_sync_jobs. Both functions are SECURITY DEFINER, so
--                   they write past RLS on purpose; that is why neither is
--                   callable by a browser and why the caller is responsible for
--                   establishing who the user is before invoking them.
--
-- try_claim_manager_pulse   the per-user cooldown and the run row, atomically
-- enqueue_manager_pulse_capture  the run's league list and its jobs, atomically
--
-- Both are SECURITY DEFINER with a pinned search_path, both are service_role-only
-- EXECUTE, and both are revoked from public, anon and authenticated BY NAME.
-- Naming all three matters: `revoke ... from public` leaves Supabase's own named
-- grants to anon and authenticated in place, which is how a function ends up
-- callable from a browser after being "locked down".
--
-- Why the claim is an RPC and not a route check
--   Two lookups landing together would both read "no run in the window" and both
--   proceed. The check and the insert have to be one transaction, and the
--   per-user advisory lock is what makes concurrent callers take turns rather
--   than interleave. A limit you can beat by double-clicking is not a limit.
--   Same reasoning, same shape, as enqueue_bulk_league_sync in migration 0172.
--
-- Rollback note (no down migration ships):
--   drop function if exists public.enqueue_manager_pulse_capture(uuid, jsonb, int);
--   drop function if exists public.try_claim_manager_pulse(uuid, text, text, int, int, int);

-- ---------------------------------------------------------------------------
-- Claim the cooldown and open a run
-- ---------------------------------------------------------------------------
--
-- Returns one of:
--   { "claimed": true, "run_id": "..." }
--   { "claimed": false, "reason": "cooldown", "retry_after_seconds": 2100,
--     "next_allowed_at": "..." }
--   { "claimed": false, "reason": "no_user" | "no_subject" }
--
-- Only runs with counts_against_cooldown are considered. A run that turned out
-- to need no capture flips that flag off, so a reader whose report was already
-- warm is not charged an hour for a page load that cost one indexed read.

create or replace function public.try_claim_manager_pulse(
  p_user_id uuid,
  p_sleeper_user_id text,
  p_sleeper_handle text,
  p_season_from int,
  p_season_to int,
  p_cooldown_seconds int default 3600
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := now();
  v_last public.manager_pulse_runs%rowtype;
  v_ready_at timestamptz;
  v_run_id uuid;
begin
  if p_user_id is null then
    return jsonb_build_object('claimed', false, 'reason', 'no_user');
  end if;

  if coalesce(btrim(p_sleeper_user_id), '') = '' then
    return jsonb_build_object('claimed', false, 'reason', 'no_subject');
  end if;

  -- Take turns per user for the rest of this transaction.
  perform pg_advisory_xact_lock(hashtext('manager_pulse:' || p_user_id::text));

  select * into v_last
  from public.manager_pulse_runs
  where user_id = p_user_id
    and counts_against_cooldown
  order by requested_at desc
  limit 1;

  if found then
    v_ready_at := v_last.requested_at + make_interval(secs => p_cooldown_seconds);
    if v_now < v_ready_at then
      return jsonb_build_object(
        'claimed', false,
        'reason', 'cooldown',
        'retry_after_seconds',
          greatest(1, ceil(extract(epoch from (v_ready_at - v_now)))::int),
        'next_allowed_at', v_ready_at
      );
    end if;
  end if;

  insert into public.manager_pulse_runs (
    user_id, sleeper_user_id, sleeper_handle, season_from, season_to, status
  )
  values (
    p_user_id,
    btrim(p_sleeper_user_id),
    nullif(btrim(coalesce(p_sleeper_handle, '')), ''),
    p_season_from,
    p_season_to,
    'pending'
  )
  returning id into v_run_id;

  return jsonb_build_object('claimed', true, 'run_id', v_run_id);
end;
$$;

comment on function public.try_claim_manager_pulse(uuid, text, text, int, int, int) is
  'Atomically enforces the per-user Manager Pulse cooldown and opens a manager_pulse_runs row. Only runs flagged counts_against_cooldown are considered, so a lookup that needed no capture does not spend the window. service_role-only EXECUTE.';

revoke all on function public.try_claim_manager_pulse(uuid, text, text, int, int, int) from public;
revoke execute on function public.try_claim_manager_pulse(uuid, text, text, int, int, int)
  from anon, authenticated;
grant execute on function public.try_claim_manager_pulse(uuid, text, text, int, int, int)
  to service_role;

-- ---------------------------------------------------------------------------
-- Record what the run needs, and queue only what is missing
-- ---------------------------------------------------------------------------
--
-- p_leagues is a jsonb array of:
--   { "sleeper_league_id": "...", "season": 2026, "league_name": "...",
--     "league_category": "dynasty" | "redraft" | "best-ball-dynasty"
--                        | "best-ball-redraft" | null,
--     "needs_capture": true | false }
--
-- The caller decides needs_capture by looking at how fresh public.leagues
-- already is. That decision is not made here because it depends on a TTL that
-- lives in the settings row, and a database function is the wrong place to teach
-- about a product setting.
--
-- For a league that needs capture we try to insert a job. If
-- league_sync_jobs_active_unique rejects it, this league is ALREADY being synced
-- for this user by some other request, and the right answer is to wait on that
-- job rather than to start a second one, so we look the existing job up and link
-- to it. That is precisely the case a naive "count the rows I inserted" progress
-- bar gets wrong.
--
-- Returns:
--   { "leagues": 44, "queued": 12, "fresh": 30, "linked": 2 }
--
-- queued  jobs this call created
-- linked  leagues already in flight, whose existing job this run now waits on
-- fresh   leagues that needed nothing

create or replace function public.enqueue_manager_pulse_capture(
  p_run_id uuid,
  p_leagues jsonb,
  p_max_leagues int default 60
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run public.manager_pulse_runs%rowtype;
  v_league jsonb;
  v_league_id text;
  v_season int;
  v_needs boolean;
  v_job_id uuid;
  v_status text;
  v_count int := 0;
  v_queued int := 0;
  v_linked int := 0;
  v_fresh int := 0;
begin
  select * into v_run from public.manager_pulse_runs where id = p_run_id;
  if not found then
    return jsonb_build_object('error', 'no_run');
  end if;

  for v_league in select * from jsonb_array_elements(coalesce(p_leagues, '[]'::jsonb))
  loop
    exit when v_count >= greatest(coalesce(p_max_leagues, 0), 0);

    v_league_id := btrim(coalesce(v_league->>'sleeper_league_id', ''));
    continue when v_league_id = '';

    v_season := nullif(v_league->>'season', '')::int;
    continue when v_season is null;

    v_needs := coalesce((v_league->>'needs_capture')::boolean, true);
    v_job_id := null;

    if v_needs then
      insert into public.league_sync_jobs
        (manager_run_id, user_id, sleeper_league_id, league_name, job_kind)
      values
        (p_run_id, v_run.user_id, v_league_id,
         nullif(btrim(coalesce(v_league->>'league_name', '')), ''), 'footprint')
      on conflict do nothing
      returning id into v_job_id;

      if v_job_id is null then
        -- Already in flight for this user. Wait on that job.
        select id into v_job_id
        from public.league_sync_jobs
        where user_id = v_run.user_id
          and sleeper_league_id = v_league_id
          and status in ('pending', 'processing')
        limit 1;

        if v_job_id is null then
          -- It finished between the insert and this read. Treat it as done.
          v_status := 'done';
          v_fresh := v_fresh + 1;
        else
          v_status := 'queued';
          v_linked := v_linked + 1;
        end if;
      else
        v_status := 'queued';
        v_queued := v_queued + 1;
      end if;
    else
      v_status := 'fresh';
      v_fresh := v_fresh + 1;
    end if;

    insert into public.manager_pulse_run_leagues
      (run_id, user_id, sleeper_league_id, season, league_name, league_category,
       status, job_id)
    values
      (p_run_id, v_run.user_id, v_league_id, v_season,
       nullif(btrim(coalesce(v_league->>'league_name', '')), ''),
       nullif(btrim(coalesce(v_league->>'league_category', '')), ''),
       v_status, v_job_id)
    on conflict (run_id, sleeper_league_id, season) do nothing;

    v_count := v_count + 1;
  end loop;

  update public.manager_pulse_runs
     set leagues_total = v_count,
         leagues_done = v_fresh,
         status = case when v_queued + v_linked = 0 then 'computing' else 'capturing' end,
         -- A run that queued nothing of its own did no Sleeper work, so it does
         -- not spend the reader's next hour. Linking to somebody else's job does
         -- not count as work either: that sync was already happening.
         counts_against_cooldown = (v_queued > 0),
         updated_at = now()
   where id = p_run_id;

  return jsonb_build_object(
    'leagues', v_count,
    'queued', v_queued,
    'fresh', v_fresh,
    'linked', v_linked
  );
end;
$$;

comment on function public.enqueue_manager_pulse_capture(uuid, jsonb, int) is
  'Records the league-seasons one Manager Pulse run needs and queues footprint jobs for the ones that are stale. Links to an existing in-flight job rather than duplicating it, so progress counts leagues rather than inserted rows. Clears counts_against_cooldown when the run queued no work of its own. service_role-only EXECUTE.';

revoke all on function public.enqueue_manager_pulse_capture(uuid, jsonb, int) from public;
revoke execute on function public.enqueue_manager_pulse_capture(uuid, jsonb, int)
  from anon, authenticated;
grant execute on function public.enqueue_manager_pulse_capture(uuid, jsonb, int)
  to service_role;
