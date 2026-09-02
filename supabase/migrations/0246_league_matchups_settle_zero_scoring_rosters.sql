-- Migration 0246: settle the rosters the old is_final test stranded
--
-- THE DEFECT. lib/league-matchups.ts wrote `is_final: week < currentWeek &&
-- points > 0`, testing the points PER ROW. Whether a week was played is a fact
-- about the WEEK, not about one roster, so any roster that legitimately scored
-- zero in a settled week never settled: a playoff bye, or a roster whose every
-- starter was on bye. That row then stayed projectable forever, and with the
-- fetch-window fix in the same change it would be re-requested from Sleeper for
-- the rest of the season while every other roster in the same week was final.
--
-- The code now decides once per week, from whether ANY roster in it scored.
-- This applies the same rule to the rows already written: a row settles when
-- another roster in the same league, season and week is already marked final,
-- which is precisely the evidence that the week was played.
--
-- Deliberately narrow. It does not settle a week where nothing is final, since
-- that is a week we have no evidence about; those are handled by the settle
-- pass in `weeksToFetch`, which re-fetches them from Sleeper and lets the
-- corrected write path decide.
--
-- Production impact at time of writing: exactly one row, a 2025 week 15 roster
-- carrying zero points in a week whose other eleven rosters were all final.
-- Idempotent: a second run matches nothing.
--
-- Access matrix (unchanged; this migration adds no object):
--   anon          : SELECT (existing league_matchups policy)
--   authenticated : SELECT (existing league_matchups policy)
--   service_role  : ALL
--   client writes : BLOCKED

update public.league_matchups m
set is_final = true
where m.is_final = false
  and exists (
    select 1
    from public.league_matchups s
    where s.league_id = m.league_id
      and s.season = m.season
      and s.week = m.week
      and s.is_final = true
  );
