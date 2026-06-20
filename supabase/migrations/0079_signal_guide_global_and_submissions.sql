-- Migration 0079: Signal Guide global entries + community question submissions
--
-- Two additions to the Signal Guide (migration 0078):
--
-- 1. guide_entries.is_global: when true, the entry shows on EVERY page's guide
--    panel, not just its owner page. The row keeps its original page_id for
--    provenance (the page it was authored on), but global entries are grouped and
--    ordered by (is_global, kind) for display, independent of page_id. The public
--    panel and the admin manager union a page's own (is_global=false) entries with
--    all published global entries.
--
-- 2. guide_question_submissions: the community "I couldn't find my answer" queue.
--    Visitors submit a question from any page's guide panel; it lands here as
--    status='pending' for an admin to review and either turn into a real
--    guide_entry (status='accepted') or dismiss (status='denied'). This is a
--    user-submitted intake table, not an external-source ingestion table, so it
--    carries no `metadata` jsonb (consistent with the guide_* tables).
--
-- All writes to both objects flow through the service-role client behind an admin
-- gate (admin actions) or a server-side route handler with honeypot + rate
-- limiting (public submit). There is intentionally NO anon/authenticated write
-- policy: the public submit path runs server-side with the service role.
--
-- Access matrix (guide_question_submissions):
--   anon          : NONE (submit happens server-side via the route handler)
--   authenticated : NONE
--   service_role  : ALL (admin review UI + the submit route handler)

alter table public.guide_entries
  add column if not exists is_global boolean not null default false;

-- Global entries are listed together per kind, ordered by display_order, regardless
-- of which page authored them. Partial index covers that read path.
create index if not exists idx_guide_entries_global_kind_order
  on public.guide_entries(kind, display_order)
  where is_global;

create table if not exists public.guide_question_submissions (
  id uuid primary key default gen_random_uuid(),
  -- The guide page_key the visitor was on when they asked (registry key, e.g.
  -- 'rankings'). Stored as text (not an FK) so a submission survives a page being
  -- removed from the registry; the admin accept flow defaults the destination page
  -- to this key when it still exists.
  page_key text not null
    check (char_length(page_key) between 1 and 60),
  name text not null check (char_length(name) between 1 and 120),
  -- Optional: when present we email the asker a confirmation + the final answer.
  email text check (email is null or char_length(email) <= 320),
  question text not null check (char_length(question) between 1 and 2000),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'denied')),
  -- Set when the asker was signed in (provenance only; never trusted for auth).
  submitted_user_id uuid references auth.users(id) on delete set null,
  -- SHA-256 of the submitter IP, used only for coarse rate limiting and abuse
  -- triage. Not reversible to the raw IP.
  ip_hash text,
  -- When accepted, the guide_entry we created from this submission.
  resolved_entry_id uuid references public.guide_entries(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The admin queue reads pending first, newest first; rate limiting reads by
-- ip_hash within a recent window.
create index if not exists idx_guide_submissions_status_created
  on public.guide_question_submissions(status, created_at desc);
create index if not exists idx_guide_submissions_ip_created
  on public.guide_question_submissions(ip_hash, created_at desc);

alter table public.guide_question_submissions enable row level security;

-- Service-role only: every read and write goes through an admin gate or the
-- server-side submit route handler. No anon/authenticated policy exists, so a
-- direct client query returns zero rows and a direct client write is blocked.
drop policy if exists guide_submissions_service_role_all on public.guide_question_submissions;
create policy guide_submissions_service_role_all on public.guide_question_submissions
  for all to service_role using (true) with check (true);
