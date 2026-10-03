# The FF Beacon Projection Engine, version 2

Plan of record for the second build. Written 2026-09-27 from a review of the
whole projection stack against production (`cilvpyivysjxpxbudkfa`) and against
the published research, and revised the same day after the owner's three
decisions (0.8): the engine stands on its own with Sleeper as an optional
ingredient, nothing costs money to run, and the settings move to
`/admin/projections`. Revised a second time the same evening after a full
audit of the plan against production, against the live nflverse, Sleeper and
DynastyProcess files, and against the published research; Part 10 lists every
hole that audit found and where in the plan each one is closed. Revised once
more on 2026-09-28 when the owner decided that The Odds API's free tier
replaces every use of ESPN's scoreboard (0.8, 2.7). PLAN ONLY:
nothing in this document has been built. Task prefix in `progress.md` will be
`PE2-T###`.

The first plan, now at `docs/completed/projection-engine/projection-engine-plan.md`,
is still the reference for what exists. This document does not repeat it; it
says what is wrong with it, what is missing from it, and exactly how to build
the replacement so a fresh session can start on task PE2-T000 without
re-deriving anything here.

---

## Part 0. Where the projection system actually stands

Everything in this part was measured on 2026-09-27 against production, or read
out of the code at the commit `9201d50`. Nothing is assumed.

### 0.1 What exists

The stack has four layers, and only one of them is ours.

1. **Sleeper's weekly projection** is the base. `lib/sync-weekly-projections.ts`
   pulls `projections/nfl/{season}/{week}` for QB, RB, WR, TE, K, DEF, DL, LB
   and DB at 12:00 UTC daily, stores a component stat line per player-week in
   `player_weekly_projections` (source `sleeper`), and classifies each row
   `projected`, `out`, `unprojected`, or absent for a bye.
2. **The FF Beacon builder** (`lib/build-beacon-projections.ts`, cron 14:30 UTC)
   mirrors every Sleeper row into a second source, `ffbeacon`, and for QB, RB,
   WR and TE runs `lib/projections/engine.ts`: recency-weighted usage shares
   from `player_stats`, team volume from the same rows, a small game-environment
   nudge from `nfl_game_odds`, league-average efficiency shrunk toward the
   player's own, a per-position spread calibration, and a blend with Sleeper.
3. **The odds sync** (`lib/sync-nfl-odds.ts`, cron 13:15 UTC) reads ESPN's
   public scoreboard for the current week plus two, stores total, spread and
   the implied team totals in `nfl_game_odds`, one row per game, overwritten in
   place. This is the one source in the stack that is retired outright by this
   plan (2.7, 2.8): Disney's terms forbid automated and commercial use of ESPN
   products, and the owner decided on 2026-09-28 that The Odds API's free tier
   takes over game lines in Phase 1 and the ESPN adapter is deleted.
4. **The adjusted read path** (`lib/projections/read.ts` calling
   `lib/power-pulse/project.ts projectPlayerWeek`) is where every consumer
   gets its number: the stored stat line scored under the league's own rules,
   times an opponent multiplier from `nfl_defense_vs_position`, times a
   reliability multiplier and an availability multiplier from
   `player_projection_accuracy`, times an injury multiplier.

Two repo guards hold the shape: `lib/projections/source-guard.test.ts` (every
read names a source) and `lib/projections/raw-column-guard.test.ts` (nothing
reads `projected_pts_*` outside the shared read path). Both stay.

### 0.2 How accurate the FF Beacon projections are today

The honest answer is that they are Sleeper's projections. The blend weight
`blend.max` is 0 (`lib/projections/default-settings.ts`, set by PE-T081 after
the walk-forward backtest), and production holds no `beaconProjections`
override (the `league_power_pulse_settings` row carries only an IDP opponent
block). Of the 38,255 `ffbeacon` rows stored for 2026, exactly 0 carry a
non-zero `blend_weight`. The model runs nightly (4,696 player-weeks modelled on
the 2026-09-26 run) and its output is discarded at the blend.

What the scoreboard says for 2026 weeks 1 to 3, PPR, played weeks only, graded
2026-09-27 on the same rows for both sources:

| Position | n | Sleeper MAE | FF Beacon MAE | Sleeper bias | FF Beacon bias |
| --- | --- | --- | --- | --- | --- |
| QB | 66 | 6.976 | 6.968 | +0.007 | 0.000 |
| RB | 203 | 4.456 | 4.533 | -0.146 | -0.144 |
| WR | 325 | 4.954 | 4.991 | +0.658 | +0.660 |
| TE | 202 | 3.884 | 3.900 | +1.098 | +1.090 |
| K | 66 | 3.501 | 3.501 | +1.490 | +1.490 |
| DEF | 66 | 4.583 | 4.583 | +0.212 | +0.212 |

The two columns differ only by the calibration step, and the calibration is
making RB, WR and TE very slightly worse, not better, on these three weeks.
K and DEF are byte-identical because they are mirrored.

What the walk-forward backtest of 2025 said about the model at full weight
(`scripts/backtest-projections.ts`, run 2026-09-01, 6,097 graded player-weeks):

| Column | MAE | Bias | Correlation |
| --- | --- | --- | --- |
| Sleeper | 4.116 | -0.391 | 0.699 |
| Blended at 0.5 | 4.372 | -0.589 | 0.686 |
| FF Beacon alone | 5.266 | -0.961 | 0.637 |

The one position our model beat Sleeper at was quarterback (blended 6.320
against 6.540, bias cut from -2.834 to -1.232). Everywhere else the model was
worse, and worse in proportion to how much of it was used.

So: **the FF Beacon projection today is a calibrated copy of Sleeper's, the
calibration is not earning its keep, and the usage model underneath has been
measured and found wanting.** That is the starting point, and it is a fine one,
because the failure is diagnosable.

### 0.3 Why the usage model lost, specifically

Read off the engine and the data rather than guessed.

1. **It cannot see who is missing.** `computeUsageShares` measures a player's
   target share over his last several games. When his team's WR1 goes on
   injured reserve on Tuesday, his share for Sunday is unchanged in our model
   and raised in Sleeper's, because Sleeper's editors redistribute. The model
   has no concept of a vacated target. `players.metadata.sleeper` already
   carries `injury_status`, `practice_participation`, `depth_chart_order` and
   `depth_chart_position` for every player, and nothing in
   `lib/projections/` reads any of them.
2. **Team volume is a season average.** `computeTeamVolume` is a recency
   weighted mean of pass and rush attempts. A team's plays per game depend on
   its own pace, its opponent's pace, and the game script, and the only one of
   those the model touches is script, through a 0.004 per point linear shift
   capped at 8 percent. There is no pace, no opponent tendency, no
   pass-rate-over-expectation.
3. **The efficiency prior is one number per position.** A receiver's yards per
   target is shrunk 24 games toward the positional mean regardless of whether
   he runs deep routes or catches screens. `player_stats` carries `rec_air_yd`
   on 3,745 of 7,032 played 2025 skill-position rows and `rec_rz_tgt` in the
   Sleeper stat payload, and neither informs the prior. A deep threat and a
   slot receiver are pulled toward the same 8.1 yards per target.
4. **Red zone is rushing only.** `withRedZoneLeverage` uses `rush_rz_att` and
   nothing else. Receiving touchdowns, which are most of a receiver's variance,
   are projected as targets times a shrunk league rate. Sleeper's stat payload
   publishes `rec_rz_tgt` and we store it inside `metadata.stats` without
   reading it.
5. **The environment adjustment has never been measured.** ESPN drops a game's
   line once it is played, so `nfl_game_odds` holds 2026 only, the backtest ran
   with an empty environment map, and the totals and spread multipliers are
   the published order of magnitude rather than a fitted coefficient. That is
   correctable: nflverse publishes closing spread and total for every game back
   to 1999 (see 2.2).
6. **The blend has one weight for four positions and every week.** The backtest
   shows QB winning and the others losing. A single scalar cannot express that,
   so the honest setting was zero.
7. **The calibration slopes are somebody else's.** QB 0.67, RB 0.79, WR 0.85,
   TE 0.72 come from a twelve-season study of other people's projections. On
   2026 weeks 1 to 3 they do not help. The scoreboard exists to replace them
   with our own and nothing has done so yet.
8. **Nothing about the game itself is in the number except the line.** No
   weather, no roof, no surface, no rest days, no travel, no altitude, no
   kickoff slot. Sleeper's number carries none of these either.
9. **A point estimate is all that is stored.** Power Pulse derives a sigma from
   a coefficient-of-variation curve at read time, which is fine for a Monte
   Carlo but means no surface can say "floor 6, ceiling 24" from stored data,
   and the accuracy tables cannot grade whether our spread was right.
10. **Grading uses one metric.** MAE and bias in PPR. No rank correlation among
    startables (which is what a lineup decision uses), no calibration slope,
    no distributional score, no per-week trend, and no way to attribute error
    to volume against efficiency.

### 0.4 Two defects to fix regardless of the rest

- **`nfl_game_odds.fetched_at` never advances.** `runNflOddsSync` upserts
  `updated_at` but not `fetched_at`, so every 2026 row still carries
  `2026-09-01 22:35` while `updated_at` is today. `lib/nfl-game-environment.ts
  linesAreStale()` reads `fetched_at` with a 7-day threshold, so every lineup
  page that describes a game has been saying the line "is 25 days old and may
  have moved" about a line refreshed this morning. One-line fix, plus a test.
- **The odds row is a single overwritten snapshot.** Lines move all week, and
  the movement itself is information (a total that drops 4 points on Saturday
  is usually weather or a quarterback). Nothing records it. Section 2.3 adds a
  history table; the current row stays as the "latest" view.
- **`player_stats` has drifted from its migrations.** About a hundred typed
  Sleeper stat columns the code reads (`off_snp`, `tm_off_snp`, `rec_tgt`,
  `rush_rz_att`, `pass_rz_att`, `rec_air_yd`, the kicker and defense buckets)
  are in `lib/database.types.ts` and in production but in no file under
  `supabase/migrations/`, while migration 0004's `snap_count`, `targets`,
  `carries` and `air_yards` are in the migrations and not in the types. A
  fresh database built from the migrations would not run the engine. Phase 1
  writes a reconciling migration that documents the live shape (no data
  change), so the repo is again a complete record.
- **The cron registry disagrees with `vercel.json`.** `lib/cron-runs.ts`
  lists `sync-nfl-odds` at `0 13 * * *` and `sync-dynastyprocess` at
  `0 9 * * *`; `vercel.json` runs them at `15 13` and `15 9`. Cron-health
  tolerates a 26-hour gap so nothing pages, but the registry is the document
  the plan's new crons are added to, and it should be right first (T010c).
- **Most engine settings are not reachable from the admin page.** The
  Power Pulse settings manager exposes `enabled`, the blend cap and games,
  the usage half life, the efficiency prior, the two feature switches and the
  four calibration slopes. It does not expose `leagueAverageImpliedTotal`,
  `totalWeight`, the clamps, `spreadWeight`, `scriptMax`, the season weights,
  the minimum-games and minimum-team thresholds or `blend.min`. Phase 6 moves
  the projection settings onto `/admin/projections` beside the scoreboard that
  justifies them, and exposes every key with its fitted value and sample size.

### 0.5 What the data already holds that the model does not use

Measured 2026-09-27.

- `player_stats`, 2020 through 2026 week 3, regular season, `opponent` on 100%
  of rows. Typed columns include `rec_air_yd`, `rec_yar`, `rush_rz_att`,
  `pass_rz_att`, `pass_air_yd`, `rush_yac`, `rec_drop`, `off_snp`,
  `tm_off_snp` (team offensive snaps, on 6,653 of 7,032 played 2025
  skill-position rows, a better denominator than the max-snap proxy the model
  uses), `snap_pct`, `target_share`, `game_id`. The raw Sleeper payload in
  `metadata.stats` additionally carries `rec_rz_tgt`, `rec_ypt`, `anytime_tds`,
  `pass_rtg`, `cmp_pct`, and the `fan_pts_allow_*` defensive splits.
- `players.metadata.sleeper` is the raw Sleeper player object, and what it
  actually holds was measured in the second audit rather than read off
  Sleeper's field list. Among the 873 rostered QB, RB, WR, TE and K:
  `injury_status` is set on 125 and `depth_chart_order` on 637, which are
  real signals the engine does not read. `practice_participation` and
  `injury_start_date` are NULL on every one of the 873, so the practice
  report is NOT available from Sleeper and has to come from nflverse (2.6)
  and our own daily snapshots (3.5). `sportradar_id` and `rotowire_id` are
  set on 100 percent of players Sleeper projects; `gsis_id`, the NFL id
  every nflverse file keys on, is set on only 16 of 32 projected
  quarterbacks, 11 of 63 running backs, 18 of 96 receivers, 15 of 47 tight
  ends and 14 of 33 kickers, and `espn_id` is little better. The first draft
  said the gsis join was exact; it is not, and section 2.9 builds the
  crosswalk that makes it so. `players.external_ids` today holds only
  `sleeper`, `ktc`, `fantasycalc` and `fantasypros`.
- `player_stats` has NO `team` column. The team a player played for in a
  given week lives only in `metadata->>'team'` (populated on 100 percent of
  regular-season rows, 2020 to 2026), which is what the engine and the
  defense-splits calc already read. Every derived table in 2.6 carries `team`
  as a real column so nothing else has to reach into jsonb for it.
- `nfl_teams` already exists (abbreviation, name, conference, division,
  colours). `nfl_stadiums.home_teams` refers to its abbreviations; no second
  team master is created.
- `player_weekly_projections.metadata` from Sleeper carries `game_id` and
  `date` (kickoff date) per player-week, so a projection row already knows
  which game it is about.
- `nfl_game_odds.kickoff_at` is populated for all 272 2026 games, so kickoff
  time is already stored; only venue and roof are missing.
- The Sleeper schedule endpoint (`lib/sleeper.ts getNflHomeAwayMap`) returns
  exactly `game_id`, `week`, `date`, `status`, `home` and `away` for every
  game of the live season (fetched and checked 2026-09-27: there is no
  kickoff time, only the date), and the adapter keeps only the home and away
  map. The same call, kept whole, is the live cross-check for pairings, dates
  and game status in 2.2; kickoff time comes from nflverse alone.
- Season-long Sleeper projections and ADP live in `player_market_snapshots`
  (the old `projections` table was dropped in migration 0140), one row per
  player per night (157,108 rows for 2026 so far). They are a preseason prior
  and nothing in the weekly engine reads them; 3.2 uses them as the week-1
  share prior for players with no history. They exist for 2026 only, so the
  2020 to 2025 backtest cannot use them and 3.2 names the historical
  substitute.
- The projection rows themselves are OVERWRITTEN every night until the week
  is played: the sync upserts weeks `live..18` daily and the builder does the
  same. A stored Sleeper row for a played week is therefore Sleeper's LAST
  line before kickoff (Sunday morning's information, inactives included),
  while the walk-forward grades our model on Tuesday's information. Every
  Sleeper-against-us comparison the first plan reported has that tilt in
  Sleeper's favour, and nothing stored today can say what either source said
  on Tuesday. Section 3.10 adds the snapshot table that fixes both.

Implied team total against actual skill-position standard points, 2026 week 1,
32 team-games: correlation 0.304. Spread against actual pass rate on the 34
team-games with a line: 0.214. Small samples, right sign, consistent with the
literature: the line carries real information and a season average cannot.

### 0.6 What the research says the ceiling is

Checked rather than assumed; pages listed in Part 8.

- **Weekly projections are hard for everyone.** Eleven seasons of weekly
  projections from the major sources explain only 3 to 23 percent of the
  variance in what players score, with MAE near 6.2 QB, 5.2 RB, 4.9 WR, 3.85
  TE in PPR. Sleeper's 2025 pooled 4.116 is in line with the field. The
  realistic target for this build is a few tenths of a point pooled and a
  point or more at the positions where role information is decisive, not a
  transformation.
- **Averaging sources beats any one source.** The simple average beat
  individual sources in 63 percent of weekly head-to-heads and 69 percent of
  seasonal ones. That is the case for an ensemble with real weights rather
  than a replacement.
- **Usage predicts; efficiency predicts backwards.** Target share is the
  stickiest receiver metric year over year (r about 0.70); yards per target,
  receiving EPA and recent touchdowns correlate NEGATIVELY with next-period
  fantasy points (about -0.11 to -0.18), which means recent efficiency and
  recent touchdowns must be regressed, not extrapolated. The first build had
  this right in principle and wrong in the size and shape of the prior.
- **Neutral pace and pass rate over expectation are stable; raw plays are
  not.** Week 1 to full season R squared: 0.47 for situation-neutral pace,
  0.32 for PROE, 0.05 for raw plays per game. A season average of plays is
  the least stable of the three and it is what the model uses today.
- **Opponent effects are modest and should stay modest.** Best to worst
  matchup by position is worth about QB 1.5, RB 0.8, TE 0.8, WR 0.4 PPR;
  season-long strength of schedule and scheme metrics do not persist. The
  first build's shrunk multipliers (DEF 0.28, RB 0.29, TE 0.16, K 0.09, QB 0,
  WR 0) are the right order.
- **Wind is the one weather variable that moves totals materially.** About
  0.26 points per mph of sustained wind, with a knee near 15 mph. Cold does
  not move totals at all. Rain is modest, snow is large and rare. Domes are
  the absence of a penalty, not a bonus. The market already prices most of it
  into the total by kickoff, which is why 3.4 moves the split first.
- **Props are the strongest weekly signal that exists**, at MAE 4.96 against
  5.54 for a trailing average, and they are the one input that costs money.

Added by the second audit, from open-source weekly models with published
harnesses and from the commercial shops that disclose anything:

- **The naive baseline is closer than it looks.** A season-to-date mean
  grades at MAE 4.59 over 492,485 player-weeks (2015 to 2025); a recency
  average with a three-week half-life and prior seasons at half weight gets
  4.40 with Spearman 0.60 and a calibration slope of 0.83, with no injuries,
  lines or opponent in it at all. Walk-forward gradient-boosted models on
  nflverse land at 4.6 to 4.9 pooled (QB 6.4, RB 4.7, WR 4.5 to 4.6, TE 3.6
  to 4.9) against naive baselines of 5.2 to 5.4. Our first model's 5.27 was
  worse than the naive baseline it should have started from; version 2 is
  graded against that baseline before it is graded against Sleeper.
- **Every disclosed commercial method is the plan's shape.** PFF: volume
  first from a game projection, then efficiency from grades, then a
  distribution. ESPN's Mike Clay: team volume, then dropback, carry and
  target shares, then efficiency regressed to the mean. Yahoo's four
  partners name pace, matchups, route participation, game script, weather,
  defense adjusted for inactives, Bayesian modelling and simulation. Nobody
  publishes an error figure; the third-party benchmarks above are all there
  is.
- **Game script moves plays and carries, not shares** (3.1), **the seasonal
  calibration slopes do not apply to weekly lines** (3.8), **equal ensemble
  weights beat fitted ones more often than not** (3.7), and **efficiency
  needs far harder shrinkage than "regress toward the role"** (3.3). Each is
  written into the section it changes.
- **Rest and travel have mostly gone.** The bye-week edge is plus 0.31 points
  since the 2011 CBA and not significant (it was plus 2.21 before), London
  games leave no measurable hangover, home field is worth about 1.8 points
  and falling, and Thursday night shows a 15 percent touchdown drop on a
  19-game sample with yardage unchanged. The 3.4 table keeps short rest and
  home-in-cold as fitted terms expected near zero and adds nothing for
  travel.

### 0.7 The Sleeper question: base, ingredient, or neither

Revised 2026-09-27 after the owner asked whether the engine should generate
projections from scratch rather than sit on Sleeper's.

Today Sleeper is the base in three separate senses, and they need separating
because the answer is different for each.

1. **Sleeper defines which player-weeks exist.** The builder mirrors Sleeper's
   rows; a player Sleeper does not publish has no FF Beacon row, and a bye is
   whatever Sleeper omits. This is a dependency we should not have. The
   schedule (`nfl_games`, 2.2) says which teams play which week, the roster
   tables say who is on each team, and our availability model (3.5) says who
   is likely to play. Those three produce the row universe on their own. In
   version 2 the engine generates its own rows and Sleeper's coverage becomes
   a comparison, not a boundary.
2. **Sleeper anchors the point total.** The first build stores our total as a
   delta on Sleeper's published points, for two reasons recorded in
   `engine.ts`: the canonical scoring map had no kicker or defense keys, and
   Sleeper's published total is not the dot product of its own line. Both
   reasons dissolve once we project kickers and defenses ourselves (3.4 and
   3.4b) and define our total as the canonical dot product of OUR line. That
   is not a compromise: every league rescores the stat line under its own
   rules anyway, so the stored totals are a display convenience, and a total
   that is exactly the dot product of the stored line is more honest than one
   that is not. The anchor is removed.
3. **Sleeper is an opinion we average with.** This is the sense worth keeping,
   and the evidence is one-sided. Averaging sources beat any single source in
   63 percent of weekly head-to-heads across eleven seasons; our own
   walk-forward showed Sleeper at 4.12 MAE against our model's 5.27; and
   Sleeper's number carries something no data feed carries, which is human
   editors reading Wednesday's beat-reporter news and Friday's injury report
   and moving targets by hand. Our availability and redistribution modules
   (3.2, 3.5) reproduce most of that mechanically, and the ensemble weight is
   what says how much of the remainder is worth. Throwing away a free,
   accurate, independent opinion would make the product worse to make a
   sentence about it cleaner.

So the decision is: **the engine stands on its own and Sleeper becomes an
optional ingredient.** Concretely:

- The pure FF Beacon model is computed for every player-week the schedule and
  rosters imply, with no Sleeper input anywhere in the computation, and is
  stored under its own source, `ffbeacon-model`, for grading and for display
  on the scoreboard. It is never resolvable by a reader (the source resolver's
  allowlist stays `sleeper` and `ffbeacon`).
- The reader-facing `ffbeacon` source is the ensemble output. Its weights are
  fitted per position and per window (3.7), and `ensemble.useSleeper` is a
  switch: off, and `ffbeacon` is our model alone; on, and Sleeper enters at
  whatever weight the fit gives it, including zero.
- The scoreboard shows three columns for every position and week: Sleeper,
  our model alone, and the ensemble. That is the only way the claim "FF Beacon
  projections" can be checked by anyone, including us.
- The walk-forward backtest gains an `--independent` run that grades our model
  alone against Sleeper. That number is the honest measure of how far from
  self-sufficiency we are, and Part 6.3 adds a target for it.

