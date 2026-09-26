-- Migration 0305: tier breaks, step one of three (plan section 7).
--
-- A tier is no longer a number on each player. It is a LINE drawn after a
-- rank: tier_breaks holds the ranks a line falls after, ascending. Tiers are
-- numbered from the top by the lines, so a 24 player board with breaks {2, 10}
-- has ranks 1-2 in tier 1, 3-10 in tier 2 and 11-24 in tier 3. A break stays at
-- its rank when players move; the players move, not the line.
--
-- Step one (this file): add tier_breaks and backfill it from the per-row tier
-- while that column still exists. Step two moves every reader to derive tiers
-- from the breaks, with saveBoardPlayers writing both representations so
-- neither goes stale. Step three (a later migration) drops `tier` and
-- `tier_count` once nothing reads them.
--
-- Backfill, per board with tiers_enabled:
--   1. Renumber rank_position into the order the reader actually SEES. The
--      editor and the public page both display a tiered board in tier order
--      (tier 1, 2, ... then "No tier"), but rows saved by older builds can be
--      stored in another order: the one tiered board in production on
--      2026-09-26 stores tiers 1,1,4,4,...,2,...,3,...,4. Deriving breaks from
--      that stored order would invent boundaries nobody sees. Renumbering is
--      also safe for the code still deployed, which re-sorts by tier anyway.
--   2. Walk the renumbered rows and draw a break wherever the tier changes,
--      including the step into the trailing "No tier" group, so every visible
--      boundary survives.
-- A board with tiers off stores null tiers and gets no breaks.
--
-- tier_labels is keyed by tier NUMBER, and the derived numbering can differ
-- from the stored one when a tier is empty. It is deliberately NOT remapped
-- here, because the deployed code still reads labels by the stored number. The
-- remap happens in step three, in the same migration that drops the per-row tier.
--
-- The cap is 29 breaks, which is the old 30 tier maximum.
--
-- Access matrix: UNCHANGED (new column on an already-protected table).

alter table public.user_ranking_boards
  add column if not exists tier_breaks integer[] not null default '{}'::integer[];

alter table public.user_ranking_boards
  drop constraint if exists chk_ranking_board_tier_breaks;
alter table public.user_ranking_boards
  add constraint chk_ranking_board_tier_breaks
  check (
    cardinality(tier_breaks) <= 29
    and array_position(tier_breaks, null) is null
    and (cardinality(tier_breaks) = 0 or tier_breaks[1] >= 1)
  );

with ordered as (
  select p.id,
         row_number() over (
           partition by p.board_id
           order by p.tier nulls last, p.rank_position, p.id
         ) as new_rank
  from public.user_ranking_board_players p
  join public.user_ranking_boards b on b.id = p.board_id
  where b.tiers_enabled
)
update public.user_ranking_board_players p
  set rank_position = o.new_rank
  from ordered o
  where o.id = p.id and p.rank_position is distinct from o.new_rank;

with seq as (
  select p.board_id, p.rank_position, p.tier,
         lead(p.tier) over (partition by p.board_id order by p.rank_position) as next_tier,
         lead(p.rank_position) over (partition by p.board_id order by p.rank_position) as next_rank
  from public.user_ranking_board_players p
  join public.user_ranking_boards b on b.id = p.board_id
  where b.tiers_enabled
),
breaks as (
  select board_id,
         (array_agg(rank_position order by rank_position))[1:29] as tier_breaks
  from seq
  where next_rank is not null and next_tier is distinct from tier
  group by board_id
)
update public.user_ranking_boards b
  set tier_breaks = br.tier_breaks
  from breaks br
  where br.board_id = b.id;
