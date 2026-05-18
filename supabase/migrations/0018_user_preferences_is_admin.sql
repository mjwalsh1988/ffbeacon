-- Migration 0018: user_preferences.is_admin
--
-- Access matrix (column inherits row-level policies from 0008):
--   anon          : NONE
--   authenticated : SELECT own; UPDATE own EXCEPT is_admin column (blocked by trigger)
--   service_role  : ALL
--
-- Adds an is_admin boolean to gate FF Beacon admin-only actions
-- (e.g. League Sync force-resync). Default false; managed manually
-- by a service-role operator. A BEFORE UPDATE trigger prevents
-- authenticated users from self-promoting via the existing
-- user_preferences_update_own policy.

alter table public.user_preferences
  add column if not exists is_admin boolean not null default false;

comment on column public.user_preferences.is_admin is
  'Admin flag. Owner cannot self-promote: trg_user_preferences_block_is_admin_change rejects changes from any role other than service_role. Gates admin-only actions like League Sync force-resync.';

create or replace function public.user_preferences_block_is_admin_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_admin is distinct from old.is_admin then
    if current_setting('request.jwt.claims', true) is not null
       and (current_setting('request.jwt.claims', true)::jsonb->>'role') <> 'service_role'
    then
      raise exception 'is_admin can only be modified by service_role';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_user_preferences_block_is_admin_change on public.user_preferences;
create trigger trg_user_preferences_block_is_admin_change
  before update on public.user_preferences
  for each row execute function public.user_preferences_block_is_admin_change();
