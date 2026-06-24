-- Migration 0085: article_teams (The Beacon Brief)
--
-- Join table linking Beacon Brief articles to the NFL teams they are about,
-- mirroring the existing article_players join (0005). Public-readable like
-- article_players; writes are service-role only (the curation pipeline and the
-- admin Articles editor).
--
-- Access matrix:
--   anon          : SELECT
--   authenticated : SELECT
--   service_role  : ALL
--   client writes : BLOCKED

create table if not exists public.article_teams (
  article_id uuid references public.articles(id) on delete cascade,
  team_id uuid references public.teams(id) on delete cascade,
  primary key (article_id, team_id)
);

-- Reverse lookup: articles for a given team.
create index if not exists idx_article_teams_team
  on public.article_teams (team_id);

alter table public.article_teams enable row level security;

drop policy if exists article_teams_select_public on public.article_teams;
create policy article_teams_select_public on public.article_teams
  for select to anon, authenticated using (true);

drop policy if exists article_teams_service_role_all on public.article_teams;
create policy article_teams_service_role_all on public.article_teams
  for all to service_role using (true) with check (true);

comment on table public.article_teams is
  'Join of Beacon Brief articles to NFL teams (mirrors article_players). Public SELECT, service_role writes.';
