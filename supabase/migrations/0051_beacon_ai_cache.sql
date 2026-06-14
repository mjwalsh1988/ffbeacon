-- Migration 0051: beacon_ai_cache (per-input AI adjustment cache)
--
-- Access matrix:
--   anon          : none
--   authenticated : none
--   service_role  : ALL (engine reads + writes during a value run)
--   client writes : BLOCKED
--
-- Caches one Anthropic adjustment response per input hash so re-runs with
-- unchanged inputs (same player payload + model + bound) never re-bill the API.
-- The hash is sha256 of the JSON payload combined with the model id and the
-- adjustment bound, computed in lib/beacon/signals/ai-adjust.ts. A row is the
-- clamped, parsed result the engine folds into the bounded factor. This is a
-- derived/operational table, so no metadata jsonb is required.

create table if not exists public.beacon_ai_cache (
  input_hash text primary key,
  player_id uuid references public.players(id) on delete set null,
  adjustment_pct numeric not null,
  confidence numeric not null,
  rationale text,
  model text not null,
  created_at timestamptz not null default now()
);

create index if not exists beacon_ai_cache_player_idx on public.beacon_ai_cache (player_id);

alter table public.beacon_ai_cache enable row level security;

drop policy if exists beacon_ai_cache_service_role_all on public.beacon_ai_cache;
create policy beacon_ai_cache_service_role_all on public.beacon_ai_cache
  for all to service_role using (true) with check (true);

comment on table public.beacon_ai_cache is
  'Caches Anthropic per-player adjustment responses keyed by input hash (payload + model + bound) so unchanged inputs never re-bill. Service-role only; derived data, no metadata column.';
