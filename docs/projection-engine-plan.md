# The FF Beacon Projection Engine

Plan of record. Written 2026-09-01 from the audit in the same session. Task
prefix in `progress.md` is `PE-T###`.

---

## Part 0. Why this exists

Before this build there was no FF Beacon projection engine. There was a Sleeper
projection with four FF Beacon multipliers on top, applied by seven surfaces and
skipped by six others.

Everything measured below was measured against the production database
(`cilvpyivysjxpxbudkfa`) on 2026-09-01, not assumed.

### What was wrong

**1. Opponent strength could never see the current season.** Five files
hardcoded `defenseSeasons = [season - 1, season - 2]`:

```
lib/league-power-pulse.ts:459
lib/positional-war/load.ts:572
lib/faab/league-faab.ts:229
lib/breakdown/league-impact.ts:249
lib/league-schedule/data.ts:448
```

In week 12 of 2026 the model would still be rating defenses on 2025 and 2024.
Worse, `lib/calculate-defense-splits.ts` picks its own seasons as "the three most
recent with stats", so from roughly week 4 it would faithfully write 2026 rows
that no reader ever asked for. And `opponentMultiplier()` weights `seasons[0]` at
`currentSeasonWeight` (0.7). That was not the current season. It was last season,
wearing the label.

**2. The opponent multiplier was applied at full strength on a signal that mostly
does not persist.** Year over year correlation of our own stored multipliers,
2024 into 2025, all 32 teams, PPR:

| Position | Correlation |
| --- | --- |
| DEF | 0.319 |
| RB  | 0.243 |
| TE  | 0.152 |
| K   | 0.147 |
| QB  | 0.107 |
| WR  | -0.097 |

Published work agrees: 4for4 measured fantasy points allowed at QB 0.27, RB 0.23,
and "very little" for receivers, with only 30% of top-five quarterback defenses
repeating. We applied plus or minus 15% to all six positions equally. The clamps
were load bearing rather than cosmetic: 49 of 96 DEF rows and 17 of 96 TE rows sat
pinned at the 0.80 or 1.25 bound.

**3. Part of that near-zero correlation is our own measurement error.** The
multiplier was raw points allowed per game over the league average, with no
correction for which offenses each defense happened to face. A defense that drew
the six best offenses looks generous; neither conclusion is about the defense.

**4. Nothing in the model learned that a player's role changed.** The only path
from last Sunday to next Sunday was Sleeper revising its own projection. Beat
rate moves the reliability multiplier by at most 5%, and the pp-5 notes record
that beat rate has no year over year persistence (QB 0.02, RB -0.06, WR -0.03,
TE 0.02, K -0.01, DEF 0.16). Our own `player_stats` carries targets, snaps, air
yards and red zone attempts back to 2020 and nothing read them for projection
purposes.

**5. Sleeper's projection contains no matchup at all.** Amon-Ra St. Brown, 2026,
as stored:

| Week | Opponent | Projected PPR | Projected targets |
| --- | --- | --- | --- |
| 1 | NO | 19.80 | 9.83 |
| 2 | BUF | 19.43 | 9.68 |
| 3 | NYJ | 19.88 | 9.83 |
| 4 | CAR | 19.99 | 9.83 |
| 5 | ARI | 20.01 | 9.83 |
| 7 | GB | 19.90 | 9.83 |
| 8 | MIN | 19.78 | 9.83 |

Three percent across seven opponents, with projected targets byte-identical for
five of them. Our opponent multiplier is not a refinement on Sleeper's matchup
work. It is the only matchup work in the product.

**6. Six surfaces bypassed the adjustment layer** and read the raw Sleeper
column: `lib/trade-finder-data.ts`, `lib/draft-value/build.ts`,
`lib/beam/projections/load.ts`, `lib/player-profile.ts`, `lib/faab/outlook.ts`,
`lib/league-relay/load.ts`. Trade Ideas priced a suggested package on a raw
six-week Sleeper average while the impact verdict on the same page ran adjusted
numbers through a Monte Carlo.

### What the research supports

Checked rather than assumed. Sources listed in Part 6.

- **Opportunity beats efficiency and it is not close.** Expected points are more
  stable and about as predictive as actual points; expected touchdowns are more
  stable AND more predictive than actual touchdowns. Touchdown rate, yards per
  carry and yards per target regress hard. Targets, carries, snap share and air
  yards do not. This is the whole justification for a usage model.
