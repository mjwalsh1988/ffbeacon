-- Migration 0088: beacon_brief_moderation (The Beacon Brief deletion review)
--
-- When a deletion_check job finds that a source post which produced an article
-- has been deleted at the source, it writes a pending row here instead of
-- auto-deleting anything. In the admin Moderation view the admin approves the
-- deletion (unpublish the article + patch the Discord message to a retracted
-- state via a queued discord_patch) or rejects it (keep the article). Nothing is
-- ever auto-deleted.
--
-- Written and read only through the service-role client behind an is_admin gate.
--
-- Access matrix:
--   anon          : NONE
--   authenticated : NONE
--   service_role  : ALL
--   client writes : BLOCKED

create table if not exists public.beacon_brief_moderation (
  id uuid primary key default gen_random_uuid(),
  ingestion_id uuid references public.news_ingestions(id) on delete cascade,
  article_id uuid references public.articles(id) on delete set null,
  type text not null default 'deletion' check (type in ('deletion')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  -- Context for the reviewer (what was detected, when, source response).
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null
);

-- Pending-review queue (admin Moderation page).
create index if not exists idx_beacon_brief_moderation_status
  on public.beacon_brief_moderation (status, created_at desc);

alter table public.beacon_brief_moderation enable row level security;

drop policy if exists beacon_brief_moderation_service_role_all on public.beacon_brief_moderation;
create policy beacon_brief_moderation_service_role_all on public.beacon_brief_moderation
  for all to service_role using (true) with check (true);

comment on table public.beacon_brief_moderation is
  'Deletion-review queue for the Beacon Brief. A detected source-post deletion lands here as pending; the admin approves (unpublish + retract) or rejects (keep). Nothing auto-deleted. service_role-only behind an is_admin admin gate.';
