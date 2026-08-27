# League Pulse: Positional WAR

Build plan. Nothing here has been built. Written 2026-08-26 against `main` at
`c068818`. Revised twice on 2026-08-26: once after a review pass on the model,
and once to bring every deferred extension into scope.

The ask: a multi-series line chart, one line per position, showing wins over
replacement by position rank, specific to the league the reader is looking at.
The chart's job is to answer "which positions are worth spending on in THIS
league", and its shape is the answer. A steep line means the position runs out
fast. A flat line means the next guy is nearly as good.

---

## Revision log

Six areas were re-examined against the repository before this revision. The
verdict on each, and what changed.

| # | Area | Verdict | Change |
| --- | --- | --- | --- |
| 1 | WAR baseline | **Valid. Math change.** | The first draft's baseline double-counted one starter's production. Section 4.4 now defines an explicit deficit term, and derives the reference distribution from the merged fill instead of `league_power_pulse_cache`. |
| 2 | Weekly positional demand | **Valid. Spec change.** | Section 4.3 now separates structural demand (one number, drives the axis and every label) from weekly seated counts (drive replacement level only). |
| 3 | Overlapping flex eligibility | **Partially valid. Spec + tests, no math change.** | The same-position method is correct for this metric and the optimizer is never rerun per player. Neither was stated. Section 4.5 states both, proves the ordering invariant, and section 9 adds seven flex configurations as tests. |
| 4 | Cross-league caching | **Valid. Architecture change.** | Section 6 defines an exact fingerprint, provable from `scoreStatMap`. It ships in phase 1 as an invalidation key, not as a sharing key. |
| 5 | Two meanings of WAR | **Valid. Naming rule + one plan item cut.** | No `WAR` token exists in the tree today. Section 7 fixes the vocabulary and rewrites the phase-2 Trade Ideas item that would have created the collision. |
| 6 | Failure, staleness, observability | **Valid, and not handled today.** | Section 8 adds status columns, a failure backoff, honest empty states, and an admin surface. Power Pulse's existing gap is documented, not silently expanded into. |

Two consequences worth naming up front, because they simplify the build:

- Positional WAR no longer reads `league_power_pulse_cache` at all. It is no
  longer sequenced after `refreshPowerPulse`; it becomes a fourth independent
  stage in the existing `Promise.all` in `pulseLeagueDerived`.
- The result is now a pure function of a small, enumerable set of league inputs.
  That is what makes the fingerprint in section 6 exact.

### Second revision: everything deferred is now in scope

The first revision left five items in a "phase 2" section and marked three tasks
optional. All eight are now in scope and specified in **section 15**. They are
labelled E1 through E8 and carry their own tasks, acceptance criteria, and tests.

| | Extension | Section |
| --- | --- | --- |
| E1 | Your team on the curve, plus an upgrade what-if that never borrows the WAR name | 15.1 |
| E2 | `?war=rank` raw position rank axis | 15.2 |
| E3 | Positional WAR as labelled context in Trade Ideas | 15.3 |
| E4 | Cross-league curve sharing, with a collision guard | 15.4 |
| E5 | A shareable OG image of the curve, and the route it belongs to | 15.5 |
| E6 | The rail summary card | 15.6 |
| E7 | The WAR settings block and its admin controls | 15.7 |
| E8 | Power Pulse observability parity | 15.8 |

Three of these change the base plan rather than only adding to it, and those
changes are already applied above:

- **E1 and E3 need a Sleeper id on every curve entry**, so section 5.2 now
  carries `sleeperId`. Without it, matching a curve against `rosters.player_ids`
  costs a second query on every render.
- **E8's retry reasoning is better than the first revision's**, so section 8.2
  now uses bypass conditions instead of a second backoff constant.
- **E4 ships**, so section 6.3 no longer defers sharing. It defers only the
  read-path change, which is a different and smaller thing.

---

## 1. Where it goes

The original suggestion was the right rail on `/leagues/[id]`. That rail is
declared at `app/leagues/[league_id]/page.tsx:300`:

```
<div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
```

340 CSS px, and only from the `xl` breakpoint up. Below `xl` the grid collapses
and the rail becomes full width, so the chart would have two very different
widths to work at. At 340px, minus the `Panel` padding, the plot area is about
290px. Six series, a y-axis, and a legend do not fit in 290px: series become
indistinguishable, x-axis tick labels collide, and the legend toggles cannot
hold the 44x44 tap target the project requires.

| Option | Plot width (desktop) | Discoverability | Verdict |
| --- | --- | --- | --- |
| Overview right rail | ~290px | Highest, sticky | Too narrow for 6 series. A summary card fits; the chart does not. |
| **Overview main column, under the rankings table** | ~700 to 900px | Highest, same page | **Recommended.** |
| Power Pulse page main column | ~700 to 900px | One click away | Good second home, better methodology context. |

**Recommendation: a new full-width `Panel` in the overview's main column,
immediately below `PowerRankingsSection`, inside its own `<Suspense>`
boundary.**

1. It is on the page the reader lands on.
2. It gets real width without the rail's constraints, and it is last in DOM order
   on the main column, so on a phone it lands after the rankings.
3. It continues the overview's argument. The rankings table says who is strong;
   the WAR curve says where strength in this league comes from.

The rail carries the finding rather than the graphic. The rail summary card
(E6, section 15.6, T-WAR-27) is a three-line text summary naming the scarcest
and deepest position with their numbers, anchoring down to the chart. It is part
of this build, and it is not a shrunken copy of the chart.

Secondary home: the same component and the same cached data on
`/leagues/[id]/power-pulse` under `ProjectedChampion`. That page already carries
`HowPowerPulseWorks` in its rail, which is where model explanation belongs. Ship
the overview first.

---

## 2. What already exists

### Code

| Module | What it gives Positional WAR |
| --- | --- |
| `lib/power-pulse/project.ts` `projectPlayerWeek()` | One player, one week, in the league's literal scoring, adjusted for opponent, reliability, availability, and injury. Returns `points` and `sigma` (`sigma = points * cv`, `lib/power-pulse/project.ts:251`). The single place a player gets projected anywhere in the product. |
| `lib/power-pulse/lineup.ts` `buildOptimalLineup()` | Exact maximum-weight fill via augmenting paths. Returns `{slots, total, benched}`. Both the seated set and `benched` are load-bearing here. |
| `lib/power-pulse/lineup.ts` `startingSlots()` | Expands `roster_positions` into startable tokens, dropping BN/IR/TAXI and any token with no projectable eligibility. |
| `lib/power-pulse/types.ts` `PULSE_SLOT_ELIGIBILITY` | Slot token to eligible positions, including `SUPER_FLEX`, `REC_FLEX`, `WR_TE`, `WRRB_FLEX`, `WRRB_WRT`, `Q_FLEX`. |
| `lib/power-pulse/math.ts` `normalCdf()`, `winProbability()` | The points-to-wins conversion, already written and already used by the simulator. |
| `lib/power-pulse/load.ts` | `loadLeague` (reads `playoff_week_start` out of `leagues.metadata.settings` via `positiveIntOrNull`), `loadPlayers`, `loadProjections`, `loadAccuracy`, `loadDefenseSplits`. Paged, keyset, count-guarded against the 1000-row cap. |
| `lib/league-scoring.ts` `scoreStatMap()`, `isUsableScoring()`, `closestScoringBase()` | The dot product, and the three functions the cache fingerprint is derived from. |
| `lib/faab/free-agents.ts` | Ownership subtraction. Used only for the read-time "rostered" annotation, never by the model. |
| `lib/faab/marginal.ts` `computeLineupSwap()` | The team-specific counterpart. Reruns `buildOptimalLineup` per week per candidate (lines 389, 405, 431, 453, 458). Cited here as the contrast, not reused. |
| `lib/draft-value/engine.ts` | Prior art for points above replacement, with a written record of two traps a naive build falls into. Its `flexShare` constant is what section 4.3 replaces with an exact solve. |
| `app/tools/beacon-breakdown/chart-kit.tsx` `ChartFigure` | The chart accessibility contract. Already solved, needs promoting out of the tool directory. |
| `components/player-profile/value-trend-chart.tsx` | The hand-rolled SVG line chart pattern. No chart library in this project and none needed. |

### Data

| Table | State today | Relevance |
| --- | --- | --- |
| `player_weekly_projections` | 2026 regular: 18,413 rows over 1,083 distinct players, weeks 1 to 18. Carries `updated_at`. | The whole projectable universe, not just rostered players. `updated_at` feeds the fingerprint. |
| `player_projection_accuracy` | Per player reliability, beat rate, availability, ratio stdev | Feeds `projectPlayerWeek` exactly as for Power Pulse. Keyed by scoring base. |
| `nfl_defense_vs_position` | Opponent multiplier per team, season, position | Same. Keyed by scoring base. |
| `leagues` | `roster_positions`, `scoring_settings`, `total_rosters`, `metadata.settings.playoff_week_start`, plus `pulse_status` / `pulse_error` / `last_pulsed_at` | The entire league-specific input, plus the precedent for the status columns in section 8. |
| `rosters` | `player_ids` | Read-time annotation only. |
| `guide_entries` (`kind = 'term'`, `is_global`) | Holds the Power Pulse glossary term added by migration `0167` | Where the Positional WAR term goes. |

Universe by position, 2026 regular season: WR 413, RB 233, TE 230, QB 133,
K 42, DEF 32.

---

## 3. The two metrics, named once

Resolved from concern 5. Verified: `grep` for `WAR`, `winsAboveReplacement`, and
"wins above replacement" across `lib/`, `components/`, `app/`, `supabase/`
returns nothing. There is no collision today. The collision would have been
created by the first draft's own phase-2 item.

| | **Positional WAR** | **Projected wins** |
| --- | --- | --- |
| Question | How scarce is this position in this league? | What does this move do to THIS roster? |
| Model | Player-independent. Every player evaluated against a league-average reference team and a league-average opponent. | Team-specific. The player's actual roster, before and after, through the season simulation. |
| Depends on who owns whom | No | Yes |
| Optimizer runs | Once per week per league, never per player | Once per week per candidate |
| Engine | `lib/positional-war/` (new) | `lib/power-pulse/what-if.ts simulateWithReplacements()`, `lib/faab/marginal.ts computeLineupSwap()` (both exist) |
| Storage | `league_positional_war_cache` | Not stored under any WAR name. `league_power_pulse_cache.expected_wins`, plus live computation in Trade Ideas and FAAB. |
| Code identifier | `positionalWar` / `positional_war` | `winsDelta` / `expectedWins` (already in use, `lib/trade-impact/outcome.ts:92`) |
| UI label | "Positional WAR" | "Projected wins", delta as "wins added" |

**Absolute rule, to be added to `CLAUDE.md` (T-WAR-22):** the token "WAR" names
exactly one metric in this product, the player-independent positional one, and
it carries the word "Positional" adjacent to it on first use in any surface.
Nothing that measures one specific roster may be called WAR, in code, in copy,
in a column name, or in a chart axis. A surface that shows both must show both
labels and must not place them in the same column.

The two numbers legitimately disagree, and that disagreement is the point. A
league where QB1 carries 0.65 Positional WAR still gives a reader who already
starts QB2 almost no wins added by acquiring him. Showing one under the other's
name would be a lie the reader cannot detect.

A Signal Guide term (T-WAR-20) explains the difference in the reader's own
words, following the pattern migration `0167` established for Power Pulse.

---

## 4. The model

### 4.1 Scope and universe

- **Positions**: every position this league can start, derived from
  `roster_positions` through `startingSlots()` and `PULSE_SLOT_ELIGIBILITY`. A
  league with no K slot gets no K line. Same derivation
  `lib/faab/free-agents.ts startablePositions()` already uses.
- **Players**: every player at those positions with at least one weekly
  projection in the window, whether rostered or not. Ownership never enters the
  model.
- **Weeks**: `fromWeek = currentWeek` through `toWeek = playoffWeekStart - 1`,
  with `currentWeek` from `resolveCurrentWeek()` and `playoffWeekStart` from
  `loadLeague`, which already guards Sleeper's unset-as-zero case through
  `positiveIntOrNull`. This is a rest-of-season measure, matching every other
  number on the page. In the preseason it is the full season, which makes the
  curve a draft-prep artifact before a draft has happened.
- **Team count**: `leagues.total_rosters` when it is a positive integer.
  Otherwise the count of stored `rosters` rows. If neither is available, skip
  with reason `unknown team count`. Never default silently to 12.
- **Projection**: `projectPlayerWeek()`, unchanged. A null projection is a bye
  or an unpublished week and contributes nothing. It is never a zero.
  `lib/sleeper.ts PROJECTION_POSITIONS` is `DEF, K, QB, RB, TE, WR`, so an IDP
  league's defensive slots have no projection and are excluded with a stated
  footnote, matching the Schedules page rule.

### 4.2 The merged fill: one algorithm, run W + 1 times

Everything below is read off one construction. Build a single lineup of
`teamCount` copies of the league's startable slots and fill it optimally from
the whole projectable universe.

```ts
const perTeam    = startingSlots(league.rosterPositions);            // e.g. 10 tokens
const leagueWide = Array.from({length: teamCount}, () => perTeam).flat();  // e.g. 120
const fill       = buildOptimalLineup(leagueWide, candidatesForWeek);
// fill.slots  -> the seated players, one per slot
// fill.benched-> everyone who did not seat
```

Run it once per week in the window (the weekly fills), plus once over the
bye-free universe (the structural fill, section 4.3). That is `W + 1` calls per
league, where `W` is typically 10 to 17.

**The optimizer is never rerun per player.** No player is ever removed and the
lineup refilled. That is the team-specific model's job, and
`lib/faab/marginal.ts` already does it correctly, including cascading lineup
changes, by rebuilding the whole lineup with the same exact fill. Positional WAR
reads its inputs off a single fill and then does arithmetic. Cost is
`O(W * V * E)`, not `O(P * W * V * E)`.

**Ordering invariant, provable and testable.** `buildOptimalLineup` offers
candidates in descending points and admits via augmenting paths. Two players at
the same position have identical slot eligibility, so if the higher-scoring one
cannot seat, neither can the lower-scoring one. Therefore, within any single
position, **the seated players are exactly the top k by that week's points**. Two
consequences the implementation may rely on:

```
replacement(pos, w)  = points of the (seatedCount(pos, w) + 1)-th best player at pos in week w
                     = max points among fill.benched at pos
                     (the two definitions are identical; use whichever reads better)

max(benched at pos) <= min(seated at pos)     for every position, every week
```

The second line is an assertion the tests enforce (section 9). If it ever fails,
the optimizer changed and this model is invalid.

### 4.3 Positional demand: structural versus weekly

Resolved from concern 2. Demand does vary week to week, and the chart does need
one number. Both are true, and they are different quantities doing different
jobs.

**Structural demand, one integer per position.** Run the merged fill once over
the **bye-free universe**: each player represented by the arithmetic mean of his
`points` across the weeks in the window for which a projection exists. Every
player is present, so no bye removes anyone.

```
structuralDemand(pos) = count of seated players at pos in the structural fill
```

It is an integer, not a fraction, which is a real improvement on the
`teams * (starters + flexShare * flex)` formulation the draft-value engine uses.
"In this league, 28 running backs start" is a sentence a reader can check.

For a position with only dedicated slots it is exactly
`teamCount * dedicatedSlotCount(pos)` and can never vary. Only flex-eligible
positions can move, and the total movement across all of them is bounded by
`teamCount * flexSlotCount`.

**Weekly seated counts.** `seatedCount(pos, w)` from each weekly fill. These
vary, because a heavy bye week at tight end pushes flex slots toward running
backs and receivers.

**Which quantity drives what. This table is the specification.**

