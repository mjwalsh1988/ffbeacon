-- Migration 0054: small positive floor for skill value bands
--
-- Access matrix: inherits beacon_value_bands (service_role writes; no public).
--
-- The deepest skill players normalize to scaled=0 and, with a band floor of 0,
-- rendered as a literal "$0" on the board (a handful per format). No rostered
-- player is truly worth zero, so we raise the global skill floors (QB/RB/WR/TE)
-- to 1. value = floor + scaled*(ceiling-floor), so against a 10000 ceiling this
-- is ~0.01% compression: statistically invisible, but the bottom tier now reads
-- as low single digits instead of $0. K/DEF bands are intentionally left at 0;
-- this only targets the skill pool flagged in the pre-launch audit. Takes effect
-- on the next recompute (engine reads bands live).

update public.beacon_value_bands
  set floor = 1, updated_at = now()
  where format_config_id is null
    and position in ('QB', 'RB', 'WR', 'TE')
    and floor = 0;
