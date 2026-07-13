-- Security regression test: user_preferences.is_admin write hardening (migration 0133)
-- Findings covered: FFB-SEC-001, FFB-SEC-014.
--
-- This is a REAL integration test. The security property lives in PostgreSQL column
-- GRANTs, RLS policies, and a trigger. Those cannot be proven by application-level
-- mocks, so this harness exercises the actual anon / authenticated / service_role
-- PostgREST roles against the live schema.
--
-- Preconditions:
--   * Migration 0133 has been applied to the target database (branch / local / prod).
--
-- How to run (does NOT persist anything: it creates ephemeral auth users, runs every
-- assertion, and always rolls back):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/security/is_admin_write_hardening.test.sql
--
-- Exit behavior:
--   * All assertions pass -> prints "ALL is_admin hardening assertions PASSED" and rolls back.
--   * Any assertion fails  -> RAISEs an exception listing the failures (psql exits non-zero).
--
-- The invariant under test: a caller using the anon or authenticated PostgREST roles
-- can never cause user_preferences.is_admin to become true, through INSERT, UPDATE,
-- UPSERT, DELETE-then-INSERT, omitted / explicit is_admin, with or without JWT claims,
-- nor touch another user's row. service_role retains the legitimate promotion path.

begin;

do $harness$
declare
  U0 uuid := gen_random_uuid();  -- ephemeral user WITHOUT a prefs row (INSERT tests)
  U1 uuid := gen_random_uuid();  -- ephemeral user WITH a non-admin prefs row (UPDATE/DELETE)
  UX uuid := gen_random_uuid();  -- ephemeral third user (cross-user IDOR target)
  c0 text;
  c1 text;
  v boolean;
  n int;
  failures text := '';