- **Usage stabilises in four to six games.** The working threshold for treating a
  target share as signal rather than noise is 4 to 6 games, and 3 to 4 games for
  calling a usage shift structural. By about week 5, current-season usage should
  dominate; by week 8 the prior season is a tiebreaker.
- **Every projection source over-spreads.** Twelve seasons analysed by Fantasy
  Football Analytics give calibration slopes below 1.0 at every position: QB
  0.67, TE 0.72, RB 0.79, WR 0.85. Preseason projections also carry about +21.6
  points of systematic optimism, worst at quarterback.
- **Averaging beats picking.** An equal-weighted average of sources beat
  individual sources in 69% of comparisons, and equal weighting beat clever
  historical weighting. Blend with Sleeper; do not replace it.
- **Defenses barely repeat.** See the table above.
- **Dynasty and redraft want different things.** RBs peak 24 to 27 and shed 35 to
  50% of market value within a year of peaking; WRs peak 26 to 27 and hold value
  3.5 to 4 years longer, with no significant per-game decline until 30. None of
  that comes out of a weekly projection, so projections should carry more weight
  as the horizon shortens.

### Data we already have

Measured 2026-09-01.

- `player_stats`: 2020 through 2025 regular seasons, roughly 40,000 rows a
  season, `opponent` populated on 100% of rows. Among players who actually
  played in 2025: snaps on 89% of WR rows, 91% of TE, 84% of RB, 94% of QB;
  targets on 75% of WR, 64% of TE, 60% of RB; air yards on 66% of WR.
- `player_weekly_projections`: 2024, 2025, 2026 only. The two graded seasons
  average 395 and 404 players with a published projection per week, against 576
  in 2026.
- `nfl_defense_vs_position`: 576 rows a season for 2023, 2024, 2025.
- `player_projection_accuracy`: rebuilt nightly, blended row per player.
- No betting lines, game totals or implied totals of any kind.

---

## Part 1. Principles this build holds to

These are non-negotiable and every task inherits them.

1. **A null projection is never a zero.** The existing availability taxonomy
   (`projected` / `out` / `unprojected` / `bye`) is correct and any new source
   must produce it. A bye writes no row. An `out` writes a real zero. An
   `unprojected` writes nulls.

2. **One function applies the adjustments.** `projectPlayerWeek()` in
   `lib/power-pulse/project.ts` stays the only place opponent, reliability,
   availability and injury multipliers are applied. New adjustments go inside it
   or into the stored projection, never into a caller.

3. **Raw and derived stay side by side.** The `player_projection_accuracy`
   precedent: `mean_ratio` is what we measured, `shrunk_multiplier` is what we
   apply, and both are stored so anyone can re-derive one from the other. Every
   new derived number in this build follows it.

4. **A projection is stored as a component stat line, not a point total.**
   Sleeper publishes `pass_yd`, `rec`, `rush_att` and so on, which is why
   rescoring under a league's literal `scoring_settings` is exact rather than
   approximate. Our own projections use the same key vocabulary so every existing
   reader, every custom scoring rule and every format works unchanged.

5. **Projections do not vary by value source or `format_config_id`.** Same rule
   Power Pulse and Positional WAR already hold. Projections are scored under the
   league's own settings, so the source toggle must not invalidate any cache.

6. **Nothing per-league goes on a cron.** Same scaling rule as league power
   rankings, Power Pulse and Positional WAR. Global tables rebuild on a schedule;
   per-league work stays on demand.

7. **A failed request is not evidence.** A source that fails to answer leaves the
   previous state alone. It never writes a zero, never clears a table, and never
   causes a downstream calc to conclude something about a player or a defense.

8. **Every coefficient is measured, not tuned.** Where this plan gives a number,
   it says what was measured to produce it. Where a coefficient must be picked
   before its measurement exists, it is admin-editable and the default is
   conservative.

---

## Part 2. Architecture

### Module map

