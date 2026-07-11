-- Migration 0124: fix get_player_positional_finishes dual-path points read
--
-- Bug: the season_totals CTE in 0118_player_positional_finishes.sql read fantasy
-- points from the flat path player_stats.metadata->>key (e.g. metadata->>'pts_ppr').
-- The real stat rows nest the raw stat map under metadata->'stats', so the flat
-- read always resolved to null, total_points summed to 0 for every player, and
-- rank() over an all-zero partition tied every player at finish = 1 for every
-- season and scoring type. The player-page finishes feature silently showed
-- wrong data (everyone tied for 1st) instead of erroring.
--
-- Fix: prefer the nested metadata->'stats'->>key path, falling back to the flat
-- metadata->>key path, matching the readPoints() dual-path convention in
-- lib/player-profile.ts (rows synced from api.sleeper.com nest stats under
-- .stats; older rows stored the flat stat object directly).
--
-- Signature, return table, language, volatility, security mode, and search_path
-- are unchanged from 0118. The only behavioral change is the points read inside
-- season_totals.

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
      sum(
        coalesce(
          nullif(ps.metadata -> 'stats' ->> k.scoring, '')::numeric,
          nullif(ps.metadata ->> k.scoring, '')::numeric,
          0
        )
      ) as pts
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
  'Computes season-end positional finish (rank within position by summed regular-season fantasy points) for a player, one row per (season, scoring in pts_ppr/pts_half_ppr/pts_std). Finishes are not stored; this derives them on demand from player_stats.metadata, preferring the nested metadata->stats->>key path and falling back to the flat metadata->>key path (matches lib/player-profile.ts readPoints).';