What "from scratch" costs, said plainly. The published ceiling for a
data-only weekly model is roughly the market: consensus prop lines grade at
about 4.96 MAE and a trailing average at 5.54, on the pool of players who have
props. Sleeper's editors sit near the market. A well-built opportunity model
with injuries, redistribution, pace, script and role-aware efficiency should
land between those two figures within one season of fitting, which is a real
improvement on the 5.27 our first model posted and close enough to Sleeper
that the ensemble weight becomes a genuine choice rather than a rescue. It is
unlikely to beat Sleeper alone at every position in its first season, and the
plan does not promise that. What it promises is that the pure model is built,
measured and shown, and that nothing in the site breaks if Sleeper's
projections vanished tomorrow.

The reader-facing change is one label. Where a surface says which engine a
number came from (`projectionSourceDisplay`), the ensemble reads "FF Beacon"
and the settings page says what is in it.

### 0.8 Decisions recorded

Three questions the first draft left open were answered by the owner on
2026-09-27:

- **No recurring spend.** Every data source in this plan is free at our
  volume and licensed for use on a public site that carries advertising and
  takes donations. Section 2.4 and 2.7 were rewritten accordingly; the paid
  weather and props tiers are gone from the plan of record.
- **Projection settings move to `/admin/projections`**, beside the scoreboard
  that justifies them. The Power Pulse page keeps its own model's settings
  and loses the projection block.
- **Sleeper is an ingredient, not the base.** See 0.7.

A fourth was answered on 2026-09-28:

- **The Odds API replaces ESPN's scoreboard entirely.** Game lines, the line
  history and the moneyline come from The Odds API's free tier from Phase 1;
  kickoff times and pairings come from `nfl_games`; the ESPN weather note is
  dropped in favour of the real forecast; `lib/nfl-odds.ts` is deleted and
  no file in the repository names an ESPN host. The owner accepts the budget
  that implies: about 90 credits a month for daily lines and about 280 for
  the weekly props pull in Phase 7, roughly 370 of the 500 free credits, with
  a hard stop at 450 and no room for any further recurring pull. See 2.7.
- **Player props are required, not optional.** Same day. The owner's
  reasoning, recorded in their words: we should be using all pieces of
  information available to us to generate useful projections. Phase 7 is a
  required phase, migration J is required, and `useProps` turns on the moment
  T093's ablation has measured the weight it deserves. The only thing that
  can stop it is the credit stop, and 2.7 says what happens then.
- **ffopportunity is used, with one credit line and nothing more.** Same
  day, after a false start. Its data is CC BY-SA 4.0. The attribution half is
  met by one entry in the Attribution section on `/terms` (T003). The
  share-alike half applies to redistributing the data or a modified copy of
  it, and the site does neither: the rows never leave the database, nothing
  exports them, and a projection built from dozens of inputs is a new work,
  not an adaptation of their spreadsheet. On that reading, which is the
  ordinary one, the credit line is the whole obligation, and the owner
  accepts it. The FTN participation file carries the same licence and is
  treated the same way (one entry, "FTN Data via nflverse") for its offline
  use in T054. Nothing from either file is ever shown on a page or included
  in an export, which is the rule that keeps the reading true.
- **Credits live in an Attribution section on the terms page.** Same day.
  `/terms` and `/privacy` are linked from every page's footer already, and
  both CC BY 4.0 and MET Norway's terms accept attribution given through a
  linked page rather than beside every number. So the site adds one
  "Attribution" section to `/terms` (T003) naming every external source the
  engine reads, and no per-surface credit line is added anywhere else.
  The section is also where ffopportunity and FTN are credited (the bullet
  above), so every licence the engine touches is discharged on one page.

---

## Part 1. Principles this build holds to

Every principle in the first plan's Part 1 still applies (a null is never a
zero, one function applies adjustments, raw and derived side by side, stat
lines not point totals, no variance by value source, nothing per-league on a
cron, a failed request is not evidence, every coefficient measured). These are
added.

1. **A signal ships only after an ablation says so.** Every new input (weather,
   pace, vacated targets, props, anything) is added to the walk-forward
   backtest behind a switch, run with and without, and shipped only when the
   paired difference in MAE clears the bootstrap noise floor (Part 6). "It
   should help" is not a result. The first build's usage model is the proof:
   it should have helped and it measured 6.2 percent worse.
2. **Forecasts are snapshots, never overwrites.** A weather forecast and a
   betting line change until kickoff. Both are stored append-only with the
   time they were fetched, and the "latest" is a view over the history. This
   is what makes "what did we know on Tuesday" a query rather than a memory,
   and it is what the backtest needs to avoid grading a Tuesday projection
   against Sunday's information.
3. **Game facts live on the game, not on the player row.** Weather, roof,
   surface, kickoff, rest days and lines describe a game. They are stored once
   per game in `nfl_games` and its child tables and joined at build time. A
   player-week row carries a `game_key` and nothing else about the game.
4. **The environment adjusts the split before it adjusts the total.** When a
   line exists, the market has already priced the weather and the injuries
   into the total. Our weather model therefore moves how the points are made
   (pass to rush, deep to short, field goals) far more than how many points
   there are, and moves the total only in the size of the measured residual.
   Double counting a signal the market already carries is the fastest way to
   make a projection worse.
5. **Two numbers per player-week where availability is uncertain.** `expected`
   (play probability times the conditional) and `if_active` (the conditional
   alone). A lineup tool wants the second with the probability beside it; a
   season simulation wants the first. Storing only one forces every consumer
   to guess.
6. **Per-position, per-window weights.** The blend, the calibration, and every
   shrinkage prior are indexed by position and by weeks-into-season. One
   scalar for four positions is how the first build ended at zero.
7. **Only one file talks to each external host.** `lib/sleeper.ts` for Sleeper,
   `lib/odds-api.ts` for The Odds API, and new adapters `lib/nfl-weather.ts`
   and `lib/nflverse.ts` for the two new hosts. `lib/nfl-odds.ts`, the ESPN
   adapter, is deleted. The existing ESLint plugin rule that bans the Sleeper
   host outside its adapter is extended to the new hosts, and a second rule
   bans every ESPN host everywhere, so the retired dependency cannot return
   by accident.
8. **Every new table follows the metadata rule.** Ingestion tables carry a
   `metadata jsonb` with the original object. Derived tables do not.
9. **The engine runs without Sleeper.** No module under `lib/projections/`
   except `ensemble.ts` may read a Sleeper projection row, and `ensemble.ts`
   treats it as one nullable input. The row universe, the availability
   verdict and the point total are ours. A guard test
   (`lib/projections/independence.test.ts`) fails the suite if any other
   module imports the Sleeper source constant or a Sleeper row type.
10. **Nothing costs money.** Every host the engine calls is free at our volume
    and licensed for a public site with advertising. A source that changes its
    terms is replaced, not paid for, and the adapter boundary (principle 7) is
    what makes that a one-file change.

---

## Part 2. Data acquisition: what we add and where it comes from

> **Built early, 2026-10-03, for Season Pulse** (`docs/season-pulse/season-pulse-plan.md`).
> Sections 2.1 and 2.4 exist as data and display only: `nfl_stadiums`
> (migration 0336, the 38 venues on the 2026 schedule), `nfl_game_weather`
> (migration 0337), `lib/nfl-weather.ts`, `lib/sync-nfl-weather.ts` and
> `/api/cron/sync-nfl-weather`. Differences from what is written below, all
> because `nfl_games` does not exist yet: `nfl_game_weather.game_key` is the
> nflverse id but carries no foreign key, and the row also stores season,
> week and both teams; there is no `latest_weather_id`; `conditions` (text)
> stands in for `weather_code`; `surface` is not on `nfl_stadiums`; a game
> finds its stadium through the ESPN venue id on `nfl_game_odds.metadata`;
> station observations and the ISD backfill are not built. No projection
> reads this table. Tasks T036 onward are untouched.

### 2.1 Stadium and venue master: `nfl_stadiums`

A seed table, not a sync. About 45 rows: the 30 active NFL venues (two teams
share SoFi, two share MetLife), the nine 2026 international venues (Melbourne
Cricket Ground, the Maracana in Rio, Tottenham Hotspur Stadium twice,
Wembley, and the Paris, Madrid, Munich and Mexico City venues, which the NFL
release did not name and which are confirmed at seed time), and any venue a
2020 to 2025 game was played in so history joins cleanly.

Coordinates, altitude, field heading and time zone are seeded from the
greerreNFL Stadiums CSV
(`https://raw.githubusercontent.com/greerreNFL/Stadiums/main/data/stadiums.csv`,
124 rows keyed by the nflfastR `stadium_id`, with `lat`, `lon`, `altitude` in
metres, `heading` in compass degrees, and IANA `tz`). Two defects in that
file are known and worked around: its `roof_type` has only two values and
marks every retractable roof "Outdoors", and its `BUF00` row is the OLD
Highmark Stadium with a 2027 last-game date. Roof and surface are therefore
OUR columns, hand-verified for 2026 against the current stadium list, and the
new Highmark (opened 2026, Kentucky bluegrass, open air under a partial
canopy, about 200 metres from the old footprint) gets its own row. `heading`
is kept because a 15 mph crosswind and a 15 mph headwind are different
kicking conditions, and the wind direction the forecast gives us is only
useful against the field's orientation.

Venue changes to encode with effective seasons: Titans move into the enclosed
new Nissan Stadium for 2027; Jaguars play 2027 at Camping World Stadium in
Orlando and return to a renovated EverBank in 2028; Browns move to the Brook
Park dome in 2029.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | text pk | nflverse `stadium_id` where one exists (e.g. `BUF00`), else our own slug |
| `name` | text not null | |
| `city` | text | |
| `country` | text not null default `'US'` | |
| `latitude` | numeric not null | decimal degrees |
| `longitude` | numeric not null | |
| `elevation_m` | integer | Denver is the only one that matters, kept for all |
| `roof` | text not null | `outdoors`, `dome`, `retractable` (the venue's construction; the per-game state uses nflverse's `outdoors`, `open`, `closed`, `dome` on `nfl_games.roof_state`) |
| `field_heading_deg` | integer | compass orientation of the field, for crosswind against headwind |
| `surface` | text | `grass`, `fieldturf`, `sportturf`, `matrixturf`, `a_turf`, `astroturf`, `dessograss` (nflverse vocabulary) |
| `time_zone` | text not null | IANA, e.g. `America/New_York`; display still goes through `SITE_TIME_ZONE` |
| `home_teams` | text[] | teams that call it home in the current season |
| `active_from` | integer | first season |
| `active_to` | integer | last season, null when active |
| `metadata` | jsonb | source rows used to seed it |

RLS: `nfl_stadiums_select_public`, `nfl_stadiums_service_role_all`.

2026 roof classes, verified against the current stadium list: fixed roof at
the Superdome (NO), Ford Field (DET), U.S. Bank Stadium (MIN), SoFi (LAR and
LAC; a fixed canopy with open sides, which nflverse records as `dome` and
which is right for wind and rain) and Allegiant (LV); retractable at AT&T
(DAL), NRG (HOU), Lucas Oil (IND), Mercedes-Benz (ATL) and State Farm (ARI);
open air everywhere else, the new Highmark included.

No API forecasts whether a retractable roof will be open on Sunday. The rule,
stated as an assumption: a `retractable` venue is treated as CLOSED for the
forecast (no weather effect), and the backtest learns how often each one
actually played open from `nfl_games.roof_state`, which nflverse records
after the fact. If a venue turns out to play open more than half the time in
fair weather, the rule for that venue flips and the settings say so.

### 2.2 Game master: `nfl_games`

The canonical game table. Every other game-scoped table keys on it. Today the
same fact (which teams play which week, where, when) is spread across
`nfl_game_odds`, Sleeper's projection `game_id` and the Sleeper schedule
endpoint, and no table knows the venue.

Primary source is nflverse's schedule file, `games.csv`, which the nflverse
status page says refreshes every five minutes in season and which reaches
back to 1999: `https://github.com/nflverse/nfldata/raw/master/data/games.csv`
(also mirrored in the nflverse-data `schedules` release). Header, verbatim:
`game_id, season, game_type, week, gameday, weekday, gametime, away_team,
away_score, home_team, home_score, location, result, total, overtime,
old_game_id, gsis, nfl_detail_id, pfr, pff, espn, ftn, away_rest, home_rest,
away_moneyline, home_moneyline, spread_line, away_spread_odds,
home_spread_odds, total_line, under_odds, over_odds, div_game, roof, surface,
temp, wind, away_qb_id, home_qb_id, away_qb_name, home_qb_name, away_coach,
home_coach, referee, stadium_id, stadium`. `gametime` is 24-hour Eastern.
`espn` is ESPN's event id, kept in `external_ids` as provenance only, since
nothing in this plan calls an ESPN host. Verified 2026-09-27: the file holds
all 272 games of 2026. Two sign and code conventions to normalise at the
adapter: nflverse `spread_line` is POSITIVE when the home team is favoured
(ours is negative), and nflverse uses `LA` for the Rams where we use `LAR`.
The 1999 to 2025 backfill also meets the codes of relocated and renamed
franchises (`STL` to `LA` in 2016, `SD` to `LAC` in 2017, `OAK` to `LV` in
2020, and `WAS` throughout, where some feeds say `WSH`); the adapter maps
every historical code onto the CURRENT
franchise code so that a defense's history and a team's pace history follow
the franchise, and stores the code as published in `metadata`. Live
corrections (a flexed kickoff, a relocated game) are cross-checked against
the Sleeper schedule endpoint we already call, which carries `game_id`,
`date` (no time) and a per-game `status`; a pairing or date that disagrees
between the two is reported by the sync and the nflverse row wins.

| Column | Type | Notes |
| --- | --- | --- |
| `game_key` | text pk | nflverse `game_id`, e.g. `2026_04_GB_TB` |
| `season` | integer not null | |
| `season_type` | text not null | `regular`, `post`, `pre` |
| `week` | integer not null | |
| `kickoff_at` | timestamptz | from `gameday` plus `gametime` in Eastern; null when not yet scheduled |
| `home_team` | text not null | our codes (`WAS` not `WSH`, `LA` mapped to `LAR`) |
| `away_team` | text not null | |
| `stadium_id` | text references `nfl_stadiums` | |
| `neutral_site` | boolean not null default false | |
| `roof_state` | text | the roof as it was for THIS game (nflverse `roof`); overrides the stadium default |
| `surface` | text | per game, same reason |
| `home_rest_days` | integer | nflverse `home_rest` |
| `away_rest_days` | integer | |
| `div_game` | boolean | |
| `home_score` | integer | settled games only |
| `away_score` | integer | |
| `closing_spread_home` | numeric | nflverse `spread_line`, sign normalised so NEGATIVE means home favoured |
| `closing_total` | numeric | nflverse `total_line` |
| `home_moneyline` | integer | American odds |
| `away_moneyline` | integer | |
| `recorded_temp_f` | integer | nflverse `temp`, outdoor games only, kickoff conditions |
| `recorded_wind_mph` | integer | nflverse `wind` |
| `external_ids` | jsonb | `{ "espn": "...", "gsis": "...", "pfr": "...", "sleeper": "202610433", "odds_api": "<event id>" }`; the Odds API event is matched on (kickoff date, home, away) at first sight and its id stored so every later pull joins on it |
| `metadata` | jsonb | the nflverse row verbatim |
| `synced_at` | timestamptz not null default now() | |

Unique on `(season, season_type, week, home_team)`. Indexed on
`(season, season_type, week)` and on `kickoff_at`.
RLS: `nfl_games_select_public`, `nfl_games_service_role_all`.

