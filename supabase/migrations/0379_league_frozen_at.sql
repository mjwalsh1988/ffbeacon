-- 0379: leagues.frozen_at, the stamp that turns a finished past season into a
-- stored snapshot (LPI-T02, audit item 4).
--
-- Access matrix: unchanged. A new column on an existing table inherits the
-- table's policies (leagues: public SELECT, writes by service role only), and
-- frozen_at is not sensitive.
--
-- A league from a season before the current one is stamped by the app at the
-- end of its last full capture (lib/league-pulse.ts captureLeagueRawData):
-- every transaction week walked from week 0, the full matchup slate, brackets
-- and draft picks, all succeeded. From then on no Sleeper request is made for
-- it and its rows are never rewritten; pages read what is stored.
--
-- Nothing is frozen here. Every capture stored before this migration ran the
-- old transaction walk, which stopped after three empty weeks and missed whole
-- seasons of moves, so no existing capture counts as final. Each past-season
-- league freezes after its next capture, or after
-- scripts/backfill-league-final-capture.ts runs it.

alter table public.leagues
  add column if not exists frozen_at timestamptz;

comment on column public.leagues.frozen_at is
  'When this past-season league was frozen after its last full capture. Non-null means no Sleeper request is made for it and its rows are never rewritten.';
