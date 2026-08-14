-- Migration 0196: beam_queries (BEAM question log)
--
-- Access matrix:
--   anon          : NO ACCESS  (no policy)
--   authenticated : NO ACCESS  (no policy)
--   service_role  : ALL        (written by /api/beam/ask, read by the admin gaps
--                               page behind requireAdmin)
--
-- WHY
-- The single most useful thing BEAM can produce in its first month is a list of
-- the questions it could not answer, ranked by how often people asked them. That
-- list is what decides which capability gets built next. It cannot come from the
-- "Help BEAM learn this" form, because almost nobody fills in a form: it has to
-- be a passive log of every question.
--
-- PRIVACY
-- This is free text a visitor typed, so the row is deliberately thin:
--   - No raw IP, ever. actor_hash is the same salted SHA-256 the rate limiter
--     uses (lib/rate-limit-actor.ts), so repeat askers can be counted without the
--     IP being recoverable.
--   - The question is scrubbed in application code before insert (email
--     addresses, phone-shaped digit runs) and truncated to 300 characters, which
--     is also the input cap on the endpoint.
--   - user_id is provenance only, set when a session happened to exist. It is
--     never read for authorization.
--   - Retention is bounded: cleanup_beam_queries() deletes rows past the window,
--     wired into the nightly recalculate-derived cron alongside
--     cleanup_rate_limit_hits().
--
-- NOT AN INGESTION TABLE. There is no `metadata` jsonb because nothing external
-- produced these rows; they are our own telemetry. See CLAUDE.md, Data
-- Architecture Principles.

create table if not exists public.beam_queries (
  id uuid primary key default gen_random_uuid(),
  -- What the visitor typed, scrubbed and truncated by the route.
  question text not null check (char_length(question) between 1 and 300),
  -- The interpreter's normalized form. Grouping the gaps view on this collapses
  -- "How many YARDS did Purdy throw for?" and "how many yards did purdy throw for"
  -- into one row.
  question_normalized text not null check (char_length(question_normalized) <= 300),
  -- Null when nothing matched. Not an FK: capabilities live in code.
  capability_id text check (capability_id is null or char_length(capability_id) <= 60),
  outcome text not null check (outcome in ('answer', 'clarify', 'unsupported', 'error')),
  -- Only set when outcome is 'unsupported' or 'error'. Drives the gaps grouping.
  failure_reason text check (failure_reason is null or char_length(failure_reason) <= 60),
  confidence numeric(4, 3) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  -- Players the resolver landed on, for spot-checking a bad answer after the fact.
  player_ids uuid[],
  format_slug text check (format_slug is null or char_length(format_slug) <= 64),
  source_slug text check (source_slug is null or char_length(source_slug) <= 64),
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  -- Salted hash of the actor key. Never a raw IP.
  actor_hash text check (actor_hash is null or char_length(actor_hash) <= 128),
  user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- The gaps page reads unanswered questions newest-first, then groups.
create index if not exists idx_beam_queries_outcome_created
  on public.beam_queries (outcome, created_at desc);

-- Retention prune scans by age.
create index if not exists idx_beam_queries_created
  on public.beam_queries (created_at);

-- "How many people asked this exact thing" without a sequential scan.
create index if not exists idx_beam_queries_normalized
  on public.beam_queries (question_normalized);

alter table public.beam_queries enable row level security;

drop policy if exists beam_queries_service_role_all on public.beam_queries;
create policy beam_queries_service_role_all
  on public.beam_queries
  for all to service_role using (true) with check (true);

comment on table public.beam_queries is
  'Every question asked of BEAM, with what the interpreter did with it. Powers the admin gaps view that decides which capability to build next. Service-role only. No raw IPs: actor_hash is salted. Retention bounded by cleanup_beam_queries().';

-- Bounded retention prune. Wired into the nightly recalculate-derived cron next
-- to cleanup_rate_limit_hits, so the log never grows without limit.
create or replace function public.cleanup_beam_queries(
  p_max_age_days int default 180
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  delete from public.beam_queries
   where created_at < now() - make_interval(days => p_max_age_days);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.cleanup_beam_queries(int) from public, anon, authenticated;
grant execute on function public.cleanup_beam_queries(int) to service_role;

comment on function public.cleanup_beam_queries(int) is
  'Deletion-only retention prune for beam_queries. Returns rows deleted. service_role EXECUTE only.';