Why the closing lines and the recorded weather are here: they are what makes
Part 6's backtest able to include the environment for 2020 through 2025, which
the first build could not do. nflverse's `spread_line` and `total_line` are
CLOSING lines sourced from Pro-Football-Reference, and on the audit day the
week 4 rows were still blank four days before kickoff while every week 3 row
was filled, so the file is a settled record and never a live line: the live
line stays with the odds sync (2.3). Closing lines are slightly generous to a
Tuesday-morning projection (they know Sunday's inactives), and the backtest
report states that in its footer rather than hiding it. Where the odds history
in 2.3 has a Tuesday snapshot (2026 onward), the backtest uses that instead.

The Sleeper `game_id` (`202610433` style) is mapped onto `game_key` by
(season, week, home, away) at sync time and stored in `external_ids.sleeper`,
so a projection row's `game_id` resolves to a game with one join.

### 2.3 Line history: `nfl_game_odds_history`

Append-only. One row per (game, source, provider, fetch). The existing
`nfl_game_odds` row keeps its meaning as "the latest line" and gains
`game_key`. From Phase 1 both tables are fed by The Odds API (2.7), and the
ESPN rows already stored for 2026 weeks 1 to 5 are kept as history under
`source = 'espn'`, never refreshed, so the September lines are not lost.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid pk | |
| `game_key` | text not null references `nfl_games` | |
| `source` | text not null | `the-odds-api` (rows written before Phase 1 say `espn`) |
| `provider` | text | `consensus` for the median across the books returned, which is the row the engine reads; one further row per book, named by its Odds API key, when `oddsApi.storePerBook` is on (off by default, to keep the table small) |
| `fetched_at` | timestamptz not null | |
| `hours_to_kickoff` | numeric | derived at write, for lead-time analysis |
| `game_total` | numeric | |
| `home_spread` | numeric | negative means home favoured |
| `home_moneyline` | integer | American odds; the win-probability input for 3.1 |
| `away_moneyline` | integer | |
| `metadata` | jsonb | the Odds API event object, bookmakers included, verbatim |

Unique on `(game_key, source, provider, fetched_at)`. RLS: public select,
service-role write. The sync writes a history row on every run in which any
of total, spread or moneyline changed from the last stored row (so a quiet
week costs one row per game, not one per day), and always writes one at first
sight. The `nfl_game_odds` "latest" row is the consensus row, and
`describeEnvironment` reads it and nothing else.

`fetched_at` on `nfl_game_odds` is set on every upsert (the 0.4 defect), which
the rewritten sync does from its first run.

### 2.4 Weather forecasts: `nfl_game_weather`

Append-only snapshots, one per (game, provider, fetch). The forecast for the
kickoff hour and the two hours after it, because a game lasts three hours and
a front can arrive in the second half.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid pk | |
| `game_key` | text not null references `nfl_games` | |
| `provider` | text not null | `nws`, `met-norway` (forecasts); `nws-observation`, `noaa-isd` (what actually happened, `lead_hours` 0) |
| `fetched_at` | timestamptz not null | |
| `lead_hours` | numeric not null | kickoff minus fetched_at, in hours |
| `is_indoor` | boolean not null | roof_state in (`dome`, `closed`) at fetch time; when true every weather column is null and the row exists only to say so |
| `temp_f` | numeric | at kickoff |
| `feels_like_f` | numeric | apparent temperature |
| `wind_mph` | numeric | sustained, 10 m, at kickoff |
| `wind_gust_mph` | numeric | max gust over the game window |
| `wind_dir_deg` | integer | meteorological degrees |
| `wind_mph_max_3h` | numeric | max sustained over kickoff plus 3 h |
| `precip_prob_pct` | integer | probability of precipitation over the window |
| `precip_in` | numeric | expected liquid over the window |
| `snow_in` | numeric | expected snowfall over the window |
| `humidity_pct` | integer | |
| `weather_code` | integer | WMO code from the provider |
| `metadata` | jsonb | the provider's hourly slice, verbatim |

Unique on `(game_key, provider, fetched_at)`. Index on `(game_key, fetched_at desc)`.
RLS: `nfl_game_weather_select_public`, `nfl_game_weather_service_role_all`.

A view `nfl_game_weather_latest` (or a `latest_weather_id` column on
`nfl_games` maintained by the sync; the column is simpler for PostgREST reads
and is what the plan specifies) exposes the newest snapshot per game.

**Provider choice.** Zero cost, and every licence checked for a public site
that carries advertising and takes donations (which is commercial use under
every provider's terms). Seven candidates were evaluated and three of them
were probed live on 2026-09-27; Part 8 lists the pages. The decision:

- **Primary for the 263 US games: the National Weather Service API**
  (`https://api.weather.gov`). Public domain ("free to use for any purpose",
  per the NWS documentation and disclaimer), no key, no card. Identification
  is a `User-Agent` naming the site and a contact address. Flow: `GET
  /points/{lat},{lon}` once per stadium (cached, re-checked monthly because
  grid coordinates can move) returns the office and grid; `GET
  /gridpoints/{office}/{x},{y}` (`forecastGridData`) returns time-series
  layers over about 7.5 days including `temperature` (C), `windSpeed` and
  `windGust` (km/h), `probabilityOfPrecipitation` (percent, 3-hour then
  6-hour blocks), `quantitativePrecipitation` (mm, 6-hour blocks, about 3 days
  out), `snowfallAmount` and `relativeHumidity`, each as runs with ISO 8601
  `validTime` intervals that the adapter expands. `forecastHourly` (156
  hourly periods, verified live) supplies the hourly temperature, wind speed
  and precipitation probability at kickoff for the sentence on the page. Rate
  limits are "reasonable" and undisclosed; a 429 is retried once after five
  seconds and `Cache-Control` is honoured. Every weather variable in the table
  above is available from this one source for every US venue.
- **For the nine international games: MET Norway Locationforecast 2.0**
  (`https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=&lon=&altitude=`).
  Licensed under NLOD 2.0 and CC BY 4.0, which permit use "for any purpose
  and in all contexts" with attribution; the credit is an entry in the
  Attribution section on `/terms` (T003) reading "Weather data from MET
  Norway" with a link, which their terms accept in place of a per-page line. Identification by `User-Agent` with a contact
  address (a generic one gets a 403 and a faked one a permanent block). Global
  coverage from the 9 km ECMWF model, updated four times a day, 9 to 10 days
  out; hourly for about 60 hours and 6-hourly after that (measured live: 64
  hourly steps for MetLife Stadium). Variables outside the Nordic region are
  `air_temperature`, `wind_speed`, `wind_from_direction`, `relative_humidity`
  and `precipitation_amount`; there is NO gust and NO precipitation
  probability for non-Nordic points, so those two columns are null for
  international games and the effects that need them are not applied there.
  Rules: under 20 requests a second, `If-Modified-Since` with the previous
  `Last-Modified`, respect `Expires` (about 30 minutes), truncate coordinates
  to four decimals.
- **No ESPN weather note.** The retired scoreboard payload carried a
  temperature and a condition with no stated provider. It goes with the
  adapter; the forecast above is the only weather the site reads.
- **Not chosen, and why.** Open-Meteo has the best feed (hourly gusts and
  precipitation probability worldwide) but its free tier is non-commercial
  only, its terms name advertising and subscriptions as commercial, and the
  cheapest commercial plan is 120 US dollars a month on the live pricing
  page. Visual Crossing's free tier DOES permit commercial use (1,000 records
  a day, attribution required, raw numbers may not be re-exposed through our
  own API or downloads); it is the documented alternative if MET Norway's
  missing gusts ever matter for an international game, and needs a key.
  Tomorrow.io stops at 5 days free. OpenWeatherMap has no hourly data past 48
  hours. ECMWF open data, DWD ICON and Environment Canada are all free and
  commercial-friendly but are GRIB2 files needing a decode-and-regrid
  pipeline, with 3-hourly or coarser steps: feasible, not worth it for 16
  games a week. SportsGameOdds and NFLweather.com are covered in 2.7 and 2.8.
- **Lead-time error is measured from our own history.** Every nightly
  snapshot is a forecast at a known lead. Once a game is played, the NOAA
  station observation (2.5) or the National Weather Service's own
  observations (`/stations/{id}/observations`, about five days of history) is
  the truth. Eight weeks of snapshots give about 900 forecast-against-actual
  pairs at every lead from one to seven days, which is what fits the damping
  curve in 3.4. Until then the published prior stands.

**Fetch policy.** Two requests per outdoor or retractable-roof US game per run
(grid data plus hourly) and one per international game. Domes are written as
an `is_indoor` row without a provider call. Games beyond the provider's
horizon (about 7 days on the National Weather Service, 9 on MET Norway) are
skipped, not defaulted; since the lead-time damping makes a forecast beyond
seven days nearly weightless anyway, the horizon costs the model nothing.
Nightly at 13:45 UTC, after the odds sync (13:15) and before the projection
build (14:30), so a build always sees the same morning's line and forecast.
Three short game-day refreshes (12:15, 15:00 and 21:00 UTC, each
self-skipping when no game kicks off inside its horizon; the schedule and the
reasons are in 4.4) refresh the current day's games only; forecast skill
inside 24 hours is materially better than at 5 days and game-morning lineup
decisions are the ones the site is for. All runs are the same cron route with
a `scope` parameter, one entry each in `vercel.json`, registered in the
cron-runs registry so cron-health pages on a failed night.

**Failure posture.** A provider request that fails leaves the previous
snapshot as the latest and writes nothing; the run reports `failedGames` and
throws only when every targeted game failed, exactly the rule
`runNflOddsSync` follows. A game with no snapshot inside its horizon gets no
weather adjustment, and `weatherApplied: false` is carried on the projection
row's metadata so a reader can tell "calm" from "unknown".

### 2.5 Historical weather for the backtest: one-time backfill

The weather effect coefficients in 3.4 are fitted on 2020 through 2025, which
needs the weather that actually happened at every outdoor game. Two sources,
cross-checked:

- nflverse `games.temp` and `games.wind` (kickoff readings, outdoor games
  only), already landing in `nfl_games` through 2.2.
- NOAA's Integrated Surface Database (ISD), the hourly observation record
  from every airport weather station in the world, public domain, no key.
  Station lookup: `https://www.ncei.noaa.gov/pub/data/noaa/isd-history.csv`
  (USAF, WBAN, ICAO, latitude, longitude, begin and end dates); the adapter
  picks the nearest active station to each stadium by haversine (Teterboro
  for MetLife, O'Hare for Soldier Field, and so on; almost every venue has
  an ASOS station inside 15 km) and stores the choice on `nfl_stadiums.
  metadata`. Data: the Access Data Service,
  `https://www.ncei.noaa.gov/access/services/data/v1?dataset=global-hourly&stations={USAF}{WBAN}&startDate=2020-01-01&endDate=2025-12-31&dataTypes=WND,TMP,OC1,AA1&format=csv`,
  verified live to return a six-year single-station pull (74,757 rows, 7.8 MB)
  in one call. Fields: `WND` is direction, quality, type, speed in tenths of
  a metre per second, quality; `TMP` is tenths of a degree Celsius; `OC1` is
  gust in tenths of a metre per second, present only when a gust was
  reported; `AA1` is period hours, depth in tenths of a millimetre, condition,
  quality. Rows with quality codes other than 0, 1, 4 or 5 are dropped. The
  yearly CSV files at `https://www.ncei.noaa.gov/data/global-hourly/access/{year}/{USAF}{WBAN}.csv`
  are the fallback when the service is slow. ISD is global, so the London,
  Munich, Frankfurt and Sao Paulo games in the history are covered too.

Script `scripts/backfill-nfl-weather.ts`, `npm run backfill:weather`, writes
`nfl_game_weather` rows with `provider = 'noaa-isd'` and `lead_hours = 0`,
taking the observation nearest kickoff and the maximum wind and gust over the
following three hours. About 45 station pulls cover every outdoor game from
2020 to 2025. Per the backfill rule in CLAUDE.md it is idempotent on the
unique key and never scheduled. A second source for cross-checking 2020 only
is the Bliss WeatherData set (station observations matched to games 2000 to
2020); it is used to validate, not to load.

### 2.6 nflverse ingestion: `lib/nflverse.ts`

nflverse (nflreadr, nflfastR) publishes its datasets as GitHub release assets,
CSV, gzipped CSV and parquet, rebuilt nightly in season, no key, no auth,
plain HTTPS, under CC BY 4.0 (`nflverse-data` LICENSE.md, checked
2026-09-27), so the Attribution section on `/terms` (T003) carries "Data
from nflverse" with the licence named and linked and a note that we
aggregate it, which is what CC BY 4.0 asks for and accepts through a linked
page. Every player row carries `gsis_id`, and the join to our
`players` table goes through the crosswalk in 2.9, because Sleeper's own
`gsis_id` covers a minority of the players we project (0.5). The adapter
follows the `lib/sleeper.ts` pattern: 20-second timeouts, null on failure,
never throws, the same 32 MB streamed byte cap `safeFetch` enforces, a
conditional request (`If-None-Match` against the stored ETag, so an unchanged
asset costs one 304), and it is the only file allowed to name the host.

Every file below was fetched on 2026-09-27 and its header read; the sizes
and formats are measured, not quoted. Datasets, in the order they pay off:

| Dataset | Release asset (measured 2026-09-27) | What it gives the model | Phase |
| --- | --- | --- | --- |
| Schedules | `nfldata` `games.csv` (2.2), about 5 MB for 1999 to 2026, 272 rows for 2026 present | `nfl_games`, closing lines, roof, surface, rest, recorded weather; refreshed every 5 minutes in season | 2 |
| Weekly rosters | `weekly_rosters/roster_weekly_{season}.csv` (one row per team, week and player; columns include `team`, `position`, `depth_chart_position`, `status` (`ACT`, `RES`, `PUP`, `DEV`, `CUT` and so on), `gsis_id`, `espn_id`, `sportradar_id`, `yahoo_id`, `rotowire_id`, `pff_id`, `pfr_id`, `sleeper_id`, `draft_club`, `draft_number`, `entry_year`) | Three things at once: the identity crosswalk (2.9), the roster status that decides the row universe (3.0), and the HISTORICAL team and status of every player in every week, which is what the backtest needs to rebuild the row universe for 2020 to 2025 without Sleeper. About 2 MB a season | 2 |
| Weekly player stats | `stats_player/stats_player_week_{season}.csv` (the successor to `player_stats_{season}`; about 3 MB a season) | per player-week, keyed by gsis: `targets`, `receiving_air_yards`, `target_share`, `air_yards_share`, `wopr`, `racr`, `receiving_epa`, `rushing_epa`, `passing_epa`, `passing_cpoe`, `pacr`, first downs by family, 2-point conversions by family, `receiving_10/16/20/40` and `rushing_10/12/20/40` gain buckets, fumbles by family, kicking by distance band (`fg_made_0_19` to `fg_made_60_`, `fg_missed_*`, `pat_*`), return yards, `special_teams_tds`. Cross-checks Sleeper's `player_stats` and supplies the air-yards share and EPA the engine has never had | 4 |
| Weekly team stats | `stats_team/stats_team_week_{season}.csv` | the same families at team level, per game, including `attempts`, `carries`, `passing_air_yards`, first downs and 2-point tries. Team volume history without touching pbp; pace, PROE and red zone trips still need pbp | 4 |
| Expected fantasy points | ffopportunity `ffverse/ffopportunity` releases `latest-data` and `v1.0.0-data`, `ep_weekly_{season}.csv` or `.parquet` (632 KB CSV, 210 KB parquet for 2026 on 2026-09-27; weeks 1 and 2 complete and the Thursday game of week 3 present). Its workflow runs Sunday 22:15, Monday 00:20, Monday and Tuesday 05:45 and Friday 05:45 UTC, September to February, so the Sunday games are in by Tuesday morning and the Monday game by Friday | per player-week, keyed by gsis: expected receptions, receiving, rushing and passing yards, touchdowns, first downs, 2-point conversions and interceptions from play-level probability models (`*_exp`, an xgboost fit on 2006 to 2020 pbp), the actuals beside them (`*_diff`), the team totals, and `total_fantasy_points_exp`. A RETROSPECTIVE measure of what each opportunity was worth, which is exactly the efficiency input 3.3 wants; it is not a forward projection and does not replace one. Licence: the code is GPL-3.0 (neither ported nor linked) and the models and data are CC BY-SA 4.0, discharged by one entry in the Attribution section on `/terms` (0.8, T003); the rows are read as a feature and are never shown on a page or exported. Our own simpler pbp-derived figure (T051b) sits beside it as a cross-check and as the fallback if the release ever stops | 4 |
| Weekly injuries | `injuries/injuries_{season}.csv` (83 KB plain, 14 KB gzipped for 2026 on 2026-09-27; the workflow cron is 07:07 UTC and the file landed at 12:57 UTC on the audit day). Columns: `season`, `season_type`, `game_type`, `team`, `week`, `gsis_id`, `position`, `report_primary_injury`, `report_secondary_injury`, `report_status` (Out, Doubtful, Questionable, or blank), `practice_primary_injury`, `practice_secondary_injury`, `practice_status` (Did Not Participate, Limited, Full) | ONE row per listed player per week carrying the LATEST practice status and the game designation. There is NO Wednesday, Thursday, Friday breakdown in this file and no `date_modified` in 2025 or 2026: nflverse switched the source to the NFL's own API through `nflapi` on 2026-08-06 (nflverse-rosters PR 96), rebuilt 2025 under it on 2026-09-07, and closed the request to restore the timestamp as not planned (issue 100). 2023 and earlier still carry `date_modified`. The daily PATTERN therefore only exists if WE snapshot the file every day, which 3.5 does from Phase 5 on; history from 2009 supports a fit on the final designation plus the last practice status, and the pattern refinement is fitted on our own snapshots after a season | 5 |
| Depth charts | `depth_charts/depth_charts_{season}.{csv,csv.gz,parquet}`. FORMAT AND PROVIDER CHANGED after 2024: 2024 and earlier are weekly rows (`club_code`, `week`, `depth_team`, `depth_position`, `gsis_id`; about 3 MB a season); 2025 and 2026 are ESPN DAILY SNAPSHOTS appended to one file, keyed by `dt` with `espn_id`, `gsis_id`, `pos_grp`, `pos_slot`, `pos_rank` and no week column ("from 2025 onwards, depth charts are not assigned a week"). 54 MB plain CSV after three weeks of 2026, 11 MB gzipped, 2.6 MB parquet; the full 2025 file is 53 MB plain and 10.6 MB gzipped. Refreshed 07:07 UTC | Historical starter identification for the redistribution fit, used in the ONE-TIME backfill (weekly file through 2024, the last snapshot before each week's first kickoff for 2025). In season the live depth chart comes from Sleeper's `depth_chart_order` and `depth_chart_position` (on 637 of 873 rostered skill players) and nflverse `weekly_rosters.depth_chart_position`, both snapshotted nightly into `player_week_availability` (3.5). The gzipped ESPN file fits the adapter cap and may be read weekly as a cross-check of Sleeper's order, but only the newest `dt` per team is kept and nothing nightly depends on it | 4 (backfill) |
| Next Gen Stats | `nextgen_stats/ngs_receiving.csv.gz`, `ngs_passing.csv.gz`, `ngs_rushing.csv.gz` (one file per type, ALL seasons from 2016, week 0 rows are season summaries, only players above a minimum attempt threshold; nightly 3 to 5 AM Eastern) | receiving: `avg_intended_air_yards`, `avg_separation`, `catch_percentage`, `avg_yac_above_expectation`; passing: `avg_time_to_throw`, `aggressiveness`, `completion_percentage_above_expectation`; rushing: `efficiency`, `rush_yards_over_expected`. Role priors; the GWTTKB study finds these predict future fantasy points weakly on their own, so they condition the shrinkage prior rather than enter the line directly | 4 |
| Play by play | `pbp/play_by_play_{season}.csv.gz` (2.8 MB after three weeks of 2026, about 17 MB gzipped at 18 weeks, so inside the cap; nightly plus game-day runs, corrections on Thursdays) | red zone and goal-to-go targets and carries, `xpass` (for pass rate over expectation), neutral-situation seconds per play, two-minute and garbage-time flags, target depth distribution, `xyac`, `cp`. Everything the two aggregate files above do not carry | 4 (derived tables only; the raw file is never stored) |
| Snap counts | `snap_counts/snap_counts_{season}.csv.gz` (every 6 hours) | PFR snap counts, `offense_pct`. Cross-check for Sleeper's `off_snp`; not a new signal | 4 (validation only) |
| PFR advanced stats | `pfr_advstats/advstats_week_{pass,rush,rec}_{season}.csv.gz` (2018 onward) | drops, bad throws, broken tackles, yards before contact | 4 (optional conditioning inputs) |
| Participation | `pbp_participation/pbp_participation_{season}.csv` (2016 through 2025, post-season FTN deliveries, about 21 MB a season; CC BY-SA, credited as "FTN Data via nflverse" in the Attribution section) | offense players on the field per play, the only free source of routes run. NOT AVAILABLE IN SEASON: the NFL stopped the feed during 2023 and FTN now supplies it only after the postseason. Routes therefore stay null in the live model, snap share times team pass rate is the proxy, and the file is used only for offseason validation of that proxy on 2016 to 2025 (T054). Never stored, never shown | offseason only |
| Player id crosswalk | DynastyProcess `db_playerids.csv` (already fetched nightly by `lib/sync-dynastyprocess.ts` and `lib/sync-rookie-adp.ts`, which read only two of its columns) | `sleeper_id`, `gsis_id`, `sportradar_id`, `espn_id`, `pfr_id`, `pff_id`, `yahoo_id`, `fantasypros_id`, `ktc_id`, `mfl_id` side by side. The second leg of the crosswalk in 2.9 | 2 |

Storage rule: raw nflverse files are fetched, aggregated in the script, and
only the aggregates are stored (weekly per-player and per-team derived rows).
Play by play is about 48,000 rows a season and is processed in a stream, never
inserted. This is the one place the metadata-preservation rule is deliberately
not applied to the raw file, because the raw file is a public, versioned,
retrievable release asset (the same reasoning the donations exception uses:
a system of record we can read back on demand). The aggregate rows carry the
release tag, the asset's `Last-Modified` and its ETag in their `metadata` so a
re-derivation can name what it read.

Where the work runs. Every in-season file above is under 20 MB gzipped (the
whole nightly set is about 20 MB in September and about 40 MB in January,
dominated by play by play at 19 MB and the depth chart file at 11 MB), and
every nightly job fits the 300-second ceiling the existing crons export;
Vercel Pro allows `maxDuration` up to 800 seconds with Fluid compute if a
job ever needs it, and the function's 4.5 MB body limit applies to request
and response bodies, not to outbound downloads. So the schedule in 4.4 stays
on Vercel. The large plain-CSV variants (54 MB depth charts, 49 MB
participation, 98 MB play by play) are never fetched; the adapter always
takes the gzipped or parquet asset and streams it, and every release also
publishes a `timestamp.json` that is a cheaper freshness probe than a HEAD.
The one-time backfills run from a developer machine like every other
`npm run backfill:*`. If a future season pushes a nightly file over the cap,
the repository is public (`github.com/mjwalsh1988/ffbeacon`, checked
2026-09-27), so a scheduled GitHub Actions workflow (free for public
repositories, automatically disabled after 60 days without a commit) can run
the same `lib/sync-nflverse-weekly.ts` entry point with the service key from
a repository secret and upsert the same tables; the code does not change,
only where it runs. That is the escape hatch, recorded so nobody rebuilds the
pipeline to find it.

New derived tables from nflverse (all service-role write, public select):

- `nfl_team_week_tendencies`: per (season, week, team): plays, neutral-script
  seconds per play, pass rate, pass rate over expectation, red zone trips,
  goal-to-go plays, and the opponent-induced versions (what this DEFENSE made
  offenses do). Feeds 3.1.
- `player_week_opportunity`: per (season, week, player): targets, air yards,
  aDOT, red zone targets, goal-to-go targets, carries, red zone carries,
  goal-to-go carries, routes (when participation exists, else null), snaps,
  expected fantasy points from the pbp model (3.3). Feeds 3.2 and 3.3.
- `player_week_availability`: per (season, week, player): Wed, Thu, Fri
  practice status, Friday designation, whether he played, snaps if so. Feeds
  3.5.

### 2.7 Game lines and player prop markets: The Odds API

The Odds API is the ONLY betting-market source in this plan. It supplies the
game lines from Phase 1 (replacing ESPN's scoreboard outright, by the owner's
decision of 2026-09-28) and the player props in Phase 7. One adapter,
`lib/odds-api.ts`, one key, one credit budget.

**The free tier** (`https://the-odds-api.com`, v4, 500 credits a month, an
account and a key, no card). Its terms permit "displaying our data in a UI,
website, or mobile app, including for commercial use", "calculating and
displaying values you derive from our data" and "storing our data and
retaining it indefinitely", written without reference to plan (terms last
updated 2026-08-31, re-read on the audit day), and forbid only redistribution
as a standalone data product. Attribution is appreciated, not required.
Historical odds are paid-plan only per the API guide, whatever the homepage
plan table suggests, and the free plan publishes no rate limit (a 429 is
retried once).

**Game lines, Phase 1, required.** One request a day,
`GET /v4/sports/americanfootball_nfl/odds?regions=us&markets=spreads,totals,h2h`,
returns every upcoming game with several books for 3 credits, about 90
credits a month. The consensus line is the MEDIAN across the books returned,
which is what `nfl_game_odds` stores and the engine reads; `home_spread` is
normalised so negative means home favoured, the implied team totals are
derived exactly as today, and the moneyline (`h2h`) becomes the
win-probability input 3.1 wanted and ESPN never gave us. The daily pull runs
at 13:15 UTC, which on Sunday is 9:15 Eastern, so the Sunday-morning line is
already captured by the daily run and no game-day pull is needed; the one
game a week it does not cover well is a 9:30 Eastern international kickoff,
which gets Saturday's line, and 3.4's lead-time damping already treats that
line as a day old. Each event is matched to `nfl_games` on (kickoff date,
home, away) at first sight and its Odds API event id stored in
`external_ids.odds_api`, so every later pull joins on the id. A request that
fails leaves the previous line as the latest and writes nothing; the run
throws only when every game failed, the rule the current sync follows.

**Player props, Phase 7, required (owner's decision of 2026-09-28: every
piece of information available goes into the number).** Props are the most
informed weekly
forecast that exists for the top 150 to 200 players: the GWTTKB study
measured market consensus lines at a week-to-week MAE of 4.96 against 5.54
for a trailing five-game average, and early-season lines predicted
rest-of-season output at r 0.83 against 0.73 to 0.75 for prior-year
production. Props are per event:
`GET /v4/sports/americanfootball_nfl/events/{eventId}/odds?regions=us&markets=...`,
costing markets times regions credits per event. The plan reads FOUR markets
(`player_anytime_td`, `player_reception_yds`, `player_rush_yds`,
`player_pass_yds`) for the week's events ONCE, on Saturday, for 64 credits a
week and about 280 a month. Historical odds cost ten times as much, so the
backtest uses the weeks collected from the day props are turned on and states
its window.

**The budget, and why it is full.** Daily lines about 90 plus weekly props
about 280 is about 370 of the 500 free credits. `lib/odds-api.ts` keeps a
running count in the cron-runs result and stops hard at
`oddsApi.monthlyCreditStop` (450) in a calendar month, so the allowance is
never exceeded; when the stop is hit, lines keep their last value, props are
skipped for the rest of the month, and cron-health says so. The owner has
accepted this budget on the understanding that it leaves no room for any
further recurring pull: no per-book history, no second daily lines pull, no
fifth prop market, without either dropping something or moving to a paid
plan, which the zero-cost rule forbids. Anyone proposing a new call against
this host adds it to this paragraph's arithmetic first.

**Not used: SportsGameOdds.** Its free "Amateur" tier includes NFL props, but
its terms describe the free tier as "intended for genuine evaluation only",
which a public site does not satisfy. Scraping a sportsbook's own site is
forbidden by every book's terms and is not planned.

**Storage**: `player_prop_lines` (append-only snapshots): `game_key`,
`player_id`, `market`, `book`, `line`, `over_price`, `under_price`,
`fetched_at`, `metadata`. Unique on `(game_key, player_id, market, book,
fetched_at)`. Public select, service-role write.

**Translation** in `lib/projections/props.ts` (pure): de-vig the over and
under to a fair probability, read the line as the median, convert median to
mean with a per-market skew fitted on our own actuals (yardage is
right-skewed, so the mean sits above the median by an amount that grows with
the line), and for anytime touchdown convert the de-vigged probability to
expected touchdowns through the power method. The output is a partial stat
line in Sleeper's vocabulary that enters the ensemble as the `props` source
where a market exists and is absent where it does not.

Phase 7 is the only phase that depends on the props feed, and it costs
nothing.

### 2.8 What is deliberately not ingested

- **No scraping of sites that forbid it.** Pro Football Reference's terms
  prohibit automated access; everything we want from it is in nflverse's
  releases. No FantasyPros (its production keys are personal, non-commercial;
  the commercial tier is custom-priced), no RotoWire.
- **Nothing from ESPN, at all.** ESPN's fantasy endpoint
  (`lm-api-reads.fantasy.espn.com`, `view=kona_player_info`) was verified
  live on 2026-09-27 to return weekly projected points per player, which
  would make it a free third projection source. It is not used, because the
  Disney Terms of Use that govern ESPN prohibit automated access ("access,
  monitor, copy or extract ... using a robot, spider, script, or other
  automated means"), prohibit commercial use, and reserve the products for
  "personal, noncommercial use". The same terms govern the ESPN scoreboard
  that `lib/nfl-odds.ts` has read for game lines since September 1, an
  existing exposure this review surfaced rather than created. On 2026-09-28
  the owner decided to end it: game lines move to The Odds API's free tier
  (2.7) in Phase 1, kickoff times and pairings to `nfl_games`, the ESPN
  weather note is dropped, `lib/nfl-odds.ts` is deleted, and a lint rule bans
  every ESPN host from the repository (T012). The ESPN rows already in
  `nfl_game_odds` stay as history and are never refreshed.
- **No second consensus projection at launch.** Aggregation research says a
  third source would help, but every free one is either scraped or licensed
  for personal use. The slot exists in the ensemble (3.7) for when one is
  licensed; the props line partly fills it.
- **NFLweather.com** publishes forecasts that its terms allow anyone to
  republish with attribution, has no `Disallow` in its robots file, and
  offers no API. It does not disclose its upstream provider, so republishing
  its numbers would mean inheriting an unknown licence. It is not a data
  source here; the National Weather Service gives us the same numbers at the
  origin.
- **No live in-game data.** Projections are set before kickoff; the Lineups
  page's live phase reads Sleeper's actuals.

### 2.9 Player identity: the crosswalk every nflverse join stands on

The first draft assumed `players.metadata.sleeper.gsis_id` covered every
player. Measured on 2026-09-27 it covers 16 of the 32 quarterbacks Sleeper
projects for week 4, 11 of 63 running backs, 18 of 96 receivers, 15 of 47
tight ends and 14 of 33 kickers. Every nflverse file (rosters, stats,
injuries, depth charts, Next Gen Stats, play by play) is keyed by gsis, so
without a crosswalk Phase 4 and Phase 5 would silently model a third of the
league and mirror the rest. This is the single largest hole the audit found,
and it is closed before any nflverse-fed table is built.

Two free crosswalks cover it, and both are already reachable:

1. **nflverse weekly rosters** (`roster_weekly_{season}.csv`) carry
   `sleeper_id`, `sportradar_id`, `espn_id`, `yahoo_id`, `rotowire_id`,
   `pfr_id`, `pff_id` and `gsis_id` on the same row. Sleeper sets
   `sportradar_id` and `rotowire_id` on 100 percent of the players it
   projects, so a player with no `sleeper_id` in nflverse's row still joins
   on `sportradar_id`.
2. **DynastyProcess `db_playerids.csv`**, which `lib/sync-dynastyprocess.ts`
   already downloads nightly and reads two columns of, carries `sleeper_id`,
   `gsis_id`, `sportradar_id`, `espn_id`, `pfr_id` and `ktc_id` together.

`lib/player-identity.ts` (pure) resolves a `players` row to a gsis id in this
order and records which leg matched: Sleeper's own `gsis_id`, nflverse's
`sleeper_id`, DynastyProcess's `sleeper_id`, then `sportradar_id` through
either file, then `espn_id`, and last a normalised name plus team plus
position match that is written only when it is unique and is flagged
`identity_match: 'name'` so a reviewer can see it. The result is written into
`players.external_ids` as `gsis`, `espn`, `pfr` and `sportradar` keys (the
column already holds `sleeper`, `ktc`, `fantasycalc` and `fantasypros`, and
the Data Architecture rule puts external identifiers exactly there; no
migration is needed). `lib/sync-player-identity.ts` runs after
`sync-sleeper-players` each morning, and its cron-runs result reports
coverage per position among the players Sleeper projects that week. Coverage
under 98 percent at QB, RB, WR, TE or K is a cron-health fault, because a
missing id is a player the engine silently cannot see.

Team defenses need no crosswalk: their `sleeper_player_id` IS the team code.

---

## Part 3. The model, version 2

The shape that stays: a component stat line in Sleeper's key vocabulary
(because that is the vocabulary every league's `scoring_settings` uses, not
because Sleeper is involved), stored in `player_weekly_projections`, read
through `projectPlayerWeek`. Every module below is pure and lives in
`lib/projections/`.

What changes: the engine builds its own row universe, its own availability
verdict and its own point totals, and Sleeper enters only at the ensemble.

### 3.0 The row universe and the totals, without Sleeper

**The window.** The live week through week 18, every night, exactly as the
Sleeper sync and today's builder already do (both write `live..18`; 38,255
rows per source for 2026 as of this audit). This is not optional: Power
Pulse, Positional WAR, Trade Impact, FAAB, the cut list, On The Clock and the
Breakdown all sum projections across the remaining weeks, and every one of
them treats a missing week as absent rather than zero, so an engine that
wrote only the current week would quietly shorten every season simulation on
the site. Rows for weeks already played are never deleted (several readers,
the player profile and BEAM among them, open a window at week 1 and the
source resolver counts coverage over it).

**Horizon policy.** The inputs do not all reach 18 weeks, and a row must say
what it did not know. A line exists for the current week plus two (three with
The Odds API); a forecast reaches about seven days; an injury designation
describes one game. So: the environment multiplier set is neutral beyond the
last stored line, the weather multiplier set is neutral beyond the forecast
horizon (`weatherApplied: false`), and availability for a future week is the
return-probability curve in 3.5, never this week's designation carried
forward and never an assumed full recovery. Each row's `metadata.inputs`
records which of `line`, `weather`, `injury_report`, `depth_chart` and
`props` were present when it was built, so the scoreboard can grade "rows
built with a line" apart from "rows built without one".

**Rows.** For each game in `nfl_games` in the window, and each player on
either team at a projectable position (QB, RB, WR, TE, K, plus one DEF row
per team), the engine produces exactly one row. Who is "on a team" is decided
by nflverse's weekly roster `status` (active, reserve, physically unable to
perform, practice squad, and so on) joined through the crosswalk in 2.9, with
Sleeper's `players.team` as the fallback for a player nflverse has not listed
yet; a practice squad player gets no row unless Sleeper projects him, in
which case the ensemble carries Sleeper's row through (below). A team on a
bye has no game and so no rows, which is the same "a bye is absent" rule as
today, now derived from the schedule instead of inferred from Sleeper's
silence. A player whose play probability (3.5) is below
`availability.outThreshold` (default 0.10) is written as `availability: 'out'`
with a real zero, matching the existing taxonomy; a player between the
thresholds is `projected` with `metadata.play_probability` carrying the
uncertainty; a player with no team gets no row.

