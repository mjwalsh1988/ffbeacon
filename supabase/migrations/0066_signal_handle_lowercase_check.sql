-- Migration 0066: enforce lowercase-only Signal handles
--
-- The handle CHECK in migration 0059 was `handle ~ '^[a-z0-9_]{3,30}$'`. Because
-- `handle` is citext, the `~` operator matches case-INSENSITIVELY, so the check
-- wrongly accepted uppercase input (e.g. 'Michael') and would store non-canonical
-- mixed-case handles. Casing must be canonical lowercase for clean public URLs.
--
-- Fix: cast to text inside the regex so the match is case-SENSITIVE. Uniqueness
-- stays case-insensitive via the citext unique index from 0059, so 'Michael' and
-- 'michael' still collide; this only forces stored handles to be lowercase.

alter table public.signals
  drop constraint if exists signals_handle_check;
alter table public.signals
  add constraint signals_handle_check
  check (handle::text ~ '^[a-z0-9_]{3,30}$');
