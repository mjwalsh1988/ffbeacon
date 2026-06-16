-- Migration 0069: Signal Phase 3 customization - accent palette + links shape guard
--
-- Phase 3 ships the accent picker, custom links, and favorites editors. Two
-- database changes back the customization writes:
--
-- 1. The accent palette is replaced with the Phase 3 fixed set of 10 slugs. The
--    previous set (purple/emerald/sky/slate) was never exposed in any UI (no
--    accent picker shipped before Phase 3) and the signals table is empty, so
--    there is nothing to backfill. 'beacon' stays the default and is present in
--    both the old and new sets.
--
-- 2. A function-backed CHECK gives signals.links a real shape guard at the
--    database level, in addition to the server-side validation in the saveLinks
--    action: an array of at most 10 objects, each {label: 1..40 char string,
--    url: https:// string up to 2048 chars}. CHECK constraints cannot contain a
--    subquery directly, so the validation lives in an IMMUTABLE helper function
--    that the constraint calls.
--
-- Access matrix unchanged. The owner-writable columns (accent, favorite_team,
-- favorite_player_id, links) were already covered by the column-level GRANTs in
-- migration 0059; the moderation/follower columns remain service-role-only. No
-- RLS policy changes.

-- 1. Accent palette -----------------------------------------------------------
alter table public.signals
  drop constraint if exists signals_accent_check;

alter table public.signals
  add constraint signals_accent_check
  check (accent in (
    'beacon','violet','azure','cyan','mint','lime','amber','ember','rose','magenta'
  ));

-- 2. Links shape guard --------------------------------------------------------
create or replace function public.signal_links_valid(links jsonb)
returns boolean
language sql
immutable
as $$
  select
    jsonb_typeof(links) = 'array'
    and jsonb_array_length(links) <= 10
    and not exists (
      select 1
      from jsonb_array_elements(links) as elem
      where not (
        jsonb_typeof(elem) = 'object'
        and jsonb_typeof(elem -> 'label') = 'string'
        and jsonb_typeof(elem -> 'url') = 'string'
        and char_length(elem ->> 'label') between 1 and 40
        and char_length(elem ->> 'url') <= 2048
        and (elem ->> 'url') ~ '^https://'
      )
    );
$$;

-- The constraint is evaluated by the role performing the INSERT/UPDATE, so the
-- owner (authenticated) needs EXECUTE for writes to pass. anon never writes a
-- signals row (RLS blocks it), and the function only inspects its argument (no
-- table access), so withholding it from anon/public is safe.
revoke execute on function public.signal_links_valid(jsonb) from public;
revoke execute on function public.signal_links_valid(jsonb) from anon;
grant execute on function public.signal_links_valid(jsonb) to authenticated, service_role;

alter table public.signals
  add constraint signals_links_shape_check
  check (public.signal_links_valid(links));
