-- Migration 0081: discord_webhooks (System Settings area; used by The Beacon Brief)
--
-- Stores the Discord incoming-webhook endpoints the site can post through. The
-- "Beacon Relay" bot identity (username + avatar) is applied per-message in
-- code, not stored here. Lives in the System Settings admin area and is
-- selectable by the Beacon Brief settings.
--
-- The webhook URL is a secret: it is NEVER seeded in a migration. After this
-- migration runs, the first row (label "News & Injuries") is inserted manually
-- via MCP so the URL never lands in version control. Written and read only
-- through the service-role client behind an is_admin gate; there is no
-- client-facing access path, so the table is service-role-only.
--
-- Access matrix:
--   anon          : NONE
--   authenticated : NONE
--   service_role  : ALL
--   client writes : BLOCKED

create table if not exists public.discord_webhooks (
  id uuid primary key default gen_random_uuid(),
  -- Human label so the admin knows which Discord channel this points at.
  label text not null,
  -- The Discord incoming-webhook URL (secret). Inserted via MCP, not seeded.
  url text not null,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Active-webhook lookups for the Beacon Brief settings selector.
create index if not exists idx_discord_webhooks_active
  on public.discord_webhooks (is_active, created_at desc);

alter table public.discord_webhooks enable row level security;

-- No anon/authenticated policies. The admin panel reads/writes through the
-- service-role client behind an is_admin gate.
drop policy if exists discord_webhooks_service_role_all on public.discord_webhooks;
create policy discord_webhooks_service_role_all on public.discord_webhooks
  for all to service_role using (true) with check (true);

comment on table public.discord_webhooks is
  'Discord incoming-webhook endpoints the site posts through (Beacon Relay identity applied in code). Secret URL inserted via MCP, never seeded. service_role-only behind an is_admin admin gate.';
