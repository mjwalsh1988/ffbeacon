-- Migration 0105: faab_calculator_settings (single-row JSONB settings for the
-- public FAAB strategy calculator)
--
-- Access matrix:
--   anon          : none
--   authenticated : none
--   service_role  : ALL (admin server actions write; public page reads via the
--                   service-role client server-side, mirroring beacon_settings
--                   and the Signal Check settings pattern)
--   client writes : BLOCKED
--
-- The whole calculator is tuned from one editable settings object: user
-- defaults, the playerRatio bid curve, league-depth adjustments, need
-- multipliers, the dynamic FAAB dump mechanic, value-normalization knobs, and
-- the public result copy. The shape is nested (the bid curve is an array of
-- bands), so a single jsonb document is a better fit than the flat key/value
-- beacon_settings table.
--
-- Defaults live in code (lib/faab/default-settings.ts). A missing row degrades
-- to those defaults so the public calculator never breaks, and the admin page
-- renders code defaults until the first save creates the row. The id is pinned
-- to 'global' so there is exactly one settings row.

create table if not exists public.faab_calculator_settings (
  id text primary key default 'global' check (id = 'global'),
  settings jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

alter table public.faab_calculator_settings enable row level security;

drop policy if exists faab_calculator_settings_service_role_all on public.faab_calculator_settings;
create policy faab_calculator_settings_service_role_all on public.faab_calculator_settings
  for all to service_role using (true) with check (true);

comment on table public.faab_calculator_settings is
  'Single-row (id=global) JSONB settings for the public FAAB strategy calculator. Service-role only; code holds fallback defaults in lib/faab/default-settings.ts. Admin-editable from /admin/faab.';
