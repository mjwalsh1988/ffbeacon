-- Migration 0211: league_positional_war_cache (positional scarcity per league)
--
-- Positional WAR answers "which positions are worth spending on in THIS
-- league". One row per (league, season, position), six rows for a normal
-- league, because the CURVE is the unit the UI reads. Storing a row per player
-- would be a thousand rows to answer a question the chart asks once.
--
-- Like league_power_pulse_cache and unlike league_power_rankings_cache, this
-- table does NOT vary by value source or by FF Beacon format config. The model
-- is built from Sleeper weekly projections scored under the league's own
-- literal scoring_settings, so there is exactly one answer per league season.
-- Flipping the source toggle on a league page never invalidates it, and
-- `source` is deliberately absent from the fingerprint.
--
-- Draft picks contribute nothing, for the same reason Power Pulse excludes
-- them: a 2028 first cannot start in a lineup.
--
-- `fingerprint` is the exact set of inputs the curve is a pure function of
-- (season, week window, team count, sorted slot multiset, normalized scoring,
-- scoring base, the Power Pulse settings blocks the projection stack reads, the
-- WAR display settings, the model version, and the projections snapshot hour).
-- It is an invalidation key here, and the join key into positional_war_curves
-- on the write path. A commissioner who turns on TE premium at 11pm sees a
-- corrected curve on the next page view rather than up to twelve hours later.
--
-- `curve` holds the plotted records, capped at
-- max(minDisplayDepth, ceil(structural_demand * displayDepthMultiple)).
-- `weekly_diagnostics` holds the per-week seated counts, replacement level,
-- average seated points, deficit, mu_ref and sigma_ref, so the divergence
-- between structural and weekly demand is inspectable without a recompute.
--
-- Access matrix (public read-only derived data pattern):
--   anon          : SELECT
--   authenticated : SELECT
--   service_role  : ALL (pulseLeague / calculate:positional-war writes)
--   client writes : BLOCKED

create table if not exists public.league_positional_war_cache (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  season integer not null,
  position text not null check (position in ('QB','RB','WR','TE','K','DEF')),

  -- Structural demand: how many players at this position this league starts,
  -- from the bye-free merged fill. An integer, not a fraction. Drives the
  -- x-axis, every label, and every sentence of copy.
  structural_demand integer not null,

  -- Averaged across the window, for the footnote and the tooltip.
  replacement_points numeric,
  avg_seated_points numeric,
  deficit numeric,

  -- True when the projectable pool at this position is thinner than the league
  -- starts, so replacement level falls back to the minimum seated points and
  -- the curve understates scarcity. Never a fabricated zero replacement.
  shallow_pool boolean not null default false,

  -- Headline figures as columns, so the rail summary and any sort read them
  -- without unpacking the curve jsonb.
  war_rank_1 numeric,
  -- WAR of the player at positionRank = structural_demand. Deliberately not
  -- zero: replacement is weekly and the axis is structural, so the last starter
  -- beats replacement in most weeks. The chart labels this real value.
  war_at_demand numeric,
  -- First rank where WAR falls below cliffThreshold * war_rank_1.
  cliff_rank integer,

  -- The plotted records. Each entry:
  -- { playerId, sleeperId, slug, name, team, positionRank, war,
  --   pointsAboveReplacement, projectedPointsPerWeek, replacementPointsPerWeek,
  --   weeksProjected }
  curve jsonb not null default '[]'::jsonb,
  -- Per week: { week, seatedCount, replacement, avgSeated, deficit, muRef, sigmaRef }
  weekly_diagnostics jsonb not null default '{}'::jsonb,

  from_week integer not null,
  through_week integer not null,

  fingerprint text not null,
  model_version text not null default 'war-1',
  generated_at timestamptz not null default now(),
  unique (league_id, season, position)
);

create index if not exists idx_league_positional_war_cache_league
  on public.league_positional_war_cache(league_id, season);

alter table public.league_positional_war_cache enable row level security;

drop policy if exists league_positional_war_cache_select_public
  on public.league_positional_war_cache;
create policy league_positional_war_cache_select_public
  on public.league_positional_war_cache
  for select to anon, authenticated using (true);

drop policy if exists league_positional_war_cache_service_role_all
  on public.league_positional_war_cache;
create policy league_positional_war_cache_service_role_all
  on public.league_positional_war_cache
  for all to service_role using (true) with check (true);

comment on table public.league_positional_war_cache is
  'Positional WAR curves for one league season, one row per position. Independent of value source and format config, like league_power_pulse_cache. Written only by pulseLeague and npm run calculate:positional-war.';
