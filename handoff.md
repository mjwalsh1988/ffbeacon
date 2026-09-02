# Handoff

Session of 2026-09-01. Build: **The FF Beacon Projection Engine**. Plan of
record: `docs/projection-engine-plan.md`. Tasks: `progress.md`, prefix `PE-T###`.

## State

**Nothing is committed.** Everything lives in the working tree.

Green as of the last run:

- `npx tsc --noEmit` clean
- `npx vitest run`: 231 files, 3,628 tests, all passing
- `npm run build` clean, all three new routes registered
- Punctuation scan clean across every changed file

ALL SEVEN PHASES COMPLETE, including the four independent reviews and the fixes
that came out of them. See "Projection engine review outcomes" at the end of
`progress.md` for the full list.

## What this build is

Before it, there was no FF Beacon projection engine. There was a Sleeper
projection with four FF Beacon multipliers on top, applied by seven surfaces and
skipped by six others. Now there is a projection of our own, stored as
`player_weekly_projections` rows with `source = 'ffbeacon'` in Sleeper's own
component stat-line vocabulary.

**It ships disabled.** `beaconProjections.enabled` defaults to false. Nothing on
the site changes until an admin turns it on, and what earns that edit is the
scoreboard at `/admin/projections`.

## What is live in production right now

Six migrations applied to `cilvpyivysjxpxbudkfa`, each verified with the
project's RLS sequence (policy inventory, anon SELECT simulation, anon write
simulation asserting zero rows changed):

- **0237** `nfl_defense_vs_position`: `adjusted_points_allowed_per_game`,
  `adjusted_multiplier`, `shrunk_multiplier`
- **0238** `nfl_game_odds`: new table, public select, service-role write
- **0239** `player_weekly_projections`: source-leading index
- **0240** `player_projection_accuracy`: `source`, both unique indexes re-keyed
- **0241** `player_weekly_projections`: a SECOND index,
  `(source, season, season_type, player_id, week)`. 0239's column order serves
  the count probes but not the row fetch, because a btree cannot use a later
  column as an index condition once a preceding one is range-restricted, and
  `week` is a range. Both are kept; they serve different halves of one read path.
- **0242** `player_stats`: `(season, season_type, id)`. Ordering a keyset walk by
  `id` defeated the season index and made Postgres walk the primary key,
  filtering season row by row: 5,276 ms and 8,355 disk pages to return 1,000
  rows. This index plus a per-season walk took the projection build from 160
  seconds to 34.

Data written:

- `nfl_defense_vs_position`: 1,728 rows recomputed with the opponent adjustment
  and the shrinkage. Applied multiplier spread is now DEF sd 0.041, RB 0.028,
  TE 0.019, K 0.009, QB and WR exactly 1.000, against a raw spread of sd 0.13
  to 0.19 pinned at the clamps.
- `nfl_game_odds`: 272 games, all 18 weeks of 2026.
- `player_weekly_projections`: 18,508 `ffbeacon` rows for 2026, mirroring
  Sleeper's 18,508 exactly.
- `player_projection_accuracy`: 5,703 rows rebuilt, now source-scoped and
  position-centered.

## Two things the owner has to decide, not the next session

**1. The stale production settings row. DONE, on the owner's instruction.**
It was diffed programmatically before being touched: it differed from code
defaults in exactly 9 values, all of them superseded measurements (the six
variance figures and the three reliability ones), and every other key was
byte-identical. It is now `{}`, so the row still exists for the admin form while
overriding nothing. Effective model version went from `pp-6+xl59yf` to a clean
`pp-6`, which invalidates the caches so leagues rescore correctly.

The related MECHANISM bug was fixed in code (PE-T017): the stored row could also
pin `modelVersion`, so four consecutive model bumps invalidated nothing.
`effectiveModelVersion` now always takes the base from code and folds the stored
document in as a fingerprint.

**2. Turning our projections on.** `beaconProjections.enabled` is false. Leave it
false until the scoreboard shows a real graded sample.

## Key decisions, do not relitigate

- **Blend, do not replace.** Twelve seasons of data say an equal-weighted
  average beat individual sources in 69% of comparisons. Blend caps at 0.5 and
  starts at 0.
- **Mirror EVERY Sleeper row**, including kickers, defenses, and weeks Sleeper
  marks out. A reader on the ffbeacon source reads only ffbeacon rows, so a week
  we declined to write would vanish, and a vanished week is indistinguishable
  from a bye.
- **Anchor points on Sleeper's published total, apply our model as a delta.**
  Sleeper's own total is NOT the canonical dot product of its own stat line (a
  live 2026 quarterback row: 20.36 derived against 23.26 published), and a
  kicker's line does not dot-product to anything under skill scoring.
