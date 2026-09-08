-- Migration 0272: player_market_latest becomes a real table (PERF-T012)
--
-- Access matrix:
--   anon          : SELECT only  (public draft-market data, same as player_market_snapshots)
--   authenticated : SELECT only
--   service_role  : ALL          (written only by the nightly market sync)
--   client writes : BLOCKED (no anon/auth INSERT/UPDATE/DELETE policy exists)
--
-- Why. player_market_latest was a view running
-- `select distinct on (source, season_type, sleeper_player_id) ...
-- order by source, season_type, sleeper_player_id, snapshot_date desc`
-- over player_market_snapshots on every call. The unique index on that table
-- is (source, season_type, season, sleeper_player_id, snapshot_date), with
-- season sitting between season_type and sleeper_player_id, so it cannot
-- serve the view's ordering. At 109,754 snapshot rows this forced a full
-- sequential scan plus an external merge sort spilling to disk on every
-- read (measured: 659 ms scan, 16 MB disk sort, 1,330 ms total; 491 calls
-- at 611 to 859 ms mean). The only production reader,
-- lib/breakdown/load-extras.ts loadAdp(), pays this once per Beacon
-- Breakdown comparison.
--
-- The fix: maintain a real table instead of recomputing "latest" on every
-- read. lib/sync-sleeper-market.ts upserts the freshly synced rows into
-- this table right after it writes them to player_market_snapshots, since
-- a row just written for today is by definition the newest for its
-- (source, season_type, sleeper_player_id) key. No read-back query is
-- needed to know what "latest" means.
--
-- The old view is kept as player_market_latest_view for one release so
-- nothing breaks mid-deploy. It is dropped in a later migration once the
-- sync has run at least once in production against the new table.
--
-- Column types were checked against the live view, not assumed from the
-- earlier draft of this migration: `adp` is jsonb (a map keyed by format,
-- e.g. {"ppr": 105.3, "dynasty_2qb": 88.1}), not numeric. `metadata`,
-- `created_at` and `id` are dropped: no reader selects them, and this table
-- is a derived "latest row" projection of player_market_snapshots (which
-- already carries `metadata`), matching the "pre-calculated tables do not
-- need their own metadata column" rule.
--
-- Primary key: NOT player_id. Checked on live data before committing to
-- this: player_market_latest held 3,635 rows over only 3,142 distinct
-- player_id values, because more than one source (today: sleeper and
-- dynastyprocess) can carry a market row for the same player. player_id
-- alone is not unique. (source, season_type, sleeper_player_id) is exactly
-- the view's own DISTINCT ON grouping and IS unique on live data
-- (3,635 rows, 3,635 distinct triples), so that triple is the primary key,
-- with a plain index on player_id to keep the one real caller's
-- `.in("player_id", playerIds)` lookup fast.
alter view public.player_market_latest rename to player_market_latest_view;

create table public.player_market_latest (
  source text not null,
  season integer not null,
  season_type text not null,
  snapshot_date date not null,
  sleeper_player_id text not null,
  player_id uuid references public.players (id) on delete cascade,
  adp jsonb not null default '{}'::jsonb,
  projected_pts_ppr numeric,
  projected_pts_half_ppr numeric,
  projected_pts_std numeric,
  updated_at timestamptz not null default now(),
  primary key (source, season_type, sleeper_player_id)
);

-- The one real caller filters on player_id alone (lib/breakdown/load-extras.ts
-- loadAdp), never on the primary key triple.
create index idx_player_market_latest_player_id
  on public.player_market_latest (player_id);

alter table public.player_market_latest enable row level security;

drop policy if exists player_market_latest_select_public on public.player_market_latest;
create policy player_market_latest_select_public on public.player_market_latest
  for select to anon, authenticated using (true);

drop policy if exists player_market_latest_service_role_all on public.player_market_latest;
create policy player_market_latest_service_role_all on public.player_market_latest
  for all to service_role using (true) with check (true);

comment on table public.player_market_latest is
  'The newest player_market_snapshots row per (source, season_type, sleeper_player_id), maintained as a real table by lib/sync-sleeper-market.ts rather than recomputed per read. Public SELECT; writes via the service-role market sync only. Superseded the player_market_latest_view DISTINCT ON view (PERF-T012).';

-- One-time seed from the view so the table is populated before the first
-- sync run lands. Filtered to non-null player_id because the sole reader
-- keys on player_id; a row with no resolved player can be re-linked on its
-- next sync and will upsert in then.
insert into public.player_market_latest
  (source, season, season_type, snapshot_date, sleeper_player_id, player_id,
   adp, projected_pts_ppr, projected_pts_half_ppr, projected_pts_std)
select source, season, season_type, snapshot_date, sleeper_player_id, player_id,
       adp, projected_pts_ppr, projected_pts_half_ppr, projected_pts_std
  from public.player_market_latest_view
 where player_id is not null
on conflict (source, season_type, sleeper_player_id) do nothing;
