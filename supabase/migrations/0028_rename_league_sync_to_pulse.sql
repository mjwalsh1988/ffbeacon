-- Migration 0028: rename the "League Sync" feature to "League Pulse".
--
-- Renames the operational columns on `leagues`, the force-refresh rate-limit
-- ledger table, and its atomic-claim RPC. ALTER ... RENAME preserves all
-- rows, indexes, and RLS policies, so no data is lost and access is unchanged.
--
-- Access matrix (unchanged):
--   leagues                  : public SELECT; service-role writes
--   league_refresh_attempts  : service_role ALL only; clients blocked
--   try_claim_league_refresh : EXECUTE for authenticated + service_role

-- 1. leagues operational columns
alter table public.leagues rename column last_synced_at to last_pulsed_at;
alter table public.leagues rename column sync_status to pulse_status;
alter table public.leagues rename column sync_error to pulse_error;

-- 2. force-refresh rate-limit ledger table (was league_resync_attempts)
alter table public.league_resync_attempts rename to league_refresh_attempts;

-- ALTER TABLE RENAME does not rename dependent constraints; do so explicitly.
alter table public.league_refresh_attempts
  rename constraint league_resync_attempts_pkey to league_refresh_attempts_pkey;
alter table public.league_refresh_attempts
  rename constraint league_resync_attempts_league_id_fkey to league_refresh_attempts_league_id_fkey;

alter policy league_resync_attempts_service_role_all
  on public.league_refresh_attempts
  rename to league_refresh_attempts_service_role_all;

comment on table public.league_refresh_attempts is
  'Per-league throttle ledger for the admin/commissioner force-refresh endpoint. service_role-only; clients hit the API which validates auth and rate limit.';

-- 3. atomic rate-limit claim RPC (was try_claim_league_resync)
drop function if exists public.try_claim_league_resync(uuid, uuid, text, int);

create or replace function public.try_claim_league_refresh(
  p_league_id uuid,
  p_user_id uuid,
  p_triggered_via text,
  p_window_seconds int default 60
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claimed boolean := false;
begin
  with upsert as (
    insert into public.league_refresh_attempts (
      league_id, last_attempt_at, triggered_by_user_id, triggered_via
    )
    values (p_league_id, now(), p_user_id, p_triggered_via)
    on conflict (league_id) do update
      set last_attempt_at = excluded.last_attempt_at,
          triggered_by_user_id = excluded.triggered_by_user_id,
          triggered_via = excluded.triggered_via
      where public.league_refresh_attempts.last_attempt_at
            < now() - make_interval(secs => p_window_seconds)
    returning 1
  )
  select exists(select 1 from upsert) into v_claimed;
  return v_claimed;
end;
$$;

revoke all on function public.try_claim_league_refresh(uuid, uuid, text, int) from public;
grant execute on function public.try_claim_league_refresh(uuid, uuid, text, int) to authenticated, service_role;

comment on function public.try_claim_league_refresh(uuid, uuid, text, int) is
  'Atomic claim of a force-refresh slot for a league. Returns true if the caller has won the rate-limit race for the window; false otherwise. The API handler at /api/leagues/[id]/refresh must still independently validate that the user is admin or commissioner before invoking.';
