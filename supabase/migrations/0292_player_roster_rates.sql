-- How widely rostered is a player, across the Sleeper leagues we already hold?
--
-- Access matrix
--   anon, authenticated: SELECT (the waiver wire pages publish these
--     aggregates, and they carry no league, roster, user or manager identity)
--   service_role: ALL (built by the recalculate-derived cron and by
--     npm run calculate:roster-rates)
--
-- WHY THIS TABLE EXISTS. Every waiver wire page on the internet opens with an
-- availability claim ("rostered in 14% of leagues") and every one of them is
-- reading a number a platform published about itself. We hold 7,000-odd real
-- synced rosters across 500-odd real leagues, so we can measure the same thing
-- from the rosters themselves and say exactly which population it describes.
-- A player nobody in our sample rosters is a player a reader can probably add.
--
-- WHAT IT IS NOT. It is not a claim about Sleeper as a whole. Our leagues are
-- self-selected (somebody pasted them into FF Beacon) and skew dynasty, and the
-- pages that render these figures say so in words beside every percentage.
-- That is why leagues_total ships on every row rather than being looked up
-- separately: a share is meaningless without the population it came from, and
-- storing them apart is how the two drift.
--
-- NOT player_roster_exposure (migration 0258), AND THE TWO MUST NOT BE MERGED.
-- That table answers a different question for Manager Pulse: how common is it
-- to roster this player AT ALL, across every roster we have ever synced in any
-- season, as a share of ROSTER ROWS. Because a player sits on exactly one
-- roster per league, its denominator is roughly twelve times its largest
-- possible numerator, so its rate tops out near 8 percent. That is the right
-- shape for normalising a favourites list and a badly wrong number to print
-- next to the words "rostered in". This table is per SEASON, its denominator is
-- LEAGUES, and it splits dynasty from redraft. Both are cheap, both are one
-- aggregate, and collapsing them would break one of the two callers.
--
-- Derived table, so no metadata jsonb column: its provenance is
-- refresh_player_roster_rates below plus lib/waiver-wire/roster-rates.ts, which
-- is the pre-calculated table rule in CLAUDE.md.
--
-- THE DYNASTY AND REDRAFT SPLIT IS NOT DECORATION. A 28-year-old running back
-- is rostered in nearly every dynasty league and sits on the wire in half the
-- redraft ones, so a single blended share describes neither reader. The buckets
-- are the same ones lib/league-category.ts uses: Sleeper settings.type = 2 is
-- dynasty, everything else (redraft, keeper, chopped) is redraft. Best ball is
-- NOT split out here, because a best-ball roster is rostered the same way a
-- redraft one is for the purpose of this question.
--
-- sleeper_player_id is the key, not player_id. rosters.player_ids holds
-- Sleeper's own ids verbatim, and a player our players table has not caught up
-- with is still rostered in those leagues. Keying on the Sleeper id means the
-- count is right for him too; player_id is filled in where we can resolve it
-- and left null where we cannot, rather than dropping the row.
create table public.player_roster_rates (
  season integer not null,
  sleeper_player_id text not null,
  player_id uuid references public.players(id) on delete set null,
  leagues_rostered integer not null default 0 check (leagues_rostered >= 0),
  leagues_total integer not null default 0 check (leagues_total >= 0),
  dynasty_rostered integer not null default 0 check (dynasty_rostered >= 0),
  dynasty_total integer not null default 0 check (dynasty_total >= 0),
  redraft_rostered integer not null default 0 check (redraft_rostered >= 0),
  redraft_total integer not null default 0 check (redraft_total >= 0),
  computed_at timestamptz not null default now(),
  primary key (season, sleeper_player_id)
);

-- The waiver board reads "everybody in this season, ordered by how rare they
-- are", then filters in the application. One index covers it.
create index player_roster_rates_season_rostered_idx
  on public.player_roster_rates (season, leagues_rostered);

-- The player page and the board's join both look a row up by our own id.
create index player_roster_rates_player_idx
  on public.player_roster_rates (player_id)
  where player_id is not null;

alter table public.player_roster_rates enable row level security;

create policy player_roster_rates_select_public on public.player_roster_rates
  for select to anon, authenticated using (true);

create policy player_roster_rates_service_role_all on public.player_roster_rates
  for all to service_role using (true) with check (true);

comment on table public.player_roster_rates is
  'How many synced Sleeper leagues roster each player, by season, split dynasty and redraft. Derived from rosters by refresh_player_roster_rates. No league, roster or user identifiers.';

