-- Migration 0215: Power Pulse run status on leagues
--
-- Mirrors 0212 exactly, so the two features have the same shape and the admin
-- health view can list them side by side with a column per feature.
--
-- The defect this closes. powerPulseIsStale returns true whenever there are no
-- rows, and calculateLeaguePowerPulse returns a skipped reason that
-- refreshPowerPulse only ever passes to console.warn. A league that skips
-- deterministically therefore re-attempts on every page view, and the panel
-- says "Power Pulse is still calculating" indefinitely with no way for anyone
-- to learn why. Building the same three mechanisms for Positional WAR and
-- leaving Power Pulse as it is would be strange, so this brings them level.
--
-- Same five values, same meanings, same write ordering as 0212:
--   pending, ok, skipped, settled, error
--
-- power_pulse_detail is written by server code only, is never user-controlled,
-- and is rendered as text, never as HTML.
--
-- Access matrix (unchanged from the leagues table's existing policies):
--   anon          : SELECT
--   authenticated : SELECT
--   service_role  : ALL (only server code writes these columns)
--   client writes : BLOCKED

alter table public.leagues
  add column if not exists power_pulse_status text,
  add column if not exists power_pulse_detail text,
  add column if not exists power_pulse_attempted_at timestamptz,
  add column if not exists power_pulse_succeeded_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'leagues_power_pulse_status_check'
  ) then
    alter table public.leagues
      add constraint leagues_power_pulse_status_check
      check (power_pulse_status in ('pending','ok','skipped','settled','error'));
  end if;
end $$;

comment on column public.leagues.power_pulse_status is
  'Verdict of the last Power Pulse run: pending, ok, skipped, settled, or error. Read by the backoff and by the panel empty state.';
comment on column public.leagues.power_pulse_detail is
  'Server-written reason for the last verdict, truncated to 500 characters. Never user-controlled, never rendered as HTML, admin-only.';
comment on column public.leagues.power_pulse_attempted_at is
  'Stamped before the expensive work, so a crash mid-run still backs off.';
comment on column public.leagues.power_pulse_succeeded_at is
  'Stamped after the cache rows land, never before.';
