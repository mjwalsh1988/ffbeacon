-- Migration 0046: player_value_history.formula_offset
--
-- Access matrix (player_value_history) unchanged from 0003/0012:
--   anon          : SELECT
--   authenticated : SELECT
--   service_role  : ALL
--   client writes : BLOCKED
--   (the new column inherits the existing table RLS policies)
--
-- The carried formula offset that keeps silent (formula-induced) FF Beacon
-- changes out of the trend/movement math. Definitions per ffbeacon row:
--   market_value    = base x factor with true-signal manuals in, silent ones out
--   published_value = market_value with silent overrides/deltas applied (stored in value)
--   formula_offset  = published_value - market_value
-- Trends consume (value - formula_offset) = market_value, so a silent step
-- (which moves value and formula_offset together) cancels in the delta math
-- while still changing the displayed value and rank. Every non-ffbeacon row
-- keeps the default 0, so this is a no-op for KTC / FantasyCalc / DynastyProcess.

alter table public.player_value_history
  add column if not exists formula_offset numeric not null default 0;

comment on column public.player_value_history.formula_offset is
  'FF Beacon only: the formula-induced portion of value (published - market). Trends subtract it so silent manual changes do not render as market movement. 0 for all external sources.';
