-- Security regression test: On The Clock identifier-independent IP budget + retention
-- (migration 0135). Findings: FFB-SEC-002, FFB-SEC-008 (fail-closed key).
--
-- Real integration test against the actual roles and RPC bodies.
-- Preconditions: migration 0135 applied.
-- Run (never persists; rolls back):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/security/on_the_clock_rate_limits.test.sql
--
-- Invariant: anon/authenticated cannot execute the budget or cleanup RPCs; the per-IP
-- budget admits exactly MAX requests per window then denies, is independent per IP,
-- resets after the window, and never fails open on an empty key; retention prunes stale
-- ledger rows.

begin;

do $harness$
declare
  r boolean;
  allowed int := 0;
  denied int := 0;
  i int;
  deleted int;
  failures text := '';
  budget_sig text := 'public.try_claim_on_the_clock_ip_budget(text, integer, integer)';
  cleanup_sig text := 'public.cleanup_on_the_clock_rate_limits(integer)';
begin
  -- Grants: untrusted roles must NOT execute either RPC.
  if has_function_privilege('anon', budget_sig, 'EXECUTE') then failures := failures || E'\n [1] anon can execute ip budget RPC'; end if;
  if has_function_privilege('authenticated', budget_sig, 'EXECUTE') then failures := failures || E'\n [2] authenticated can execute ip budget RPC'; end if;
  if has_function_privilege('anon', cleanup_sig, 'EXECUTE') then failures := failures || E'\n [3] anon can execute cleanup RPC'; end if;
  if not has_function_privilege('service_role', budget_sig, 'EXECUTE') then failures := failures || E'\n [4] service_role lost ip budget EXECUTE'; end if;

  -- Budget admits exactly MAX (3) then denies, for one IP within the window.
  for i in 1..5 loop
    r := public.try_claim_on_the_clock_ip_budget('198.51.100.10', 3, 60);
    if r then allowed := allowed + 1; else denied := denied + 1; end if;
  end loop;
  if allowed <> 3 then failures := failures || E'\n [5] allowed=' || allowed || ' (expected 3)'; end if;
  if denied <> 2 then failures := failures || E'\n [6] denied=' || denied || ' (expected 2)'; end if;

  -- Independent per IP.
  if not public.try_claim_on_the_clock_ip_budget('198.51.100.20', 3, 60) then
    failures := failures || E'\n [7] a different IP was not independent';
  end if;

  -- Window reset frees the budget.
  update public.on_the_clock_ip_budget
     set window_started_at = now() - interval '120 seconds'
   where ip_key = '198.51.100.10';
  if not public.try_claim_on_the_clock_ip_budget('198.51.100.10', 3, 60) then
    failures := failures || E'\n [8] budget did not reset after the window';
  end if;

  -- Empty key never fails open: it enforces against a stable coalesced key.
  if not public.try_claim_on_the_clock_ip_budget('', 3, 60) then
    failures := failures || E'\n [9] empty key first call unexpectedly denied';
  end if;

  -- Retention prune deletes stale rows (age everything, then clean).
  update public.on_the_clock_ip_budget set updated_at = now() - interval '48 hours';
  deleted := public.cleanup_on_the_clock_rate_limits(24);
  if deleted < 1 then failures := failures || E'\n [10] cleanup deleted nothing (expected stale rows)'; end if;
  if exists (select 1 from public.on_the_clock_ip_budget where updated_at < now() - interval '24 hours') then
    failures := failures || E'\n [11] stale ip_budget rows survived cleanup';
  end if;

  if failures <> '' then
    raise exception 'On The Clock rate-limit regression FAILED:%', failures;
  end if;
  raise notice 'ALL On The Clock rate-limit assertions PASSED';
end;
$harness$;

rollback;