| Consumer | Uses | Why |
| --- | --- | --- |
| `replacement(pos, w)` in the PAR calculation | **weekly** | A bye week genuinely lowers replacement level, and that is exactly the week a starter is worth most. |
| `avgSeated(pos, w)` and `deficit(pos, w)` | **weekly** | Must come from the same fill as the replacement it is subtracted from. |
| `mu_ref(w)`, `sigma_ref(w)` | **weekly** | Same fill. |
| x-axis normalizer `x = positionRank / demand` | **structural** | A wobbling axis is unreadable and unshareable. |
| The `x = 1.0` tick label ("28 RBs start here") | **structural** | It is a fact about the league, not about a week. |
| `war_at_demand` stored column | **structural** | Defined as the WAR of the player at `positionRank === structuralDemand`. |
| Every sentence of copy, the legend headline, the footnote | **structural** | One number, stated once. |
| `curve` depth cap `ceil(demand * displayDepthMultiple)` | **structural** | Stable row counts across recomputes. |

**Consequence that must be stated in the UI and must not be "fixed" later.**
Because replacement is weekly and the axis is structural, the curve does not
cross exactly zero at `x = 1.0`. The player at `positionRank = structuralDemand`
has a small positive WAR: he beats the weekly replacement in most weeks. This is
correct. The marker at `x = 1.0` is therefore labeled with its real value, not
with zero:

> RB28, the last running back this league starts, is worth 0.11 wins over
> replacement.

That is a better fact than an asserted zero. An acceptance criterion in section
10 pins it.

`weeklySeated` is stored per position in `weekly_diagnostics` so the divergence
between structural and weekly is inspectable without a recompute.

### 4.4 Baseline, evaluated lineup, and why nothing is double-counted

Resolved from concern 1. This is the change with the largest correctness impact.

**The reference distribution comes from the merged fill, not from
`league_power_pulse_cache`.** The first draft read `mu_ref` from the stored
per-team weekly means. That has two defects: the reference team then depends on
who owns whom, so a trade moves a positional scarcity curve for reasons that
have nothing to do with scarcity; and `avgSeated(pos, w)` would come from a
different world than `mu_ref(w)`, so the subtraction in the formula below would
not be internally consistent. Derive both from the same fill.

```
mu_ref(w)    = ( sum over fill.slots of slot.points ) / teamCount
sigma_ref(w) = sqrt( ( sum over fill.slots of slot.sigma^2 ) / teamCount )
```

`mu_ref` is the average team's projected optimal lineup total under an ideal
allocation of the league's own player pool. `sigma_ref` follows from summing
variances within a team and averaging across teams, which is the same
independence simplification `lineupSigma()` and `winProbability()` already make
and document.

**Per position, per week, from the same fill:**

```
seated(pos, w)       = fill.slots occupied by a player at pos
avgSeated(pos, w)    = mean of seated(pos, w) points
replacement(pos, w)  = max points among fill.benched at pos
deficit(pos, w)      = max(0, avgSeated(pos, w) - replacement(pos, w))
```

**The two lineups, stated explicitly.**

The **baseline** team is league-average at every startable slot except one slot
of the evaluated player's position, which holds the replacement-level player at
that position. It contains, in full: the league-average seated production at
every other slot, and `replacement(pos, w)` at the evaluated slot. It contains
no part of the evaluated player.

The **evaluated** team is the same team with the evaluated player substituted
into that one slot, in place of the replacement.

```
PAR(p, w)      = max(0, projected(p, w) - replacement(pos(p), w))

baselineMean(pos, w)  = max(0, mu_ref(w) - avgSeated(pos, w) + replacement(pos, w))
                      = max(0, mu_ref(w) - deficit(pos, w))

evaluatedMean(p, w)   = mu_ref(w) - avgSeated(pos, w) + projected(p, w)
                      = baselineMean(pos, w) + PAR(p, w)
```

**The subtraction of `avgSeated` is the anti-double-count.** Without it, the
evaluated team's mean is `mu_ref(w) + PAR(p, w)`, which describes a team holding
both a league-average starter at the position AND the evaluated player's
production above replacement, in the same slot. That slot would contribute
`avgSeated + projected - replacement`, which exceeds what the evaluated player
projects by exactly `deficit(pos, w)`. Section 4.4.1 shows how much that costs.

**The win conversion.** Opponent is the league-average team, `mu_ref(w)` with
`sigma_ref(w)`. Both sides of the comparison use `sigma_ref(w)` for the team
being evaluated (see the simplification note below), so:

```
sigmaD(w)      = sqrt( sigma_ref(w)^2 + sigma_ref(w)^2 ) = sigma_ref(w) * sqrt(2)

weeklyWAR(p, w) = normalCdf( (baselineMean + PAR(p,w) - mu_ref(w)) / sigmaD(w) )
                - normalCdf( (baselineMean            - mu_ref(w)) / sigmaD(w) )

                = normalCdf( (PAR(p,w) - deficit(pos,w)) / sigmaD(w) )
                - normalCdf( (         - deficit(pos,w)) / sigmaD(w) )

seasonWAR(p)    = sum over w in window of weeklyWAR(p, w)
```

Properties, each of which is an acceptance criterion:

- `PAR = 0` gives `weeklyWAR = 0` exactly, for every position and every week.
- `weeklyWAR >= 0` always, since `normalCdf` is non-decreasing and `PAR >= 0`.
  Season WAR therefore needs no clamp and can never be negative.
- Strictly increasing in `PAR`, so raising a projection can never lower WAR.
- Season WAR is the sum of weekly win-probability differences by construction,
  which is one of the brief's validation items.
- Deterministic. No RNG anywhere. Two runs on identical input are byte-identical.
- Roughly `1083 * W` `normalCdf` calls per league, about 15,000. Free.

**Sigma simplification, to be stated in the module header.** The evaluated
lineup's true sigma differs from the baseline's, because the evaluated player's
own sigma replaces the replacement player's. Both sides use `sigma_ref(w)`
instead. Near parity the win-probability derivative with respect to sigma is
second order against the derivative with respect to the mean, and carrying the
per-player sigma would make WAR depend on a player's volatility in a way the
chart's axis does not claim to measure. It is a deliberate simplification, not
an oversight, and it is why `sigmaD` is a per-week rather than a per-player
quantity.

#### 4.4.1 Worked example

Illustrative numbers, chosen round. A 12-team league running
`[QB, RB, RB, WR, WR, WR, TE, FLEX, K, DEF]`, so 10 startable slots and a merged
lineup of 120. Evaluating the top tight end in week 5.

**From the week 5 merged fill:**

```
seatedCount:   QB 12   RB 28   WR 42   TE 14   K 12   DEF 12    (total 120)
sum of seated points                       = 1,560.0
sum of seated sigma^2                      = 8,640.0

mu_ref(5)     = 1560.0 / 12          = 130.00
sigma_ref(5)  = sqrt(8640.0 / 12)    = sqrt(720)  = 26.83
sigmaD(5)     = 26.83 * sqrt(2)                   = 37.94
```

**Tight end specifics for week 5:**

```
avgSeated(TE, 5)     = 12.50      (mean of the 14 seated tight ends)
replacement(TE, 5)   =  8.00      (best benched tight end, i.e. TE15 this week)
deficit(TE, 5)       = 12.50 - 8.00 = 4.50
```

**Evaluating a tight end projected at 16.00 points in week 5:**

```
PAR            = max(0, 16.00 - 8.00)               =  8.00

baselineMean   = 130.00 - 12.50 + 8.00              = 125.50
evaluatedMean  = 130.00 - 12.50 + 16.00             = 133.50
                 (equals baselineMean + PAR)          133.50   OK

P(win | evaluated) = normalCdf( (133.50 - 130.00) / 37.94 )
                   = normalCdf( 0.09225 )           =  0.53675
P(win | baseline)  = normalCdf( (125.50 - 130.00) / 37.94 )
                   = normalCdf( -0.11861 )          =  0.45280

weeklyWAR(TE1, 5)  = 0.53675 - 0.45280              =  0.08395
```

Read the baseline out loud to check it: a team scoring 125.50, which is the
league average of 130.00 less the 4.50 by which an average starting tight end
beats the best tight end nobody starts. That is a team with a waiver tight end
and league-average everything else. That is what "replacement" means.

**What the double-count would have cost.** Using `mu_ref` as the baseline:

```
P(win | evaluated) = normalCdf( 8.00 / 37.94 ) = normalCdf(0.21086) = 0.58351
P(win | baseline)  = 0.50000
weeklyWAR                                                          = 0.08351
```

0.08351 against 0.08395, a 0.5% difference, because `normalCdf` is close to
linear near zero. The error is small at realistic magnitudes and it is not
always small. In a low-variance league with `sigma_ref = 12` (`sigmaD = 16.97`),
a position with `deficit = 8` and a player at `PAR = 20`:

```
correct:      normalCdf((20-8)/16.97) - normalCdf(-8/16.97)
            = normalCdf(0.7072) - normalCdf(-0.4714)
            = 0.76020 - 0.31870                            = 0.44150

double-count: normalCdf(20/16.97) - 0.5
            = 0.88070 - 0.50000                            = 0.38070
```

16% low, and low in the region of the chart readers care about most. More to the
point, the double-counted version describes a team that does not exist, so no
sentence written about the baseline would be true. The correct form costs one
subtraction of a quantity the fill already produced.

#### 4.4.2 Does the evaluated player's presence in the league contaminate `mu_ref`?

Raised as part of concern 1, and worth answering directly. Yes, a rostered
player contributes to `mu_ref`, at roughly `1 / teamCount` of his own
production. That is not a double count, for two reasons.

First, `mu_ref` is a scale, not an accumulator. It answers "what does a typical
team in this league score", and a typical team does contain starters. The
evaluated team is a hypothetical roster constructed from that scale, not the
league total with a player added to it.

Second, the contamination is symmetric. The evaluated player sits inside both
`mu_ref` and `avgSeated(pos)`, and the formula subtracts `avgSeated(pos)` before
adding him. The residual is his `1/teamCount` share of `mu_ref`, which appears
identically on both sides of the difference and cancels exactly in
`weeklyWAR = P(evaluated) - P(baseline)` only to first order, since the CDF is
nonlinear. The second-order residual is bounded by
`(projected / teamCount) * max|normalCdf''| / sigmaD`, which for a 12-team
league and a 20-point player is under `1e-4` wins per week.

Deriving `mu_ref` from the merged fill rather than from actual rosters also
means the contamination does not move when a trade happens, which was the more
serious version of this problem. A curve that shifts because two managers swapped
players is measuring the wrong thing. This one does not.

### 4.5 Replacement level with overlapping flex eligibility

Resolved from concern 3. Conclusion: **the same-position definition is correct
for this metric, no math change is required, and the plan must say so
explicitly** because two other definitions are defensible and an implementer
choosing differently would produce a chart that looks right and is not.

**Three candidate definitions.**

| | Definition | What it measures |
| --- | --- | --- |
| A | `replacement(pos) = best benched player at pos` | How far the pool at this position falls off. **This is what we use.** |
| B | `replacement(slot) = best benched player eligible for that slot` | What the marginal slot would actually get filled with. |
| C | Rerun the fill with the player removed, take the total delta | What losing this specific player costs a specific roster. |

**Why A.** The chart's axis is "wins over replacement" with one series per
position. For the six series to be comparable, replacement must be defined
per position on the same terms for all six. Definition B is not per position at
all: a dedicated RB slot and a FLEX slot in the same league would yield different
replacement levels for the same position, and there is no single number to plot.
Definition C is the team-specific metric from section 3 and belongs in Trade
Ideas, not on this chart.

**A also behaves correctly under flex, which is the substance of the concern.**
Because the merged fill is greedy by points, the marginal seated player across
all flex-eligible positions sits at roughly the same points level. So in a
league with a large FLEX, `replacement(RB)`, `replacement(WR)`, and
`replacement(TE)` converge, and the three curves flatten toward each other. That
convergence IS the scarcity signal: a deep flex means the positions substitute
for one another. Meanwhile QB in a one-QB league sits at a far higher replacement
because quarterbacks have nowhere else to go, which is exactly why the QB curve
is short and steep. The model produces this with no positional special case.

`SUPER_FLEX` and `Q_FLEX` make QB flex-eligible, so the fill seats a second
quarterback per team wherever QB25 out-projects the best flex alternative, and
`replacement(QB)` drops accordingly. `REC_FLEX` and `WR_TE` exclude RB.
`WRRB_FLEX` excludes TE. A literal second `QB` token seats `2 * teamCount`
quarterbacks unconditionally, which is not the same as superflex and must not
be conflated with it. All six behaviors fall out of `PULSE_SLOT_ELIGIBILITY` and
are pinned by tests in section 9.

**"What happens when removing a player causes multiple lineup changes."** In this
model, nothing, because no player is ever removed. Stated again here because it
is the single most likely wrong assumption an implementer could make: seeing
`buildOptimalLineup` in the imports, the natural instinct is to write a
per-player refill loop. That loop would be 1,083 times more expensive and would
compute definition C, which is a different metric under the same name, which is
precisely what section 3 forbids.

**Shallow pool edge case.** If a position has fewer projectable players than its
seated count, `fill.benched` holds none at that position and `replacement(pos, w)`
is undefined. Handle it by setting `replacement(pos, w)` to the minimum seated
points at that position and setting `shallow_pool = true` on the stored row. The
footnote then says the position's pool is shallower than the league starts, so
the curve understates scarcity. Do not substitute zero: a zero replacement would
hand every player at that position a fabricated edge. With DEF at 32 players and
K at 42 this only bites a 16-team-plus league, but it must be specified.

### 4.6 Position rank and the shape of the curve

```
positionRank = rank within position by descending seasonWAR,
               ties broken by descending seasonPAR,
               then by playerId ascending (determinism)
```

Rank is by WAR, per the brief. It can legitimately differ from a season-points
rank: a player who is strong across the whole window outranks one whose points
are concentrated in weeks that fall outside it, or who carries a bye during a
thin week. That is the model working, not drifting.

Because the series is sorted by the plotted value, **the curve is monotonically
non-increasing by construction**, which section 10 pins as an acceptance
criterion. If a rendered series ever rises left to right, the sort or the join
is broken.

### 4.7 Sanity check against real 2026 data

Season totals, PPR, from `player_weekly_projections`, for a 12-team 1QB league
running 2RB/3WR/1TE/1FLEX. These are back-of-envelope from season totals rather
than engine output; they exist to catch an implementation that is off by an
order of magnitude.

| Position | Structural demand | Replacement | Season pts | Per week | Rank 1 | Per week | PAR/wk |
| --- | --- | --- | --- | --- | --- | --- | --- |
| QB | 12 | QB13 Bo Nix | 347.5 | 19.3 | Josh Allen 392.2 | 21.8 | 2.5 |
| RB | ~28 | RB29 | ~180 | ~10.0 | Jahmyr Gibbs 381.2 | 21.2 | 11.2 |
| WR | ~42 | WR43 Brian Thomas | 184.0 | 10.2 | Jaxon Smith-Njigba 358.4 | 19.9 | 9.7 |
| TE | 12 | TE13 Jake Ferguson | 167.8 | 9.3 | Brock Bowers 275.8 | 15.3 | 6.0 |
| K | 12 | K13 Harrison Butker | 122.4 | 6.8 | Cameron Dicker 135.3 | 7.5 | 0.7 |
| DEF | 12 | DEF13 Steelers | 112.9 | 6.3 | Rams 150.6 | 8.4 | 2.1 |

Switch to superflex and structural QB demand goes to 24, replacement moves to
QB25 (Daniel Jones, 314.8, 17.5 per week), and the top quarterback's PAR rises
from 2.5 to 4.3 per week, a 72% jump from one setting.

Expected rank-1 season WAR over a 14-week window, using the section 4.4 formula
with `sigma_ref` near 26 and realistic deficits: RB about 1.6 to 1.9, WR about
1.3 to 1.5, TE about 0.8 to 1.0, QB about 0.35 to 0.45 in one-QB and 0.6 to 0.7
in superflex, DEF about 0.3, K about 0.1. An implementation landing outside
those bands by more than a factor of two has a bug.

