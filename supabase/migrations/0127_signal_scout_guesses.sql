-- Migration 0127: signal_scout_guesses (one row per guess made in a Signal
-- Scout round)
--
-- Access matrix:
--   anon          : NONE
--   authenticated : NONE
--   service_role  : ALL
--   client writes : BLOCKED
--
-- Guesses are written only by the server guess route, never by clients
-- reading or writing this table directly. Wrong guesses feed the
-- player-facing Bad Reads list, but only through server-built minimal DTOs;
-- clients never query signal_scout_guesses itself.
--
-- Duplicate guesses within a round are impossible: the primary key is
-- (round_id, guessed_player_id). The API layer rejects a repeat guess with a
-- 409 as the normal user-facing path, and this primary key is the database
-- backstop if that check is ever bypassed.
--
-- created_at deltas between consecutive guesses within a round also power
-- the admin integrity panel's rapid-guess (bot/scripted-guessing) detection,
-- which is why signal_scout_guesses_created_idx exists in addition to the
-- admin recent-guesses table use case.

create table if not exists public.signal_scout_guesses (
  round_id uuid not null references public.signal_scout_rounds(id) on delete cascade,
  guessed_player_id uuid not null references public.players(id),
  is_correct boolean not null,
  guess_number integer not null check (guess_number >= 1),
  created_at timestamptz not null default now(),
  primary key (round_id, guessed_player_id)
);

create unique index if not exists signal_scout_guesses_round_number_key
  on public.signal_scout_guesses (round_id, guess_number);

create index if not exists signal_scout_guesses_player_idx
  on public.signal_scout_guesses (guessed_player_id);

create index if not exists signal_scout_guesses_created_idx
  on public.signal_scout_guesses (created_at desc);

alter table public.signal_scout_guesses enable row level security;

-- No anon/authenticated policies -- table is service-role-only.

drop policy if exists signal_scout_guesses_service_role_all on public.signal_scout_guesses;
create policy signal_scout_guesses_service_role_all on public.signal_scout_guesses
  for all to service_role using (true) with check (true);

comment on table public.signal_scout_guesses is
  'One row per guess made in a Signal Scout round. Written only by the server guess route; service-role only, no client policies. Wrong guesses feed the visible Bad Reads list through server-built minimal DTOs, never by clients reading this table directly. Duplicate guesses within a round are impossible: primary key is (round_id, guessed_player_id), backstopping the API layer 409 on repeat guesses. signal_scout_guesses_round_number_key enforces one guess per order slot per round. signal_scout_guesses_created_idx supports the admin recent-guesses table and the integrity panel rapid-guess detection (created_at deltas between consecutive guesses in a round).';
