-- Migration 0001: format_configs
--
-- Access matrix:
--   anon          : SELECT (read all rows)
--   authenticated : SELECT (read all rows)
--   service_role  : ALL (full CRUD via server-side cron/admin)
--   client writes : BLOCKED
--
-- Pattern: public read-only data per CLAUDE.md RLS policy patterns.

create table if not exists public.format_configs (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  display_name text not null,

  league_type text not null check (league_type in ('redraft','dynasty','keeper')),
  scoring_type text not null check (scoring_type in ('standard','half_ppr','ppr')),
  te_premium_bonus numeric not null default 0,
  is_superflex boolean not null default false,

  is_default boolean not null default false,
  display_order integer,
  is_active boolean not null default true,

  created_at timestamptz not null default now()
);

alter table public.format_configs enable row level security;

drop policy if exists format_configs_select_public on public.format_configs;
create policy format_configs_select_public
  on public.format_configs
  for select
  to anon, authenticated
  using (true);

drop policy if exists format_configs_service_role_all on public.format_configs;
create policy format_configs_service_role_all
  on public.format_configs
  for all
  to service_role
  using (true)
  with check (true);

insert into public.format_configs
  (slug, display_name, league_type, scoring_type, te_premium_bonus, is_superflex, is_default, display_order)
values
  ('redraft-ppr-std',       'Redraft PPR',           'redraft', 'ppr',       0,   false, true,  1),
  ('redraft-half-std',      'Redraft Half PPR',      'redraft', 'half_ppr',  0,   false, false, 2),
  ('redraft-std-std',       'Redraft Standard',      'redraft', 'standard',  0,   false, false, 3),
  ('redraft-ppr-sflex',     'Redraft PPR Superflex', 'redraft', 'ppr',       0,   true,  false, 4),
  ('redraft-ppr-tep',       'Redraft PPR TEP',       'redraft', 'ppr',       0.5, false, false, 5),
  ('dynasty-ppr-std',       'Dynasty PPR',           'dynasty', 'ppr',       0,   false, false, 6),
  ('dynasty-ppr-sflex',     'Dynasty PPR Superflex', 'dynasty', 'ppr',       0,   true,  false, 7),
  ('dynasty-ppr-tep-sflex', 'Dynasty Superflex TEP', 'dynasty', 'ppr',       0.5, true,  false, 8)
on conflict (slug) do nothing;
