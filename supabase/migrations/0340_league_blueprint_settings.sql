-- Migration 0340: Team Blueprint settings
--
-- One global jsonb row holding every threshold and weight the Team Blueprint
-- uses (grades, archetypes, calls, the activity gauge, movers, trade strategy,
-- partners, priorities, cache TTL). Same shape as would_you_rather_settings
-- and league_power_pulse_settings. Admin-edited at /admin/league-blueprint,
-- validated server-side by lib/league-blueprint/settings.ts. A missing row is
-- not an error: the code falls back to lib/league-blueprint/default-settings.ts.
--
-- Plan of record: docs/team-blueprint/team-blueprint-plan.md section 7.1.
--
-- ACCESS MATRIX
--
--   role            select   insert   update   delete
--   anon            no       no       no       no
--   authenticated   no       no       no       no
--   service_role    yes      yes      yes      yes
--
-- Settings are read and written only by server code through the admin
-- client; no reader ever needs them.

create table if not exists public.league_blueprint_settings (
  id text primary key default 'global',
  settings jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint league_blueprint_settings_singleton check (id = 'global')
);

alter table public.league_blueprint_settings enable row level security;

drop policy if exists league_blueprint_settings_service_role_all
  on public.league_blueprint_settings;
create policy league_blueprint_settings_service_role_all
  on public.league_blueprint_settings
  for all to service_role
  using (true)
  with check (true);
