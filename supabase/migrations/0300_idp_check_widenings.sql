-- Let the IDP positions and the idp123 scoring key into five existing tables.
--
-- Access matrix: unchanged. Every table keeps the policies it already had; this
-- migration only rewrites CHECK constraints.
--
--   nfl_defense_vs_position   position gains DL, LB, DB; scoring gains idp123
--                             (opponent splits for defenders, IDP-118)
--   player_projection_accuracy scoring gains idp123 (defender beat rates, IDP-115)
--   league_positional_war_cache position gains DL, LB, DB (phase 3 curves)
--   positional_war_curves     position gains DL, LB, DB (phase 3 curves)
--   faab_market_priors        position gains DL, LB, DB, keeps 'any' (IDP-124)
--
-- DELIBERATELY NOT TOUCHED: the board-scope CHECK in 0056 and the rankings
-- position CHECK in 0054. Rankings and My Rankings stay offense-only (plan
-- R-18), so widening them would only admit rows nothing should write.
--
-- Widening a CHECK admits new values and rejects nothing that was valid, so no
-- existing row can fail it.
--
-- Plan: docs/idp/idp-guide-and-data-plan.md, task IDP-108.

alter table public.nfl_defense_vs_position
  drop constraint if exists nfl_defense_vs_position_position_check;
alter table public.nfl_defense_vs_position
  add constraint nfl_defense_vs_position_position_check
  check (position in ('QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB'));

alter table public.nfl_defense_vs_position
  drop constraint if exists nfl_defense_vs_position_scoring_check;
alter table public.nfl_defense_vs_position
  add constraint nfl_defense_vs_position_scoring_check
  check (scoring in ('pts_ppr', 'pts_half_ppr', 'pts_std', 'idp123'));

alter table public.player_projection_accuracy
  drop constraint if exists player_projection_accuracy_scoring_check;
alter table public.player_projection_accuracy
  add constraint player_projection_accuracy_scoring_check
  check (scoring in ('pts_ppr', 'pts_half_ppr', 'pts_std', 'idp123'));

alter table public.league_positional_war_cache
  drop constraint if exists league_positional_war_cache_position_check;
alter table public.league_positional_war_cache
  add constraint league_positional_war_cache_position_check
  check (position in ('QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB'));

alter table public.positional_war_curves
  drop constraint if exists positional_war_curves_position_check;
alter table public.positional_war_curves
  add constraint positional_war_curves_position_check
  check (position in ('QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB'));

alter table public.faab_market_priors
  drop constraint if exists faab_market_priors_position_check;
alter table public.faab_market_priors
  add constraint faab_market_priors_position_check
  check (position in ('QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB', 'any'));