comment on column public.player_roster_rates.leagues_total is
  'Leagues in the denominator for this season. Stored on every row on purpose: a share without its population is not a figure anyone can read.';


-- The whole recompute, in one statement, as one transaction.
--
-- WHY A FUNCTION RATHER THAN APPLICATION CODE. The aggregate unnests roughly
-- 156,000 (league, player) pairs. Paging that through PostgREST to count it in
-- TypeScript would move every one of those rows over the wire to produce about
-- 2,500 integers. It is one GROUP BY and it belongs in the database.
--
-- WHY IT IS NOT A PER-LEAGUE ITERATION. CLAUDE.md forbids wiring per-league
-- recomputation into a nightly cron, because that does not scale to tens of
-- thousands of leagues and because an unviewed league never needs the work.
-- This is the other shape entirely: one global aggregate over whatever rosters
-- happen to be stored, touching no league individually, making no Sleeper
-- request, and writing nothing to any league's own rows. Adding the
-- ten-thousandth league makes this query longer, not the cron's loop.
create or replace function public.refresh_player_roster_rates(p_season integer)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_total integer;
  v_dynasty integer;
  v_redraft integer;
  v_written integer;
begin
  -- The denominator is leagues that actually have a roster with a player on
  -- it. A league row whose sync failed before the rosters landed would
  -- otherwise sit in the denominator and push every share down.
  create temporary table tmp_rr_leagues on commit drop as
  select
    l.id,
    (coalesce(l.metadata -> 'settings' ->> 'type', '0') = '2') as is_dynasty
  from public.leagues l
  where l.season = p_season
    and exists (
      select 1 from public.rosters r
      where r.league_id = l.id
        and jsonb_array_length(coalesce(r.player_ids, '[]'::jsonb)) > 0
    );

  select count(*),
         count(*) filter (where is_dynasty),
         count(*) filter (where not is_dynasty)
    into v_total, v_dynasty, v_redraft
  from tmp_rr_leagues;

  -- Nothing synced for this season yet. Leave whatever is stored alone rather
  -- than replacing real counts with a table of zeroes: a zero here reads as
  -- "nobody rosters him", which is a claim, and we would not have made it.
  if v_total = 0 then
    return 0;
  end if;

  create temporary table tmp_rr_counts on commit drop as
  select
    pid.value as sleeper_player_id,
    count(distinct r.league_id) as leagues_rostered,
    count(distinct r.league_id) filter (where g.is_dynasty) as dynasty_rostered,
    count(distinct r.league_id) filter (where not g.is_dynasty) as redraft_rostered
  from public.rosters r
  join tmp_rr_leagues g on g.id = r.league_id
  cross join lateral jsonb_array_elements_text(coalesce(r.player_ids, '[]'::jsonb)) as pid
  -- Sleeper writes the string "0" into an empty roster slot. It is not a
  -- player, and counting it would produce one row rostered by every league.
  where pid.value <> '0' and pid.value <> ''
  group by pid.value;

  delete from public.player_roster_rates where season = p_season;

  insert into public.player_roster_rates (
    season, sleeper_player_id, player_id,
    leagues_rostered, leagues_total,
    dynasty_rostered, dynasty_total,
    redraft_rostered, redraft_total,
    computed_at
  )
  select
    p_season,
    c.sleeper_player_id,
    p.id,
    c.leagues_rostered, v_total,
    c.dynasty_rostered, v_dynasty,
    c.redraft_rostered, v_redraft,
    now()
  from tmp_rr_counts c
  left join public.players p
    on p.external_ids ->> 'sleeper' = c.sleeper_player_id;

  get diagnostics v_written = row_count;
  return v_written;
end;
$$;

-- A SECURITY DEFINER function is executable by PUBLIC on creation, and Supabase
-- also hands anon and authenticated their own named grants, so revoking from
-- public alone leaves two roles holding it. Name all three.
revoke all on function public.refresh_player_roster_rates(integer) from public;
revoke all on function public.refresh_player_roster_rates(integer) from anon;
revoke all on function public.refresh_player_roster_rates(integer) from authenticated;
grant execute on function public.refresh_player_roster_rates(integer) to service_role;

comment on function public.refresh_player_roster_rates(integer) is
  'Recompute public.player_roster_rates for one season from stored rosters. One global aggregate, no per-league iteration, no external requests. service_role only.';