```
lib/projections/
  defense-seasons.ts   which seasons an opponent lookup should consider. PURE.
  adjust.ts            iterative opponent adjustment of defense splits. PURE.
  usage.ts             recency-weighted role shares from player_stats. PURE.
  volume.ts            team play volume, modulated by game environment. PURE.
  convert.ts           opportunity to a component stat line. PURE.
  calibrate.ts         per-position spread calibration. PURE.
  blend.ts             beacon and sleeper into one stored row. PURE.
  engine.ts            computeBeaconProjections(). PURE. takes plain data.
  load.ts              the I/O half of the builder.
  source.ts            which projection source a reader gets. PURE.
  read.ts              THE single adjusted read path for every consumer.
  default-settings.ts  every weight and cap, admin-overridable.
  validate.ts          server-side validation of an admin save.

lib/nfl-odds.ts        ESPN scoreboard adapter. null on failure, never throws.
lib/sync-nfl-odds.ts   the sync, library form.
lib/build-beacon-projections.ts   the builder, library form.
```

`lib/calculate-defense-splits.ts` and `lib/calculate-projection-accuracy.ts` stay
where they are and gain new outputs.

### Data flow

```
Sleeper weekly projections ─┐
ESPN game odds ─────────────┼─> lib/build-beacon-projections.ts
player_stats (usage) ───────┘        │
                                     v
                    player_weekly_projections (source='ffbeacon')
                                     │
player_stats ─> nfl_defense_vs_position ─┐
player_stats + projections ─> player_projection_accuracy ─┐
                                     │                    │
                                     v                    v
                            lib/projections/read.ts ─> projectPlayerWeek()
                                     │
        ┌────────────────────────────┼────────────────────────────┐
        v                            v                            v
   Power Pulse              Positional WAR                 Trade Ideas
   FAAB, Schedules          Beacon Steals, BEAM            Player profiles
```

### Schema changes

**Migration 0237** `nfl_defense_vs_position`, three new columns. Existing RLS
(public select, service-role write) is unchanged and re-verified.

| Column | Type | Meaning |
| --- | --- | --- |
| `adjusted_points_allowed_per_game` | numeric | after correcting for the offenses faced |
| `adjusted_multiplier` | numeric | `adjusted_points_allowed_per_game` over the league average, clamped |
| `shrunk_multiplier` | numeric | `adjusted_multiplier` pulled toward 1.0 by position reliability and sample size. **This is what readers apply.** |

`multiplier` keeps its current meaning, the raw unadjusted ratio, as the audit
trail. Nothing reads it after this build except the admin view.

**Migration 0238** `nfl_game_odds`, new table.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid pk | |
| `source` | text not null default `'espn'` | |
| `season` | integer not null | |
| `season_type` | text not null default `'regular'` | |
| `week` | integer not null | |
| `home_team` | text not null | our abbreviation, `WSH` mapped to `WAS` |
| `away_team` | text not null | |
| `kickoff_at` | timestamptz | |
| `game_total` | numeric | the over/under |
| `home_spread` | numeric | negative means home is favoured |
| `home_implied_total` | numeric | `game_total / 2 - home_spread / 2` |
| `away_implied_total` | numeric | `game_total / 2 + home_spread / 2` |
| `provider` | text | the book ESPN quoted, for the audit trail |
| `metadata` | jsonb | the original ESPN competition object, per the preservation rule |
| `fetched_at` | timestamptz not null default now() | |
| `updated_at` | timestamptz not null default now() | |

Unique on `(source, season, season_type, week, home_team)`. Indexed on
`(season, season_type, week)`. RLS: `nfl_game_odds_select_public` for select to
anon and authenticated, `nfl_game_odds_service_role_all` for all to service_role.

**Migration 0239** `player_weekly_projections` gains a partial index on
`(source, season, season_type, week)` so a source-filtered read stays cheap, and
the existing unique key is confirmed to already include `source`.

**Migration 0240** `player_projection_accuracy` gains `source text not null
default 'sleeper'`, and its uniqueness moves to include it, so we can grade our
own projections against Sleeper's on the same table with the same code.

### Settings

Everything lives in the existing `league_power_pulse_settings` single global row,
under two new keys, because the Positional WAR precedent is that a model reusing
the projection stack must not be able to run under a half-applied edit across two
documents.

```
settings.opponent.positionReliability   { QB, RB, WR, TE, K, DEF }
settings.opponent.priorGames            sample-size shrink strength, default 6
settings.opponent.useAdjusted           default true
settings.beaconProjections.enabled      default false until measured
settings.beaconProjections.blendWeight  { min, max, gamesForMax }
settings.beaconProjections.usage        { halfLifeWeeks, priorSeasonWeight, minGames }
settings.beaconProjections.calibration  per-position slopes
settings.beaconProjections.environment  { totalWeight, spreadWeight, caps }
```

