-- Migration 0130: signal_scout_player_overrides (admin per-player
-- eligibility overrides for the Signal Scout target pool)
--
-- Access matrix:
--   anon          : NONE
--   authenticated : NONE
--   service_role  : ALL
--   client writes : BLOCKED
--
-- A hidden player must not be discoverable by clients: knowing which
-- players are excluded from the target pool leaks information a solver
-- could use to narrow down the hidden target on future rounds. This table
-- is service-role-only with no client policies of any kind. Hide and
-- unhide are requireAdmin server actions that write through the
-- service-role client, never a direct client write.
--
-- The presence of a row is itself the override signal: the admin hide
-- action inserts a row with is_hidden = true. Unhide either deletes the row
-- (removing the override entirely) or sets is_hidden = false on the
-- existing row (keeping admin_note / audit history); either path is valid
-- and the eligibility pool query only needs to check is_hidden = true on
-- rows that exist, so a missing row and an is_hidden = false row are both
-- treated as eligible.
--
-- No indexes beyond the primary key are needed: the eligibility pool query
-- anti-joins players against this table on player_id, which the primary
-- key already serves.

create table if not exists public.signal_scout_player_overrides (
  player_id uuid primary key references public.players(id) on delete cascade,
  is_hidden boolean not null default true,
  admin_note text null,
  updated_by uuid null references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.signal_scout_player_overrides enable row level security;

-- No anon/authenticated policies -- table is service-role-only.

drop policy if exists signal_scout_player_overrides_service_role_all on public.signal_scout_player_overrides;
create policy signal_scout_player_overrides_service_role_all on public.signal_scout_player_overrides
  for all to service_role using (true) with check (true);

comment on table public.signal_scout_player_overrides is
  'Admin per-player eligibility overrides for the Signal Scout target pool. Service-role only, no client policies of any kind: a hidden player must not be discoverable by clients, since knowing which players are excluded would leak information about the pool. Hide/unhide are requireAdmin server actions writing through the service-role client. A row existing with is_hidden = true excludes the player from the target pool; the admin hide action inserts such a row, and unhide either deletes the row or sets is_hidden = false. admin_note is shown only in the admin UI.';
