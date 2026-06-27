-- Migration 0110: On The Clock sync-lock RPCs (the durable, server-enforced lock)
--
-- Modeled on try_claim_league_resync (migration 0026). All three run SECURITY DEFINER
-- so they can write on_the_clock_draft_cache (which is service-role-only for writes)
-- while keeping the lock logic in the database, not in Vercel memory.
--
-- EXECUTE is granted to service_role ONLY: every caller is the server sync route via
-- createAdminClient(). The browser never calls these and can never bypass the cooldown.
--
-- Lock model:
--   last_synced_at    advances ONLY on a successful sync (complete_*), drives the 30s cooldown.
--   sync_locked_until short in-progress lock (default 15s) that blocks a second concurrent sync.
--   claim returns claimed=true to exactly one caller per window; others get cache + status.
--   release clears the in-progress lock after a Sleeper failure WITHOUT advancing last_synced_at.

-- claim: attempt to win the sync slot for a draft. Ensures the row exists, then a single
-- conditional UPDATE wins only if the cooldown has elapsed AND no live in-progress lock.
create or replace function public.claim_on_the_clock_sync(
  p_draft_id text,
  p_league_id text,
  p_season text,
  p_cooldown_seconds int default 30,
  p_lock_seconds int default 15
)
returns table (
  claimed boolean,
  last_synced_at timestamptz,
  cooldown_remaining_seconds int,
  locked_by_other boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claimed boolean := false;
  v_last_synced timestamptz;
  v_locked_until timestamptz;
begin
  -- ensure the draft row exists (idempotent)
  insert into public.on_the_clock_draft_cache (sleeper_draft_id, sleeper_league_id, season)
  values (p_draft_id, p_league_id, p_season)
  on conflict (sleeper_draft_id) do nothing;

  -- single atomic claim: succeeds only if the cooldown elapsed AND no live lock is held.
  -- The table is aliased (c) and the WHERE refs qualified so they bind to the columns,
  -- not the RETURNS TABLE output variables of the same name (last_synced_at).
  with upd as (
    update public.on_the_clock_draft_cache as c
       set sync_locked_until = now() + make_interval(secs => p_lock_seconds),
           updated_at = now()
     where c.sleeper_draft_id = p_draft_id
       and (c.last_synced_at is null
            or c.last_synced_at < now() - make_interval(secs => p_cooldown_seconds))
       and (c.sync_locked_until is null or c.sync_locked_until < now())
    returning 1
  )
  select exists(select 1 from upd) into v_claimed;

  -- read current state for the status fields (reflects our update if we won)
  select c.last_synced_at, c.sync_locked_until
    into v_last_synced, v_locked_until
    from public.on_the_clock_draft_cache c
   where c.sleeper_draft_id = p_draft_id;

  return query select
    v_claimed,
    v_last_synced,
    greatest(
      0,
      ceil(
        p_cooldown_seconds
        - coalesce(extract(epoch from now() - v_last_synced), p_cooldown_seconds)
      )
    )::int,
    -- locked_by_other: we did NOT win, but a live in-progress lock is held -> another sync is running
    (not v_claimed and v_locked_until is not null and v_locked_until > now());
end;
$$;

-- complete: mark a successful sync. Advances last_synced_at (starts the cooldown),
-- clears the in-progress lock, records the pick count and draft status.
create or replace function public.complete_on_the_clock_sync(
  p_draft_id text,
  p_pick_count int,
  p_status text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.on_the_clock_draft_cache
     set last_synced_at = now(),
         sync_locked_until = null,
         pick_count = p_pick_count,
         draft_status = coalesce(p_status, draft_status),
         updated_at = now()
   where sleeper_draft_id = p_draft_id;
end;
$$;

-- release: Sleeper-failure path. Clears the in-progress lock so the user can retry
-- sooner, WITHOUT advancing last_synced_at (so the cooldown does not start on a failure).
create or replace function public.release_on_the_clock_sync(
  p_draft_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.on_the_clock_draft_cache
     set sync_locked_until = null,
         updated_at = now()
   where sleeper_draft_id = p_draft_id;
end;
$$;

revoke all on function public.claim_on_the_clock_sync(text, text, text, int, int) from public;
grant execute on function public.claim_on_the_clock_sync(text, text, text, int, int) to service_role;

revoke all on function public.complete_on_the_clock_sync(text, int, text) from public;
grant execute on function public.complete_on_the_clock_sync(text, int, text) to service_role;

revoke all on function public.release_on_the_clock_sync(text) from public;
grant execute on function public.release_on_the_clock_sync(text) to service_role;

comment on function public.claim_on_the_clock_sync(text, text, text, int, int) is
  'Durable per-draft sync claim for On The Clock. Ensures the draft_cache row exists, then atomically wins the sync slot only if the cooldown elapsed and no live in-progress lock is held. Returns (claimed, last_synced_at, cooldown_remaining_seconds, locked_by_other). service_role EXECUTE only; the server sync route is the sole caller.';
comment on function public.complete_on_the_clock_sync(text, int, text) is
  'Marks a successful On The Clock sync: advances last_synced_at (starts the cooldown), clears the in-progress lock, records pick_count and draft_status. service_role EXECUTE only.';
comment on function public.release_on_the_clock_sync(text) is
  'Clears the On The Clock in-progress lock after a Sleeper failure WITHOUT advancing last_synced_at, so the user can retry before the cooldown. service_role EXECUTE only.';
