-- Migration 0249: manager_pulse_settings (single-row JSONB config for Manager Pulse)
--
-- What this backs
--   /tools/manager-pulse reads a Sleeper handle's public history across several
--   seasons and reports what kind of manager that person is. Every limit that
--   shapes that work (how many seasons, how many leagues one run may queue, how
--   long a report caches, how big a sample has to be before we make a claim)
--   lives here rather than in code.
--
--   That is a hard rule for this feature, not a preference. A sample floor is a
--   product judgement about when a number stops being noise, and a judgement
--   like that has to be adjustable without a deploy. lib/manager-pulse/
--   default-settings.ts holds a code fallback for every key so a missing row
--   degrades safely, NOT so a number can quietly live in two places.
--
-- Access matrix
--   anon          : none
--   authenticated : none
--   service_role  : ALL (admin server actions write; the tool reads through the
--                   service-role client server-side, behind its own auth gate)
--   client writes : BLOCKED
--
-- Shape follows the 0106 template exactly: id pinned to 'global', settings as one
-- jsonb document because the config is nested, updated_by server-set from the
-- verified admin session and never from client input.
--
-- Rollback note (no down migration ships):
--   drop table if exists public.manager_pulse_settings;

create table if not exists public.manager_pulse_settings (
  id text primary key default 'global' check (id = 'global'),
  settings jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

alter table public.manager_pulse_settings enable row level security;

drop policy if exists manager_pulse_settings_service_role_all
  on public.manager_pulse_settings;
create policy manager_pulse_settings_service_role_all
  on public.manager_pulse_settings
  for all
  to service_role
  using (true)
  with check (true);

revoke all on table public.manager_pulse_settings from anon, authenticated;

comment on table public.manager_pulse_settings is
  'Single-row (id=global) JSONB config for Manager Pulse: season window, capture caps, cooldowns, cache TTLs, sample floors, display caps and modelVersion. Service-role only. Code fallbacks in lib/manager-pulse/default-settings.ts. Admin-editable at /admin/manager-pulse.';
