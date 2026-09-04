-- Migration 0258: player_roster_exposure (how commonly a player is rostered)
--
-- Why this exists
--   Manager Pulse's affinity section ranks a manager's favourite players by how
--   much they own them RELATIVE to how commonly anyone owns them. A player
--   every league rosters is not a preference, and without that denominator the
--   favourites list is just a list of good players, which every manager's report
--   would share.
--
--   The number itself is one aggregate over every roster we hold. Measured on
--   3,704 rosters it runs about 310ms and returns 2,242 distinct players. That
--   is fine once. It is not fine per report, and it grows linearly with the
--   number of leagues anyone has ever opened, so at ten thousand leagues the
--   same query is ten seconds on the critical path of a page that is supposed to
--   paint immediately.
--
--   So it is a pre-calculated table, rebuilt on a schedule, exactly like
--   player_value_trends. Per the project's derived-table convention it carries
--   no `metadata` column: its provenance is the function below, not an external
--   source.
--
-- WHAT THE RATE IS, AND WHAT IT IS NOT
--   `rostered_count / total_rosters` across every league in our database, of
--   every type and every season. It is a rough popularity signal, not a claim
--   about any one format: a superflex quarterback is rostered more widely than
--   a one-quarterback league would suggest. That is acceptable for its one job
--   (separating "everybody has him" from "this manager keeps buying him") and
--   it must not be presented to a reader as a roster percentage for their own
--   league, because it is not one.
--
-- Access matrix
--   anon          : none
--   authenticated : none
--   service_role  : ALL (rebuilt by the nightly derived job, read by the
--                   Manager Pulse loader through the service-role client)
--   client writes : BLOCKED
--
-- Rollback note (no down migration ships):
--   drop function if exists public.rebuild_player_roster_exposure();
--   drop table if exists public.player_roster_exposure;

create table if not exists public.player_roster_exposure (
  sleeper_player_id text primary key,
  rostered_count int not null,
  total_rosters int not null,
  -- Stored rather than computed on read so every consumer sees the same number
  -- from the same rebuild, instead of dividing by a total that has moved on.
  roster_rate numeric not null,
  computed_at timestamptz not null default now(),
  constraint player_roster_exposure_counts_sane check (
    rostered_count >= 0 and total_rosters >= 0 and rostered_count <= total_rosters
  ),
  constraint player_roster_exposure_rate_sane check (roster_rate >= 0 and roster_rate <= 1)
);

comment on table public.player_roster_exposure is
  'Pre-calculated: how commonly each Sleeper player is rostered across every league we hold. The denominator behind Manager Pulse favourites, so a player everybody owns does not read as a preference. Rebuilt by rebuild_player_roster_exposure() on the nightly derived job. Service-role only.';

comment on column public.player_roster_exposure.roster_rate is
  'rostered_count / total_rosters across ALL leagues, every type and season. A rough popularity signal, not a roster percentage for any one league or format. Never shown to a reader as one.';

create index if not exists player_roster_exposure_rate_idx
  on public.player_roster_exposure (roster_rate desc);

alter table public.player_roster_exposure enable row level security;

drop policy if exists player_roster_exposure_service_role_all
  on public.player_roster_exposure;
create policy player_roster_exposure_service_role_all
  on public.player_roster_exposure
  for all
  to service_role
  using (true)
  with check (true);

revoke all on table public.player_roster_exposure from anon, authenticated;

-- ---------------------------------------------------------------------------
-- The rebuild
-- ---------------------------------------------------------------------------
--
-- One statement, wrapped so the table is never empty mid-rebuild: a delete plus
-- an insert inside one function call is one transaction, so a reader either sees
-- the old rebuild or the new one and never a half-written table.
--
-- Sleeper uses the string "0" as a placeholder for an empty roster slot, so it
-- is filtered out here. Every other reader in this codebase does the same; see
-- validPlayerId in lib/league-pulse.ts.

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
         count(*)::int,
         v_total,
         round((count(*)::numeric / v_total), 6),
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
  'Rebuilds player_roster_exposure from every roster we hold, in one transaction so the table is never half-written. Returns {rebuilt, players, rosters} or {rebuilt:false, reason}. Called by the nightly derived-tables cron. service_role-only EXECUTE.';

revoke all on function public.rebuild_player_roster_exposure() from public;
revoke execute on function public.rebuild_player_roster_exposure() from anon, authenticated;
grant execute on function public.rebuild_player_roster_exposure() to service_role;