**Positions the model does not cover, and Sleeper-only rows.** Defenders
(DL, LB, DB) are outside this build (Part 9), and production has the IDP
switch ON (`league_power_pulse_settings.settings.idp.enabled = true`,
measured 2026-09-27), so IDP leagues read defender projections today from
whichever source the resolver picks. Two facts about the read path make this
a trap rather than a footnote: every read names ONE source for all positions
(there is no per-position source), and the resolver picks `ffbeacon` only
when its row count over the window is at least Sleeper's, counted across all
nine positions (`lib/projections/source.ts availableProjectionSources`). An
engine that wrote no DL, LB or DB rows would therefore either fail that probe
and leave the whole site on Sleeper forever, or, if the probe were loosened,
hand every IDP league "No projection" on every defender. The rule:
`ensemble.ts` passes through every Sleeper row for a (player, week) the model
did not produce, unchanged, with `metadata.ensemble.sources = ['sleeper']`
and `metadata.ensemble.passthrough = true`, while `ensemble.useSleeper` is
on. Defenders, practice-squad players Sleeper lists, and anyone the roster
feed missed all arrive this way. With `useSleeper` off, those rows are
written as `unprojected` and the settings page says in words that defenders
have no projection under that setting. The probe itself is replaced by a
build ledger (3.11), because "at least as many rows as Sleeper" was only ever
a proxy for "the build finished".

**Availability taxonomy.** `projected`, `out` and `unprojected` keep their
meanings and their CHECK constraint. What changes is that `projected` on an
`ffbeacon` row no longer means "the source has priced the injury in", which
is what `projectPlayerWeek` assumes today (`sourcePricedIn`), so 3.5 defines
how the read path is told the difference.

**Totals.** `projected_pts_ppr`, `_half_ppr` and `_std` are the canonical dot
product of the stored line, full stop. `CANONICAL_SCORING` in `engine.ts` is
extended with the kicker keys (`fgm_0_19` 3, `fgm_20_29` 3, `fgm_30_39` 3,
`fgm_40_49` 4, `fgm_50p` 5, `fgmiss` -1, `xpm` 1, `xpmiss` -1) and the team
defense keys (`sack` 1, `int` 2, `fum_rec` 2, `def_td` 6, `safe` 2, `blk_kick`
2, and the `pts_allow_*` buckets 10, 7, 4, 1, 0, -1, -4), which are Sleeper's
default league values and the same ones `lib/league-scoring.ts` already knows
how to price. The delta-on-Sleeper anchor and `blendedPoints()` are deleted.
The ensemble blends STAT LINES (as `blend.ts` already does, key by key) and the
totals are recomputed from the blended line, so a stored total can never
disagree with its own stored line. `engine.ts` records that an earlier attempt
at exactly this turned 1,119 kicker and defense rows into 0.00, because the
canonical map had no K or DEF keys; the extension above is what makes the
second attempt safe, and T062b's test (every stored total equals the dot
product of its own line) is what proves it.

### 3.0b The emitted stat line: every key a league can score

The first plan said "Sleeper's key vocabulary" and never listed it. The
audit read the keys off the week 4 Sleeper rows and off `lib/league-scoring.ts`,
which multiplies EVERY key a league's `scoring_settings` names against the
stat line with no allow-list. A key the engine does not emit is a key that
scores zero in every league that prices it, and today's engine emits only
sixteen keys; the rest survive because the blend passes Sleeper's one-sided
keys through. Standing on our own means emitting the whole vocabulary. Per
position, the engine writes:

- **Every position.** `gp` 1. Nothing else that is not a stat (`pts_*`,
  `adp_*`, `cmp_pct` are Sleeper conveniences and are not written).
- **Passing (QB, plus any player with a projected attempt).** `pass_att`,
  `pass_cmp`, `pass_inc`, `pass_yd`, `pass_td`, `pass_int`, `pass_sack`
  (from the QB's own sack rate, which is the one QB rate that is genuinely
  sticky, year-over-year R squared 0.16 to 0.23), `pass_2pt`, `pass_fd`
  (completions times the QB's first-down-per-completion rate shrunk to
  league), `pass_cmp_40p` and `pass_td_40p` (from the aDOT distribution),
  `pass_int_td` (league rate), `bonus_rush_td_qb` equal to `rush_td` when
  the player is a QB.
- **Rushing (QB, RB, WR, TE).** `rush_att`, `rush_yd`, `rush_td`, `rush_fd`,
  `rush_2pt`, `rush_40p`, `rush_td_40p` and `rush_td_50p`, `rush_rz_att`
  (kept because leagues do not score it but the scoreboard grades it).
- **Receiving (RB, WR, TE).** `rec_tgt`, `rec`, `rec_yd`, `rec_td`, `rec_fd`,
  `rec_2pt`, the reception-distance buckets `rec_0_4`, `rec_5_9`, `rec_10_19`,
  `rec_20_29`, `rec_30_39`, `rec_40p` (some leagues score receptions by
  distance; the buckets come from the player's own reception-depth mix in
  `player_stats`, which already types all six, shrunk toward the aDOT band's
  mix), `rec_td_40p`, `rec_td_50p`, and `bonus_rec_rb`, `bonus_rec_wr`,
  `bonus_rec_te` equal to `rec` for the matching position (the position-
  premium keys are receptions, which `league-scoring.ts` already documents).
- **Turnovers.** `fum` and `fum_lost` from touches (rush attempts plus
  receptions plus sacks) times a rate shrunk hard to league (fumble-rate
  autocorrelation is about 0.19), `fum_rec` for offensive players at the
  league rate.
- **Returns.** `kr_yd`, `pr_yd`, `kr_td`, `pr_td` (Sleeper's offensive-player
  keys are `def_kr_yd`, `pr_yd`, `pr`, `pr_td`, `def_kr_td`; the engine
  emits BOTH spellings Sleeper uses for a player, since a league's scoring map
  names one of them) for the players the depth chart lists as returners,
  from the team's return volume times the returner's share, at the league
  rate per return. `st_td` equal to `kr_td + pr_td`.
- **Threshold bonuses, which Sleeper does NOT project.** `bonus_rec_yd_100`,
  `bonus_rec_yd_200`, `bonus_rush_yd_100`, `bonus_rush_yd_200`,
  `bonus_pass_yd_300`, `bonus_pass_yd_400`, `bonus_pass_cmp_25`,
  `bonus_rush_rec_yd_100`, `bonus_rush_rec_yd_200`, and the first-down bonus
  keys (`bonus_fd_qb`, `bonus_fd_rb`, `bonus_fd_wr`, `bonus_fd_te` equal to
  the position's first downs). A threshold bonus is a PROBABILITY, the chance
  the player's yards clear the line, and a point estimate cannot produce it:
  a back projected for 88 yards has a real chance of 100 and a back projected
  for 40 has almost none, and a point estimate gives both zero. The value
  comes from the per-stat distribution in 3.6, `P(yards >= threshold)`, and
  it is the first place the distribution layer earns its keep for a reader.
  Sleeper emits none of these keys (verified on every week 4 row), so leagues
  with yardage bonuses are scored short by the source today, and this is a
  place the engine is more complete than the ingredient it blends with.
- **Kickers.** `fga`, `fgm`, `fgm_0_19`, `fgm_20_29`, `fgm_30_39`,
  `fgm_40_49`, `fgm_50p`, `fgm_50_59` and `fgm_60p` (some leagues split the
  long band), `fgmiss`, `fgmiss_0_19` through `fgmiss_50p`, `fgm_yds` (the
  expected made yards, for leagues that score field goals by distance),
  `fgm_yds_over_30`, `xpa`, `xpm`, `xpmiss`. Made and missed buckets are the
  attempt-distance mix times the make rate by band, so they are consistent
  with each other by construction.
- **Team defense.** `sack`, `int`, `ff`, `fum_rec`, `def_td`, `pass_int_td`,
  `def_fum_td`, `safe`, `blk_kick`, `tkl_loss`, `qb_hit`, `def_2pt`,
  `pts_allow` and the seven `pts_allow_*` buckets as PROBABILITIES (3.4b),
  `yds_allow` and the `yds_allow_*` buckets (`0_100`, `100_199`, `200_299`,
  `300_349`, `350_399`, `400_449`, `450_499`, `500_549`, `550p`) the same
  way, `def_kr_yd`, `def_pr_yd`, `def_kr_td`, `def_pr_td`, `st_td`,
  `def_st_td`, `st_fum_rec`, `def_st_fum_rec`.

The list is a contract, held by a test (T062f): every key present on any
Sleeper row for a position in the current season is either emitted by the
engine for that position or named in an explicit "not modelled" list with a
reason, and every key `lib/league-format-tags.ts` recognises is in one of the
two lists. A new Sleeper key fails the test until someone decides what it is.
The keys are Sleeper's spellings because that is the vocabulary every
league's `scoring_settings` uses; nothing about the engine's inputs is
Sleeper's.

**Why this is safe for every existing reader.** `projectPlayerWeek` scores the
stat line under the league's own settings and only falls back to the stored
totals when it cannot; the availability taxonomy is unchanged; the unique key
is unchanged. What a reader loses is the guarantee that at weight zero our row
is byte-identical to Sleeper's. That guarantee existed to make a mirror honest,
and there is no mirror any more.

```
nfl_games + odds history + weather ------> environment.ts   (game context)
nfl_team_week_tendencies ----------------> volume.ts        (plays, pass rate)
player_week_opportunity + player_stats --> usage.ts         (shares, aDOT, RZ)
players.metadata + player_week_availab. -> availability.ts  (play prob, vacated)
                                            |
                                            v
              redistribute.ts  (vacated shares to teammates)
                                            |
                                            v
                 convert.ts  (opportunity x conditional efficiency -> line)
                                            |
                                            v
        distribution.ts  (mean -> p10/p50/p90 per position)
                                            |
                                            v
     ensemble.ts  (per-position, per-window weights over sources)
                                            |
                                            v
     calibrate.ts  (OUR measured slopes, per position, per window)
```

### 3.1 Team volume from pace, tendency and script

Replaces the season-average `computeTeamVolume`.

```
neutralPace_t   = recency-weighted seconds per play, neutral script, team t
plays(t, o)     = 3600 / harmonicMean(neutralPace_t, neutralPace_o) * paceScale
                  (both offenses run the clock; the harmonic mean is the
                   standard approximation and is measured, not assumed, in 6.2)
passRate(t, g)  = basePassRate_t
                  + PROE_t                       (team tendency over expectation)
                  + scriptSlope * (winProb_t - 0.5)   (from the moneyline, not the spread;
                                                        the relation is logistic in win
                                                        probability and near-linear in spread
                                                        only between about -7 and +7)
                  + funnel_o                     (opponent's induced pass rate, shrunk)
passAttempts    = plays * passRate * (1 - sackRate)
rushAttempts    = plays * (1 - passRate)
```

Every coefficient (`paceScale`, `scriptSlope`, the funnel shrink) is fitted in
6.2 on 2020 to 2025 team-weeks with the closing line as the script input, and
stored in settings. The current `environment.spreadWeight` and `scriptMax`
retire in favour of the win-probability form; `totalWeight` stays as the
multiplier on scoring rate from the implied total.

Two orderings the research settles before the fit runs. First, the TOTAL
outranks the SPREAD: across 5,093 team-games ten points of game total moved
targets and attempts about 4 percent while fourteen points of spread moved
targets 0.6 percent, and the Fantasy Footballers' nflfastR study found
receivers' share of team yards at 66.5 percent on 7-point underdogs against
66 percent on favourites. Game script moves how many plays a team runs and
how many are carries; it barely moves who gets them. So the implied total
drives `plays` and the scoring rate, the win-probability term is a carries
adjuster on the pass-rush split, and neither touches a player's share.
Second, the volume model is graded on TEAM outcomes (plays, attempts,
carries per team-week) before it is graded through players, because one open
implementation that added spread and total found no consistent player-level
gain and shipped the signal disabled; if the team-level fit is real and the
player-level ablation is flat, the plan keeps the signal for the DEF and K
modules (which are team-level by nature) and reports the flat result rather
than forcing it into the player line.

**Week 1 and a new coordinator.** Before a season has plays, `neutralPace_t`
and `PROE_t` are last season's values regressed halfway toward the league
mean, and a team with a new head coach or offensive coordinator (nflverse
`games.csv` carries `home_coach` and `away_coach`; the coordinator is a
hand-kept list in settings, `volume.newCoordinator`, about eight teams a
season) starts at the league mean. Situation-neutral pace holds a week-1 to
full-season R squared of 0.47 and PROE 0.32 (0.6), so the prior is real and
the regression is the measured half.

### 3.2 Opportunity: shares that know who is playing

`usage.ts` keeps its recency-weighted share machinery and gains three shares:
red zone target share (`rec_rz_tgt`), goal-to-go carry share (pbp), and air
yards share, plus the player's aDOT. Team denominators switch from the
max-snap proxy to `tm_off_snp` where it is present.

`availability.ts` and `redistribute.ts` are new:

```
for each team-week being projected:
  active   = teammates with playProb >= activeThreshold (default 0.5)
  vacated  = sum of shares held by teammates with playProb < threshold,
             weighted by (1 - playProb)
  for each share type:
    redistribute vacated share among active players at the SAME position
    group in proportion to their own share, then a fraction (settings
    .redistribution.crossPosition, default 0.25 for targets) to the other
    receiving positions in proportion to theirs
  a player's projected share = own share * (1 + vacated fraction he receives)
```

Players with no usage history (rookies, week 1) take their share prior from
the preseason market: the player's Sleeper season projection in
`player_market_snapshots` divided by his team's summed season projection at
that share type, shrunk with the same small prior. That replaces "no shares,
mirror Sleeper" (1,857 player-weeks on the 2026-09-26 build) with a real
number from week 1, and it is the same information Sleeper's own week-1 line
is built from, so the ensemble weight decides how much it counts.

This is the mechanism Sleeper's editors apply by hand, made explicit and
measured. The redistribution fractions are fitted in 6.2 on every 2020 to 2025
team-week where a top-three target earner was inactive (there are hundreds),
by regressing the remaining players' actual share change on their prior share.
Depth chart order (Sleeper's live `depth_chart_order`, nflverse's weekly
rosters and depth charts in the backfill) breaks ties for who inherits a
vacated starting slot.

For the 2020 to 2025 backtest there are no Sleeper season projections (they
exist for 2026 only, 0.5), so the historical week-1 share prior is the
player's previous-season share on the same team, regressed toward the depth
chart slot's league-average share, with draft capital as the prior for a
rookie (round 1 receivers hit a top-48 season 56 percent of the time, round 2
30 percent, round 3 11 percent, day 3 under 8 percent, 2016 to 2025). The
backtest states which prior it used, and the 2026 scoreboard measures the
market prior against it once week 1 of 2027 has been graded.

**Players who change teams, and quarterbacks who change.** Two cases the
first plan never named, both routine in a season:

- A player traded or signed mid-season carries share history from an offense
  he no longer plays in. His share on the NEW team is the vacated share at the
  depth-chart slot he takes (the same machinery as an injury, run in
  reverse), blended with his old-team share at a weight that decays with
  games played for the new team (`usage.newTeamBlendGames`, prior 3, fitted
  in 6.2 on every mid-season move since 2020; the published evidence is thin,
  PFF's ten deadline trades showed a "marginal" change and touches rising for
  only three of nine, so the default is conservative and the variance is
  widened rather than the mean moved).
- A backup quarterback starting changes the whole passing offense. The engine
  identifies the starter from the depth chart and the play probabilities
  (3.5), and when he is not the team's primary starter it applies
  `volume.backupQbPassEfficiency` (prior 0.85 on completion rate, yards per
  attempt and pass TD rate, fitted on every 2020 to 2025 team-game where
  nflverse's `home_qb_id` or `away_qb_id` was not the team's most common
  starter that season) and widens the receiving distributions. Shares are
  left alone: the published case studies show the effect is heterogeneous
  (McCaffrey's touches unchanged, Jefferson's target ceiling gone), which is
  a variance story more than a mean story.

### 3.3 Conditional efficiency

`convert.ts` keeps `shrinkRate` and changes what it shrinks toward. The prior
for a player's rate is no longer the position mean; it is the position mean
conditioned on his role:

- yards per target and catch rate conditioned on aDOT band (behind the line,
  0 to 9, 10 to 19, 20 plus), fitted from pbp
- receiving TD per target conditioned on red zone target share
- rushing TD per carry conditioned on goal-to-go carry share (replaces the
  clamped `withRedZoneLeverage` ratio)
- QB completion rate and yards per attempt conditioned on the team's time to
  throw and aggressiveness bands from Next Gen Stats
- everything then multiplied by the opponent's adjusted multiplier for that
  stat family (not one multiplier per position: a defense can be soft against
  the run and stingy against deep passing, and `nfl_defense_vs_position` gains
  per-stat-family splits in 6.2)

`player_week_opportunity.expected_*` columns come from ffopportunity's
published `ep_weekly` file (2.6): expected receptions, yards, touchdowns,
first downs and two-point conversions per player-week from play-level
probability models maintained by the ffverse project, landing two to three
days after the games. A player's recent EXPECTED points per target is a
cleaner measure of his role's value than his actual points per target,
because it strips touchdown luck, and it is the efficiency input the
conditional prior leans on first. Beside it, `expected_*_own` is our simpler
figure built in `lib/nflverse-expected-points.ts` (pure) from fields
nflfastR already attaches to each play (`cp`, `xyac_mean_yardage`, field
position, down and distance) and a league-wide touchdown-probability table
fitted on 2016 to 2025 plays. It exists as a cross-check on the published
figure and as the fallback the prior switches to if the release ever stops
(`efficiency.expectedPointsSource`, default `ffopportunity`). Our own pbp
pass also supplies what neither figure carries: red zone and goal-to-go
splits, pace and PROE.

How hard to shrink is not a matter of taste, and the research is one-sided:
yards per carry needs about 1,978 carries to be half skill, yards per target
and touchdowns per target correlate 0.03 and 0.01 year over year for
receivers, interception rate carries 7 percent of its variance forward, and
72 to 93 percent of touchdown-rate overachievers regress the next season.
At a weekly sample a player's OWN recent efficiency should carry almost no
weight against the role-conditioned prior, and `shrinkRate`'s prior sizes are
set per stat accordingly (fitted in 6.2, with priors of roughly 500 targets
for yards per target, 200 for catch rate, 1,000 for touchdown per target,
1,500 carries for yards per carry). The exception is the quarterback's sack
rate, which is the one rate that is genuinely the player's (pressure to sack
R squared 0.16 for the QB against 0.02 for the team) and gets a small prior.
One open backtest found that shrinking toward a positional prior fixed
calibration and made MAE 6 percent worse, so 6.3 grades both and the prior
sizes are chosen on the pair, not on MAE alone.

