-- 0237: opponent-adjusted and shrunk multipliers on nfl_defense_vs_position.
--
-- ACCESS MATRIX (unchanged by this migration, re-verified after it)
--   anon           SELECT only
--   authenticated  SELECT only
--   service_role   ALL
--   Existing policies: nfl_defense_vs_position_select_public (SELECT to anon,
--   authenticated) and nfl_defense_vs_position_service_role_all (ALL to
--   service_role). This migration adds columns only; it creates no policy and
--   drops none, and RLS stays enabled.
--
-- WHY THREE NEW COLUMNS RATHER THAN CHANGING ONE
--
-- `multiplier` today is raw points allowed per game over the league average.
-- Two separate things are wrong with applying it directly, and each needs its
-- own column so the arithmetic stays checkable, exactly the way
-- player_projection_accuracy keeps `mean_ratio` (what we measured) apart from
-- `shrunk_multiplier` (what we apply).
--
-- 1. SCHEDULE BIAS. Raw allowance credits a defense for the offenses it
--    happened to face. A defense that drew the six best offenses in the league
--    looks generous and a defense that drew the six worst looks stingy, and
--    neither conclusion is about the defense.
--    `adjusted_points_allowed_per_game` and `adjusted_multiplier` are the same
--    measurement after each game is normalised by the offense that produced it.
--
-- 2. THE SIGNAL BARELY PERSISTS. Measured on this table on 2026-09-01, the year
--    over year correlation of the raw multiplier from 2024 into 2025, all 32
--    teams, PPR, was:
--
--        DEF 0.319   RB 0.243   TE 0.152   K 0.147   QB 0.107   WR -0.097
--
--    Published work agrees (4for4 measured QB 0.27, RB 0.23 and "very little"
--    for receivers). We were applying a plus or minus 15% swing to all six
--    positions equally, including one that measured NEGATIVE in our own data.
--    `shrunk_multiplier` is `adjusted_multiplier` pulled toward 1.0 by that
--    position's measured reliability and by sample size. It is what every
--    reader applies from PE-T013 onward.
--
-- `multiplier` and `points_allowed_per_game` keep their current meaning as the
-- audit trail. Nothing reads them after this build except the admin view, and
-- that is deliberate: anyone can re-derive the applied number from the measured
-- one and check this file's arithmetic against the table.
--
-- All three columns are nullable with no default. A null means the calc has not
-- run since this migration, which is a fact worth being able to see, and is not
-- the same as a neutral 1.0.

alter table public.nfl_defense_vs_position
  add column if not exists adjusted_points_allowed_per_game numeric,
  add column if not exists adjusted_multiplier numeric,
  add column if not exists shrunk_multiplier numeric;

comment on column public.nfl_defense_vs_position.points_allowed_per_game is
  'Raw startable fantasy points this defense allowed at this position per game faced. The measurement, not the adjustment.';

comment on column public.nfl_defense_vs_position.multiplier is
  'Raw points_allowed_per_game over the league average, clamped. The audit trail. Readers apply shrunk_multiplier instead.';

comment on column public.nfl_defense_vs_position.adjusted_points_allowed_per_game is
  'points_allowed_per_game after each game is normalised by the offense that produced it, removing the bias of which offenses this defense happened to face.';

comment on column public.nfl_defense_vs_position.adjusted_multiplier is
  'adjusted_points_allowed_per_game over the league average, clamped. Schedule bias removed, sample size and positional reliability not yet applied.';

comment on column public.nfl_defense_vs_position.shrunk_multiplier is
  'What readers apply. adjusted_multiplier pulled toward 1.0 by this position''s measured year over year reliability and by games sampled. Null means the calc has not run since migration 0237.';
