-- Migration 0214: positional_war_curves (cross-league compute sharing)
--
-- Section 6 of the plan established that a Positional WAR curve is a pure
-- function of a short, enumerable list of league inputs, none of which is a
-- roster. Two leagues whose fingerprints match therefore produce byte-identical
-- curves, so the second one can copy six rows instead of reading the whole
-- projectable universe and running W+1 optimal fills.
--
-- This shares the COMPUTE, not the read path. league_positional_war_cache stays
-- denormalized at six rows per league, so every consumer keeps its single
-- query. Storage duplication is about 60KB per league; the pointer read path is
-- deferred on a stated threshold (roughly 10,000 leagues), not on preference.
--
-- THE COLLISION GUARD. The risk was never the maths, it was a normalization bug
-- serving league A's curve to league B with nothing visibly wrong. inputs_digest
-- stores the human-readable inputs rather than the hash. On a hit those nine
-- values are recomputed from the requesting league and compared field by field;
-- any mismatch logs an error, deletes the colliding rows, and falls through to a
-- fresh computation. A tripwire, not a second fingerprint.
--
-- PRUNING. Fingerprints include the projections snapshot hour, so a row is
-- immutable and becomes dead the morning after it is written. The nightly
-- /api/cron/recalculate-derived job deletes rows older than seven days in ONE
-- statement. It does not iterate leagues, so it does not violate the standing
-- rule that the nightly job must not do per-league work.
--
-- Access matrix (service-role-only, unlike league_positional_war_cache):
--   anon          : NONE
--   authenticated : NONE
--   service_role  : ALL
--   client reads  : BLOCKED (nothing in the UI reads this table; a fingerprint
--                   is an opaque key with no reason to be exposed)

create table if not exists public.positional_war_curves (
  fingerprint text not null,
  position text not null check (position in ('QB','RB','WR','TE','K','DEF')),

  structural_demand integer not null,
  replacement_points numeric,
  avg_seated_points numeric,
  deficit numeric,
  shallow_pool boolean not null default false,
  war_rank_1 numeric,
  war_at_demand numeric,
  cliff_rank integer,
  curve jsonb not null default '[]'::jsonb,
  weekly_diagnostics jsonb not null default '{}'::jsonb,
  from_week integer not null,
  through_week integer not null,
  model_version text not null,

  -- The collision guard. Nine human-readable values, compared field by field on
  -- every hit: season, fromWeek, toWeek, teamCount, slots, scoringBase,
  -- scoringUsable, scoringKeyCount, modelVersion.
  inputs_digest jsonb not null,

  -- Diagnostics only. Never read by the model.
  first_league_id uuid references public.leagues(id) on delete set null,
  computed_at timestamptz not null default now(),
  primary key (fingerprint, position)
);

create index if not exists idx_positional_war_curves_computed
  on public.positional_war_curves(computed_at);

alter table public.positional_war_curves enable row level security;

drop policy if exists positional_war_curves_service_role_all
  on public.positional_war_curves;
create policy positional_war_curves_service_role_all
  on public.positional_war_curves
  for all to service_role using (true) with check (true);

comment on table public.positional_war_curves is
  'Positional WAR curves keyed by input fingerprint, consulted on the write path only so two leagues with identical inputs share one computation. Service role only; nothing in the UI reads it. Pruned at seven days by the nightly recalculate-derived cron.';
