-- 0159: set_default_source could never run from the app.
--
-- THE BUG
-- The function body from 0053 was a single unqualified statement:
--
--   update public.source_registry set is_default = (slug = target_slug);
--
-- Supabase preloads the safeupdate extension on the PostgREST connection role,
-- which raises SQLSTATE 21000 "UPDATE requires a WHERE clause" for any UPDATE or
-- DELETE with no WHERE. SECURITY DEFINER does not exempt a function from it: the
-- setting lives on the calling session, not the function owner. So every call
-- through the admin server action (createAdminClient -> PostgREST) failed with a
-- 400 and the Sources page announced "Failed to set ... as default".
--
-- It went unnoticed because the same statement succeeds when run as postgres
-- over a direct connection (psql, the SQL editor, MCP), where safeupdate is not
-- loaded. The function was correct in every environment except the only one that
-- actually calls it.
--
-- THE FIX
-- Add a WHERE clause that selects exactly the rows whose flag is wrong. Still one
-- atomic statement, so there is never a moment with two defaults or none, and
-- rows already holding the right value are not rewritten.
--
-- Behaviour is otherwise unchanged: an inactive target is still rejected, so the
-- site-wide default is always an active source.
--
-- ACCESS MATRIX (unchanged from 0053)
--   set_default_source(text)   EXECUTE service_role only; revoked from public,
--                              anon, authenticated. SECURITY DEFINER, owner
--                              postgres, search_path pinned to public.

create or replace function public.set_default_source(target_slug text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.source_registry where slug = target_slug and is_active
  ) then
    raise exception 'Source % is not an active source', target_slug;
  end if;

  -- The WHERE clause is load-bearing, not cosmetic. See the header: an
  -- unqualified UPDATE is rejected outright on the PostgREST connection.
  update public.source_registry
  set is_default = (slug = target_slug)
  where is_default is distinct from (slug = target_slug);
end;
$$;

revoke all on function public.set_default_source(text) from public;
revoke all on function public.set_default_source(text) from anon;
revoke all on function public.set_default_source(text) from authenticated;
grant execute on function public.set_default_source(text) to service_role;
