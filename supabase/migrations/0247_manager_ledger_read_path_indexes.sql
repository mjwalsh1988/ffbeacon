-- Migration 0247: indexes for the Manager Ledger read path
--
-- Two changes, both from measuring the queries the feature actually issues.
--
-- 1. draft_selections had no index for (sleeper_league_id, season).
--
--    The ledger reads a league's picks by that pair, and so does the cheap
--    fingerprint gate that runs on every view of the Decisions page. Measured
--    on production at 38,643 rows it was a sequential scan discarding 38,643
--    rows in 17.9ms. That is survivable today and it will not stay that way:
--    this table is the global pick ledger, fed by On The Clock as well as by
--    League Pulse, so it grows without bound. At a million rows the same scan
--    is roughly half a second on a page-path query.
--
--    Partial on `sleeper_league_id is not null`, because rows ingested from a
--    bare draft id carry no league.
--
-- 2. league_manager_ledger_cache had a redundant index.
--
--    Migration 0244 created idx_league_manager_ledger_cache_league on
--    (league_id, season), which is a strict PREFIX of the unique constraint on
--    (league_id, season, sleeper_roster_id). Postgres serves every query this
--    feature issues from the unique index, so the extra one buys nothing and
--    costs write amplification on every upsert plus its own storage. Dropped.
--
-- Access matrix (unchanged; neither change adds or exposes an object):
--   anon          : SELECT on both tables, per their existing policies
--   authenticated : SELECT on both tables, per their existing policies
--   service_role  : ALL
--   client writes : BLOCKED

create index if not exists idx_draft_selections_league_season
  on public.draft_selections (sleeper_league_id, season)
  where sleeper_league_id is not null;

comment on index public.idx_draft_selections_league_season is
  'Covers the Manager Ledger pick read and its fingerprint count, both keyed on (sleeper_league_id, season).';

drop index if exists public.idx_league_manager_ledger_cache_league;
