-- Migration 0017: add rank-movement columns to player_value_trends
--
-- Access matrix (unchanged from 0013):
--   anon          : SELECT
--   authenticated : SELECT
--   service_role  : ALL (calculate-trends.ts writes via SECRET key)
--   client writes : BLOCKED
--
-- Rationale: the rankings table previously surfaced only value % change.
-- Users also need to see ordinal movement — going from rank 12 to rank 8
-- (a +4 movement) is a stronger market signal than the underlying value
-- drift it took to get there. We store the rank at each backward window
-- alongside the existing value_*_ago columns and the derived change.
--
-- rank_change_* is computed as (rank_Nd_ago - current_rank). Lower rank =
-- better, so a positive rank_change_* means the player moved UP the board
-- (rank went from 10 to 6, change = +4). NULL when the historical rank
-- could not be derived (same data scarcity gating as the value columns).
--
-- All columns nullable. Calculate-trends.ts owns the writes. UI consumers
-- gate display on data_points_30d (same threshold as value trends).

alter table public.player_value_trends
  add column if not exists rank_7d_ago integer,
  add column if not exists rank_30d_ago integer,
  add column if not exists rank_90d_ago integer,
  add column if not exists rank_change_7d integer,
  add column if not exists rank_change_30d integer,
  add column if not exists rank_change_90d integer;

comment on column public.player_value_trends.rank_7d_ago is
  'Overall rank within (format_config_id, source) on the snapshot at or before 7 days ago. NULL when history is too sparse. Derived by calculate-trends.ts.';
comment on column public.player_value_trends.rank_30d_ago is
  'Overall rank within (format_config_id, source) on the snapshot at or before 30 days ago. NULL when history is too sparse.';
comment on column public.player_value_trends.rank_90d_ago is
  'Overall rank within (format_config_id, source) on the snapshot at or before 90 days ago. NULL when history is too sparse.';
comment on column public.player_value_trends.rank_change_7d is
  'Rank movement over 7 days. Positive = moved up (e.g. rank 10 -> 6 yields +4). NULL when rank_7d_ago is NULL.';
comment on column public.player_value_trends.rank_change_30d is
  'Rank movement over 30 days. Positive = moved up. NULL when rank_30d_ago is NULL.';
comment on column public.player_value_trends.rank_change_90d is
  'Rank movement over 90 days. Positive = moved up. NULL when rank_90d_ago is NULL.';
