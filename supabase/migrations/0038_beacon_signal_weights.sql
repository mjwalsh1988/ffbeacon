-- Migration 0038: beacon_signal_weights (per-signal / per-source tunables)
--
-- Access matrix:
--   anon          : none
--   authenticated : none
--   service_role  : ALL (engine reads; admin server actions write via service role)
--   client writes : BLOCKED
--
-- One row per signal type, optionally scoped to a source slug (source_value is
-- per-source; every other signal is global with source_slug NULL). Holds the
-- weight, confidence cap, enable toggle, and a params jsonb for signal-specific
-- knobs. Admin-editable from /admin/beacon.
--
-- Uniqueness: Postgres treats NULLs as distinct, so a plain unique(signal_type,
-- source_slug) would allow duplicate global rows. We enforce one row per
-- (signal_type, source-or-global) with a unique index over
-- coalesce(source_slug, '').

create table if not exists public.beacon_signal_weights (
  id uuid primary key default gen_random_uuid(),
  signal_type text not null,
  source_slug text,
  weight numeric not null default 1,
  confidence_cap numeric not null default 1 check (confidence_cap >= 0 and confidence_cap <= 1),
  is_enabled boolean not null default true,
  params jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create unique index if not exists ux_beacon_signal_weights_type_source
  on public.beacon_signal_weights (signal_type, coalesce(source_slug, ''));

alter table public.beacon_signal_weights enable row level security;

drop policy if exists beacon_signal_weights_service_role_all on public.beacon_signal_weights;
create policy beacon_signal_weights_service_role_all on public.beacon_signal_weights
  for all to service_role using (true) with check (true);

-- Seeded defaults. source_value is per active value source; the rest are global.
-- ai_adjust ships disabled (master AI toggle also off in beacon_settings).
insert into public.beacon_signal_weights (signal_type, source_slug, weight, confidence_cap, is_enabled) values
  ('source_value',     'ktc',            1, 1, true),
  ('source_value',     'fantasycalc',    1, 1, true),
  ('source_value',     'dynastyprocess', 1, 1, true),
  ('stat_value',       null,             1, 1, true),
  ('stat_performance', null,             1, 1, true),
  ('manual',           null,             1, 1, true),
  ('ai_adjust',        null,             1, 1, false)
on conflict do nothing;

comment on table public.beacon_signal_weights is
  'Per-signal / per-source weights, confidence caps, and enable toggles for the FF Beacon engine. Admin-editable.';
