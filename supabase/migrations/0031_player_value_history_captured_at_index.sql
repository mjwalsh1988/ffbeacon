-- Migration 0031: performance index on player_value_history(captured_at DESC)
--
-- Access matrix:
--   This is a maintenance migration that creates a btree index. No RLS or
--   table-level policy changes; existing player_value_history policies
--   (public SELECT, service-role write) continue to apply.
--
-- Why this index is needed:
--   After the 2026-05-25 KTC community-archive backfill landed (lib/
--   backfill-ktc-community-archive.ts), player_value_history grew from
--   ~345K rows to ~935K. scripts/calculate-trends.ts loads the full table
--   with a global ORDER BY captured_at DESC. Without an index on
--   captured_at, Postgres falls back to a sequential scan plus an
--   in-memory sort that exceeds Supabase's 60s statement timeout.
--
--   The existing composite index (player_id, captured_at DESC) accelerates
--   per-player lookups but NOT a global captured_at sort, since the leading
--   column is player_id.
--
--   This index supports:
--     - calculate-trends.ts (full-table load by date)
--     - any future date-window analytics on player_value_history
--     - the cron recalculate-derived endpoint's downstream queries

CREATE INDEX IF NOT EXISTS idx_player_value_history_captured_at
  ON public.player_value_history USING btree (captured_at DESC);

COMMENT ON INDEX public.idx_player_value_history_captured_at IS
  'Supports global ORDER BY captured_at queries (calculate-trends, future date-window analytics).';
