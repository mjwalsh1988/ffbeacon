-- Migration 0131: signal_scout_activity_counters (abuse-guard ledger) plus
-- try_claim_signal_scout_action and try_start_signal_scout_guest_round, the
-- SECURITY DEFINER RPCs that write it.
--
-- Access matrix (table):
--   anon          : NONE
--   authenticated : NONE
--   service_role  : ALL
--   client writes : BLOCKED (written only via the two RPCs below; read by
--                   the admin integrity panel via the service-role client)
--
-- The (count, last_at) shape supports MIN-INTERVAL claims (at most one
-- successful claim per N seconds per identity/action/day), not true
-- sliding-window counts. Per-minute style rate limits are expressed by
-- callers as min-interval equivalents (e.g. "1 per 2 seconds" rather than
-- "30 per minute"). count accumulates successful claims across the ET day
-- and powers the admin integrity panel volume stats; it does not decay
-- within the day.
--
-- identity_key is namespaced so the same table can hold counters for every
-- identity shape the game has: 'user:<uuid>', 'guest:<uuid>', or
-- 'ip:<hash>'. action distinguishes what is being throttled (e.g. 'search',
-- 'guess', 'hint', 'guest_round_start').
--
-- SECURITY DEFINER gotcha (see migration 0114 for the original discovery):
-- `revoke all on function ... from public` alone is NOT enough. Supabase's
-- project default privileges also grant EXECUTE to anon and authenticated
-- explicitly, so both RPCs below explicitly revoke from public, anon, and
-- authenticated, then grant only to service_role. Both functions are called
-- exclusively from server routes via the service-role client; the browser
-- never calls them directly.

create table if not exists public.signal_scout_activity_counters (
  identity_key text not null,
  action text not null,
  game_date date not null,
  count integer not null default 0 check (count >= 0),
  last_at timestamptz not null default now(),
  primary key (identity_key, action, game_date)
);

alter table public.signal_scout_activity_counters enable row level security;

-- No anon/authenticated policies -- table is service-role-only.

drop policy if exists signal_scout_activity_counters_service_role_all on public.signal_scout_activity_counters;
create policy signal_scout_activity_counters_service_role_all on public.signal_scout_activity_counters
  for all to service_role using (true) with check (true);

comment on table public.signal_scout_activity_counters is
  'Abuse-guard activity ledger for Signal Scout, keyed by (identity_key, action, game_date). identity_key is namespaced: user:<uuid>, guest:<uuid>, or ip:<hash>. Supports min-interval claims (count, last_at), not true sliding-window counts; count accumulates successful claims per ET day for the admin integrity panel. Service-role only; written exclusively via try_claim_signal_scout_action and try_start_signal_scout_guest_round.';

-- PART 2: try_claim_signal_scout_action
--
-- Atomic min-interval claim over signal_scout_activity_counters. Returns
-- true if the caller won the window for this (identity_key, action,
-- game_date) key (row inserted fresh, or the cooldown since last_at has
-- elapsed), false otherwise. count and last_at change ONLY on a successful
-- claim, matching the try_claim_on_the_clock_lookup shape from migration
-- 0111.

