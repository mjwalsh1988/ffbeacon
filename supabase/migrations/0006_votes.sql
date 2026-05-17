-- Migration 0006: vote_matchups + votes
--
-- Access matrix:
--   vote_matchups
--     anon          : SELECT
--     authenticated : SELECT
--     service_role  : ALL
--   votes
--     anon          : NONE
--     authenticated : SELECT/INSERT/UPDATE/DELETE OWN rows only (auth.uid() = user_id)
--     service_role  : ALL

create table if not exists public.vote_matchups (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  player_a_id uuid not null references public.players(id),
  player_b_id uuid not null references public.players(id),
  format_config_id uuid not null references public.format_configs(id),
  week integer,
  season integer not null,

  votes_a integer not null default 0,
  votes_b integer not null default 0,

  analysis_md text,
  analysis_generated_at timestamptz,

  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_matchups_active on public.vote_matchups(is_active);
create index if not exists idx_matchups_week on public.vote_matchups(season, week);

create table if not exists public.votes (
  id uuid primary key default gen_random_uuid(),
  matchup_id uuid not null references public.vote_matchups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  chose text not null check (chose in ('a','b')),
  voted_at timestamptz not null default now(),
  unique(matchup_id, user_id)
);

create index if not exists idx_votes_matchup on public.votes(matchup_id);
create index if not exists idx_votes_user on public.votes(user_id);

alter table public.vote_matchups enable row level security;
alter table public.votes enable row level security;

drop policy if exists vote_matchups_select_public on public.vote_matchups;
create policy vote_matchups_select_public on public.vote_matchups
  for select to anon, authenticated using (true);
drop policy if exists vote_matchups_service_role_all on public.vote_matchups;
create policy vote_matchups_service_role_all on public.vote_matchups
  for all to service_role using (true) with check (true);

drop policy if exists votes_select_own on public.votes;
create policy votes_select_own on public.votes
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists votes_insert_own on public.votes;
create policy votes_insert_own on public.votes
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists votes_update_own on public.votes;
create policy votes_update_own on public.votes
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists votes_delete_own on public.votes;
create policy votes_delete_own on public.votes
  for delete to authenticated
  using (auth.uid() = user_id);

drop policy if exists votes_service_role_all on public.votes;
create policy votes_service_role_all on public.votes
  for all to service_role using (true) with check (true);