`modelVersion` is bumped whenever any of these changes what a number means, so
cached Power Pulse and Positional WAR rows are identifiable as stale.

---

## Part 3. The algorithms

### 3.1 Which seasons an opponent lookup uses

The bug was positional indexing into a fixed array. The fix is to walk candidate
seasons most recent first and take the first two that actually have a usable row
for that team and position.

```
defenseSeasonsFor(season) -> [season, season - 1, season - 2]

opponentMultiplier(defense, candidates, team, position, settings):
  usable = []
  for s in candidates:
    row = defense[team|s|position]
    if row and row.gamesSampled >= settings.opponent.minGamesSampled:
      usable.push(row)
    if usable.length == 2: break
  weights = [currentSeasonWeight, priorSeasonWeight]
  blend usable[i] at weights[i], renormalised by the weight actually used
```

In the preseason no current-season row exists, so this returns exactly the old
answer: last season at 0.7 and the one before at 0.3, renormalised. From roughly
week 8 the current season takes the 0.7 slot. Nothing needs a date check, and the
weight named `currentSeasonWeight` finally means it.

### 3.2 Opponent-adjusting the defense splits

Raw allowance carries the schedule bias of the offenses each defense faced. The
correction is the standard alternating-ratings iteration, four passes, which
converges long before that.

```
For one (season, scoring, position):
  L  = league average startable points at that position, per team-game
  O_o = raw per-game output of offense o at that position
  D_d = raw per-game allowance of defense d at that position

  repeat 4 times:
    D_d = mean over games g faced by d of ( actual_g * L / O_{offense(g)} )
    O_o = mean over games g played by o of ( actual_g * L / D_{defense(g)} )

  adjusted_points_allowed_per_game = D_d
  adjusted_multiplier = clamp(D_d / L, MIN, MAX)
```

`actual_g` keeps the existing definition: the sum of the startable performances
allowed in that game, where startable is the top 1 QB, 3 RB, 4 WR, 2 TE, 1 K,
1 DEF by points in that team-week. That definition is already in
`calculate-defense-splits.ts` and is not changing.

Guards: a division only happens when the denominator is positive and the pool
cleared `MIN_GAMES`; anything else leaves the raw value in place and records why.

### 3.3 Shrinking the multiplier to its measured signal

Two shrinks, multiplied.

```
k_position = settings.opponent.positionReliability[position]   // 0 to 1
k_sample   = games / (games + settings.opponent.priorGames)

shrunk_multiplier = 1 + k_position * k_sample * (adjusted_multiplier - 1)
```

`k_position` is set from the year over year correlation of the multipliers,
floored at 0 and capped at 1.

### The measurement, run 2026-09-01 after 3.2 landed (PE-T016)

Two season pairs, all 32 teams, PPR, raw and opponent-adjusted:

| Position | raw 25/24 | adj 25/24 | raw 24/23 | adj 24/23 | mean |
| --- | --- | --- | --- | --- | --- |
| DEF | 0.319 | 0.276 | 0.297 | 0.238 | 0.283 |
| RB | 0.243 | 0.269 | 0.285 | 0.356 | 0.288 |
| TE | 0.152 | 0.223 | 0.247 | 0.032 | 0.164 |
| K | 0.147 | 0.113 | 0.026 | 0.079 | 0.091 |
| QB | 0.107 | 0.043 | -0.117 | -0.075 | -0.011 |
| WR | -0.097 | -0.056 | -0.027 | -0.081 | -0.065 |

Shipped coefficients are that mean of four, floored at zero:

```
DEF 0.28   RB 0.29   TE 0.16   K 0.09   QB 0.00   WR 0.00
```

All four cells are pooled rather than only the adjusted pair. With 32 teams the
standard error on any one of these correlations is about 0.19, so no two cells in
a row are distinguishable from each other and picking the flattering one would be
fitting noise.

**What the adjustment actually did, stated honestly.** It clearly helped running
backs (0.264 to 0.313 across the two pairs) and did nothing measurable anywhere
else. Team defense reads slightly WORSE adjusted. The adjustment is kept
regardless, because it removes a bias we can demonstrate exists and a correctness
fix does not need a correlation to justify it, but it did not rescue the
positions this plan hoped it would and saying otherwise would be inventing a
result.

