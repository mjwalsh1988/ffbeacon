-- Migration 0377: waiver_claim_market(int, int, int, text) reads the kept
-- auction sample instead of re-deriving auctions from league_transactions.
--
-- Access matrix:
--   function public.waiver_claim_market(int, int, int, text)   (replaced, same grants)
--     service_role : EXECUTE
--     anon, authenticated, public : no EXECUTE (revoked by name, all three)
--   No table, column, index or policy changes.
--
-- WHY
--   0376 fixed the plan for a late-season window (6.7 seconds down to 2.0) and
--   then an early-season one was measured: weeks 1 to 2 of 2026 hold 96,000
--   waiver rows and took 31 seconds, and the three-argument function this
--   replaces took 12 on the same window. PostgREST gives an rpc eight. Both
--   were reading the whole Sleeper transaction object for every bid in the
--   window to rebuild auctions that are already built.
--
--   faab_prior_auctions (migration 0372) holds exactly those auctions, one
--   small row each: the winning bid as a share of the budget, the bidder
--   count, the week, the player, and the league kind. It is written by
--   lib/faab/priors-load.ts through the same grouping rule this function used
--   to repeat in SQL (lib/faab/league-load.ts groupAuctions: one sole add, a
--   real bid, exactly one winner, losers counted only when they lost to a
--   rival), and its league_kind is written by leagueKindFor. So the pool a
--   claim price comes from and the pool a market cell comes from are now
--   decided by ONE classifier in one place, rather than by a SQL CASE that had
--   to be kept in step with it.
--
--   The sample is refreshed by /api/cron/faab-priors at minute 25 of every
--   hour, reading only the leagues whose waiver rows changed. The board that
--   calls this is itself cached for an hour, so a claim can now take up to
--   about two hours to show rather than one. That is the trade for a read
--   that takes milliseconds in every week of the season.
--
--   A pool name that is not one of the three still returns no rows.

create or replace function public.waiver_claim_market(
  p_season int,
  p_from_week int,
  p_to_week int,
  p_league_kind text
)
returns table (
  sleeper_player_id text,
  auctions int,
  leagues int,
  avg_bidders numeric,
  contested_share numeric,
  p25 numeric,
  p50 numeric,
  p75 numeric,
  p90 numeric,
  latest_week int
)
language sql
stable
security invoker
set search_path = public
as $$
  with priced as (
    select
      a.player_sleeper_id as player_id,
      a.league_id,
      a.week,
      a.bidder_count as bidders,
      least(100, greatest(0, a.winning_pct)) as pct
    from public.faab_prior_auctions a
    where a.season = p_season
      and a.week between p_from_week and p_to_week
      and a.league_kind = p_league_kind
      and p_league_kind in ('redraft', 'dynasty', 'chopped')
  )
  select
    player_id as sleeper_player_id,
    count(*)::int as auctions,
    count(distinct league_id)::int as leagues,
    round(avg(bidders), 2) as avg_bidders,
    round(avg(case when bidders >= 2 then 1 else 0 end), 3) as contested_share,
    round(percentile_cont(0.25) within group (order by pct)::numeric, 2) as p25,
    round(percentile_cont(0.50) within group (order by pct)::numeric, 2) as p50,
    round(percentile_cont(0.75) within group (order by pct)::numeric, 2) as p75,
    round(percentile_cont(0.90) within group (order by pct)::numeric, 2) as p90,
    max(week)::int as latest_week
  from priced
  group by player_id
$$;

revoke all on function public.waiver_claim_market(int, int, int, text) from public;
revoke all on function public.waiver_claim_market(int, int, int, text) from anon;
revoke all on function public.waiver_claim_market(int, int, int, text) from authenticated;
grant execute on function public.waiver_claim_market(int, int, int, text) to service_role;
