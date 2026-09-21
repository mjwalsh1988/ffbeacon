-- Power Pulse: chopped (guillotine) leagues answer a different question.
--
-- A chopped league has no bracket. The lowest score in the whole league is
-- eliminated every week and the last team alive wins, so playoff odds, a bye,
-- a title game and last place are all questions the league does not ask.
-- Sleeper still publishes a head to head pairing for one, and every figure
-- Power Pulse derived from that pairing was precise and meaningless.
--
-- The bracket columns (playoff_odds, bye_odds, title_odds, last_place_odds,
-- expected_wins, projected_wins, projected_losses, projected_ties, sos_points,
-- sos_rank, score_schedule, score_schedule_rank) are already nullable, and a
-- chopped league now writes null into every one of them. These four columns
-- carry the answer it does have, from lib/chopped/survival.ts.
--
-- Access matrix, unchanged by this migration and verified against pg_policies
-- after it was applied:
--   league_power_pulse_cache_select_public   SELECT  anon, authenticated
--   league_power_pulse_cache_service_role_all   ALL   service_role
-- Public read, writes through the service role only, which is what every
-- other derived league cache does. The four columns added below are model
-- output like the columns beside them and carry nothing a reader of the
-- league page cannot already see, so no policy changes with them.

alter table public.league_power_pulse_cache
  -- True when this row was scored as a chopped league. It is what tells a
  -- reader that the null bracket columns mean "this league does not have one"
  -- rather than "not computed yet", and the two must never read alike.
  add column if not exists chopped boolean not null default false,
  -- Chance this roster is the lowest score in the league this week and goes
  -- out. 0 to 1.
  add column if not exists chop_odds_this_week numeric,
  -- Chance this roster is the last team standing. 0 to 1.
  add column if not exists survive_all_odds numeric,
  -- Weeks this roster lasts from here, averaged over the simulation runs.
  add column if not exists expected_weeks_alive numeric;

comment on column public.league_power_pulse_cache.chopped is
  'Scored as a chopped (guillotine) league: the bracket columns are null because the league has no bracket, not because they are pending.';
comment on column public.league_power_pulse_cache.chop_odds_this_week is
  'Chopped only. Chance of being the lowest score in the league this week, 0 to 1.';
comment on column public.league_power_pulse_cache.survive_all_odds is
  'Chopped only. Chance of being the last team standing, 0 to 1.';
comment on column public.league_power_pulse_cache.expected_weeks_alive is
  'Chopped only. Weeks survived from the current week, averaged over the simulation runs.';