**Two positions are zero, and both are deliberate.** WR is negative in all four
measurements, so no receiver matchup adjustment applies at all. QB is the
interesting one: our own data disagrees with published work, which puts fantasy
points allowed to quarterbacks at 0.26 to 0.27, the strongest of any position. We
measure -0.011. The likely reason is that we are not measuring the same thing:
ours is the top ONE startable quarterback performance per game, clamped, which is
far noisier than a season points-allowed rank. We use our own number because it is
our own metric and the one being applied, and the disagreement is recorded in the
settings comment so raising it is an informed choice.

**Effect on what a reader sees.** Applied multiplier spread after the change:
DEF sd 0.041 (range 0.959 to 1.052), RB 0.028, TE 0.019, K 0.009, QB and WR
exactly 1.000. Before it, the raw spread was sd 0.13 to 0.19 with 49 of 96 team
defense rows pinned at a clamp. A 15% swing on noise became a 5% swing on
measured signal.

`k_sample` does the early-season work that a hard games threshold did badly: a
defense with 3 games in the current season contributes at 3/9 strength rather
than being ignored until game 8.

### 3.4 Game environment from odds

```
home_implied_total = game_total / 2 - home_spread / 2
away_implied_total = game_total / 2 + home_spread / 2
```

Two multipliers come out of it, both clamped, both admin-tunable.

- **Volume.** `impliedTotal / leagueAverageImpliedTotal`, raised to
  `settings.beaconProjections.environment.totalWeight` (default 0.5, so a 10%
  richer environment adds about 5%). Applied to touchdown expectation more than
  to yardage, because scoring environment moves touchdowns hardest.
- **Script.** A team favoured by `s` points runs more and throws less. The
  adjustment is linear in the spread and small:
  `rushShare += spreadWeight * s`, `passShare -= spreadWeight * s`, with
  `spreadWeight` defaulting to 0.004 per point and the result clamped to plus or
  minus 8%. A 7-point favourite therefore shifts about 3% of its plays from
  passing to rushing, which is the right order of magnitude and deliberately not
  more.

When no odds row exists for a game, both multipliers are exactly 1 and the
projection is unchanged. Missing odds must never look like a neutral game script
that we asserted; it is simply an adjustment we did not make.

### 3.5 Usage shares

For each player and each of the four share types (snap, target, carry, red zone
carry), computed per position from `player_stats`:

```
weight(game) = seasonWeight(season) * 0.5 ^ (weeksAgo / halfLifeWeeks)

share = sum(weight * playerCount) / sum(weight * teamCount)
```

`seasonWeight` reuses the Power Pulse recency ladder (current 1.0, one back 0.45,
two back 0.20, older 0.08). `halfLifeWeeks` defaults to 4, which puts the
stabilisation research into the model directly: at a 4-week half life, the last
four games carry about as much weight as everything before them combined, which
is where the 4-to-6-game finding says the line sits.

Team denominators:

- team offensive snaps: the maximum `off_snp` on the team-week, which is the
  quarterback in almost every case and is the right denominator when it is not.
- team targets: the sum of `rec_tgt` across the team-week.
- team carries: the sum of `rush_att` across the team-week.

A share is only published when the denominator cleared a minimum and the player
has at least `minGames` weighted games. Below that the player has no beacon
projection and the row falls back to Sleeper alone, which is the correct answer
for a rookie in week 1.

### 3.6 Opportunity to points

Expected volume is share times projected team volume. Turning volume into a stat
line uses league-average conversion rates by position, blended with the player's
own under heavy shrinkage, because efficiency regresses and opportunity does not.

```
rate = (n * playerRate + priorGames * leagueRate) / (n + priorGames)
```

with `priorGames` large (default 24 games) for the efficiency rates
(yards per target, catch rate, yards per carry, touchdown rate) and small
(default 4) for the volume shares. That asymmetry is the entire point: we trust
a player's role quickly and his efficiency slowly.

**THE STORED POINT TOTAL IS ANCHORED ON SLEEPER'S PUBLISHED NUMBER, NOT
RE-DERIVED FROM THE LINE.** A correction to the plan, made during implementation
after the first build was measured against production, and the most important one
in this document.

Two things go wrong if the stored total is the canonical dot product of the stat
line, and the first is severe:

