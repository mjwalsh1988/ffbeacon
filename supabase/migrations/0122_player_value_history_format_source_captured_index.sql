-- Index for On The Clock historical value-board reconstruction.
--
-- lib/on-the-clock/history-lookup.ts fetchClosestValueRows reads
-- player_value_history filtered by (format_config_id, source) and ordered by
-- captured_at, to rebuild "the FF Beacon board as of a draft's completion date".
-- No existing index leads on those columns (the closest is the unique index on
-- (player_id, format_config_id, source, captured_at), which leads with player_id),
-- so the planner scanned every player and probed each one's history. For large
-- formats on a cold cache that exceeded the API statement timeout, the query threw,
-- and the completed-draft snapshot could never be built or locked (it failed with a
-- 500 on every open). This index lets the query seek straight to a single
-- (format_config_id, source) partition already in captured_at order, in either
-- direction, turning a multi-second scan into a millisecond range scan.
--
-- player_value_history is a public read-only table (writes are service-role only);
-- adding an index changes no access rules, so there is no RLS change here. INCLUDE
-- carries the two columns the reconstruction read selects (player_id, value) so the
-- value-history side can be served as an index-only scan.

CREATE INDEX IF NOT EXISTS idx_player_value_history_format_source_captured
  ON public.player_value_history (format_config_id, source, captured_at DESC)
  INCLUDE (player_id, value);
