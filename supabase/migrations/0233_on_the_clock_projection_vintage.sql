-- On The Clock: let the draft room notice that its projections moved.
--
-- ACCESS MATRIX (unchanged by this migration)
--   players                         public select, service_role write
--   on_the_clock_projection_cache   service_role only
--   on_the_clock_draft_snapshots    service_role only
-- No policy is added or altered here. Every object below is an index or a
-- nullable column on a table that already carries its policies.
--
-- WHY
-- The draft room's projection sweep was cached on (scoring_signature, season,
-- from_week) with a 24-hour timer, and the Draft Pulse built from it was cached
-- on (draft_id, pick_count, model_version). Nothing in either key changes when
-- the nightly projection sync rewrites every row at 12:01 UTC, or when the
-- player sync writes a new injury designation at 06:00.
--
-- On 2026-08-31 that produced a draft room and a League Pulse page disagreeing
-- by up to 8 points a week about identical rosters. The board was built at
-- 01:23; the player sync at 06:00 moved Josh Jacobs to DNR, Jordyn Tyson,
-- James Conner and Savion Williams to IR and Joe Royer to PUP; the projection
-- sync at 12:01 moved 388 of 603 players, 68 of them by more than a point a
-- week. A completed draft never recomputes at all, because its pick count is
-- frozen, so the room stayed on the 01:23 numbers indefinitely.
--
-- data_version is the fingerprint of the two syncs the board is built from. A
-- cached row whose fingerprint no longer matches is rebuilt, whatever the timer
-- says. The primary key is unchanged, so this stays one row per scoring shape
-- rather than growing a row per day.

alter table public.on_the_clock_projection_cache
  add column if not exists data_version text;

comment on column public.on_the_clock_projection_cache.data_version is
  'Fingerprint of the newest player_weekly_projections and players write the payload was built from. A mismatch rebuilds the board regardless of the TTL.';

-- max(updated_at) on a 10,480-row, 48 MB table is a sequential scan, and the
-- draft room asks for it on every request. player_weekly_projections already
-- has idx_player_weekly_projections_season_updated for the same question.
create index if not exists idx_players_updated_at
  on public.players (updated_at desc);

-- A completed draft's snapshot dates its value and ADP inputs and then calls
-- itself "high" confidence, but it never dated its PROJECTION inputs, which
-- drive the lineup component (a third of the grade after redistribution), every
-- Draft Pulse rank, and five of the thirteen awards. A reader had no way to see
-- that those numbers were five hours older than the draft they describe.
alter table public.on_the_clock_draft_snapshots
  add column if not exists projection_snapshot_date timestamptz;

comment on column public.on_the_clock_draft_snapshots.projection_snapshot_date is
  'When the projection sweep behind the frozen Draft Pulse, grades and awards was computed. Null on snapshots finalized before this was recorded.';
