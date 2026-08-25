-- Migration 0210: index player_stats.updated_at
--
-- WHY
-- The data-freshness watchdog (lib/data-freshness.ts) asks each watched table
-- one question: "when were you last written?" That is
-- `order by updated_at desc limit 1`, which is instant against an index and a
-- full sort without one. player_stats holds ~290,000 rows and had indexes on
-- (player_id, season), (season, season_type) and (season, week), none of which
-- can answer it, so the query hit the 8-second statement timeout every time.
--
-- The failure was worse than slow. A timed-out read grades as "unknown" rather
-- than "stale", deliberately, because a query that errored says nothing about
-- the data. So the watchdog quietly reported nothing at all about player_stats
-- instead of reporting that it had gone quiet. A monitor that cannot read its
-- subject and does not say so is worse than no monitor, and this whole change
-- set exists because a silent gap ran for three months.
--
-- player_value_history needed no index; it already had one on captured_at DESC
-- and was only failing because the query asked for `desc nulls last`, which
-- does not match a `DESC` (nulls first) index. That was fixed in the query.
--
-- Cost: one btree over a not-null timestamptz on a table written once a night
-- during the season. Small, and it also serves any future "what changed
-- recently" read against player_stats.

create index if not exists idx_player_stats_updated_at
  on public.player_stats (updated_at desc);
