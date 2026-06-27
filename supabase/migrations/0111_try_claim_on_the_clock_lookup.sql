-- Migration 0111: try_claim_on_the_clock_lookup (durable abuse guard for the leagues route)
--
-- Atomic claim over the on_the_clock_lookup_attempts ledger (migration 0109), same
-- claim-and-cooldown shape as try_claim_league_resync. Returns true if the caller has
-- won the throttle window for this (ip, username) key, false otherwise. The leagues
-- route validates input first, then calls this before fanning out to Sleeper.
--
-- SECURITY DEFINER so the ledger stays service-role-only at the RLS layer. EXECUTE is
-- granted to service_role ONLY (the leagues route calls it via the service-role client).

create or replace function public.try_claim_on_the_clock_lookup(
  p_ip text,
  p_username text,
  p_window_seconds int default 10
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text := lower(coalesce(p_ip, '') || ':' || coalesce(p_username, ''));
  v_claimed boolean := false;
begin
  with upsert as (
    insert into public.on_the_clock_lookup_attempts (key, last_attempt_at)
    values (v_key, now())
    on conflict (key) do update
      set last_attempt_at = excluded.last_attempt_at
      where public.on_the_clock_lookup_attempts.last_attempt_at
            < now() - make_interval(secs => p_window_seconds)
    returning 1
  )
  select exists(select 1 from upsert) into v_claimed;
  return v_claimed;
end;
$$;

revoke all on function public.try_claim_on_the_clock_lookup(text, text, int) from public;
grant execute on function public.try_claim_on_the_clock_lookup(text, text, int) to service_role;

comment on function public.try_claim_on_the_clock_lookup(text, text, int) is
  'Atomic per-(ip, username) throttle claim for the On The Clock leagues lookup route. Returns true if the caller won the window, false otherwise. service_role EXECUTE only; the route validates input and calls this before any Sleeper fan-out.';
