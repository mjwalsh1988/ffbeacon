-- #2 (performance): full rebuild of the player_positional_finishes cache, run
-- nightly after the stats sync and on demand via `npm run calculate:finishes`.
--
-- Mirrors get_player_positional_finishes exactly (rank within position by summed
-- regular-season fantasy points per scoring base) but for ALL players at once,
-- and reads the denormalized pts_* columns (migration 0141) instead of parsing
-- metadata jsonb per row. Verified byte-for-byte identical to the RPC across a
-- 25-player mixed-position sample. Runs inside one transaction, so the wipe +
-- insert is atomic: concurrent readers see the prior snapshot until commit,
-- never an empty table.
--
-- SECURITY DEFINER (owned by the migration role) so the wipe always has
-- privileges; EXECUTE restricted to service_role so only server-side jobs rebuild.

create or replace function public.rebuild_positional_finishes()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  n integer;
begin
  with season_totals as (
    select
      ps.player_id,
      ps.season,
      p.position,
      k.scoring,
      sum(
        coalesce(
          case k.scoring
            when 'pts_ppr' then ps.pts_ppr
            when 'pts_half_ppr' then ps.pts_half_ppr
            else ps.pts_std
          end,
          0
        )
      ) as pts
    from public.player_stats ps
    join public.players p on p.id = ps.player_id
    cross join (values ('pts_ppr'), ('pts_half_ppr'), ('pts_std')) as k(scoring)
    where ps.season_type = 'regular'
      and p.position is not null
    group by ps.player_id, ps.season, p.position, k.scoring
  ),
  ranked as (
    select
      season,
      scoring,
      position,
      player_id,
      pts,
      rank() over (partition by season, scoring, position order by pts desc) as finish,
      count(*) over (partition by season, scoring, position) as players_ranked
    from season_totals
  ),
  wiped as (
    delete from public.player_positional_finishes where true returning 1
  )
  insert into public.player_positional_finishes
    (player_id, season, scoring, position, finish, total_points, players_ranked, computed_at)
  select player_id, season, scoring, position, finish, pts, players_ranked, now()
  from ranked;

  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.rebuild_positional_finishes() from public;
grant execute on function public.rebuild_positional_finishes() to service_role;
