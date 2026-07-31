-- 0158: every FF Beacon TE-premium board becomes a derivation of its non-TEP
-- baseline, and the two redraft TE-premium boards get filled in.
--
-- WHY
-- dynasty-ppr-tep-sflex was the only TE-premium board the engine built from
-- scratch against external sources. KTC is the sole source declaring support for
-- it, so that board was normalized against a one-source canonical curve while
-- dynasty-ppr-sflex was normalized against three (KTC, FantasyCalc,
-- DynastyProcess). The result was a board-wide drift that had nothing to do with
-- tight ends: 195 of 204 WRs, 139 of 142 RBs, and 66 of 73 QBs all gained value
-- (avg +860 / +888 / +644). Drake London, a WR whose KTC input value is identical
-- in both formats (7006), published at 7004 on dynasty-ppr-sflex and 7475 on
-- dynasty-ppr-tep-sflex.
--
-- dynasty-ppr-tep (1QB) never had this problem because it is derived: it copies
-- dynasty-ppr-std and boosts only tight ends. lib/calculate-beacon-values.ts now
-- routes every TE-premium board through that same path, which is the only shape
-- that can guarantee a TE-premium board differs from its baseline for tight ends
-- and nobody else.
--
-- WHAT THIS MIGRATION DOES (the data half of that change)
--   1. Creates redraft-ppr-tep-sflex, which never existed.
--   2. Adds both redraft TE-premium boards to ffbeacon's supported formats so the
--      engine builds them. redraft-ppr-tep has been active since 0001 carrying
--      zero value rows from any source, because no source ever claimed it. No
--      external source publishes redraft TE-premium values, so these two boards
--      are FF Beacon only, exactly like dynasty-ppr-tep.
--   3. Drops the unimplemented second option from normalization_method. The
--      engine has only ever implemented quantile matching; p99 scaling is the
--      automatic per-source fallback for a thin slice (see lib/beacon/
--      normalize.ts useDirect), not a mode anyone can select. The admin dropdown
--      offered a choice that changed nothing.
--
-- Every statement is idempotent and safe to re-run.
--
-- ACCESS MATRIX (no new tables, no policy changes)
--   format_configs   SELECT anon + authenticated   ALL service_role
--   source_registry  SELECT anon + authenticated   ALL service_role
--   beacon_settings  ALL service_role only (admin UI reads via service client)

-- 1. The missing redraft superflex TE-premium format.
insert into format_configs
  (slug, display_name, league_type, scoring_type, te_premium_bonus, is_superflex, display_order, is_active)
values
  ('redraft-ppr-tep-sflex', 'Redraft PPR SF TEP', 'redraft', 'ppr', 0.5, true, 6, true)
on conflict (slug) do nothing;

-- 2. Explicit display order so the new board sits with the other redraft formats
--    instead of trailing the best-ball presets. Assigned by slug rather than by
--    an offset shift so a re-run lands on the same result.
update format_configs f
set display_order = v.ord
from (values
  ('redraft-ppr-std',            1),
  ('redraft-half-std',           2),
  ('redraft-std-std',            3),
  ('redraft-ppr-sflex',          4),
  ('redraft-ppr-tep',            5),
  ('redraft-ppr-tep-sflex',      6),
  ('dynasty-ppr-std',            7),
  ('dynasty-ppr-sflex',          8),
  ('dynasty-ppr-tep-sflex',      9),
  ('dynasty-ppr-tep',           10),
  ('bestball-ppr-std',          11),
  ('bestball-ppr-sflex',        12),
  ('bestball-dynasty-ppr-sflex', 13)
) as v(slug, ord)
where f.slug = v.slug
  and f.display_order is distinct from v.ord;

-- 3. ffbeacon claims both redraft TE-premium boards. Set in full rather than
--    appended, so the row states the whole supported set and a re-run cannot
--    duplicate an entry.
update source_registry
set supported_format_slugs = array[
  'redraft-ppr-std',
  'redraft-ppr-sflex',
  'redraft-ppr-tep',
  'redraft-ppr-tep-sflex',
  'dynasty-ppr-std',
  'dynasty-ppr-tep',
  'dynasty-ppr-sflex',
  'dynasty-ppr-tep-sflex',
  'bestball-ppr-std',
  'bestball-ppr-sflex',
  'bestball-dynasty-ppr-sflex'
]
where slug = 'ffbeacon';

-- 4. normalization_method describes the one method that exists.
update beacon_settings
set description =
  'How each source''s raw numbers get rescaled onto FF Beacon''s common 0 to 10000 curve before they are blended. The engine lines sources up by rank, so the top-percentile player on one source maps to the same spot on ours. This is the only method implemented, which is why it is the only choice offered. When a single source has fewer players in a group than the minimum below, that source alone falls back to a simpler stretch (divide by a near-top value) and is flagged low-confidence; that fallback is automatic and per-source, never a setting.'
where key = 'normalization_method';
