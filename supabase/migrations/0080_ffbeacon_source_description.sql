-- Migration 0080: reword the ffbeacon source_registry description
--
-- Access matrix: inherits source_registry (public SELECT; writes service_role only).
--
-- The prior description ("a weighted signal aggregation of every source plus
-- player stats") revealed the internal method. Reword to the public-facing
-- positioning: a proprietary, AI-assisted model tuned by the team, without
-- disclosing that other sources feed it. Data-only change; no schema impact.

update public.source_registry
set description =
  'FF Beacon''s own value: a proprietary model with AI-powered analytics, tuned by our founder and team.'
where slug = 'ffbeacon';
