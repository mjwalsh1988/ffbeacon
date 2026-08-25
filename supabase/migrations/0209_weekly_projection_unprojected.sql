-- Migration 0209: player_weekly_projections gains an "unprojected" state
--
-- WHY, AND WHY IT IS A SECOND MIGRATION
-- 0208 landed with three states and the rule "a scheduled game plus no points
-- means the player is out". Running it against the real payload showed the rule
-- was too blunt, so this widens it rather than pretending 0208 was right.
--
-- In week 10 of 2026, 531 players had a scheduled game and no published points.
-- Only 60 of them carried an injury designation. The other 406 were healthy
-- backup quarterbacks and deep bench players: Justin Fields on KC, Mac Jones on
-- SF, Jameis Winston on NYG. Every one of them is rostered in real leagues, and
-- Fields averaged 20.4 PPR across the weeks he was projected in 2025.
--
-- Their rows are byte-identical to Ricky Pearsall's season-ending IR row except
-- for one field. Sleeper does not project backup quarterbacks, which is silence,
-- not a forecast of zero. Storing a zero there would have invented an opinion
-- Sleeper never gave and buried a real player at the bottom of every lineup for
-- eighteen weeks, which is the same category of error as the stale projection
-- this whole change set exists to fix, pointed the other way.
--
-- So the injury designation, not the scheduled game, decides:
--   projected   -> Sleeper published points. Stored verbatim.
--   out         -> game scheduled, no points, AND a designation. A real zero.
--   unprojected -> game scheduled, no points, no designation. Null points, so
--                  readers treat the week as absent exactly as they do today.
--                  The row exists to overwrite whatever stale number was there,
--                  not to assert a new one.
--   (bye)       -> no game. Still not stored at all.
--
-- 'unknown' from 0208 is retired: nothing ever wrote it, and two names for
-- "we have no number" is one too many.
--
-- Access matrix unchanged from 0140.

alter table public.player_weekly_projections
  drop constraint if exists player_weekly_projections_availability_check;

alter table public.player_weekly_projections
  add constraint player_weekly_projections_availability_check
  check (availability in ('projected', 'out', 'unprojected'));

comment on column public.player_weekly_projections.availability is
  'Why this row holds the number it holds. projected = Sleeper published points. out = a scheduled game, no points, and an injury designation, so the stored points are a real 0. unprojected = a scheduled game, no points, no designation: Sleeper does not cover this player, points are null and the week reads as absent. Bye weeks are absent rows, never stored.';
