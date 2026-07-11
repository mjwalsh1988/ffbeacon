-- Migration 0125: signal_scout_rounds (core game-round table for the
-- Signal Scout hidden-player guessing game)
--
-- Access matrix:
--   anon          : NONE
--   authenticated : NONE
--   service_role  : ALL
--   client writes : BLOCKED
--
-- This table holds the hidden target player and the frozen settings snapshot
-- for each round, the core anti-cheat secret of the game. Clients must never
-- be able to read target_player_id or settings_snapshot directly. All reads
-- flow through server routes that return minimal DTOs (no target, no raw
-- settings) built server-side with the service-role client.
--
-- Exactly one identity per round: a round belongs to either a signed-in user
-- (user_id) or a guest (guest_id), never both and never neither.
--
-- ip_hash is a salted SHA-256 of the guest's IP address, populated only on
-- guest rounds for abuse detection. Raw IP addresses are never stored.
--
-- One active round per identity is enforced by the two partial unique
-- indexes below (signal_scout_rounds_one_active_per_user and
-- signal_scout_rounds_one_active_per_guest), not by application logic.
-- A round in progress cannot simply be discarded to start a new one; the
-- only way out of an active round is to skip it (status = 'skipped').
--
-- game_date defaults to the current day in America/New_York as a safety net
-- only. The app is expected to set game_date explicitly at round creation so
-- the value matches the day's puzzle regardless of server clock timezone.

create table if not exists public.signal_scout_rounds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid null references auth.users(id) on delete cascade,
  guest_id uuid null,
  ip_hash text null,
  target_player_id uuid not null references public.players(id),
  status text not null default 'active' check (status in ('active', 'won', 'solved_late', 'failed', 'skipped')),
  score_available integer not null check (score_available >= 0),
  score_awarded integer not null default 0 check (score_awarded >= 0),
  wrong_guess_count integer not null default 0 check (wrong_guess_count >= 0),
  hints_used integer not null default 0 check (hints_used >= 0),
  tier_purchases jsonb not null default '{}'::jsonb,
  burned_out_at timestamptz null,
  settings_snapshot jsonb not null,
  game_date date not null default ((now() at time zone 'America/New_York')::date),
  started_at timestamptz not null default now(),
  completed_at timestamptz null,
  constraint signal_scout_rounds_one_identity check ((user_id is null) <> (guest_id is null))
);

create unique index if not exists signal_scout_rounds_one_active_per_user
  on public.signal_scout_rounds (user_id)
  where status = 'active' and user_id is not null;

create unique index if not exists signal_scout_rounds_one_active_per_guest
  on public.signal_scout_rounds (guest_id)
  where status = 'active' and guest_id is not null;

create index if not exists signal_scout_rounds_user_started_idx
  on public.signal_scout_rounds (user_id, started_at desc);

create index if not exists signal_scout_rounds_guest_game_date_idx
  on public.signal_scout_rounds (guest_id, game_date);

create index if not exists signal_scout_rounds_ip_hash_game_date_idx
  on public.signal_scout_rounds (ip_hash, game_date);

create index if not exists signal_scout_rounds_target_status_idx
  on public.signal_scout_rounds (target_player_id, status);

alter table public.signal_scout_rounds enable row level security;

-- No anon/authenticated policies -- table is service-role-only.

drop policy if exists signal_scout_rounds_service_role_all on public.signal_scout_rounds;
create policy signal_scout_rounds_service_role_all on public.signal_scout_rounds
  for all to service_role using (true) with check (true);

comment on table public.signal_scout_rounds is
  'Core game-round table for Signal Scout. Holds the hidden target player and frozen settings snapshot per round, the anti-cheat secret. Service-role only; clients read minimal DTOs via server routes, never this table directly. One active round per identity enforced by signal_scout_rounds_one_active_per_user / signal_scout_rounds_one_active_per_guest partial unique indexes; abandoning an active round is only possible via skip. ip_hash is a salted SHA-256 of the guest IP, populated only on guest rounds; raw IPs are never stored.';
