-- Security regression test: try_claim_league_refresh EXECUTE hardening (migration 0134)
-- Findings covered: FFB-SEC-007 (and the RPC portion of FFB-SEC-004).
--
-- Real integration test. The property lives in PostgreSQL EXECUTE grants and the RPC
-- body, so it must be exercised against the actual anon / authenticated / service_role
-- roles rather than mocked.
--
-- Preconditions: migration 0134 applied.
-- Run (never persists: ephemeral league + rollback):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/security/league_refresh_rpc_grants.test.sql
--
-- Invariant: anon and authenticated cannot EXECUTE the cooldown RPC (so they cannot
-- grief the shared per-league cooldown or spoof the audit identity); service_role can,
-- and the shared per-league cooldown behaves correctly (first claim wins, repeats inside
-- the window are blocked, different leagues are independent, and the slot frees after the
-- window). Refresh stays public via the trusted server route that calls this as service_role.

begin;

do $harness$
declare
  L1 uuid;
  L2 uuid;
  b boolean;
  failures text := '';
  sig text := 'public.try_claim_league_refresh(uuid, uuid, text, integer)';
begin
  -- Ephemeral leagues (rolled back at the end).
  insert into public.leagues(sleeper_league_id, name, season)
    values ('ffb_sec_test_L1', 'FFB SEC TEST L1', 2026) returning id into L1;
  insert into public.leagues(sleeper_league_id, name, season)
    values ('ffb_sec_test_L2', 'FFB SEC TEST L2', 2026) returning id into L2;

  -- Grant introspection.
  if has_function_privilege('anon', sig, 'EXECUTE') then
    failures := failures || E'\n [1] anon still has EXECUTE on the refresh RPC';
  end if;
  if has_function_privilege('authenticated', sig, 'EXECUTE') then
    failures := failures || E'\n [2] authenticated still has EXECUTE on the refresh RPC';
  end if;
  if not has_function_privilege('service_role', sig, 'EXECUTE') then
    failures := failures || E'\n [3] service_role lost EXECUTE on the refresh RPC';
  end if;

  -- Live denial: anon attempt must raise insufficient_privilege (42501).
  begin
    execute 'set local role anon';
    execute 'select public.try_claim_league_refresh($1,null,''public'',60)' using L1;
    execute 'reset role';
    failures := failures || E'\n [4] anon could EXECUTE the refresh RPC directly';
  exception when others then
    if sqlstate <> '42501' then failures := failures || E'\n [4] anon blocked but not by privilege: ' || sqlstate; end if;
  end;
  execute 'reset role';

  begin
    execute 'set local role authenticated';
    execute 'select public.try_claim_league_refresh($1,null,''public'',60)' using L1;
    execute 'reset role';
    failures := failures || E'\n [5] authenticated could EXECUTE the refresh RPC directly';
  exception when others then
    if sqlstate <> '42501' then failures := failures || E'\n [5] authenticated blocked but not by privilege: ' || sqlstate; end if;
  end;
  execute 'reset role';

  -- service_role: cooldown semantics.
  execute 'set local role service_role';
  execute 'select public.try_claim_league_refresh($1,null,''public'',60)' into b using L1;
  if b is distinct from true then failures := failures || E'\n [6] first claim was not true'; end if;
  execute 'select public.try_claim_league_refresh($1,null,''public'',60)' into b using L1;
  if b is distinct from false then failures := failures || E'\n [7] repeat claim inside window was not false'; end if;
  execute 'select public.try_claim_league_refresh($1,null,''public'',60)' into b using L2;
  if b is distinct from true then failures := failures || E'\n [8] different league claim was not independent'; end if;
  execute 'reset role';

  -- Post-window: slot frees.
  update public.league_refresh_attempts set last_attempt_at = now() - interval '120 seconds' where league_id = L1;
  execute 'set local role service_role';
  execute 'select public.try_claim_league_refresh($1,null,''public'',60)' into b using L1;
  if b is distinct from true then failures := failures || E'\n [9] post-window claim was not true'; end if;
  execute 'reset role';

  -- Guest actor is recorded as null (not spoofable).
  if exists (
    select 1 from public.league_refresh_attempts
    where league_id = L1 and (triggered_by_user_id is not null or triggered_via <> 'public')
  ) then
    failures := failures || E'\n [10] guest actor was not recorded as null/public';
  end if;

  if failures <> '' then
    raise exception 'league refresh RPC hardening regression FAILED:%', failures;
  end if;
  raise notice 'ALL league refresh RPC hardening assertions PASSED';
end;
$harness$;

rollback;
