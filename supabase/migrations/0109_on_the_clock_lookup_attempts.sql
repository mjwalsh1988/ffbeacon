-- Migration 0109: on_the_clock_lookup_attempts
--
-- Durable abuse guard for the On The Clock leagues lookup route (the Sleeper fan-out
-- surface). The route resolves a username -> leagues -> active-draft filter, which can
-- hit Sleeper several times. A rotated-username attack must not fan out unbounded
-- Sleeper calls across server instances, so we persist the throttle ledger here rather
-- than in Vercel memory (in-memory state is not shared across instances).
--
-- Access matrix:
--   anon          : NONE
--   authenticated : NONE
--   service_role  : ALL
--   client writes : BLOCKED
--
-- The key is a normalized "ip:username" string written by the SECURITY DEFINER RPC
-- try_claim_on_the_clock_lookup (migration 0111). Clients never touch this table; they
-- hit the leagues route, which validates input and calls the RPC.

create table if not exists public.on_the_clock_lookup_attempts (
  key             text primary key,
  last_attempt_at timestamptz not null default now()
);

alter table public.on_the_clock_lookup_attempts enable row level security;

-- No anon/authenticated policies -- table is service-role-only.

drop policy if exists on_the_clock_lookup_attempts_service_role_all on public.on_the_clock_lookup_attempts;
create policy on_the_clock_lookup_attempts_service_role_all on public.on_the_clock_lookup_attempts
  for all to service_role using (true) with check (true);

comment on table public.on_the_clock_lookup_attempts is
  'Durable per-(ip, username) throttle ledger for the On The Clock leagues lookup route. service_role-only; written atomically by try_claim_on_the_clock_lookup. Replaces in-memory rate limiting so a rotated-username fan-out attack is bounded across server instances.';
