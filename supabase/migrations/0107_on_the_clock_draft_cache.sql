-- Migration 0107: on_the_clock_draft_cache (one row per Sleeper draft; the shared
-- record + the durable sync lock for the On The Clock tool)
--
-- Access matrix:
--   anon          : SELECT only  (public Sleeper draft data; required for Realtime,
--                   which is RLS-governed, and for the cheap read path)
--   authenticated : SELECT only
--   service_role  : ALL          (writes happen ONLY through the SECURITY DEFINER sync
--                   RPCs and the service-role server route)
--   client writes : BLOCKED (no anon/auth INSERT/UPDATE/DELETE policy exists)
--
-- This is the "public read-only data" pattern from CLAUDE.md. The data is already
-- public on Sleeper; we never join it to a signed-in user's private saved data. The
-- browser can never write a cache row or bypass the cooldown: last_synced_at /
-- sync_locked_until are advanced only by the lock RPCs (migration 0110).
--
-- last_synced_at advances ONLY on a successful sync and drives the 30s cooldown.
-- sync_locked_until is a short (~15s) in-progress lock that blocks two concurrent
-- syncs of the same draft.

create table if not exists public.on_the_clock_draft_cache (
  sleeper_draft_id  text primary key,
  sleeper_league_id text not null,
  season            text not null,
  draft_status      text,                                -- pre_draft | drafting | paused | complete
  draft_type        text,                                -- snake | linear | auction
  pick_count        int  not null default 0,
  metadata          jsonb not null default '{}'::jsonb,  -- full raw Sleeper draft object
  league_users      jsonb,                               -- display names (small)
  rosters           jsonb,                               -- roster_id -> owner + roster players[]
  last_synced_at    timestamptz,                         -- advances only on a SUCCESSFUL sync
  sync_locked_until timestamptz,                         -- short in-progress lock (blocks concurrency)
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_on_the_clock_draft_cache_league
  on public.on_the_clock_draft_cache (sleeper_league_id);
create index if not exists idx_on_the_clock_draft_cache_season
  on public.on_the_clock_draft_cache (season);
create index if not exists idx_on_the_clock_draft_cache_last_synced
  on public.on_the_clock_draft_cache (last_synced_at);
create index if not exists idx_on_the_clock_draft_cache_updated
  on public.on_the_clock_draft_cache (updated_at);

alter table public.on_the_clock_draft_cache enable row level security;

drop policy if exists on_the_clock_draft_cache_select_public on public.on_the_clock_draft_cache;
create policy on_the_clock_draft_cache_select_public on public.on_the_clock_draft_cache
  for select to anon, authenticated using (true);

drop policy if exists on_the_clock_draft_cache_service_role_all on public.on_the_clock_draft_cache;
create policy on_the_clock_draft_cache_service_role_all on public.on_the_clock_draft_cache
  for all to service_role using (true) with check (true);

comment on table public.on_the_clock_draft_cache is
  'Shared per-draft cache for On The Clock: one row per Sleeper draft holding draft metadata, league users, rosters, and the durable sync lock (last_synced_at + sync_locked_until). Public SELECT (public Sleeper data, needed for Realtime); writes only via the SECURITY DEFINER sync RPCs and the service-role server route.';
