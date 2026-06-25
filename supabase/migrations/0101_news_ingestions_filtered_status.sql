-- Migration 0101: filtered status + filter reason on news_ingestions
--
-- The Beacon Brief gains a non-football filter with two gates (a keyword
-- pre-filter before the AI call, and an AI non_football flag). A post caught by
-- either gate is recorded as an ingestion with status 'filtered' and is NOT sent
-- to Discord and does NOT become an article. The admin reviews these on the new
-- Filtered page and either deletes the post entirely or force-pushes it back
-- through the pipeline (which bypasses both gates).
--
-- Additive change: a new status value, two nullable columns, one partial index.
--
-- Access matrix: inherits news_ingestions (service_role ALL; client writes
-- BLOCKED; no anon/authenticated access).

alter table public.news_ingestions
  drop constraint if exists news_ingestions_status_check;

alter table public.news_ingestions
  add constraint news_ingestions_status_check
  check (status in (
    'new', 'processing', 'published', 'dropped_no_context',
    'revised', 'deleted', 'error', 'filtered'
  ));

-- Why the post was filtered. NULL for every non-filtered row.
alter table public.news_ingestions
  add column if not exists filter_reason text
    check (filter_reason in ('keyword', 'ai_non_football'));

-- Supporting context for the reviewer, e.g. { "matched_terms": ["nba", "golf"] }
-- for a keyword hit. NULL when there is nothing extra to record.
alter table public.news_ingestions
  add column if not exists filter_detail jsonb;

-- Reverse-chronological feed for the admin Filtered review queue.
create index if not exists idx_news_ingestions_filtered
  on public.news_ingestions (created_at desc)
  where status = 'filtered';

comment on column public.news_ingestions.filter_reason is
  'Why this post was filtered out of the pipeline: keyword (pre-AI blocklist hit) or ai_non_football (classifier flagged non-football). NULL for non-filtered rows.';
comment on column public.news_ingestions.filter_detail is
  'Reviewer context for a filtered post, e.g. the matched blocklist terms. NULL when none.';