---

## 5. Storage

### 5.1 `league_positional_war_cache`

One row per (league, season, position). Six rows per league, not a thousand,
because the curve is the unit the UI reads.

```sql
league_id            uuid    not null references leagues(id) on delete cascade
season               integer not null
position             text    not null check (position in ('QB','RB','WR','TE','K','DEF'))

-- Section 4.3. Integer, from the structural fill. Drives axis, labels, copy.
structural_demand    integer not null
-- Section 4.4, averaged across the window. For the footnote and the tooltip.
replacement_points   numeric
avg_seated_points    numeric
deficit              numeric
-- Section 4.5. True when the pool is thinner than the league starts.
shallow_pool         boolean not null default false

-- Headline figures, so the rail summary and any sort can read them as columns.
war_rank_1           numeric
war_at_demand        numeric      -- WAR of the player at positionRank = structural_demand
cliff_rank           integer      -- first rank where WAR < cliffThreshold * war_rank_1

-- The plotted records. Section 5.2.
curve                jsonb   not null default '[]'::jsonb
-- Per week: seatedCount, replacement, avgSeated, deficit, muRef, sigmaRef.
weekly_diagnostics   jsonb   not null default '{}'::jsonb

from_week            integer not null
through_week         integer not null
-- Section 6. Invalidation key here, and the join key into
-- positional_war_curves on the write path (E4, section 15.4).
fingerprint          text    not null
model_version        text    not null default 'war-1'
generated_at         timestamptz not null default now()
unique (league_id, season, position)
```

Index on `(league_id, season)`, matching `0165`.

RLS, copied from `supabase/migrations/0165_league_power_pulse_cache.sql`:

- `league_positional_war_cache_select_public` for `anon, authenticated`
- `league_positional_war_cache_service_role_all` for `service_role`
- no client writes
- access matrix documented at the top of the migration file
- migration comment states that this table is independent of value source and
  of `format_config_id`, the same way `0165` does

Next free migration number: `0211`.

### 5.2 `curve` entries

Capped at `max(minDisplayDepth, ceil(structural_demand * displayDepthMultiple))`.
Past two and a half times demand every series is flat and adds pixels without
adding information.

```
{
  playerId, sleeperId, slug, name, team,
  positionRank,
  war,                        // season WAR, 3 decimals
  pointsAboveReplacement,     // season PAR, 1 decimal
  projectedPointsPerWeek,     // mean over weeks with a projection
  replacementPointsPerWeek,   // mean over the window
  weeksProjected              // how many of the window's weeks he has a projection for
}
```

`sleeperId` is stored because two consumers join a curve against
`rosters.player_ids`, which holds Sleeper ids: the team overlay (15.1) and the
Trade Ideas note (15.3). Resolving 300 FF Beacon player ids back to Sleeper ids
on every render would be a second query for a value the engine already holds.
It is nullable: a player with no Sleeper mapping still belongs on the curve, he
simply can never match a roster.

Ownership itself is deliberately not stored. It is resolved at read time from
`rosters.player_ids`, the same cached-universe / live-ownership split
`lib/faab/free-agents.ts` already uses, so a waiver that cleared five minutes
ago is reflected without a recompute. This is also what makes a curve shareable
between leagues (15.4): the stored row contains nothing about who owns whom.

`replacementPlayerId` from the brief's example record is omitted: the
replacement is a per-week quantity, so no single player is "the" replacement over
a 14-week window. `replacementPointsPerWeek` carries the number that matters, and
`weekly_diagnostics` carries the per-week detail for anyone auditing.

---

## 6. Cross-league caching and the fingerprint

Resolved from concern 4. The goal, in the concern's own words, is to prevent
"two leagues with superficially identical settings but meaningfully different WAR
inputs" from sharing a result.

### 6.1 Every input that can change the result

Because section 4.4 removed the `league_power_pulse_cache` dependency, the
result is now a pure function of a short, enumerable list. Derived by reading
the call chain: `projectPlayerWeek` reads `scoringSettings`, `defense`,
`defenseSeasons`, `week`, `currentWeek`, `settings`, and the per-player
`accuracy` and `injuryStatus`. `loadAccuracy` and `loadDefenseSplits` are keyed
by `closestScoringBase(scoringSettings)`. `buildOptimalLineup` reads the slot
list. Nothing in the chain reads a roster.

**In the fingerprint:**

| Input | Source | Why |
| --- | --- | --- |
| `season` | `leagues.season` | Different projections, different defense splits. |
| `fromWeek`, `toWeek` | `resolveCurrentWeek`, `playoff_week_start` | Two leagues with identical settings and different playoff start dates evaluate different windows. |
| `teamCount` | `total_rosters`, per section 4.1 | Directly scales the merged lineup. |
| `slots` | `startingSlots(roster_positions)`, sorted | Sorted because the fill's seated SET is invariant under slot permutation. Sorting maximizes correct sharing without risking a false hit. |
| `scoring` | `normalizedScoring(scoring_settings)` | Section 6.2. The exact set the dot product reads. |
| `scoringUsable` | `isUsableScoring(scoring_settings)` | `scoreWithFallback` branches on it. |
| `scoringBase` | `closestScoringBase(scoring_settings)` | Selects which `player_projection_accuracy` and `nfl_defense_vs_position` rows load. |
| `pulseSettings` | the reliability, availability, injury, opponent, variance, and recency blocks of `league_power_pulse_settings` | Global today, but an admin edit must invalidate every league. |
| `warSettings` | `displayDepthMultiple`, `minDisplayDepth`, `cliffThreshold`, `clampBelowReplacement` | Change the stored curve. |
| `modelVersion` | `war-N` | The manual override for any change not otherwise captured. |
| `projectionsSnapshot` | `max(updated_at)` of `player_weekly_projections` for `(season, 'regular', week >= fromWeek)`, truncated to the hour | The nightly sync changes every number. Truncating to the hour stops a mid-sync partial state from minting thousands of distinct fingerprints. |
| `v: 1` | constant | Fingerprint schema version, so a future field addition is not silently a cache hit. |

**Deliberately excluded, with the reason:**

| Excluded | Why it cannot change the result |
| --- | --- |
| `rosters.player_ids`, ownership, transactions | Section 4.4. The model reads no roster. |
| Source slug, `format_config_id` | Positional WAR is source-independent and format-independent by contract (section 7). |
| `playoff_teams` | Only the season simulator uses it. This model has no bracket. |
| `league_matchups`, the head-to-head schedule | Never read. This is why the `failedWeeks` guard does not apply here. |
| League name, status, division and waiver settings, FAAB budget | Not read. |
| Unprojectable slot tokens (IDP, unknown) | `startingSlots()` drops them before hashing. Two leagues differing only in IDP slots produce the same curve, correctly. Their FOOTNOTES differ and are rendered per league from the raw `roster_positions`, never from the fingerprint. |

### 6.2 `normalizedScoring`, provable rather than heuristic

`scoreStatMap` at `lib/league-scoring.ts:100` iterates the scoring map and skips
an entry when the value is not a finite number, when the value is exactly `0`,
or when `isNonScoringKey(key)`. The set of entries that can affect any player's
score is therefore exactly:

```ts
function normalizedScoring(s: ScoringSettings | null): Array<[string, number]> {
  if (!s) return [];
  return Object.entries(s)
    .filter(([k, v]) =>
      typeof v === "number" && Number.isFinite(v) && v !== 0 && !isNonScoringKey(k))
    .map(([k, v]) => [k, Number(v.toFixed(6))] as [string, number])   // kill float noise
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}
```

Two leagues whose normalized scoring is identical produce byte-identical points
for every player in every week. That is a property of the code, not an
assumption, and `isNonScoringKey` must be exported from `lib/league-scoring.ts`
for this (T-WAR-04). If the filtering in `scoreStatMap` ever changes, this
function changes with it, and a test asserts the two stay in step.

The `toFixed(6)` rounding is the one place a false hit could theoretically be
introduced: two leagues differing at the seventh decimal of a scoring value would
share a fingerprint. No Sleeper league expresses scoring at that precision, and
the alternative is a fingerprint that changes on float representation noise.
Documented rather than left implicit.

### 6.3 What ships in phase 1, and what does not

**Ships: the fingerprint as an invalidation key.** Store it on every cached row.
Staleness is:

```
stale = no rows for (league, season)
      OR storedFingerprint !== computedFingerprint
      OR storedModelVersion !== currentModelVersion
      OR storedThroughWeek < currentWeek - 1
      OR age(generated_at) >= POSITIONAL_WAR_TTL_MS
```

This is strictly better than a TTL alone: a commissioner who turns on TE premium
at 11pm sees a corrected curve on the next page view rather than up to twelve
hours later.

**Also ships, as E4: sharing the COMPUTE across leagues.** Section 15.4 adds
`positional_war_curves`, keyed by `(fingerprint, position)`, consulted on the
write path only. A league whose fingerprint is already present copies six rows
instead of running the universe read and `W + 1` fills. **The read path does not
change**: `league_positional_war_cache` stays denormalized at six rows per
league, so every consumer keeps its single query.

The silent-failure risk that argued for deferring this is answered by the
inputs-digest guard in 15.4.3, which turns a fingerprint collision into a logged
error and a fresh computation rather than a wrong curve nobody notices.

**Still deferred: making the read path a pointer.** Replacing the denormalized
rows with a `(league, season) -> fingerprint` pointer would save storage and cost
a join on every read. At 212 leagues the duplicated curves are about 12MB, so
there is nothing to buy yet. Revisit past roughly 10,000 leagues, where it is
about 600MB and worth the join.

### 6.4 False-hit scenarios and what catches each

The table the concern asks for. Every row is a test in section 9.

| Two leagues that look the same but are not | Caught by |
| --- | --- |
| Identical slots and team count, one has `bonus_rec_te: 0.5` | `scoring` (normalized map differs) |
| Identical slots, one has kicker distance bonuses | `scoring` |
| Identical slots, one scores 6-point passing TDs | `scoring` |
| Identical everything, different season | `season` |
| Identical everything, playoffs start week 14 versus week 15 | `toWeek` |
| Identical settings, 10 teams versus 12 | `teamCount` |
| `SUPER_FLEX` versus a second literal `QB` token | `slots` (different token multiset) |
| `FLEX` versus `REC_FLEX` | `slots` |
| Same league, before and after the nightly projections sync | `projectionsSnapshot` |
| Same league, after an admin edits the reliability weights | `pulseSettings` |
| Same league, after `displayDepthMultiple` changes | `warSettings` |
| Same league, `roster_positions` reordered but the same multiset | Intentionally NOT caught. The seated set is invariant under slot permutation, so the curve is identical. Sharing is correct. |
| One league runs IDP slots, the other runs bench slots in their place | Intentionally NOT caught for the curve. The footnote differs and is rendered per league. |

---

## 7. Format and source rules

**League format resolution.** This is a league view, so format comes from
`resolveLeagueContext()` and never from `?format=`, a cookie, or
`user_preferences`. In practice the model reads no `format_config_id` at all: it
scores under the league's literal `scoring_settings` through
`lib/league-scoring.ts`, which is stricter than the format resolver and is what
Power Pulse already does.

**Source.** Positional WAR does not vary by value source, for the same reason
Power Pulse does not: it is built from Sleeper projections and league scoring,
not from a value provider's rankings. Flipping the source toggle must not
invalidate the cache, and `source` is deliberately absent from the fingerprint.
State this in the migration comment the way `0165` does.

**Draft picks contribute nothing**, for the same reason Power Pulse excludes
them. A 2028 first cannot start.

---

## 8. Failure, staleness, and observability

Resolved from concern 6. **The concern is valid and the existing system does not
handle it.** `powerPulseIsStale` returns `true` whenever there are no rows
(`lib/league-power-pulse.ts:60`), so a league that fails or skips
deterministically re-attempts on every single page view, and
`calculateLeaguePowerPulse`'s `skipped` reason is logged to the console and never
persisted. The user-facing result is the panel at
`app/leagues/[league_id]/power-pulse/page.tsx:372` saying "Power Pulse is still
calculating" indefinitely, with no way for anyone to learn why.

Do not copy that pattern. Power Pulse is brought level with it in the same
build: **E8, section 15.8, tasks T-WAR-49 through T-WAR-52**, which apply the
status columns, the backoff, and the honest empty states below to Power Pulse
as well. E8 lands on its own commit because it changes a shipped feature, and no
Positional WAR task depends on it, but it is a required part of this work rather
than a follow-up.

### 8.1 Status columns on `leagues`

Mirrors the existing `pulse_status` / `pulse_error` / `last_pulsed_at` trio, so
the UI and the admin panel already know the shape. Migration `0212`.

```sql
alter table public.leagues
  add column if not exists positional_war_status text
    check (positional_war_status in ('pending','ok','skipped','settled','error')),
  add column if not exists positional_war_detail text,
  add column if not exists positional_war_attempted_at timestamptz,
  add column if not exists positional_war_succeeded_at timestamptz;
```

- `ok`: rows written. `positional_war_detail` holds `"6 positions, 412ms"`.
- `skipped`: a transient reason worth retrying soon (no projections loaded yet,
  team count unknown because rosters have not synced).
- `settled`: a reason that will not change without a new season or a new week
  window (no remaining regular-season weeks, no projections stored for the
  season at all). Distinguished from `skipped` purely so the backoff can be
  longer.
- `error`: something threw. `positional_war_detail` holds the message, truncated
  to 500 characters, with no stack and no connection string.

`positional_war_detail` is written by server code only, is never
user-controlled, and is rendered as text, never as HTML.

### 8.2 Backoff

```
POSITIONAL_WAR_TTL_MS   = 12 * 60 * 60 * 1000   // matches POWER_PULSE_TTL_MS
POSITIONAL_WAR_RETRY_MS =      15 * 60 * 1000   // after any non-'ok' verdict
```

`refreshPositionalWar` returns immediately, before any load, when the last
attempt was not `ok` and landed within `POSITIONAL_WAR_RETRY_MS`.

**Bypass conditions, by status.** One backoff constant with explicit bypasses is
better than a second, longer constant, because the thing that makes a retry
worthwhile is a change in the inputs, not the passage of time.

| Last status | Retry immediately when |
| --- | --- |
| `error`, `skipped` | `force: true`, OR the fingerprint changed, OR `leagues.last_pulsed_at` advanced since `positional_war_attempted_at` |
| `settled` | `force: true`, OR `(season, fromWeek, toWeek)` changed |

The `last_pulsed_at` clause is what keeps a league responsive on draft night. A
`skipped` verdict of "draft pending with empty rosters" would otherwise sit for
fifteen minutes after the draft ends. `pulseLeagueCore` writes rosters and
advances `last_pulsed_at`, so the next view retries at once. This is the single
mechanism, and it covers roster syncs, schedule publication, and a league that
was mid-creation on the first attempt.

The `settled` clause is exact rather than time-based. A settled verdict means
"there are no regular season weeks left to evaluate", which is a statement about
`(season, fromWeek, toWeek)` and nothing else. When that triple is unchanged the
verdict cannot have changed, so the cheap early return is the correct answer
however many times it is asked. A finished-season league costs one small select
per view and never more.

`positional_war_attempted_at` is stamped **before** the expensive work, so a
crash mid-run still backs off rather than hot-looping. `positional_war_succeeded_at`
and the cache rows are written **after** the rows land, following the
`last_pulsed_at` rule in `CLAUDE.md`.

### 8.3 Clearing on a settled verdict

When the verdict is `settled`, delete any stored rows for that league season,
the same rule and the same reason as Power Pulse: a degenerate answer outlives
the run that produced it, and a curve of 0.00 WAR reads as a real result. Never
clear on `error` or `skipped`, where the previous answer is still the best one
available.

### 8.4 What the reader sees

- **Normal.** The footnote (section 11.6) carries `generated_at` through
  `formatEastern()`.
