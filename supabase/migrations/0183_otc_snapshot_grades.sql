-- Migration 0183: draft grades + Draft Pulse on completed-draft snapshots
--
-- Access matrix (unchanged; the new columns inherit 0121's policies):
--   anon          : SELECT only
--   authenticated : SELECT only
--   service_role  : ALL (the snapshot finalizer)
--
-- WHY
-- A completed draft freezes into on_the_clock_draft_snapshots so its results can
-- never drift as FF Beacon values and Sleeper ADP move. Two new render payloads
-- have to freeze with it:
--
--   grades  the per-team draft grade (letter, composite, component scores, and
--           the written review), computed at finalize from the frozen board,
--           the frozen ADP, and the Draft Pulse below.
--   pulse   the Draft Pulse standings at completion, so the grades' lineup
--           component is reproducible and the rosters tab renders identically
--           years later.
--
-- snapshot_version is the payload contract version. Snapshots written before
-- this migration are version 1: they carry the original six awards and no
-- grades. The client renders those without a grades tab rather than showing an
-- empty one, and never mixes an old award set with new award cards.
--   1 = original six awards, no grades, no pulse
--   2 = full award set + grades + pulse

alter table public.on_the_clock_draft_snapshots
  add column if not exists grades jsonb not null default '[]'::jsonb,
  add column if not exists pulse jsonb not null default '{}'::jsonb,
  add column if not exists snapshot_version integer not null default 1;

comment on column public.on_the_clock_draft_snapshots.grades is
  'Frozen per-team draft grades (letter, composite, component scores, written review) computed at finalize. Empty array on version 1 snapshots.';
comment on column public.on_the_clock_draft_snapshots.pulse is
  'Frozen Draft Pulse standings at completion: projected optimal starting-lineup points per week per team, ranked within the league. Never wins or playoff odds. Empty object on version 1 snapshots.';
comment on column public.on_the_clock_draft_snapshots.snapshot_version is
  'Payload contract version. 1 = legacy (six awards, no grades). 2 = full award set plus grades plus pulse. The client gates rendering on this so an old snapshot never shows half a grid.';
