-- Migration 0034: cadence-aware bookend trend gate
--
-- Replaces the old "data_points_30d >= 7" UI gate. Counting points does not
-- prove a window is covered; a window should only show a movement chip when the
-- source has an actual data point near BOTH ends of that window (a starting
-- bookend and an ending bookend). Tolerance is derived per-source from cadence.
--
-- Two schema additions:
--   1. source_registry.update_cadence ('daily' | 'weekly'): how often the
--      source publishes. Drives the bookend tolerance (daily -> +/-1 day,
--      weekly -> +/-7 days) and the "updated weekly" chip label.
--   2. player_value_trends.show_trend_7d / _30d / _90d: per-window display flags
--      computed by calculate-trends.ts using the bookend rule. One flag per
--      window gates BOTH the value-change chip and the rank-movement chip for
--      that window. NULL is not allowed; default false (hidden) so a row that
--      predates a recompute is hidden rather than wrongly shown.
--
-- Access matrix (both tables, unchanged):
--   anon / authenticated : SELECT
--   service_role         : ALL
--   client writes        : BLOCKED
--
-- NOTE (small-window tolerance): a +/-7 tolerance is only valid when the window
-- is meaningfully larger than the tolerance. The 7-day window is <= 14 days, so
-- a weekly +/-7 would let the two bookends overlap. calculate-trends.ts caps the
-- tolerance at floor((window-1)/2), which makes the 7d-weekly tolerance 3 days.
-- This column only records cadence; the cap lives in the calc.

begin;

-- 1. Source cadence -----------------------------------------------------------
alter table public.source_registry
  add column if not exists update_cadence text not null default 'daily'
    check (update_cadence in ('daily', 'weekly'));

comment on column public.source_registry.update_cadence is
  'How often the source publishes new values. Drives the bookend tolerance in '
  'calculate-trends.ts (daily -> +/-1 day, weekly -> +/-7 days, capped so small '
  'windows do not overlap) and the "updated weekly" chip label.';

update public.source_registry set update_cadence = 'weekly' where slug = 'dynastyprocess';
-- ktc and fantasycalc keep the 'daily' default.

-- 2. Per-window display flags -------------------------------------------------
alter table public.player_value_trends
  add column if not exists show_trend_7d boolean not null default false,
  add column if not exists show_trend_30d boolean not null default false,
  add column if not exists show_trend_90d boolean not null default false;

comment on column public.player_value_trends.show_trend_7d is
  'True when the source has a data point within tolerance of both the 7-day '
  'window start and now. Gates the 7d value + rank chips. Set by calculate-trends.ts.';
comment on column public.player_value_trends.show_trend_30d is
  'True when both 30-day-window bookends are covered. Gates the 30d chips.';
comment on column public.player_value_trends.show_trend_90d is
  'True when both 90-day-window bookends are covered. Gates the 90d chips.';

commit;
