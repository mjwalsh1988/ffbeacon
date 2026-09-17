-- Migration 0284: relays, relay_players, relay_teams
--
-- A Relay is one short structured headline made from one accepted source post
-- (docs/beacon-brief/relays-and-briefs-plan.md, sections 3 to 5). It replaces
-- the per-post article as the thing the pipeline writes: the classify call now
-- returns a `relay` object built ONLY from the post's text, a code check
-- (lib/relays/grounding.ts) proves every number and name in it came from the
-- post, and the row lands here. Relays feed the /brief hub, the Discord card,
-- the player profiles and the weekly Brief's bundle. They are never indexed.
--
-- NO metadata jsonb, deliberately. The raw source post is preserved verbatim
-- on news_ingestions.metadata (migration 0086), and every Relay points at its
-- ingestion through the unique ingestion_id, so this is a pre-calculated table
-- whose provenance is the ingestion row plus the classify log. A second copy
-- of the same object would be the duplication the Data Architecture rule
-- exists to stop.
--
-- Status transitions (plan 5.4):
--   published  the default. In the feed, on the permalink, in the bundle.
--   hidden     an admin took it off the site, or the grounding check failed.
--              Stays in the bundle with a flag. status_reason says which.
--   retracted  the deletion watch found the source post gone, or an admin
--              marked it. Out of the feed and the bundle; the permalink is 410.
--
-- Access matrix:
--   relays
--     anon          : SELECT where status = 'published'
--     authenticated : SELECT where status = 'published'
--     service_role  : ALL
--   relay_players, relay_teams
--     anon          : SELECT where the parent relay is published
--     authenticated : SELECT where the parent relay is published
--     service_role  : ALL
--   client writes   : BLOCKED on all three
--
-- Verification (run through the Supabase MCP on 2026-09-16 after apply):
--   pg_policies for the three tables lists exactly the six policies below.
--   set role anon; select count(*) from relays;               -> 0 rows, no error
--   set role anon; insert into relays (...) values (...);     -> permission denied
--   (rolled back; see the transaction note in CLAUDE.md memory)

create table if not exists public.relays (
  id uuid primary key default gen_random_uuid(),
  ingestion_id uuid not null unique references public.news_ingestions(id) on delete cascade,
  slug text not null unique,
  kind text not null check (kind in (
    'injury', 'transaction', 'contract', 'suspension', 'depth_chart',
    'coaching', 'performance', 'draft', 'legal', 'other'
  )),
  headline text not null check (char_length(headline) between 20 and 240),
  -- [{label, value}], at most 6, validated in code (lib/relays/write.ts).
  facts jsonb not null default '[]'::jsonb,
  timeline text,
  availability text check (availability in (
    'out', 'doubtful', 'questionable', 'active', 'ir', 'pup', 'released',
    'signed', 'traded', 'suspended', 'waived', 'none'
  )),
  category_id uuid references public.news_categories(id) on delete set null,
  relevance_tier integer not null,
  tags text[] not null default '{}',
  -- The NFL season the post belongs to, as Sleeper writes it ('2026').
  season text not null,
  -- The NFL week, or null off-season. Assigned by lib/relays/week.ts from the
  -- post's own timestamp, and the Brief cadence reads the same function, so a
  -- Relay can never fall between two editions.
  week integer,
  source_handle text not null,
  source_url text not null,
  -- The post's own timestamp, not created_at: a backfilled Relay keeps its
  -- real date.
  source_posted_at timestamptz not null,
  follows_relay_id uuid references public.relays(id) on delete set null,
  -- The edition that covered it, stamped on publish (lib/brief-desk/publish.ts).
  brief_id uuid references public.articles(id) on delete set null,
  status text not null default 'published'
    check (status in ('published', 'hidden', 'retracted')),
  status_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_relays_season_week_posted
  on public.relays (season, week, source_posted_at desc);
create index if not exists idx_relays_status_posted
  on public.relays (status, source_posted_at desc);
create index if not exists idx_relays_brief on public.relays (brief_id);
create index if not exists idx_relays_follows on public.relays (follows_relay_id);
create index if not exists idx_relays_category on public.relays (category_id);

create table if not exists public.relay_players (
  relay_id uuid not null references public.relays(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  -- Marks the headline's subject so a card can lead with one pill.
  is_primary boolean not null default false,
  primary key (relay_id, player_id)
);
create index if not exists idx_relay_players_player on public.relay_players (player_id);

create table if not exists public.relay_teams (
  relay_id uuid not null references public.relays(id) on delete cascade,
  team_id uuid not null references public.nfl_teams(id) on delete cascade,
  primary key (relay_id, team_id)
);
create index if not exists idx_relay_teams_team on public.relay_teams (team_id);

alter table public.relays enable row level security;
alter table public.relay_players enable row level security;
alter table public.relay_teams enable row level security;

drop policy if exists relays_select_public on public.relays;
create policy relays_select_public on public.relays
  for select to anon, authenticated
  using (status = 'published');

drop policy if exists relays_service_role_all on public.relays;
create policy relays_service_role_all on public.relays
  for all to service_role using (true) with check (true);

drop policy if exists relay_players_select_public on public.relay_players;
create policy relay_players_select_public on public.relay_players
  for select to anon, authenticated
  using (exists (
    select 1 from public.relays r
    where r.id = relay_id and r.status = 'published'
  ));

drop policy if exists relay_players_service_role_all on public.relay_players;
create policy relay_players_service_role_all on public.relay_players
  for all to service_role using (true) with check (true);

drop policy if exists relay_teams_select_public on public.relay_teams;
create policy relay_teams_select_public on public.relay_teams
  for select to anon, authenticated
  using (exists (
    select 1 from public.relays r
    where r.id = relay_id and r.status = 'published'
  ));

drop policy if exists relay_teams_service_role_all on public.relay_teams;
create policy relay_teams_service_role_all on public.relay_teams
  for all to service_role using (true) with check (true);

comment on table public.relays is
  'One structured headline per accepted Beacon Brief source post. Never indexed; feeds the /brief hub, Discord, player profiles and the weekly Brief bundle. Provenance is news_ingestions (raw post in its metadata) plus beacon_brief_logs.';
comment on column public.relays.facts is
  'Label and value pairs lifted from the post in its own words, at most six. Validated in lib/relays/write.ts.';
comment on column public.relays.status_reason is
  'Why a Relay is hidden or retracted. "grounding" means the code check found a token the post did not contain.';
