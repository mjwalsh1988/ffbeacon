-- 0372_faab_priors_incremental.sql
--
-- The FAAB clearing-price cells move off the nightly derived recalc onto their
-- own incremental cron (/api/cron/faab-priors), and gain a season.
--
-- WHY. The rebuild read every waiver row we hold (317,210 on 2026-11-12) in
-- 1,000-row pages on every run. On 2026-11-12 that pushed recalculate-derived
-- past its 280-second budget. The cells now pool THIS season only, with LAST
-- season as a per-cell fallback until this season's cell has enough samples,
-- and each run re-reads only the leagues whose waiver rows changed.
--
-- WHAT THIS ADDS.
--   league_transactions.updated_at  bumped by a trigger ONLY when a row's
--     content actually changes. The league sync upserts its recent weeks on
--     every pulse, so a plain "set updated_at on update" would mark every
--     resynced league as changed.
--   faab_market_priors.season       one set of cells per season; unique on
--     (season, cell_key) instead of cell_key alone.
--   faab_prior_auctions             one row per WON waiver auction in a FAAB
--     league, this season and last. Quantiles cannot be updated by adding new
--     rows to an old answer, so the sample itself is kept; a changed league's
--     rows are replaced and the cells are rebuilt from this table.
--   faab_prior_build_state          the single row that carries the watermark
--     and the resume cursor of a pass that ran out of time.
--   waiver_pickup_showcases         one row per finished season: the most
--     added players and how they scored afterwards, for the waiver wire's
--     offseason board. Player names are resolved at render, never stored.
--   faab_prior_changed_leagues()    the leagues a pass must re-read.
--   waiver_pickup_counts()          per-batch aggregate of completed adds.
--
-- ACCESS MATRIX
--   table / function                anon     authenticated   service_role
--   faab_market_priors              SELECT   SELECT          ALL   (unchanged)
--   faab_prior_auctions             none     none            ALL
--   faab_prior_build_state          none     none            ALL
--   waiver_pickup_showcases         SELECT   SELECT          ALL
--   faab_prior_changed_leagues()    none     none            EXECUTE
--   waiver_pickup_counts()          none     none            EXECUTE
--
-- faab_prior_auctions holds a league row id and a Sleeper player id per
-- auction. Neither identifies a person, but it is still the raw sample rather
-- than the published distribution, so it stays service-role only, like the
-- league tables' writes. Nothing derived from it is published except the
-- cells (counts and quantiles) and the showcase (aggregates per player).
--
-- Neither new data table ingests an external payload: both are derived from
-- league_transactions, which keeps the raw Sleeper object in its own metadata.
-- So neither carries a metadata column (CLAUDE.md, Pre-Calculated Tables).

-- 1. Change detection on league_transactions ---------------------------------

alter table public.league_transactions
  add column if not exists updated_at timestamptz not null default now();

create or replace function public.league_transactions_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.type, new.status, new.week, new.season, new.adds, new.drops,
      new.roster_ids, new.waiver_budget, new.draft_picks, new.metadata)
     is distinct from
     (old.type, old.status, old.week, old.season, old.adds, old.drops,
      old.roster_ids, old.waiver_budget, old.draft_picks, old.metadata) then
    new.updated_at := now();
  else
    new.updated_at := old.updated_at;
  end if;
  return new;
end;
$$;

revoke all on function public.league_transactions_touch_updated_at() from public, anon, authenticated;

drop trigger if exists league_transactions_touch_updated_at on public.league_transactions;
create trigger league_transactions_touch_updated_at
  before update on public.league_transactions
  for each row execute function public.league_transactions_touch_updated_at();

create index if not exists idx_league_transactions_waiver_updated
  on public.league_transactions (updated_at)
  where type = 'waiver';

-- 2. A season on every price cell ---------------------------------------------

alter table public.faab_market_priors add column if not exists season integer;

-- The cells already stored pool every season. They are labeled with their
-- newest season so they keep serving until the first completed pass replaces
-- them with a this-season set.
update public.faab_market_priors
set season = coalesce(
  (select max(s) from unnest(seasons) as s),
  extract(year from now())::integer
)
where season is null;

alter table public.faab_market_priors alter column season set not null;
alter table public.faab_market_priors drop constraint if exists faab_market_priors_cell_key_key;
alter table public.faab_market_priors
  add constraint faab_market_priors_season_cell_key_key unique (season, cell_key);

-- 3. The kept sample ----------------------------------------------------------

create table if not exists public.faab_prior_auctions (
  id bigint generated always as identity primary key,
  league_id uuid not null references public.leagues(id) on delete cascade,
  season integer not null,
  week integer not null,
  player_sleeper_id text not null,
  league_kind text not null check (league_kind in ('redraft', 'dynasty', 'chopped')),
  superflex boolean not null,
  position text,
  alive_fraction double precision,
  bidder_count integer not null check (bidder_count >= 1),
  winning_pct double precision not null,
  runner_up_pct double precision,
  built_at timestamptz not null default now()
);

create index if not exists idx_faab_prior_auctions_league on public.faab_prior_auctions (league_id);
create index if not exists idx_faab_prior_auctions_season_id on public.faab_prior_auctions (season, id);
create index if not exists idx_faab_prior_auctions_season_player
  on public.faab_prior_auctions (season, player_sleeper_id);

