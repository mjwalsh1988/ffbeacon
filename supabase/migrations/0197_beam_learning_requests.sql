-- Migration 0197: beam_learning_requests
--
-- Access matrix:
--   anon          : NONE (the public submit runs server-side in /api/beam/learn)
--   authenticated : NONE
--   service_role  : ALL  (the submit route + the admin queue behind requireAdmin)
--
-- WHY
-- When BEAM cannot answer something, the reader gets a "Help BEAM learn this"
-- button. This is where those submissions land. It is the same shape and the same
-- trust model as guide_question_submissions (migration 0079): no client write
-- policy at all, because the public path is a server route that does its own
-- origin check, honeypot, validation, and rate limit before inserting with the
-- service role.
--
-- WHY THIS IS SEPARATE FROM beam_queries
-- Two tables, one job each. beam_queries is passive telemetry with no contact
-- details and a 180-day retention window. This table holds a person's name and
-- (optionally) their email because they asked us to follow up, so it is kept
-- until an admin resolves it. Mixing the two would either put contact details on
-- a retention timer or keep anonymous telemetry forever.
--
-- query_id links back to the logged question so an admin can see the exact parse
-- that failed. ON DELETE SET NULL, because the retention prune will eventually
-- remove the telemetry row while this one is still open.

create table if not exists public.beam_learning_requests (
  id uuid primary key default gen_random_uuid(),
  -- The logged question this came from. Nullable: the prune outlives it.
  query_id uuid references public.beam_queries(id) on delete set null,
  -- Denormalized copy of the question, so the request stays readable after the
  -- telemetry row is pruned. Re-read server-side from the query row where
  -- possible rather than trusted from the client body.
  question text not null check (char_length(question) between 1 and 300),
  name text not null check (char_length(name) between 1 and 120),
  -- Optional: when present we confirm receipt and can reply when it ships.
  email text check (email is null or char_length(email) <= 320),
  message text check (message is null or char_length(message) <= 1000),
  status text not null default 'pending'
    check (status in ('pending', 'planned', 'shipped', 'declined')),
  -- SHA-256 of the submitter IP, for coarse abuse triage only. Not reversible.
  ip_hash text,
  submitted_user_id uuid references auth.users(id) on delete set null,
  admin_note text check (admin_note is null or char_length(admin_note) <= 1000),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The admin queue reads pending first, newest first.
create index if not exists idx_beam_learning_requests_status_created
  on public.beam_learning_requests (status, created_at desc);

-- Rate-limit triage reads by ip_hash within a recent window.
create index if not exists idx_beam_learning_requests_ip_created
  on public.beam_learning_requests (ip_hash, created_at desc);

alter table public.beam_learning_requests enable row level security;

drop policy if exists beam_learning_requests_service_role_all on public.beam_learning_requests;
create policy beam_learning_requests_service_role_all
  on public.beam_learning_requests
  for all to service_role using (true) with check (true);

comment on table public.beam_learning_requests is
  'Visitor submissions from the "Help BEAM learn this" form shown when BEAM cannot answer. Service-role only; the public submit path is /api/beam/learn (origin check + honeypot + rate limit). Mirrors guide_question_submissions.';
