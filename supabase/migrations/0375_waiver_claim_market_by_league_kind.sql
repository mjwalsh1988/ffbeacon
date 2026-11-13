-- Migration 0375: waiver_claim_market() reads one league pool at a time.
--
-- Access matrix:
--   function public.waiver_claim_market(int, int, int, text)   (new)
--     service_role : EXECUTE
--     anon, authenticated, public : no EXECUTE (revoked by name, all three)
--   function public.waiver_claim_market(int, int, int)          (unchanged)
--   No table, column, index or policy changes.
--
-- WHY
--   The waiver wire board prices a player partly from his own auctions in the
--   run just gone. The three-argument function pooled every redraft, keeper
--   and dynasty league into one distribution (it left out only chopped), so a
--   redraft board quoted a price pulled toward what dynasty rooms paid for the
--   same player, and the other way round. A dynasty room is buying years of a
--   player and a redraft room the rest of one season, so those are different
--   prices for different decisions.
--
--   The new overload takes the pool and reads only leagues in it. The pool is
--   decided exactly as lib/faab/priors-load.ts leagueKindFor decides it, on
--   Sleeper's own league type: 3 is chopped, 2 is dynasty, everything else
--   (redraft, keeper, and a league with no type recorded) is redraft. Keeper
--   prices as redraft on purpose: it keeps a handful of players and drafts the
--   rest, so its in-season wire behaves like a redraft one.
--
--   A pool name that is not one of the three matches no league and returns no
--   rows, never the pooled answer.
--
--   The three-argument function is left in place so the code already deployed
--   keeps working until the new build is live. Nothing in the repository calls
--   it after this change, and a later migration can drop it.

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
      and p_league_kind in ('redraft', 'dynasty', 'chopped')
      and (
        case coalesce(l.metadata->'settings'->>'type', '0')
          when '3' then 'chopped'
          when '2' then 'dynasty'
          else 'redraft'
        end
      ) = p_league_kind
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

revoke all on function public.waiver_claim_market(int, int, int, text) from public;
revoke all on function public.waiver_claim_market(int, int, int, text) from anon;
revoke all on function public.waiver_claim_market(int, int, int, text) from authenticated;
grant execute on function public.waiver_claim_market(int, int, int, text) to service_role;
