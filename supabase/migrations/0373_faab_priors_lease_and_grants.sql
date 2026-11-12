-- 0373_faab_priors_lease_and_grants.sql
--
-- Review fixes to 0372.
--
-- 1. An open pass remembers the season and logic version it was started for
--    (pass_season, pass_logic_version). A full pass left open across a
--    season rollover, or across a deploy that changed the build logic, used
--    to be resumed from its cursor, which skipped every league of the new
--    season (or the new logic) whose id sorted before that cursor. The engine
--    now abandons such a pass and starts over.
--
-- 2. A lease (lease_token, lease_until) so the hourly cron and the admin's
--    Full rebuild can never run a pass at the same time. Two interleaved runs
--    could each clear and then re-insert one league's auctions, storing them
--    twice and double-weighting every quantile that league feeds. The lease
--    outlives the route's 300-second limit, and a holder that dies simply
--    lets it lapse.
--
-- 3. Grants. Supabase gives anon and authenticated full table grants by
--    default, and RLS is what keeps them out. That is one switch from open,
--    and TRUNCATE is not governed by RLS at all, so the private tables lose
--    every grant to those roles and the public showcase keeps SELECT only.
--
-- ACCESS MATRIX after this migration
--   table / function                anon     authenticated   service_role
--   faab_prior_auctions             none     none            ALL
--   faab_prior_build_state          none     none            ALL
--   waiver_pickup_showcases         SELECT   SELECT          ALL
--   claim_faab_prior_lease()        none     none            EXECUTE
--   release_faab_prior_lease()      none     none            EXECUTE

alter table public.faab_prior_build_state
  add column if not exists pass_season integer,
  add column if not exists pass_logic_version integer,
  add column if not exists lease_token uuid,
  add column if not exists lease_until timestamptz;

-- The pass open at the time of this migration was started for 2026 under
-- logic version 1 (the only version that has ever run).
update public.faab_prior_build_state
set pass_season = 2026, pass_logic_version = 1
where id = 'global' and pass_started_at is not null and pass_season is null;

-- Claim the lease for p_seconds. Returns the holder's token, or null when
-- another run holds an unexpired lease.
create or replace function public.claim_faab_prior_lease(p_seconds integer)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_token uuid := gen_random_uuid();
begin
  insert into public.faab_prior_build_state (id) values ('global')
  on conflict (id) do nothing;

  update public.faab_prior_build_state
  set lease_token = v_token,
      lease_until = now() + make_interval(secs => greatest(coalesce(p_seconds, 330), 1))
  where id = 'global'
    and (lease_until is null or lease_until < now());

  if found then
    return v_token;
  end if;
  return null;
end;
$$;

-- Release the lease, only for the run that holds it.
create or replace function public.release_faab_prior_lease(p_token uuid)
returns void
language sql
set search_path = ''
as $$
  update public.faab_prior_build_state
  set lease_token = null, lease_until = null
  where id = 'global' and lease_token = p_token;
$$;

revoke all on function public.claim_faab_prior_lease(integer) from public, anon, authenticated;
grant execute on function public.claim_faab_prior_lease(integer) to service_role;
revoke all on function public.release_faab_prior_lease(uuid) from public, anon, authenticated;
grant execute on function public.release_faab_prior_lease(uuid) to service_role;

revoke all on table public.faab_prior_auctions from anon, authenticated;
revoke all on table public.faab_prior_build_state from anon, authenticated;
revoke insert, update, delete, truncate, references, trigger
  on table public.waiver_pickup_showcases from anon, authenticated;
