-- Migration 0168: per-visitor throttle ledger for the League Pulse "Sync" button
--
-- What this backs
--   The league list at /tools/league-pulse and /my-beacon/sleeper-leagues shows a
--   "Not yet synced" pill for every league nobody has opened yet. Each of those rows
--   now carries a Sync button that runs the same pulse the deep view runs. That is a
--   full Sleeper round trip plus the derived passes, so a visitor with twenty unsynced
--   leagues could otherwise fire twenty concurrent syncs from one page.
--
--   The product rule is: one sync at a time per visitor, and at least a short cooldown
--   between the end of one and the start of the next. The browser enforces that for
--   presentation (buttons grey out), but the browser is not a limit. This ledger is.
--
-- Access matrix
--   league_sync_attempts   : service_role ALL only. anon + authenticated blocked
--                            entirely (RLS on, one service-role policy, no grants).
--   try_claim_league_sync  : EXECUTE service_role only. Called by
--                            app/api/leagues/[league_id]/sync/route.ts through the
--                            service-role client on the visitor's behalf.
--   release_league_sync    : EXECUTE service_role only. Same route, in a finally.
--
--   Same shape and same reasoning as try_claim_league_refresh (migrations 0028 and
--   0134): a SECURITY DEFINER claim that writes a service-role-only ledger must not be
--   reachable from PostgREST, or any holder of the publishable key could occupy another
--   visitor's slot or write a spoofed actor key.
--
-- Why the key is text rather than a uuid
--   The endpoint is public, like the refresh endpoint it sits beside. A signed-in
--   visitor keys on 'user:<auth uid>'. A guest keys on 'ip:<salted sha256>', derived
--   server-side from the trusted client IP (lib/client-ip.ts) and never from the
--   request body. Hashing keeps a raw IP out of the table; salting keeps the hash
--   non-precomputable.
--
-- Why sleeper_league_id is plain text with no FK
--   The whole point of this button is the league that has never been pulsed, so at
--   claim time there is frequently no row in public.leagues to reference yet. The
--   column is an audit breadcrumb, not a relationship.
--
-- Crash safety
--   A claim that never releases (process killed mid-sync, function timeout) would lock
--   that visitor out permanently on an in-flight check alone. The claim therefore
--   treats an unreleased row older than p_lease_seconds as abandoned and takes it over.
--
-- Rollback note (no down migration ships):
--   drop function if exists public.release_league_sync(text);
--   drop function if exists public.try_claim_league_sync(text, text, int, int);
--   drop table if exists public.league_sync_attempts;

create table if not exists public.league_sync_attempts (
  -- 'user:<auth uid>' or 'ip:<salted sha256 hex>'. One row per visitor, reused.
  actor_key text primary key,
  -- Last league this visitor claimed the slot for. Audit only.
  sleeper_league_id text,
  claimed_at timestamptz not null default now(),
  -- Null while the sync is in flight; stamped when it finishes, pass or fail.
  released_at timestamptz
);

comment on table public.league_sync_attempts is
  'Per-visitor throttle ledger for the public League Pulse Sync button. One row per actor (user id or salted IP hash). released_at null means a sync is in flight. service_role-only; clients hit /api/leagues/[league_id]/sync, which claims and releases the slot.';

-- Auto-RLS leaves this at zero policies, which blocks everything. Add the one
-- policy this table is supposed to have and nothing else.
alter table public.league_sync_attempts enable row level security;

drop policy if exists league_sync_attempts_service_role_all on public.league_sync_attempts;
create policy league_sync_attempts_service_role_all
  on public.league_sync_attempts
  for all
  to service_role
  using (true)
  with check (true);

revoke all on table public.league_sync_attempts from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Atomic claim
-- ---------------------------------------------------------------------------
--
-- Returns jsonb so one call answers both questions the caller has: may I start,
-- and if not, how long do I tell the visitor to wait.
--
--   { "claimed": true }
--   { "claimed": false, "retry_after_seconds": 4, "in_flight": true }
--
-- in_flight distinguishes "your other league is still syncing" from "you just
-- finished one", so the button can say which.