1. A kicker's line is `fgm` and `fgmiss`; a defense's is sacks, interceptions and
   points allowed. The canonical scoring map scores NONE of those keys, so
   re-deriving turned every mirrored kicker and every mirrored defense into a flat
   0.00 across 1,119 production rows.
2. Even at the four positions we model, Sleeper's own published total is not the
   canonical dot product of its own line. A live 2026 quarterback row
   dot-products to 20.36 PPR while Sleeper publishes 23.26, because Sleeper scores
   keys the canonical map does not (that row carries `bonus_rush_td_qb`, `pass_fd`
   and `rush_fd`).

Both are fixed by treating our model as a DELTA on Sleeper's published total.
Scoring is linear in the stat line and so is the blend, so the blended total is
the weighted average of the two sources' own totals, and at a blend weight of 0
our row is byte-identical to Sleeper's in all three bases. That is what a mirror
should mean.

Output is a component stat line in Sleeper's own key vocabulary, so
`scoreStatMap()` prices it exactly under any league's settings:

```
QB   pass_att pass_cmp pass_yd pass_td pass_int rush_att rush_yd rush_td fum_lost
RB   rush_att rush_yd rush_td rec rec_tgt rec_yd rec_td fum_lost
WR   rec rec_tgt rec_yd rec_td rush_att rush_yd rush_td fum_lost
TE   rec rec_tgt rec_yd rec_td fum_lost
```

Kickers and defenses get no beacon projection in this build. Their production is
driven by team scoring and opponent turnovers rather than individual usage, so
they stay on Sleeper's number and the blend weight for those positions is zero.

### 3.7 Calibration

Every projection source over-spreads. The correction shrinks each projection
toward its positional mean by a measured slope:

```
calibrated = positionMean + slope[position] * (projected - positionMean)
```

Defaults are the published slopes (QB 0.67, TE 0.72, RB 0.79, WR 0.85), applied
to the BLENDED projection so it corrects Sleeper's spread as well as ours. It is
a settings value and the grading scoreboard in Part 5 is how we replace the
published numbers with our own.

This is deliberately applied after the blend and before storage, so what is
stored is what we believe, and no reader has to know the correction exists.

**IT APPLIES INSIDE THE STARTABLE RANGE ONLY.** This is a correction to the
plan, made during implementation after the first build was measured against
production. The published slopes were fitted among STARTERS, and applying them
to the whole projectable pool does real damage in the opposite direction:
compressing 130 tight ends toward a top-18 mean pulls every deep-bench player UP
toward a startable number. Measured on the first build, that inflated the average
tight end projection by 54 percent and turned a third-string tight end into a
plausible-looking streamer.

So the mean is taken over the startable depth (QB 24, RB 36, WR 48, TE 18, the
same counts `lib/power-pulse/default-settings.ts` used when it measured the
variance fallbacks, and for the same stated reason), and only rows at or above
that cut are calibrated. Everyone below keeps their number exactly. We measured a
relationship among starters, so we apply it among starters.

### 3.8 Blending

```
w = clamp(gamesThisSeason / gamesForMax, 0, 1) * (max - min) + min

final = w * beacon + (1 - w) * sleeper
```

Defaults: `min` 0.0, `max` 0.5, `gamesForMax` 6. In week 1 the beacon projection
contributes nothing and the stored row is Sleeper's, rescored. By week 7 it is a
half-and-half average, which is exactly what the aggregation research supports
and is a much better default than replacement. `max` is a settings value and the
scoreboard is what earns the right to raise it.

The blend runs component by component on the stat line, not on the point total,
so the result stays a real stat line that any scoring system can price.

### 3.9 Which source a reader gets

```
resolveProjectionSource(available, settings):
  if not settings.beaconProjections.enabled -> 'sleeper'
  if 'ffbeacon' rows cover the window        -> 'ffbeacon'
  otherwise                                  -> 'sleeper'
```

Every read goes through `lib/projections/read.ts`, which resolves the source,
loads the rows, and hands them to `projectPlayerWeek()`. No caller picks a source
and no caller reads a points column directly.

The feature ships with `enabled: false`. Turning it on is one admin edit after
the scoreboard says the blend is beating Sleeper, which means this entire build
can land without changing a single number on the site until we choose to.

---

## Part 4. Rest-of-season horizon, dynasty against redraft

