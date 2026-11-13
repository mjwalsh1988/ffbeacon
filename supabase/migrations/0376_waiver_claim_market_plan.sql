-- Migration 0376: pin the plan of waiver_claim_market(int, int, int, text).
--
-- Access matrix:
--   function public.waiver_claim_market(int, int, int, text)   (replaced, same grants)
--     service_role : EXECUTE
--     anon, authenticated, public : no EXECUTE (revoked by name, all three)
--   No table, column, index or policy changes.
--
-- WHY
--   Review of 0375 measured the new overload at 6.7 seconds against 1.1 for
--   the three-argument one, on the same window. The results were right; the
--   plan was not. With the league kind in the budgets filter the planner
--   stopped building budgets once per league and instead looked the league up
--   once PER CLAIM ROW, reading the league's whole metadata object each time.
--   PostgREST gives an rpc eight seconds, so an early-season week, which
--   holds several times the claims, would have timed out and left the board
--   priced from market cells alone with no claims section.
--
--   Both CTEs are now MATERIALIZED, which is the shape the old function ran
--   in: read the window's claims once, then read each league in them once.
--   Nothing about what the function returns has changed.

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
  with claims as materialized (
    select
      lt.league_id,
      lt.week,
      lt.status,
      (select k from jsonb_object_keys(lt.adds) as k limit 1) as player_id,
      (select count(*) from jsonb_object_keys(lt.adds)) as add_count,
      case
        when lt.metadata->'settings'->>'waiver_bid' ~ '^[0-9]+(\.[0-9]+)?$'
          then (lt.metadata->'settings'->>'waiver_bid')::numeric
      end as bid,
      lower(coalesce(lt.metadata->'metadata'->>'notes', '')) as notes
    from public.league_transactions lt
    where lt.type = 'waiver'
      and lt.season = p_season
      and lt.week between p_from_week and p_to_week
      and lt.status in ('complete', 'failed')
      and jsonb_typeof(lt.adds) = 'object'
      and p_league_kind in ('redraft', 'dynasty', 'chopped')
  ),
  claim_leagues as materialized (
    select distinct league_id from claims
  ),
  budgets as materialized (
    select
      l.id as league_id,
      case
        when l.metadata->'settings'->>'waiver_budget' ~ '^[0-9]+(\.[0-9]+)?$'
          then (l.metadata->'settings'->>'waiver_budget')::numeric
      end as budget,
      case coalesce(l.metadata->'settings'->>'type', '0')
        when '3' then 'chopped'
        when '2' then 'dynasty'
        else 'redraft'
      end as league_kind
    from public.leagues l
    join claim_leagues cl on cl.league_id = l.id
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
      and b.budget > 0
      and b.league_kind = p_league_kind
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

revoke all on function public.waiver_claim_market(int, int, int, text) from public;
revoke all on function public.waiver_claim_market(int, int, int, text) from anon;
revoke all on function public.waiver_claim_market(int, int, int, text) from authenticated;
grant execute on function public.waiver_claim_market(int, int, int, text) to service_role;
