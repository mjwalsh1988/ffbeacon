-- Migration 0137: generic durable rate-limit primitive (FFB-SEC-011)
--
-- The On The Clock report-format email endpoint used a per-serverless-instance in-memory
-- window, so each cold instance allowed the full cap and the effective limit multiplied
-- across instances. This adds a DB-backed fixed-window counter that holds globally across
-- instances, keyed by (bucket, key). The route passes a HASHED client IP as the key so no
-- raw IP is stored. Atomic single-upsert; safe under concurrency.
--
-- SECURITY DEFINER + service_role-only EXECUTE (revoked from PUBLIC too); RLS locks the
-- table to service_role. Trusted server routes call it via the service-role client.
-- Idempotent.

create table if not exists public.rate_limit_hits (
  bucket text not null,
  key text not null,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (bucket, key)
);

alter table public.rate_limit_hits enable row level security;

drop policy if exists rate_limit_hits_service_role_all on public.rate_limit_hits;
create policy rate_limit_hits_service_role_all on public.rate_limit_hits
  for all to service_role using (true) with check (true);

create index if not exists rate_limit_hits_updated_at_idx on public.rate_limit_hits (updated_at);

comment on table public.rate_limit_hits is
  'Generic durable fixed-window rate-limit counters keyed by (bucket, key). service_role-only; written via try_claim_rate_limit. Keys should be hashed identifiers, never raw IPs.';

create or replace function public.try_claim_rate_limit(
  p_bucket text,
  p_key text,
  p_max_requests int,
  p_window_seconds int
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  insert into public.rate_limit_hits as h (bucket, key, window_started_at, request_count, updated_at)
  values (p_bucket, coalesce(nullif(p_key, ''), 'unknown'), now(), 1, now())
  on conflict (bucket, key) do update
    set window_started_at = case
          when h.window_started_at < now() - make_interval(secs => p_window_seconds) then now()
          else h.window_started_at
        end,
        request_count = case
          when h.window_started_at < now() - make_interval(secs => p_window_seconds) then 1
          else least(h.request_count + 1, p_max_requests + 1)
        end,
        updated_at = now()
  returning request_count into v_count;

  return v_count <= p_max_requests;
end;
$$;

revoke all on function public.try_claim_rate_limit(text, text, int, int) from public, anon, authenticated;
grant execute on function public.try_claim_rate_limit(text, text, int, int) to service_role;

comment on function public.try_claim_rate_limit(text, text, int, int) is
  'Atomic durable fixed-window rate-limit claim. Returns true while within budget for (bucket, key), false once exhausted. service_role EXECUTE only.';

-- Bounded retention prune (wired into the nightly recalculate-derived cron).
create or replace function public.cleanup_rate_limit_hits(
  p_max_age_hours int default 24
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  delete from public.rate_limit_hits
   where updated_at < now() - make_interval(hours => p_max_age_hours);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.cleanup_rate_limit_hits(int) from public, anon, authenticated;
grant execute on function public.cleanup_rate_limit_hits(int) to service_role;

comment on function public.cleanup_rate_limit_hits(int) is
  'Deletion-only retention prune for rate_limit_hits. Returns rows deleted. service_role EXECUTE only.';
