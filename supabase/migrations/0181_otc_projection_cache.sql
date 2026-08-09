-- Migration 0181: on_the_clock_projection_cache
--
-- Access matrix:
--   anon          : NO ACCESS  (no policy; the payload is served through
--                   /api/on-the-clock/pulse using the service-role client)
--   authenticated : NO ACCESS  (same)
--   service_role  : ALL        (written and read by the server projection builder)
--
-- WHY
-- Draft Pulse, the marginal starting-lineup recommendation engine, and the draft
-- grades all need every board player projected week by week under the LEAGUE'S
-- OWN scoring. That sweep touches player_weekly_projections (18 weeks x ~600
-- players), player_projection_accuracy, and nfl_defense_vs_position, and it runs
-- the same Power Pulse model as lib/power-pulse/project.ts so a number here can
-- never disagree with a number on the Power Pulse page.
--
-- The critical property: the sweep depends ONLY on (scoring settings, season,
-- week window). It does NOT depend on which picks have been made. Two leagues
-- with byte-identical scoring share one row, and a live draft re-rendering on
-- every pick never recomputes it. The per-draft part (filling lineups from the
-- cached per-player numbers) is cheap and lives in on_the_clock_pulse_cache.
--
-- scoring_signature is a stable hash of the normalized scoring map computed in
-- lib/on-the-clock/projection-board.ts. It is an opaque cache key, never parsed.
--
-- This is a derived cache, not an ingestion table, so it carries no `metadata`
-- raw-source column: its provenance is the model version recorded inside payload
-- plus the script/commit that produced it.

create table if not exists public.on_the_clock_projection_cache (
  scoring_signature text not null,
  season            integer not null,
  from_week         integer not null,
  -- { modelVersion, scoringBase, weeks: [...], players: { [playerId]: {...} } }
  payload           jsonb not null default '{}'::jsonb,
  player_count      integer not null default 0,
  computed_at       timestamptz not null default now(),
  primary key (scoring_signature, season, from_week)
);

create index if not exists idx_otc_projection_cache_computed
  on public.on_the_clock_projection_cache (computed_at desc);

alter table public.on_the_clock_projection_cache enable row level security;

drop policy if exists on_the_clock_projection_cache_service_role_all
  on public.on_the_clock_projection_cache;
create policy on_the_clock_projection_cache_service_role_all
  on public.on_the_clock_projection_cache
  for all to service_role using (true) with check (true);

comment on table public.on_the_clock_projection_cache is
  'Per-(scoring signature, season, week window) weekly projection sweep for On The Clock, scored under a league''s own scoring_settings using the Power Pulse model. Shared across every league with identical scoring. Service-role only; served through /api/on-the-clock/pulse.';
