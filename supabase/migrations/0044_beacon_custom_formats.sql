-- Migration 0044: beacon_custom_formats (per-user saved custom league formats)
--
-- Access matrix (USER-OWNED data):
--   anon          : none
--   authenticated : SELECT / INSERT / UPDATE / DELETE own rows only (auth.uid() = created_by)
--   service_role  : ALL
--   client writes : own rows only
--
-- A custom format is a FormatDescriptor (scoring + roster). Users save their own;
-- the descriptor is quantized then hashed (descriptor_hash) so near-identical
-- leagues collapse to one hash and share the compute cache (migration 0045).
-- Uniqueness is per owner: two users may independently save the same descriptor.

create table if not exists public.beacon_custom_formats (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id) on delete cascade,
  descriptor jsonb not null,
  descriptor_hash text not null,
  label text,
  created_at timestamptz not null default now(),
  unique (created_by, descriptor_hash)
);

create index if not exists idx_beacon_custom_formats_owner
  on public.beacon_custom_formats (created_by);

alter table public.beacon_custom_formats enable row level security;

drop policy if exists beacon_custom_formats_select_own on public.beacon_custom_formats;
create policy beacon_custom_formats_select_own on public.beacon_custom_formats
  for select to authenticated using (auth.uid() = created_by);

drop policy if exists beacon_custom_formats_insert_own on public.beacon_custom_formats;
create policy beacon_custom_formats_insert_own on public.beacon_custom_formats
  for insert to authenticated with check (auth.uid() = created_by);

drop policy if exists beacon_custom_formats_update_own on public.beacon_custom_formats;
create policy beacon_custom_formats_update_own on public.beacon_custom_formats
  for update to authenticated using (auth.uid() = created_by) with check (auth.uid() = created_by);

drop policy if exists beacon_custom_formats_delete_own on public.beacon_custom_formats;
create policy beacon_custom_formats_delete_own on public.beacon_custom_formats
  for delete to authenticated using (auth.uid() = created_by);

drop policy if exists beacon_custom_formats_service_role_all on public.beacon_custom_formats;
create policy beacon_custom_formats_service_role_all on public.beacon_custom_formats
  for all to service_role using (true) with check (true);

comment on table public.beacon_custom_formats is
  'Per-user saved custom league formats. descriptor_hash is the quantized descriptor hash; unique per owner. User-owned RLS.';
