-- Migration 0009: Relabel KTC-derived rankings to source='ktc'
--
-- Access matrix (rankings):
--   anon          : SELECT
--   authenticated : SELECT
--   service_role  : ALL (this UPDATE runs as service_role via MCP)
--   client writes : BLOCKED
--
-- Context: scripts/seed-rankings.ts produces rankings by sorting trade_values
-- (source='ktc') by value desc and bucketing into 6 tiers. These rows were
-- previously tagged source='ffbeacon' which mislabeled their provenance.
-- The 'ffbeacon' label is reserved for rankings produced by FF Beacon's own
-- original logic (editorial overlay, model blends, etc).
--
-- Safe to run: rankings has unique(player_id, format_config_id, source, week, season).
-- Before fix: all 2,878 rows source='ffbeacon', zero source='ktc' in rankings.
-- After fix: all rows source='ktc'. No constraint violation possible.

update public.rankings
set source = 'ktc'
where source = 'ffbeacon';
