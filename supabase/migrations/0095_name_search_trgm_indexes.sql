-- Migration 0095: trigram indexes for Beacon Brief name resolution
--
-- The Beacon Brief resolves AI-named players/teams to ids with ILIKE on
-- players.full_name and teams.name (lib/beacon-brief/curate.ts resolveRefs, and
-- the admin articles player/team filter). Leading-wildcard ILIKE cannot use a
-- btree, so these were sequential scans. pg_trgm GIN indexes make them index-backed.
-- No RLS impact (indexes only).

create extension if not exists pg_trgm;

create index if not exists idx_players_full_name_trgm
  on public.players using gin (full_name gin_trgm_ops);

create index if not exists idx_teams_name_trgm
  on public.teams using gin (name gin_trgm_ops);