alter table public.faab_prior_auctions enable row level security;
drop policy if exists faab_prior_auctions_service_role_all on public.faab_prior_auctions;
create policy faab_prior_auctions_service_role_all on public.faab_prior_auctions
  for all to service_role using (true) with check (true);

-- 4. Build state --------------------------------------------------------------

create table if not exists public.faab_prior_build_state (
  id text primary key default 'global' check (id = 'global'),
  current_season integer,
  logic_version integer not null default 0,
  -- Waiver rows changed after this are not yet folded into the sample.
  watermark timestamptz,
  -- The pass in progress: its lower bound (null on a full pass), when it
  -- started, the last league it finished, and which seasons it touched.
  pass_since timestamptz,
  pass_full boolean not null default false,
  pass_started_at timestamptz,
  pass_cursor uuid,
  pass_dirty_seasons integer[] not null default '{}',
  last_pass_completed_at timestamptz,
  last_cells_built_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.faab_prior_build_state enable row level security;
drop policy if exists faab_prior_build_state_service_role_all on public.faab_prior_build_state;
create policy faab_prior_build_state_service_role_all on public.faab_prior_build_state
  for all to service_role using (true) with check (true);

-- 5. The offseason showcase ---------------------------------------------------

create table if not exists public.waiver_pickup_showcases (
  season integer primary key,
  leagues_count integer not null check (leagues_count >= 0),
  players jsonb not null default '[]'::jsonb,
  built_at timestamptz not null default now()
);

alter table public.waiver_pickup_showcases enable row level security;
drop policy if exists waiver_pickup_showcases_select_public on public.waiver_pickup_showcases;
create policy waiver_pickup_showcases_select_public on public.waiver_pickup_showcases
  for select to anon, authenticated using (true);
drop policy if exists waiver_pickup_showcases_service_role_all on public.waiver_pickup_showcases;
create policy waiver_pickup_showcases_service_role_all on public.waiver_pickup_showcases
  for all to service_role using (true) with check (true);

-- 6. Functions ----------------------------------------------------------------

-- The leagues a pass must re-read, in id order after p_after, at most 500.
-- A full pass (p_since null) walks every league of the seasons; an incremental
-- pass walks only leagues with a waiver row changed after p_since, through the
-- partial index above.
create or replace function public.faab_prior_changed_leagues(
  p_since timestamptz,
  p_seasons integer[],
  p_after uuid,
  p_limit integer
)
returns setof uuid
language sql
stable
set search_path = ''
as $$
  select x.id
  from (
    select l.id
    from public.leagues l
    where p_since is null
      and l.season = any (p_seasons)
      and (p_after is null or l.id > p_after)
    union
    select t.league_id as id
    from public.league_transactions t
    where p_since is not null
      and t.type = 'waiver'
      and t.updated_at > p_since
      and t.season = any (p_seasons)
      and (p_after is null or t.league_id > p_after)
  ) x
  order by x.id
  limit least(greatest(coalesce(p_limit, 100), 1), 500);
$$;

revoke all on function public.faab_prior_changed_leagues(timestamptz, integer[], uuid, integer)
  from public, anon, authenticated;
grant execute on function public.faab_prior_changed_leagues(timestamptz, integer[], uuid, integer)
  to service_role;

-- Completed waiver and free agent adds in one batch of leagues, reduced to the
-- FIRST week each league added each player. Returned as one jsonb value so the
-- 1,000-row response cap cannot truncate it:
--   { "leagues": <leagues in the batch with any add>,
--     "rows": [[sleeper_id, first_week, leagues, via_waiver, via_free_agent], ...] }
create or replace function public.waiver_pickup_counts(
  p_season integer,
  p_league_ids uuid[]
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with adds as (
    select t.league_id, k.player_id, t.type, t.week
    from public.league_transactions t
    cross join lateral jsonb_object_keys(
      case when jsonb_typeof(t.adds) = 'object' then t.adds else '{}'::jsonb end
    ) as k(player_id)
    where t.league_id = any (p_league_ids)
      and t.season = p_season
      and t.status = 'complete'
      and t.type in ('waiver', 'free_agent')
      and t.week between 1 and 18
  ),
  firsts as (
    select league_id, player_id, min(week) as week,
           bool_or(type = 'waiver') as via_waiver,
           bool_or(type = 'free_agent') as via_fa
    from adds
    group by league_id, player_id
  ),
  grouped as (
    select player_id, week, count(*) as n,
           count(*) filter (where via_waiver) as w,
           count(*) filter (where via_fa) as f
    from firsts
    group by player_id, week
  )
  select jsonb_build_object(
    'leagues', (select count(distinct league_id) from firsts),
    'rows', coalesce(
      (select jsonb_agg(jsonb_build_array(player_id, week, n, w, f)) from grouped),
      '[]'::jsonb
    )
  );
$$;

revoke all on function public.waiver_pickup_counts(integer, uuid[]) from public, anon, authenticated;
grant execute on function public.waiver_pickup_counts(integer, uuid[]) to service_role;
