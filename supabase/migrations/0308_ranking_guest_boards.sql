-- Migration 0308: ranking_guest_boards (Beacon Ranker for signed-out readers;
-- plan section 8, decisions 3 and 13)
--
-- A guest can BUILD and nothing else: no sharing, no publishing, no tiers, no
-- community contribution, and one board at a time. The board lives server side,
-- keyed by an httpOnly cookie holding a server-minted uuid (the Would You
-- Rather pattern), so it survives until the guest signs in and becomes a
-- normal board, and the page can state an honest deletion time. There is no
-- public URL for a guest board: it is reachable only through the cookie, and
-- only through the service-role client on the server.
--
-- ONE TABLE, NOT TWO. The plan named guest boards and guest runs. A guest has
-- exactly one board and at most one run on it, so the run's setup and answer
-- log sit on the board row: every answer then reads and writes one row
-- instead of two. `player_ids` is the board as it stands (the fold's
-- provisional order), rewritten with every answer; a guest board is capped at
-- a few dozen players, so that is a small write.
--
-- Lifetime: deleted `retentionHours` (48 by default, ranking_builder_settings)
-- after updated_at by the hourly cron /api/cron/ranking-guest-cleanup.
-- Guest boards never count toward the community rankings.
--
-- actor_key is the server-derived rate-limit actor (a salted IP hash), kept so
-- the "one guest board at a time" rule can also be checked against a caller
-- who throws the cookie away. It is never read from the request.
--
-- Access matrix
--   anon          : none (no policy; grants revoked)
--   authenticated : none (no policy; grants revoked)
--   service_role  : ALL (ranking_guest_boards_service_role_all)

create table if not exists public.ranking_guest_boards (
  id uuid primary key default gen_random_uuid(),
  guest_id uuid not null unique,
  actor_key text check (actor_key is null or char_length(actor_key) <= 80),
  name text not null default 'My rankings'
    check (char_length(trim(name)) between 1 and 80),
  scope text not null
    check (scope in ('overall', 'QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB', 'defense')),
  includes_defenders boolean not null default false,
  format_config_id uuid references public.format_configs(id) on delete set null,
  seed_source_slug text
    check (seed_source_slug is null or seed_source_slug ~ '^[a-z0-9_-]{1,40}$'),
  player_ids uuid[] not null default '{}'::uuid[]
    check (cardinality(player_ids) <= 500),
  left_off_player_ids uuid[] not null default '{}'::uuid[]
    check (cardinality(left_off_player_ids) <= 2000),
  run_setup jsonb check (run_setup is null or jsonb_typeof(run_setup) = 'object'),
  run_answers jsonb not null default '[]'::jsonb
    check (jsonb_typeof(run_answers) = 'array' and jsonb_array_length(run_answers) <= 20000),
  answer_count integer not null default 0 check (answer_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_ranking_guest_defenders_overall_only
    check (not includes_defenders or scope = 'overall')
);

-- The cleanup sweep reads by age.
create index if not exists idx_ranking_guest_boards_updated
  on public.ranking_guest_boards(updated_at);
create index if not exists idx_ranking_guest_boards_actor
  on public.ranking_guest_boards(actor_key);

alter table public.ranking_guest_boards enable row level security;

drop policy if exists ranking_guest_boards_service_role_all on public.ranking_guest_boards;
create policy ranking_guest_boards_service_role_all on public.ranking_guest_boards
  for all to service_role
  using (true)
  with check (true);

revoke all on table public.ranking_guest_boards from anon, authenticated;

comment on table public.ranking_guest_boards is
  'Beacon Ranker boards built by signed-out readers, one per guest cookie, with the run log on the row. Service-role only. Deleted retentionHours after updated_at by /api/cron/ranking-guest-cleanup. Never counted in community rankings.';
