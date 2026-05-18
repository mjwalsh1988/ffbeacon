-- Migration 0027: league_drafts
--
-- League Sync feature: persists Sleeper draft metadata per league+season so
-- the UI can map (season, original_roster_id) → draft slot number.
--
-- Sleeper publishes one /draft/{draft_id} object per league per season. The
-- slot_to_roster_id field maps slot number (1, 2, 3, …) to the roster that
-- holds that slot. We persist it verbatim and let the read path derive each
-- pick's label (e.g. "1.04") at query time.
--
-- Access matrix:
--   anon          : SELECT
--   authenticated : SELECT
--   service_role  : ALL
--   client writes : BLOCKED

create table if not exists public.league_drafts (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  sleeper_draft_id text not null,
  season integer not null,
  status text,
  type text,
  start_time timestamptz,
  slot_to_roster_id jsonb not null default '{}'::jsonb,
  draft_order jsonb,
  settings jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (sleeper_draft_id),
  unique (league_id, season)
);

create index if not exists idx_league_drafts_league_id on public.league_drafts(league_id);
create index if not exists idx_league_drafts_league_season on public.league_drafts(league_id, season);

alter table public.league_drafts enable row level security;

drop policy if exists league_drafts_select_public on public.league_drafts;
create policy league_drafts_select_public on public.league_drafts
  for select to anon, authenticated using (true);

drop policy if exists league_drafts_service_role_all on public.league_drafts;
create policy league_drafts_service_role_all on public.league_drafts
  for all to service_role using (true) with check (true);

comment on table public.league_drafts is
  'Synced Sleeper draft metadata for the League Sync feature. One row per (league, season). The slot_to_roster_id column drives pick-slot labels (e.g. "1.04") on the roster and transaction views.';
comment on column public.league_drafts.slot_to_roster_id is
  'Map of slot number (string-keyed "1","2",…) to sleeper_roster_id. Drives pick_label rendering.';
comment on column public.league_drafts.metadata is
  'Raw Sleeper /draft/{draft_id} object preserved verbatim at sync time. See CLAUDE.md Original Source Object Preservation rule.';
