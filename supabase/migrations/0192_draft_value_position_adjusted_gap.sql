-- Migration 0192: draft_value_targets.position_adjusted_gap
--
-- Access matrix: unchanged from 0191 (anon/authenticated SELECT, service_role ALL).
--
-- WHY
-- Building the engine surfaced a third failure mode that the plan had not
-- anticipated, alongside the two it was written to prevent.
--
-- A points-above-replacement model and a real draft market disagree about whole
-- POSITIONS, not only about players. Ours puts elite quarterbacks earlier than a
-- one-QB room takes them, which is the long-running argument between
-- value-over-replacement models and actual draft behaviour rather than a bug. On
-- a synthetic board built to reproduce production's measured per-position
-- offsets (QB +26.6, WR +8.9, RB -0.5, TE -5.7 rank slots), quarterbacks took
-- ALL TWELVE of the top twelve steal slots.
--
-- A steal list is the wrong place to relay a whole-position disagreement. "The
-- market is late on this player" has to mean late relative to COMPARABLE
-- players; a uniform +20 on every quarterback is a strategy claim, and it
-- belongs in the guide's prose rather than in thirty-two identical rows.
--
-- So the engine subtracts each position's MEDIAN gap before ranking. The median
-- rather than the mean, so a few genuinely mispriced players cannot drag the
-- correction and hide themselves.
--
-- value_gap stays the RAW arithmetic (market_adp - beacon_pick), because that is
-- the number the verdict sentence quotes and a reader can check it against the
-- two picks either side. This column is the centered number the ranking and the
-- category actually use, stored so the board can explain itself.

alter table public.draft_value_targets
  add column if not exists position_adjusted_gap numeric;

comment on column public.draft_value_targets.position_adjusted_gap is
  'value_gap with the median gap for this player''s position removed. This is what steal_score and category are computed from, so the board ranks a quarterback against other quarterbacks rather than against a model-wide disagreement about the position. value_gap keeps the raw arithmetic for display. Disable via draft_value_settings.settings.positionCentering.enabled.';
