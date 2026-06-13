-- Migration 0033: register DynastyProcess as a third value source
--
-- Access matrix (source_registry) unchanged from 0010/0011:
--   anon          : SELECT
--   authenticated : SELECT
--   service_role  : ALL
--   client writes : BLOCKED
--
-- DynastyProcess (https://github.com/dynastyprocess/data) publishes
-- FantasyPros-ECR-derived dynasty values as weekly-updated public CSVs. Its
-- value scale (~0 to ~10,232, NOT hard-capped at 10,000) is computed via its
-- own exponential-decay curve, independent of KTC and FantasyCalc.
--
-- It publishes exactly two QB variants of dynasty PPR values:
--   value_1qb / ecr_1qb  ->  dynasty-ppr-std
--   value_2qb / ecr_2qb  ->  dynasty-ppr-sflex
--
-- It does NOT publish redraft, half/standard scoring, or TEP. Those stay
-- outside supported_format_slugs. We deliberately do not derive TEP for DP
-- (consistent with the FantasyCalc decision in 0016): CLAUDE.md only allows
-- reproducing a derived format when the source itself publishes that algorithm.
--
-- DP's values-picks.csv carries ranks but NO scalar value column, and our
-- draft_pick_values.value is NOT NULL. So DP gets data_type
-- ['rankings','player_value_history'] only, NOT 'draft_pick_values'. KTC stays
-- the pick-value source.
--
-- Priority: ffbeacon (1, reserved) -> fantasycalc (2) -> ktc (3) ->
-- dynastyprocess (4). DP slots below KTC so it does not silently become the
-- default for the dynasty formats all three now cover; FantasyCalc stays the
-- dynasty default.
--
-- is_active is FALSE on insert. The source is flipped active only after the
-- pre-launch pairwise audit (value_1qb != value_2qb across 50+ players; DP not
-- byte-identical to KTC/FantasyCalc) passes. While inactive, getAvailableSources
-- and seed-rankings both skip it (they filter is_active=true), so the sync can
-- populate player_value_history for the audit without exposing DP in the UI.

begin;

insert into public.source_registry
  (slug, display_name, description, priority, is_active, data_type, supported_format_slugs)
values
  (
    'dynastyprocess',
    'DynastyProcess',
    'FantasyPros-consensus dynasty values, independent of KTC and FantasyCalc',
    4,
    false,
    array['rankings', 'player_value_history'],
    array['dynasty-ppr-std', 'dynasty-ppr-sflex']
  )
on conflict (slug) do update
  set display_name = excluded.display_name,
      description = excluded.description,
      priority = excluded.priority,
      data_type = excluded.data_type,
      supported_format_slugs = excluded.supported_format_slugs;

commit;
