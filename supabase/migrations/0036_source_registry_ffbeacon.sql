-- Migration 0036: register FF Beacon as the proprietary value + ranking source
--
-- Access matrix (source_registry) unchanged from 0010/0011:
--   anon          : SELECT
--   authenticated : SELECT
--   service_role  : ALL
--   client writes : BLOCKED
--
-- FF Beacon is our own aggregation + signal engine. It is just another source
-- row, so once it writes to player_value_history / draft_pick_values the entire
-- read layer (rankings, trends, league power rankings, trade analyzer, source
-- dropdown, OG cards) consumes it with no read-layer changes.
--
-- priority = 1: the slot reserved in 0016/0033 (fantasycalc=2, ktc=3,
-- dynastyprocess=4). FF Beacon outranks every source where it has data.
--
-- is_active = FALSE on insert. ABSOLUTE: this row does NOT flip to active until
-- the Phase 1-3 audits (normalization, value-read, K/DEF top-50 eyeball,
-- staleness behavior) pass and the owner signs off. While inactive,
-- getAvailableSources and seed-rankings skip it (they filter is_active = true),
-- so the engine can populate history for the audit without exposing FF Beacon.
--
-- supported_format_slugs = the 9 default presets. FF Beacon is the only complete
-- source (it can value every preset, plus arbitrary custom formats on demand).
-- data_type includes draft_pick_values: FF Beacon picks are KTC-baselined.
-- update_cadence = daily.

insert into public.source_registry
  (slug, display_name, description, priority, is_active, data_type, supported_format_slugs, update_cadence)
values
  (
    'ffbeacon',
    'FF Beacon',
    'FF Beacon proprietary values: a weighted signal aggregation of every source plus player stats',
    1,
    false,
    array['rankings', 'player_value_history', 'draft_pick_values'],
    array[
      'redraft-ppr-std',
      'redraft-ppr-sflex',
      'dynasty-ppr-std',
      'dynasty-ppr-tep',
      'dynasty-ppr-sflex',
      'dynasty-ppr-tep-sflex',
      'bestball-ppr-std',
      'bestball-ppr-sflex',
      'bestball-dynasty-ppr-sflex'
    ],
    'daily'
  )
on conflict (slug) do update
  set display_name = excluded.display_name,
      description = excluded.description,
      priority = excluded.priority,
      data_type = excluded.data_type,
      supported_format_slugs = excluded.supported_format_slugs,
      update_cadence = excluded.update_cadence;
