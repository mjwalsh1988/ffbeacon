-- Migration 0190: draft_value_settings
--
-- Access matrix:
--   anon          : NO ACCESS  (no policy)
--   authenticated : NO ACCESS  (no policy)
--   service_role  : ALL        (read by the build, written by the admin editor
--                               behind requireAdmin)
--
-- WHY
-- Single pinned row (id = 'global') holding the whole Beacon Steals model config
-- as jsonb: league shape, replacement-level assumptions, the value/points blend
-- per league type, confidence factors, and the category thresholds. Same shape as
-- league_power_pulse_settings, on_the_clock_settings, and faab_calculator_settings.
--
-- Code holds the fallback defaults in lib/draft-value/default-settings.ts, so a
-- missing or unreadable row degrades to a working model rather than an error. The
-- model is tuning, not correctness.
--
-- Saving does NOT fan out a recompute. Bumping settings.modelVersion is what
-- forces the next nightly rebuild to rescore every row, exactly like Power Pulse.

create table if not exists public.draft_value_settings (
  id          text primary key,
  settings    jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  constraint draft_value_settings_single_row check (id = 'global')
);

alter table public.draft_value_settings enable row level security;

drop policy if exists draft_value_settings_service_role_all on public.draft_value_settings;
create policy draft_value_settings_service_role_all
  on public.draft_value_settings
  for all to service_role using (true) with check (true);

insert into public.draft_value_settings (id, settings)
values ('global', '{}'::jsonb)
on conflict (id) do nothing;

comment on table public.draft_value_settings is
  'Single-row (id=global) JSONB model config for Beacon Steals: league shape, replacement levels, the value/points blend, confidence factors, category thresholds. Service-role only; code holds fallback defaults in lib/draft-value/default-settings.ts. Admin-editable from /admin/draft-value.';
