-- Migration 0050: TE-premium derivation settings for dynasty-ppr-tep
--
-- Access matrix (beacon_settings) unchanged from 0037:
--   service_role : ALL ; client : BLOCKED
--
-- dynasty-ppr-tep has no external source, so FF Beacon derives it from the
-- dynasty 1QB base plus a per-TE boost. These knobs control that boost and are
-- admin-tunable like every other setting. The boost is
-- (te_premium * receptions) / base_season_points, scaled by sensitivity, capped.

insert into public.beacon_settings (key, value, value_type, category, label, description) values
  ('tep_value_sensitivity', '0.5'::jsonb, 'number', 'derivation', 'TEP value sensitivity',
   'Scales the TE-premium scoring gain into a value boost for dynasty-ppr-tep.'),
  ('tep_value_cap', '0.20'::jsonb, 'number', 'derivation', 'TEP value cap',
   'Maximum proportional value boost a TE can receive from the TE premium.'),
  ('tep_min_base_pts', '30'::jsonb, 'number', 'derivation', 'TEP min base season points',
   'Ignore the boost when a TE''s base season points are below this (too little signal).')
on conflict (key) do nothing;