begin
  -- Ephemeral fixtures (rolled back at the end).
  insert into auth.users(id) values (U0), (U1), (UX);
  insert into public.user_preferences(user_id, default_source_slug) values (U1, 'ktc');
  insert into public.user_preferences(user_id, default_source_slug, is_admin) values (UX, 'ktc', true);
  c0 := json_build_object('sub', U0, 'role', 'authenticated')::text;
  c1 := json_build_object('sub', U1, 'role', 'authenticated')::text;

  -- Helper inline pattern: each test runs in a subtransaction; on unexpected outcome
  -- it appends to `failures`.

  -- 1. authenticated INSERT is_admin=true -> BLOCKED
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', c0, true);
    insert into public.user_preferences(user_id, is_admin) values (U0, true);
    execute 'reset role';
    failures := failures || E'\n [1] authenticated INSERT is_admin=true was ALLOWED (escalation)';
  exception when others then null; end;
  execute 'reset role';

  -- 2. authenticated INSERT normal prefs (no is_admin) -> ALLOWED and is_admin=false
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', c0, true);
    insert into public.user_preferences(user_id, default_source_slug) values (U0, 'ktc');
    select is_admin into v from public.user_preferences where user_id = U0;
    execute 'reset role';
    if v is distinct from false then
      failures := failures || E'\n [2] normal INSERT produced is_admin=' || coalesce(v::text,'null');
    end if;
  exception when others then
    execute 'reset role';
    failures := failures || E'\n [2] normal prefs INSERT was blocked: ' || sqlerrm;
  end;

  -- 3. authenticated UPDATE own row is_admin=true -> BLOCKED
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', c1, true);
    update public.user_preferences set is_admin = true where user_id = U1;
    execute 'reset role';
    failures := failures || E'\n [3] authenticated UPDATE own is_admin=true was ALLOWED (escalation)';
  exception when others then null; end;
  execute 'reset role';

  -- 4. authenticated UPDATE normal pref on own row -> ALLOWED
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', c1, true);
    update public.user_preferences set default_source_slug = 'fantasycalc' where user_id = U1;
    get diagnostics n = row_count;
    execute 'reset role';
    if n <> 1 then failures := failures || E'\n [4] normal UPDATE affected ' || n || ' rows (expected 1)'; end if;
  exception when others then
    execute 'reset role';
    failures := failures || E'\n [4] normal UPDATE was blocked: ' || sqlerrm;
  end;

  -- 5. DELETE-then-INSERT with is_admin=true -> BLOCKED
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', c1, true);
    delete from public.user_preferences where user_id = U1;
    insert into public.user_preferences(user_id, is_admin) values (U1, true);
    execute 'reset role';
    failures := failures || E'\n [5] DELETE-then-INSERT is_admin=true was ALLOWED (escalation)';
  exception when others then null; end;
  execute 'reset role';

  -- 6. UPSERT (INSERT ON CONFLICT) with is_admin=true -> BLOCKED
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', c1, true);
    insert into public.user_preferences(user_id, default_source_slug, is_admin) values (U1, 'x', true)
      on conflict (user_id) do update set is_admin = excluded.is_admin;
    execute 'reset role';
    failures := failures || E'\n [6] UPSERT is_admin=true was ALLOWED (escalation)';
  exception when others then null; end;
  execute 'reset role';

  -- 7. cross-user INSERT (as U1, row for U0) -> BLOCKED by RLS
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', c1, true);
    insert into public.user_preferences(user_id, default_source_slug) values (U0, 'x');
    execute 'reset role';
    failures := failures || E'\n [7] cross-user INSERT was ALLOWED (IDOR)';
  exception when others then null; end;
  execute 'reset role';

  -- 8. cross-user UPDATE (as U1, another user's row) -> 0 rows (RLS scoped)
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', c1, true);
    update public.user_preferences set default_source_slug = 'x' where user_id = UX;
    get diagnostics n = row_count;
    execute 'reset role';
    if n <> 0 then failures := failures || E'\n [8] cross-user UPDATE affected ' || n || ' rows (expected 0)'; end if;
  exception when others then execute 'reset role'; end;

  -- 9. TRIGGER isolation: grant is_admin column, authenticated INSERT true -> blocked by TRIGGER
  begin
    grant insert (is_admin) on public.user_preferences to authenticated;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', c0, true);
    insert into public.user_preferences(user_id, is_admin) values (U0, true);
    execute 'reset role';
    failures := failures || E'\n [9] trigger did not block INSERT when is_admin column was granted';
  exception when others then
    if sqlerrm not like '%trusted server-side role%' then
      failures := failures || E'\n [9] blocked, but not by the trigger guard: ' || sqlerrm;
    end if;
  end;
  execute 'reset role';

  -- 10. TRIGGER fail-closed on NULL claims: grant is_admin column, no claims -> blocked by TRIGGER
  begin
    grant insert (is_admin) on public.user_preferences to authenticated;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', '', true);
    insert into public.user_preferences(user_id, is_admin) values (U0, true);
    execute 'reset role';
    failures := failures || E'\n [10] trigger failed OPEN on null claims';
  exception when others then
    if sqlerrm not like '%trusted server-side role%' then
      failures := failures || E'\n [10] blocked, but not by the trigger guard: ' || sqlerrm;
    end if;
  end;
  execute 'reset role';

  -- 11. service_role CAN legitimately set is_admin=true -> ALLOWED
  begin
    execute 'set local role service_role';
    update public.user_preferences set is_admin = true where user_id = U1;
    select is_admin into v from public.user_preferences where user_id = U1;
    execute 'reset role';
    if v is distinct from true then failures := failures || E'\n [11] service_role could not set is_admin=true'; end if;
  exception when others then
    execute 'reset role';
    failures := failures || E'\n [11] service_role write raised: ' || sqlerrm;
  end;

  -- 12-15. Column-privilege introspection
  if has_column_privilege('authenticated','public.user_preferences','is_admin','INSERT') then
    failures := failures || E'\n [12] authenticated still has INSERT on is_admin';
  end if;
  if has_column_privilege('authenticated','public.user_preferences','is_admin','UPDATE') then
    failures := failures || E'\n [13] authenticated still has UPDATE on is_admin';
  end if;
  if not has_column_privilege('authenticated','public.user_preferences','bio','INSERT') then
    failures := failures || E'\n [14] authenticated lost INSERT on bio (over-broad revoke)';
  end if;
  if has_column_privilege('anon','public.user_preferences','is_admin','INSERT') then
    failures := failures || E'\n [15] anon has INSERT on is_admin';
  end if;

  if failures <> '' then
    raise exception 'is_admin hardening regression FAILED:%', failures;
  end if;

  raise notice 'ALL is_admin hardening assertions PASSED';
end;
$harness$;

rollback;
