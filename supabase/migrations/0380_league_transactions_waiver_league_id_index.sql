-- Index only, no table or policy change.
--
-- The FAAB priors pass (lib/faab/priors-load.ts) reads one league's waiver
-- rows at a time, keyset paged on id. Before this index it read 100 leagues
-- per request ordered by id, and the planner chose to walk the primary key
-- across the whole table and filter, which took about 9.6 seconds and hit
-- the PostgREST statement timeout on every hourly run from 2026-11-18.
--
-- With (league_id, id) on the waiver rows, a single-league page is an
-- ordered index range scan that already matches the order and the cursor,
-- so the primary key walk is never cheaper.
create index if not exists idx_league_transactions_waiver_league_id
  on public.league_transactions (league_id, id)
  where type = 'waiver';
