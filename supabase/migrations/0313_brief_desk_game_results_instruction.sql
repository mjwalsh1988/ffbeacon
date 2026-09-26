-- The Brief desk instructions ask for every final score of the week. The
-- scoreboard section of rule 4 named only the top scorers and the value
-- movers, so no drafted edition was asked to cover the games themselves; the
-- bundle now carries teams[].week_result (lib/brief-desk/week-results.ts).
--
-- Data only. Access matrix unchanged: beacon_settings keeps its existing policies.
-- A replace() of the one phrase rather than a whole-text overwrite, so any other
-- edit the owner has made at /admin/brief-desk/settings survives. If the owner
-- has reworded that phrase, this is a no-op and the change is made there by hand.
-- Mirrors lib/brief-desk/instructions-seed.ts.

update beacon_settings
set value = to_jsonb(replace(
      value #>> '{}',
      $old$the week's scoreboard (top scorers by position from the bundle, and the biggest value movers)$old$,
      $new$the week's scoreboard (every final score of the week, one line per game on what it meant for fantasy, taken from teams[].week_result and confirmed against a scoreboard page you fetch, or from that page alone when week_result is null; then the top scorers by position from the bundle and the biggest value movers)$new$
    )),
    updated_at = now()
where key = 'bd_brief_instructions'
  and position($old$the week's scoreboard (top scorers by position from the bundle, and the biggest value movers)$old$ in value #>> '{}') > 0;
