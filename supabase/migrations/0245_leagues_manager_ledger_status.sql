-- Migration 0245: Manager Ledger run status on leagues
--
-- Mirrors 0212 (Positional WAR) and 0215 (Power Pulse) exactly, so the three
-- on-demand per-league models have the same shape and the admin health view at
-- /admin/system/league-health can list them side by side with a column each.
--
-- Same five values, same meanings, same write ordering:
--   pending   never attempted
--   ok        rows written
--   skipped   a reason likely to clear on its own (no settled weeks yet, no
--             rosters stored yet)
--   settled   a statement about the season that will not change until a real
--             event happens
--   error     the run failed
--
-- manager_ledger_detail is written by server code only, is never
-- user-controlled, and is rendered as text, never as HTML.
--
-- Access matrix (unchanged from the leagues table's existing policies):
--   anon          : SELECT
--   authenticated : SELECT
--   service_role  : ALL (only server code writes these columns)
--   client writes : BLOCKED

alter table public.leagues
  add column if not exists manager_ledger_status text,
  add column if not exists manager_ledger_detail text,
  add column if not exists manager_ledger_attempted_at timestamptz,
  add column if not exists manager_ledger_succeeded_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'leagues_manager_ledger_status_check'
  ) then
    alter table public.leagues
      add constraint leagues_manager_ledger_status_check
      check (manager_ledger_status in ('pending','ok','skipped','settled','error'));
  end if;
end $$;

comment on column public.leagues.manager_ledger_status is
  'Verdict of the last Manager Ledger run: pending, ok, skipped, settled, or error. Read by the backoff and by the page empty state.';
comment on column public.leagues.manager_ledger_detail is
  'Server-written reason for the last verdict, truncated to 500 characters. Never user-controlled, never rendered as HTML, admin-only.';
comment on column public.leagues.manager_ledger_attempted_at is
  'Stamped before the expensive work, so a crash mid-run still backs off.';
comment on column public.leagues.manager_ledger_succeeded_at is
  'Stamped after the cache rows land, never before.';
