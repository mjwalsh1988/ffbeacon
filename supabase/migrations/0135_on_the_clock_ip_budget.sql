-- Migration 0135: On The Clock identifier-independent per-IP abuse budget + ledger retention
-- Findings: FFB-SEC-002 (rate-limit amplification), FFB-SEC-008 (trusted IP), FFB-SEC-011-adjacent.
--
-- Problem: the existing per-(ip, resource) claim (try_claim_on_the_clock_lookup) only
-- blocks repeats of the SAME resource id. A script rotating league/draft ids from one
-- source never trips it, and each request fans out to many Sleeper calls. /draft and
-- /draft/sync had no per-IP limit at all.
--
-- Fix: a second, identifier-INDEPENDENT budget keyed on the trusted client IP only. It
-- bounds the total number of expensive Sleeper fan-outs one source can trigger per
-- window, regardless of which resource id is requested. Enforced in front of every
-- Sleeper fan-out across the On The Clock routes.
--
-- Durable across serverless instances (DB-backed fixed window), atomic (single upsert),
-- and generous enough not to block ordinary draft-room usage or shared NAT / office /
-- carrier / VPN IPs. The default is MAX 40 fan-outs per 60s per IP (tuned at the call
-- sites in lib/on-the-clock/cache.ts).
--
-- Also adds a bounded retention prune for both rate-limit ledgers so they cannot grow
-- without bound (FFB-SEC-002). Deletion-only, indexed, safe under concurrency; wired
-- into the nightly /api/cron/recalculate-derived job (a global, non-per-league task).
--
-- All objects are SECURITY DEFINER with service_role-only EXECUTE and RLS locking the
-- table to service_role. The browser never touches them; routes call via the
-- service-role admin client. Idempotent.

-- Fixed-window counter table (one row per IP key).
create table if not exists public.on_the_clock_ip_budget (
  ip_key text primary key,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.on_the_clock_ip_budget enable row level security;

drop policy if exists on_the_clock_ip_budget_service_role_all on public.on_the_clock_ip_budget;
create policy on_the_clock_ip_budget_service_role_all on public.on_the_clock_ip_budget
  for all to service_role using (true) with check (true);

-- Prune index for retention cleanup.
create index if not exists on_the_clock_ip_budget_updated_at_idx
  on public.on_the_clock_ip_budget (updated_at);

comment on table public.on_the_clock_ip_budget is
  'Identifier-independent per-IP fixed-window budget for On The Clock Sleeper fan-outs (FFB-SEC-002). service_role-only; written via try_claim_on_the_clock_ip_budget.';

-- Atomic fixed-window claim. Returns true while the caller is within the window budget,
-- false once it is exhausted. The window resets lazily on the first call after it lapses.
create or replace function public.try_claim_on_the_clock_ip_budget(
  p_ip_key text,
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
  insert into public.on_the_clock_ip_budget as b (ip_key, window_started_at, request_count, updated_at)
  values (coalesce(nullif(p_ip_key, ''), 'unknown-ip'), now(), 1, now())
  on conflict (ip_key) do update
    set window_started_at = case
          when b.window_started_at < now() - make_interval(secs => p_window_seconds) then now()
          else b.window_started_at
        end,
        request_count = case
          when b.window_started_at < now() - make_interval(secs => p_window_seconds) then 1
          else least(b.request_count + 1, p_max_requests + 1)
        end,
        updated_at = now()
  returning request_count into v_count;

  return v_count <= p_max_requests;
end;
$$;

revoke all on function public.try_claim_on_the_clock_ip_budget(text, int, int) from public, anon, authenticated;
grant execute on function public.try_claim_on_the_clock_ip_budget(text, int, int) to service_role;

comment on function public.try_claim_on_the_clock_ip_budget(text, int, int) is
  'Identifier-independent per-IP fixed-window budget claim for On The Clock. Returns true while within budget, false once exhausted for the window. service_role EXECUTE only; enforced before every Sleeper fan-out.';

-- Deletion-only retention prune for BOTH rate-limit ledgers. Bounded, indexed, safe
-- under concurrent traffic. Returns the total rows deleted.
create or replace function public.cleanup_on_the_clock_rate_limits(
  p_max_age_hours int default 24
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer := 0;
  v_tmp integer;
begin
  delete from public.on_the_clock_ip_budget
   where updated_at < now() - make_interval(hours => p_max_age_hours);
  get diagnostics v_tmp = row_count;
  v_deleted := v_deleted + v_tmp;

  delete from public.on_the_clock_lookup_attempts
   where last_attempt_at < now() - make_interval(hours => p_max_age_hours);
  get diagnostics v_tmp = row_count;
  v_deleted := v_deleted + v_tmp;

  return v_deleted;
end;
$$;

revoke all on function public.cleanup_on_the_clock_rate_limits(int) from public, anon, authenticated;
grant execute on function public.cleanup_on_the_clock_rate_limits(int) to service_role;

comment on function public.cleanup_on_the_clock_rate_limits(int) is
  'Deletion-only retention prune for the On The Clock rate-limit ledgers (ip_budget + lookup_attempts). Returns rows deleted. service_role EXECUTE only; wired into the nightly recalculate-derived cron.';
