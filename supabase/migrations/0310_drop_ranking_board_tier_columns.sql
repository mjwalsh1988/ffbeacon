-- Migration 0310: drop the per-row tier and tier_count, step three of three
-- (plan section 7).
--
-- !!! DO NOT APPLY UNTIL THE BEACON RANKER CODE IS DEPLOYED !!!
-- The code deployed before Beacon Ranker selects user_ranking_board_players.tier
-- and user_ranking_boards.tier_count. Applying this while that code is live
-- breaks My Rankings and every public board page. The new code reads and writes
-- neither column, so this is safe the moment it is live. Written 2026-09-26,
-- deliberately NOT applied in the build session.
--
-- Before dropping, two catch-ups for boards the OLD code edited between
-- migration 0305 (2026-09-26) and the deploy:
--   1. A board the old code tiered after 0305 ran has per-row tiers but empty
--      tier_breaks. Re-derive its breaks the same way 0305 did (display order,
--      a break at every tier change). Boards whose breaks are already set are
--      left alone: the new code owns them.
--   2. tier_labels is keyed by tier NUMBER. Remap each board's labels to the
--      derived numbering, which differs from the stored one when a stored tier
--      was empty. 0305 left labels alone because the old code still read them.
--
-- Access matrix: UNCHANGED.

with ordered as (
  select p.id,
         row_number() over (
           partition by p.board_id
           order by p.tier nulls last, p.rank_position, p.id
         ) as new_rank
  from public.user_ranking_board_players p
  join public.user_ranking_boards b on b.id = p.board_id
  where b.tiers_enabled and cardinality(b.tier_breaks) = 0
    and exists (
      select 1 from public.user_ranking_board_players q
      where q.board_id = b.id and q.tier is not null
    )
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
  where b.tiers_enabled and cardinality(b.tier_breaks) = 0
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

-- Label remap: the n-th distinct stored tier (in display order) becomes tier n.
with distinct_tiers as (
  select p.board_id, p.tier,
         dense_rank() over (partition by p.board_id order by p.tier) as new_tier
  from (select distinct board_id, tier from public.user_ranking_board_players where tier is not null) p
),
remapped as (
  select b.id as board_id,
         coalesce(
           jsonb_object_agg(d.new_tier::text, b.tier_labels -> d.tier::text)
             filter (where b.tier_labels ? d.tier::text),
           '{}'::jsonb
         ) as labels
  from public.user_ranking_boards b
  join distinct_tiers d on d.board_id = b.id
  where b.tier_labels <> '{}'::jsonb
  group by b.id
)
update public.user_ranking_boards b
  set tier_labels = r.labels
  from remapped r
  where r.board_id = b.id;

alter table public.user_ranking_board_players drop column if exists tier;
alter table public.user_ranking_boards drop column if exists tier_count;
