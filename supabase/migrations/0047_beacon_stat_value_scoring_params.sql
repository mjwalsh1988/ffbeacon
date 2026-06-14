-- Migration 0047: seed the K/DEF stat scoring config onto the stat_value weight
--
-- Access matrix (beacon_signal_weights) unchanged from 0038:
--   service_role : ALL ; client : BLOCKED
--
-- stat_value is the only base signal for K and DEF (no external source values
-- them). The per-category point values and the recency weights are tunable
-- knobs, so they live in beacon_signal_weights.params (admin-editable), not as
-- hardcoded engine constants. The producer reads these live and falls back to
-- code defaults only if a key is absent. recency_weights apply to the latest N
-- seasons present, most-recent first, so it never hardcodes a season number.

update public.beacon_signal_weights
set params = jsonb_build_object(
  'kicker', jsonb_build_object(
    'fgm_0_19', 3, 'fgm_20_29', 3, 'fgm_30_39', 3, 'fgm_40_49', 4, 'fgm_50p', 5,
    'xpm', 1, 'fgmiss', -1, 'xpmiss', -1
  ),
  'defense', jsonb_build_object(
    'sack', 1, 'interceptions', 2, 'fum_rec', 2, 'def_td', 6, 'safety', 2, 'blk_kick', 2,
    'pts_allow_0', 10, 'pts_allow_1_6', 7, 'pts_allow_7_13', 4, 'pts_allow_14_20', 1,
    'pts_allow_21_27', 0, 'pts_allow_28_34', -1, 'pts_allow_35p', -4
  ),
  'recency_weights', jsonb_build_array(0.65, 0.35)
)
where signal_type = 'stat_value' and source_slug is null;
