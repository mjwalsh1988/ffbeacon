-- Migration 0260: enqueue_manager_pulse_capture counts what it actually stored
--
-- Two defects in the counting, both found by review, both quiet:
--
-- 1. `leagues_total` came from an iteration counter, while the row insert below
--    it is `on conflict do nothing`. A payload carrying the same (league,
--    season) twice therefore counted two and stored one, so the progress bar
--    could never reach 100 percent. That is precisely the failure
--    manager_pulse_run_leagues was created to prevent, reintroduced one level
--    up: the bar counts rows, so the total has to count rows too.
--
--    Fixed by counting the rows the insert actually wrote, and by counting the
--    fresh/queued/linked tallies off the same insert rather than off the loop.
--
-- 2. `exit when v_count >= greatest(coalesce(p_max_leagues, 0), 0)` has no
--    floor above zero. An admin setting maxLeaguesPerRun to 0 (the bounds allow
--    1, but a stored row predating the bounds, or a direct write, could hold 0)
--    produced a run that queued nothing, stored nothing, and read as COMPLETE
--    over zero leagues: a confident empty report rather than a refusal. A cap
--    of zero is now treated as "no cap given" and falls back to the default.
--
-- Access matrix and grants: unchanged from migration 0257.
--
-- Rollback note: re-apply the function body from migration 0257.

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
      insert into public.league_sync_jobs
        (manager_run_id, user_id, sleeper_league_id, league_name, job_kind)
      values
        (p_run_id, v_run.user_id, v_league_id,
         nullif(btrim(coalesce(v_league->>'league_name', '')), ''), 'footprint')
      on conflict do nothing
      returning id into v_job_id;

      if v_job_id is null then
        select id into v_job_id
        from public.league_sync_jobs
        where user_id = v_run.user_id
          and sleeper_league_id = v_league_id
          and status in ('pending', 'processing')
        limit 1;

        if v_job_id is null then
          v_status := 'done';
        else
          v_status := 'queued';
        end if;
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
         updated_at = now()
   where id = p_run_id;

  return jsonb_build_object(
    'leagues', v_stored,
    'queued', v_queued,
    'fresh', v_fresh,
    'linked', v_linked
  );
end;
$$;

comment on function public.enqueue_manager_pulse_capture(uuid, jsonb, int) is
  'Records the league-seasons one Manager Pulse run needs and queues footprint jobs for the stale ones. Counts rows actually STORED, so a duplicate in the payload cannot leave the progress bar short of 100 percent. Links to an in-flight job rather than duplicating it. Clears counts_against_cooldown when the run queued no work of its own. service_role-only EXECUTE.';

revoke all on function public.enqueue_manager_pulse_capture(uuid, jsonb, int) from public;
revoke execute on function public.enqueue_manager_pulse_capture(uuid, jsonb, int)
  from anon, authenticated;
grant execute on function public.enqueue_manager_pulse_capture(uuid, jsonb, int)
  to service_role;
