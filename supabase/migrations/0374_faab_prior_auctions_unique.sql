-- 0374_faab_prior_auctions_unique.sql
--
-- Review fixes to 0372 and 0373.
--
-- 1. One kept auction per (league, season, week, player), enforced. The lease
--    in 0373 keeps two passes from running at once, but a lease is a promise
--    about time: a run that outlives it (a hand-run script slice, a stalled
--    request) lets a second run clear and re-insert the same league beside
--    it, and every auction stored twice double-weights each quantile that
--    league feeds, with nothing to show it happened. lib/faab/league-load.ts
--    groupAuctions already yields exactly one auction per (season, week,
--    player) per league, so the key is the sample's natural one. With it, an
--    interleaved insert fails and the batch is retried instead of doubled.
--    Checked before applying: 0 duplicate groups in 101,214 rows.
--
--    The plain league_id index is dropped: the unique index leads with
--    league_id and serves the same deletes and the cascade.
--
-- 2. faab_market_priors keeps SELECT only for anon and authenticated. 0373
--    took the default write grants off the three new tables and left this
--    one, the table those migrations reshaped, with INSERT, UPDATE, DELETE
--    and TRUNCATE still granted. RLS blocks the first three; TRUNCATE is not
--    governed by RLS at all.
--
-- ACCESS MATRIX after this migration
--   table                     anon     authenticated   service_role
--   faab_market_priors        SELECT   SELECT          ALL
--   faab_prior_auctions       none     none            ALL   (unchanged)

create unique index if not exists faab_prior_auctions_league_season_week_player_key
  on public.faab_prior_auctions (league_id, season, week, player_sleeper_id);

drop index if exists public.idx_faab_prior_auctions_league;

revoke insert, update, delete, truncate, references, trigger
  on table public.faab_market_priors from anon, authenticated;
