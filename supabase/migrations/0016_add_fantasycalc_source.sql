-- Migration 0016: register FantasyCalc as a second data source
--
-- Access matrix (source_registry) unchanged from 0010/0011:
--   anon          : SELECT
--   authenticated : SELECT
--   service_role  : ALL
--   client writes : BLOCKED
--
-- FantasyCalc (https://api.fantasycalc.com/values/current) is a
-- community-trade-driven trade-value provider. It natively publishes six
-- format variants that map cleanly to our format_configs:
--
--   redraft-std-std    (isDynasty=false, numQbs=1, ppr=0)
--   redraft-half-std   (isDynasty=false, numQbs=1, ppr=0.5)
--   redraft-ppr-std    (isDynasty=false, numQbs=1, ppr=1)
--   redraft-ppr-sflex  (isDynasty=false, numQbs=2, ppr=1)
--   dynasty-ppr-std    (isDynasty=true,  numQbs=1, ppr=1)
--   dynasty-ppr-sflex  (isDynasty=true,  numQbs=2, ppr=1)
--
-- FantasyCalc does NOT publish TEP variants. dynasty-ppr-tep-sflex and
-- redraft-ppr-tep stay outside supported_format_slugs. If we later want
-- FantasyCalc TEP, we'd apply our own TEP derivation algorithm in the
-- sync pipeline (mirroring the KTC TEP pattern in lib/ktc-tep.ts),
-- explicitly NOT done in this migration.
--
-- Priority is set so FantasyCalc outranks KTC for the formats both
-- support. Order: ffbeacon (1, reserved) → fantasycalc (2) → ktc (3).
-- The ffbeacon slot stays unfilled in source_registry until we ship an
-- original ranking pipeline, but the slot is reserved by leaving KTC at
-- priority 3 so future ffbeacon entries can slot in at 1.

begin;

-- Bump KTC priority so FantasyCalc can outrank it where both support a format.
update public.source_registry
set priority = 3
where slug = 'ktc';

insert into public.source_registry
  (slug, display_name, description, priority, is_active, data_type, supported_format_slugs)
values
  (
    'fantasycalc',
    'FantasyCalc',
    'Trade values calculated from real fantasy football trades across hundreds of thousands of leagues',
    2,
    true,
    array['rankings','player_value_history'],
    array[
      'redraft-std-std',
      'redraft-half-std',
      'redraft-ppr-std',
      'redraft-ppr-sflex',
      'dynasty-ppr-std',
      'dynasty-ppr-sflex'
    ]
  )
on conflict (slug) do update
  set display_name = excluded.display_name,
      description = excluded.description,
      priority = excluded.priority,
      is_active = excluded.is_active,
      data_type = excluded.data_type,
      supported_format_slugs = excluded.supported_format_slugs;

commit;