- **Stale but present.** When `generated_at` is older than the TTL and the last
  attempt did not succeed, the footnote adds the age plainly: `Last calculated 2
  days ago; the most recent refresh did not complete.` Never hidden, never
  silently served as current.
- **Never computed.** The empty state reads `positional_war_status` and
  `positional_war_detail` and says which honest reason applies, instead of a
  generic "still calculating". For `settled` with reason "no regular season
  games remaining", it says the season is over for this league.
- **Error.** The panel renders the same empty state plus a quiet note that the
  last refresh failed. It never renders `positional_war_detail` verbatim to a
  non-admin reader; a fixed sentence per status is enough, with the detail
  available in the admin surface.

The panel never blocks the page. It sits in its own `<Suspense>` boundary, and
`refreshPositionalWar` never throws, mirroring `refreshPowerPulse`.

### 8.5 Logs and admin

- Console prefix `[positional-war]`, matching `[power-pulse]`. One line per run
  carrying league id, verdict, positions written, duration, and the fingerprint's
  first 8 characters.
- The stage timing goes into the existing `timings` array in `pulseLeagueDerived`
  (`lib/league-pulse.ts:365`), so it appears in the same summary line as
  `transactions`, `rankings`, and `power-pulse`.
- `/admin/system` gains a section listing leagues where
  `positional_war_status = 'error'`, or where `positional_war_succeeded_at` is
  null or older than 48 hours while the league has been pulsed inside that
  window. A systemic break becomes visible without anyone writing SQL.

---

## 9. Tests

New: `lib/positional-war/fingerprint.test.ts`, `replacement.test.ts`,
`war.test.ts`, `engine.test.ts`. Vitest, matching `lib/power-pulse/*.test.ts`.

### 9.1 The brief's own validation list

| Requirement | Test |
| --- | --- |
| A player at the replacement baseline has WAR near zero | Universe where the seated-count-th and next player are identical; assert `seasonWAR === 0` exactly, not merely rounded |
| Raising a projection never lowers WAR | Property test over 200 seeded perturbations: raise one player by a random positive delta, assert his WAR is strictly non-decreasing and no other player's rises |
| More demanding formats move replacement lower | Same universe at 10, 12, and 14 teams; assert `replacement_points` falls monotonically and `war_rank_1` rises monotonically at every position |
| Superflex increases QB scarcity | 9.2 below |
| Players who do not improve the lineup get little or no WAR | Assert every player whose weekly points never exceed that week's replacement has `seasonWAR === 0` |
| Season WAR equals the sum of weekly differences | Assert `seasonWAR === sum(weeklyWAR)` within `1e-9` |
| Repeated runs converge | Assert two runs on identical input are deep-equal. There is no RNG, so this is exact, not statistical |
| Provenance on every displayed result | Assert the panel renders the scoring description, the replacement definition, the model version, and an Eastern-formatted timestamp |

### 9.2 Flex configurations (concern 3)

Each case fixes a small synthetic universe with known projections so the seated
counts are hand-checkable.

| # | `roster_positions` | Assertion |
| --- | --- | --- |
| F1 | `[QB,RB,RB,WR,WR,WR,TE,FLEX,K,DEF]`, 12 teams | Total seated = 120. QB = 12, K = 12, DEF = 12 exactly. RB + WR + TE = 84. Flex allocation follows points, not a fixed share |
| F2 | `[QB,RB,RB,WR,WR,TE,WR_TE,WRRB_FLEX,K,DEF]` | The non-nested case from the optimizer's own header. Assert the fill total is at least that of a naive slot-order greedy fill on the same universe, and strictly greater on the counterexample in that header |
| F3 | Same as F1 with `FLEX` replaced by `SUPER_FLEX` | `structuralDemand(QB)` rises above 12 and reaches 24 when QB13 through QB24 out-project the best flex alternatives; assert `replacement(QB)` falls and every QB's WAR rises while RB, WR, and TE WAR falls |
| F4 | F3's league but with a deliberately shallow QB pool (only 14 projectable QBs) | `structuralDemand(QB) < 24`; superflex does not seat quarterbacks who do not exist. Assert `shallow_pool` is false (14 > 12 seated) and no crash |
| F5 | `[QB,QB,RB,RB,WR,WR,WR,TE,K,DEF]` (two literal QB tokens) | `structuralDemand(QB) === 24` unconditionally, unlike F3 where it is conditional. Assert F3 and F5 produce different fingerprints |
| F6 | `[QB,RB,RB,WR,WR,TE,REC_FLEX,K,DEF]` | No RB is ever seated in `REC_FLEX`. Assert `structuralDemand(RB) === 24` exactly |
| F7 | `[QB,RB,RB,WR,WR,WR,TE,FLEX,FLEX,FLEX,K,DEF]` (three flex) | `replacement(RB)`, `replacement(WR)`, and `replacement(TE)` converge within 15% of one another, and the three curves are visibly flatter than in F1 |
| F8 | F1 with `bonus_rec_te: 1.0` added to scoring | `structuralDemand(TE)` rises above 12 as tight ends take flex slots. Assert the TE curve lifts and the fingerprint differs from F1 |
| F9 | A league with 20 teams and default DEF pool (32 players) | `structuralDemand(DEF) === 20`, `shallow_pool === false`; at 33 teams assert `shallow_pool === true` and `replacement(DEF)` equals the minimum seated DEF, never zero |

### 9.3 Ordering and structural invariants

- `max(points among benched at pos) <= min(points among seated at pos)` for every
  position and every week, in every one of F1 through F9. This is the invariant
  section 4.2 proves; if it fails, the optimizer changed.
- Seated players at a position are exactly the top k of that position by that
  week's points.
- Every rendered series is monotonically non-increasing in `positionRank`.
- `structuralDemand(pos)` for a position with only dedicated slots equals
  `teamCount * dedicatedSlotCount(pos)` exactly.
- `|structuralDemand(pos) - median over weeks of seatedCount(pos, w)| <= teamCount * flexSlotCount`
  for flex-eligible positions, and `=== 0` for the rest.

### 9.4 Baseline and double-count (concern 1)

- The worked example in 4.4.1 reproduced as a fixture, asserting
  `weeklyWAR === 0.08395` within `1e-5`.
- `evaluatedMean - baselineMean === PAR` exactly, for 500 random
  (position, week, player) triples.
- `baselineMean === mu_ref - deficit` exactly.
- A regression guard against the double-count: assert that for
  `deficit > 0` and `PAR > 0`, `weeklyWAR !== normalCdf(PAR / sigmaD) - 0.5`.
  Named `does not use the centered baseline` so anyone "simplifying" it back
  sees why it fails.
- `weeklyWAR === 0` exactly when `PAR === 0`, across every deficit from 0 to 30.
- `weeklyWAR >= 0` for all inputs.

### 9.5 Fingerprint (concern 4)

- Every row of the table in section 6.4, as a pair of league configurations, with
  the two "intentionally NOT caught" rows asserting equality rather than
  inequality.
- `normalizedScoring` returns exactly the key set `scoreStatMap` iterates, over a
  fixture that includes a zero-valued key, a non-finite value, an `adp_ppr` key,
  and a `pts_ppr` key.
- Slot permutation yields the same fingerprint; slot multiset change yields a
  different one.
- Fingerprint is stable across process restarts (no `Date.now`, no `Math.random`,
  no object-iteration-order dependence).

### 9.6 Failure and staleness (concern 6)

- A throw inside the engine sets `positional_war_status = 'error'`, writes the
  message, stamps `attempted_at`, leaves existing rows untouched, and does not
  throw to the caller.
- A second call inside `POSITIONAL_WAR_RETRY_MS` performs no loads. Asserted by
  a spy on the projection loader.
- `force: true` bypasses the backoff.
- A fingerprint change bypasses the backoff.
- An empty week window sets `settled` and deletes existing rows.
- A transient skip sets `skipped` and does NOT delete existing rows.
- `attempted_at` is stamped before the loads (assert ordering with a spy), and
  `succeeded_at` and the rows are written after.

### 9.7 Naming (concern 5)

A repository-level guard. Crude, and it is the only thing that will catch the
collision re-emerging in six months. E3 puts a legitimate Positional WAR
reference inside `lib/trade-impact/`, so a flat ban on the token there would be
wrong. The enforceable rule is proximity:

- In `lib/trade-impact/`, `lib/faab/`, and `lib/power-pulse/`, every occurrence
  of the token `WAR` (word boundaries, case sensitive) must have the literal
  `Positional` within 40 characters before it on the same line, or on the line
  immediately above when the occurrence is inside a comment block.
- No user-facing string anywhere may contain `WAR` without `Positional`
  adjacent.
- `winsDelta`, `expectedWins`, and the strings "projected wins" and "wins added"
  must not appear in `lib/positional-war/` or `components/league-war/` except in
  the 15.1 upgrade panel, which is the one place both metrics legitimately meet
  and which is required to label both.

### 9.8 Other edge cases

- No K slot produces no K row and no K series.
- An IDP league produces the six projectable positions plus a footnote naming
  what was excluded, and never a zero for an unprojectable slot.
- A bye week contributes 0, never a negative.
- A pre-draft league with zero rostered players still produces a full curve,
  since the model reads no roster.
- `total_rosters` null falls back to the stored roster count, then skips with
  `unknown team count`; it never defaults to 12.
- `playoff_week_start` of 0 does not collapse the window.
- `total_rosters` disagreeing with the stored roster count uses `total_rosters`
  and logs the discrepancy.

---

## 10. Acceptance criteria

Concrete and checkable. A build that fails any of these is not done.

**Model**

1. For every league, every position, and every week: `PAR = 0` implies
   `weeklyWAR = 0` to within `1e-12`.
2. `seasonWAR` equals the sum of its `weeklyWAR` terms to within `1e-9`.
3. `seasonWAR >= 0` for every player. No clamp is applied; it holds by
   construction.
4. `evaluatedMean - baselineMean = PAR` exactly.
5. Two runs on identical input produce deep-equal output.
6. Rank-1 season WAR over a 14-week window lands inside the bands in section
   4.7 for a 12-team PPR league.
7. The same league in superflex produces at least a 40% higher rank-1 QB WAR
   than in one-QB.

**Demand and axis**

8. `structural_demand` is an integer and is identical across all six rows'
   recomputes for an unchanged fingerprint.
9. The `x = 1.0` marker is labeled with its real WAR value, and that value is
   `war_at_demand`, and it is greater than zero for at least four of the six
   positions in a normal 12-team league.
10. Every rendered series is monotonically non-increasing in `positionRank`.

**Caching**

11. Changing `bonus_rec_te` on a league changes its fingerprint and the next page
    view recomputes, without waiting for the TTL.
12. Reordering `roster_positions` without changing the multiset does NOT change
    the fingerprint.
13. Flipping the source toggle does NOT change the fingerprint and does NOT
    trigger a recompute.

**Failure**

14. With the engine forced to throw, the overview page still renders the
    rankings table, the masthead, and the rail, and the WAR panel shows an
    honest empty state.
15. Two page views inside the backoff window trigger exactly one attempt.
16. A league whose season is over has zero cached rows and a `settled` status.

**Accessibility**

17. Every value plotted in the SVG appears in the `<details>` data table at every
    breakpoint.
18. Hiding a series through the legend removes it from the SVG and leaves the
    table complete.
19. The spoken summary names the scarcest and the flattest position with their
    numbers, and says "in this league".
20. All six series pass AA contrast against the panel background, and each is
    distinguishable by dash pattern and marker shape with color removed.
21. No `hidden md:` or equivalent on any data-bearing element.

**Naming**

22. The string "WAR" appears in the product only on Positional WAR surfaces, and
    always with "Positional" adjacent on first use.
23. Trade Ideas and FAAB continue to say "projected wins" and "wins added" and
    render no WAR figure unless it is explicitly labeled "Positional WAR
    (league-wide)" and visually separated.

**Extensions**

Each extension carries its own numbered criteria in its subsection: E1a-1
through E1a-5 and E1b-1 through E1b-5 in 15.1, E2-1 through E2-4 in 15.2, E3-1
through E3-5 in 15.3, E4-1 through E4-5 in 15.4, E5-1 through E5-7 in 15.5, E6-1
through E6-4 in 15.6, E7-1 through E7-5 in 15.7, and E8-1 through E8-6 in 15.8.
Four of them are worth restating here because they constrain the core rather
than only themselves:

24. No simulation runs on any GET request to any League Pulse page (E1b-1).
25. Every consumer of a curve still issues exactly one query against
    `league_positional_war_cache`, after cross-league sharing lands (E4-3).
26. The on-page chart and the OG image are generated from the same
    `buildChartGeometry` call and cannot disagree about a league (E5-2).
27. Criterion 3 above ("season WAR is never negative") is stated for the default
    `clampBelowReplacement: true`. With it set false the property is deliberately
    void, and the y-axis must be computed from the data rather than assumed
    non-negative (E7-4).

---

## 11. Rendering

### 11.1 Components and chart kit

New: `components/league-war/positional-war-chart.tsx` (client, for the legend
toggles and the focus readout) and `components/league-war/positional-war-panel.tsx`
(server, does the read and the copy).

`ChartFigure` currently lives at `app/tools/beacon-breakdown/chart-kit.tsx`. It
is the project's chart accessibility contract and should not be imported across
an app route boundary. Move it to `components/chart-kit.tsx` and re-export from
the old path so the Beacon Breakdown tool is untouched. Its header documents why
the summary is a visually hidden paragraph rather than `role="img"`, and that
reasoning applies here unchanged.

Its `SERIES_A` / `SERIES_B` two-color scheme does not extend to six. Load the
`dataviz` skill before choosing a six-way categorical palette. Each series gets a
hue, a dash pattern, and a marker shape, matching what `SeriesLegend` already
does for two. Assign purple `#A855F7` and cyan `#22D3EE` to two fixed positions
(QB and RB) rather than to whichever series ranks highest, so the colors do not
move between leagues.

### 11.2 The x-axis

Raw position rank on a shared axis does not work: WR runs to 413 and DEF to 32,
so the QB line would occupy the left tenth.

Default x-axis is `positionRank / structural_demand`, ticks at 0.5, 1.0, 1.5,
2.0, 2.5, with 1.0 labeled with the league's own count ("28 RBs start"). Every
position's replacement boundary lands at 1.0, which is what makes the six curves
comparable. Axis label: "Depth, relative to what this league starts".

Raw position rank is never hidden. It appears in the focus readout, in each
legend headline, and in every row of the data table.

A `?war=rank` toggle switches the axis to raw position rank. In scope, specified
in **section 15.2**.

### 11.3 Series and the readout

- One `<path>` per position, plus a marker at each plotted player.
- A larger filled marker at `x = 1.0` on each series, labeled with its real WAR
  per section 4.3.
- Hover or focus reveals the nearest point across visible series at that x,
  reading out player name, position, position rank, WAR to two decimals,
  projected points per week, and the replacement baseline per week.
- Legend entries are `aria-pressed` toggle buttons, min 44x44, each carrying its
  own headline in text: `QB, 0.65 wins at QB1, 12 start, replacement QB13`. The
  ranking is readable from the legend alone.

### 11.4 Accessibility

- `ChartFigure` supplies the visually hidden conclusion sentence, the real
  `<table>` inside a `<details>` always present in the DOM, and the visible
  caption.
- The `<svg>` is `aria-hidden="true"`. Every fact it carries is in the summary,
  the legend text, or the table.
- The summary states the conclusion. Draft:

  > In this league, running back is the scarcest position: the top running back
  > is worth 1.73 wins over a replacement running back, and the position falls
  > below half a win by RB9. Kicker is the flattest: the top kicker is worth
  > 0.11 wins, and every kicker this league starts is within 0.09 wins of the
  > next. Replacement level is the best player at each position who does not
  > start anywhere in this 12-team league.

- Legend toggles announce state through `aria-pressed`. Hiding a series changes
  the chart only; the table stays complete.
- The readout is a focus readout as well as a hover readout, and its content
  goes into an `aria-live="polite"` region.
