-- Migration 0259: count rosters, not roster entries, in player_roster_exposure
--
-- What was wrong
--   `rebuild_player_roster_exposure` counted `count(*)` over a lateral unnest of
--   `rosters.player_ids`. That counts ENTRIES, not ROSTERS. `player_ids` is raw
--   Sleeper jsonb, so a single roster carrying the same player id twice makes
--   `rostered_count` exceed `total_rosters` and trips the table's own CHECK
--   (`rostered_count <= total_rosters`).
--
--   The failure is quiet, which is the part that matters. The delete and the
--   insert are one transaction, so the previous rebuild survives; the nightly
--   job catches the error, logs it and continues by design. So the exposure
--   table would simply freeze at whatever date the first duplicate arrived,
--   while Manager Pulse kept ranking favourites against increasingly stale
--   roster rates and saying nothing. Nobody would look until the numbers were
--   months old.
--
--   Production has no duplicates today. This is a latent bug being closed
--   before it fires, not an incident.
--
-- `count(distinct r.id)` is also just a more honest reading of the column name:
-- "rostered_count" is how many ROSTERS hold this player.
--
-- Access matrix: unchanged from migration 0258. Table and grants untouched.
--
-- Rollback note: re-apply the function body from migration 0258.

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

  delete from public.player_roster_exposure;

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
