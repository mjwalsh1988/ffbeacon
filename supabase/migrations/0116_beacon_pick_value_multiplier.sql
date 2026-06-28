-- Migration 0116: FF Beacon draft pick value multiplier setting
--
-- Access matrix: inherits beacon_settings (migration 0037).
--   anon          : none
--   authenticated : none
--   service_role  : ALL (engine reads; admin server action writes via service role)
--   client writes : BLOCKED
-- No new table and no new policies: this only seeds one row into the existing
-- beacon_settings key-value store, so the existing RLS policy already covers it.
--
-- A single global multiplier applied ONLY to the ffbeacon source's draft pick
-- values at recompute time. KTC (and every other source) pick values are never
-- touched. The engine (lib/calculate-beacon-values.ts) reads this when it copies
-- the KTC baseline into source='ffbeacon' pick rows and scales each value by it.
-- Default 1 = no change. Takes effect on the next recompute, never live.

insert into public.beacon_settings (key, value, value_type, category, label, description) values
  ('pick_value_multiplier', '1'::jsonb, 'number', 'picks', 'FF Beacon draft pick value multiplier', 'Scales every FF Beacon draft pick value by this number on each recompute. 1 = no change, 0.8 = 20 percent lower, 1.2 = 20 percent higher. Applies ONLY to FF Beacon pick values; KTC and other sources are never affected. Takes effect on the next recompute.')
on conflict (key) do nothing;
