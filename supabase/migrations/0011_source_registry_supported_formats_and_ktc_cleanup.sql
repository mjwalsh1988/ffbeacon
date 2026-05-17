-- Migration 0011: source_registry.supported_format_slugs + delete duplicate KTC rows
--
-- Background: The KTC scraper assumed that ?scoring=half, ?scoring=std, and
-- ?tep=1 query parameters on KTC's fantasy-rankings endpoint would yield
-- distinct PPR / Half-PPR / Standard / TEP datasets. They do not — those are
-- client-side JavaScript filters, so the embedded playersArray returned by
-- the server is identical regardless of those params. The scraper happily
-- wrote the same rows under four different format_config_ids.
--
-- Pairwise audit (350 shared players per pair):
--   redraft-ppr-std  ↔ redraft-half-std : 350/350 identical (100%)
--   redraft-ppr-std  ↔ redraft-std-std  : 350/350 identical (100%)
--   redraft-ppr-std  ↔ redraft-ppr-tep  : 350/350 identical (100%)
--   redraft-half-std ↔ redraft-std-std  : 350/350 identical (100%)
--   redraft-half-std ↔ redraft-ppr-tep  : 350/350 identical (100%)
--   redraft-std-std  ↔ redraft-ppr-tep  : 350/350 identical (100%)
--
-- This migration:
--   1. Adds source_registry.supported_format_slugs text[]
--   2. Deletes duplicate KTC rows (trade_values + rankings) for the 3 fake
--      format_configs.
--   3. Sets KTC's supported_format_slugs to the 5 formats KTC genuinely
--      provides distinct data for.
--
-- Access matrix (source_registry):
--   anon          : SELECT only (existing source_registry_select_public)
--   authenticated : SELECT only
--   service_role  : ALL (existing source_registry_service_role_all)
--   client writes : BLOCKED — new column inherits existing RLS policies
--
-- The 8 format_configs all remain active. supported_format_slugs is what
-- gates which (source, format) combinations are exposed to users.

-- 1. Add the column ---------------------------------------------------------
alter table public.source_registry
  add column if not exists supported_format_slugs text[];

comment on column public.source_registry.supported_format_slugs is
  'Array of format_configs.slug values this source actually provides distinct '
  'data for. NULL means the source supports every active format. Empty array '
  'means the source supports nothing yet (use is_active=false instead).';

-- 2. Delete duplicated KTC trade_values + rankings for fake formats ---------
delete from public.trade_values
where source = 'ktc'
  and format_config_id in (
    select id from public.format_configs
    where slug in ('redraft-half-std', 'redraft-std-std', 'redraft-ppr-tep')
  );

delete from public.rankings
where source = 'ktc'
  and format_config_id in (
    select id from public.format_configs
    where slug in ('redraft-half-std', 'redraft-std-std', 'redraft-ppr-tep')
  );

-- 3. Pin KTC to its 5 real formats ------------------------------------------
update public.source_registry
set supported_format_slugs = array[
  'dynasty-ppr-std',
  'dynasty-ppr-sflex',
  'dynasty-ppr-tep-sflex',
  'redraft-ppr-std',
  'redraft-ppr-sflex'
]
where slug = 'ktc';
