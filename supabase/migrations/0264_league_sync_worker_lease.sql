-- Migration 0264: the drainer lease, and per-job telemetry
--
-- Exactly one worker pass drains league_sync_jobs at a time. The pass that
-- holds this row is the only process making Sleeper calls on behalf of the
-- queue, which is what lets an in-process token bucket be the site's Sleeper
-- budget without a database round trip per call.
--
-- Access matrix: service_role ALL, nobody else anything. The two functions are
-- SECURITY DEFINER with service_role-only EXECUTE, revoked from public, anon
-- and authenticated by name.
--
-- Rollback:
--   drop function if exists public.release_league_sync_lease(text);
--   drop function if exists public.try_acquire_league_sync_lease(text, int);
--   drop table if exists public.league_sync_worker_lease;
--   alter table public.league_sync_jobs drop column if exists sleeper_calls, drop column if exists duration_ms;

create table if not exists public.league_sync_worker_lease (
  id text primary key default 'global' check (id = 'global'),
  holder text,
  held_until timestamptz not null default to_timestamp(0),
  updated_at timestamptz not null default now()
);
insert into public.league_sync_worker_lease (id) values ('global') on conflict do nothing;

alter table public.league_sync_worker_lease enable row level security;
drop policy if exists league_sync_worker_lease_service_role_all on public.league_sync_worker_lease;
create policy league_sync_worker_lease_service_role_all
  on public.league_sync_worker_lease for all to service_role using (true) with check (true);
revoke all on table public.league_sync_worker_lease from anon, authenticated;

comment on table public.league_sync_worker_lease is
  'One row. The holder of this lease is the single worker pass allowed to drain league_sync_jobs, which is what makes the in-process Sleeper token bucket the site budget for queue traffic. Service-role only.';

-- Acquire or renew. True when p_holder now holds the lease.
create or replace function public.try_acquire_league_sync_lease(p_holder text, p_seconds int)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_ok boolean := false;
begin
  update public.league_sync_worker_lease
     set holder = p_holder,
         held_until = now() + make_interval(secs => greatest(coalesce(p_seconds, 0), 1)),
         updated_at = now()
   where id = 'global'
     and (held_until < now() or holder = p_holder)
  returning true into v_ok;
  return coalesce(v_ok, false);
end;
$$;

create or replace function public.release_league_sync_lease(p_holder text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.league_sync_worker_lease
     set held_until = now(), updated_at = now()
   where id = 'global' and holder = p_holder;
$$;

revoke all on function public.try_acquire_league_sync_lease(text, int) from public;
revoke execute on function public.try_acquire_league_sync_lease(text, int) from anon, authenticated;
grant execute on function public.try_acquire_league_sync_lease(text, int) to service_role;
revoke all on function public.release_league_sync_lease(text) from public;
revoke execute on function public.release_league_sync_lease(text) from anon, authenticated;
grant execute on function public.release_league_sync_lease(text) to service_role;

alter table public.league_sync_jobs
  add column if not exists sleeper_calls int,
  add column if not exists duration_ms int;
comment on column public.league_sync_jobs.sleeper_calls is 'Sleeper requests this job made, counted by the token bucket. Null before 0264.';
comment on column public.league_sync_jobs.duration_ms is 'Wall clock of the job in the worker. Null before 0264.';
