-- Migration 0112: enable Supabase Realtime (Postgres Changes) on on_the_clock_pick_cache
--
-- The On The Clock client subscribes via Postgres Changes filtered by
-- sleeper_draft_id=eq.{draft_id} and merges INSERT/UPDATE rows into local state with NO
-- Sleeper call. Postgres Changes is RLS-governed, which is exactly why the pick cache
-- has a public SELECT policy (migration 0108).
--
-- We add the table to the supabase_realtime publication (idempotent) and set REPLICA
-- IDENTITY FULL so UPDATE/DELETE change events carry the full prior row, keeping the
-- sleeper_draft_id filter reliable on updates. Picks are small rows, so the extra WAL is
-- negligible.
--
-- MVP uses Postgres Changes only. Broadcast-via-trigger is the documented later scale
-- path (if a single draft ever has hundreds of concurrent subscribers); NOT built here.

alter table public.on_the_clock_pick_cache replica identity full;

do $$
begin
  if not exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'on_the_clock_pick_cache'
  ) then
    alter publication supabase_realtime add table public.on_the_clock_pick_cache;
  end if;
end $$;
