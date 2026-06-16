-- Migration 0062: signal_post_reports (report/flag mechanism)
--
-- Authenticated users can flag a public post. Anonymous reporting is not allowed
-- (reduces spam). One report per (post, reporter) via a unique constraint. The
-- admin moderation queue reads these via service_role. Per-reporter rate limiting
-- is enforced server-side in the report endpoint (min 15s between reports, max 10
-- per rolling hour, max 40 per rolling day), mirroring the post limits.
--
-- Access matrix:
--   anon          : NONE
--   authenticated : INSERT own report; SELECT own reports
--   service_role  : ALL (admin queue read + status updates)

create table if not exists public.signal_post_reports (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.signal_posts(id) on delete cascade,
  reporter_user_id uuid not null references auth.users(id) on delete cascade,
  reason text not null
    check (reason in ('spam','harassment','hate','sexual','violence','other')),
  details text check (details is null or char_length(details) <= 1000),
  status text not null default 'pending'
    check (status in ('pending','reviewed','actioned','dismissed')),
  created_at timestamptz not null default now(),
  unique (post_id, reporter_user_id)
);

create index if not exists idx_signal_post_reports_queue
  on public.signal_post_reports(status, created_at);
create index if not exists idx_signal_post_reports_post
  on public.signal_post_reports(post_id);
-- Supports the per-reporter rate-limit window lookups in the report endpoint.
create index if not exists idx_signal_post_reports_reporter
  on public.signal_post_reports(reporter_user_id, created_at);

alter table public.signal_post_reports enable row level security;

drop policy if exists signal_post_reports_insert_own on public.signal_post_reports;
create policy signal_post_reports_insert_own on public.signal_post_reports
  for insert to authenticated
  with check (auth.uid() = reporter_user_id);

drop policy if exists signal_post_reports_select_own on public.signal_post_reports;
create policy signal_post_reports_select_own on public.signal_post_reports
  for select to authenticated
  using (auth.uid() = reporter_user_id);

drop policy if exists signal_post_reports_service_role_all on public.signal_post_reports;
create policy signal_post_reports_service_role_all on public.signal_post_reports
  for all to service_role using (true) with check (true);
