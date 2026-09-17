-- Migration 0287: brief_editions, and the CHECK widenings the Brief needs
--
-- A Brief is an articles row (article_type = 'brief', origin = 'brief_desk')
-- so the reader stack, the OG route, the join tables and article_revisions are
-- reused. This table holds what the public never reads: the period, the
-- bundle's Relay set, which run drafted it, the validated draft JSON, the
-- research log, the validator's report and the owner's review.
--
-- draft_payload is kept whole on purpose: it is the source object for the
-- edition. The page renders from articles.content_md plus the figure data in
-- the payload, and a re-render after a component change re-reads it. This is
-- the metadata-preservation rule applied to an internal producer.
--
-- CHECK widenings:
--   articles.status gains 'in_review' and 'rejected'. The anon select policy is
--     pinned to status = 'published', so a draft in review is invisible to the
--     public by the existing rule with no policy change.
--   articles.origin gains 'brief_desk'.
--   beacon_brief_moderation.type gains 'brief_review' (a draft landed) and
--     'brief_correction' (a cited Relay was retracted after publish).
--   beacon_brief_logs.stage gains 'brief_desk' (the two desk routes log there).
--
-- Access matrix:
--   brief_editions
--     anon          : NONE
--     authenticated : NONE
--     service_role  : ALL
--     client writes : BLOCKED
--   articles, beacon_brief_moderation, beacon_brief_logs: unchanged.
--
-- Verification (via MCP after apply): pg_policies lists one policy on
-- brief_editions; an anon select is denied; the four constraints accept the
-- new values (checked with a rolled-back insert).

create table if not exists public.brief_editions (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null unique references public.articles(id) on delete cascade,
  season text not null,
  week integer,
  period_start timestamptz not null,
  period_end timestamptz not null,
  cadence text not null check (cadence in ('weekly', 'biweekly', 'monthly')),
  relay_ids uuid[] not null default '{}',
  relay_count integer not null default 0,
  draft_source text not null check (draft_source in ('cloud_routine', 'local_run', 'manual')),
  draft_run_id text,
  draft_model text,
  draft_payload jsonb not null,
  research_log jsonb not null default '[]'::jsonb,
  validation_report jsonb not null default '{}'::jsonb,
  title_choice integer,
  discord_posted_at timestamptz,
  review_notes text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_brief_editions_period
  on public.brief_editions (season, period_end desc);

alter table public.brief_editions enable row level security;

drop policy if exists brief_editions_service_role_all on public.brief_editions;
create policy brief_editions_service_role_all on public.brief_editions
  for all to service_role using (true) with check (true);

revoke all on public.brief_editions from anon, authenticated;

comment on table public.brief_editions is
  'Provenance and review state for one Beacon Brief edition. The public reads articles; this is service-role only.';

alter table public.articles drop constraint if exists articles_status_check;
alter table public.articles add constraint articles_status_check
  check (status in ('draft', 'published', 'archived', 'in_review', 'rejected'));

alter table public.articles drop constraint if exists articles_origin_check;
alter table public.articles add constraint articles_origin_check
  check (origin in ('manual', 'beacon_brief', 'brief_desk'));

alter table public.beacon_brief_moderation drop constraint if exists beacon_brief_moderation_type_check;
alter table public.beacon_brief_moderation add constraint beacon_brief_moderation_type_check
  check (type in ('deletion', 'player_match', 'team_match', 'failed_task', 'brief_review', 'brief_correction'));

alter table public.beacon_brief_logs drop constraint if exists beacon_brief_logs_stage_check;
alter table public.beacon_brief_logs add constraint beacon_brief_logs_stage_check check (
  stage = any (array[
    'ingest'::text, 'dedupe'::text, 'revision_link'::text, 'revision_triage'::text,
    'categorize'::text, 'research_gate'::text, 'article_write'::text,
    'discord_post'::text, 'discord_patch'::text, 'deletion_check'::text,
    'brief_desk'::text, 'error'::text
  ])
);
