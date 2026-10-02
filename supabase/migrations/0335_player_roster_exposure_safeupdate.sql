-- Migration 0335: let rebuild_player_roster_exposure run through PostgREST
--
-- What was wrong
--   The function opened with `delete from public.player_roster_exposure;`.
--   PostgREST sessions load pg-safeupdate, which rejects any DELETE without a
--   WHERE clause, and that applies to statements inside a function called via
--   `.rpc()` too. Every nightly call from /api/cron/recalculate-derived failed
--   with "DELETE requires a WHERE clause" from 2026-09-05 on, so the table sat
--   frozen at its 2026-09-04 build (2,242 players over far fewer rosters than
--   we hold today). A SQL console does not load safeupdate, which is why the
--   function looked fine when run by hand.
--
--   `where true` is the same fix migration 0144 made for
--   rebuild_player_positional_finishes. Nothing else in the body changes.
--
-- Access matrix: unchanged from migration 0258. Table and grants untouched.
--
-- Rollback note: re-apply the function body from migration 0259 (which will
-- fail again under PostgREST).

create or replace function public.rebuild_player_roster_exposure()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_total int;
  v_rows int;
begin
  select count(*)::int into v_total from public.rosters;

  if v_total = 0 then
    -- No rosters at all. Leaving the previous rebuild in place is the honest
    -- move: an empty table would tell every consumer that nobody is rostered
    -- anywhere, which is a claim rather than an absence of one.
    return jsonb_build_object('rebuilt', false, 'reason', 'no_rosters');
  end if;

  -- `where true` because pg-safeupdate rejects a bare DELETE under PostgREST.
  delete from public.player_roster_exposure where true;

  insert into public.player_roster_exposure
    (sleeper_player_id, rostered_count, total_rosters, roster_rate, computed_at)
  select pid.value,
         -- DISTINCT ROSTERS, not entries. A roster that lists the same player
         -- twice is one roster holding him, and counting it twice would push
         -- rostered_count past total_rosters and fail this table's own check.
         count(distinct r.id)::int,
         v_total,
         round((count(distinct r.id)::numeric / v_total), 6),
         now()
  from public.rosters r
  cross join lateral jsonb_array_elements_text(
    coalesce(r.player_ids, '[]'::jsonb)
  ) as pid
  where pid.value is not null
    and pid.value <> ''
    and pid.value <> '0'
  group by pid.value;

  get diagnostics v_rows = row_count;

  return jsonb_build_object('rebuilt', true, 'players', v_rows, 'rosters', v_total);
end;
$$;

comment on function public.rebuild_player_roster_exposure() is
  'Rebuilds player_roster_exposure from every roster we hold, in one transaction so the table is never half-written. Counts DISTINCT rosters per player, so a roster listing a player twice cannot push rostered_count past total_rosters. Returns {rebuilt, players, rosters} or {rebuilt:false, reason}. Called by the nightly derived-tables cron. service_role-only EXECUTE.';

revoke all on function public.rebuild_player_roster_exposure() from public;
revoke execute on function public.rebuild_player_roster_exposure() from anon, authenticated;
grant execute on function public.rebuild_player_roster_exposure() to service_role;
