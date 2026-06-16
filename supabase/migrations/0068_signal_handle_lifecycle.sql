-- Migration 0068: authoritative handle lifecycle for Signal
--
-- Enforces the handle rules in the database (path-independent) rather than only
-- in a server action, consistent with the Phase 0 trigger philosophy:
--   * reserved handles can never be claimed (signal_reserved_handles)
--   * a handle that lives in ANOTHER profile's history cannot be reclaimed
--     (blocks impersonation via an abandoned handle); reclaiming your OWN old
--     handle is allowed
--   * handle changes are rate limited to one per 30 days (first claim and the
--     first change are always allowed; only repeated changes are limited)
--   * on change, the old handle is recorded in signal_handle_history (drives the
--     301 redirect) and the newly active handle is removed from history
--
-- Both functions are SECURITY DEFINER: the guard reads reserved/history without
-- RLS surprises, and the recorder writes signal_handle_history (which is
-- service_role-only for clients). search_path includes `extensions` because the
-- citext `=` operator lives there after migration 0065. EXECUTE is revoked so
-- neither is callable over PostgREST RPC (triggers fire without EXECUTE).

create or replace function public.signals_guard_handle()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  last_change timestamptz;
  rename_window constant interval := interval '30 days';
begin
  -- Reserved handles are never claimable.
  if exists (
    select 1 from public.signal_reserved_handles r where r.handle = new.handle
  ) then
    raise exception 'reserved_handle: that handle is reserved'
      using errcode = 'check_violation';
  end if;

  -- A handle in ANOTHER profile's history cannot be reclaimed. Reclaiming your
  -- own old handle (history row points at this same signal) is allowed.
  if exists (
    select 1 from public.signal_handle_history h
    where h.old_handle = new.handle and h.signal_id <> new.id
  ) then
    raise exception 'handle_unavailable: that handle was previously used by another profile'
      using errcode = 'check_violation';
  end if;

  -- Rename rate limit: one change per 30 days, keyed off the most recent change.
  if tg_op = 'UPDATE' and new.handle is distinct from old.handle then
    select max(h.changed_at) into last_change
      from public.signal_handle_history h
     where h.signal_id = new.id;
    if last_change is not null and last_change > now() - rename_window then
      raise exception 'handle_change_rate_limited: you can change your handle again 30 days after your last change'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.signals_record_handle_change()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if new.handle is distinct from old.handle then
    -- Old handle becomes a 301 redirect source pointing at this signal.
    insert into public.signal_handle_history (old_handle, signal_id, changed_at)
    values (old.handle, new.id, now())
    on conflict (old_handle)
      do update set signal_id = excluded.signal_id, changed_at = excluded.changed_at;
    -- The newly active handle must not also be a redirect source.
    delete from public.signal_handle_history where old_handle = new.handle;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_signals_guard_handle on public.signals;
create trigger trg_signals_guard_handle
  before insert or update of handle on public.signals
  for each row execute function public.signals_guard_handle();

drop trigger if exists trg_signals_record_handle_change on public.signals;
create trigger trg_signals_record_handle_change
  after update of handle on public.signals
  for each row execute function public.signals_record_handle_change();

revoke execute on function public.signals_guard_handle() from public, anon, authenticated;
revoke execute on function public.signals_record_handle_change() from public, anon, authenticated;
