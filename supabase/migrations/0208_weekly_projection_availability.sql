-- Migration 0208: player_weekly_projections availability columns
--
-- WHY
-- Sleeper stops publishing point projections for a player who cannot play. It
-- does NOT publish a zero and it does not remove the player: the row still
-- arrives every night, carrying the injury designation, with the pts_ppr /
-- pts_half_ppr / pts_std keys simply absent. Our sync required at least one of
-- those keys before it would store anything, so an injured player was skipped
-- and the previous night's numbers survived untouched. Nothing downstream could
-- tell a stale projection from a current one, and Ricky Pearsall (IR, out for
-- the season) kept reading 8.9 PPR a week in Power Pulse and Trade Ideas for
-- 24 days after Sleeper stopped projecting him.
--
-- Writing a zero on sight would be wrong, because "no points published" also
-- covers a bye week: in week 10 of 2026 that is Jalen Hurts, Saquon Barkley and
-- 68 other entirely healthy players. Sleeper distinguishes the two itself.
-- A player with a scheduled game and no points is unavailable. A player with no
-- game is on bye. `game_id` is the discriminator, present on the injured row and
-- null on the bye row.
--
-- SUPERSEDED IN PART BY 0209
-- The rule stated below ("a scheduled game and no points means the player is
-- out") turned out to be too blunt once it met the real payload: 406 of the 531
-- matching players in week 10 were healthy backups, not injured. 0209 widens the
-- constraint and makes the injury designation the discriminator. Read that
-- migration alongside this one; this file is kept as applied.
--
-- WHAT THIS ADDS
--   availability   'projected' | 'out' | 'unknown'
--                  Why this row holds the number it holds.
--                    projected -> Sleeper published points; the numbers are its
--                                 opinion, with any injury already priced in.
--                    out       -> Sleeper scheduled a game for this player and
--                                 published no points. Stored as a real 0.
--                    unknown   -> reserved for a future source that can neither
--                                 confirm nor deny; nothing writes it today.
--                  Bye weeks are NOT rows. They stay absent, so the existing
--                  "a null projection is never a zero" rule is untouched.
--   injury_status  Sleeper's designation on this row at sync time, verbatim
--                  ("IR", "PUP", "Questionable", ...). Independent of the
--                  players table, so a zero remains explainable even if the
--                  player dimension sync has not run.
--
-- Existing rows are backfilled to 'projected', which is what every one of them
-- is: they all carry a published number.
--
-- Access matrix is unchanged from 0140 (public read-only data pattern):
--   anon          : SELECT
--   authenticated : SELECT
--   service_role  : ALL (nightly sync writes)
--   client writes : BLOCKED

alter table public.player_weekly_projections
  add column if not exists availability text not null default 'projected',
  add column if not exists injury_status text;

alter table public.player_weekly_projections
  drop constraint if exists player_weekly_projections_availability_check;
alter table public.player_weekly_projections
  add constraint player_weekly_projections_availability_check
  check (availability in ('projected', 'out', 'unknown'));

-- Readers that want only the weeks a player is expected to play (the projection
-- boards, the schedule detail) filter on this alongside season and week.
create index if not exists idx_player_weekly_projections_availability
  on public.player_weekly_projections(season, week, availability);

comment on column public.player_weekly_projections.availability is
  'Why this row holds the number it holds. projected = Sleeper published points. out = Sleeper scheduled a game and published no points, so the stored points are a real 0. unknown = reserved. Bye weeks are absent rows, never ''out''.';

comment on column public.player_weekly_projections.injury_status is
  'Sleeper''s injury designation for this player at sync time, verbatim (IR, PUP, Questionable, ...). Null when healthy. Carried per row so an out projection stays explainable without joining players.';