- **Calibrate inside the startable range only.** Compressing the whole pool
  toward the top-N mean inflates the deep bench, measured at plus 54% for tight
  ends.
- **Availability is carried through from Sleeper, never asserted by us.**
- **WR opponent reliability is 0.00 and QB is 0.00**, from our own measurement.
  See PE-T016 in progress.md for the full table and for the honest note that
  the opponent adjustment helped running backs and nothing else.
- **No kicker or defense projections of our own.** Not individual usage.
- **No play-by-play ingestion.** Out of scope.
- **ESPN is the odds source**, free and unauthenticated. Only team-code
  difference from ours is `WSH` against our `WAS`.

## Known gaps, recorded rather than hidden

- **The backtest exists now, and it says our model is worse than Sleeper.**
  `npm run backtest:projections`. Walk-forward over all of 2025: for each week it
  rebuilds from the two prior seasons plus that season's earlier weeks only, then
  grades against what happened. Pooled over 6,097 graded player-weeks, PPR:
  Sleeper MAE 4.116, our blended output 4.372 (6.2% worse), our model alone
  5.266. It is a dose-response curve, not noise: at week 1 where the blend weight
  is 0 the two agree to three decimals, and from week 7 where it caps, blended
  runs 0.35 worse every week.
  `blend.max` is therefore 0. At that weight our source is a calibrated Sleeper,
  which the week 1 rows show is a hair better than raw Sleeper. RAISE IT ONLY
  WHEN A RERUN SAYS SO.
  Quarterbacks are the exception and the lead worth following: blended MAE 6.320
  against Sleeper's 6.540, bias cut from -2.834 to -1.232. A per-position blend
  weight is the obvious next move.
  Two things are NOT in that measurement: game environment (ESPN drops the
  betting line once a game is played, so no 2025 odds exist) and the read-path
  multipliers, since it grades the stored projection rather than what
  `projectPlayerWeek` returns.
- **Trade Ideas does not pass injury statuses** into the adjusted read, because
  `lib/league-view-data.ts` never fetches `injury_status`. Both files say so
  inline.
- **A past season's within-season decay assumes an 18 week finish**, which
  slightly overstates recency for 2020's 17 week season.
- **The scoreboard and the accuracy calc are two independent computations** of
  overlapping figures. They should roughly agree and are not wired together.

## Inherited working tree, not part of this build

`git status` at session start already showed these:

- **pp-5**, the reliability multiplier centered on position with its range cut
  to plus or minus 5%. Correct work; this build carried it forward and bumped to
  pp-6 on top of it.
- **A Trade Ideas ranking change** across `app/actions/trade-finder.ts`,
  `components/trade-finder.tsx`, `components/player-picker.tsx` and
  `lib/trade-finder/*`. Phase 6 merges into it rather than over it.

## Module map

```
lib/projections/
  types.ts             the shapes, and why a stat line is not a point total
  default-settings.ts  every weight and cap, admin-overridable
  source-constants.ts  the two source slugs. leaf module, no imports
  adjust.ts            PURE. opponent adjustment and multiplier shrinkage
  defense-seasons.ts   PURE. which seasons an opponent lookup considers
  usage.ts             PURE. recency-weighted role shares and efficiency rates
  volume.ts            PURE. team volume and the game-environment effect
  convert.ts           PURE. opportunity into a component stat line
  calibrate.ts         PURE. per-position spread calibration
  blend.ts             PURE. beacon and sleeper, key by key
  engine.ts            PURE. computeBeaconProjections
  source.ts            which source a reader gets
  read.ts              THE single adjusted read path

lib/build-beacon-projections.ts   the I/O half of the builder
lib/nfl-odds.ts                   ESPN adapter. null on failure, never throws
lib/sync-nfl-odds.ts              the odds sync
lib/projection-scoreboard.ts      the /admin/projections aggregator
```

## Commands

```
npm run sync:odds
npm run build:projections
npm run calculate:defense-splits
npm run calculate:projection-accuracy
```

## Next step

Nothing is blocking. In rough order of value:

1. **Make the model actually beat Sleeper.** The backtest is the instrument and
   it currently says no. Concrete leads, in order:
   a. A per-position blend weight. Quarterbacks already win; nothing else does.
   b. Re-run with game environment. The 2025 backtest had none, so the volume
      and game-script adjustments are entirely unmeasured. 2026 will have odds
      from week 1, so a mid-season rerun tests them for the first time.
   c. Look at the bias. Our model over-projects by about 1 point pooled and
      UNDER-projects quarterbacks by 2. Those are different problems.
2. **Watch the first graded week of 2026.** `/admin/projections` has the
   mechanism and no sample until games are played.
3. Turn on `beaconProjections.enabled` only once the scoreboard earns it, and
   raise `blend.max` above 0 only once the backtest does.
