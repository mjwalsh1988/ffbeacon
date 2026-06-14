-- Migration 0049: seed the stat_performance config onto its weight row
--
-- Access matrix (beacon_signal_weights) unchanged from 0038:
--   service_role : ALL ; client : BLOCKED
--
-- stat_performance is a small, bounded recent-form adjustment for skill players
-- (year-over-year per-game trajectory). The knobs are admin-tunable via
-- beacon_signal_weights.params; the producer falls back to code defaults if a
-- key is absent. Scoring for the trajectory uses the default PPR skill scoring
-- unless a "scoring" object is added here later.
--   sensitivity     : maps trajectory ratio -> adjustment before the cap
--   cap             : max magnitude of the adjustment in each direction
--   min_baseline_ppg: ignore trajectory when the prior-season baseline is tiny
--   full_games      : games at which the confidence damping reaches 1.0

update public.beacon_signal_weights
set params = jsonb_build_object(
  'sensitivity', 0.5,
  'cap', 0.10,
  'min_baseline_ppg', 5,
  'full_games', 14
)
where signal_type = 'stat_performance' and source_slug is null;
