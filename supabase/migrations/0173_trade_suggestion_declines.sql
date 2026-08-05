-- Migration 0173: the pass list behind Trade Finder
--
-- What this backs
--   Trade Finder shows ONE suggested trade at a time. The reader either takes it
--   away and goes and offers it, or presses Not interested, which is the only
--   signal the feature gets about what a person actually wants. A pass has to
--   outlive the page, otherwise the next load opens on the trade they just
--   turned down and the button means nothing.
--
--   One row per passed suggestion. `suggestion_key` is the engine's fingerprint
--   of the deal (counterparty plus both asset lists, hashed), so passing "my 2027
--   1st for their WR" suppresses that exact deal and leaves every other package
--   involving either player alone. Details in lib/trade-finder/fingerprint.ts.
--
--   Passes expire. Rosters move, values move, and a deal that was wrong in
--   October can be the obvious deal in December, so `expires_at` is stamped two
--   weeks out and the reader is never permanently walled off from a trade
--   because of one press. Expired rows are ignored by the read and cleaned up
--   lazily; there is no cron for this.
--
--   Signed-out readers on the public league page get no row here. Their passes
--   live in component state for the length of the visit, which is the honest
--   ceiling on what we can offer someone we cannot identify.
--
-- Access matrix
--   trade_suggestion_declines : service_role ALL.
--                               authenticated SELECT / INSERT / UPDATE / DELETE
--                               own rows only (auth.uid() = user_id, enforced on
--                               both USING and WITH CHECK so a row cannot be
--                               inserted or re-pointed at another user).
--                               anon: nothing at all.
--
--   Owner writes are allowed here, unlike most tables in this schema, because the
--   row IS the user's own opinion and carries no privilege: the worst a forged
--   row can do is hide a suggestion from the forger. There is nothing to gain by
--   lying, so there is no reason to route it through a service-role RPC.
--
--   UPDATE is granted for exactly one path: passing the same deal twice pushes
--   `expires_at` out again via the upsert below. Without it the second press
--   would fail the unique index and read as a dead button.
--
-- Rollback note (no down migration ships):
--   drop table if exists public.trade_suggestion_declines;

create table if not exists public.trade_suggestion_declines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Sleeper's own league id, not a leagues.id FK. A pass is meaningful the
  -- moment it is pressed, and tying it to a row we may not have synced yet buys
  -- nothing: the key is already scoped by user, and an orphaned pass costs one
  -- row that no query will ever match.
  sleeper_league_id text not null,
  -- The engine's deal fingerprint. Opaque here on purpose: the shape of a
  -- suggestion is a code concern and this table should not need a migration when
  -- the engine learns to build a new package shape.
  suggestion_key text not null,
  declined_at timestamptz not null default now(),
  -- Two weeks. Long enough that the same deal does not reappear on the next
  -- visit, short enough that a changed roster gets a fresh hearing.
  expires_at timestamptz not null default now() + interval '14 days'
);

comment on table public.trade_suggestion_declines is
  'One row per Trade Finder suggestion a user passed on, keyed by the engine deal fingerprint. Read to filter suggestions; expires after 14 days so a pass is a snooze rather than a permanent block. Owner-readable and owner-writable; anon has no access.';

-- The read: every live pass for one user in one league. Ordered by expiry so the
-- lazy cleanup below can find the dead rows without a second index.
create index if not exists trade_suggestion_declines_lookup_idx
  on public.trade_suggestion_declines (user_id, sleeper_league_id, expires_at desc);

-- Passing the same deal twice refreshes it rather than stacking rows.
create unique index if not exists trade_suggestion_declines_unique
  on public.trade_suggestion_declines (user_id, sleeper_league_id, suggestion_key);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
--
-- Auto-RLS creates the table with row level security on and zero policies, which
-- blocks everything including the owner. Add the five this table needs.

alter table public.trade_suggestion_declines enable row level security;

drop policy if exists trade_suggestion_declines_service_role_all
  on public.trade_suggestion_declines;
create policy trade_suggestion_declines_service_role_all
  on public.trade_suggestion_declines
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists trade_suggestion_declines_select_own
  on public.trade_suggestion_declines;
create policy trade_suggestion_declines_select_own
  on public.trade_suggestion_declines
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists trade_suggestion_declines_insert_own
  on public.trade_suggestion_declines;
create policy trade_suggestion_declines_insert_own
  on public.trade_suggestion_declines
  for insert
  to authenticated
  with check (auth.uid() = user_id);

-- USING decides which rows can be updated, WITH CHECK decides what they may
-- become. Both are needed: without the second, an owner could hand their row to
-- somebody else's user_id.
drop policy if exists trade_suggestion_declines_update_own
  on public.trade_suggestion_declines;
create policy trade_suggestion_declines_update_own
  on public.trade_suggestion_declines
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists trade_suggestion_declines_delete_own
  on public.trade_suggestion_declines;
create policy trade_suggestion_declines_delete_own
  on public.trade_suggestion_declines
  for delete
  to authenticated
  using (auth.uid() = user_id);

-- Policies cannot grant what the table-level privileges withhold, so both halves
-- are stated. anon is named explicitly rather than left to inherit nothing.
revoke all on table public.trade_suggestion_declines from anon, authenticated;
grant select, insert, update, delete
  on table public.trade_suggestion_declines to authenticated;
