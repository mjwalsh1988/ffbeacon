-- Migration 0104: Signal Check settings seed (reuses beacon_settings KV store)
--
-- Signal Check scalar tunables live in the existing beacon_settings table so
-- the generic admin SettingField + updateBeaconSetting machinery edits them
-- with no new UI plumbing. Categories are prefixed 'signal_check' so the Signal
-- Check admin page can query them with a category LIKE 'signal_check%' filter
-- and group by category.
--
-- value_type is constrained to number|boolean|string by beacon_settings, so all
-- knobs below are scalars. Structured config (label sets, curves) is expressed
-- as individual scalar rows rather than nested json.
--
-- Access matrix: unchanged from beacon_settings (service-role ALL only). Admin
-- edits go through requireAdmin server actions.

insert into public.beacon_settings (key, value, value_type, category, label, description) values
  -- General -----------------------------------------------------------------
  ('signal_check_enabled',            'true'::jsonb,            'boolean', 'signal_check',            'Signal Check enabled',                 'Master on/off for the public Signal Check tool.'),
  ('signal_check_public_label',       '"Signal Check"'::jsonb,  'string',  'signal_check',            'Public feature label',                 'Name shown to users for the trade evaluation tool.'),
  ('signal_check_result_label',       '"Beacon Verdict"'::jsonb,'string',  'signal_check',            'Result label',                         'Name of the final result (e.g. "Beacon Verdict").'),
  ('signal_check_margin_precision',   '1'::jsonb,               'number',  'signal_check',            'Margin display precision',             'Decimal places shown on the public margin percentage.'),
  ('signal_check_show_raw_values',    'false'::jsonb,           'boolean', 'signal_check',            'Show raw values publicly',             'When on, raw Beacon value points are shown on public results. Off by default.'),
  ('signal_check_show_confidence',    'true'::jsonb,            'boolean', 'signal_check',            'Show confidence publicly',             'When on, the confidence level is shown on public results.'),
  ('signal_check_show_trade_shape',   'true'::jsonb,            'boolean', 'signal_check',            'Show trade shape publicly',            'When on, the trade-shape label is shown on public results.'),
  ('signal_check_sleeper_imports',    'true'::jsonb,            'boolean', 'signal_check',            'Sleeper imports enabled',              'When on, logged-in users can import completed trades from Sleeper.'),
  ('signal_check_share_links',        'true'::jsonb,            'boolean', 'signal_check',            'Public share links enabled',           'When on, users can create shareable frozen permalinks.'),
  ('signal_check_share_images',       'true'::jsonb,            'boolean', 'signal_check',            'Share images enabled',                 'When on, OG share images are generated for shared analyses.'),
  ('signal_check_autocomplete_min',   '4'::jsonb,               'number',  'signal_check',            'Autocomplete minimum query length',    'Minimum characters before the asset search runs. Default 4; lower to 3 only if needed.'),
  ('signal_check_max_assets_per_side','12'::jsonb,              'number',  'signal_check',            'Max assets per side',                  'Hard upper bound on assets per side, enforced server-side.'),

  -- Verdict -----------------------------------------------------------------
  ('signal_check_neutral_threshold',  '2.5'::jsonb,             'number',  'signal_check_verdict',    'Neutral verdict threshold (%)',        'If the margin is below this percent, the verdict is the neutral label (no winner forced).'),
  ('signal_check_neutral_label',      '"Near even"'::jsonb,     'string',  'signal_check_verdict',    'Neutral verdict label',                'Public label used when the trade is within the neutral threshold.'),
  ('signal_check_blowout_threshold',  '20'::jsonb,              'number',  'signal_check_verdict',    'Blowout threshold (%)',                'Margins at or above this percent are labelled a blowout. Set high to effectively disable.'),
  ('signal_check_blowout_label',      '"Lopsided"'::jsonb,      'string',  'signal_check_verdict',    'Blowout label',                        'Public label used when the margin meets the blowout threshold.'),
  ('signal_check_win_template',       '"Side {side} wins by {margin}% of total trade value."'::jsonb, 'string', 'signal_check_verdict', 'Win wording template', 'Public sentence for a decisive verdict. Placeholders: {side}, {margin}.'),
  ('signal_check_compounding_mode',   '"sequential"'::jsonb,    'string',  'signal_check_verdict',    'Percentage compounding mode',          'sequential = each percent applies to the running value; against_base = each applies to the original base value.'),

  -- Pile-on -----------------------------------------------------------------
  ('signal_check_pileon_enabled',     'true'::jsonb,            'boolean', 'signal_check_pileon',     'Pile-on enabled',                      'When on, lower-value depth pieces on a side get diminishing returns.'),
  ('signal_check_pileon_top_k',       '2'::jsonb,               'number',  'signal_check_pileon',     'Top K assets at full value',           'Number of highest-value assets per side kept at full value before depreciation.'),
  ('signal_check_pileon_curve_base',  '0.9'::jsonb,             'number',  'signal_check_pileon',     'Depreciation curve base',              'Geometric base applied to each asset beyond the top K (0 to 1). Lower = steeper discount.'),
  ('signal_check_pileon_max_penalty', '25'::jsonb,              'number',  'signal_check_pileon',     'Maximum pile-on penalty (%)',          'Cap on how much pile-on may reduce a side total, as a percent of that side.'),
  ('signal_check_pileon_min_assets',  '3'::jsonb,               'number',  'signal_check_pileon',     'Minimum assets before pile-on',        'Pile-on only applies to a side with at least this many assets.'),
  ('signal_check_pileon_template',    '"Side {side} receives several lower-value pieces, so depth beyond the top {k} assets is discounted."'::jsonb, 'string', 'signal_check_pileon', 'Pile-on explanation template', 'Public sentence for the side-level pile-on adjustment. Placeholders: {side}, {k}.'),

  -- Trade shape -------------------------------------------------------------
  ('signal_check_shape_enabled',      'true'::jsonb,            'boolean', 'signal_check_shape',      'Trade shape labels enabled',           'When on, a trade-shape label is assigned and (optionally) shown.'),
  ('signal_check_shape_consolidation','"Consolidation trade"'::jsonb,  'string', 'signal_check_shape', 'Label: consolidation',          'Label when one side trades many pieces for one dominant asset.'),
  ('signal_check_shape_depth',        '"Depth package"'::jsonb,        'string', 'signal_check_shape', 'Label: depth package',          'Label for a package of several lower-value pieces with no dominant asset.'),
  ('signal_check_shape_stud_swap',    '"Stud-for-stud swap"'::jsonb,   'string', 'signal_check_shape', 'Label: stud-for-stud swap',     'Label for a near one-for-one of two high-value assets.'),
  ('signal_check_shape_win_now',      '"Win-now move"'::jsonb,         'string', 'signal_check_shape', 'Label: win-now move',           'Label when a side sends picks/youth for established production.'),
  ('signal_check_shape_rebuild',      '"Rebuild move"'::jsonb,         'string', 'signal_check_shape', 'Label: rebuild move',           'Label when a side sends established production for picks/youth.'),
  ('signal_check_shape_pick_heavy',   '"Pick-heavy deal"'::jsonb,      'string', 'signal_check_shape', 'Label: pick-heavy deal',        'Label when draft picks make up most of a side.'),
  ('signal_check_shape_roster_clog',  '"Roster clog risk"'::jsonb,     'string', 'signal_check_shape', 'Label: roster clog risk',       'Label when the pile-on penalty materially fired on a side.'),
  ('signal_check_shape_format_driven','"Format-driven win"'::jsonb,    'string', 'signal_check_shape', 'Label: format-driven win',      'Label when the outcome depended on the resolved league format.'),
  ('signal_check_shape_near_even',    '"Near-even swap"'::jsonb,       'string', 'signal_check_shape', 'Label: near-even swap',         'Label when the trade is within the neutral threshold.'),
  ('signal_check_shape_pick_share',   '50'::jsonb,             'number',  'signal_check_shape',      'Pick-heavy share threshold (%)',       'A side whose pick value exceeds this percent of its total is pick-heavy.'),
  ('signal_check_shape_best_share',   '60'::jsonb,             'number',  'signal_check_shape',      'Consolidation best-asset share (%)',   'A side whose single best asset exceeds this percent of its total signals consolidation.'),

  -- Confidence --------------------------------------------------------------
  ('signal_check_confidence_enabled', 'true'::jsonb,            'boolean', 'signal_check_confidence', 'Confidence enabled',                   'When on, a confidence level is computed and (optionally) shown.'),
  ('signal_check_confidence_low_max', '40'::jsonb,              'number',  'signal_check_confidence', 'Low confidence max score',             'Confidence scores at or below this are Low.'),
  ('signal_check_confidence_high_min','70'::jsonb,              'number',  'signal_check_confidence', 'High confidence min score',            'Confidence scores at or above this are High; scores between are Medium.'),
  ('signal_check_confidence_low',     '"Low confidence"'::jsonb,    'string', 'signal_check_confidence', 'Low confidence label',          'Public label for low confidence.'),
  ('signal_check_confidence_medium',  '"Medium confidence"'::jsonb, 'string', 'signal_check_confidence', 'Medium confidence label',       'Public label for medium confidence.'),
  ('signal_check_confidence_high',    '"High confidence"'::jsonb,   'string', 'signal_check_confidence', 'High confidence label',         'Public label for high confidence.'),

  -- Value / format ----------------------------------------------------------
  ('signal_check_default_format',     '"redraft-ppr-std"'::jsonb, 'string', 'signal_check_format',    'Default manual format',                'Format selected by default in the manual builder. Must be an FF Beacon-supported slug.'),
  ('signal_check_disabled_formats',   '""'::jsonb,              'string',  'signal_check_format',     'Disabled formats (comma-separated)',   'Format slugs to hide from Signal Check even if FF Beacon has values. Leave blank to allow all supported formats.'),
  ('signal_check_sleeper_override',   'false'::jsonb,           'boolean', 'signal_check_format',     'Allow format override on Sleeper imports', 'When off, Sleeper imports lock the auto-detected format. When on, users may override it.')
on conflict (key) do nothing;
