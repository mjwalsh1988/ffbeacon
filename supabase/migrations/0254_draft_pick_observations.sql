-- Migration 0254: draft_pick_observations (per-pick draft timing, measured)
--
-- The problem this solves
--   Sleeper publishes no timestamp on a draft pick. Not in
--   GET /v1/draft/{id}/picks, and not on the DraftPick type in its GraphQL
--   schema either; both were checked. The only timing Sleeper gives is on the
--   DRAFT: start_time, last_picked and settings.pick_timer, which together yield
--   an average seconds-per-pick for the whole room. That is a fact about the
--   draft, not about any one manager, and Manager Pulse labels it as such.
--
--   The one honest way to get a per-manager number is to measure it ourselves.
--   On The Clock already polls live drafts, so the first moment we SEE a pick is
--   a real observation of when it happened, accurate to within one poll
--   interval. This table is where that observation is kept.
--
--   observation_gap_ms is the poll interval at capture time. It is the error bar,
--   it is stored per row because the interval can change, and every figure the
--   report derives from these rows quotes it. A measurement without its accuracy
--   is a guess wearing a number.
--
--   was_autopick comes from Sleeper's draft_autopickers GraphQL query, which
--   answers unauthenticated but returns an empty list the moment a draft
--   completes. It is capture-at-the-time or never.
--
-- This is an ingestion table, so it carries `metadata` holding the raw pick
-- object as received, per the project's original-source-preservation rule.
--
-- Access matrix
--   anon          : none
--   authenticated : none
--   service_role  : ALL (written by the On The Clock live sync, read by the
--                   Manager Pulse engine and the admin coverage page)
--   client writes : BLOCKED
--
-- Rollback note (no down migration ships):
--   drop table if exists public.draft_pick_observations;

create table if not exists public.draft_pick_observations (
  id uuid primary key default gen_random_uuid(),
  sleeper_draft_id text not null,
  pick_no int not null,
  round int,
  draft_slot int,
  roster_id int,
  -- Sleeper user id of whoever made the pick. This is the join key to a manager.
  picked_by text,
  sleeper_player_id text,
  season int,
  -- The first moment we observed this pick existing.
  first_seen_at timestamptz not null default now(),
  -- The poll interval in force when we observed it: the error bar on
  -- (this pick's first_seen_at minus the previous pick's).
  observation_gap_ms int,
  was_autopick boolean,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint draft_pick_observations_pick_no_sane check (pick_no > 0),
  constraint draft_pick_observations_gap_sane check (
    observation_gap_ms is null or observation_gap_ms >= 0
  )
);

comment on table public.draft_pick_observations is
  'Measured per-pick draft timing. Sleeper publishes no pick timestamp anywhere, so first_seen_at is our own observation from the On The Clock live poller and observation_gap_ms is its error bar. Written only by the live sync path. Service-role only.';

comment on column public.draft_pick_observations.observation_gap_ms is
  'Poll interval at capture time, in ms. The accuracy of any elapsed time derived from first_seen_at. Every figure the report builds from these rows states it.';

-- A pick is observed once. A second sighting is the same pick, not a new one.
create unique index if not exists draft_pick_observations_unique
  on public.draft_pick_observations (sleeper_draft_id, pick_no);

-- The engine's read: every observation for one manager.
create index if not exists draft_pick_observations_picker_idx
  on public.draft_pick_observations (picked_by, first_seen_at desc)
  where picked_by is not null;

-- Ordering the picks of one draft to difference consecutive times.
create index if not exists draft_pick_observations_draft_idx
  on public.draft_pick_observations (sleeper_draft_id, pick_no);

-- The admin coverage page: how much have we actually got, by season.
create index if not exists draft_pick_observations_season_idx
  on public.draft_pick_observations (season, first_seen_at desc);

alter table public.draft_pick_observations enable row level security;

drop policy if exists draft_pick_observations_service_role_all
  on public.draft_pick_observations;
create policy draft_pick_observations_service_role_all
  on public.draft_pick_observations
  for all
  to service_role
  using (true)
  with check (true);

revoke all on table public.draft_pick_observations from anon, authenticated;
