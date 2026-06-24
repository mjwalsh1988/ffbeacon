-- Migration 0097: beacon_brief_moderation reference-match review
--
-- Extends the existing deletion-review queue to ALSO hold low-confidence
-- player/team reference matches from curation. The Beacon Brief never auto-links
-- a guessed player or team: a non-confident name opens a row here with the raw
-- AI name and ranked candidate suggestions, and the admin resolves it (writes the
-- real article_players / article_teams link) or dismisses it (no link).
--
-- `type` encodes the ref kind: 'player_match' | 'team_match' (alongside the
-- original 'deletion'), so no separate ref_kind column is needed. `article_id`
-- is filled once the worker writes the article (nullable until then). `raw_name`
-- holds the unmatched AI name; `candidates` holds ranked {id, label} suggestions.
--
-- RLS unchanged: service_role-only behind the admin gate.
--
-- Access matrix:
--   anon          : NONE
--   authenticated : NONE
--   service_role  : ALL
--   client writes : BLOCKED

alter table public.beacon_brief_moderation
  drop constraint if exists beacon_brief_moderation_type_check;
alter table public.beacon_brief_moderation
  add constraint beacon_brief_moderation_type_check
  check (type in ('deletion', 'player_match', 'team_match'));

alter table public.beacon_brief_moderation
  add column if not exists raw_name text;
alter table public.beacon_brief_moderation
  add column if not exists candidates jsonb not null default '[]'::jsonb;

-- The Moderation page filters by (type, status); keep the pending queue tight.
create index if not exists idx_beacon_brief_moderation_type_status
  on public.beacon_brief_moderation (type, status, created_at desc);

comment on column public.beacon_brief_moderation.raw_name is
  'For player_match/team_match rows: the raw AI-returned name that did not confidently resolve.';
comment on column public.beacon_brief_moderation.candidates is
  'For player_match/team_match rows: ranked candidate suggestions as a jsonb array of {id, label}.';
