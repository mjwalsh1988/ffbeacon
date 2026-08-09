-- Migration 0182: on_the_clock_pulse_cache (Draft Pulse per draft)
--
-- Access matrix:
--   anon          : NO ACCESS  (served through /api/on-the-clock/pulse with the
--                   service-role client, which shapes a whitelisted payload)
--   authenticated : NO ACCESS  (same)
--   service_role  : ALL        (written and read by the Draft Pulse orchestrator)
--
-- WHY
-- Draft Pulse estimates how many points each team's OPTIMAL STARTING LINEUP
-- projects to score per remaining week, from the players drafted so far plus any
-- dynasty pre-draft roster, using the league's real roster_positions.
--
-- It is deliberately NOT Power Pulse and it never writes to
-- league_power_pulse_cache. Power Pulse answers "how many games should this team
-- win from here", which requires a remaining schedule. A startup draft has no
-- schedule at all, and CLAUDE.md forbids caching a Power Pulse computed without
-- one, because scoring an empty slate yields 0.0 projected wins and 0%/100%
-- playoff odds for every team, which reads as a real answer and is not one.
-- Draft Pulse therefore publishes points and a within-league rank, never wins,
-- never playoff odds, and never a projected finish.
--
-- Invalidated by through_pick_no (picks advanced) or model_version (the engine
-- or the Power Pulse settings changed). On demand only: NEVER wire this into a
-- cron, for the same scaling reason as league power rankings.
--
-- Derived cache, so no `metadata` raw-source column (see 0181's note).

create table if not exists public.on_the_clock_pulse_cache (
  sleeper_draft_id text primary key,
  -- Highest overall pick number included in this computation. A later pick makes
  -- the row stale.
  through_pick_no  integer not null default 0,
  -- Engine + settings version. A bump forces every draft to rescore on next view.
  model_version    text not null,
  -- { teams: [...], playerPoints: {...}, coverage: {...} }
  payload          jsonb not null default '{}'::jsonb,
  computed_at      timestamptz not null default now()
);

create index if not exists idx_otc_pulse_cache_computed
  on public.on_the_clock_pulse_cache (computed_at desc);

alter table public.on_the_clock_pulse_cache enable row level security;

drop policy if exists on_the_clock_pulse_cache_service_role_all
  on public.on_the_clock_pulse_cache;
create policy on_the_clock_pulse_cache_service_role_all
  on public.on_the_clock_pulse_cache
  for all to service_role using (true) with check (true);

comment on table public.on_the_clock_pulse_cache is
  'Draft Pulse per Sleeper draft: projected optimal starting-lineup points per remaining week for every team, ranked within the league. Not Power Pulse: no schedule exists during a draft, so it publishes no wins, playoff odds, or projected finish. Invalidated by through_pick_no or model_version. Service-role only.';
