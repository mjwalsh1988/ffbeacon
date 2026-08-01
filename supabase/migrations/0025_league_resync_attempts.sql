-- Migration 0025: league_resync_attempts
--
-- Tracks the most recent force-resync attempt per league so the API can
-- enforce a 60-second per-league rate limit. We persist instead of using
-- an in-memory map because the API runs across multiple Next.js server
-- instances; in-memory state would not be shared.
--
-- Access matrix:
--   anon          : NONE
--   authenticated : NONE
--   service_role  : ALL
--   client writes : BLOCKED

create table if not exists public.league_resync_attempts (
  league_id uuid primary key references public.leagues(id) on delete cascade,
  last_attempt_at timestamptz not null default now(),
  -- Auth provenance for audit. user_id is the FF Beacon auth.users.id of
  -- whoever triggered the resync.
  triggered_by_user_id uuid,
  -- "admin" or "commissioner", recorded for auditability.
  triggered_via text
);

alter table public.league_resync_attempts enable row level security;

-- No anon/authenticated policies, table is service-role-only.

drop policy if exists league_resync_attempts_service_role_all on public.league_resync_attempts;
create policy league_resync_attempts_service_role_all on public.league_resync_attempts
  for all to service_role using (true) with check (true);

comment on table public.league_resync_attempts is
  'Per-league throttle ledger for the admin/commissioner force-resync endpoint. service_role-only; clients hit the API which validates auth and rate limit.';
