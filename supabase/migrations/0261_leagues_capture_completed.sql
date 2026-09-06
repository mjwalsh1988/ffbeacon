-- Migration 0261: leagues.capture_completed_at, the capture-set stamp
--
-- One league sync, whoever starts it, captures the same raw set: transactions,
-- both playoff brackets, completed-draft selections, and the matchup slate.
-- This column is stamped by lib/league-pulse.ts captureLeagueRawData ONLY when
-- every applicable stage of that set succeeded, so a reader of this column
-- (Manager Pulse's freshness rule in lib/manager-pulse/freshness.ts) can trust
-- that the league holds everything without counting rows in four tables.
--
-- last_pulsed_at keeps its meaning (the core league/roster/member sync) and its
-- 60-minute TTL. This column is the SECOND stamp, for the tail.
--
-- Access matrix: unchanged from the leagues table (public select, service-role
-- writes). No new policy.
--
-- Rollback note:
--   alter table public.leagues drop column if exists capture_completed_at;
--   alter table public.leagues drop column if exists capture_error;

alter table public.leagues
  add column if not exists capture_completed_at timestamptz,
  add column if not exists capture_error text;

comment on column public.leagues.capture_completed_at is
  'Stamped by captureLeagueRawData when transactions, brackets, draft selections and (on the footprint path) matchups all succeeded. Null means the capture set is incomplete. Manager Pulse freshness reads this, never last_pulsed_at.';
comment on column public.leagues.capture_error is
  'Server-written reason the last capture set did not complete. Rendered as text only, never as HTML.';

-- Manager Pulse's enqueue read: many sleeper_league_ids at once, three columns.
create index if not exists leagues_capture_state_idx
  on public.leagues (sleeper_league_id, capture_completed_at, status, season);
