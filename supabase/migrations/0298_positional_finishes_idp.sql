-- Positional finishes: offense-only on the PPR keys, and IDP finishes on idp123.
--
-- Access matrix: unchanged. player_positional_finishes keeps its policies
-- (public SELECT, service-role writes). rebuild_positional_finishes stays
-- service_role only (0170/0171 grant lockdown, repeated below). The live RPC
-- get_player_positional_finishes keeps security invoker and its grants.
--
-- WHY. The rebuild ranked EVERY non-null position on PPR, half PPR and
-- standard points. For a defender those columns hold nothing meaningful (a
-- defender's stored pts_* are offensive-only), so the table held about 36,000
-- rows ranking DL, LB, DB, OL, LS, P and other positions on points they do not
-- score, and the profile printed "Last 3 finishes (PPR)" for a linebacker.
--
-- WHAT CHANGES.
--   1. scoring CHECK gains 'idp123' (Sleeper's default IDP scoring, plan D-1).
--   2. The PPR-key ranking is restricted to QB, RB, WR, TE, K, DEF.
--   3. A second insert ranks DL, LB and DB on idp123, computed from the typed
--      columns 0296 added: solo 2, assisted 1, tackle for loss 2, sack 6, QB
--      hit 1, pass defended 3, forced fumble 3, fumble recovery 3, safety 3,
--      blocked kick 3, interception 6, defensive TD 6. Only weeks the player
--      actually took a defensive snap (def_snp not null) count, so a practice
--      squad season of zero-stat rows does not pad the ranking.
--   4. get_player_positional_finishes (the parity oracle) is restricted the same
--      way: the PPR keys for the six offensive positions only, and nothing for
--      anyone else. It stays a PPR-key oracle; idp123 lives in the table.
--   5. Existing rows outside the six under the PPR keys are deleted here, so the
--      table is honest before the next nightly rebuild runs.
--
-- The idp123 rows appear the first time the rebuild runs AFTER the typed
-- columns are backfilled (IDP-110). Running it before would rank everyone at
-- zero, which is why this migration does not call it.
--
-- Plan: docs/idp/idp-guide-and-data-plan.md, task IDP-106.

alter table public.player_positional_finishes
  drop constraint if exists player_positional_finishes_scoring_check;

alter table public.player_positional_finishes
  add constraint player_positional_finishes_scoring_check
  check (scoring in ('pts_ppr', 'pts_half_ppr', 'pts_std', 'idp123'));

delete from public.player_positional_finishes
where position not in ('QB', 'RB', 'WR', 'TE', 'K', 'DEF')
  and scoring in ('pts_ppr', 'pts_half_ppr', 'pts_std');

create or replace function public.rebuild_positional_finishes()
returns integer
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '300s'
as $$
declare
  n integer;
  m integer;
begin
  -- Its own statement, NOT a CTE arm (0171 DEFECT 1).
  -- `where true` is required by safeupdate on the PostgREST connection.
  delete from public.player_positional_finishes where true;

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
      and p.position in ('QB', 'RB', 'WR', 'TE', 'K', 'DEF')
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
  )
  insert into public.player_positional_finishes
    (player_id, season, scoring, position, finish, total_points, players_ranked, computed_at)
  select player_id, season, scoring, position, finish, pts, players_ranked, now()
  from ranked;

  get diagnostics n = row_count;

  with idp_totals as (
    select
      ps.player_id,
      ps.season,
      p.position,
      sum(
        2 * coalesce(ps.idp_tkl_solo, 0)
        + 1 * coalesce(ps.idp_tkl_ast, 0)
        + 2 * coalesce(ps.idp_tkl_loss, 0)
        + 6 * coalesce(ps.idp_sack, 0)
        + 1 * coalesce(ps.idp_qb_hit, 0)
        + 3 * coalesce(ps.idp_pass_def, 0)
        + 3 * coalesce(ps.idp_ff, 0)
        + 3 * coalesce(ps.idp_fum_rec, 0)
        + 3 * coalesce(ps.idp_safe, 0)
        + 3 * coalesce(ps.idp_blk_kick, 0)
        + 6 * coalesce(ps.idp_int, 0)
        + 6 * coalesce(ps.idp_def_td, 0)
      ) as pts
    from public.player_stats ps
    join public.players p on p.id = ps.player_id
    where ps.season_type = 'regular'
      and p.position in ('DL', 'LB', 'DB')
      and ps.def_snp is not null
    group by ps.player_id, ps.season, p.position
  ),
  idp_ranked as (
    select
      season,
      position,
      player_id,
      pts,
      rank() over (partition by season, position order by pts desc) as finish,
      count(*) over (partition by season, position) as players_ranked
    from idp_totals
  )
  insert into public.player_positional_finishes
    (player_id, season, scoring, position, finish, total_points, players_ranked, computed_at)
  select player_id, season, 'idp123', position, finish, pts, players_ranked, now()
  from idp_ranked;

  get diagnostics m = row_count;
  return n + m;
end;
$$;

revoke execute on function public.rebuild_positional_finishes()
  from public, anon, authenticated;
grant execute on function public.rebuild_positional_finishes() to service_role;

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
    select position from public.players
    where id = p_player_id
      and position in ('QB', 'RB', 'WR', 'TE', 'K', 'DEF')
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
