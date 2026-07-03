-- Migration 0118: get_player_positional_finishes RPC
--
-- Season-end positional finishes (e.g. "WR5 in 2024") are NOT stored anywhere:
-- player_stats holds weekly rows, and fantasy points live inside the metadata
-- jsonb (pts_ppr / pts_half_ppr / pts_std), never as a season finish. This
-- function computes the finish on demand by summing each same-position player's
-- regular-season points for a scoring type and ranking the target player.
--
-- Finish depends only on SCORING (ppr / half_ppr / standard), not on the value
-- data source, so it returns a row per (season, scoring). The caller picks the
-- scoring that matches the active format (TE-premium formats map to their ppr
-- base since we do not store TEP-scored historical points).
--
-- Reads only public-readable tables (players, player_stats). security invoker so
-- it runs under the caller's RLS; both tables allow public SELECT. Grant execute
-- to anon + authenticated so the public profile page can call it.

create or replace function public.get_player_positional_finishes(
  p_player_id uuid,
  p_seasons integer[] default null
)
returns table (
  season integer,
  scoring text,
  finish integer,
  total_points numeric,
  players_ranked integer
)
language sql
stable
security invoker
set search_path = public
as $$
  with target as (
    select position from public.players where id = p_player_id
  ),
  keys(scoring) as (
    values ('pts_ppr'), ('pts_half_ppr'), ('pts_std')
  ),
  season_totals as (
    select
      ps.player_id,
      ps.season,
      k.scoring,
      sum(coalesce(nullif(ps.metadata ->> k.scoring, '')::numeric, 0)) as pts
    from public.player_stats ps
    join public.players p on p.id = ps.player_id
    cross join keys k
    where p.position = (select position from target)
      and ps.season_type = 'regular'
      and (p_seasons is null or ps.season = any (p_seasons))
    group by ps.player_id, ps.season, k.scoring
  ),
  ranked as (
    select
      st.season,
      st.scoring,
      st.player_id,
      st.pts,
      rank() over (partition by st.season, st.scoring order by st.pts desc) as finish,
      count(*) over (partition by st.season, st.scoring) as players_ranked
    from season_totals st
  )
  select
    r.season,
    r.scoring,
    r.finish::integer,
    r.pts,
    r.players_ranked::integer
  from ranked r
  where r.player_id = p_player_id
  order by r.season desc, r.scoring;
$$;

grant execute on function public.get_player_positional_finishes(uuid, integer[]) to anon, authenticated;

comment on function public.get_player_positional_finishes(uuid, integer[]) is
  'Computes season-end positional finish (rank within position by summed regular-season fantasy points) for a player, one row per (season, scoring in pts_ppr/pts_half_ppr/pts_std). Finishes are not stored; this derives them on demand from player_stats.metadata.';
