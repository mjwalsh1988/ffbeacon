-- Migration 0188: draft_selections
--
-- Access matrix:
--   anon          : NO ACCESS  (no policy)
--   authenticated : NO ACCESS  (no policy)
--   service_role  : ALL        (written by the two sync paths and the one-time
--                               backfill; read only by server-side aggregations)
--
-- WHY THIS TABLE EXISTS
-- We already sync real drafts through two unrelated paths and neither of them
-- keeps a durable record a market model can read:
--
--   On The Clock  writes on_the_clock_pick_cache, a LIVE ROOM cache. Rows are
--                 deleted when a commissioner reverts a pick, the draft context
--                 (format, pool, team count) lives in a different table, and the
--                 whole thing is shaped for one draft at a time.
--   League Pulse  writes league_drafts, which stores a draft's SETTINGS and never
--                 stored a single pick. 99 completed drafts had no picks anywhere.
--
-- draft_selections is the canonical ledger: one row per pick ever seen, from any
-- path, with the draft context denormalized onto the row so the ADP build is one
-- indexed scan instead of a three-table join per cohort. It does NOT replace
-- on_the_clock_pick_cache, which stays the live-room working set (and stays the
-- Realtime source).
--
-- WHY IT IS SERVICE-ROLE ONLY
-- Nothing client-side reads it. Every consumer is a server-side aggregation that
-- publishes its OUTPUT (draft_market_adp, then draft_value_targets) rather than
-- these rows. The table carries picked_by (a Sleeper user id) and the full raw
-- pick object, so least privilege beats the "public Sleeper data" default that
-- on_the_clock_pick_cache needs for Realtime.
--
-- format_slug / player_pool are resolved ONCE at write time from the league
-- object the sync already holds, using lib/sleeper-to-format.ts and
-- lib/on-the-clock/draft-derive.ts inferPlayerPool. A draft whose format cannot
-- be derived is still stored with a null format_slug; it simply never joins an
-- ADP cohort. Null is "we do not know", never a guess.
--
-- metadata preserves the raw Sleeper pick object per the Data Architecture
-- Principles in CLAUDE.md.

create table if not exists public.draft_selections (
  id                uuid primary key default gen_random_uuid(),

  sleeper_draft_id  text not null,
  pick_no           integer not null,
  round             integer,
  draft_slot        integer,
  roster_id         integer,
  picked_by         text,

  sleeper_player_id text,
  player_id         uuid references public.players (id) on delete set null,
  is_keeper         boolean not null default false,

  -- Draft context, denormalized. Written once, never recomputed per read.
  sleeper_league_id text,
  season            integer not null,
  draft_type        text,
  draft_status      text,
  format_slug       text,
  player_pool       text,
  teams             integer,
  rounds            integer,
  drafted_at        timestamptz,

  ingest_source     text not null,
  metadata          jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint draft_selections_unique_pick unique (sleeper_draft_id, pick_no),
  constraint draft_selections_pick_no_positive check (pick_no > 0),
  constraint draft_selections_ingest_source_check
    check (ingest_source in ('on_the_clock', 'league_pulse', 'backfill')),
  constraint draft_selections_player_pool_check
    check (player_pool is null or player_pool in ('everyone', 'rookies'))
);

-- The ADP build scans one cohort at a time: (format, pool, season).
create index if not exists idx_draft_selections_cohort
  on public.draft_selections (format_slug, player_pool, season)
  where format_slug is not null and player_id is not null;

create index if not exists idx_draft_selections_player
  on public.draft_selections (player_id);

create index if not exists idx_draft_selections_draft
  on public.draft_selections (sleeper_draft_id);

alter table public.draft_selections enable row level security;

drop policy if exists draft_selections_service_role_all on public.draft_selections;
create policy draft_selections_service_role_all
  on public.draft_selections
  for all to service_role using (true) with check (true);

comment on table public.draft_selections is
  'Canonical ledger of every pick in every draft we have synced, from On The Clock or League Pulse. Draft context (format, pool, teams, rounds) is denormalized onto each row so the ADP build is one indexed scan. Does NOT replace on_the_clock_pick_cache, which remains the live-room cache and the Realtime source. service_role only: no client reads it, and it carries Sleeper user ids plus the raw pick object.';

comment on column public.draft_selections.format_slug is
  'The FF Beacon format_configs slug this draft maps to, resolved once at write time from the league object. Null means we could not derive it; such rows never join an ADP cohort.';

comment on column public.draft_selections.player_pool is
  'everyone or rookies, from lib/on-the-clock/draft-derive.ts inferPlayerPool. Rookie drafts are graded against a different market than startups.';

comment on column public.draft_selections.ingest_source is
  'Which path wrote the row: on_the_clock, league_pulse, or backfill. Provenance only; the unique constraint on (sleeper_draft_id, pick_no) means the same draft never double-counts regardless of which path saw it first.';
