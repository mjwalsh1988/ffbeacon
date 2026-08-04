-- Migration 0171: make rebuild_positional_finishes() actually re-runnable
--
-- Found while verifying that migration 0170's grant lockdown did not break the
-- nightly positional-finishes rebuild. The lockdown is fine (service_role kept
-- EXECUTE), but running the job end to end surfaced two defects that have been
-- latent since 0144. Neither has bitten yet only because the stats sync has been
-- returning `skipped` all offseason, so the rebuild has not been called since the
-- first run on an empty table. Both would fire on the first real sync of the 2026
-- season.
--
-- DEFECT 1: the rebuild could only ever succeed once
--
-- The wipe was a data-modifying CTE in the same statement as the INSERT:
--
--   with ... , wiped as (delete from player_positional_finishes where true ...)
--   insert into player_positional_finishes ... select ... from ranked
--
-- Every arm of a statement with data-modifying CTEs sees the same snapshot, and
-- the sub-statements cannot see each other's effects. The unique index, however,
-- is physical: the rows the CTE is deleting are still indexed when the INSERT
-- probes for conflicts. So on any NON-EMPTY table the INSERT collides with the
-- rows being deleted and the whole call aborts:
--
--   23505 duplicate key value violates unique constraint
--         "player_positional_finishes_pkey"
--   Key (player_id, season, scoring)=(..., 2020, pts_half_ppr) already exists.
--
-- Reproduced against production data in a rolled-back transaction. The fix is to
-- make the DELETE its own statement. Atomicity is unchanged: a plpgsql function
-- body already runs inside one transaction, so readers still see the previous
-- snapshot until commit and never an empty table, which is what the 0144 header
-- promised and still holds.
--
-- DEFECT 2: the rebuild takes longer than the connection is allowed to run
--
-- It is called over PostgREST (`/rest/v1/rpc/rebuild_positional_finishes`) from
-- the cron route and the CLI script. PostgREST connects as `authenticator` and
-- then SET ROLE service_role. `authenticator` carries statement_timeout=8s and
-- `service_role` sets no override of its own, so the call inherits 8 seconds:
--
--   57014 canceling statement due to statement timeout
--
-- The rebuild measures 12.6 seconds on current data (48,615 rows across 6 seasons
-- and 3 scoring bases) and only grows with each season. A function-scoped
-- `SET statement_timeout` is applied on entry and lifts the ceiling for the
-- duration of this call only, which is verified below and leaves every other
-- query in the system still capped at 8 seconds. 300s is roughly 24x current
-- runtime, so it has years of headroom without being an open-ended licence.
--
-- Deliberately NOT done: raising statement_timeout on the service_role role. That
-- would lift the cap for every server-side query in the app, turning one slow job
-- into a system-wide loss of protection.
--
-- KEEP THE `where true`
--
-- The wipe reads `delete ... where true`, which looks redundant and is not. The
-- PostgREST connection preloads the `safeupdate` library (`authenticator` carries
-- session_preload_libraries=supautils, safeupdate), which rejects any DELETE or
-- UPDATE with no WHERE clause:
--
--   21000 DELETE requires a WHERE clause
--
-- That guard is why 0144 wrote it this way. Dropping it passes a direct psql or
-- MCP session, where safeupdate is not loaded, and then fails only when called
-- through the app. Anything touching this function must be tested through the
-- real RPC path, not just in a SQL console.
--
-- VERIFIED:
--   * in a rolled-back transaction with the session pinned to statement_timeout=8s,
--     the call completed and returned 48,615 rows, byte-identical to the row count
--     already stored, so the output is unchanged and only the mechanism differs
--   * no duplicate-key error on a table that already held every one of those rows
--   * end to end through PostgREST via `npm run calculate:finishes`, which is the
--     exact path the nightly cron route uses
--
-- Grants are re-asserted at the end. `create or replace` preserves the existing
-- ACL, but Supabase's default privileges grant EXECUTE on new functions in public
-- to anon and authenticated, and 0144's `revoke all ... from public` did not
-- remove those two NAMED grants (revoking from PUBLIC is not the same as revoking
-- from a role that holds an explicit grant). That is how anon ended up able to
-- call this at all. Naming both roles here keeps 0170's lockdown in force no
-- matter how the ACL is re-derived.
--
-- Access matrix: unchanged from 0170. service_role only.

create or replace function public.rebuild_positional_finishes()
returns integer
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '300s'
as $$
declare
  n integer;
begin
  -- Its own statement, NOT a CTE arm: see DEFECT 1 above.
  -- `where true` is required by safeupdate on the PostgREST connection: see above.
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
  )
  insert into public.player_positional_finishes
    (player_id, season, scoring, position, finish, total_points, players_ranked, computed_at)
  select player_id, season, scoring, position, finish, pts, players_ranked, now()
  from ranked;

  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function public.rebuild_positional_finishes()
  from public, anon, authenticated;
grant execute on function public.rebuild_positional_finishes() to service_role;
