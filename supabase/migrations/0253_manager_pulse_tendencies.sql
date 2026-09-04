-- Migration 0253: manager_pulse_tendencies (the compact cross-tool row)
--
-- Why this is not a column on manager_pulse_cache
--   League Pulse Trade Ideas needs one of these for every manager in the league,
--   which is eleven of them on one page load. Reading eleven full reports to get
--   eleven summaries would mean deserializing megabytes to use kilobytes. So the
--   summary is its own row, keyed only by manager, and Trade Ideas reads exactly
--   this table and never the report.
--
-- Why the sample counts are real columns
--   Trade Ideas filters to rows that clear the sample floor for the league type
--   it is actually in. Doing that inside the jsonb means fetching every row and
--   filtering in application code; doing it in a column means the database
--   answers the question.
--
-- Why dynasty and redraft are separate inside the document
--   They are different games with different value scales. A dynasty superflex
--   trade and a redraft PPR trade are priced against different format configs,
--   so an average across both has no unit. tendency holds { overall, dynasty,
--   redraft }, and lib/manager-pulse/tendencies.ts pickTendencySlice() is the one
--   accessor. It returns null for a game we have not seen this manager play
--   rather than falling back to the other one.
--
-- Access matrix
--   anon          : none
--   authenticated : none
--   service_role  : ALL
--   client writes : BLOCKED
--
-- Rollback note (no down migration ships):
--   drop table if exists public.manager_pulse_tendencies;

create table if not exists public.manager_pulse_tendencies (
  sleeper_user_id text primary key,
  sleeper_handle text,
  tendency jsonb not null,
  dynasty_sample int not null default 0,
  redraft_sample int not null default 0,
  seasons_covered int not null default 0,
  season_from int,
  season_to int,
  model_version text not null,
  generated_at timestamptz not null default now(),
  constraint manager_pulse_tendencies_samples_sane check (
    dynasty_sample >= 0 and redraft_sample >= 0 and seasons_covered >= 0
  )
);

comment on table public.manager_pulse_tendencies is
  'Compact per-manager trading tendencies, split into overall / dynasty / redraft slices. Read by League Pulse Trade Ideas, one batched query per league page, cache-only: nothing here ever triggers a capture. Service-role only.';

comment on column public.manager_pulse_tendencies.tendency is
  'ManagerTendency from lib/manager-pulse/types.ts: { overall, dynasty, redraft }. A caller reads the slice matching the league it is in and never blends the two.';

-- The Trade Ideas read: eleven ids at once, filtered on the sample floor for the
-- league type in hand.
create index if not exists manager_pulse_tendencies_dynasty_idx
  on public.manager_pulse_tendencies (dynasty_sample desc)
  where dynasty_sample > 0;

create index if not exists manager_pulse_tendencies_redraft_idx
  on public.manager_pulse_tendencies (redraft_sample desc)
  where redraft_sample > 0;

-- The admin cache page: what is stored on a superseded model version.
create index if not exists manager_pulse_tendencies_version_idx
  on public.manager_pulse_tendencies (model_version, generated_at desc);

alter table public.manager_pulse_tendencies enable row level security;

drop policy if exists manager_pulse_tendencies_service_role_all
  on public.manager_pulse_tendencies;
create policy manager_pulse_tendencies_service_role_all
  on public.manager_pulse_tendencies
  for all
  to service_role
  using (true)
  with check (true);

revoke all on table public.manager_pulse_tendencies from anon, authenticated;