create or replace function public.try_claim_signal_scout_action(
  p_identity_key text,
  p_action text,
  p_game_date date,
  p_window_seconds int default 2
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claimed boolean := false;
begin
  with upsert as (
    insert into public.signal_scout_activity_counters (identity_key, action, game_date, count, last_at)
    values (p_identity_key, p_action, p_game_date, 1, now())
    on conflict (identity_key, action, game_date) do update
      set count = public.signal_scout_activity_counters.count + 1,
          last_at = now()
      where public.signal_scout_activity_counters.last_at
            < now() - make_interval(secs => p_window_seconds)
    returning 1
  )
  select exists(select 1 from upsert) into v_claimed;
  return v_claimed;
end;
$$;

revoke all on function public.try_claim_signal_scout_action(text, text, date, int) from public, anon, authenticated;
grant execute on function public.try_claim_signal_scout_action(text, text, date, int) to service_role;

comment on function public.try_claim_signal_scout_action(text, text, date, int) is
  'Atomic per-(identity_key, action, game_date) min-interval claim for Signal Scout abuse guards. Returns true if the caller won the window, false otherwise; count and last_at change only on a successful claim. service_role EXECUTE only.';

-- PART 3: try_start_signal_scout_guest_round
--
-- Atomic guest daily round-start cap enforcing max(guest count, ip count) <
-- limit for the day, so a guest cannot bypass the per-guest-cookie limit by
-- rotating cookies from the same IP, nor vice versa. Both counters are
-- incremented together on success (both-or-neither), guaranteed by running
-- inside the function's single implicit transaction.
--
-- If p_guest_id is null, returns false defensively; the calling route
-- always mints a guest cookie before this RPC is reachable, so this branch
-- should never trigger in normal operation.
--
-- If p_ip_hash is null or empty, enforcement falls back to the guest key
-- alone. This is a defensive degrade, not a bypass: the guest identity is
-- still capped at p_limit, it is only the cross-identity (same IP, rotated
-- cookie) protection that is unavailable for that call. The route always
-- supplies a hash in normal operation.
--
-- The two counter rows are locked in ascending identity_key order (guest
-- key vs ip key, compared as text) via two separate sequential SELECT ...
-- FOR UPDATE statements. Locking in a fixed, deterministic order (rather
-- than relying on ORDER BY inside a single locking query, which does not
-- reliably control lock acquisition order in Postgres) is what prevents a
-- deadlock between two concurrent calls that both touch the same pair of
-- keys in opposite order.

create or replace function public.try_start_signal_scout_guest_round(
  p_guest_id uuid,
  p_ip_hash text,
  p_limit int,
  p_game_date date
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action text := 'guest_round_start';
  v_guest_key text;
  v_ip_key text;
  v_has_ip boolean;
  v_guest_count integer;
  v_ip_count integer;
begin
  if p_guest_id is null then
    return false;
  end if;

  v_guest_key := 'guest:' || p_guest_id::text;
  v_has_ip := p_ip_hash is not null and p_ip_hash <> '';

  if v_has_ip then
    v_ip_key := 'ip:' || p_ip_hash;
  end if;

  insert into public.signal_scout_activity_counters (identity_key, action, game_date, count, last_at)
  values (v_guest_key, v_action, p_game_date, 0, now())
  on conflict (identity_key, action, game_date) do nothing;

  if v_has_ip then
    insert into public.signal_scout_activity_counters (identity_key, action, game_date, count, last_at)
    values (v_ip_key, v_action, p_game_date, 0, now())
    on conflict (identity_key, action, game_date) do nothing;
  end if;

  -- Lock both rows in a fixed, deterministic key order to prevent deadlock
  -- between concurrent calls that share a key.
  if v_has_ip and v_ip_key < v_guest_key then
    perform 1 from public.signal_scout_activity_counters
      where identity_key = v_ip_key and action = v_action and game_date = p_game_date
      for update;
    perform 1 from public.signal_scout_activity_counters
      where identity_key = v_guest_key and action = v_action and game_date = p_game_date
      for update;
  else
    perform 1 from public.signal_scout_activity_counters
      where identity_key = v_guest_key and action = v_action and game_date = p_game_date
      for update;
    if v_has_ip then
      perform 1 from public.signal_scout_activity_counters
        where identity_key = v_ip_key and action = v_action and game_date = p_game_date
        for update;
    end if;
  end if;

  select count into v_guest_count
  from public.signal_scout_activity_counters
  where identity_key = v_guest_key and action = v_action and game_date = p_game_date;

  if v_has_ip then
    select count into v_ip_count
    from public.signal_scout_activity_counters
    where identity_key = v_ip_key and action = v_action and game_date = p_game_date;
  else
    v_ip_count := 0;
  end if;

  if greatest(v_guest_count, v_ip_count) >= p_limit then
    return false;
  end if;

  update public.signal_scout_activity_counters
  set count = count + 1, last_at = now()
  where identity_key = v_guest_key and action = v_action and game_date = p_game_date;

  if v_has_ip then
    update public.signal_scout_activity_counters
    set count = count + 1, last_at = now()
    where identity_key = v_ip_key and action = v_action and game_date = p_game_date;
  end if;

  return true;
end;
$$;

revoke all on function public.try_start_signal_scout_guest_round(uuid, text, int, date) from public, anon, authenticated;
grant execute on function public.try_start_signal_scout_guest_round(uuid, text, int, date) to service_role;

comment on function public.try_start_signal_scout_guest_round(uuid, text, int, date) is
  'Atomic guest daily round-start cap for Signal Scout, enforcing max(guest cookie count, ip count) < p_limit so cookie rotation from the same IP cannot bypass the cap. Increments both counters together on success (both-or-neither). p_guest_id null returns false defensively; p_ip_hash null/empty degrades to guest-only enforcement (never a bypass). service_role EXECUTE only.';
