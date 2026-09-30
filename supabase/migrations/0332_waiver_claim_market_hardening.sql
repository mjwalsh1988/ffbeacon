-- Migration 0332: harden waiver_claim_market(), index its scan, and add
-- waiver_budget_spread().
--
-- Access matrix:
--   function public.waiver_claim_market(int, int, int)   (replaced, same grants)
--   function public.waiver_budget_spread(int)             (new)
--     service_role : EXECUTE
--     anon, authenticated, public : no EXECUTE (revoked by name, all three)
--   index idx_league_transactions_waiver_season_week on league_transactions
--   No table, column or policy changes.
--
-- WHY
--   Security review of 0331. A waiver_bid or waiver_budget that is not a plain
--   number ("abc", true) made the ::numeric cast throw and failed the function
--   for every player, and the strings "NaN" and "Infinity" cast without error
--   and priced a claim at 100 percent. Both casts now accept only an unsigned
--   decimal and read anything else as missing, which skips that auction.
--
--   The only index that fit the scan was the one on type alone, and 'waiver'
--   is about half the table. The partial index below covers exactly the rows
--   the function reads, in the order it filters them, so the cost tracks one
--   season's weeks rather than the whole table as more leagues sync.
--
--   waiver_budget_spread() replaces paging every league of the season into the
--   app to count five budgets. The waiver page quotes the split to explain why
--   its bids are percentages.

create index if not exists idx_league_transactions_waiver_season_week
  on public.league_transactions (season, week)
  where type = 'waiver' and status in ('complete', 'failed');

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
  ),
  budgets as (
    select
      l.id as league_id,
      case
        when l.metadata->'settings'->>'waiver_budget' ~ '^[0-9]+(\.[0-9]+)?$'
          then (l.metadata->'settings'->>'waiver_budget')::numeric
      end as budget
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

create or replace function public.waiver_budget_spread(p_season int)
returns table (budget numeric, leagues int)
language sql
stable
security invoker
set search_path = public
as $$
  select
    (l.metadata->'settings'->>'waiver_budget')::numeric as budget,
    count(*)::int as leagues
  from public.leagues l
  where l.season = p_season
    and l.metadata->'settings'->>'waiver_budget' ~ '^[0-9]+(\.[0-9]+)?$'
    and (l.metadata->'settings'->>'waiver_budget')::numeric > 0
  group by 1
$$;

revoke all on function public.waiver_budget_spread(int) from public;
revoke all on function public.waiver_budget_spread(int) from anon;
revoke all on function public.waiver_budget_spread(int) from authenticated;
grant execute on function public.waiver_budget_spread(int) to service_role;
