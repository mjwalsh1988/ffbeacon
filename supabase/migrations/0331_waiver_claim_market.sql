-- Migration 0331: waiver_claim_market(), what each player actually cost on
-- waivers in the synced leagues over a window of weeks.
--
-- Access matrix:
--   function public.waiver_claim_market(int, int, int)
--     service_role : EXECUTE
--     anon, authenticated, public : no EXECUTE (revoked by name, all three,
--       because revoking from public alone leaves Supabase's named grants)
--   No table, column, policy or grant on any table changes.
--
-- WHY
--   The waiver wire board (/waiver-wire and /waiver-wire/week-N) used to price
--   every claim off the old rank-and-value curve in lib/faab/calculate-faab.ts.
--   Waiver players sit a long way down any value ranking, so that curve put
--   nearly every one of them in its deep-flyer band and printed "$0-2" beside
--   a running back who had just cleared at a median of 40 percent of budget in
--   64 real leagues. The board now reads the same measured market the FAAB
--   calculator reads (faab_market_priors), plus this: the player's OWN recent
--   auctions.
--
--   Aggregating in SQL rather than paging rows into the app: one early-season
--   week holds 27,000 waiver rows, and the page needs about 160 players' worth
--   of five numbers each. EXPLAIN on production for two weeks of 2026: 370 ms.
--
-- WHAT COUNTS AS AN AUCTION, mirroring lib/faab/league-load.ts groupAuctions:
--   one (league, week, player) group with exactly one completed claim. The
--   bidders are the winner plus every failed claim whose note says another
--   owner took him. A claim that adds more than one player is skipped, because
--   its bid cannot be pinned to either. The winning bid is a share of that
--   league's published waiver_budget; a league with no budget cannot be
--   expressed as a share and is skipped. Chopped leagues (Sleeper type 3) are
--   left out: a shrinking field prices a different market entirely.
--
-- Nothing identifying leaves the function: no league id, roster or manager,
-- only counts and quantiles per player.

create or replace function public.waiver_claim_market(
  p_season int,
  p_from_week int,
  p_to_week int
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
  with claims as (
    select
      lt.league_id,
      lt.week,
      lt.status,
      (select k from jsonb_object_keys(lt.adds) as k limit 1) as player_id,
      (select count(*) from jsonb_object_keys(lt.adds)) as add_count,
      nullif(lt.metadata->'settings'->>'waiver_bid', '')::numeric as bid,
      lower(coalesce(lt.metadata->'metadata'->>'notes', '')) as notes
    from public.league_transactions lt
    where lt.type = 'waiver'
      and lt.season = p_season
      and lt.week between p_from_week and p_to_week
      and lt.status in ('complete', 'failed')
      and jsonb_typeof(lt.adds) = 'object'
  ),
  budgets as (
    select
      l.id as league_id,
      nullif(l.metadata->'settings'->>'waiver_budget', '')::numeric as budget
    from public.leagues l
    where l.id in (select distinct league_id from claims)
      and coalesce(l.metadata->'settings'->>'type', '0') <> '3'
  ),
  auctions as (
    select
      c.league_id,
      c.week,
      c.player_id,
      count(*) filter (where c.status = 'complete') as wins,
      count(*) filter (
        where c.status = 'complete'
           or c.notes like 'this player was claimed by another owner%'
      ) as bidders,
      max(c.bid) filter (where c.status = 'complete') as winning_bid,
      max(b.budget) as budget
    from claims c
    join budgets b on b.league_id = c.league_id
    where c.add_count = 1
      and c.player_id is not null
      and c.bid is not null
      and c.bid >= 0
      and b.budget > 0
    group by c.league_id, c.week, c.player_id
  ),
  priced as (
    select
      player_id,
      league_id,
      week,
      bidders,
      least(100, winning_bid / budget * 100) as pct
    from auctions
    where wins = 1
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

revoke all on function public.waiver_claim_market(int, int, int) from public;
revoke all on function public.waiver_claim_market(int, int, int) from anon;
revoke all on function public.waiver_claim_market(int, int, int) from authenticated;
grant execute on function public.waiver_claim_market(int, int, int) to service_role;
