-- Migration 0126: signal_scout_round_clues (the stored clue file per round
-- for the Signal Scout hidden-player guessing game)
--
-- Access matrix:
--   anon          : NONE
--   authenticated : NONE
--   service_role  : ALL
--   client writes : BLOCKED
--
-- Unrevealed rows in this table ARE answer data. Each row is one clue about
-- the round's hidden target player; a client that could read the unrevealed
-- rows could trivially deduce the target before earning the reveal. There
-- are no client policies of any kind, not even for revealed rows. Clients
-- only ever see revealed clues via server-built minimal DTOs (server routes
-- filter to is_revealed = true and reshape before responding); this table is
-- never queried directly from the client.
--
-- Each round's clue file is generated once at round start and frozen: label
-- and display_value are pre-rendered strings captured at that moment so a
-- nightly data sync can never mutate the wording or values of a clue inside
-- an in-progress round.
--
-- tier classifies how a clue was obtained: 'starter' rows are revealed free
-- at round start (cost 0); the remaining four tiers are the paid reveal
-- tiers a player can spend score to unlock, mapped to product-facing names
-- as follows: weak = Weak Signal, clear = Clear Signal, ping = Beacon Ping,
-- scan = Full Scan.

create table if not exists public.signal_scout_round_clues (
  round_id uuid not null references public.signal_scout_rounds(id) on delete cascade,
  clue_key text not null,
  tier text not null check (tier in ('starter', 'weak', 'clear', 'ping', 'scan')),
  label text not null,
  display_value text not null,
  specificity integer not null,
  cost integer not null check (cost >= 0),
  is_revealed boolean not null default false,
  reveal_order integer null,
  revealed_at timestamptz null,
  primary key (round_id, clue_key)
);

create index if not exists signal_scout_round_clues_round_tier_revealed_idx
  on public.signal_scout_round_clues (round_id, tier, is_revealed);

alter table public.signal_scout_round_clues enable row level security;

-- No anon/authenticated policies -- table is service-role-only. Unrevealed
-- rows are answer data; even revealed rows are never queried directly by
-- clients, so no read policy exists for any non-service role.

drop policy if exists signal_scout_round_clues_service_role_all on public.signal_scout_round_clues;
create policy signal_scout_round_clues_service_role_all on public.signal_scout_round_clues
  for all to service_role using (true) with check (true);

comment on table public.signal_scout_round_clues is
  'Stored clue file for a Signal Scout round, one row per clue keyed by (round_id, clue_key). Unrevealed rows are answer data (they would let a client deduce the hidden target), so this table is service-role-only with no client policies of any kind; clients only ever see revealed clues via server-built minimal DTOs. label and display_value are pre-rendered and frozen at round start so nightly syncs never mutate a live round. tier is starter (free, cost 0) or one of the four paid reveal tiers: weak (Weak Signal), clear (Clear Signal), ping (Beacon Ping), scan (Full Scan).';
