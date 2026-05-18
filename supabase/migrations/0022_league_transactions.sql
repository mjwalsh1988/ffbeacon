-- Migration 0022: league_transactions
--
-- League Sync feature: trade, waiver, and free-agent move history.
-- Sleeper returns transactions per week (loop 0..max, stop after 3 empty).
-- adds/drops are jsonb objects mapping sleeper_player_id -> sleeper_roster_id.
-- draft_picks normalized to an array during sync (Sleeper sends array,
-- object, or string variants, see CLAUDE.md gotchas section).
--
-- Access matrix:
--   anon          : SELECT
--   authenticated : SELECT
--   service_role  : ALL
--   client writes : BLOCKED

create table if not exists public.league_transactions (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  sleeper_transaction_id text not null,
  type text not null,
  status text,
  week integer,
  season integer,
  adds jsonb not null default '{}'::jsonb,
  drops jsonb not null default '{}'::jsonb,
  draft_picks jsonb not null default '[]'::jsonb,
  waiver_budget jsonb not null default '[]'::jsonb,
  roster_ids jsonb not null default '[]'::jsonb,
  created_at_sleeper timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (league_id, sleeper_transaction_id)
);

create index if not exists idx_league_transactions_league_id on public.league_transactions(league_id);
create index if not exists idx_league_transactions_type on public.league_transactions(type);
create index if not exists idx_league_transactions_created_at_sleeper
  on public.league_transactions(created_at_sleeper desc);
create index if not exists idx_league_transactions_week
  on public.league_transactions(league_id, week);

alter table public.league_transactions enable row level security;

drop policy if exists league_transactions_select_public on public.league_transactions;
create policy league_transactions_select_public on public.league_transactions
  for select to anon, authenticated using (true);

drop policy if exists league_transactions_service_role_all on public.league_transactions;
create policy league_transactions_service_role_all on public.league_transactions
  for all to service_role using (true) with check (true);

comment on table public.league_transactions is
  'Synced Sleeper transactions per league. Includes trades, waivers, free-agent moves, and commissioner actions.';
comment on column public.league_transactions.metadata is
  'Raw Sleeper transaction object preserved verbatim. See CLAUDE.md Original Source Object Preservation rule.';
comment on column public.league_transactions.draft_picks is
  'Normalized array of pick descriptors (Sleeper sends array | object | jsonstring; sync normalizes to array).';
comment on column public.league_transactions.roster_ids is
  'Array of sleeper_roster_id values involved in the transaction (extracted from adds + drops + draft_picks keys, deduped). Enables team-filter queries without scanning the jsonb maps.';
