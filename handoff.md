# Handoff

Session of 2026-08-25. Fixing a family of bugs that all share one shape: a value
that looks current and is not, with nothing anywhere erroring.

The session started from a user report that Ricky Pearsall, on season-ending IR,
was still showing projected points in Trade Ideas. Two fixes are already
committed and pushed (`2fe4c98`, `3e132f7`). A codebase-wide audit then turned up
seven more issues of the same family, and this session is working through them.

## Already committed and pushed

- `2fe4c98` fix(projections): a player who cannot play is projected at zero
- `3e132f7` fix(search): a player on IR is still a player

## The seven audit findings: ALL DONE (T685 to T691)

Nothing below has been committed. The owner asked for the work only.

| # | Task | Status |
| --- | --- | --- |
| 1 | rankings.generated_at never refreshed | **T685 done** |
| 2 | player_value_trends serves values from sources that dropped the player | **T686 done** |
| 3 | calculate-defense-splits + calculate-projection-accuracy never scheduled | **T687 done** |
| 4 | deriveStatus() is lossy, `active:false` overrides the real status | **T688 done** |
| 5 | Beacon Brief player linking is filtered when it should not be | **T689 done** |
| 6 | SEASON = 2025 hardcoded in three files | **T690 done** |
| 7 | OG player card shows "INACTIVE" instead of the injury designation | **T691 done** |

## Two corrections the owner asked for, both applied to the plan

**Finding 3 was partly wrong and the report overstated it.** The audit flagged
`nfl_defense_vs_position` and `player_projection_accuracy` as "24 days stale with
no 2026 rows". They have no 2026 rows because the 2026 REGULAR season has not
started. Sleeper's live state on 2026-08-25 reads `season_type: "pre", week: 3`,
and `player_stats` holds only 2026 preseason weeks 1 and 2. Both calcs filter
`season_type = 'regular'`, so there is genuinely nothing for them to compute yet
and the current data is correct.

What IS still true, and is the only thing task 3 should claim: neither script is
referenced by any cron route (verified, 0 references each). Both derive their
season from the data (`recentSeasons()` and `max(season)` respectively), so both
will pick up 2026 on their own ONCE something runs them. Nothing will. The
failure is forward-looking, not present, and it lands the week the regular season
starts.

**Beacon Brief linking must not be filtered at all.** The audit proposed swapping
`isCurrent()` for a rankings-membership test. The owner's instruction is that the
Beacon Brief player search should have NO relevance limit: linking an article to
a retired player, or to anyone else, must be possible. So task 5 removes the
gate rather than replacing it.

## What is left

1. **Commit and push.** Deliberately not done; the owner reviews first. Nothing
   in the working tree has been committed.
2. **Browser check.** None of this has been opened in a real browser or against
   a screen reader. The rankings board (T690 removed its season filter) and the
   player OG card (T691) are the two with visible output.
3. **Watch the first real regular-season week.** T687 is a forward-looking fix:
   the proof it worked is `nfl_defense_vs_position` and
   `player_projection_accuracy` gaining 2026 rows after the stats sync runs
   following week 1. Neither can gain one before then.

## Things a new session must not get wrong

- **Do not commit or push.** The owner reviews first.
- **Update `progress.md` after every atomic task**, and this file alongside it.
  Tasks are numbered from T685 up.
- **`rankings.generated_at` is now written explicitly.** Never take it back out
  and never let it fall back to the column default. `lib/seed-rankings.test.ts`
  fails if it does. `lib/seed-rankings.ts` is the only writer to that table; the
  other 28 call sites all read.
- **A null projection is not a zero, and an "out" projection is not a null.**
  `player_weekly_projections.availability` carries the difference: `projected`,
  `out` (a real 0), `unprojected` (nulls, week reads absent). Bye weeks are not
  stored at all.
- **Availability is Sleeper's, quality is ours.** Do not reintroduce our own
  week-to-week injury discount on top of a number Sleeper already discounted.
  Season-long designations still override a live projection.
- **`players.status` is not a relevance signal.** It is Sleeper's roster state
  and an injured player reads "Inactive". Never filter user-facing lookups on it.
  `lib/player-search.test.ts` fails if search does. After T691 the only thing
  still reading it for a person to see is the moderation label in
  `lib/beacon-brief/match.ts`, which is cosmetic on purpose.
- **Beacon Brief player matching has NO relevance filter and must not gain one.**
  Owner's instruction. Linking an article to a retired player has to be
  possible. Safety comes from the exact normalized-name match and the
  one-result rule, not from judging whether a player still matters.
  `lib/beacon-brief/match-players.test.ts` holds that line.
- **`rankings` holds exactly one season.** The writer derives it from
  `currentNflSeason()` and sweeps every other season, which is what lets both
  readers drop their season filter. Do not reintroduce a pinned season constant
  in a reader: it drifts from the writer silently, and it blanks the board for
  the hours between the March rollover and that night's write.
- **A derived-table producer is scheduled or it is documented.**
  `lib/derived-tables-scheduled.test.ts` fails if any `lib/calculate-*`,
  `lib/sync-*` or `seed-rankings` is neither imported by a cron route nor listed
  in its `ON_DEMAND_BY_DESIGN` map with a reason. An unscheduled producer never
  fails, so nothing else can tell you it stopped.
- **Table-level freshness is not row-level freshness.** `lib/data-freshness.ts`
  answers "has this table been written recently" and reported
  `player_value_trends` healthy while 213 players in it carried values up to 200
  days old, because the calc had run that day. Per-row staleness needs its own
  gate; `lib/calculate-trends.ts` now has one.
- **Plain ASCII everywhere.** No em-dash, no curly quotes, no ellipsis character,
  in code, comments, UI copy, or aria-labels.
- **No data hidden at any breakpoint.** Compact mobile layouts, never reduced
  ones. 44x44 minimum tap targets.

## Live DB changes made this session, which do NOT travel with a commit

- `league_power_pulse_settings.settings.modelVersion`: `pp-1` -> `pp-2`.
- Migrations 0208, 0209, 0210 applied to prod.
- `npm run sync:players` and `npm run sync:weekly-projections` re-run against
  prod, plus `npm run seed:rankings` after T685 and `npm run calculate:trends`
  after T686 (which deleted 778 stale rows). T690 re-ran seed:rankings,
  moving every ranking row from season 2025 to 2026 and deleting the 12,115
  old-season rows. T688 re-ran sync:players.
