-- Migration 0143: index the cross-league trade lookup
--
-- #5 (performance): findPlayerTrades() locates every trade involving a player by
-- key-matching the player's Sleeper id inside the adds/drops jsonb maps. With no
-- jsonb index this seq-scans league_transactions on every profile Overview and
-- Trades tab.
--
-- We index adds/drops with the DEFAULT jsonb_ops GIN opclass (NOT jsonb_path_ops):
-- only jsonb_ops supports the `?` key-exists operator, and key-exists (does this
-- player id appear as a key, with any value) is exactly the lookup. jsonb_path_ops
-- supports only containment (@>), which cannot express "key exists with any value"
-- because the value (the receiving roster id) is not known at query time.
--
-- PostgREST exposes no key-exists filter operator, so the lookup goes through a
-- small SECURITY INVOKER RPC whose `adds ? p OR drops ? p` predicate the planner
-- serves via a BitmapOr over the two GIN indexes. RLS on league_transactions
-- (public SELECT) still applies to the caller.
--
-- No RLS/access change to the table: indexes + one read-only function.

create index if not exists idx_league_transactions_adds_gin
  on public.league_transactions using gin (adds);
create index if not exists idx_league_transactions_drops_gin
  on public.league_transactions using gin (drops);

create or replace function public.find_player_trade_transactions(
  p_sleeper_id text,
  p_limit integer default 30
)
returns setof public.league_transactions
language sql
stable
set search_path to 'public'
as $$
  select *
  from public.league_transactions
  where type = 'trade'
    and (adds ? p_sleeper_id or drops ? p_sleeper_id)
  order by created_at_sleeper desc nulls last
  limit greatest(1, least(coalesce(p_limit, 30), 100));
$$;

grant execute on function public.find_player_trade_transactions(text, integer)
  to anon, authenticated, service_role;