- The `Panel` renders `h2`, matching the overview's other sections; the chart
  title is the `figcaption` `h4` inside, per `ChartFigure`.
- Verify all six series against `bg-surface/50` at AA minimum, AAA where the hue
  allows.

### 11.5 Mobile

- The `<svg>` scales through `viewBox` with `preserveAspectRatio`. If the aspect
  ratio makes six curves unreadable below `sm`, the fallback is a taller aspect
  ratio, not fewer series.
- The `<details>` table carries every plotted point at every breakpoint, scrolling
  inside its own `overflow-x-auto` container.
- The legend wraps, each entry keeping 44x44.
- No `hidden md:` on any data-bearing element.

### 11.6 The footnote

One line under the chart, carrying everything the brief requires plus the
staleness note from section 8.4:

> Rest of season, weeks 9 to 14. Scored under this league's own settings: PPR,
> superflex, TE premium 0.5. Replacement level is the best player at each
> position who does not start anywhere in this 12-team league. Positions this
> league starts but Sleeper does not project (LB, DB) are excluded. Projections
> from Sleeper, model war-1, calculated Aug 26, 2026, 7:30 AM EDT.

Scoring description comes from the same helper the Power Pulse page uses for
`scoringDescription`. The timestamp goes through `formatEastern()` in
`lib/datetime.ts`. Never a bare `toLocaleString()`. The excluded-positions clause
is rendered from the league's raw `roster_positions`, not from the fingerprint,
so two leagues sharing a curve still get their own footnote.

---

## 12. Compute and the cached universe

The expensive part is projections for the full universe rather than one league's
rosters. Power Pulse loads roughly 350 players; this loads 1,083.
`loadProjections` chunks 150 player ids per query with a count guard, so that is
8 chunks and roughly 16 round trips, plus `loadAccuracy` and `loadDefenseSplits`
at the same width.

That read is identical for every league in the same season and week window.
Memoize it following `lib/faab/player-list.ts loadRankedUniverseCached()`:
`unstable_cache` over a cookie-less read client, keyed on
`(season, fromWeek, toWeek, scoringBase)`, tagged `CACHE_TAGS.playerProjections`,
TTL `CACHE_TTL.daily`. Every table it touches is RLS-public, so the cookie-less
client is correct. `scoringBase` is in the key because `loadAccuracy` and
`loadDefenseSplits` are keyed by it.

With that in place, per-league work is one cached universe read, `W + 1` merged
fills, and about 15,000 `normalCdf` calls.

Positional WAR becomes a **fourth independent stage** in the existing
`Promise.all` inside `pulseLeagueDerived` (`lib/league-pulse.ts:379`), not a
step sequenced after `refreshPowerPulse`. It reads no Power Pulse output, so
there is no ordering constraint, and each stage already owns its own failure.

---

## 13. Atomic task list

Format per `progress.md`.

```
T-WAR-01 | pending | Migration 0211: league_positional_war_cache + RLS + access matrix comment
         | files: supabase/migrations/0211_league_positional_war_cache.sql
         | depends on: none
         | verified: no

T-WAR-02 | pending | Migration 0212: positional_war_status/detail/attempted_at/succeeded_at on leagues + check constraint
         | files: supabase/migrations/0212_leagues_positional_war_status.sql
         | depends on: none
         | verified: no

T-WAR-03 | pending | Regenerate lib/database.types.ts via MCP after 0211 and 0212
         | files: lib/database.types.ts
         | depends on: T-WAR-01, T-WAR-02
         | verified: no

T-WAR-04 | pending | Export isNonScoringKey from lib/league-scoring.ts + test that normalizedScoring matches scoreStatMap's key set
         | files: lib/league-scoring.ts, lib/league-scoring.test.ts
         | depends on: none
         | verified: no

T-WAR-05 | pending | lib/positional-war/types.ts: WarCurvePoint, PositionCurve, WarInput, WeeklyDiagnostics
         | files: lib/positional-war/types.ts
         | depends on: none
         | verified: no

T-WAR-06 | pending | lib/positional-war/default-settings.ts: displayDepthMultiple, minDisplayDepth, cliffThreshold, clampBelowReplacement, modelVersion
         | files: lib/positional-war/default-settings.ts
         | depends on: T-WAR-05
         | verified: no

T-WAR-07 | pending | lib/positional-war/fingerprint.ts: normalizedScoring + warFingerprint, section 6
         | files: lib/positional-war/fingerprint.ts, lib/positional-war/fingerprint.test.ts
         | depends on: T-WAR-04, T-WAR-06
         | verified: no

T-WAR-08 | pending | lib/positional-war/replacement.ts: merged fill, structural + weekly demand, replacement/avgSeated/deficit/muRef/sigmaRef
         | files: lib/positional-war/replacement.ts, lib/positional-war/replacement.test.ts
         | depends on: T-WAR-05
         | verified: no

T-WAR-09 | pending | Flex configuration tests F1 through F9 (section 9.2) + ordering invariants (section 9.3)
         | files: lib/positional-war/replacement.test.ts
         | depends on: T-WAR-08
         | verified: no

T-WAR-10 | pending | lib/positional-war/war.ts: PAR, baseline/evaluated means, weekly and season WAR (section 4.4)
         | files: lib/positional-war/war.ts, lib/positional-war/war.test.ts
         | depends on: T-WAR-08
         | verified: no

T-WAR-11 | pending | Worked-example fixture + anti-double-count regression guard (section 9.4)
         | files: lib/positional-war/war.test.ts
         | depends on: T-WAR-10
         | verified: no

T-WAR-12 | pending | lib/positional-war/engine.ts: pure computeCurves(), ranking, depth cap, cliff, diagnostics. No I/O
         | files: lib/positional-war/engine.ts, lib/positional-war/engine.test.ts
         | depends on: T-WAR-10
         | verified: no

T-WAR-13 | pending | lib/positional-war/load.ts: cached full-universe projection read, keyed (season, fromWeek, toWeek, scoringBase)
         | files: lib/positional-war/load.ts
         | depends on: T-WAR-05
         | verified: no

T-WAR-14 | pending | lib/league-positional-war.ts: orchestrator, fingerprint + TTL + week + version staleness, backoff, status writes, clear-on-settled, never throws
         | files: lib/league-positional-war.ts, lib/league-positional-war.test.ts
         | depends on: T-WAR-03, T-WAR-07, T-WAR-12, T-WAR-13
         | verified: no

T-WAR-15 | pending | Chain refreshPositionalWar into pulseLeagueDerived as a fourth parallel stage with its own timing label
         | files: lib/league-pulse.ts
         | depends on: T-WAR-14
         | verified: no

T-WAR-16 | pending | scripts/calculate-positional-war.ts + npm run calculate:positional-war (all leagues, or --sleeper-league-id)
         | files: scripts/calculate-positional-war.ts, package.json
         | depends on: T-WAR-14
         | verified: no

T-WAR-17 | pending | Promote ChartFigure/DataTable to components/chart-kit.tsx, re-export from the breakdown path
         | files: components/chart-kit.tsx, app/tools/beacon-breakdown/chart-kit.tsx
         | depends on: none
         | verified: no

T-WAR-18 | pending | Six-series palette + legend primitives (hue, dash, marker), dataviz skill loaded first
         | files: components/chart-kit.tsx
         | depends on: T-WAR-17
         | verified: no

T-WAR-19 | pending | components/league-war/positional-war-chart.tsx: SVG, normalized axis, legend toggles, focus readout
         | files: components/league-war/positional-war-chart.tsx
         | depends on: T-WAR-18
         | verified: no

T-WAR-20 | pending | components/league-war/positional-war-panel.tsx + lib/league-positional-war-data.ts: read, ownership annotation, summary, footnote, status-aware empty states
         | files: components/league-war/positional-war-panel.tsx, lib/league-positional-war-data.ts
         | depends on: T-WAR-19, T-WAR-14
         | verified: no

T-WAR-21 | pending | Mount on the overview main column under PowerRankingsSection in its own Suspense boundary
         | files: app/leagues/[league_id]/page.tsx
         | depends on: T-WAR-20
         | verified: no

T-WAR-22 | pending | Mirror the panel on /leagues/[id]/power-pulse under ProjectedChampion
         | files: app/leagues/[league_id]/power-pulse/page.tsx
         | depends on: T-WAR-20
         | verified: no

T-WAR-23 | pending | Migration 0213: Signal Guide global term "Positional WAR", explaining the difference from projected wins
         | files: supabase/migrations/0213_signal_guide_positional_war_term.sql
         | depends on: T-WAR-21
         | verified: no

T-WAR-24 | pending | CLAUDE.md: the Positional WAR naming rule (section 3) + the on-demand/no-cron/source-independent rules
         | files: CLAUDE.md, docs/data-sources.md
         | depends on: T-WAR-21
         | verified: no

T-WAR-25 | pending | Naming guard test: no WAR token in trade-impact/faab/power-pulse, Positional always adjacent in UI strings
         | files: lib/positional-war/naming.test.ts
         | depends on: T-WAR-21
         | verified: no

T-WAR-26 | pending | /admin/system section: leagues with positional_war_status='error' or a stale succeeded_at
         | files: app/admin/system/*
         | depends on: T-WAR-14
         | verified: no

T-WAR-27 | pending | E6: rail summary card, scarcest and deepest, cache()-shared read, anchors to #positional-war
         | files: components/league-war/war-rail-summary.tsx, app/leagues/[league_id]/page.tsx
         | depends on: T-WAR-21
         | verified: no

T-WAR-28 | pending | E7: war settings block + merge + zod bounds
         | files: lib/positional-war/default-settings.ts, lib/power-pulse/default-settings.ts, lib/power-pulse/validate.ts, lib/power-pulse/validate.test.ts
         | depends on: T-WAR-06
         | verified: no

T-WAR-29 | pending | E7: Positional WAR fieldset in the admin settings manager + server-side revalidation
         | files: app/admin/power-pulse/power-pulse-settings-manager.tsx, app/admin/power-pulse/actions.ts
         | depends on: T-WAR-28
         | verified: no
```

### Extension tasks

E8 is independent of everything above and can land first. E1b depends on the
route from E5. Nothing else is cross-blocked.

```
T-WAR-32 | pending | E1a: extract matchViewerRoster into lib/league-viewer.ts, make team-filter.tsx import it
         | files: lib/league-viewer.ts, lib/league-viewer.test.ts, components/team-filter.tsx
         | depends on: none
         | verified: no

T-WAR-33 | pending | E1a: viewer roster join + ring markers + Yours column + per-position summary + past-the-cap line
         | files: components/league-war/positional-war-chart.tsx, components/league-war/positional-war-panel.tsx
         | depends on: T-WAR-32, T-WAR-20
         | verified: no

T-WAR-34 | pending | E2: extract path maths into lib/positional-war/chart-geometry.ts (pure), both axis modes
         | files: lib/positional-war/chart-geometry.ts, lib/positional-war/chart-geometry.test.ts
         | depends on: T-WAR-19
         | verified: no

T-WAR-35 | pending | E2: ?war=rank radiogroup toggle modelled on rank-mode-toggle.tsx, wired through the chart
         | files: components/league-war/war-axis-toggle.tsx, components/league-war/positional-war-chart.tsx, app/leagues/[league_id]/page.tsx
         | depends on: T-WAR-34
         | verified: no

T-WAR-36 | pending | E3: positionalWar field on AssetVerdict + deterministic template + optional map parameter
         | files: lib/trade-impact/asset-notes.ts, lib/trade-impact/asset-notes.test.ts
         | depends on: T-WAR-14
         | verified: no

T-WAR-37 | pending | E3: cached()-deduped curve map load on the Trade Ideas page + separated card block
         | files: app/leagues/[league_id]/trade-ideas/page.tsx, components/trade-impact/*
         | depends on: T-WAR-36
         | verified: no

T-WAR-38 | pending | E3: revise the naming guard to the proximity rule (section 9.7)
         | files: lib/positional-war/naming.test.ts
         | depends on: T-WAR-36, T-WAR-25
         | verified: no

T-WAR-39 | pending | E4: migration 0214 positional_war_curves, service-role-only RLS, access matrix comment
         | files: supabase/migrations/0214_positional_war_curves.sql
         | depends on: T-WAR-01
         | verified: no

T-WAR-40 | pending | E4: regenerate lib/database.types.ts after 0214
         | files: lib/database.types.ts
         | depends on: T-WAR-39
         | verified: no

T-WAR-41 | pending | E4: share-on-write path, inputs_digest collision guard, concurrent-upsert idempotence
         | files: lib/positional-war/share.ts, lib/positional-war/share.test.ts, lib/league-positional-war.ts
         | depends on: T-WAR-40, T-WAR-14
         | verified: no

T-WAR-42 | pending | E4: seven-day prune in the nightly recalculate-derived cron, one statement, no league iteration
         | files: app/api/cron/recalculate-derived/route.ts
         | depends on: T-WAR-39
         | verified: no

T-WAR-43 | pending | E5: /leagues/[league_id]/positional-war route inside LeagueShell + ExploreLink + metadata
         | files: app/leagues/[league_id]/positional-war/page.tsx, app/leagues/[league_id]/page.tsx
         | depends on: T-WAR-20
         | verified: no

T-WAR-44 | pending | E5: export the six-series palette as data from chart-kit so the OG route can use it
         | files: components/chart-kit.tsx
         | depends on: T-WAR-18
         | verified: no

T-WAR-45 | pending | E5: /api/og/war/[league_id] route, SVG-as-data-URI, brand check, no ?source=, branded not-ready state
         | files: app/api/og/war/[league_id]/route.tsx
         | depends on: T-WAR-34, T-WAR-44, T-WAR-43
         | verified: no

T-WAR-46 | pending | E1b: lib/positional-war/rate-limit.ts, WAR_UPGRADE bucket at 5/min
         | files: lib/positional-war/rate-limit.ts
         | depends on: none
         | verified: no

T-WAR-47 | pending | E1b: upgrade what-if server action, validate then claim then simulate, computeLineupSwap + simulateWithReplacements
         | files: app/leagues/[league_id]/positional-war/actions.ts, lib/positional-war/upgrade.ts, lib/positional-war/upgrade.test.ts
         | depends on: T-WAR-46, T-WAR-43, T-WAR-32
         | verified: no

T-WAR-48 | pending | E1b: upgrade panel UI, both labels, never one column, Signal Guide link, all six empty states
         | files: components/league-war/upgrade-panel.tsx
         | depends on: T-WAR-47
         | verified: no

T-WAR-49 | pending | E8: migration 0215 power_pulse_status/detail/attempted_at/succeeded_at on leagues
         | files: supabase/migrations/0215_leagues_power_pulse_status.sql
         | depends on: none
         | verified: no

T-WAR-50 | pending | E8: classify the nine return shapes, write verdicts, add POWER_PULSE_RETRY_MS with the section 8.2 bypasses
         | files: lib/league-power-pulse.ts, lib/league-power-pulse.test.ts
         | depends on: T-WAR-49
         | verified: no

T-WAR-51 | pending | E8: status-aware Power Pulse empty states, deferring to PreDraftNotice where it already applies
         | files: app/leagues/[league_id]/power-pulse/page.tsx
         | depends on: T-WAR-50
         | verified: no

T-WAR-52 | pending | E8: /admin/system/league-health, both features side by side, counts by status, real landing page
         | files: app/admin/system/league-health/page.tsx, app/admin/system/page.tsx
         | depends on: T-WAR-50, T-WAR-14
         | verified: no

T-WAR-53 | pending | Accessibility audit sub-agent: WCAG 2.2 AA across the chart, the overlay, the axis toggle, the rail card, the upgrade panel, the admin fieldset. No data hidden at any breakpoint
         | depends on: T-WAR-33, T-WAR-35, T-WAR-27, T-WAR-48, T-WAR-29
         | verified: no

T-WAR-54 | pending | Security review sub-agent: RLS on 0211/0214, 0212/0215 columns service-role-write only, detail never rendered as HTML, upgrade action validates before claiming and re-derives ownership, OG route parameter validation
         | depends on: T-WAR-41, T-WAR-45, T-WAR-47, T-WAR-52
         | verified: no
```

