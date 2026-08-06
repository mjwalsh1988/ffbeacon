-- Migration 0174: Signal Check consolidation quality settings
--
-- Adds the knobs for the consolidation pass (lib/trade-quality.ts) and turns
-- the legacy pile-on OFF, because the two mechanisms discount the same package
-- and running both charges it twice.
--
-- Why this exists: adding trade values up says three depth pieces worth 2,000
-- each equal one player worth 6,000. Managers know they do not, which is why an
-- "even" package offer usually gets refused. The quality pass scores each asset
-- on a curve that rises faster than its value, discounts the tail of a package,
-- and reports the difference as a visible Value adjustment line rather than
-- quietly rewriting anyone's value.
--
-- Every coefficient here is admin-editable so the model can be recalibrated
-- against the regression set (signal_check_regression_cases) without a deploy.
-- Code fallbacks live in lib/trade-quality.ts DEFAULT_TRADE_QUALITY_CONFIG and
-- lib/signal-check/settings.ts DEFAULT_SETTINGS, so a missing row degrades to
-- the same number rather than to undefined.
--
-- Access matrix: unchanged from beacon_settings (service-role ALL only). Admin
-- edits go through the existing requireAdmin server actions, and the Signal
-- Check settings page picks these rows up automatically via its
-- category LIKE 'signal_check%' query.

insert into public.beacon_settings (key, value, value_type, category, label, description) values
  ('signal_check_quality_enabled',              'true'::jsonb,   'boolean', 'signal_check_quality', 'Consolidation scoring enabled',        'When on, one premium asset outranks a package of lesser pieces that merely adds up to the same value.'),
  ('signal_check_quality_label',                '"Value adjustment"'::jsonb, 'string', 'signal_check_quality', 'Adjustment row label',    'Row label shown next to the consolidation credit on a trade result.'),
  ('signal_check_quality_template',             '"Side {side} carries the more concentrated package, so the smaller pieces on the other side, the ones worth under half the best asset in the deal, count for less than their face value."'::jsonb, 'string', 'signal_check_quality', 'Adjustment wording template', 'Sentence added to the explanation when a consolidation credit applies. Placeholder: {side}. Keep it true of every trade that fires an adjustment: the credited side does not always give up more total value.'),
  ('signal_check_quality_base_weight',          '0.1'::jsonb,    'number',  'signal_check_quality', 'Base weight',                          'Share of its own value every asset collects, however small it is. Reference model: 0.10.'),
  ('signal_check_quality_scale_weight',         '0.05'::jsonb,   'number',  'signal_check_quality', 'Pool scale weight',                    'Weight on how big an asset is against the whole value pool. Reference model: 0.05.'),
  ('signal_check_quality_scale_exponent',       '1.3'::jsonb,    'number',  'signal_check_quality', 'Pool scale exponent',                  'Higher values reward premium assets more steeply. Reference model: 1.3.'),
  ('signal_check_quality_peak_weight',          '0.05'::jsonb,   'number',  'signal_check_quality', 'Top-asset weight',                     'Weight on how close an asset is to the best asset in this trade. Reference model: 0.05.'),
  ('signal_check_quality_peak_exponent',        '6'::jsonb,      'number',  'signal_check_quality', 'Top-asset exponent',                   'Steepness of the top-asset term. High on purpose: only the headliner should collect it. Reference model: 6.'),
  ('signal_check_quality_peak_slack',           '1.05'::jsonb,   'number',  'signal_check_quality', 'Top-asset slack',                      'Keeps the top-asset term below 1 even for the trade best asset. Reference model: 1.05.'),
  ('signal_check_quality_pool_padding',         '80'::jsonb,     'number',  'signal_check_quality', 'Pool ceiling padding',                 'Added to the top value in the pool so the best player does not sit exactly at the ceiling.'),
  ('signal_check_quality_package_threshold',    '50'::jsonb,     'number',  'signal_check_quality', 'Package piece threshold (%)',          'Percent of the trade best asset below which a piece counts as a package piece and enters the diminishing-return sequence.'),
  ('signal_check_quality_package_multipliers',  '"1, 0.85, 0.7, 0.6"'::jsonb, 'string', 'signal_check_quality', 'Package multipliers',   'Comma-separated multipliers for the 1st, 2nd, 3rd package piece and so on. The last value repeats for every further piece.'),
  ('signal_check_quality_min_assets',           '2'::jsonb,      'number',  'signal_check_quality', 'Minimum assets for an adjustment',     'The larger side must hold at least this many assets. Set to 2 so one-for-one swaps get no adjustment: their value gap is already the whole story.'),
  ('signal_check_quality_display_threshold',    '3.3'::jsonb,    'number',  'signal_check_quality', 'Noise floor (%)',                      'Adjustments below this percent of the combined trade value are dropped entirely, so a displayed total always equals the assets above it.'),
  ('signal_check_quality_max_adjustment',       '300'::jsonb,    'number',  'signal_check_quality', 'Adjustment ceiling (%)',               'Hard cap on the balancing amount as a percent of combined value, so a near-worthless package cannot demand an absurd number.')
on conflict (key) do nothing;

-- The quality pass supersedes pile-on. Both discount the tail of a package, so
-- leaving pile-on on would charge it twice and widen every margin past what
-- either mechanism intends. The rows stay in place: an admin can switch back.
update public.beacon_settings
set value = 'false'::jsonb,
    description = 'Legacy depth discount, superseded by consolidation scoring. Leave off unless consolidation scoring is disabled; running both discounts the same package twice.'
where key = 'signal_check_pileon_enabled';
