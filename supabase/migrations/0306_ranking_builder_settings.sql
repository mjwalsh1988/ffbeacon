-- Migration 0306: ranking_builder_settings (single-row JSONB config for Beacon
-- Ranker and the community rankings)
--
-- What this backs
--   /tools/custom-rankings (Beacon Ranker) asks a reader one head-to-head
--   question at a time and builds a board from the answers; the nightly
--   community build merges everyone's boards into one ranking per format. Every
--   threshold either one reads lives here: the three-win prompt, the default
--   depths, the guest caps and lifetime, the checkpoint interval, the rate
--   limits, the community eligibility floors and the merge's weights. A
--   threshold like "a board counts once it ranks 50 players" is a product
--   judgement and has to be adjustable without a deploy.
--   lib/ranking-boards/default-settings.ts holds a code fallback for every key
--   so a missing row degrades safely.
--
-- Access matrix
--   anon          : none
--   authenticated : none
--   service_role  : ALL (admin server actions write at /admin/beacon-ranker;
--                   the tool and the nightly build read with the service-role
--                   client, server-side)
--   client writes : BLOCKED
--
-- Shape follows 0249 (manager_pulse_settings) exactly.
--
-- Rollback note (no down migration ships):
--   drop table if exists public.ranking_builder_settings;

create table if not exists public.ranking_builder_settings (
  id text primary key default 'global' check (id = 'global'),
  settings jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

alter table public.ranking_builder_settings enable row level security;

drop policy if exists ranking_builder_settings_service_role_all
  on public.ranking_builder_settings;
create policy ranking_builder_settings_service_role_all
  on public.ranking_builder_settings
  for all
  to service_role
  using (true)
  with check (true);

revoke all on table public.ranking_builder_settings from anon, authenticated;

comment on table public.ranking_builder_settings is
  'Single-row (id=global) JSONB config for Beacon Ranker and the community rankings: three-win prompt, depths, guest caps and lifetime, checkpoint interval, rate limits, community floors and merge weights, and the (unused at launch) community source switch. Service-role only. Code fallbacks in lib/ranking-boards/default-settings.ts. Admin-editable at /admin/beacon-ranker.';