T-WAR-30 and T-WAR-31 from the previous revision are folded into T-WAR-53 and
T-WAR-54, which cover the same ground plus every extension surface.

The settings block, its bounds, its merge behaviour, and its admin fieldset are
specified in section 15.7. Every field in it is in the fingerprint, so an admin
save invalidates every league on its next view without a fan-out and without a
`modelVersion` bump.

**Migration numbers, in order:** `0211` cache table, `0212` league WAR status
columns, `0213` Signal Guide term, `0214` shared curves, `0215` league Power
Pulse status columns. Regenerate `lib/database.types.ts` after `0212` (T-WAR-03)
and again after `0214` (T-WAR-40).

---

## 14. Remaining risks and open questions

1. **IDP leagues cannot get a complete answer.** Sleeper publishes projections
   for `DEF, K, QB, RB, TE, WR` only. `PULSE_SLOT_ELIGIBILITY` maps `IDP_FLEX`
   to an empty array and `startingSlots()` drops unknown tokens. An IDP league
   gets six positions and a footnote naming what was left out. "All positions
   possible" means six today. Worth confirming that reading before building; the
   alternative is an IDP projection source, which is its own project.

2. **The chart can read as wrong in a shallow league.** In an 8-team league the
   last needed running back is roughly RB20, so RB1's WAR is large. In a 14-team
   league it is larger still. Both are correct. The risk is a reader concluding
   the chart is broken because it disagrees with a national WAR chart. The
   footnote and the summary both say "in this league" out loud, which is why
   section 11.6 spends a clause on it.

3. **Player-independent versus team-specific will still be misread by some
   readers**, even with section 3's naming rule, the Signal Guide term, the team
   overlay (E1a), and the upgrade panel (E1b) that puts the two numbers side by
   side and explains the gap. Those are the fix and they are in this build, so
   what remains is a monitoring question: watch for the confusion in feedback
   once all four are live, and if it persists the next lever is copy on the
   overlay's summary lines rather than another surface.

4. **First-view latency.** The universe read is roughly three times wider than
   Power Pulse's. Two mitigations are already in this build: the cached loader
   (T-WAR-13) and cross-league curve sharing (E4, T-WAR-41), which skips the
   compute entirely for a league whose fingerprint another league already
   produced. Measure before T-WAR-21 mounts the panel on the overview. If p95 on
   the boundary still exceeds two seconds with both in place, the next lever is
   the pointer read path in section 6.3, which is the one caching change this
   plan does not include.

5. **Best-ball and no-flex shapes.** Spot check against a real best-ball league
   before shipping. The merged fill assumes the slot list is what gets started.

6. **Week 18 and the postseason.** The window empties once the regular season
   ends, so the curve disappears with a `settled` status and an honest empty
   state. A full-season retrospective view is a later decision.

7. **`toFixed(6)` in the fingerprint** (section 6.2) is the one theoretical false
   hit. Documented rather than left implicit. No known Sleeper league expresses
   scoring at that precision.

8. **Satori's SVG support** (15.5.2). The data-URI `<img>` construction is chosen
   because a plain `<svg>` child is not reliably supported across Satori
   versions. If a future `next/og` bump makes inline SVG dependable the route can
   simplify, but do not start there: a dependency bump silently breaking a
   shared card is a bad way to find out.

9. **Six series plus an overlay marker is seven visual tokens** (15.1.1). That is
   at the edge of what a legend can carry. If the accessibility audit
   (T-WAR-53) finds the ring marker indistinguishable at small sizes, the
   fallback is to move the overlay to a separate mode rather than to drop a
   series or to rely on hue.

10. **E1b's upgrade panel is the one place both metrics appear together.** It is
    also therefore the most likely place for the section 3 naming rule to erode.
    Re-read 15.1.2's naming paragraph before touching that component.

11. **E8 changes a shipped feature.** It lands on its own commit with its own
    review. If the classification table in 15.8 turns out to mis-file a reason in
    production, the symptom is a league that retries too slowly, so watch the
    health view for `settled` leagues whose status looks wrong for the first week
    after it ships.

---

## 15. Extensions, all in scope

Eight extensions. Each states its conclusion after inspecting the system, the
precise definition, the components it touches, its schema, cache, API, UI, and
naming implications, its edge cases, its acceptance criteria, and its tests.

Build order: E7 and E6 are cheap and unblock nothing, so they can land beside the
core. E1a, E2, and E3 depend only on the curve existing. E4 and E5 depend on the
engine being stable. E8 is independent of everything here and can land first.

---

### 15.1 E1: Your team on the curve, and what an upgrade would do

Two separate things, and the separation is the whole design. The first is a
read-time join with no simulation. The second is a real simulation and is
therefore metered, gated behind an explicit press, and never called WAR.

#### 15.1.1 E1a: The overlay

**Conclusion.** A player-independent curve becomes far more useful the moment a
reader can see where they sit on it, and this costs nothing: the curve already
carries every player at every position, and the reader's roster is already in
`rosters.player_ids`. No new computation, no new cache, one extra query that the
panel is already making for the ownership annotation in section 5.2.

**Resolving whose team it is.** `components/team-filter.tsx:192` already holds
the rule, client side:

```
explicit ?roster= wins when it matches a team,
then a case-insensitive trimmed match of ?username= against the owner's
Sleeper username, else null.
```

That rule now needs a server-side caller, and two copies of it would drift.
Extract it verbatim into `lib/league-viewer.ts`:

```ts
export type ViewerCandidate = {
  sleeperRosterId: number;
  ownerSleeperUsername: string | null;
};

export function matchViewerRoster(
  teams: readonly ViewerCandidate[],
  searchedUsername: string | null | undefined,
  focusedRosterId: number | null | undefined,
): number | null;
```

`team-filter.tsx` imports it and deletes its local copy. `TeamCardData` already
satisfies `ViewerCandidate`, so the client call site is unchanged. The overview
page already computes `focusedRosterId` (`app/leagues/[league_id]/page.tsx:134`)
and `searchedUsername` (line 119), so both inputs are in hand.

**The join.** One query for the viewer's roster:

```sql
select player_ids, reserve_ids, taxi_ids
from rosters
where league_id = $1 and sleeper_roster_id = $2
```

Build `Set<sleeperId>`, then walk each position's `curve` array and mark entries
whose `sleeperId` is in the set. This is why section 5.2 stores `sleeperId`.

**What renders.**

- Each overlaid point gets a ring marker: a stroked circle in the ink colour,
  drawn on top of the series marker, larger than it. Distinguishable from all six
  series by shape and stroke rather than by hue, so it survives colour removal.
- The `<details>` data table gains a **Yours** column carrying the literal text
  `Yours` or empty. Never a colour-only or icon-only signal.
- Under the legend, one line per position where the viewer holds a player:

  > Your best RB is RB6, worth 0.94 wins. RB1 is worth 1.73.

  Deterministic template. Every figure in it is on the same screen. A position
  where the viewer holds nobody says so plainly rather than being omitted, so the
  reader can tell "you have none" from "we did not check".
- Players on the viewer's roster who fall past the display depth cap are not
  plotted, because the curve stops there. They are listed by name in a trailing
  line: `4 more of your players rank past the chart's depth: <names>.` Nothing
  the desktop chart holds may be missing anywhere, and a silently dropped player
  would read as "you do not own him".

**Default state.** On by default whenever a viewer roster resolves, matching
`TeamFilter`, which defaults to the searched team. A legend toggle turns it off
with `aria-pressed`, exactly like the six series toggles. No URL parameter of its
own: it is derived from `?roster=` and `?username=`, which already travel through
every League Pulse link.

**Edge cases.**

| Case | Behaviour |
| --- | --- |
| No `?roster=` and no `?username=` | No overlay, no summary lines, no empty-state noise. The chart is exactly as it is without E1a. |
| `?username=` matches nobody in this league | Same as above. Do not guess, and do not show an error: a shared link from another league is a normal thing to click. |
| Viewer holds nobody at a position | That position's summary line says `You have no TE ranked in this league's TE pool.` |
| A rostered player has no `sleeperId` on the curve | Cannot be matched. Count them and say `1 player on your roster has no projection and is not on the curve.` |
| Player is on IR or the taxi squad | Still marked. `player_ids` includes them and the model is player-independent, so he has a real rank. The readout carries his injury designation, the same one the rest of the product shows. Do not filter: a reader who owns an injured RB1 wants to see exactly that. |
| Two viewer players adjacent in rank | Markers overlap. Offset the ring radius by one pixel per collision, capped, and rely on the table for the exact reading. |

**Acceptance criteria.**

- E1a-1: With `?roster=N` set, every player in that roster's `player_ids` who
  appears in any curve is marked, and no other player is.
- E1a-2: The `Yours` column in the data table has a non-empty text value for
  exactly those players, at every breakpoint.
- E1a-3: With no viewer roster resolvable, the rendered output is byte-identical
  to the chart without E1a.
- E1a-4: Every rostered player who is not plotted is named in the trailing line.
- E1a-5: `matchViewerRoster` and the client `TeamFilter` select the same roster
  for the same inputs, asserted by a shared test fixture.

**Tests** (`lib/league-viewer.test.ts`, `components/league-war/overlay.test.ts`):

- `?roster=` beats `?username=` when both are present and both match.
- `?roster=` naming a roster that does not exist falls through to `?username=`.
- Username matching is case-insensitive and trims surrounding whitespace.
- A null owner username never matches an empty `?username=`.
- The overlay marks IR and taxi players.
- A curve entry with `sleeperId: null` is never marked and is counted in the
  unmatched line.

#### 15.1.2 E1b: The upgrade what-if

**Conclusion.** This is the team-specific metric from section 3 wearing its own
name. It answers "if I replaced my current best QB with the best available QB,
what would that do to MY season", and the answer is in projected wins and playoff
odds, never in WAR. It is a genuine simulation, so it must be metered and it must
never run during a page render.

**The critical architectural constraint.** The overview page renders on every
visit. If the upgrade simulation ran during that render, every reader would spend
a rate-limit slot on work they did not ask for, and the limit would fire for
normal use. So:

> The upgrade what-if runs **only** from an explicit server action, triggered by
> a press. It never runs on a GET, it never runs during render, and it is not on
> the overview at all. It lives on `/leagues/[id]/positional-war` (15.5) below
> the chart.

This is the opposite of the Trade Ideas arrangement, where `?mode=build` legitimately
evaluates during render and therefore needs the server-rendered path metered too
(`lib/trade-impact/rate-limit.ts`, path 2). There is no equivalent path here
because there is no URL that encodes an upgrade.

**The computation.** Reuse, do not rewrite.

```
1. Resolve the viewer's roster (lib/league-viewer.ts, as E1a).
2. Pick the target: the highest-WAR player at the chosen position who is NOT on
   the viewer's roster. Read straight off the cached curve. No search.
3. Build the swap with lib/faab/marginal.ts computeLineupSwap():
     slots            = startingSlots(league.rosterPositions)
     weeks            = remaining regular season weeks
     rosterByWeek     = the viewer's roster, projected by projectPlayerWeek
     candidateByWeek  = the target, projected on identical terms
     mustDrop         = roster is full
   It returns weeklyBefore and weeklyAfter, plus the drop it would apply.
4. Feed both into lib/power-pulse/what-if.ts simulateWithReplacements():
     rosters      = loadRosters(...)
     baseline     = every roster's weekly distribution
     replacements = Map { viewerRosterId -> weeklyAfter }
     upcoming     = unplayed regular season weeks from loadSchedule
     options      = { runs, seed, playoffTeams, playoffWeekStart }
5. Report after minus before: projected wins, playoff odds, title odds.
```

Step 3 is the whole reason not to write new lineup code: `computeLineupSwap`
already rebuilds the optimal lineup week by week with the player added and the
cut applied, already handles the cascading lineup changes that concern 3 asked
about, and already refuses to name a cut it should not name.

**One rule inherited from CLAUDE.md, adapted.** Trade Ideas requires that the two
involved teams use a freshly computed baseline on both sides, never the cached
one, so that no difference between two computations is misattributed to the
trade. Here exactly one team changes, so: **the viewer's team uses
`weeklyBefore` on the before side and `weeklyAfter` on the after side, both from
the same `computeLineupSwap` call. Every other team reads from
`league_power_pulse_cache.weekly` on both sides.** That is precisely what
`lib/faab/league-faab.ts` already does for a single signing, and the shared seed
in `simulateSeason` means the two runs see identical dice.

**Rate limiting.** A new bucket, not the trade bucket.

```ts
// lib/positional-war/rate-limit.ts
export const WAR_UPGRADE_BUCKET = "positional-war-upgrade";
export const WAR_UPGRADE_WINDOW_SECONDS = 60;
export const WAR_UPGRADE_MAX = 5;
export async function claimWarUpgradeSlot(): Promise<boolean>;  // claimRateLimitSlot
```

The reasoning in `lib/trade-impact/rate-limit.ts` for one bucket across three
paths is specifically about three entry points into **one** evaluation, so that
alternating between them cannot buy three budgets. That argument does not
transfer to a different feature on a different page, and sharing would mean using
Trade Ideas exhausts this panel, which is a real cost with no security gain.
`lib/breakdown/league-mode.ts:76` is the existing precedent for a feature owning
its own bucket.

Five per minute rather than ten, because there is exactly one press per answer
and a human cannot want more. Claimed **after** validation, per the standing
rule: shape check, then re-derive the viewer's roster from `rosters.player_ids`
rather than trusting the submitted roster id, then claim, then simulate.

**Naming, restated because this is where it would break.** The panel prints
`+0.6 projected wins` and `+7.2 percentage points of playoff odds`. It prints the
target's Positional WAR too, under the label `Positional WAR (league-wide)`, in a
visually separated block, because the entire point of showing both is to make the
gap between them legible:

> QB1 carries 0.65 Positional WAR in this league. For your team, adding him is
> worth +0.2 projected wins, because you already start QB3.

That sentence is the best argument the product can make that the two numbers are
different, and it is why the panel is allowed to break the section 9.7 proximity
rule's spirit while satisfying its letter.

**Edge cases.**

| Case | Behaviour |
| --- | --- |
| No viewer roster resolves | The panel does not render. There is nothing to ask. |
| Power Pulse has no cached rows for the league | No baseline distributions for the other eleven teams. Render the panel disabled with `Team projections are still calculating.` Never substitute zeros. |
| `simulateWithReplacements` returns null (no unplayed weeks) | `We cannot say: this league has no regular season games left.` The null return is exactly this case and must not be reported as zero. |
| Rate limit refused | `Too many checks in the last minute. Try again shortly.` The limiter fails closed, so a limiter outage produces this too, which is correct. |
| The best available player at the position is already on the viewer's roster | Fall to the next one down and say so: `You already hold RB1, so this compares RB2.` |
| Roster is full and `computeLineupSwap` refuses to name a cut | Report the gross figures with its `dropNote` verbatim. It already writes that sentence. |

**Acceptance criteria.**

- E1b-1: No simulation runs on any GET to `/leagues/[id]`,
  `/leagues/[id]/power-pulse`, or `/leagues/[id]/positional-war`. Asserted by a
  spy on `simulateSeason`.
- E1b-2: The action re-derives roster membership from `rosters.player_ids` and
  ignores any roster id in the payload that the viewer resolution did not
  produce.
- E1b-3: Validation precedes the rate-limit claim. A malformed payload consumes
  no slot.
- E1b-4: The panel renders both a "projected wins" figure and a "Positional WAR"
  figure, each with its own label, never in the same column.
- E1b-5: Six presses in one minute produce five answers and one refusal.

**Tests** (`lib/positional-war/upgrade.test.ts`):

- Before and after differ only by the viewer's distribution; every other roster's
  entry is identical between the two `buildSimTeams` inputs.
- A null return from `simulateWithReplacements` surfaces as unavailable, not as
  zero.
- The target selection skips players already on the viewer's roster.
- Two runs with the same seed and inputs produce identical deltas.

---

### 15.2 E2: The raw position rank axis

**Conclusion.** Low cost, no schema change, no recompute. Both axis modes read
the same `curve` jsonb. It earns its place because the normalized axis, while
better for comparing positions, hides the thing a drafter actually wants: how
many quarterbacks are worth anything at all.

**Definition.**

```
mode = "depth" (default)   x = positionRank / structural_demand,  domain [0, displayDepthMultiple]
mode = "rank"              x = positionRank,                      domain [1, RANK_AXIS_CAP]

