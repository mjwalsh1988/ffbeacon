-- Migration 0363: long_shot_settings (single-row JSONB settings for Long Shot,
-- the daily rarity game). Plan: docs/completed/long-shot/long-shot-plan.md section 15.1.
--
-- Access matrix:
--   anon          : none
--   authenticated : none
--   service_role  : ALL (admin server actions write; the game reads through
--                   the service-role client server-side)
--   client writes : BLOCKED
--
-- Defaults live in code (lib/long-shot/default-settings.ts). A missing row
-- degrades to those defaults, the same shape as signal_scout_settings and
-- would_you_rather_settings. The id is pinned to 'global'. updated_by is set
-- server-side from the verified admin session, never from client input.

create table if not exists public.long_shot_settings (
  id text primary key default 'global' check (id = 'global'),
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

alter table public.long_shot_settings enable row level security;

drop policy if exists long_shot_settings_service_role_all on public.long_shot_settings;
create policy long_shot_settings_service_role_all on public.long_shot_settings
  for all to service_role using (true) with check (true);

revoke all on public.long_shot_settings from anon, authenticated;

comment on table public.long_shot_settings is
  'Single-row (id=global) JSONB settings for Long Shot, the daily rarity game. Service-role only; code fallbacks in lib/long-shot/default-settings.ts. Admin-editable at /admin/long-shot.';
