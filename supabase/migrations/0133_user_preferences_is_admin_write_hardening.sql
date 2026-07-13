-- Migration 0133: user_preferences.is_admin write hardening
-- Findings: FFB-SEC-001 (critical), FFB-SEC-014, part of FFB-SEC-016.
--
-- Security invariant:
--   A caller using the anon or authenticated PostgREST roles can NEVER cause any
--   user_preferences.is_admin value to become true. This holds for INSERT, UPDATE,
--   UPSERT, DELETE-then-INSERT, omitted is_admin, explicit is_admin=false, explicit
--   is_admin=true, false->true, true->false, a missing/null JWT-claims context, and
--   attempts to touch another user's row. Only trusted server-side roles
--   (service_role, and DB superusers used by migrations/cron) may write is_admin.
--
-- Defense in depth (two independent controls):
--   1. Column-level privileges. anon/authenticated hold INSERT/UPDATE only on the
--      non-admin columns and never on is_admin, so PostgREST is denied at the SQL
--      layer the moment a payload names is_admin.
--   2. Trigger guard. A BEFORE INSERT OR UPDATE trigger rejects any is_admin change
--      (or a non-false is_admin on INSERT) when the effective role is anon or
--      authenticated. It fails closed: those two roles are rejected regardless of
--      whether JWT claims are present.
--
-- Access matrix (user_preferences):
--   anon          : no INSERT/UPDATE at all (RLS also has no anon write policy).
--   authenticated : SELECT own; INSERT/UPDATE own row on every column EXCEPT is_admin.
--   service_role  : ALL (the legitimate admin-promotion path).
--
-- Why current_user is trustworthy here: the trigger function is SECURITY INVOKER, so
-- current_user is the role PostgREST switched into for the request (anon /
-- authenticated / service_role). The publishable key can only reach anon and
-- authenticated; a client cannot SET ROLE service_role. Reading current_user inside a
-- SECURITY DEFINER function would instead return the function owner, which is why the
-- previous 0018 guard relied on the request.jwt.claims GUC and failed open when that
-- GUC was null (FFB-SEC-014). This guard does not depend on the GUC.
--
-- Idempotent: create-or-replace function, drop-if-exists trigger, revoke/grant are
-- all safe to re-run.
--
-- Rollback note (no down migration ships): to revert, re-grant table INSERT/UPDATE to
-- authenticated (grant insert, update on public.user_preferences to authenticated) and
-- restore the BEFORE UPDATE-only trigger from migration 0018. Reverting reopens the
-- critical escalation and is not recommended.

-- 1. Trigger guard (defense-in-depth layer 2). Fail closed for untrusted roles.
create or replace function public.user_preferences_block_is_admin_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_admin_write boolean;
begin
  if tg_op = 'INSERT' then
    -- A new row may only be created with the default (false). Seeding is_admin to
    -- any non-false value counts as an admin write.
    v_admin_write := coalesce(new.is_admin, false) is distinct from false;
  else
    v_admin_write := new.is_admin is distinct from old.is_admin;
  end if;

  if v_admin_write then
    -- The publishable key can only reach the anon and authenticated PostgREST roles.
    -- Reject those unconditionally. SECURITY INVOKER keeps current_user equal to the
    -- role PostgREST switched into for this request, so this does not depend on the
    -- request.jwt.claims GUC and cannot fail open when claims are null.
    if current_user in ('anon', 'authenticated') then
      raise exception 'is_admin can only be modified by a trusted server-side role'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.user_preferences_block_is_admin_change() is
  'Rejects is_admin writes by the anon/authenticated PostgREST roles on INSERT and UPDATE. Fails closed and does not depend on request.jwt.claims. Part of the FFB-SEC-001 admin-escalation fix (migration 0133).';

drop trigger if exists trg_user_preferences_block_is_admin_change on public.user_preferences;
create trigger trg_user_preferences_block_is_admin_change
  before insert or update on public.user_preferences
  for each row execute function public.user_preferences_block_is_admin_change();

-- The guard is a trigger, not an RPC. Remove the unnecessary direct EXECUTE grants so
-- it is not callable via PostgREST (FFB-SEC-016). Triggers fire regardless of EXECUTE.
-- EXECUTE is also held via the PUBLIC pseudo-role by default, so revoke from PUBLIC too
-- (revoking only anon/authenticated leaves the inherited PUBLIC grant intact).
revoke execute on function public.user_preferences_block_is_admin_change() from public, anon, authenticated;

-- 2. Column-level privileges (defense-in-depth layer 1).
-- Drop the blanket table INSERT/UPDATE grants, plus any explicit is_admin column grant,
-- then re-grant INSERT/UPDATE to authenticated on the non-admin columns only.
revoke insert, update on public.user_preferences from anon, authenticated;
revoke insert (is_admin), update (is_admin) on public.user_preferences from anon, authenticated;

grant insert (
  user_id,
  default_format_config_id,
  default_source_slug,
  sleeper_league_settings,
  first_name,
  last_name,
  bio,
  avatar_path,
  created_at,
  updated_at
) on public.user_preferences to authenticated;

grant update (
  user_id,
  default_format_config_id,
  default_source_slug,
  sleeper_league_settings,
  first_name,
  last_name,
  bio,
  avatar_path,
  created_at,
  updated_at
) on public.user_preferences to authenticated;