RANK_AXIS_CAP = min(60, max over positions of curve.length)
```

In `rank` mode the six series share one x-domain and each simply ends where its
data ends, so QB stops around 30 and WR runs to the cap. That truncation is the
honest picture: quarterback really does run out first.

The replacement marker moves with the mode. In `depth` mode every series' marker
sits at `x = 1.0`. In `rank` mode each sits at `x = structural_demand`, so the
markers fan out left to right, which is itself the scarcity reading.

**State.** `?war=rank` in the URL; absent means `depth`. Consistent with
`?rank=`, `?picks=`, and `?source=`, which already travel on these pages.

**UI.** A `role="radiogroup"` toggle modelled on
`components/power-pulse/rank-mode-toggle.tsx`, which already solves this exact
problem for the rankings table: real radio semantics so a screen reader
announces "Chart axis, Depth relative to starters, selected, 1 of 2", a
`useTransition` push that does not scroll, 44px minimum targets, and an
`aria-label` on each option carrying the hint rather than a tooltip.

Option labels and hints:

| Option | Label | `aria-label` hint |
| --- | --- | --- |
| `depth` | Relative depth | Position rank divided by how many this league starts, so every position's replacement line meets at the same point and the curves can be compared. |
| `rank` | Position rank | Raw position rank, so you can see how far each position runs before it flattens. |

**Implications.** The axis mode is a rendering choice, so it is deliberately
**not** in the fingerprint and does not invalidate a cached curve. It is also not
in the OG image (15.5), which always renders `depth`, because a shared card has
no reader to have chosen.

**Edge cases.**

| Case | Behaviour |
| --- | --- |
| A position's curve is shorter than the cap | The series ends. No padding, no zero-fill tail. |
| `structural_demand > RANK_AXIS_CAP` (a very deep league at WR) | The marker sits off the right edge. Clamp the marker to the last plotted point and label it `WR62+`, and say in the axis note that the chart is truncated at 60. |
| `?war=` with any other value | Falls back to `depth` silently. An unknown parameter is not an error. |

**Acceptance criteria.**

- E2-1: `?war=rank` changes the rendered axis and nothing else; the six curves'
  underlying values are identical between modes, asserted by comparing the data
  tables.
- E2-2: The toggle is a radiogroup with `aria-checked`, and both options are
  44x44 minimum.
- E2-3: Switching modes does not trigger a recompute and does not change the
  stored fingerprint.
- E2-4: `?war=garbage` renders `depth`.

**Tests** (`lib/positional-war/chart-geometry.test.ts`): the geometry function
returns the same series values and different x coordinates for the two modes;
the marker x equals `1.0` in depth mode and `structural_demand` in rank mode.

---

### 15.3 E3: Positional WAR as labelled context in Trade Ideas

**Conclusion.** Valuable and safe, provided three constraints hold. This replaces
the first draft's "a WAR column on the Trade Ideas verdict", which would have
created exactly the collision section 3 forbids.

**The three constraints.**

1. **Read only.** Trade Ideas never triggers a WAR computation. It reads
   `league_positional_war_cache` for the league and season, and when there are no
   rows the note does not fire. Making a trade evaluation into a WAR compute
   trigger would put an expensive job behind a metered endpoint's cheap path.
2. **Labelled.** The string is always `Positional WAR (league-wide)`, never bare
   `WAR`, and it links the Signal Guide term.
3. **Separated.** It renders in its own block on the asset card, never in the
   same column, row, or sentence as the roster-specific figures.

**Where it attaches.** `lib/trade-impact/asset-notes.ts` `readAsset()` returns
`AssetVerdict`. Add one optional field:

```ts
export type PositionalWarContext = {
  war: number;
  positionRank: number;
  structuralDemand: number;
  position: string;
};

export type AssetVerdict = {
  // ... existing fields unchanged
  positionalWar: PositionalWarContext | null;
};
```

`readAsset` gains an optional parameter carrying a `Map<sleeperId,
PositionalWarContext>` built by the page. Absent map, or a player not in it,
yields `null`, and the card renders exactly as it does today. That is the
existing contract in this file: "a null figure means the reason does not fire".

**The sentence.** A deterministic template, per the CLAUDE.md rule that Trade
Ideas reasons are never generated:

```
`Positional WAR (league-wide): ${war.toFixed(2)}. ${position}${positionRank} of ${structuralDemand} who start in this league.`
```

Every figure in it is present in the input. No thresholds, no adjectives, no
comparison to the other side. It is context, not an argument, and the verdict's
own reasons continue to carry the argument.

**The load.** One query on the Trade Ideas page:

```sql
select position, curve from league_positional_war_cache
where league_id = $1 and season = $2
```

Six rows. Flatten each `curve` into the map keyed by `sleeperId`, skipping null
ids. Deduped for the render through React `cache()`, since both the suggestion
list and the builder verdict want the same map. Depth is bounded by the display
cap, so a player outside the top `2.5 * demand` at his position simply has no
entry, which is correct: his Positional WAR is approximately zero and printing
`0.00` would read as a measurement rather than as an absence.

**Naming implications.** `lib/trade-impact/` now legitimately contains the token,
so the section 9.7 guard becomes a proximity rule rather than a ban. Already
applied.

**Edge cases.**

| Case | Behaviour |
| --- | --- |
| No cached curve for the league | Map is empty, no note fires anywhere, no placeholder. |
| The curve is stale relative to the trade's players | Acceptable. The note carries no timestamp because the card has no room for one; the Positional WAR panel is where provenance lives, and the Signal Guide link goes there. |
| A draft pick asset | Picks have no position rank and no projection. Never a note. Picks are excluded from the model entirely (section 7). |
| A player past the display depth cap | No note. See above. |
| A player with no Sleeper id | Cannot be keyed. No note. |

**Acceptance criteria.**

- E3-1: With no cached curve, `readAsset` output is deep-equal to its output
  before E3.
- E3-2: The rendered card places the Positional WAR block outside the container
  holding `winsDelta`, verified structurally in the component test.
- E3-3: The string `Positional` precedes every `WAR` occurrence in the rendered
  output.
- E3-4: Loading a Trade Ideas page never writes to `league_positional_war_cache`
  and never calls `refreshPositionalWar`, asserted by spies.
- E3-5: A draft pick asset yields `positionalWar: null`.

**Tests** (`lib/trade-impact/asset-notes.test.ts`, extending the existing file):
the template renders every figure; a missing map is a no-op; a pick is a no-op; a
player outside the cap is a no-op.

---

### 15.4 E4: Cross-league curve sharing

**Conclusion.** Ships, on the write path only, with a guard that converts the
silent failure mode into a loud one. Section 6 established that the result is a
pure function of the fingerprint's inputs, so sharing is sound; the risk was
never the maths, it was a normalization bug serving league A's curve to league B
with nothing visibly wrong.

#### 15.4.1 The table

Migration `0214`.

```sql
create table if not exists public.positional_war_curves (
  fingerprint          text    not null,
  position             text    not null check (position in ('QB','RB','WR','TE','K','DEF')),

  structural_demand    integer not null,
  replacement_points   numeric,
  avg_seated_points    numeric,
  deficit              numeric,
  shallow_pool         boolean not null default false,
  war_rank_1           numeric,
  war_at_demand        numeric,
  cliff_rank           integer,
  curve                jsonb   not null default '[]'::jsonb,
  weekly_diagnostics   jsonb   not null default '{}'::jsonb,
  from_week            integer not null,
  through_week         integer not null,
  model_version        text    not null,

  -- The collision guard. Section 15.4.3.
  inputs_digest        jsonb   not null,

  -- Diagnostics only. Never read by the model.
  first_league_id      uuid references public.leagues(id) on delete set null,
  computed_at          timestamptz not null default now(),
  primary key (fingerprint, position)
);

create index if not exists idx_positional_war_curves_computed
  on public.positional_war_curves(computed_at);
```

RLS: service_role only for everything. Unlike `league_positional_war_cache`,
this table is **not** publicly readable. Nothing in the UI reads it, and a
fingerprint is an opaque key that would leak nothing useful but has no reason to
be exposed. Access matrix in the migration comment, per the project rule.

#### 15.4.2 The write path

```
computeFingerprint(league)
  -> hit  in positional_war_curves?
       -> validate inputs_digest against this league's own values  (15.4.3)
            -> match:    copy the six rows into league_positional_war_cache
                         for (league, season), stamp generated_at = now(),
                         status ok, detail "6 positions, shared, 12ms"
            -> mismatch: log error, delete the colliding rows, fall through
  -> miss -> compute (universe read, W+1 fills, CDF pass)
          -> upsert positional_war_curves  (on conflict do update)
          -> write league_positional_war_cache
```

`league_positional_war_cache` keeps its `fingerprint` column and its full curve
rows, so **no consumer changes**. The overview panel, the rail summary, Trade
Ideas, and the OG route all keep their single query against the per-league table.

The win is the compute, which is the expensive half. Storage duplication is about
60KB per league (roughly 300 curve entries at 200 bytes), so 212 leagues is about
12MB. Section 6.3 records when the pointer design becomes worth its join.

#### 15.4.3 The collision guard

The specific safeguard against two leagues that hash the same but are not the
same. `inputs_digest` stores the human-readable inputs, not the hash:

```json
{
  "season": 2026,
  "fromWeek": 9,
  "toWeek": 14,
  "teamCount": 12,
  "slots": ["DEF","FLEX","K","QB","RB","RB","TE","WR","WR","WR"],
  "scoringBase": "pts_ppr",
  "scoringUsable": true,
  "scoringKeyCount": 41,
  "modelVersion": "war-1"
}
```

On a hit, recompute those nine values from the requesting league and compare
field by field. On any mismatch:

1. `console.error` at error level with both digests and the fingerprint.
2. Delete the stored rows for that fingerprint.
3. Fall through to a fresh computation and overwrite.
4. Set `positional_war_detail` to `fingerprint collision, recomputed` so it
   surfaces in the admin health view (15.8).

`scoringKeyCount` rather than the whole scoring map: the map can hold a hundred
keys and storing it per fingerprint per position is wasteful, while a count plus
the base plus the usability flag catches every realistic divergence and the
fingerprint itself catches the rest. This is a tripwire, not a second
fingerprint.

The guard is cheap: nine comparisons on a row we already read.

#### 15.4.4 Pruning

Fingerprints include the projections snapshot, so a row is immutable and becomes
dead the morning after it is written. Prune from the existing nightly
`/api/cron/recalculate-derived`:

```sql
delete from public.positional_war_curves
where computed_at < now() - interval '7 days';
```

One statement. It does **not** iterate leagues, so it does not violate the
standing rule that the nightly job must not do per-league work. Seven days rather
than one so a week-old fingerprint that somehow recurs still hits.

**Edge cases.**

| Case | Behaviour |
| --- | --- |
| Two leagues render concurrently with the same fresh fingerprint | Both compute, both upsert. `on conflict do update` makes the second a harmless overwrite of identical data. No lock, no coalescing: the work is bounded and a lock is a new failure mode. |
| A hit whose `model_version` differs from the current one | Impossible, since `modelVersion` is in the fingerprint. Assert it anyway in the guard; a mismatch here means the fingerprint function has a bug. |
| The curves table is empty (first deploy, or post-prune) | Every league computes. Identical to the behaviour without E4. |
| The copy into `league_positional_war_cache` fails | Treated as an error verdict. The shared row stays; the next view retries the copy without recomputing. |

**Acceptance criteria.**

- E4-1: Two leagues with identical fingerprints produce byte-identical
  `league_positional_war_cache.curve` values, and the second performs no
  projection load. Asserted by a spy on the universe loader.
- E4-2: A forced `inputs_digest` mismatch logs an error, deletes the shared rows,
  and produces a correct fresh curve.
- E4-3: Every read path still issues exactly one query against
  `league_positional_war_cache`.
- E4-4: `positional_war_curves` is unreadable as `anon` and as `authenticated`.
- E4-5: The prune statement removes only rows older than seven days.

**Tests** (`lib/positional-war/share.test.ts`): hit, miss, and collision paths;
the digest comparison rejects each of the nine fields independently; concurrent
upsert is idempotent.

---

### 15.5 E5: The shareable image, and the route it belongs to

**Conclusion.** An OG image is meaningless without a page whose card it is, so
this extension is really two things: a dedicated route, and the image for it.
The route also gives E1b a home that is not a page rendered on every visit.

#### 15.5.1 The route

`/leagues/[league_id]/positional-war`, a third home for the same panel, joining
the overview (T-WAR-21) and the Power Pulse mirror (T-WAR-22). It is a real
League Pulse section, so it follows every convention the others do:

- Renders inside `LeagueShell` with the shared masthead.
- Plain functional title: `Positional WAR`. No invented branding.
- Carries `?username=` and `?roster=` through, like every other section link.
- Gains an `ExploreLink` in the overview rail's "Explore this league" list, with
  the hint `Which positions are scarce in this league`.
- Gets the full width of the main column, no rail, so the chart is at its
  largest here.
- Hosts the E1b upgrade panel below the chart, which is the one place a
  simulation may be triggered.

`generateMetadata` points `openGraph.images` and `twitter.images` at
`/api/og/war/[league_id]`.

**CLAUDE.md implications.** The League Pulse "Naming rules" list of routes gains
this path, and the "Sync rules" section gains the sentence that this route, like
the others, calls `pulseLeague` and never writes to league tables directly. Folded
into T-WAR-24.

#### 15.5.2 The image

`app/api/og/war/[league_id]/route.tsx`. Matches the three existing OG routes:
`runtime = "nodejs"`, `next/og` `ImageResponse`, 1200x630, and the identical
cache header used at `app/api/og/league/[league_id]/route.tsx:290`:

```
public, max-age=300, s-maxage=3600, stale-while-revalidate=86400
```

**Drawing a line chart inside Satori.** `next/og` renders through Satori, which
supports flexbox and a subset of CSS but does not reliably render arbitrary SVG
`<path>` children across versions. Betting the image on that would be a silent
regression waiting for a dependency bump. The safe construction, and the one to
build:

```
1. Build the SVG document as a string, server side, with the SAME geometry the
   on-page chart uses.
