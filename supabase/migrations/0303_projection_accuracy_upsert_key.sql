-- 0303: one unique key on player_projection_accuracy that an upsert can target.
--
-- Why. The nightly accuracy rebuild (lib/calculate-projection-accuracy.ts) was
-- delete-everything-then-insert in 500-row chunks, so for the length of the
-- insert every reader (Power Pulse, Positional WAR, the lineup and start/sit
-- pages) saw a partial table: some players with a reliability row, the rest
-- silently neutral. The rebuild now UPSERTS every row and then deletes only the
-- rows this run did not write, so a reader always sees one complete row per key.
--
-- An upsert needs a single unique index covering every row. The existing
-- (player_id, season, scoring, source) index treats a NULL season as distinct,
-- so the blended rows (season IS NULL) were only guarded by the partial index
-- idx_player_projection_accuracy_blended, which ON CONFLICT cannot target from
-- PostgREST. NULLS NOT DISTINCT (Postgres 15+) makes the one index cover both.
--
-- The partial blended index stays: it is what the blended read path scans
-- (EXPLAIN 2026-09-25: bitmap index scan, 1.1 ms for a 300-player chunk).
--
-- Access matrix: unchanged. No table, column or policy is added or altered;
-- the RLS policies from the player_projection_accuracy migration still apply
-- (public SELECT, writes by service role only).

create unique index if not exists player_projection_accuracy_key
  on public.player_projection_accuracy (player_id, season, scoring, source) nulls not distinct;

drop index if exists public.player_projection_accuracy_player_season_scoring_source_key;
