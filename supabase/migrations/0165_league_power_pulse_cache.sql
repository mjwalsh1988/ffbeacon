-- Migration 0165: league_power_pulse_cache (competitive strength per team)
--
-- Power Pulse is the expected-performance sibling of league_power_rankings_cache.
-- Where the value cache asks "who owns the most assets", Power Pulse asks "who
-- is going to win games from here".
--
-- Key difference from league_power_rankings_cache, and the reason this table is
-- ~20x smaller: Power Pulse does NOT vary by value source or by FF Beacon format
-- config. It is computed from Sleeper's weekly projections scored under the
-- league's own literal scoring_settings, so there is exactly one answer per team
-- per season. Switching the source toggle on the league page never invalidates
-- it. Draft picks are excluded entirely: a 2028 first is an asset, not a starter.
--
-- Naming: `league_power_pulse_` shares the `league_power_` stem with
-- league_power_rankings_cache so the two ranking systems sort together.
--
-- `weekly` carries one entry per remaining week (opponent, projected mean and
-- spread, win probability) so the UI can render the schedule preview without a
-- second query. `drivers` carries the plain-language reasons behind the score,
-- which is what makes the number defensible instead of a black box.
--
-- Access matrix (public read-only derived data pattern):
--   anon          : SELECT
--   authenticated : SELECT
--   service_role  : ALL (pulseLeague / calculate:power-pulse writes)
--   client writes : BLOCKED

create table if not exists public.league_power_pulse_cache (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  roster_id uuid not null references public.rosters(id) on delete cascade,
  season integer not null,
  -- Last completed NFL week reflected in this row. 0 in the preseason.
  through_week integer not null default 0,

  -- The headline number, 1 to 99, normalized within this league.
  power_pulse numeric not null,
  pulse_rank integer,

  -- Component sub-scores, each 1 to 99 within the league, plus their ranks.
  -- Stored as columns (not only inside components jsonb) so the table can be
  -- sorted and filtered on any single component without jsonb extraction.
  score_points numeric,
  score_points_rank integer,
  score_schedule numeric,
  score_schedule_rank integer,
  score_depth numeric,
  score_depth_rank integer,
  score_form numeric,
  score_form_rank integer,

  -- Raw, human-meaningful outputs behind the normalized scores.
  expected_points_per_week numeric,
  expected_points_stdev numeric,
  expected_wins numeric,
  projected_wins numeric,
  projected_losses numeric,
  projected_ties numeric,

  -- Simulation outputs, 0 to 1.
  playoff_odds numeric,
  bye_odds numeric,
  title_odds numeric,
  last_place_odds numeric,

  -- Strength of schedule: average opponent projected points per remaining week.
  -- sos_rank 1 = hardest remaining schedule.
  sos_points numeric,
  sos_rank integer,

  -- How much of the optimal lineup the manager actually starts, 0 to 1.
  -- Null until there is a set lineup to grade against.
  lineup_efficiency numeric,
  lineup_efficiency_rank integer,
  -- Points per week left on the bench by suboptimal lineups.
  lineup_points_lost numeric,

  -- Average recency-weighted reliability of the team's projected starters.
  reliability_score numeric,
  reliability_rank integer,

  -- Per-week detail: [{ week, opponentRosterId, mean, sigma, winProb, isFinal }]
  weekly jsonb not null default '[]'::jsonb,
  -- Plain-language reasons: [{ label, detail, tone }]
  drivers jsonb not null default '[]'::jsonb,
  -- Full component breakdown, including per-position projected output.
  components jsonb not null default '{}'::jsonb,

  -- Bumped whenever the scoring math changes, so stale rows are identifiable.
  model_version text not null default 'pp-1',
  generated_at timestamptz not null default now(),
  unique (league_id, roster_id, season)
);

create index if not exists idx_league_power_pulse_cache_league
  on public.league_power_pulse_cache(league_id, season);

alter table public.league_power_pulse_cache enable row level security;

drop policy if exists league_power_pulse_cache_select_public on public.league_power_pulse_cache;
create policy league_power_pulse_cache_select_public on public.league_power_pulse_cache
  for select to anon, authenticated using (true);

drop policy if exists league_power_pulse_cache_service_role_all on public.league_power_pulse_cache;
create policy league_power_pulse_cache_service_role_all on public.league_power_pulse_cache
  for all to service_role using (true) with check (true);

comment on table public.league_power_pulse_cache is
  'Per-team expected competitive performance (Power Pulse) for one league season. Independent of value source and format config, unlike league_power_rankings_cache. Written only by pulseLeague and npm run calculate:power-pulse.';
