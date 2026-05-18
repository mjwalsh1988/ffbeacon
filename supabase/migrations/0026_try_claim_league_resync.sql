-- Migration 0026: atomic rate-limit claim for force-resync.
--
-- Replaces the read-then-upsert pattern (susceptible to TOCTOU race
-- between two concurrent admin requests) with a single atomic call that
-- either (a) inserts/updates the attempt row and returns true, or
-- (b) returns false because the window hasn't elapsed.
--
-- The function runs with SECURITY DEFINER so the rate-limit ledger
-- table stays service-role-only at the RLS layer while still being
-- callable from the API. We grant EXECUTE to authenticated; the API
-- handler still independently re-validates that the caller is admin
-- or commissioner before invoking.

create or replace function public.try_claim_league_resync(
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
    insert into public.league_resync_attempts (
      league_id, last_attempt_at, triggered_by_user_id, triggered_via
    )
    values (p_league_id, now(), p_user_id, p_triggered_via)
    on conflict (league_id) do update
      set last_attempt_at = excluded.last_attempt_at,
          triggered_by_user_id = excluded.triggered_by_user_id,
          triggered_via = excluded.triggered_via
      where public.league_resync_attempts.last_attempt_at
            < now() - make_interval(secs => p_window_seconds)
    returning 1
  )
  select exists(select 1 from upsert) into v_claimed;
  return v_claimed;
end;
$$;

revoke all on function public.try_claim_league_resync(uuid, uuid, text, int) from public;
grant execute on function public.try_claim_league_resync(uuid, uuid, text, int) to authenticated, service_role;

comment on function public.try_claim_league_resync(uuid, uuid, text, int) is
  'Atomic claim of a force-resync slot for a league. Returns true if the caller has won the rate-limit race for the window; false otherwise. The API handler at /api/leagues/[id]/resync must still independently validate that the user is admin or commissioner before invoking.';
