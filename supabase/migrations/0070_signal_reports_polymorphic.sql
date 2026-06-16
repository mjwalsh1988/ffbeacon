-- Migration 0070: polymorphic signal_reports (posts + comments) replaces signal_post_reports
--
-- Phase 4 introduces comments alongside posts, so reporting becomes polymorphic:
-- one table keyed by (target_type, target_id) instead of a posts-only table with
-- a hard FK. signal_post_reports is empty (the Signal Wall is unlaunched), so
-- this is a clean swap with no data to migrate. One report endpoint and one admin
-- queue cover both targets.
--
-- DANGLING REPORTS: there is no real FK to the target (two possible parent
-- tables), so ON DELETE CASCADE is unavailable. Instead, an AFTER DELETE trigger
-- on the target table auto-resolves that target's open reports to 'dismissed'.
-- This keeps an audit trail (we still know a report existed) while preventing the
-- admin queue from accumulating reports that point at content which no longer
-- exists. The posts-side trigger ships here; the comments-side trigger ships with
-- signal_comments in sub-phase (c).
--
-- Access matrix:
--   anon          : NONE
--   authenticated : INSERT own report; SELECT own reports
--   service_role  : ALL (admin queue read + status updates)
-- Per-reporter rate limiting (min 15s between reports, max 10 per rolling hour,
-- max 40 per rolling day) is enforced server-side in the report endpoint,
-- mirroring the post/comment limits (not a trigger, matching the 0062 decision).

create table if not exists public.signal_reports (
  id uuid primary key default gen_random_uuid(),
  target_type text not null check (target_type in ('post','comment')),
  target_id uuid not null,
  reporter_user_id uuid not null references auth.users(id) on delete cascade,
  reason text not null
    check (reason in ('spam','harassment','hate','sexual','violence','other')),
  details text check (details is null or char_length(details) <= 1000),
  status text not null default 'pending'
    check (status in ('pending','reviewed','actioned','dismissed')),
  created_at timestamptz not null default now(),
  unique (target_type, target_id, reporter_user_id)
);

create index if not exists idx_signal_reports_queue
  on public.signal_reports(status, created_at);
create index if not exists idx_signal_reports_target
  on public.signal_reports(target_type, target_id);
-- Supports the per-reporter rate-limit window lookups in the report endpoint.
create index if not exists idx_signal_reports_reporter
  on public.signal_reports(reporter_user_id, created_at);

alter table public.signal_reports enable row level security;

drop policy if exists signal_reports_insert_own on public.signal_reports;
create policy signal_reports_insert_own on public.signal_reports
  for insert to authenticated
  with check (auth.uid() = reporter_user_id);

drop policy if exists signal_reports_select_own on public.signal_reports;
create policy signal_reports_select_own on public.signal_reports
  for select to authenticated
  using (auth.uid() = reporter_user_id);

drop policy if exists signal_reports_service_role_all on public.signal_reports;
create policy signal_reports_service_role_all on public.signal_reports
  for all to service_role using (true) with check (true);

-- Auto-dismiss a post's open reports when the post is hard-deleted. SECURITY
-- DEFINER so it updates reports regardless of the deleting role's RLS.
create or replace function public.signal_reports_dismiss_on_post_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.signal_reports
     set status = 'dismissed'
   where target_type = 'post'
     and target_id = old.id
     and status in ('pending', 'reviewed');
  return old;
end;
$$;

revoke execute on function public.signal_reports_dismiss_on_post_delete()
  from anon, authenticated, public;

drop trigger if exists trg_signal_reports_dismiss_on_post_delete on public.signal_posts;
create trigger trg_signal_reports_dismiss_on_post_delete
  after delete on public.signal_posts
  for each row execute function public.signal_reports_dismiss_on_post_delete();

-- signal_post_reports is empty (the Wall is unlaunched); drop it in favor of the
-- polymorphic table. Its RLS, indexes, and policies go with it.
drop table if exists public.signal_post_reports;
