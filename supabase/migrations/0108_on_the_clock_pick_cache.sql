-- Migration 0108: on_the_clock_pick_cache (one row per draft pick; the Realtime source)
--
-- Access matrix:
--   anon          : SELECT only  (public Sleeper pick data; required for Realtime,
--                   which is RLS-governed)
--   authenticated : SELECT only
--   service_role  : ALL          (writes only via the SECURITY DEFINER sync flow /
--                   service-role server route)
--   client writes : BLOCKED (no anon/auth INSERT/UPDATE/DELETE policy exists)
--
-- One row per pick, unique by (sleeper_draft_id, pick_no). player_id is resolved ONCE
-- at sync time (server-side, partial-tolerant, DST/K-aware) and stored here, so neither
-- the read path nor Realtime re-runs the mapping per viewer. metadata preserves the raw
-- Sleeper pick object (first/last/position/team/amount) so unmapped picks still render
-- from cached fields with no value chip.
--
-- Rows cascade-delete with their parent draft_cache row, so cleanup of a draft removes
-- its picks automatically.

create table if not exists public.on_the_clock_pick_cache (
  sleeper_draft_id  text not null
                      references public.on_the_clock_draft_cache (sleeper_draft_id)
                      on delete cascade,
  pick_no           int  not null,
  round             int,
  draft_slot        int,
  roster_id         int,
  picked_by         text,                                 -- Sleeper user id (public draft data)
  sleeper_player_id text,
  player_id         uuid references public.players (id),  -- resolved at sync; null if unmapped
  is_keeper         boolean not null default false,
  metadata          jsonb,                                -- raw pick (first/last/position/team/amount)
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  primary key (sleeper_draft_id, pick_no)
);

-- The pk leads with sleeper_draft_id, so it already covers the Realtime filter +
-- read path (sleeper_draft_id=eq.{draft_id}). An explicit index is redundant but
-- harmless to leave out; we add one on player_id for the unmapped-id admin panel.
create index if not exists idx_on_the_clock_pick_cache_player
  on public.on_the_clock_pick_cache (player_id);

alter table public.on_the_clock_pick_cache enable row level security;

drop policy if exists on_the_clock_pick_cache_select_public on public.on_the_clock_pick_cache;
create policy on_the_clock_pick_cache_select_public on public.on_the_clock_pick_cache
  for select to anon, authenticated using (true);

drop policy if exists on_the_clock_pick_cache_service_role_all on public.on_the_clock_pick_cache;
create policy on_the_clock_pick_cache_service_role_all on public.on_the_clock_pick_cache
  for all to service_role using (true) with check (true);

comment on table public.on_the_clock_pick_cache is
  'Shared per-pick cache for On The Clock: one row per draft pick (unique by sleeper_draft_id+pick_no), cascade-deleted with its draft. player_id resolved once at sync time. Public SELECT (public Sleeper data, needed for Realtime); writes only via the service-role sync flow. This table is the Postgres Changes Realtime source.';
