-- Migration 0193: draft_value_board_formats view + league_drafts pick-capture state
--
-- Access matrix:
--   draft_value_board_formats (view)
--     anon          : SELECT   (security_invoker, so draft_value_targets' own
--                               public SELECT policy is what actually decides)
--     authenticated : SELECT   (same)
--     service_role  : SELECT
--   league_drafts (new columns): unchanged from the table's existing policies.
--
-- Both changes come out of the performance review of the Beacon Steals build.
--
-- 1. THE VIEW
-- lib/draft-value/guide-data.ts loadFormatsWithBoards needs the distinct set of
-- formats that currently have a board: eight strings. PostgREST cannot express
-- DISTINCT, so it was pulling every row of draft_value_targets (4,136 today,
-- about 100 KB) on every guide request to build a Set of eight.
--
-- It also carried a silent cliff. The read capped at 5,000 rows, which is above
-- today's 4,136 but below the roughly 10,400 that thirteen active formats would
-- produce. The moment the excluded best-ball formats are enabled it would have
-- started under-reporting with no error at all.
--
-- security_invoker is ON so the view does not become a privilege escalation:
-- a caller sees exactly the rows draft_value_targets would have shown them.
-- Season is included because the read paths need to filter on it (see below).
--
-- 2. THE CAPTURE STATE
-- lib/league-draft-selections.ts decides which completed drafts still need their
-- picks by asking whether any ledger row exists for them. A draft that CANNOT be
-- captured therefore stays pending forever: Sleeper answering with an empty
-- array (a reset or abandoned draft) writes nothing, so the next resync tries it
-- again, and the one after that, indefinitely. Worse, those drafts consume the
-- per-run capture budget ahead of drafts that would actually succeed.
--
-- Measured on production: 121 completed league drafts, 120 captured, exactly one
-- permanently stuck, in one league. Small today and unbounded in shape, since it
-- grows with every reset or abandoned draft the site ever sees.
--
-- The two columns separate the two answers that lib/sleeper.ts already takes
-- care to distinguish and that the capture code was collapsing back together:
--   picks_captured_at   Sleeper gave a definitive answer. Never ask again, even
--                       when that answer was "this draft has no picks".
--   pick_capture_attempts  the request FAILED and we know nothing. Retry, but
--                       not forever.

create or replace view public.draft_value_board_formats
with (security_invoker = true) as
select distinct format_slug, season
from public.draft_value_targets;

grant select on public.draft_value_board_formats to anon, authenticated, service_role;

comment on view public.draft_value_board_formats is
  'Distinct (format_slug, season) pairs that currently have a Beacon Steals board. Exists because PostgREST cannot express DISTINCT and the guide page was reading every row of draft_value_targets to build a set of eight strings. security_invoker, so draft_value_targets RLS still decides who sees what.';

alter table public.league_drafts
  add column if not exists picks_captured_at timestamptz,
  add column if not exists pick_capture_attempts integer not null default 0;

comment on column public.league_drafts.picks_captured_at is
  'When Sleeper last gave a DEFINITIVE answer about this draft''s picks, whether that answer was a full slate or an empty one. Set means never fetch again: a completed draft does not change. Null means we have never had a real answer.';

comment on column public.league_drafts.pick_capture_attempts is
  'Failed pick-fetch attempts (the request itself failed, so we know nothing). Bounded retry lives here so a permanently unreachable draft stops consuming the per-run capture budget ahead of drafts that would succeed.';