Weekly projections are a redraft instrument. They answer "who do I start" and
"who wins my league this year". Dynasty value is a discounted stream and comes
from age curves, positional aging and pick capital, none of which a weekly
projection contains.

The rule this build adds: **projections carry more weight as the horizon
shortens.** `lib/trade-finder/rank.ts` already branches on contender against
rebuilder, so this is a weight on an existing branch rather than new machinery.

| Mode | Projected wins | Trade value |
| --- | --- | --- |
| Redraft, any mode | dominant | secondary |
| Dynasty, contender | dominant | secondary |
| Dynasty, balanced | even | even |
| Dynasty, rebuilder | small | dominant |

The one hard rule: a rebuilder's suggestion must never be re-ranked by a
rest-of-season projection, because a rebuilder does not care who wins in week 12
and a model that says otherwise is giving contender advice to somebody who told
us they are rebuilding.

---

## Part 5. Grading ourselves

`lib/calculate-projection-accuracy.ts` already grades projections against
actuals. Adding a `source` dimension turns it into a scoreboard: our mean
absolute error against Sleeper's, per position, per week, on the same graded
weeks with the same code.

This is the only thing that earns the phrase "our projections", it is what
promotes `beaconProjections.enabled` from false to true, and it is a genuine
transparency surface worth publishing rather than hiding in an admin page.

Admin surface at `/admin/projections`: per position, per source, weeks graded,
MAE, mean error (bias), beat rate, and the calibration slope we measured. Fully
keyboard navigable, one h1, a real `<table>` with `<caption>` and `scope`, and
every timestamp through `formatEastern()`.

---

## Part 6. Sources

External claims above trace to these. Everything else was measured directly.

- 4for4, Do Defenses Repeat Fantasy Football Performances. Year over year fantasy
  points allowed correlations by position.
- Yahoo Sports, Do defenses repeat performances year over year. Repeat rates for
  top and bottom five defenses.
- Fantasy Football Analytics, We Analyzed 12 Seasons of Fantasy Football
  Projections. Calibration slopes, MAE by source, aggregation benefit, preseason
  optimism bias.
- PFF, Expected fantasy points. Stability and predictiveness of expected points
  and expected touchdowns.
- Sharp Football Analysis, Expected Fantasy Points explained, and NFL implied
  team totals.
- ffopportunity (ffverse). Open-source expected points model on nflverse
  play-by-play.
- Footballguys, Ultimate Strength of Schedule. Removing schedule bias from
  fantasy points allowed.
- Fantasy Team Advice, Schedule-Adjusted Fantasy Points Allowed.
- The Fantasy Footballers, Lifecycle of a dynasty running back. Peak ages and
  value decay.
- Footballguys, When to expect an elite wide receiver to decline.
- FantasyPros touchdown regression report.

---

## Part 7. Task list

Full status lives in `progress.md` under the `PE-T###` prefix. This is the shape.

| Phase | Tasks | What lands |
| --- | --- | --- |
| 0 Records | PE-T000 to PE-T001 | this document, progress, handoff |
| 1 Opponent strength | PE-T010 to PE-T016 | migration 0237, adjustment, shrinkage, the five call sites |
| 2 Market signal | PE-T020 to PE-T025 | migration 0238, ESPN adapter, sync, cron, game environment |
| 3 Our projections | PE-T030 to PE-T038 | migration 0239, usage, volume, convert, calibrate, blend, engine, builder, cron |
| 4 One read path | PE-T040 to PE-T047 | `lib/projections/read.ts` and the six migrated consumers |
| 5 Grading | PE-T050 to PE-T053 | migration 0240, per-source accuracy, `/admin/projections` |
| 6 Horizon | PE-T060 to PE-T061 | dynasty against redraft weighting in trade ranking |
| 7 Review | PE-T070 to PE-T075 | four independent sub-agent reviews, fixes, report |

## Part 8. What this build deliberately does not do

- **No play-by-play ingestion.** A true expected-points model needs nflverse
  play-by-play, which is a data pipeline of its own. The usage model here is the
  90% version built on data we already hold.
- **No kicker or defense projections of our own.** Their production is not
  individual usage and the model would be worse than Sleeper's.
- **No per-league cron.** Same scaling rule as every other on-demand calc.
- **No replacement of Sleeper.** The blend caps at 0.5 by default and the whole
  feature ships disabled. Nothing changes on the site until the scoreboard says
  it should.
