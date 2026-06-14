-- Migration 0053: source_registry.is_default (site-wide default source)
--
-- Access matrix: inherits source_registry (public SELECT; service_role writes).
-- The set_default_source function is service_role-only (admin server action).
--
-- Makes "default" its OWN concept, decoupled from priority (display order) and
-- is_active. Exactly one source is the site-wide default. It applies to:
--   - anonymous visitors (no URL/cookie signal), and
--   - logged-in users who have NOT saved a source preference.
-- A logged-in user's saved user_preferences.default_source_slug always wins;
-- this flag is only consulted at the end of the resolver chain
-- (resolveSourceSlug) and as the no-request pick in resolveSourceForFormat.
--
-- Previously the anonymous default was the hardcoded DEFAULT_SOURCE_SLUG ('ktc')
-- in lib/site.ts. That constant is being removed in favour of this DB flag so
-- the default is admin-editable with no code deploy. We seed is_default to KTC
-- to preserve the exact current behaviour.

alter table public.source_registry
  add column if not exists is_default boolean not null default false;

-- Seed the current default (KTC) so behaviour is unchanged at deploy time.
update public.source_registry set is_default = (slug = 'ktc');

-- Atomic "set exactly one default" write path. A single UPDATE flips the chosen
-- source on and every other off in one statement, so there is never a window
-- with zero or two defaults. Rejects an inactive/unknown target: the default
-- must always be an active source (anonymous users must never resolve to a
-- source with no public data). SECURITY DEFINER + service_role-only grant so
-- only the requireAdmin server action can call it.
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
  update public.source_registry set is_default = (slug = target_slug);
end;
$$;

revoke all on function public.set_default_source(text) from public;
revoke all on function public.set_default_source(text) from anon;
revoke all on function public.set_default_source(text) from authenticated;
grant execute on function public.set_default_source(text) to service_role;

comment on column public.source_registry.is_default is
  'Exactly one true: the site-wide default source for anonymous users and logged-in users with no saved source preference. Maintained via set_default_source(). Decoupled from priority (display order) and is_active.';