Opponent multipliers are asymmetric by position as well as by stat family:
per rank of defensive quality the published effect is about 0.13 PPR per
game for running backs, 0.09 for receivers, 0.07 for quarterbacks and
nothing significant for tight ends, and year-to-year fantasy points allowed
correlate 0.27 at QB, 0.22 at RB, 0.16 at TE and barely at WR. The
per-family splits in 6.2 are therefore shrunk hardest for TE and WR, follow
Establish The Run's practice of an 8-game opponent-adjusted window, and are
clamped inside the 0.85 to 1.15 band the read path already enforces.

### 3.4 Game environment: line, weather, roof, rest

`environment.ts` replaces the total and spread half of `volume.ts`.

Inputs per game from `nfl_games`, the latest odds row and the latest weather
snapshot. Outputs a multiplier set applied inside `convert.ts`:

| Effect | Applies to | Starting coefficient, from the published measurements in Part 8; every one is refit in 6.2 before it ships |
| --- | --- | --- |
| Implied total | TD rates (as today) | ratio ^ 1.0, clamped 0.85 to 1.15 |
| Win probability | pass/rush split (3.1) | fitted; the published within-player effect is RB +0.99 PPR, WR -0.50, QB -0.55 as a favourite against the same player as an underdog |
| Wind, sustained at kickoff | completion rate, yards per attempt, pass TD rate, deep-target share, FG make rate, pass attempts (small) | knee at 10 mph, steeper above 15. Published: 10 mph and above, completion -1.8 points and yards per attempt -0.30 (PFF, 5,736 attempts); 20 mph and above, completion 60.3 to 54.7 percent, ANY/A 5.79 to 4.62, TD rate 4.29 to 3.58 percent (The Spax); totals fall about 0.26 points per mph over 7,276 games (nflanalytic: 44.7 at 0 to 5 mph, 40.5 at 16 plus); deep-pass share -6.2 points above 13 mph (4for4); FG make 83.8 to 76.9 percent at 20 plus even after attempts shorten about 7 yards |
| Wind, gusts and direction | deep-target share, FG make rate | half the sustained coefficient on the gust excess; crosswind against `field_heading_deg` weighted above headwind for kicking (expert opinion, Roth; fitted, may be zero) |
| Rain (probability times amount) | completion rate, catch rate, pass attempts, rush attempts, fumbles | published per game, both teams combined: passing -45 yards, -0.6 TD, -3 completion points, -2 attempts per team; rushing +15 yards, +1.5 carries per team; RB targets +7.7 percent in bad-weather games |
| Snow | as rain, larger | published: passing -110 yards, -1.1 TD, -7 completion points, -5 attempts per team; rushing +45 yards, +0.95 TD, +2.5 carries per team; about -4.4 fantasy points to QB and WR and +4.3 to RB per game. Rare (about 15 games a season), so the prior stays until our own sample is real |
| Temperature | nothing on team totals at any temperature (4for4: R squared 0.008 over 3,935 games; nflanalytic: 43.4 points at 32 F or colder against 43.7 at 50 to 69); below freezing, completion -2 to -3 points; FG range loses about 5 yards per 30 F | fitted; totals coefficient pinned at zero |
| Indoor (dome or closed roof) | the ABSENCE of every weather penalty, and nothing else | raw dome totals run 3.5 to 4 points above outdoor, but the two studies that control for team quality find no residual dome bonus; pinned at zero |
| Altitude (Denver) | FG make rate by distance band | fitted |
| Short rest (Thursday after Sunday) | small volume cut, both teams | fitted, expected near zero |
| Home against away in cold | away-team passing efficiency | published: home AYPA 0.2 to 0.3 higher than away below 30 F, visitors from warm climates worst; fitted, small |

Two rules hold the weather model honest:

1. **Lead-time damping.** A forecast 6 days out is applied at reduced strength:
   `effect * damping(lead_hours)`, with damping 1.0 inside 36 hours, 0.7 at 4
   days, 0.4 at 7 days as the published prior, refit from our own
   forecast-against-observation pairs once the snapshot history holds them
   (T037b). The Sunday-morning run is what brings a game to full strength.
2. **Residual only when a line exists.** When the game has a total, the total
   multiplier already carries the market's weather view, so the weather
   effects apply to the SPLIT (pass share, deep share, catch rate, FG rate) and
   to the total only through the fitted residual, which is expected to be
   small. When the game has no line, weather applies to the total as well.
   This is principle 4.

