-- Migration 0039: beacon_value_bands (format-aware position value bands)
--
-- Access matrix:
--   anon          : none
--   authenticated : none
--   service_role  : ALL (engine reads; admin server actions write via service role)
--   client writes : BLOCKED
--
-- Bands resolve in priority order: descriptor override (custom formats) ->
-- (position, format_config_id) row -> (position, NULL) global default. position
-- is free text (not a 6-value enum) so IDP can be added later as data, not a
-- migration. Skill positions get the full band; K/DEF get a lower band so they
-- never overshadow skill players. Admin-editable from /admin/beacon.
--
-- Uniqueness: one global row per position (format_config_id IS NULL) and one
-- row per (position, format) override, enforced with two partial unique indexes
-- because NULL format_config_id is the global sentinel.

create table if not exists public.beacon_value_bands (
  id uuid primary key default gen_random_uuid(),
  position text not null,
  format_config_id uuid references public.format_configs(id) on delete cascade,
  floor numeric not null,
  ceiling numeric not null,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  check (ceiling >= floor)
);

create unique index if not exists ux_beacon_value_bands_global
  on public.beacon_value_bands (position)
  where format_config_id is null;

create unique index if not exists ux_beacon_value_bands_format
  on public.beacon_value_bands (position, format_config_id)
  where format_config_id is not null;

alter table public.beacon_value_bands enable row level security;

drop policy if exists beacon_value_bands_service_role_all on public.beacon_value_bands;
create policy beacon_value_bands_service_role_all on public.beacon_value_bands
  for all to service_role using (true) with check (true);

-- Global defaults (format_config_id NULL).
insert into public.beacon_value_bands (position, format_config_id, floor, ceiling) values
  ('QB',  null, 0, 10000),
  ('RB',  null, 0, 10000),
  ('WR',  null, 0, 10000),
  ('TE',  null, 0, 10000),
  ('K',   null, 0, 1500),
  ('DEF', null, 0, 1500)
on conflict do nothing;

comment on table public.beacon_value_bands is
  'Format-aware position value bands for FF Beacon. Resolution: descriptor override -> (position, format) -> (position, NULL) global. Admin-editable.';