2. Base64 it.
3. Render <img src={`data:image/svg+xml;base64,${b64}`} width={1040} height={380} />
```

Satori handles `<img>` with a data URI. Everything else on the card (wordmark,
league name, legend, headline sentence, footer) is plain flexbox divs, which is
what the other three routes already do.

**The geometry must not be duplicated.** Extract the path maths out of
`components/league-war/positional-war-chart.tsx` into a pure module:

```ts
// lib/positional-war/chart-geometry.ts
export function buildChartGeometry(input: {
  curves: PositionCurve[];
  mode: "depth" | "rank";
  width: number;
  height: number;
  padding: { t: number; r: number; b: number; l: number };
}): {
  series: Array<{
    position: PulsePosition;
    d: string;                                   // the path
    points: Array<{ x: number; y: number; rank: number; war: number }>;
    markerAt: { x: number; y: number } | null;   // the replacement marker
  }>;
  xTicks: Array<{ x: number; label: string }>;
  yTicks: Array<{ y: number; label: string }>;
  yMax: number;
};
```

The client chart and the OG route both call it. This is what makes it impossible
for the shared card and the page to disagree about the same league, which is the
same discipline the Schedules page follows when it reads projections from
`league_power_pulse_cache.weekly` rather than recomputing them.

This changes T-WAR-19: the chart component is built on top of the geometry
module rather than owning the maths.

**Parameters.** The route accepts the league id and nothing else. The three
existing OG routes accept `?source=`, and this one deliberately does not:
Positional WAR is source-independent (section 7), so accepting the parameter
would imply it changes the picture. The axis is always `depth` (15.2), because a
shared card has no reader who chose. Validate `league_id.length > 64` and return
400, matching the league route.

**Brand.** Governed by the absolute rule in CLAUDE.md: background `#07070D` and
`#0F0F1A`, purple `#A855F7` to cyan `#22D3EE` beacon gradient, Geist stack, the
"FF Beacon" wordmark, an `ffbeacon.com` footer. No gold. No `#0c0c18`. The six
series palette is the same one the page uses (T-WAR-18), which must therefore be
exported from `components/chart-kit.tsx` as data rather than being locked inside
Tailwind classes.

**Content.**

```
FF Beacon                                    [purple-to-cyan hairline]
<League name>  ·  2026  ·  12 teams
Positional WAR

[ the curve, 1040 x 380 ]

QB 0.65 (12 start)   RB 1.73 (28)   WR 1.44 (42)
TE 0.90 (12)         K 0.11 (12)    DEF 0.32 (12)

Running back is the scarcest position in this league.
                                                        ffbeacon.com
```

The headline sentence is the same deterministic template the rail summary uses
(15.6), so the card, the rail, and the chart summary cannot say different things.

**Edge cases.**

| Case | Behaviour |
| --- | --- |
| No cached curve for the league | Return the branded not-ready image the other routes already have a helper for, saying `Positional WAR is still calculating`. Never a broken or empty chart. |
| League not found | The existing `notFoundImage` helper. |
| A league with three positions (no K, no DEF, IDP league) | Three series, three legend entries. The legend is a wrapping flex row, so it reflows. |
| Curve arrays at the display cap for a deep league | The SVG string stays under the practical data-URI size; a 105-point path is a few kilobytes. No cap needed beyond the display cap. |
| Stale curve | The card renders it. It carries no timestamp, by choice: a social card that ages visibly is worse than one that does not, and the page it links to carries the full provenance line. |

**Acceptance criteria.**

- E5-1: The route returns a 1200x630 PNG with the documented cache header.
- E5-2: The rendered series values equal the on-page chart's for the same league,
  asserted by comparing `buildChartGeometry` output rather than by pixels.
- E5-3: The response contains no gold hex value and no `#0c0c18`.
- E5-4: `?source=` is ignored; two requests differing only in it are identical.
- E5-5: A league id over 64 characters returns 400.
- E5-6: A league with no cached curve returns the branded not-ready image, 200.
- E5-7: `/leagues/[id]/positional-war` metadata points at the route.

**Tests** (`lib/positional-war/chart-geometry.test.ts`,
`app/api/og/war/route.test.ts`): geometry parity between modes and callers; the
brand-colour assertion; the parameter-ignoring assertion; the empty-state branch.

---

### 15.6 E6: The rail summary card

**Conclusion.** The right rail was rejected in section 1 as a home for the chart,
not as a home for the finding. Three lines of text with real numbers fit at 290px
comfortably, and they give the overview the presence the chart cannot have there.

**Component.** `components/league-war/war-rail-summary.tsx`, a server component,
reading through the same `lib/league-positional-war-data.ts` loader the panel
uses. Wrap that loader in React `cache()` so the rail and the panel share one
query per render rather than racing to make two, the same technique
`getPulseData` uses at `app/leagues/[league_id]/power-pulse/page.tsx`.

**Content.**

```
Scarcest    RB   RB1 is worth 1.73 wins. 28 start.
Deepest     K    K1 is worth 0.11 wins. 12 start.
Your best   RB6, 0.94 wins                          <- only when a roster resolves

See the full curve ->                               <- anchors to #positional-war
```

**Selection rules, deterministic.**

```
scarcest = max war_rank_1, ties broken by min cliff_rank      (steeper wins)
deepest  = min war_rank_1, ties broken by max cliff_rank      (flatter wins)
```

If fewer than two positions have a curve, render only the scarcest line. If
scarcest and deepest resolve to the same position (a one-position league, which
should not happen but must not crash), render one line.

**Placement.** Inside the existing `<aside>` at
`app/leagues/[league_id]/page.tsx:322`, **above** the "Explore this league"
panel. A finding outranks a navigation list, and the aside's
`aria-label` becomes `League findings and links`.

**Accessibility.** It is a `Panel` with real text and no graphic, so nothing
special is required beyond the anchor. `Panel` already accepts `id` and wires
`aria-labelledby`, so the chart panel takes `id="positional-war"` and the rail
link targets it. The link needs `min-h-11` and a visible focus ring, matching
`ExploreLink`.

**Edge cases.**

| Case | Behaviour |
| --- | --- |
| No cached curve | The card does not render at all. An empty finding card is worse than no card; the panel below already carries the honest empty state. |
| A `settled` or `error` status | Same: no card. Diagnosis belongs in the panel and the admin view, not in the rail. |
| No viewer roster | The "Your best" line is omitted. The other two stand. |
| The viewer's best player at the scarcest position is outside the display cap | The line says `Your best RB ranks past this chart's depth.` |

**Acceptance criteria.**

- E6-1: The rail and the panel issue one combined query, asserted by a spy.
- E6-2: The anchor moves focus to the chart panel's heading, not merely the
  scroll position.
- E6-3: With no cached curve, the rail renders exactly as it does today.
- E6-4: Scarcest and deepest selection is deterministic across repeated renders
  of the same data, including tie cases.

**Tests** (`components/league-war/rail-summary.test.ts`): selection under ties;
the omitted "Your best" line; the no-curve branch.

---

### 15.7 E7: The WAR settings block and its admin controls

**Conclusion.** Every other model in this product is admin-tunable without a
deploy, and this one should be too. It belongs inside the existing Power Pulse
settings document rather than in a new table, because the WAR model reuses the
entire Power Pulse projection stack; splitting the two across documents would let
a half-applied edit produce a curve computed under mixed settings.

**Storage.** `league_power_pulse_settings.settings.war`, single `id = 'global'`
row, service-role only, already exists. No migration.

**Defaults** (`lib/positional-war/default-settings.ts`, re-exported into
`lib/power-pulse/default-settings.ts` so one document has one type):

```ts
export const DEFAULT_WAR_SETTINGS = {
  modelVersion: "war-1",
  displayDepthMultiple: 2.5,    // curve cap, times structural demand
  minDisplayDepth: 24,
  cliffThreshold: 0.5,          // fraction of rank-1 WAR that defines the cliff
  clampBelowReplacement: true,  // false lets PAR go negative; see section 4.4
} as const;
```

**Merge.** `mergePowerPulseSettings` at `lib/power-pulse/default-settings.ts:232`
uses a one-level `obj(key, fallback)` shallow merge over the defaults, so the
addition is one line, `war: obj("war", base.war)`, and a stored document written
before this ships degrades to the defaults rather than failing. Verified against
the existing implementation.

**Validation.** Extend `powerPulseSettingsSchema` in `lib/power-pulse/validate.ts`:

```ts
war: z.object({
  modelVersion: z.string().min(1).max(32),
  displayDepthMultiple: z.number().min(1).max(6),
  minDisplayDepth: z.number().int().min(6).max(200),
  cliffThreshold: z.number().min(0.05).max(0.95),
  clampBelowReplacement: z.boolean(),
}),
```

Bounds chosen so the model still behaves at either end: below `1.0` the depth cap
would cut the curve before the replacement line, and above `6` a WR series runs
past 250 points for no gain. `cliffThreshold` outside `(0, 1)` makes `cliff_rank`
meaningless.

**Admin UI.** A new fieldset in
`app/admin/power-pulse/power-pulse-settings-manager.tsx`, headed
`Positional WAR`. Each control is a labelled number input whose `min`, `max`, and
`step` match the zod bounds exactly, with `aria-describedby` on each pointing at
a sentence saying what moving it does to the chart. `clampBelowReplacement` is a
real checkbox with a described consequence, not a styled div. The server action
in `app/admin/power-pulse/actions.ts` re-validates independently of the client
and keeps whatever admin gate it already enforces; the client is never a security
boundary.

**The property worth stating in the UI.** Saving does not fan out recomputes,
matching the existing Power Pulse rule. But every field here is in the fingerprint
(section 6.1), so **every league recomputes automatically on its next view**,
with no `modelVersion` bump and no cron. Put that sentence in the fieldset's
helper text, because it is different from the Power Pulse block directly above it
and an admin will otherwise assume they must bump the version.

**Edge cases.**

| Case | Behaviour |
| --- | --- |
| Stored document has no `war` key | Defaults, through the existing merge. |
| An admin sets `displayDepthMultiple` below the current value | Curves shorten on next view. Already-cached longer curves are invalidated by the fingerprint, so no league shows a mixed-length chart. |
| `clampBelowReplacement: false` | PAR may go negative, so WAR may go negative, so the section 4.4 property "season WAR is never negative" no longer holds. The acceptance criterion in section 10 is stated for the default; the test asserts both branches. The UI must not assume a non-negative y-axis: the y-domain is computed from the data. |
| Two admins save concurrently | Last write wins, as today. Out of scope to change. |

**Acceptance criteria.**

- E7-1: A stored settings document with no `war` key loads the defaults.
- E7-2: Every zod bound rejects a value one step outside it, server side, even
  when the client form allowed it.
- E7-3: Changing any `war` field changes the fingerprint for every league.
- E7-4: With `clampBelowReplacement: false`, a below-replacement player receives
  negative WAR and the chart's y-axis includes it.
- E7-5: Every input has a programmatic label and an `aria-describedby`.

**Tests** (`lib/power-pulse/validate.test.ts`, `lib/positional-war/war.test.ts`):
each bound; the merge fallback; both clamp branches; fingerprint sensitivity.

---

### 15.8 E8: Power Pulse observability parity

**Conclusion.** In scope, and it is the extension with the clearest existing
defect behind it. `powerPulseIsStale` at `lib/league-power-pulse.ts:60` returns
`true` whenever there are no rows, and `calculateLeaguePowerPulse` returns a
`skipped` reason that `refreshPowerPulse` only ever passes to `console.warn`. The
consequence is visible in production: a league that skips deterministically
re-attempts on every page view, and the panel at
`app/leagues/[league_id]/power-pulse/page.tsx:372` says "Power Pulse is still
calculating" indefinitely with no way for anyone to learn why.

Building the same three mechanisms for Positional WAR and leaving Power Pulse as
it is would be strange, so this brings them level.

**Schema.** Migration `0215`, mirroring `0212` exactly so the two features have
the same shape:

```sql
alter table public.leagues
  add column if not exists power_pulse_status text
    check (power_pulse_status in ('pending','ok','skipped','settled','error')),
  add column if not exists power_pulse_detail text,
  add column if not exists power_pulse_attempted_at timestamptz,
  add column if not exists power_pulse_succeeded_at timestamptz;
```

**Wiring.** `refreshPowerPulse` writes the verdict instead of only logging it.
`calculateLeaguePowerPulse` already returns everything needed; it returns
`{ok:true, skipped}` for six distinct reasons and `{ok:false, error}` for two, so
the classification is a lookup, not new logic:

| Existing return | Status |
| --- | --- |
| `ok: true`, no `skipped` | `ok` |
| `incomplete schedule fetch (weeks ...)` | `skipped` |
| `no rosters` | `skipped` |
| `no teams scored` | `skipped` |
| `no weekly projections stored for {season} from week N` | `skipped` |
| `no published schedule` | `settled` |
| `draft pending with empty rosters` | `settled` |
| `no regular season games remaining from week N` | `settled` |
| `ok: false` | `error` |

**Backoff.** `POWER_PULSE_RETRY_MS = 15 * 60 * 1000`, with the identical bypass
table from section 8.2. The `last_pulsed_at` clause is what makes the two
`settled` draft-night reasons safe to classify that way: `pulseLeagueCore` writes
rosters and advances `last_pulsed_at`, so a league that finishes its draft
retries on the very next view rather than fifteen minutes later. Without that
clause, `draft pending with empty rosters` would have to be `skipped` and the
classification above would be wrong.

`powerPulseIsStale` gains the backoff check as an early return, before its
existing queries, so a backed-off league costs one select instead of a Sleeper
round trip.

**Empty states.** The Power Pulse panel reads `power_pulse_status` and
`power_pulse_detail` and says which honest reason applies, replacing the
unconditional "still calculating". For `settled` with "no published schedule" on
an undrafted league, it defers to the existing `PreDraftNotice`, which is already
the better answer for that case and is already wired.

**Admin.** `/admin/system/league-health`, a new sub-route.
`app/admin/system/page.tsx` currently redirects straight to `webhooks` with the
comment "Webhooks is the only sub-area today", so it becomes a real landing page
listing both. The health view lists, for both features side by side:

- Leagues with status `error`, newest attempt first, with the detail.
- Leagues whose `*_succeeded_at` is null or older than 48 hours while
  `last_pulsed_at` is inside that window, which is the signature of a systemic
  break rather than an unvisited league.
- Counts by status, so a single number tells an admin whether anything is wrong.
- Fingerprint collisions from 15.4.3, which surface here through
  `positional_war_detail`.

`detail` is rendered as text, never as HTML. It is written by server code only
and is never user-controlled, and it is shown only to admins.

**Edge cases.**

| Case | Behaviour |
| --- | --- |
| A league that has never been viewed | All four columns null. Excluded from the health view, since it is not a fault. |
| `power_pulse_detail` longer than 500 characters | Truncated at write time. No stack traces, no connection strings. |
| An existing league row with a null status after the migration | Treated as `pending`, which means no backoff and a normal first attempt. |
| Both features failing for the same league | Two rows, or one row with two columns. One row per league with a column per feature reads better and is what to build. |

**Acceptance criteria.**

- E8-1: Each of the nine return shapes maps to the documented status.
- E8-2: A backed-off league performs no Sleeper request and no roster load,
  asserted by spies.
- E8-3: `last_pulsed_at` advancing bypasses the backoff for `skipped` and
  `error`, and does not bypass it for `settled`.
- E8-4: `attempted_at` is written before the expensive work and
  `succeeded_at` after the cache rows land, asserted by call ordering.
- E8-5: An undrafted league still renders `PreDraftNotice`, unchanged.
- E8-6: The health view is unreachable without the existing admin gate.

**Tests** (`lib/league-power-pulse.test.ts`, new): the classification table; the
bypass table; the ordering of the two timestamp writes; the early return.

**Sequencing note.** E8 is a required part of this build. It changes a shipped
feature, so it lands on its own commit with its own review, and because no
Positional WAR task depends on it, it can land first or last. Independent of the
rest does not mean optional to the rest.

---

### 15.9 What remains genuinely out of scope

Two things, listed so the boundary is explicit rather than implied.

- **The pointer read path for shared curves** (section 6.3). Deferred on a stated
  threshold, roughly 10,000 leagues, not on preference.
- **Positional WAR history.** Storing a curve per week so a reader could watch
  scarcity move across a season. It needs a different table shape, a retention
  policy, and a second chart, and nothing above depends on it.

---

## Writing check

Ran the AI-writing-patterns check from the global instructions against this
revision, including all of section 15. Two fixes in the new material: a
negative-parallelism construction in 15.1.2 that read "not new code, reuse"
became a plain statement of which existing function does the work, and a
significance-inflation clause in 15.8 ("underscoring the importance of
observability") was cut rather than rewritten. No em dashes, en dashes, curly
quotes, ellipsis characters, or middle dots anywhere in the file. No three-item
rhythmic lists used as cadence.