Kicker projection (`kicker.ts`): a kicker's `fgm` by distance band is FG
attempts (from team drives, red zone trip rate and the implied total, the
attempt-distance mix from the team's own history shrunk to league) times make
rate by band, adjusted for wind, altitude and roof; `xpa` from expected
touchdowns; `xpm` from the make rate. Kickers are the position where weather
matters most and today's mirror cannot see it.

### 3.4b Team defense (`team-defense.ts`)

Standing on our own means a DEF row per team per game, so the position the
first plan declined is modelled here, and it is simpler than it looks because
almost all of it is the OPPONENT's projection read from the other side:

```
oppPassAttempts, oppRushAttempts   from 3.1, for the opponent
sacks         = oppPassAttempts * sackRate(defense, shrunk to league) * oppSackAllowedFactor
interceptions = oppPassAttempts * intRate(defense) * oppIntThrownFactor
fumRec        = oppTouches * fumbleRate(defense) * recoveryShare
defTd         = (interceptions + fumRec) * returnTdRate + blockedKick * ...
pointsAllowed = opponent implied total (or our own opponent projection when
                no line exists), and the pts_allow_* bucket is the
                PROBABILITY MASS over buckets from a fitted distribution
                around it, not a point in one bucket
yardsAllowed  = opponent projected yards
```

Every defensive rate is recency-weighted from `player_stats` DEF rows (the
`sack`, `interceptions`, `ff`, `fum_rec`, `def_td`, `pts_allow`, `yds_allow`
columns already exist) and shrunk with the same asymmetric priors: takeaway
rates regress hard, pressure rates less so. The published evidence says how
hard: a defense's own recent sacks, interceptions and fumble recoveries have
"very low" week-to-week correlation with its season average, defensive
touchdowns are not predictable at all, and points allowed is the one
component that is. So sacks are the opponent's sack rate allowed times a
lightly shrunk own pressure rate, interceptions and recoveries sit near the
league rate per opponent dropback and per opponent touch, touchdowns are a
small Poisson rate, and almost all of the DEF projection's information is the
opponent's implied total. The bucket-probability treatment is what makes DEF
scoring honest: a team implied to allow 21 points does not score in the 21
to 27 bucket with certainty, it has about a 35 percent chance of it and real
mass in the neighbours, and the expected points is the probability-weighted
sum. The `yds_allow_*` buckets get the same treatment from the opponent's
projected yards. The published DEF weekly MAE for Sleeper is 4.58 on 2026
weeks 1 to 3 and the target for this module is parity within a season.

### 3.5 Availability: probability, not a flag

`availability.ts` turns what we know about a player on build day into a play
probability:

```
playProb = base(designation)
           adjusted by the Wed/Thu/Fri practice pattern (DNP-DNP-LP is not
           LP-LP-FP), by injury body part class (soft tissue against bone),
           by days since injury_start_date, and by whether Sleeper has
           already marked the week `out`
```

**Where the practice report actually comes from.** The first draft assumed
Sleeper's `practice_participation` field and nflverse's daily injury file
between them gave a Wednesday, Thursday, Friday pattern. Neither does.
Sleeper's `practice_participation` and `injury_start_date` are NULL on every
one of the 873 rostered skill players in our table (measured 2026-09-27);
only `injury_status` (125 players) and `injury_body_part` are populated.
nflverse's `injuries_{season}.csv` holds ONE row per listed player per week
carrying the LATEST `practice_status` and the `report_status`, refreshed
daily, with no per-day history and, from 2025, no `date_modified`. So the
daily pattern exists only if we keep it: the nightly `sync-nflverse-weekly`
run stores that day's `practice_status` and `report_status` per player into
`player_week_availability` as `practice_wed`, `practice_thu`, `practice_fri`
(by the Eastern weekday of the fetch, with Thursday-game weeks shifted by
`nfl_games.kickoff_at`), and the file's `report_status` becomes the Friday
designation. Sleeper's `injury_status` is snapshotted beside it as a second
opinion, and nflverse weekly rosters' `status` (`RES`, `PUP`, `NFI`, `SUS`)
supplies the long-term states. History from 2009 supports fitting `base` on
the final designation plus the last practice status plus body part; the
per-day pattern refinement is fitted on our own snapshots after the 2026
season has been graded, and until then the pattern term is neutral.

`base` and the adjustments are fitted in 6.2 from `player_week_availability`.
Published figures put Questionable near 71 to 75 percent played (2,000 plus
designations, 2017 to 2023), Doubtful near 6 percent, and the practice
pattern moving Questionable between 50 and 90; team usage of the tag varies
enough that a per-team offset is fitted and shrunk.

**Return from injury is a probability curve, not a switch.** A player on
injured reserve this week is not `out` in week 12, and he is not healthy
either. `availability.ts` gives every future week a play probability from a
return curve by injury class (body part and designation) and weeks elapsed,
fitted in 6.2 on nflverse injuries plus weekly roster status (when did the
`RES` player next appear on an active roster and play). The first two games
back also carry a production discount (`availability.returnRamp`, prior
0.85 then 0.93 for RB, WR and TE, 0.95 for QB, from the 4for4 Injury Index's
measured post-return shortfalls of 8 to 22 percent by position), which
applies to the conditional line, not to the probability.

**Two stored numbers, and no double counting.** As principle 5 requires: the
row's stat line and points are `if_active`; `metadata.play_probability`
carries the probability; the read path exposes `expected = playProb *
if_active` beside it. This changes a contract the read path relies on today:
`projectPlayerWeek` treats `availability === 'projected'` as "the source has
already priced the injury in" and skips its own injury multiplier
(`sourcePricedIn`), and FAAB's carry factor does the same. An `ffbeacon` row
that says `projected` and carries `play_probability` 0.6 would, under the
current code, be read at full value. The rule: when a row carries
`metadata.play_probability`, the read path uses it and applies NO injury
multiplier (one number, never two); when it does not (a Sleeper row, a
passthrough), the existing multiplier stands. `read.ts` takes a `mode` of
`expected` (default, what a season simulation wants) or `ifActive` (what a
lineup surface shows, with the probability in words beside it), and the
guard test for the read path asserts a row is never discounted twice.
Sleeper's own per-week `out` verdict still wins where it exists, and the
current-week-only scope of week-to-week designations is unchanged.

**A caution the research raised.** The one open weekly model that tried an
explicit P(plays) times E(points given plays) decomposition lost to a plain
recency average in all nine configurations it tried, and grading only the
games a player appeared in made its error 12 percent worse. That is not a
reason to drop this module, whose purpose is redistribution and honest
future-week availability rather than a better point estimate, but it is a
reason for two rules in Part 6: the availability layer is ablated on its own,
and the walk-forward keeps zeros for inactive weeks in the `expected` grading
so the module is judged on what it claims to know.

### 3.6 Distribution: floor and ceiling, stored

`distribution.ts` fits a per-position two-parameter distribution (gamma for
RB/WR/TE where the mass at zero is real, normal for QB) to the projected mean
using the variance curve Power Pulse already has (`lib/power-pulse/
variance-curve.ts`), refit in 6.2 with the weather and environment inputs as
variance modifiers (wind widens, a dome narrows). Stored on the row as
`metadata.distribution = { p10, p25, p50, p75, p90, sigma }`. `projectPlayerWeek`
reads `sigma` from here when present and falls back to the curve when not, so
nothing downstream changes until it wants to.

The shape has published evidence behind it now. Over 22,571 player-weeks
(2021 to 2025) a standard deviation of `K[position] * sqrt(mean)` with a
positive skew term matched the realised spread within 3 percent and put an
80 percent band at 83.9 percent coverage; the coefficient of variation for
starters runs about 0.36 at QB, 0.54 at RB, 0.58 at WR and 0.63 at TE and
falls as the mean rises, which is what a square-root law says. The
under-coverage that remains is in the LOWER tail and comes from clipping at
zero, so 6.3 measures coverage separately for player-weeks whose p10 is
above zero, and low-mean receivers and tight ends carry a zero-inflation
component rather than a wider gamma. The distribution is per STAT, not only
per total: `P(rec_yd >= 100)` is what fills `bonus_rec_yd_100` in 3.0b, and
the yardage stats use a lognormal or gamma on the stat's own mean and a
position-and-mean-conditional standard deviation fitted from `player_stats`.

### 3.7 Ensemble: per-position, per-window weights

`ensemble.ts` replaces `blend.ts`. Sources, in order of standing: the FF
Beacon model (ALWAYS present, every row), Sleeper's line for the same
player-week (present only when `ensemble.useSleeper` is on and Sleeper
published one), and the props-implied partial line (present only when 2.7 is
enabled and a market exists for that player). Weights are a matrix indexed by
position and by window (weeks 1 to 3, 4 to 8, 9 to 18), fitted in 6.2 by
constrained least squares on the walk-forward residuals (weights non-negative,
sum to one, renormalised over the sources actually present for a row), and
stored in settings as numbers an admin can read and edit. Blending is key by
key on the stat line; the totals are recomputed from the blended line (3.0).

The fitted matrix is expected to give our model real weight at QB from the
first window and less at RB and WR until the vacated-share and pbp signals
prove out. That is the correct shape and the point of a matrix. With
`useSleeper` off the matrix has one column and the `ffbeacon` source is our
model alone; the switch exists so the site can run without Sleeper, and so the
scoreboard can show what that would cost.

One finding tempers the matrix. In Fantasy Football Analytics' twelve-season
seasonal study and eleven-season weekly study, EQUAL weights beat accuracy
weights in 64 and 54 percent of comparisons, because a source's relative
accuracy does not persist from one season to the next, and no published
study shows position- or window-varying weights helping out of sample. So
the fit in 6.2 is run against an equal-weight baseline on a held-out season,
and the matrix ships only where it beats equal weights outside the bootstrap
interval; where it does not, that cell is set to equal weights and the
settings page says so. With two or three sources this is cheap insurance
against fitting noise into a table an admin then trusts.

### 3.8 Calibration: ours, refit weekly

`calibrate.ts` keeps its mechanics (scale the whole line, startable range only,
absolute floor) and replaces the published slopes with slopes fitted on our
own graded weeks per position per window, from the scoreboard's rows. Refit
nightly by `calculate-projection-accuracy` and written to settings with the
sample size beside each slope; a slope with fewer than 200 graded weeks falls
back to the prior window's value, then to 1.0 (no calibration), never to the
published number.

Why the published number is retired rather than refit: the 0.67 to 0.85
slopes are SEASONAL. The same research group's eleven-season weekly study
finds weekly consensus projections nearly unbiased (mean error minus 0.10
points overall, minus 0.76 at QB, plus 0.29 at WR), and the one open weekly
recency model that reported a slope got 0.83 without any calibration step.
Applying a seasonal slope to a weekly line is what 0.2 measured making RB,
WR and TE slightly worse. The default until our own slopes have 200 graded
weeks behind them is therefore 1.0, and the calibration module is a
measured correction, not an inherited one.

### 3.9 Which source a reader gets

Unchanged in shape: `resolveProjectionSource` and `read.ts`. The resolver's
allowlist stays exactly `sleeper` and `ffbeacon`; the new `ffbeacon-model`
source exists for grading and the scoreboard and is never handed to a reader,
and `source-guard.test.ts` gains that assertion. The feature still ships with
`enabled: false` and the scoreboard still promotes it. What changes is that
the scoreboard will finally have a model worth promoting, and it will show
that model alone beside the ensemble.

Three details the consumer audit surfaced, each a one-line fix that would
otherwise be a silent defect:

- `projectionSourceDisplay` returns the raw slug for anything but the two
  known sources, and `app/leagues/[league_id]/lineups/page.tsx` hardcodes
  `projectionSource === "ffbeacon" ? "FF Beacon" : "Sleeper"`, so a third
  source would be labelled "Sleeper" there. The admin scoreboard keeps its
  own label map. All three learn `ffbeacon-model` ("FF Beacon model") and the
  hardcode goes through `projectionSourceDisplay` (T062g).
- The accuracy calc, the scoreboard and `player_projection_accuracy` already
  grade every source they find (the table has a `source` column and a
  per-source unique key), so `ffbeacon-model` is graded the night it first
  appears with no schema change. The reliability multiplier a reader gets is
  looked up by the RESOLVED source, so the ensemble's reliability rows are
  the ones readers see and the model's are scoreboard-only, which is right.
- `lib/data-freshness.ts` checks projection freshness over the whole table
  with no source filter, so a stalled `ffbeacon` build would be hidden by a
  healthy Sleeper sync. It gains a per-source check (T062h).

### 3.10 Projection snapshots: what did each source say on Tuesday

Principle 2 (forecasts are snapshots) was written for weather and lines and
not applied to the projections themselves. Both the Sleeper sync and the
builder overwrite the current week's rows every night, so nothing stored can
say what Sleeper projected on Tuesday against what it projected on Sunday
morning, and the walk-forward's "Sleeper" column is Sleeper's LAST line,
which knows Friday's practice report and Sunday's inactives, graded against
our model's Tuesday information. That tilt runs through every comparison in
Part 0.

`player_weekly_projection_snapshots`: one row per (source, season, week,
player, snapshot_date), written by the sync and by the builder for the
CURRENT week only (the future weeks barely move day to day and are not what
a lead-time question is about), append-only, never updated. Columns:
`source`, `season`, `season_type`, `week`, `sleeper_player_id`, `player_id`,
`snapshot_date` (Eastern calendar day), `snapshot_at`, `availability`,
`stat_line`, `projected_pts_ppr`, `projected_pts_half_ppr`,
`projected_pts_std`, `metadata` (the same provenance object the live row
carries). Unique on `(source, season, season_type, week, sleeper_player_id,
snapshot_date)`. About 2,400 rows per source per day in season, so under
half a million rows a season for three sources; the Sleeper leg starts in
Phase 1 so 2026 accumulates before anything depends on it. Public select,
service-role write, retained indefinitely (it is the backtest's raw
material). Once it holds a season, the scoreboard grades each source by
lead day (Tuesday, Wednesday, Friday, Sunday) and the walk-forward pairs our
Tuesday build against Sleeper's Tuesday snapshot, which is the first fair
comparison the project will have had.

### 3.11 The build ledger replaces the count-parity probe

`availableProjectionSources` decides whether readers get `ffbeacon` by
counting rows: at least as many as Sleeper over the window, across all
positions, or the source is unavailable. That rule made sense for a mirror
and is wrong for an engine with its own universe (it would also silently
disable the feature the first night nflverse listed one fewer punt returner
than Sleeper did). `projection_builds` is a small ledger: one row per
completed build, `source`, `season`, `season_type`, `from_week`, `to_week`,
`model_version`, `rows_written`, `rows_by_position` jsonb, `inputs_present`
jsonb (which of line, weather, injury report, depth chart, props the build
saw, per week), `started_at`, `completed_at`. The builder inserts it LAST,
after the upsert and the stale clear succeed, the same rule
`leagues.last_pulsed_at` follows, so a half-written build is never
advertised. The resolver reads the newest `ffbeacon` row and treats the
source as available for a window when that row covers it, its
`model_version` is the current one, and it completed inside 36 hours; the
60-second in-process memo stays. `source.test.ts` and `read.test.ts` swap
their parity fixtures for ledger fixtures (the probe count in `read.test.ts`
changes from two to one). Public select, service-role write.

---

## Part 4. Architecture and schema summary

### 4.1 Module map (new and changed)

```
lib/nfl-weather.ts                 weather provider adapter. ONLY file naming the host(s).
lib/sync-nfl-weather.ts            the sync, library form (nightly + game-day scope)
lib/nflverse.ts                    nflverse release-asset adapter. ONLY file naming the host.
lib/sync-nfl-games.ts              nfl_games + nfl_stadiums upkeep from nflverse + Sleeper schedule
lib/sync-nflverse-weekly.ts        injuries, depth charts, NGS, pbp aggregates -> derived tables
lib/odds-api.ts                    The Odds API adapter: lines and props, credit accounting, the hard stop. ONLY file naming the host.
lib/sync-nfl-odds.ts               rewritten to read lib/odds-api.ts: consensus median, moneylines, history rows, fetched_at, game_key
lib/nfl-odds.ts                    DELETED (the ESPN adapter); a lint rule bans the host
lib/player-identity.ts             the gsis crosswalk resolver (2.9). PURE.
lib/sync-player-identity.ts        writes external_ids.gsis/espn/pfr/sportradar, reports coverage
lib/sync-projection-snapshots.ts   the current-week snapshot writer (3.10), called by both writers
lib/projections/
  environment.ts                   line + weather + roof + rest -> multiplier set. PURE.
  weather-effects.ts               the weather coefficients and lead-time damping. PURE.
  availability.ts                  designation + practice -> play probability. PURE.
  redistribute.ts                  vacated shares to teammates. PURE.
  volume.ts                        pace + PROE + win-prob script. PURE. (rewritten)
  usage.ts                         + RZ target share, goal-to-go share, aDOT, tm_off_snp. PURE.
  convert.ts                       + conditional priors, per-stat-family opponent. PURE.
  kicker.ts                        FG attempts x make rate by band. PURE.
  team-defense.ts                  DEF line from the opponent's projection and defensive rates. PURE.
  universe.ts                      the row universe from nfl_games x weekly rosters x availability. PURE.
  stat-line.ts                     the emitted key contract (3.0b) and the not-modelled list. PURE.
  distribution.ts                  mean -> percentiles, per stat and per total; threshold probabilities. PURE.
  ensemble.ts                      per-position, per-window weights; the ONLY module that sees Sleeper. PURE. (replaces blend.ts)
  independence.test.ts             guard: no other module imports a Sleeper row type or source constant
  calibrate.ts                     our slopes. PURE.
  engine.ts                        computeBeaconProjections v2. PURE.
  default-settings.ts              every new coefficient, modelVersion "pe-2"
  validate.ts                      server-side validation of the new keys
lib/build-beacon-projections.ts    loads the new tables, passes plain data
lib/calculate-projection-accuracy.ts   + rank correlation, RMSE, calibration slope, pinball loss, per-window
scripts/backtest-projections.ts    + environment from nfl_games/history, + ablation switches, + bootstrap
scripts/fit-projection-coefficients.ts   the fitting harness (6.2), writes a report, never writes settings
scripts/backfill-nfl-games.ts      one-time 1999-2025 nflverse schedules import
scripts/backfill-nfl-weather.ts    one-time archive weather for 2020-2025 outdoor games
scripts/backfill-nflverse-weekly.ts    one-time 2020-2025 derived tables
```

### 4.2 Migrations

Numbered from the next free slot at build time (0311 at the time of writing;
verify with `ls supabase/migrations | tail -1` before writing). Each carries
its access matrix comment and its policies in the same file.

| Migration | Contents |
| --- | --- |
| A | `nfl_stadiums` + seed rows + RLS |
| B | `nfl_games` + indexes + RLS |
| C | `nfl_game_odds` gains `game_key`, `home_moneyline`, `away_moneyline`; `nfl_game_odds_history` + RLS |
| D | `nfl_game_weather` + RLS; `nfl_games.latest_weather_id` |
| E | `nfl_team_week_tendencies` + RLS |
| F | `player_week_opportunity` + RLS |
| G | `player_week_availability` + RLS |
| H | `nfl_defense_vs_position` gains per-stat-family adjusted multipliers (pass yards, rush yards, receptions, TDs) |
| I | `player_projection_accuracy` gains `rmse`, `rank_corr`, `calibration_slope`, `pinball_p10`, `pinball_p90`, `window` |
| J | `player_prop_lines` + RLS (2.7, required) |
| K | `player_weekly_projection_snapshots` + RLS (3.10); Phase 1, so the Sleeper leg accumulates all season |
| L | `projection_builds` ledger + RLS (3.11) |
| M | `player_week_availability` (G) is specified from the start with `team`, `roster_status`, `depth_chart_order`, `depth_chart_position`, `practice_wed`, `practice_thu`, `practice_fri`, `report_status`, `sleeper_injury_status`, `body_part`, `played`, `snaps`; no later widening |

The crosswalk (2.9) needs no migration: it writes keys into the existing
`players.external_ids` jsonb. Types regenerated after each migration and
written to `lib/database.types.ts`.

### 4.3 Settings

All under `league_power_pulse_settings.settings.beaconProjections`, same
document, same reason as before. New keys, all admin-editable at
`/admin/projections`, all validated server-side:

```
modelVersion                      "pe-2"
volume.paceScale, volume.scriptSlope, volume.funnelShrinkGames
redistribution.activeThreshold, .crossPosition, .samePositionShare
availability.base { Q, D, O, IR, PUP, SUS, NA }, .practicePattern {...}, .bodyPartClass {...},
             .outThreshold (default 0.10), .activeThreshold (default 0.5)
teamDefense.enabled, .takeawayPriorGames, .pressurePriorGames, .pointsAllowedSigma
ensemble.useSleeper (default true), ensemble.useProps (default false until T093's ablation has run, then true)
environment.totalWeight (kept), .indoorPassBonus, .shortRestVolume
weather.enabled, .windThresholdMph, .windCompletionPerMph, .windYpaPerMph,
        .windDeepSharePerMph, .windFgPerMph, .gustFactor, .rainCatchRate,
        .rainPassShift, .snowMultiplier, .coldThresholdF, .coldPassEff,
        .leadDamping { h36: 1.0, h96: 0.7, h168: 0.4 }, .residualOnTotal
kicker.enabled, .attemptsPerRzTrip, .makeRateByBand {...}, .altitudeFgBonus
distribution.enabled, .family { QB: "normal", RB: "gamma", ... }, .windSigmaPerMph
ensemble.weights { [position]: { [window]: { sleeper, ffbeacon, props } } }, .equalWeightFallback (default true)
calibration.slopes { [position]: { [window]: { slope, n, fittedAt } } }, .minGraded (default 200; slope 1.0 below it)
props.enabled, .devigMethod, .medianToMean {...}
volume.newCoordinator [team codes], volume.backupQbPassEfficiency (prior 0.85)
usage.newTeamBlendGames (prior 3)
availability.returnCurve { [injuryClass]: [...] }, .returnRamp { QB, RB, WR, TE }, .teamOffset {...}
efficiency.priorSamples { ypt, catchRate, tdPerTarget, ypc, tdPerCarry, ypa, cmpRate, intRate, sackRate, fumbleRate }
distribution.zeroInflation { WR, TE }, .sdCoefficient { QB, RB, WR, TE, K, DEF }
identity.minCoveragePct (default 98)
```

`modelVersion` bumps to `pe-2` when Phase 4 lands. The first plan said that
bump makes every cached Power Pulse, Positional WAR and OTC row identifiable
as stale. The consumer audit found it does not: `stableFingerprint` in
`lib/power-pulse/default-settings.ts` strips every `modelVersion` key at
every depth before hashing, `beaconProjections.modelVersion` is written only
into row metadata, and no cache key reads it. Every OTHER edit to the
`beaconProjections` block rescores every league (because the settings hash
changes), while the one key that is supposed to mean "the numbers changed"
changes nothing. T062i fixes this the direct way: the builder's ledger row
(3.11) carries `model_version`, `projectionDataVersion` (On The Clock),
`projectionsSnapshot` (Positional WAR) and the Power Pulse `model_version`
string each append the resolved source's current ledger `model_version`, and
the On The Clock board etag gains the data version it currently lacks (a
board rebuilt from new rows keeps the same etag today). After that a bump
does what the rule says it does, and a nightly rebuild that changes the rows
without changing the version is caught by the data-version legs.

### 4.3b Environment variables and spend

Recurring spend: none. The owner's decision of 2026-09-27 is that the build
costs nothing to run, and every source in Part 2 was chosen under that rule.

One new server-only variable, required from Phase 1: `ODDS_API_KEY` for The
Odds API's free tier (500 credits a month, an account and a key, no card).
It is read inside `lib/odds-api.ts` and nowhere else, never `NEXT_PUBLIC_`,
and it is set in Vercel and in `.env.local` before T012 ships; the sync
reports `skipped: true` with the reason when it is absent rather than
throwing. Settings: `oddsApi.monthlyCreditStop` (450), `oddsApi.storePerBook`
(false). The weather
adapters need no key: the National Weather Service and MET Norway identify
the caller by `User-Agent`, and the string used is
`ffbeacon.com (signal@ffbeacon.com)`, held in one constant in
`lib/nfl-weather.ts`.

### 4.4 Cron schedule (UTC), after the build

```
06:00  sync-sleeper-players        (existing)
06:30  sync-player-identity        NEW: the crosswalk (2.9), coverage in the result
09:00  sync-sleeper-stats          (existing, in season)
12:00  sync-weekly-projections     (existing, + current-week snapshot)
12:30  sync-nfl-games              NEW: schedule, roof state, closing lines for settled games
13:00  sync-nflverse-weekly        NEW: weekly rosters, injuries (today's practice status),
                                   stats_player_week, stats_team_week, ffopportunity, NGS,
                                   pbp aggregates (in season). Runs AFTER nflverse's own
                                   nightly rebuild, whose injuries and depth files landed at
                                   12:57 UTC on the audit day; 12:45 would have read yesterday's
13:15  sync-nfl-odds               (existing route, now The Odds API: 3 credits, consensus line,
                                   moneylines, history rows; 9:15 Eastern on Sunday)
13:45  sync-nfl-weather            NEW: nightly, current week + next
14:30  build-beacon-projections    (existing, now reads everything above, + snapshot, + ledger)
16:00  cron-health                 (existing)

Game-day refresh, every day, self-skipping:
12:15  sync-nfl-weather?scope=gameday   then build at 12:30 if any game kicks off in the next 14 h
15:00  sync-nfl-weather?scope=gameday   then build at 15:15 (the Sunday early window)
21:00  sync-nfl-weather?scope=gameday   then build at 21:15 (Thursday, Sunday and Monday night,
                                        Saturday and Friday holiday games)
```

Why three fixed hours and not "Sun/Mon/Thu": 2026 has nine international
games, most of which kick off at 9:30 Eastern (13:30 UTC), which is BEFORE
the 15:00 UTC run the first draft proposed; Thursday night games kick off
after it; and weeks 16 and 17 add Saturday and holiday games on days the
list did not name. Each game-day entry reads `nfl_games.kickoff_at`, refreshes
only the games kicking off within its horizon, records `skipped: true`
quietly when there are none (the same `quietWhen` convention the existing
crons use), and is followed by a build so the fresh forecast reaches the
stored row. A vercel.json entry per hour; none is per league.

The Vercel cron ceiling is 300 seconds per invocation (every projection cron
exports `maxDuration = 300`). The build ran 50 to 88 seconds on the three
nights before the audit (stats load 18 to 28 s, upsert 13 to 31 s, compute
under 1 s); the new loads add about eight queries against indexed tables and
are budgeted at under 40 seconds more, and the per-stat distribution work is
arithmetic on rows already in memory. `phaseTimings` already reports each
phase and the budget is asserted in the cron-runs ledger. If the build ever
crosses 200 seconds the week loop splits into two invocations (live week
plus one, then the rest) before anything else is optimised.

### 4.5 Guards and lint

- `lib/projections/source-guard.test.ts` and `raw-column-guard.test.ts` are
  extended to the new derived tables: nothing reads `nfl_game_weather` or
  `player_week_opportunity` outside `lib/build-beacon-projections.ts`,
  `lib/nfl-game-environment.ts` (the display reader) and the scripts.
  `source-guard` also asserts that `ffbeacon-model` never appears in a
  reader's `loadProjections` call.
- `lib/projections/independence.test.ts` (principle 9): every module under
  `lib/projections/` except `ensemble.ts` and the test files is parsed for
  imports of `SLEEPER_SOURCE`, `SleeperProjectionRow` or anything from
  `lib/sleeper.ts`, and the suite fails on the first hit.
- `scripts/eslint/ffbeacon-plugin.mjs` gains the weather, nflverse and Odds
  API hosts to its "no external host outside its adapter" rule, and a
  separate rule that fails on any ESPN host (`espn.com`, `espncdn.com`,
  `site.api.espn.com`, `lm-api-reads.fantasy.espn.com`) anywhere in `lib/`,
  `app/`, `components/` or `scripts/`, with no allow-list.
- A new `lib/projections/no-zero-weather.test.ts` asserts that a missing
  forecast produces the neutral multiplier set and `weatherApplied: false`,
  never a calm game.
- `raw-column-guard.test.ts` scans `lib/`, `app/` and `components/` for the
  three `projected_pts_*` strings and nothing else. `metadata.play_probability`
  and `metadata.distribution` are new raw fields with the same hazard (a
  reader that multiplies by play probability AND applies the injury
  multiplier discounts twice; a reader that draws its own sigma disagrees
  with the stored one), so the guard gains `play_probability` and
  `distribution` as guarded strings with the read path as the only exempt
  reader. Any new writer outside `lib/projections/` is added to
  `EXEMPT_FILES` with a reason.
- `lib/projections/stat-line-contract.test.ts` (3.0b): every key on a Sleeper
  row this season is emitted or explicitly not modelled.
- `lib/projections/double-discount.test.ts` (3.5): a row carrying
  `play_probability` is never also given an injury multiplier.
- `source-guard.test.ts` gains: `ffbeacon-model` never appears as a reader's
  source; every `projectionSourceDisplay` call site goes through the helper
  (no inline ternaries on the slug).
- Every timestamp on `/admin/projections` and on any weather sentence renders
  through `lib/datetime.ts formatEastern`; kickoff is stored UTC and shown in
  Eastern with the zone label.

### 4.6 Surfaces that change

Deliberately few. The point of this build is the number, not new pages.

- `/admin/projections` becomes the projection engine's home. The scoreboard
  gains a third column (our model alone, `ffbeacon-model`) beside Sleeper and
  the ensemble, per position and per window, with the new metrics. Below it,
  every projection setting moves here from `/admin/power-pulse` (the owner's
  decision of 2026-09-27): the fitted weight and slope matrices with sample
  sizes and fit dates, every coefficient in 4.3 with its default beside the
  stored value, the `useSleeper` switch with a sentence saying what it does,
  a weather coverage panel (games with a snapshot inside horizon, oldest
  snapshot, failed fetches, which provider answered), and an odds-history
  table per game under a disclosure. Same accessibility contract as the
  existing page: one h1, real `<table>` elements with `<caption>` and `scope`,
  every control labelled, every timestamp through `formatEastern()`. The
  server action and validator move with it; the Power Pulse page keeps only
  Power Pulse's own blocks.
- `lib/nfl-game-environment.ts describeEnvironment()` gains one plain sentence
  when a forecast exists and the game is outdoors: "Forecast at kickoff: 41
  degrees, wind 18 mph gusting 27, 60 percent chance of rain. Passing games
  in this wind have averaged about 8 percent fewer yards." Indoor: "Played
  indoors." No forecast: nothing is said. The sentence follows the existing
  rule (number first, our reading second, never a betting word), renders on
  the Lineups, Schedules matchup and Start-Sit surfaces that already call
  `describeEnvironment`, and is one text node, never `aria-hidden`.
- Player rows on those surfaces gain "floor 6.1, ceiling 21.4" from
  `metadata.distribution` where present, in the same small type the projection
  already uses, with the words spelled out for a screen reader.
- Where a lineup surface shows a player with `play_probability` below 1, it
  shows the `ifActive` figure with the probability in words ("14.2 if he
  plays, about 70 percent likely"), never the discounted `expected` figure
  alone, which reads as a bad projection rather than an uncertain one.
- The engine label helper learns the third source and the one hardcoded
  ternary is removed (3.9). The How FF Beacon Works guide's Weather section,
  which says today that nothing reads a forecast, is rewritten when Phase 3
  ships and not before.
- `/terms` gains an "Attribution" section (T003), shipped before the first
  nflverse or MET Norway byte is read, listing every external source the
  engine uses: nflverse (CC BY 4.0, licence linked, "aggregated by FF
  Beacon"), ffopportunity by the ffverse project (CC BY-SA 4.0, linked, used
  as a model input), FTN Data via nflverse (CC BY-SA 4.0, used for offline
  validation), MET Norway (NLOD 2.0 and CC BY 4.0, linked), the National Weather
  Service and NOAA (public domain, credited as a courtesy), The Odds API
  (credit appreciated, not required), the greerreNFL stadium dataset, and
  DynastyProcess player ids. The terms and privacy pages are already linked
  from every page's footer, which is what makes a single section sufficient
  under both licences. Same accessibility contract as the rest of the page:
  a real heading in the existing hierarchy, a list, each source's name as a
  link with the licence in plain words beside it. No per-surface credit line
  is added anywhere else; `describeEnvironment`'s "Lines via The Odds API"
  is a data-provenance sentence, not a licence credit, and stays.

---

## Part 5. Phases and task list

Atomic tasks, one file or one migration each, in `progress.md` under `PE2-T###`.
Dependencies are stated so tasks can run in parallel where they do not
collide. Every task ends with the gate (`npm run typecheck`, `npm run lint`,
`npm test`, `npm run build`) and the sub-agent reviews CLAUDE.md requires.

### Phase 0: Records (PE2-T000 to T002)

- T000 this document; T001 progress.md seeded; T002 docs/README.md row and the
  data-sources doc updated with the new sources and their limits.
- T003 The "Attribution" section on `app/terms/page.tsx` per 4.6: every
  external source the engine will read, each with its licence in plain words
  and a link, nflverse marked as aggregated. Ships before T022 (the first
  nflverse read) and T032 (the first MET Norway read); accessibility review
  confirms the heading level fits the page's hierarchy and every link has a
  distinct name.

### Phase 1: Fix and measure what exists (PE2-T010 to T019)

- T010 `fetched_at` set on every odds upsert, with a test that the second
  upsert advances it. Depends on nothing. Ships alone.
- T010b Reconciling migration for `player_stats`: `add column if not exists`
  for every typed column missing from the migrations, dropping nothing,
  changing no data, with the access matrix comment; types regenerated and
  diffed to confirm zero change.
- T010c `lib/cron-runs.ts` CRON_JOBS brought into agreement with
  `vercel.json` (`sync-nfl-odds` 15 13, `sync-dynastyprocess` 15 9), with a
  test that every registry schedule equals its `vercel.json` entry so the
  drift cannot return.
- T018 Migration K `player_weekly_projection_snapshots` (3.10) and
  `lib/sync-projection-snapshots.ts`; `sync-weekly-projections` writes the
  Sleeper leg for the current week from the next run. RLS verified. This
  ships in Phase 1 because every week it is not running is a week of 2026
  the fair backtest cannot use.
- T011 Migration C: `game_key`, moneylines, `nfl_game_odds_history`, the
  `provider` column and its place in the unique key. RLS verified per the
  sequence. The existing ESPN rows are left in place under `source = 'espn'`.
- T012 `lib/odds-api.ts` adapter (key from env, 20-second timeout, null on
  failure, credit accounting in the cron-runs result, the hard stop at
  `oddsApi.monthlyCreditStop`), `lib/sync-nfl-odds.ts` rewritten to take the
  daily `spreads,totals,h2h` pull, compute the consensus median, normalise the
  spread sign, derive implied totals, match events to `nfl_games` and store
  `external_ids.odds_api`, set `fetched_at`, and write history rows on change
  and at first sight; `describeEnvironment` attribution reads "Lines via The
  Odds API"; `lib/nfl-odds.ts` deleted, its tests replaced, and the ESPN-host
  lint rule added. Depends on T011 and on `ODDS_API_KEY` being set. Until
  `nfl_games` exists (Phase 2) the sync keeps the kickoff times The Odds API
  returns with each event, so nothing reads ESPN for a single day.
- T013 `scripts/backtest-projections.ts` gains `--ablate <signal>` switches
  and a paired bootstrap (1,000 resamples over player-weeks) reporting the 90
  percent interval on the MAE difference against Sleeper. This is the harness
  every later phase reports through.
- T014 Error decomposition in the backtest: for modelled rows, split the
  squared error into the part explained by volume (projected minus actual
  targets and carries at actual efficiency) and the part explained by
  efficiency (actual volume at projected minus actual rates). Report by
  position. This tells Phase 4 where to spend.
- T015 Per-position, per-window blend evaluation on the 2025 walk-forward:
  fit the constrained weights described in 3.7 with the current model as the
  only extra source, report them, and DO NOT ship them; the report is the
  baseline the v2 model must beat.
- T016 Record the Phase 1 measurements in this document's Part 7.
- T017 (retired). The optional ESPN-to-Odds-API swap became required on
  2026-09-28 and is T012. The number is kept so earlier references resolve.

### Phase 2: Games and venues (PE2-T020 to T029)

- T020 Migration A `nfl_stadiums` with seed rows from nflverse stadium ids
  plus hand-verified coordinates, roof and surface for 2026, international
  venues included. RLS.
- T021 Migration B `nfl_games`. RLS.
- T022 `lib/nflverse.ts` adapter: fetch a release asset with timeout, byte cap,
  null-on-failure, CSV streaming parse. Unit tests on fixtures.
- T023 `lib/sync-nfl-games.ts` + `scripts/sync-nfl-games.ts` + npm script:
  upsert the live season from `games.csv`, map team codes, derive
  `kickoff_at`, cross-check against Sleeper's schedule, stamp
  `external_ids.sleeper` from the projection rows' `game_id`.
- T024 `scripts/backfill-nfl-games.ts`, `npm run backfill:games`: 1999 to 2025.
  One-time.
- T025 `/api/cron/sync-nfl-games` at 12:30 UTC, registered in cron-runs and
  cron-health.
- T026 `nfl_game_odds` rows gain `game_key` by backfill; `lib/nfl-game-
  environment.ts` joins venue and shows "Played indoors" where the roof says
  so (no weather yet).
- T027 Backtest reads closing lines from `nfl_games` for 2020 to 2025 and
  reports the environment ablation for the FIRST time. Record the result.
- T028 Guard test: the nflverse host appears only in `lib/nflverse.ts`; lint
  rule extended.
- T029 `lib/player-identity.ts` (pure, with fixtures for every leg of 2.9)
  and `lib/sync-player-identity.ts` reading nflverse `roster_weekly` and
  DynastyProcess `db_playerids.csv`, writing `players.external_ids.gsis`,
  `.espn`, `.pfr`, `.sportradar`, reporting coverage per position among the
  players Sleeper projects this week; `/api/cron/sync-player-identity` at
  06:30 UTC; cron-health faults under `identity.minCoveragePct`. BLOCKS
  every task in Phases 4 and 5 that joins an nflverse file. Record the
  coverage in Part 7.

### Phase 3: Weather (PE2-T030 to T045)

- T030 Migration D `nfl_game_weather` + `latest_weather_id`. RLS.
- T031 `lib/nfl-weather.ts`, National Weather Service half: `/points` lookup
  with a cached grid per stadium, `forecastGridData` run expansion
  (`validTime` intervals into hourly values), `forecastHourly`, unit
  conversion (C to F, km/h to mph, mm to inches), the kickoff plus 3 hour
  window, null on failure. Fixtures from a real response. Only file naming
  the host.
- T032 `lib/nfl-weather.ts`, MET Norway half behind the same interface, chosen
  by `nfl_stadiums.country`: `complete` endpoint, `If-Modified-Since` and
  `Expires` handling, four-decimal coordinates, altitude passed, gust and
  probability columns left null. Attribution string exported for the `/terms`
  Attribution section (T003).
- T033 `lib/sync-nfl-weather.ts` + script + npm script: the fetch policy in
  2.4, `is_indoor` rows for domes, snapshot append, `latest_weather_id`
  update, `failedGames`, throw only on a total shutout. The game-day run also
  fetches the nearest NWS station's latest observation for any US game that
  kicked off in the previous five days and stores it as an `nws-observation`
  row with `lead_hours = 0`, which is what T037b pairs against.
- T034 `/api/cron/sync-nfl-weather` with `scope=nightly|gameday`, two
  `vercel.json` entries, cron-runs, cron-health.
- T035 `scripts/backfill-nfl-weather.ts`, `npm run backfill:weather`: nearest
  ISD station per stadium from `isd-history.csv`, one Access Data Service
  pull per station for 2020 to 2025, parse `WND`, `TMP`, `OC1`, `AA1` with the
  quality filter, write one `noaa-isd` row per outdoor game; cross-check
  `recorded_temp_f` and `recorded_wind_mph` from nflverse and report the
  disagreement distribution.
- T036 `lib/projections/weather-effects.ts` (pure): the coefficient table and
  lead-time damping from 3.4 as settings-driven functions, neutral on missing
  input, unit tested at the thresholds.
- T037 `scripts/fit-projection-coefficients.ts --signal weather`: fit the
  weather coefficients on 2020 to 2025 outdoor games (team pass yards,
  completion rate, yards per attempt, FG make rate, fumbles against wind,
  precipitation, temperature, controlling for the closing total). Writes a
  report to `docs/projection-engine/fits/weather-YYYY-MM-DD.md`. Never writes
  settings.
- T037b `scripts/fit-projection-coefficients.ts --signal weather-lead`: pair
  every stored forecast snapshot with the observation for the same game (the
  NWS station observation fetched within five days of kickoff by the game-day
  run, or the ISD row), by lead in whole days, and fit the damping curve. Runs
  for the first time after about eight weeks of 2026 snapshots; the published
  prior (1.0 inside 36 hours, 0.7 at 4 days, 0.4 at 7) stands until then.
  Report.
- T038 Defaults in `default-settings.ts` replaced with the fitted values,
  each with its fit date and sample in the comment.
- T039 `lib/projections/environment.ts` (pure): line + weather + roof + rest
  into the multiplier set, residual-on-total rule, `weatherApplied` flag.
- T040 `lib/projections/kicker.ts` (pure) and the K position added to
  `PROJECTABLE_POSITIONS` behind `kicker.enabled`.
- T041 Engine and builder wire environment and kicker in; `modelVersion` stays
  `pe-1` until Phase 4 because nothing a reader sees changes while the blend
  is zero.
- T042 Backtest ablation for weather, reported with the bootstrap interval, by
  position and for kickers separately. Record.
- T043 `describeEnvironment` gains the weather sentence; a11y review confirms
  one text node, no hidden twins, Eastern kickoff with zone label.
- T044 `/admin/projections` weather coverage panel.
- T045 Guard tests: weather host only in its adapter; missing forecast is
  never calm; `is_indoor` rows carry null weather.

### Phase 4: Opportunity model v2 (PE2-T050 to T069)

- T050 Migrations E, F, G: `nfl_team_week_tendencies`,
  `player_week_opportunity`, `player_week_availability` (the full shape from
  migration M, so the roster status and depth chart columns exist before
  `universe.ts` needs them). RLS.
- T051 `lib/sync-nflverse-weekly.ts`: weekly rosters (team, status, depth
  chart position per player-week) into `player_week_availability`;
  `stats_player_week` and `stats_team_week` into the opportunity and
  tendency tables (target share, air yards share, WOPR, EPA, first downs,
  2-point tries, team attempts and carries); the pbp stream aggregate for
  what those files lack (pace, PROE, red zone and goal-to-go targets and
  carries, induced pass rate, aDOT distribution); conditional requests
  against the stored ETag so an unchanged asset costs one 304.
- T051b Same file: ffopportunity `ep_weekly` into
  `player_week_opportunity.expected_*` (the primary), and
  `lib/nflverse-expected-points.ts` (pure) writing our own simpler figure
  into `expected_*_own` from the pbp fields (`cp`, `xyac_mean_yardage`,
  down, distance, yard line) and a league-wide touchdown-probability table
  fitted on 2016 to 2025 plays (`--signal expected-points`); the report
  states both figures' error against actual points by position and their
  agreement with each other, so the fallback is known to be sane before it
  is ever needed. The licence note from 2.6 sits in the file header and the
  Attribution entry (T003) ships first.
- T052 Same file: Next Gen Stats (the three all-season files) into
  `player_week_opportunity` columns.
- T053 Same file: the live depth chart snapshot per player-week from Sleeper's
  `depth_chart_order` and `depth_chart_position` plus nflverse weekly
  rosters' `depth_chart_position`, into `player_week_availability`; the
  ESPN-format nflverse depth chart file is read only by the backfill (T055)
  and, optionally, weekly as a cross-check of the newest snapshot per team.
- T054 Routes proxy validation: on the 2016 to 2025 seasons where
  participation exists (post-season FTN deliveries, CC BY-SA, credited in the
  Attribution section as "FTN Data via nflverse"), measure how well snap
  share times team pass rate tracks routes run, record the error, and use it
  as the proxy's prior. The live column stays null (the feed is not available
  in season, see 2.6), and the participation rows are never stored.
- T055 `scripts/backfill-nflverse-weekly.ts`, 2020 to 2025, including the
  2001 to 2024 weekly depth charts and the 2025 daily file reduced to the
  last snapshot before each week's first kickoff. One-time, local.
- T056 `/api/cron/sync-nflverse-weekly` at 13:00 UTC in season (after
  nflverse's own 07:07 UTC jobs have landed; 12:57 UTC observed).
- T057 `usage.ts`: RZ target share, goal-to-go carry share, air yards share,
  aDOT, `tm_off_snp` denominator with fallback to the max proxy; the
  new-team blend for players who changed teams (3.2, `--signal team-change`
  fit on every mid-season move since 2020). Report and record.
- T058 `volume.ts` rewritten per 3.1 with `scripts/fit-projection-coefficients.ts
  --signal volume` fitting `paceScale`, `scriptSlope`, funnel shrink, the
  week-1 regression and the backup-quarterback efficiency multiplier on 2020
  to 2025 team-weeks (nflverse `home_qb_id` and `away_qb_id` identify the
  starter), graded first on TEAM plays, attempts and carries and only then
  through players. Report and record, including the flat-result rule from
  3.1 if the player-level ablation does not clear the interval.
- T059 Migration H: per-stat-family opponent splits; `calculate-defense-
  splits.ts` writes them; `opponentMultiplier` reads the family the stat
  belongs to.
- T060 `convert.ts`: conditional priors per 3.3 (aDOT band, RZ share,
  goal-to-go share, NGS bands), expected-points-per-target input.
- T061 `redistribute.ts` (pure) with `--signal redistribution` fit on the
  historical inactive-starter team-weeks. Report and record.
- T062a `lib/projections/universe.ts` (pure): the row universe from
  `nfl_games`, the weekly roster status in `player_week_availability`
  (Sleeper's `players.team` as fallback) and play probabilities per 3.0,
  for every week from the live week to 18, with the `out` and `projected`
  verdicts, the horizon policy's `metadata.inputs`, and no Sleeper input.
- T062b `CANONICAL_SCORING` extended with the kicker and team defense keys;
  `blendedPoints()` and the delta anchor deleted; totals are the dot product
  of the stored line. A test asserts every stored total equals the dot
  product of its own line to four decimals, and a second asserts no K or DEF
  row in a fixture build totals 0.00 (the failure `engine.ts` records from
  the first attempt).
- T062c `lib/projections/team-defense.ts` (pure) per 3.4b, with the bucket
  probability treatment for `pts_allow_*` and `yds_allow_*` and its fit
  (`--signal team-defense`). Report.
- T062d The builder writes the pure model under source `ffbeacon-model` and
  the ensemble under `ffbeacon`; `source-constants.ts` gains
  `BEACON_MODEL_SOURCE`; the resolver allowlist is unchanged and tested;
  `projectionSourceDisplay` learns the third source.
- T062e `lib/projections/independence.test.ts` per principle 9.
- T062f `lib/projections/stat-line.ts` and `stat-line-contract.test.ts`
  (3.0b): the emitted key list per position, the not-modelled list with
  reasons, and the test that every key on a current-season Sleeper row and
  every key `league-format-tags.ts` recognises is in one list or the other.
- T062g The one hardcoded engine ternary in the Lineups page and the admin
  scoreboard's private label map replaced by `projectionSourceDisplay`;
  `source-guard.test.ts` gains the no-inline-ternary assertion.
- T062h `lib/data-freshness.ts` projection check made per source, so a
  stalled `ffbeacon` build is not hidden by a healthy Sleeper sync.
- T062i Migration L `projection_builds` (3.11); the builder writes its ledger
  row last; `availableProjectionSources` reads the ledger instead of
  counting rows; `source.test.ts` and `read.test.ts` fixtures swapped
  (probe count two to one). The ledger's `model_version` is appended to the
  Power Pulse `model_version` string, On The Clock's `projectionDataVersion`
  and board etag, and Positional WAR's `projectionsSnapshot`, so a
  `modelVersion` bump finally invalidates what the rule says it does (4.3).
- T062j Ensemble passthrough for positions and players the model does not
  cover (3.0): DL, LB and DB rows and any Sleeper-only row carried through
  unchanged with `metadata.ensemble.passthrough`; `npm run
  verify:idp-invariant` run against production before and after and its
  "identical" result recorded in Part 7; with `useSleeper` off those rows are
  `unprojected` and the admin page says so.
- T062 Engine v2 assembly; `modelVersion` to `pe-2`.
- T063 Backtest: full v2 ablation matrix (each signal on and off, plus all on)
  by position and window with bootstrap intervals, PLUS the `--independent`
  column (our model alone, every row it produces, against Sleeper on the rows
  both cover, and our coverage of the rows Sleeper does not). Record.
- T064 Error decomposition rerun (T014) on v2; record how volume and
  efficiency error moved.
- T065 Implementation review sub-agent against this plan; fixes.

### Phase 5: Availability (PE2-T070 to T079)

- T070 (folded into T050; `player_week_availability` lands in Phase 4 with
  its full shape.) Phase 5 begins at T071.
- T071 nflverse injuries into `player_week_availability` in
  `sync-nflverse-weekly`, as a DAILY snapshot: today's `practice_status` and
  `report_status` written into the weekday column the Eastern fetch date
  names (`practice_wed`, `practice_thu`, `practice_fri`, shifted for
  Thursday-game weeks by `nfl_games.kickoff_at`), plus Sleeper's
  `injury_status` and `injury_body_part` beside them. There is no other
  source of the daily pattern (3.5).
- T072 `availability.ts` (pure) with `--signal availability` fit of the base
  rates and adjustments on 2009 to 2025 designated player-weeks (final
  designation, last practice status, body part, per-team offset). Report.
  The per-day pattern term ships neutral and is refit after the 2026 season
  from our own snapshots (T072c, dated for 2027-02).
- T072b `--signal return-curve`: the play probability of a player on
  reserve, PUP or with a multi-week designation in each FUTURE week, fitted
  from nflverse injuries plus weekly roster status transitions (when did a
  `RES` player next play), by injury class; and the first-two-games-back
  production ramp. Report.
- T073 Engine stores `metadata.play_probability` on every row including
  future weeks; `read.ts` gains `mode: 'expected' | 'ifActive'`, uses the
  stored probability in place of the injury multiplier when present (never
  both), and `double-discount.test.ts` holds that line; Power Pulse
  simulation consumes `expected`, lineup surfaces show `ifActive` with the
  probability in words. FAAB's `injuryCarryFactor` is made aware of the
  stored probability for the same reason.
- T074 Backtest: availability ablation, graded two ways and both recorded:
  on the redistribution it drives (T061) over played weeks, and on the
  `expected` figure with ZEROS kept for inactive weeks (Part 6), since the
  one open model that decomposed P(plays) times E(points) lost on played
  weeks alone. Record.

### Phase 6: Distribution and ensemble (PE2-T080 to T089)

- T080 `distribution.ts` (pure): per-stat and per-total distributions, the
  `K[position] * sqrt(mean)` standard deviation with skew fitted from
  `player_stats` (`--signal distribution`), zero inflation for low-mean WR
  and TE, stored percentiles, the threshold probabilities that fill the
  `bonus_*_yd_*` keys in 3.0b; `projectPlayerWeek` reads `sigma` when
  present. Coverage reported separately for rows whose p10 is above zero.
- T081 Migration I: the new accuracy columns and `window`.
- T082 `calculate-projection-accuracy.ts`: RMSE, Spearman rank correlation
  within the startable range per position-week, calibration slope, pinball
  loss at p10 and p90, per window.
- T083 `ensemble.ts` replaces `blend.ts`; `useSleeper` and `useProps`
  switches; the passthrough rule from T062j; weights fitted by `--signal
  ensemble` on the walk-forward residuals AGAINST an equal-weight baseline
  on a held-out season, each cell shipping fitted only where it beats equal
  weights outside the interval (3.7); stored in settings with sample sizes;
  the fit report is the promotion evidence.
- T084 `calibrate.ts` on our slopes per 3.8, refit nightly, `minGraded` floor,
  default 1.0 (the seasonal slopes are retired, not refit).
- T085a `/admin/projections` shows the three-column scoreboard, the matrices
  and the new metrics.
- T085b Projection settings, their server action and validator move from
  `/admin/power-pulse` to `/admin/projections`; every key in 4.3 is editable;
  accessibility review on the new form.
- T086 Full walk-forward on 2025 with v2 at the fitted weights against Sleeper.
  THIS is the number that decides whether `enabled` flips. Record.

### Phase 7: Props market on the free tier, required (PE2-T090 to T099)

- T090 Migration J `player_prop_lines`. RLS.
- T091 `lib/odds-api.ts` gains the per-event props call beside the lines call
  built in T012, sharing the same key, the same credit ledger and the same
  hard stop, so lines and props can never overrun the allowance between
  them.
- T092 `lib/sync-player-props.ts`: ONE Saturday 15:00 UTC pull of four
  markets (`player_anytime_td`, `player_reception_yds`, `player_rush_yds`,
  `player_pass_yds`) for the current week's events, 64 credits a week;
  de-vig; median to mean; stat-line translation.
- T093 Ensemble source `props`; refit; ablation on the weeks collected.
  Record. The backtest states that props cover only the weeks since the key
  was turned on.

### Phase 8: Reviews and promotion (PE2-T100 to T106)

- T100 Implementation review; T101 security review (new public tables, new
  outbound hosts, key handling, SSRF surface of any URL-building code, RLS
  verified live); T102 accessibility review (weather sentence, floor and
  ceiling words, admin tables); T103 performance review (build under 120 s,
  read path unchanged in query count); T104 fixes; T105 final report;
  T106 the promotion decision: `enabled` flips only if T086 beats Sleeper
  pooled AND at every position where the ensemble gives our model weight,
  with the bootstrap interval excluding zero.

---

## Part 6. Measurement: how every coefficient gets its number

### 6.1 The walk-forward harness is the only judge

`scripts/backtest-projections.ts` stays the single grading path and grows the
switches Phase 1 adds. Rules it enforces:

- For week W of season S it may see seasons S-2 and S-1 in full and S weeks 1
  to W-1. `assertNoLookahead` checks every input table, not just stats: the
  odds snapshot used is the latest with `fetched_at` before the Tuesday of
  week W (or the closing line for seasons without history, said in the
  footer); the weather snapshot used is the archive row (actual conditions,
  which is generous to the forecast and is said in the footer) damped as if
  it were a 36-hour forecast; injuries seen are through Friday of week W.
- Grading is on played weeks, PPR, half PPR and standard, by position and by
  window, with MAE, RMSE, bias, Pearson and Spearman-within-startables,
  calibration slope, and pinball loss at p10 and p90 when a distribution is
  stored.
- Every comparison against Sleeper reports a paired bootstrap interval.
- Fit seasons and test seasons are separate: coefficients fitted on 2020 to
  2024 are tested on 2025; the final promotion run fits on 2020 to 2025 and
  is tested live on 2026 through the scoreboard.
- The Sleeper column is labelled with the information it had. For 2020 to
  2025 it is Sleeper's LAST stored line (Sunday-morning information) and the
  footer says so; from the first season the snapshot table (3.10) covers, the
  harness pairs our Tuesday build against Sleeper's Tuesday snapshot and
  reports both pairings.
- Zeros are kept. The `expected` figure is graded over every row in the
  universe including weeks the player did not play (a zero), and the
  `ifActive` figure over played weeks only; the report shows both. Grading
  only played weeks flatters any availability model and made one open
  model's error 12 percent worse when it was corrected.
- Weeks 1 to 17 are the grading set and week 18 is reported separately,
  because resting starters make week 18 a different question (Part 3.5's
  play probability, not the line).
- A perturbation test runs with every backtest: outcomes at or after week W
  are replaced with noise and the projections for weeks before W must be
  byte-identical, which is the structural proof that `assertNoLookahead`
  covered every input table.
- Team-level signals (3.1) are graded on team outcomes first; a signal that
  helps team plays and attempts but not player points is kept for the K and
  DEF modules and reported as flat for players.

### 6.2 The fitting harness

`scripts/fit-projection-coefficients.ts --signal <name>` reads the derived
tables, fits the named coefficient set by the method stated in its section,
prints the estimates with standard errors and sample sizes, writes a dated
markdown report under `docs/projection-engine/fits/`, and never writes
settings. A human copies the numbers into `default-settings.ts` with the
report's date in the comment. That indirection is deliberate: a fit that runs
on a cron and rewrites the model is a model nobody can explain.

### 6.3 What "better" means before `enabled` flips

All of these, on the 2025 walk-forward at the fitted ensemble weights, against
Sleeper on identical rows:

1. Pooled PPR MAE lower, bootstrap 90 percent interval excluding zero.
2. No position worse by more than its interval.
3. Spearman rank correlation within the startable range not lower at any
   position (this is the lineup-decision metric).
4. Calibration slope closer to 1.0 than Sleeper's at every position.
5. Coverage: p10 to p90 contains the actual between 75 and 85 percent of the
   time at every position, measured over all rows AND over rows whose p10
   is above zero (the lower tail is where clipping at zero hides
   miscalibration).
6. Every ensemble cell that carries a fitted weight beats equal weights on
   the held-out season outside its interval; the rest are equal weights.

And one target for the pure model, reported beside them and NOT a gate on
`enabled` (the ensemble is what readers get): our model alone within 0.3 PPR
points of Sleeper's pooled MAE on the 2025 walk-forward, and covering every
player-week Sleeper covers among rostered QB, RB, WR, TE, K and DEF. That is
the number that says the site could stand without Sleeper, and it is
published on the scoreboard whether or not it is met.

Then the live 2026 scoreboard has to hold the same relationships for four
consecutive graded weeks before `enabled` flips. The scoreboard is public
under `/admin/projections` and the promotion is recorded in progress.md with
the numbers.

---

## Part 7. Measurements recorded during the build

Empty until Phase 1 runs. Each task that says "Record" appends here: date,
command, sample, result, decision.

---

## Part 8. Sources

External claims in this document trace to these. Everything else was measured
against production or read from the code.

Weather APIs and stadium data

- National Weather Service API, disclaimer and FAQs: https://www.weather.gov/documentation/services-web-api,
  https://www.weather.gov/disclaimer, https://weather-gov.github.io/api/general-faqs,
  https://weather-gov.github.io/api/gridpoints
- MET Norway Locationforecast 2.0, licence, terms and data model:
  https://api.met.no/weatherapi/locationforecast/2.0/documentation,
  https://api.met.no/doc/License, https://api.met.no/doc/TermsOfService,
  https://docs.api.met.no/doc/locationforecast/datamodel.html,
  https://data.norge.no/nlod/en/2.0
- NOAA Integrated Surface Database, format document, station history and Access Data Service:
  https://www.ncei.noaa.gov/products/land-based-station/integrated-surface-database,
  https://www.ncei.noaa.gov/data/global-hourly/doc/,
  https://www.ncei.noaa.gov/pub/data/noaa/isd-history.csv,
  https://www.ncei.noaa.gov/support/access-data-service-api-user-documentation,
  https://registry.opendata.aws/noaa-isd/
- Open-Meteo terms and pricing (evaluated, not used): https://open-meteo.com/en/terms,
  https://open-meteo.com/en/pricing
- Visual Crossing editions, free plan and service terms (documented alternative):
  https://www.visualcrossing.com/weather-data-editions/,
  https://www.visualcrossing.com/resources/documentation/visual-crossing-weather-free-plan-free-weather-data-for-analysts-and-api-developers/,
  https://www.visualcrossing.com/weather-service-terms/
- ECMWF open data, DWD open data licence, Environment Canada licence (evaluated, not used):
  https://www.ecmwf.int/en/forecasts/datasets/open-data,
  https://www.dwd.de/EN/service/legal_notice/legal_notice_node.html,
  https://eccc-msc.github.io/open-data/licence/readme_en/
- NFLweather.com terms of use: https://www.nflweather.com/terms_of_use
- Tomorrow.io pricing: https://www.tomorrow.io/weather-api/pricing/
- OpenWeatherMap One Call: https://openweathermap.org/api/one-call-3, https://openweathermap.org/price
- greerreNFL Stadiums dataset: https://github.com/greerreNFL/Stadiums
- Current NFL stadiums (roof and surface): https://en.wikipedia.org/wiki/List_of_current_National_Football_League_stadiums
- New Highmark Stadium: https://www.forbes.com/sites/timnewcomb/2026/07/30/the-design-of-buffalos-highmark-stadium-heating-up-the-bills-mafia/
- Titans, Browns and Jaguars venue timelines: https://www.nfl.com/news/titans-new-enclosed-stadium-on-track-february-2027-completion,
  https://www.nfl.com/news/browns-break-ground-2-billion-domed-stadium-brook-park-2029,
  https://www.nfl.com/news/nfl-owners-approve-camping-world-stadium-in-orlando-as-temporary-home-for-jaguars-in-2027
- 2026 international games: https://media.nfl.com/news-and-releases/international/nfl-unveils-2026-international-games-schedule
- Bliss WeatherData (2000 to 2020 station observations by game): https://github.com/ThompsonJamesBliss/WeatherData

Weather effects

- nflanalytic, weather and scoring, 7,276 games: https://nflanalytic.com/explainer-weather-and-scoring.html
- 4for4, cold weather and scoring, 3,935 games: https://www.4for4.com/how-does-cold-weather-impact-nfl-scoring
- 4for4, weather effects and fantasy football (2003 to 2017): https://www.4for4.com/2018/preseason/weather-effects-and-fantasy-football-part-1
- PFF, The Factors, wind and passing (week 14, 2017): https://www.pff.com/news/fantasy-football-the-factors-week-14-2017
- The Spax, the effect of weather in the NFL: https://www.thespax.com/nfl/analyzing-the-effect-of-weather-in-the-nfl/
- Advanced Football Analytics, weather effects on passing and temperature and field goals:
  http://www.advancedfootballanalytics.com/2012/01/weather-effects-on-passing.html,
  http://www.advancedfootballanalytics.com/2012/01/temperature-and-field-goals.html
- The Fantasy Footballers, whether weather really matters (nflfastR, 2015 onward):
  https://www.thefantasyfootballers.com/articles/the-fantasy-football-mythbusters-whether-weather-really-matters/
- FantasyLabs, weather trends by position: https://www.fantasylabs.com/articles/nfl-dfs-weather-trends-wind-temperature-draftkings-fanduel/
- Sharp Football, weather and betting: https://www.sharpfootballanalysis.com/sportsbook/weather-impact-on-nfl-betting/
- Action Network, weather and totals: https://www.actionnetwork.com/how-to-bet-on-sports/nfl/nfl-over-under-betting-weather-trends-wind-hot-cold-temperatures
- Kevin Roth, NFL weather guidance: https://mysportsweather.com/nfl-weather

NFL data sources

- nflverse data releases and schedule: https://github.com/nflverse/nflverse-data,
  https://nflreadr.nflverse.com/articles/nflverse_data_schedule.html,
  https://github.com/nflverse/nfldata/blob/master/DATASETS.md
- nfl_data_py URL patterns: https://raw.githubusercontent.com/nflverse/nfl_data_py/main/nfl_data_py/__init__.py
- nflreadr Next Gen Stats and PFR loaders: https://raw.githubusercontent.com/nflverse/nflreadr/main/R/load_nextgen_stats.R,
  https://raw.githubusercontent.com/nflverse/nflreadr/main/R/load_pfr_advstats.R
- ESPN unofficial endpoints (evaluated and retired; kept so the decision can be audited): https://gist.github.com/nntrn/ee26cb2a0716de0947a0a4e9a157bc1c,
  https://gist.github.com/akeaswaran/b48b02f1c94f873c6655e7129910fc3b
- Sleeper API docs and the undocumented .com endpoints: https://docs.sleeper.com/,
  https://github.com/joeyagreco/sleeper/discussions/11
- Sports Reference bot policy and data use: https://www.sports-reference.com/bot-traffic.html,
  https://www.sports-reference.com/data_use.html
- FantasyPros API tiers: https://www.fantasypros.com/api-data/
- The Odds API, guides, markets, pricing and terms: https://the-odds-api.com/,
  https://the-odds-api.com/liveapi/guides/v4/,
  https://the-odds-api.com/sports-odds-data/betting-markets.html,
  https://the-odds-api.com/terms-and-conditions.html
- SportsGameOdds pricing, FAQ and terms: https://sportsgameodds.com/pricing,
  https://sportsgameodds.com/faq, https://sportsgameodds.com/terms
- ESPN fantasy endpoint descriptions and the Disney Terms of Use that govern it:
  https://ffscrapr.ffverse.com/articles/espn_getendpoint.html,
  https://disneytermsofuse.com/english/

Projection methodology

- Fantasy Football Analytics, 12 seasons of seasonal projections:
  https://fantasyfootballanalytics.net/2026/08/we-analyzed-12-seasons-of-fantasy-football-projections-heres-what-we-found.html
- Fantasy Football Analytics, 11 seasons of weekly projections:
  https://fantasyfootballanalytics.net/2026/09/we-analyzed-11-seasons-of-dfs-projections-heres-what-we-found.html
- FantasyPros, expert consensus accuracy: https://www.fantasypros.com/2011/01/expert-consensus-rankings-accuracy/
- SumerSports, sticky football stats: https://sumersports.com/the-zone/sticky-football-stats-predictive-nfl-metrics/
- GWTTKB, what actually predicts fantasy football (independent, not peer reviewed):
  https://www.gwttkb.com/research/what-actually-predicts-fantasy-football.html
- PFF, share of predicted targets: https://www.pff.com/news/nfl-refining-coach-i-was-open-a-model-comparing-actual-vs-predicted-target-shares
- Mike Clay, ESPN, targets and trends: https://www.espn.com/fantasy/football/story/_/id/38069858/fantasy-football-statistics-targets-trends
- FanDuel Research, adjusted pace and pass rate stability:
  https://www.fanduel.com/research/adjusted-nfl-pace-and-pass-rate-report-ranking-week-1-s-fastest-games-2025
- Establish The Run, pass rate over expectation and DvP method:
  https://establishtherun.com/pass-rate-over-expectation/, https://establishtherun.com/establish-the-run-nfl-dvp/
- FantasyPros, using Vegas odds: https://www.fantasypros.com/2025/09/how-to-use-vegas-odds-fantasy-football/
- 4for4, floor and ceiling definitions: https://www.4for4.com/nfl-dfs-floor-ceiling-projections
- The Fantasy Footballers, the value of variance: https://www.thefantasyfootballers.com/articles/embracing-volatility-quantifying-the-value-of-variance-in-best-ball-fantasy-football/
- Stokastic, boom and bust rates: https://www.stokastic.com/articles/dfs-strategy/dfs-boom-bust-probability
- Win With Odds (props to projections method): https://www.winwithodds.com/about
- Sources carried over from the first plan (4for4 defenses repeat, Yahoo, PFF expected points, ffopportunity, Footballguys, Fantasy Team Advice) are listed in `docs/completed/projection-engine/projection-engine-plan.md` Part 6.

Added by the second audit (2026-09-27)

Data files read directly, headers and sizes measured:

- nflverse weekly rosters, stats, team stats, injuries, depth charts, play by play, participation, players, Next Gen Stats: https://github.com/nflverse/nflverse-data/releases (tags `weekly_rosters`, `stats_player`, `stats_team`, `injuries`, `depth_charts`, `pbp`, `pbp_participation`, `players`, `nextgen_stats`), each with a `timestamp.json`
- nflverse dictionaries (CSV and JSON): https://api.github.com/repos/nflverse/nflreadr/contents/data-raw
- nflverse injuries source switch: https://github.com/nflverse/nflverse-rosters/pull/96, https://github.com/nflverse/nflverse-rosters/issues/100, https://raw.githubusercontent.com/nflverse/nflverse-rosters/master/exec/update-injuries.R
- nflverse depth chart provider (ESPN) and workflow: https://raw.githubusercontent.com/nflverse/nflverse-rosters/master/exec/update-depth-charts.R, https://raw.githubusercontent.com/nflverse/nflverse-rosters/master/.github/workflows/update_depth_charts.yaml
- nflverse licence: https://api.github.com/repos/nflverse/nflverse-data (CC BY 4.0); FTN charting and participation terms: https://nflreadr.nflverse.com/reference/load_ftn_charting.html, https://raw.githubusercontent.com/nflverse/nflreadr/main/NEWS.md
- nflverse team code mapping on relocation: https://nflreadr.nflverse.com/reference/clean_team_abbrs.html, https://nflreadr.nflverse.com/reference/team_abbr_mapping.html
- ffopportunity releases, README, licence and workflow: https://github.com/ffverse/ffopportunity/releases, https://raw.githubusercontent.com/ffverse/ffopportunity/main/README.md, https://raw.githubusercontent.com/ffverse/ffopportunity/main/.github/workflows/ep-update-data.yaml, https://raw.githubusercontent.com/nflverse/nflreadr/main/data-raw/dictionary_ffopps.csv
- DynastyProcess player ids: https://github.com/dynastyprocess/data/raw/master/files/db_playerids.csv, https://nflreadr.nflverse.com/articles/dictionary_ff_playerids.html
- Sleeper schedule and projections endpoints, fetched: https://api.sleeper.app/schedule/nfl/regular/2026, https://api.sleeper.app/projections/nfl/2026/18?season_type=regular&position[]=QB, https://api.sleeper.app/players/nfl/6794
- The Odds API rate limit page: https://the-odds-api.com/guide/rate-limit.html
- Vercel function duration, memory, limits and cron pricing: https://vercel.com/docs/functions/configuring-functions/duration, https://vercel.com/docs/functions/configuring-functions/memory, https://vercel.com/docs/functions/limitations, https://vercel.com/docs/cron-jobs/usage-and-pricing
- GitHub Actions billing, limits and schedule behaviour: https://docs.github.com/en/billing/managing-billing-for-your-products/about-billing-for-github-actions, https://docs.github.com/en/actions/reference/limits, https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows

Methodology, accuracy and feature evidence:

- Open weekly harnesses and models: https://github.com/jfontanet5/nfl-fantasy-projections, https://github.com/mazinsafer/FantasyFootballEngine, https://github.com/CaseytheBigRedDog/Fantasy-Football-Predictions, https://github.com/jacksonmlukas/football-hub/pull/92, https://srome.github.io/Bayesian-Hierarchical-Modeling-Applied-to-Fantasy-Football-Projections-for-Increased-Insight-and-Confidence/, https://github.com/tdub29/Kicker-Analysis, https://github.com/JMerchen/mlb_metrics/pull/134
- Commercial methods as disclosed: https://www.pff.com/news/fantasy-the-logic-behind-pffs-fantasy-projections, https://www.4for4.com/4for4-fantasy-football-accuracy, https://www.4for4.com/faq/what-schedule-adjusted-fantasy-points-allowed, https://www.espn.com/fantasy/insider/football/insider/story/_/id/33621386/, https://help.yahoo.com/kb/fantasy-football/player-projections-yahoo-fantasy-football-sln37135.html, https://rotogrinders.com/pages/rotogrinders-daily-fantasy-projections-faq-129417, https://support.fantasypros.com/hc/en-us/articles/115001219327, https://www.fantasypros.com/about/faq/football-inseason-accuracy-methodology/
- Stickiness and regression: https://www.sharpfootballanalysis.com/fantasy/wide-receiver-stats-that-matter-fantasy-football-2024/, https://www.si.com/nfl/2018/07/31/fantasy-football-2018-most-predictable-wide-receiver-stats, https://www.footballguys.com/article/HarstadRegression02?article=HarstadRegression02, https://fantasyclassroom.org/Blogs/sticky-stats/yards-per-carry-stability, https://www.pff.com/news/fantasy-football-metrics-that-matter-touchdown-efficiency, https://www.fanduel.com/research/touchdown-regression-what-it-is-and-how-to-use-it-for-player-prop-bets-fantasy-football, https://thepowerrank.com/2020/09/08/how-to-predict-interceptions-in-the-nfl/, https://www.pff.com/news/nfl-hidden-story-behind-quarterback-interceptions
- Game script, opponent, home field, rest: https://www.thefantasyfootballers.com/articles/the-fantasy-football-mythbusters-flip-the-game-script/, https://www.thefantasyfootballers.com/articles/the-fantasy-football-mythbusters-making-the-most-of-matchups/, https://www.4for4.com/2026/preseason/do-defenses-repeat-fantasy-football-performances, https://nflanalytic.com/explainer-home-field-advantage.html, https://www.frontiersin.org/journals/behavioral-economics/articles/10.3389/frbhe.2024.1479832/full, https://www.pff.com/news/examining-thursday-night-football-statistics, https://www.espn.com/nfl/story/_/id/15204686/england-effect-do-nfl-teams-play-london-suffer-afterward, http://www.advancedfootballanalytics.com/2013/01/altitude-and-field-goals.html
- Injuries and return: https://www.footballguys.com/article/2024-injury-index-chance-to-play-questionable-vs-doubtful, https://www.footballguys.com/article/2023-footballguys-injury-report, https://www.4for4.com/2022/preseason/4for4-fantasy-football-injury-index-how-do-injuries-affect-player-performance, https://harvardsportsanalysis.org/2013/11/inaccuracies-in-the-injury-report-across-the-nfl/, https://pubmed.ncbi.nlm.nih.gov/37259957/, https://pubmed.ncbi.nlm.nih.gov/39649523/, https://pubmed.ncbi.nlm.nih.gov/24200441/
- Trades, backup quarterbacks, rookies: https://www.pff.com/news/fantasy-football-midseason-trades-production-role, https://www.pff.com/news/fantasy-football-how-do-backup-qbs-affect-skill-player-production, https://www.footballguys.com/article/2026-draft-capital-matters-rookie-wide-receivers
- Distributions and variance: https://underdognetwork.com/football/best-ball-research/weekly-variance-by-position-a-key-to-best-ball, https://www.playerprofiler.com/article/the-player-variance-manifesto/, https://www.footballguys.com/article/DFS_expectationvariance, https://www.4for4.com/effect-draftkings-bonus
- Team defense and kickers: https://subvertadown.com/article/attempting-to-find-a-more-predictable-d-st-scoring-scheme, https://subvertadown.com/article/week-to-week-predictability-of-each-fantasy-position, https://www.4for4.com/2023/preseason/debunking-randomness-kickers-fantasy-football
- Ensembles and calibration: https://fantasyfootballanalytics.net/2015/02/best-fantasy-football-projections-2015.html, https://fantasyfootballanalytics.net/2025/07/fantasy-football-projections-exploring-positional-bias-in-projections.html, https://fantasyfootballanalytics.net/2016/04/accuracy-of-rankings-vs-projections.html
- Sleeper stat field quirks: https://www.fantasypointcalculators.com/blog/sleeper-pts-ppr-explained

Items the research could not verify and that the build must check before
relying on them: the named venues for the Paris, Madrid, Munich and Mexico
City games; the exact PFF cold-weather figures, which came from search
snippets because the pages are paywalled; any plan-specific restriction The
Odds API applies to its free tier inside the account dashboard (its published
terms have none); the National Weather Service's official observation
retention (measured at five to six days, a maintainer says three); any row or
date limit on NOAA's Access Data Service (none published, and a six-year pull
succeeded); how often Sleeper refreshes `injury_status` (undocumented); the
day of the game week on which nflverse's closing lines populate (blank four
days out, filled by Sunday); whether Node's `fetch` forwards `If-None-Match`
across the GitHub release redirect the way curl does (expected yes, tested
only with curl); and the licence DynastyProcess intends for `db_playerids.csv`
(the repository is GPL-3.0 with no separate data licence; the site already
consumes the file nightly for two columns). Two items the first draft listed
are now settled: the Sleeper schedule endpoint carries the date and no time,
and `games.csv` holds all 272 games of 2026.

---

## Part 9. What this build deliberately does not do

- It does not delete Sleeper. The engine can run without it (principle 9) and
  the ensemble can give it any weight from zero up; both facts are shown on
  the scoreboard and the fitted weight decides.
- It does not flip `enabled`. Part 6.3 does, and only with the evidence.
- It does not put per-league work on a cron. Everything here is global.
- It does not store raw play-by-play. Aggregates only, with provenance.
- It does not scrape any site whose terms forbid automated access, and it does
  not need to: every input has a free, licensed source (Part 2).
- It does not spend money. The one paid tier the first draft considered is
  replaced by a free tier with a hard credit stop.
- It does not project IDP beyond what exists today. Defender projections stay
  on Sleeper's stat lines under the IDP switch, carried through the ensemble
  as passthrough rows (3.0) so an IDP league sees exactly what it sees today;
  a defender model is a separate plan.
- It does not show, export or redistribute a row from any share-alike
  dataset (ffopportunity's expected points, FTN participation). Both are read
  as inputs, credited once in the Attribution section on `/terms` (T003,
  linked from every footer), and never leave the database; that is the rule
  that keeps the "new work" reading of CC BY-SA true. It does not port or
  link GPL code. nflverse and MET Norway are credited in the same section,
  and no credit appears anywhere else on the site.
- It does not fetch the plain-CSV variant of any large nflverse asset from a
  cron; gzipped or parquet, streamed, always.
- It does not call any ESPN host, for anything, from anywhere. The Odds API
  supplies lines, `nfl_games` supplies kickoffs, the forecast supplies
  weather, and a lint rule holds the line.
- It does not add a recurring call against The Odds API beyond the daily
  lines pull and the weekly props pull. The budget in 2.7 is spoken for.

---

## Part 10. The second audit: every hole found, and where it is closed

Done 2026-09-27, the same evening as the revision recorded in 0.8, by
reading the whole projection stack and every consumer of it, by querying
production, by fetching every external file the plan names and reading its
header, and by a fresh pass over the published research. Each item says what
the first draft assumed, what is true, and which section now carries the
fix. Items are ordered by how much of the build they would have broken.

1. **The gsis join was not exact.** Assumed: every Sleeper player carries a
   gsis id. True: 16 of 32 projected QBs, 11 of 63 RBs, 18 of 96 WRs, 15 of
   47 TEs, 14 of 33 Ks. Without a fix, Phases 4 and 5 would have modelled a
   third of the league and silently mirrored the rest. Closed by 2.9 (a
   crosswalk through nflverse weekly rosters' `sleeper_id` and
   `sportradar_id` and DynastyProcess's id file, written into
   `players.external_ids`), T029, and a cron-health coverage fault.
2. **The row window was undefined and it matters.** Assumed: "the window".
   True: the sync and the builder both write the live week through 18, and
   eleven consumers sum the remaining weeks treating a missing week as
   absent, so a current-week-only engine would shorten every season
   simulation on the site. Closed by 3.0 (window, horizon policy,
   `metadata.inputs`), T062a.
3. **Dropping IDP rows would have disabled the feature or blanked IDP
   leagues.** Assumed: defenders "stay on Sleeper" with no mechanism.
   True: production has the IDP switch on, every read names one source for
   all positions, and the resolver requires row parity across all nine
   positions. Closed by the passthrough rule in 3.0, the ledger in 3.11,
   T062i and T062j, with `verify:idp-invariant` as the proof.
4. **"projected" means "injury priced in" today, and the engine's rows would
   not be.** Assumed: store `play_probability` beside the line. True:
   `projectPlayerWeek` and FAAB skip their injury multiplier when
   `availability === 'projected'`, so a 60 percent player would have read at
   full value, or, once fixed naively, been discounted twice. Closed by 3.5
   (one number, never two, `mode` on the read path), T073 and
   `double-discount.test.ts`.
5. **Sleeper's practice report does not exist in our data.** Assumed:
   `practice_participation` and `injury_start_date` from Sleeper plus a
   daily nflverse pattern. True: both fields are NULL on all 873 rostered
   skill players, and nflverse's file holds one row per player-week with the
   latest status and no timestamp since the 2026-08-06 source change. Closed
   by 3.5 (our own daily snapshot into weekday columns; the pattern term
   fitted after a season), 2.6, T071, T072, T072c.
6. **The emitted stat line was never specified.** Assumed: "Sleeper's
   vocabulary". True: the scorer multiplies every key a league names, Sleeper
   emits about forty keys per position including distance buckets, first
   downs, returns and two-point tries, and the current engine emits sixteen.
   Sleeper emits no threshold-bonus keys at all. Closed by 3.0b (the
   contract, with threshold bonuses from the distribution), 3.6, T062f,
   T080.
7. **The backtest compares Tuesday's model against Sunday's Sleeper.**
   Assumed: the walk-forward is fair. True: both writers overwrite the
   current week nightly, so the stored Sleeper row is its last line. Every
   number in 0.2 carries that tilt. Closed by 3.10 (append-only current-week
   snapshots, Sleeper leg from Phase 1), T018, and the pairing rule in 6.1.
8. **A `modelVersion` bump invalidates nothing.** Assumed: the existing rule
   works. True: the settings fingerprint strips every `modelVersion` key and
   no cache key reads the projection one; the On The Clock etag also lacks
   its data version. Closed by 4.3 and T062i.
9. **The depth chart plan named a file that changed shape and provider.**
   Assumed: a weekly nflverse depth chart, daily. True: ESPN daily snapshots
   since 2025, 54 MB plain, 11 MB gzipped, no week column; and Sleeper
   already supplies a live order on 637 of 873 skill players. Closed by 2.6
   and T053 (Sleeper plus weekly rosters live, the ESPN file in the
   backfill).
10. **The aggregate files carry more than the first draft used.** nflverse
    `stats_player_week` already carries target share, air yards share, WOPR
    and EPA, so the pbp pass only has to supply what those files lack.
    ffopportunity publishes a ready-made expected-points file for 2006 to
    2026, updated Sunday night through Tuesday and Friday; it is used as the
    primary efficiency input with one credit line on `/terms`, and a simpler
    in-house figure from pbp fields sits beside it as the cross-check and
    fallback (T051b). Closed by 2.6, 3.3, T051, T051b.
11. **Efficiency shrinkage was too gentle and the calibration slopes were the
    wrong kind.** True: YPC needs about 1,978 carries to be half skill, YPT
    and TD per target correlate 0.03 and 0.01 year over year, the 0.67 to
    0.85 slopes are seasonal and weekly consensus is nearly unbiased.
    Closed by 3.3 (per-stat prior sizes, sack rate the exception) and 3.8
    (default 1.0, measured slopes only).
12. **Game script moves volume, not shares, and the total outranks the
    spread.** Closed by 3.1 (ordering, team-level grading first, the
    flat-result rule).
13. **Equal ensemble weights beat fitted ones in the only long studies.**
    Closed by 3.7 and T083 (fitted cells ship only where they beat equal
    weights out of sample).
14. **The availability decomposition has a published loss against it.**
    Closed by 3.5's caution and 6.1 (zeros kept, availability ablated on its
    own).
15. **Quarterback changes, mid-season trades, week-1 team priors and return
    curves were absent.** Closed by 3.1, 3.2, 3.5, T057, T058, T072b.
16. **The game-day weather run was after the London kickoffs and missed
    Thursday, Friday and Saturday games.** Closed by 4.4 (three self-skipping
    game-day hours keyed on `nfl_games.kickoff_at`).
17. **The Sleeper schedule endpoint has no kickoff time** (settled), **`games.csv`
    has all 272 games of 2026** (settled), **nflverse lines are closing lines
    that populate late in the game week** (2.2), **Vercel allows 800
    seconds** (4.4), **the repository is public** (2.6).
18. **Smaller records.** The cron registry drifted from `vercel.json` (0.4,
    T010c); `player_stats` has no team column (0.5); the engine label is
    hardcoded on one page and the admin scoreboard keeps its own map (3.9,
    T062g); data freshness is not per source (T062h); `raw-column-guard`
    does not cover the new metadata fields (4.5); the nflverse nightly job
    must run after 12:57 UTC, not 12:45 (4.4); the K and DEF dot-product
    failure the first attempt hit is now a named test (T062b); the
    participation data covers 2016 to 2025, not 2020 to 2023 (T054).

19. **ESPN is gone, by decision (2026-09-28).** The audit surfaced the
    licence exposure and offered the swap as optional; the owner made it
    required. The Odds API's free tier supplies game lines from Phase 1
    (T012), `nfl_games` supplies kickoffs, the ESPN weather note is dropped,
    `lib/nfl-odds.ts` is deleted, an ESPN-host lint rule is added, and the
    credit budget (about 370 of 500, hard stop 450, nothing else recurring)
    is written into 2.7 as a constraint on future work.

What the audit did NOT change: the decision that the engine stands on its
own with Sleeper as an optional ingredient, the zero-cost rule, the weather
provider choices, the move of settings to `/admin/projections`, the phase
order, and the promotion gate. The evidence gathered here made each of those
more specific and none of them different.
