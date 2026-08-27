-- Migration 0212: Positional WAR run status on leagues
--
-- Mirrors the existing pulse_status / pulse_error / last_pulsed_at trio, so the
-- UI and the admin panel already know the shape.
--
-- Why a status column at all. Without one, a league that fails or skips
-- deterministically re-attempts the whole computation on every single page
-- view, and the reader is told "still calculating" forever with no way for
-- anyone to learn why. The status is what the backoff reads and what the empty
-- state reads, so a skipped league costs one small select instead of a full
-- universe load, and the panel says which honest reason applies.
--
-- The five values:
--   pending  : never attempted. No backoff, normal first attempt.
--   ok       : rows written. detail holds "6 positions, 412ms".
--   skipped  : a transient reason worth retrying soon (no projections loaded
--              yet, team count unknown because rosters have not synced).
--   settled  : a reason that will not change without a new season or a new week
--              window (no remaining regular-season weeks). Separate from
--              skipped purely so the backoff bypass can be exact rather than
--              time based.
--   error    : something threw. detail holds the message, truncated to 500
--              characters, with no stack and no connection string.
--
-- positional_war_detail is written by server code only, is never
-- user-controlled, and is rendered as text, never as HTML. It is surfaced to
-- admins in the league health view; a non-admin reader gets a fixed sentence
-- per status instead.
--
-- positional_war_attempted_at is stamped BEFORE the expensive work, so a crash
-- mid-run still backs off rather than hot-looping. positional_war_succeeded_at
-- is stamped AFTER the cache rows land, following the last_pulsed_at rule in
-- CLAUDE.md.
--
-- Access matrix (unchanged from the leagues table's existing policies):
--   anon          : SELECT
--   authenticated : SELECT
--   service_role  : ALL (only server code writes these columns)
--   client writes : BLOCKED

alter table public.leagues
  add column if not exists positional_war_status text,
  add column if not exists positional_war_detail text,
  add column if not exists positional_war_attempted_at timestamptz,
  add column if not exists positional_war_succeeded_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'leagues_positional_war_status_check'
  ) then
    alter table public.leagues
      add constraint leagues_positional_war_status_check
      check (positional_war_status in ('pending','ok','skipped','settled','error'));
  end if;
end $$;

comment on column public.leagues.positional_war_status is
  'Verdict of the last Positional WAR run: pending, ok, skipped, settled, or error. Read by the backoff and by the panel empty state.';
comment on column public.leagues.positional_war_detail is
  'Server-written reason for the last verdict, truncated to 500 characters. Never user-controlled, never rendered as HTML, admin-only.';
comment on column public.leagues.positional_war_attempted_at is
  'Stamped before the expensive work, so a crash mid-run still backs off.';
comment on column public.leagues.positional_war_succeeded_at is
  'Stamped after the cache rows land, never before.';