create or replace function public.try_claim_league_sync(
  p_actor_key text,
  p_sleeper_league_id text,
  p_cooldown_seconds int default 5,
  p_lease_seconds int default 180
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_existing public.league_sync_attempts%rowtype;
  v_ready_at timestamptz;
  v_wait int;
begin
  if p_actor_key is null or btrim(p_actor_key) = '' then
    -- Fail closed. An unattributable caller does not get a free slot.
    return jsonb_build_object('claimed', false, 'retry_after_seconds', p_cooldown_seconds);
  end if;

  -- Row lock, so two clicks landing together cannot both read "free".
  select * into v_existing
  from public.league_sync_attempts
  where actor_key = p_actor_key
  for update;

  if not found then
    begin
      insert into public.league_sync_attempts (actor_key, sleeper_league_id, claimed_at, released_at)
      values (p_actor_key, p_sleeper_league_id, v_now, null);
      return jsonb_build_object('claimed', true);
    exception when unique_violation then
      -- Another request inserted between our select and our insert. It won.
      return jsonb_build_object(
        'claimed', false,
        'retry_after_seconds', p_cooldown_seconds,
        'in_flight', true
      );
    end;
  end if;

  -- When may this visitor start again?
  --   in flight  -> not until the lease expires (abandoned-claim guard)
  --   finished   -> cooldown measured from when it finished, not when it started,
  --                 so a slow sync does not eat into the gap that follows it
  v_ready_at := case
    when v_existing.released_at is null
      then v_existing.claimed_at + make_interval(secs => p_lease_seconds)
    else v_existing.released_at + make_interval(secs => p_cooldown_seconds)
  end;

  if v_now < v_ready_at then
    v_wait := greatest(1, ceil(extract(epoch from (v_ready_at - v_now)))::int);
    return jsonb_build_object(
      'claimed', false,
      'retry_after_seconds', v_wait,
      'in_flight', v_existing.released_at is null
    );
  end if;

  update public.league_sync_attempts
     set sleeper_league_id = p_sleeper_league_id,
         claimed_at = v_now,
         released_at = null
   where actor_key = p_actor_key;

  return jsonb_build_object('claimed', true);
end;
$$;

comment on function public.try_claim_league_sync(text, text, int, int) is
  'Atomic claim of a visitor''s single League Pulse sync slot. Returns {claimed:true} or {claimed:false, retry_after_seconds, in_flight}. One sync at a time per actor, plus a cooldown measured from the previous release. service_role-only EXECUTE: the public /api/leagues/[id]/sync route calls it via the service-role client, and derives p_actor_key server-side (session uid, else salted IP hash), never from the request body.';

revoke all on function public.try_claim_league_sync(text, text, int, int) from public;
revoke execute on function public.try_claim_league_sync(text, text, int, int)
  from anon, authenticated;
grant execute on function public.try_claim_league_sync(text, text, int, int) to service_role;

-- ---------------------------------------------------------------------------
-- Release
-- ---------------------------------------------------------------------------
--
-- Called in a finally, so a failed sync frees the slot exactly like a successful
-- one. Only clears a claim that is still open: a late release from an abandoned
-- request cannot cut short a newer claim that already took the row over.

create or replace function public.release_league_sync(p_actor_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.league_sync_attempts
     set released_at = now()
   where actor_key = p_actor_key
     and released_at is null;
end;
$$;

comment on function public.release_league_sync(text) is
  'Marks a visitor''s League Pulse sync slot finished so the cooldown starts. No-op when the slot was already released or taken over. service_role-only EXECUTE.';

revoke all on function public.release_league_sync(text) from public;
revoke execute on function public.release_league_sync(text) from anon, authenticated;
grant execute on function public.release_league_sync(text) to service_role;
