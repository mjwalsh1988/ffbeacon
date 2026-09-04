-- Migration 0252: manager_pulse_cache (the computed report)
--
-- One row per (sleeper_user_id, season_from, season_to, model_version). The
-- window is part of the key because a four-season report and a six-season report
-- are different answers to different questions, and the model version is part of
-- it because bumping the version has to invalidate every stored report without
-- deleting anything, exactly the way Power Pulse does it.
--
-- The report is stored whole, as one jsonb document, rather than shredded into
-- columns. It is written once and read once, never queried across, and its shape
-- is owned by lib/manager-pulse/types.ts. Shredding it would put the same
-- structure in two places and guarantee they drift.
--
-- league_seasons_counted is lifted out as a real column because it is the one
-- fact the admin cache page needs about every row at once, and pulling a
-- multi-kilobyte document to read one integer is not a page, it is a download.
--
-- Access matrix
--   anon          : none
--   authenticated : none
--   service_role  : ALL
--   client writes : BLOCKED
--
--   Deliberately closed to authenticated as well. The page reads this in a
--   server component, with the service-role client, behind its own sign-in gate.
--   A browser never touches this table, so there is nothing to be gained by
--   opening it and something to lose: a report names a real person's habits, and
--   an open SELECT would let any signed-in reader enumerate every manager we
--   have ever profiled.
--
-- Rollback note (no down migration ships):
--   drop table if exists public.manager_pulse_cache;

create table if not exists public.manager_pulse_cache (
  id uuid primary key default gen_random_uuid(),
  sleeper_user_id text not null,
  sleeper_handle text,
  season_from int not null,
  season_to int not null,
  model_version text not null,
  report jsonb not null,
  fingerprint text not null,
  league_seasons_counted int not null default 0,
  dynasty_seasons_counted int not null default 0,
  redraft_seasons_counted int not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now(),
  constraint manager_pulse_cache_window check (season_to >= season_from)
);

comment on table public.manager_pulse_cache is
  'Computed Manager Pulse reports, keyed by manager, season window and model version. Service-role only: the page reads it in a server component behind its own sign-in gate, so no browser ever touches this table.';

create unique index if not exists manager_pulse_cache_key
  on public.manager_pulse_cache (sleeper_user_id, season_from, season_to, model_version);

-- The admin cache page: newest first, and "everything on a superseded version".
create index if not exists manager_pulse_cache_version_idx
  on public.manager_pulse_cache (model_version, generated_at desc);

alter table public.manager_pulse_cache enable row level security;

drop policy if exists manager_pulse_cache_service_role_all on public.manager_pulse_cache;
create policy manager_pulse_cache_service_role_all
  on public.manager_pulse_cache
  for all
  to service_role
  using (true)
  with check (true);

revoke all on table public.manager_pulse_cache from anon, authenticated;
