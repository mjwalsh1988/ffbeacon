-- Migration 0048: format-aware K/DEF bands, compressed for dynasty
--
-- Access matrix (beacon_value_bands) unchanged from 0039:
--   service_role : ALL ; client : BLOCKED
--
-- K and DEF have real startable value in redraft (global default band 0-1500),
-- but in dynasty they are near-worthless long-term (you do not roster them for
-- the future). A top dynasty kicker should be a token value, not 1500 (which
-- would outrank genuinely rosterable dynasty skill players). So dynasty formats
-- get a compressed K/DEF band via per-(position, format) overrides. This both
-- demonstrates the format-aware band resolver and reflects dynasty reality.
-- Redraft formats keep the global 0-1500 default. Admin-tunable like all bands.

insert into public.beacon_value_bands (position, format_config_id, floor, ceiling)
select p.pos, fc.id, 0, 250
from public.format_configs fc
cross join (values ('K'), ('DEF')) as p(pos)
where fc.slug in ('dynasty-ppr-std', 'dynasty-ppr-sflex', 'dynasty-ppr-tep-sflex')
on conflict do nothing;
