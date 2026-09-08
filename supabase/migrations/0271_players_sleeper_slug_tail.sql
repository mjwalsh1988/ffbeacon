-- Migration 0271: make the Sleeper-id player lookup indexable.
--
-- Access matrix: UNCHANGED. `players` is public SELECT for anon and
-- authenticated, writes via service_role only. This migration adds a generated
-- column and an index; it creates, drops and alters no policy.
--
-- WHY
--   Four callers resolved a list of Sleeper player ids to `players` rows with
--   one `.or()` chain mixing an indexed predicate and a leading-wildcard LIKE:
--
--     external_ids->>sleeper.eq.{id} , slug.like.*-{id}
--
--   The first half hits idx_players_external_sleeper. The second half is
--   LIKE '%-4046', which no B-tree can serve, and because the two are OR-ed the
--   planner cannot use the index for either half. Measured on production
--   (docs/performance/site-speed-audit-and-plan.md, 4.1):
--
--     with the slug clause:    Seq Scan, 10,473 rows removed, 1,319.8 ms
--     without the slug clause: BitmapOr on the index,             0.3 ms
--
--   `players` had logged 81,321 sequential scans on 10,481 rows.
--
-- WHAT THIS CHANGES
--   `sleeper_slug_tail` holds the trailing numeric id that the slug carries, so
--   the fallback pass becomes `.in("sleeper_slug_tail", missing)`, which is an
--   index scan. It is a STORED GENERATED column, so nothing writes it and it
--   cannot drift from the slug.
--
--   The backfill closes the gap the fallback existed for: any row whose slug
--   carries a Sleeper id but whose external_ids does not. As of today that is
--   zero rows (all 10,481 already carry the key, with no value disagreeing with
--   its slug), so this is a guard for future rows rather than a repair. It is
--   idempotent: it only writes rows missing the key, and never overwrites one.

alter table public.players
  add column if not exists sleeper_slug_tail text
  generated always as (substring(slug from '-([0-9]+)$')) stored;

comment on column public.players.sleeper_slug_tail is
  'Trailing numeric Sleeper id parsed out of slug. Generated, never written. Serves the fallback pass in lib/sleeper-player-lookup.ts for a player Sleeper added since our last sync.';

-- One-off backfill: any row whose slug carries a Sleeper id but whose
-- external_ids does not. Idempotent, and a no-op on a database where every row
-- already has the key.
update public.players
   set external_ids = external_ids || jsonb_build_object('sleeper', substring(slug from '-([0-9]+)$'))
 where substring(slug from '-([0-9]+)$') is not null
   and not (external_ids ? 'sleeper');

-- Applied separately from the statements above, because CREATE INDEX
-- CONCURRENTLY cannot run inside a transaction block and the migration runner
-- wraps its body in one. Run this by hand against a new environment:
--
--   create index concurrently if not exists idx_players_sleeper_slug_tail
--     on public.players (sleeper_slug_tail) where sleeper_slug_tail is not null;
--
-- Confirmed valid on production 2026-09-08 (indisvalid true, 248 kB).
