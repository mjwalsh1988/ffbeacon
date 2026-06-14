-- Migration 0040: beacon_manual_signals (owner one-time nudges)
--
-- Access matrix:
--   anon          : none
--   authenticated : none
--   service_role  : ALL (admin server actions write; engine reads, both via service role)
--   client writes : BLOCKED
--
-- The owner's personal signals. Read ONLY by the FF Beacon engine, so they can
-- never leak into any other source's pipeline. A signal targets a player or a
-- draft pick, scoped to one format or all (format_config_id NULL = all).
--
-- silent vs true-signal (the composer toggle):
--   silent = false : a true signal. Flows into player_value_history normally and
--                    SHOWS as trend/movement (intentional).
--   silent = true  : formula-induced. The value changes but the delta is tagged
--                    and excluded from trend math via player_value_history
--                    .formula_offset (migration 0046), so chips do not show it.
--
-- adjustment_type:
--   multiplier : value * magnitude
--   delta      : value + magnitude
--   set_value  : absolute override; bypasses base/factor entirely in the engine.

create table if not exists public.beacon_manual_signals (
  id uuid primary key default gen_random_uuid(),
  target text not null check (target in ('player','pick')),

  player_id uuid references public.players(id) on delete cascade,

  pick_season integer,
  pick_round integer,
  pick_position text,

  format_config_id uuid references public.format_configs(id) on delete cascade,

  adjustment_type text not null check (adjustment_type in ('multiplier','delta','set_value')),
  magnitude numeric not null,
  silent boolean not null default false,
  reason text,
  decay_days integer check (decay_days is null or decay_days > 0),

  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz,

  -- A player signal needs a player_id; a pick signal needs the pick coordinates.
  check (
    (target = 'player' and player_id is not null)
    or
    (target = 'pick' and pick_round is not null and pick_position is not null)
  )
);

create index if not exists idx_beacon_manual_signals_active
  on public.beacon_manual_signals (is_active)
  where is_active = true;
create index if not exists idx_beacon_manual_signals_player
  on public.beacon_manual_signals (player_id)
  where player_id is not null;

alter table public.beacon_manual_signals enable row level security;

drop policy if exists beacon_manual_signals_service_role_all on public.beacon_manual_signals;
create policy beacon_manual_signals_service_role_all on public.beacon_manual_signals
  for all to service_role using (true) with check (true);

comment on table public.beacon_manual_signals is
  'Owner one-time nudges read ONLY by the FF Beacon engine. silent=true changes value but is hidden from trends via formula_offset. Admin-managed.';
