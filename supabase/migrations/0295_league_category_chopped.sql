-- Let 'chopped' be a league category.
--
-- Access matrix: unchanged. Both tables keep the policies they already had.
--
-- WHY. `lib/league-category.ts` gained a fifth bucket on 2026-09-22: a chopped
-- (guillotine, death, knockout) league is a different game rather than a
-- redraft league that prices the same, and the site now has a guide and a
-- calculator mode for it. Two columns store that key and both had a CHECK
-- naming the old four, so a run that classified one would have failed the
-- insert.
--
-- EXISTING ROWS ARE LEFT ALONE, DELIBERATELY. A chopped league captured before
-- today is stored as 'redraft', which is what the rule said at the time. They
-- are not rewritten here for two reasons: the value is a snapshot of how a run
-- classified a league at the moment it ran, and rewriting history to match a
-- rule that did not exist then makes the stored figure less honest rather than
-- more. Both columns are recomputed by their own jobs on the next pass, so
-- they converge on their own.
--
-- The name matches `faab_market_priors.league_kind`, which has carried a
-- 'chopped' value since migration 0289. One spelling across the schema.

alter table public.would_you_rather_trades
  drop constraint would_you_rather_trades_league_category_check;

alter table public.would_you_rather_trades
  add constraint would_you_rather_trades_league_category_check
  check (
    league_category is null
    or league_category = any (array[
      'dynasty', 'redraft', 'chopped', 'best-ball-dynasty', 'best-ball-redraft'
    ])
  );

alter table public.manager_pulse_run_leagues
  drop constraint manager_pulse_run_leagues_league_category_check;

alter table public.manager_pulse_run_leagues
  add constraint manager_pulse_run_leagues_league_category_check
  check (
    league_category is null
    or league_category = any (array[
      'dynasty', 'redraft', 'chopped', 'best-ball-dynasty', 'best-ball-redraft'
    ])
  );
