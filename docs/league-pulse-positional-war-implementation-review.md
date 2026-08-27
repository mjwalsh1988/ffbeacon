# League Pulse: Positional WAR, implementation review

Written 2026-08-26, against the build sitting in the working tree at the end of
that session. Nothing in this build is committed or pushed.

The plan it implements is `docs/league-pulse-positional-war-plan.md`, written
the same day against `main` at `c068818`. Task ids below are the plan's own
`T-WAR-##`, and the live status of each is in `progress.md` under "League Pulse:
Positional WAR".

State at the end of the session: `npm run typecheck` clean, `npm run build`
clean with both new routes in the manifest, 168 test files, 2,563 tests, all
green.

---

## 1. What was built, in one paragraph

Positional WAR is a multi-series line chart, one line per position, showing how
many wins each player is worth over the best player at that position nobody in
that league starts. The shape of the line is the answer: steep means the
position runs out fast, flat means the next player down is nearly as good.
Everything in it is specific to one league, because replacement level is defined
by that league's own starting lineup and team count, and every projection is
rescored under that league's own Sleeper settings. It ships with a dedicated
route, a shareable social card, a viewer overlay, a raw-rank axis mode, a rail
summary, a Trade Ideas note, an admin settings block, an upgrade what-if, and a
parity pass that brings Power Pulse's observability up to the same standard.

---

## 2. The idea, in the terms the model actually uses

Three quantities do the work, and the plan is emphatic that mixing them up is
how this gets built wrong.

**Replacement level.** For each position, the best player at that position who
does not start anywhere in the league. A twelve-team league running two running
back slots and three flex slots starts about thirty-two running backs, so
replacement is roughly the thirty-third. Change the roster shape and that number
moves, which is why the same player is worth a different amount in two different
leagues.

**Points above replacement.** What a player projects, minus that week's
replacement level, floored at zero by default.

**Wins above replacement.** Points above replacement converted into win
probability against a league-average opponent, summed across every remaining
regular season week.

The conversion is where the correctness lives, and section 4.4 of the plan spent
its length on one subtraction. The team a player is being compared against is
NOT the league-average team. It is the league-average team with a
replacement-level player at the evaluated position:

```
deficit(pos, w)      = max(0, avgSeated(pos, w) - replacement(pos, w))
baselineMean(pos, w) = muRef(w) - deficit(pos, w)
evaluatedMean(p, w)  = baselineMean(pos, w) + PAR(p, w)
```

Without the deficit subtraction, the evaluated team holds both a league-average
starter at the position AND the evaluated player's production above replacement,
in the same slot. At realistic magnitudes that costs about half a percent,
because the normal CDF is close to linear near zero. In a low-variance league it
costs sixteen percent, and low in exactly the region readers care about. More to
the point, the double-counted version describes a team that does not exist, so
no sentence written about the baseline would be true.

`lib/positional-war/war.test.ts` carries a test named "does not use the centered
baseline" whose whole job is to fail loudly if somebody simplifies it back.

---

## 3. Structural versus weekly demand

This is a specification, not an implementation detail, and it is the second
place the plan says a build goes wrong.

Demand is two different numbers doing two different jobs.

**Structural demand** is one integer per position, computed once from a
bye-free fill in which every player is represented by his mean across the
window. It drives the x-axis, the depth cap, `war_at_demand`, and every sentence
of copy. It has to be stable, because a wobbling axis is unreadable and
unshareable, and "in this league, thirty-two running backs start" is a sentence
a reader can check.

**Weekly seated counts** drive replacement level and nothing else. A bye week
genuinely lowers replacement, and that is exactly the week a starter is worth
most.

The consequence must be stated in the UI and must never be "fixed": because
replacement is weekly and the axis is structural, the curve does not cross zero
at the replacement line. The player sitting exactly at structural demand carries
a small POSITIVE figure, because he beats the weekly replacement in most weeks.
So the marker at that point is labelled with its real value rather than an
asserted zero. On the live league checked below that value was between 0.05 and
0.19 depending on position, and it is stored as `war_at_demand` precisely so the
chart never has to guess it.

---

## 4. The two metrics, and the rule that keeps them apart

This product now has two numbers that both convert something into wins, and they
answer different questions.

| | Positional WAR | Projected wins |
| --- | --- | --- |
| Question | How scarce is this position in this league? | What does this move do to THIS roster? |
| Reads a roster | No | Yes |
| Optimizer runs | Once per week per league | Once per week per candidate |
| Lives in | `lib/positional-war/` | `lib/power-pulse/what-if.ts`, `lib/faab/marginal.ts` |
| Code identifier | `positionalWar` | `winsDelta`, `expectedWins` |

They legitimately disagree, and the disagreement is the point. A league where
the top quarterback carries 0.65 Positional WAR still gives a reader who already
starts a good quarterback almost nothing by acquiring him, because only one of
them can play. A reader shown one number under the other's name has no way to
detect the swap.

So the token "WAR" names exactly one metric here and always carries the word
"Positional" adjacent to it. `lib/positional-war/naming.test.ts` enforces this
as a proximity rule rather than a ban, because the Trade Ideas asset note
legitimately prints a Positional WAR figure as labelled context: inside
`lib/trade-impact/`, `lib/faab/` and `lib/power-pulse/`, every occurrence of the
token must have `Positional` within forty characters before it, comments
included. The team-specific vocabulary is banned from `lib/positional-war/` and
`components/league-war/` except in the upgrade panel, which is the one place
both metrics legitimately meet and which is required to label both.

The guard caught two real things during the build: two comments in
`lib/power-pulse/` that said "the WAR model" and "rank-1 WAR" without
qualification, and later a JSX comment carrying the task id `T-WAR-48`, whose
hyphens put word boundaries either side of the token. The first two were
rewritten. The second was a false positive and taught the guard to recognise
`{/*` as a comment opener.

---

## 5. Architecture

### 5.1 The model, in dependency order

| Module | What it does |
| --- | --- |
| `lib/positional-war/types.ts` | The shared shapes, and the naming rule in its header. |
| `lib/positional-war/default-settings.ts` | `displayDepthMultiple`, `minDisplayDepth`, `cliffThreshold`, `clampBelowReplacement`, `modelVersion`, the TTL and retry constants, and `WAR_SETTING_BOUNDS`. |
| `lib/positional-war/fingerprint.ts` | The exact invalidation key. Pure, clock-free, no I/O. |
| `lib/positional-war/replacement.ts` | The merged fill, structural and weekly demand, replacement, avgSeated, deficit, muRef, sigmaRef. |
| `lib/positional-war/war.ts` | Points above replacement, the two lineups, and the win conversion. |
| `lib/positional-war/engine.ts` | `computeCurves()`. Pure; takes plain data, returns plain data. |
| `lib/positional-war/load.ts` | The cached full-universe read and the projection assembly. |
| `lib/positional-war/chart-geometry.ts` | The path maths, shared by the on-page chart and the social card. |
| `lib/positional-war/share.ts` | Cross-league compute sharing and its collision guard. |
| `lib/positional-war/upgrade.ts` | The team-specific what-if. The one place the other metric lives in this directory. |
| `lib/league-positional-war.ts` | The orchestrator: staleness, backoff, status writes, and `refreshPositionalWar`, which never throws. |
| `lib/league-positional-war-data.ts` | The read side. One `cache()`-wrapped query shared by the panel and the rail. |

### 5.2 The one algorithm, run W+1 times

Everything the model reports is read off ONE construction: build `teamCount`
copies of the league's startable slots and fill them optimally from the whole
projectable universe. Run it once per week in the window, plus once over the
bye-free universe. That is W+1 calls per league, typically eleven to eighteen.

**The optimizer is never rerun per player.** No player is ever removed and the
lineup refilled. That is the team-specific metric's job, and
`lib/faab/marginal.ts` already does it correctly, including the cascading lineup
changes. Positional WAR reads its inputs off a single fill and then does
arithmetic. Seeing `buildOptimalLineup` in the imports, the natural instinct is
to write a per-player refill loop; that loop would be about a thousand times
more expensive AND would compute the team-specific metric under the Positional
WAR name, which is exactly what the naming rule forbids. The module header says
so, at length, for that reason.

The fill is exact rather than greedy-by-slot-order. `buildOptimalLineup` offers
candidates in descending points and admits via augmenting paths, which is
optimal on a transversal matroid. Because two players at the same position share
slot eligibility, the seated players at any position are exactly the top k of
that position by points, so `max(benched at pos) <= min(seated at pos)` always
holds. That invariant is asserted across all nine flex configurations in
`replacement.test.ts`; if it ever fails, the optimizer changed and this model is
invalid.

### 5.3 Replacement is defined per position, deliberately

Three definitions were defensible and the plan required the choice be stated,
because an implementer picking differently produces a chart that looks right and
is not.

- **Per position** (best benched player at that position). This is what is used.
- **Per slot** (best benched player eligible for that slot). Rejected: a
  dedicated RB slot and a FLEX slot in the same league would give running back
  two different replacement levels, and there is no single number to plot.
- **Refill with the player removed.** Rejected: that is the team-specific metric
  and belongs in Trade Ideas.

The per-position definition also produces the right flex behaviour with no
special case. The merged fill is greedy by points, so the marginal seated player
across every flex-eligible position sits near the same level, and in a league
with deep flex the running back, receiver and tight end replacement levels
converge. That convergence IS the scarcity signal: a deep flex means the
positions substitute for one another.

### 5.4 The fingerprint

Because the model reads no roster, the result is a pure function of a short,
enumerable list of league inputs. That is what makes the cache key exact rather
than a heuristic.

In it: season, the week window, team count, the sorted slot multiset, the
normalized scoring map, the scoring usability flag, the scoring base, the Power
Pulse settings blocks the projection stack actually reads, the WAR display
settings, the model version, the projections snapshot truncated to the hour, and
a schema version constant.

Deliberately out of it: rosters and ownership, the value source, the format
config, playoff team count, the head-to-head schedule, and any slot token that
carries no projection. Each exclusion has a stated reason, and the absence of a
value source is enforced as a COMPILE-TIME assertion rather than a comment, so a
future accidental `source` field fails `tsc`.

`normalizedScoring` is provable rather than heuristic. `scoreStatMap` skips an
entry when the value is not finite, is exactly zero, or is a non-scoring key, so
the set of entries that can affect any player's score is exactly the complement
of that filter. `isNonScoringKey` was exported from `lib/league-scoring.ts` for
this, with a comment saying the two must change together, and a test asserts
they stay in step.

The practical win: a commissioner who turns on TE premium at eleven at night
sees a corrected curve on the next page view, rather than up to twelve hours
later when a TTL happens to expire.

### 5.5 Cross-league compute sharing

Two leagues whose fingerprints match produce byte-identical curves, so the
second copies six rows instead of reading the universe and running W+1 fills.
`positional_war_curves` is keyed by `(fingerprint, position)` and is consulted
on the WRITE path only. The read path does not change: the per-league table
keeps its full rows, so every consumer still issues exactly one query.

The risk was never the maths, it was a normalization bug serving one league's
curve to another with nothing visibly wrong. So `inputs_digest` stores nine
human-readable values, not the hash, and every hit recomputes them from the
requesting league and compares field by field. A mismatch logs both digests at
error level, deletes the colliding rows, recomputes, and writes "fingerprint
collision, recomputed" into the status detail so it surfaces in the admin health
view. That turns a silent failure into a loud one.

Concurrent writes are deliberately unguarded. Two leagues rendering at once with
the same fresh fingerprint both compute and both upsert; `on conflict do update`
makes the second a harmless overwrite of identical data. A lock would be a new
failure mode for a bounded amount of duplicate work.

### 5.6 Failure, staleness, and observability

The plan found an existing defect in Power Pulse and refused to copy it.
`powerPulseIsStale` returned true whenever there were no rows, and the skipped
reason went to `console.warn` and nowhere else, so a league that skipped
deterministically re-attempted on every single page view and the panel said
"Power Pulse is still calculating" indefinitely with no way for anyone to learn
why.

Both features now carry four columns on `leagues`: a status
(`pending`/`ok`/`skipped`/`settled`/`error`), a server-written detail, and an
attempted and succeeded timestamp.

`skipped` is a transient reason worth retrying soon. `settled` is a statement
about the season and the week window that cannot change until one of them does,
which is what lets its retry bypass be exact rather than time-based. Both back
off fifteen minutes, with bypasses: a force, a fingerprint change, or
`last_pulsed_at` advancing past the attempt. That last clause is what keeps a
league responsive on draft night, because `pulseLeagueCore` writes rosters and
advances `last_pulsed_at`, so a league that finishes its draft retries on the
very next view rather than fifteen minutes later.

The write ordering is an absolute rule inherited from `CLAUDE.md`:
`attempted_at` is stamped BEFORE the expensive work, so a crash mid-run still
backs off rather than hot-looping, and the status, the detail and
`succeeded_at` are written AFTER the rows land. A `settled` verdict clears any
stored rows, for the same reason Power Pulse does: a degenerate answer outlives
the run that produced it, and a curve of zeroes reads as a real result.

---

## 6. Where it appears

| Surface | What it shows |
| --- | --- |
| `/leagues/[id]` main column, under the rankings | The full panel, in its own Suspense boundary. |
| `/leagues/[id]` right rail | A three-line text finding, above "Explore this league". |
| `/leagues/[id]/positional-war` | The same panel at full width, plus the upgrade what-if. |
| `/leagues/[id]/power-pulse` | The same panel under the projected champion. |
| `/leagues/[id]/trade-ideas` | A labelled context line on an asset card. |
| `/api/og/war/[league_id]` | The shareable card. |
| `/admin/system/league-health` | Both features' run health, one row per league. |
| `/admin/power-pulse` | The model's five settings. |

The chart is in the overview's MAIN column rather than its rail because the rail
is 340 CSS px and only from the `xl` breakpoint up, leaving about 290px of plot
area. Six series, a y-axis and a legend do not fit in 290px: the series become
indistinguishable, the tick labels collide, and the legend toggles cannot hold
their 44 by 44 tap target. The rail carries the FINDING instead, as three lines
of text with real numbers, which fits comfortably and gives the overview a
presence the chart could not have there.

---

## 7. Accessibility

The chart is the hardest thing in this build for a non-visual reader, and this
product's owner uses a screen reader, so it got the most attention.

- The `<svg>` is `aria-hidden`. Every fact it carries lives somewhere else.
- `ChartFigure` supplies a visually hidden sentence stating the CONCLUSION, not
  the shape. It names the scarcest and the flattest position with their numbers
  and says "in this league". The summary is a paragraph rather than a
  `role="img"` host for a documented reason: `role="img"` makes every descendant
  presentational, which would delete the real text out of the DOM-based charts
  that share this kit.
- A real `<table>` of every plotted value sits inside a `<details>` that is
  always in the DOM, at every breakpoint, scrolling inside its own container.
  Hiding a series through the legend removes it from the SVG and leaves the
  table complete.
- Legend entries are `aria-pressed` buttons carrying their own headline as text,
  so the ranking is readable from the legend alone with no chart at all.
- The readout is a FOCUS readout as well as a hover readout, in an `aria-live`
  region, so it is reachable by keyboard.
- Each of the six series carries a distinct hue, a distinct dash pattern and a
  distinct marker shape, so the chart survives colour removal. The palette was
  chosen with the `dataviz` skill loaded and the contrast ratios computed
  against the ACTUAL composited panel surface rather than a token name.
- The viewer overlay is a ring marker distinguishable by shape and stroke, plus
  a literal "Yours" text column in the table. Never a colour-only signal.
- The rail's anchor moves keyboard focus to the chart panel's heading, not
  merely the scroll position.
- No responsive utility hides a data-bearing element at any breakpoint.

---

## 8. Live validation against production

Run before the review pass, against the real database and real 2026
projections.

The projectable universe matched the plan exactly: WR 413, RB 233, TE 230,
QB 133, K 42, DEF 32.

**A twelve-team league running three flex slots and a kicker but no defense.**

| Pos | Demand | Replacement | rank-1 | at demand | cliff | curve |
| --- | --- | --- | --- | --- | --- | --- |
| RB | 32 | 8.89 | 2.353 | 0.191 | 8 | 80 |
| WR | 46 | 9.15 | 2.028 | 0.146 | 9 | 115 |
| TE | 18 | 8.96 | 1.104 | 0.151 | 6 | 45 |
| QB | 12 | 17.19 | 0.398 | 0.155 | 11 | 30 |
| K | 12 | 7.30 | 0.292 | 0.051 | 5 | 30 |

No defense curve, because the league runs no defense slot. Seated totals come
out exactly right: 32 plus 46 plus 18 is 96, which is the eight flex-eligible
slots times twelve teams, and adding the twelve quarterbacks and twelve kickers
gives 120, which is ten startable slots times twelve teams. Every depth cap is
`max(24, ceil(demand * 2.5))`. Every `war_at_demand` is positive.

Against the plan's own sanity bands, quarterback sits inside its range and tight
end just above. Running back and receiver run above, because this league starts
three flex rather than one, so demand is 32 and 46 rather than the plan's 28 and
42, replacement falls, and rank-1 rises. That is the model working. Nothing is
outside the factor of two the plan sets as its bug threshold.

**A superflex league**, which is the plan's sharpest test. Quarterback
structural demand came out at 24, exactly twice the team count, so the superflex
slot seats a second quarterback on every team. Replacement fell from 17.19 to
13.22 and rank-1 rose from 0.398 to 0.768, a 93 percent jump against the 40
percent the acceptance criterion requires.

**One number that looks wrong and is not.** The quarterback curve in that league
stops at 43 rather than its cap of 60. Checked directly: exactly 43 of the 133
quarterbacks in the universe have any published numbers at all, and 90 have
projection rows with an empty stat line and a null points column. The engine
scored 43 and refused to invent the other 90. That is the "a null projection is
never a zero" rule working end to end, and it is why the raw-rank axis mode's
truncation is the honest picture rather than a rendering gap.

**Sharing, proven both ways.** Two leagues with genuinely different scoring, 68
keys against 67, produced different fingerprints and both computed fresh: the
guard correctly declined to share two leagues that are not the same. Two leagues
with byte-identical settings produced the same fingerprint, and the second
returned in 1,177ms against roughly 10,200ms for a fresh compute, an 8.7x
saving, with all four positions' curves comparing byte-identical.

---

## 9. Three bugs found by running it, not by testing it

Every one of these passed the full unit suite. They were found by running the
real script against real leagues and then looking at what landed in the
database.

**1. The standalone recompute path did not work at all.**
`npm run calculate:positional-war` threw `Invariant: incrementalCache missing in
unstable_cache` before reading a single row. `unstable_cache` needs a Next.js
incremental cache, which exists during a request and does not exist in a plain
node process. The memoization is a performance optimization and not a
correctness requirement, so `loadWarUniverse` now catches that specific
invariant and falls through to the uncached read. The catch is deliberately
narrow: a short paged read or a query error still throws, because those are the
failures that would otherwise shrink the universe and silently raise every
replacement level.

**2. A successful manual recompute reported itself as a failure.** The script
called `calculateLeaguePositionalWar` directly, which writes cache rows and no
verdict. So a manually recomputed league kept a null `positional_war_succeeded_at`
while its `last_pulsed_at` stayed recent, and that exact combination is what the
admin health view reads as the signature of a systemic break. Fixed by
extracting `runWithVerdict` so the page path and the script share one copy of
the stamp-calculate-write ordering.

**3. The health view would have reported a quarter of the estate as broken on
day one.** Its break signature was "succeeded_at is null while last_pulsed_at is
recent", with never-viewed leagues excluded on the grounds that their
`last_pulsed_at` is null. But `last_pulsed_at` is written by the LEAGUE sync,
not by either feature, so a league pulsed yesterday that has simply never had
Positional WAR computed matched the signature through no fault of anything.
Counted against production: 55 of 212 leagues. A health view whose first act is
to report a quarter of the estate as broken teaches an admin to stop reading it,
which is the exact opposite of its purpose. `staleSignature` now also requires
`attempted_at` to be non-null: a feature never attempted for a league is not
failing for that league, it is waiting for someone to open the page.

---

## 10. Known gaps and deliberate limitations

**The Signal Guide link on the Trade Ideas card does not open in place.** No
deep-link mechanism to a single guide term exists anywhere in this codebase, and
`/leagues/[id]/trade-ideas` is not in the guide page registry. Wiring a real
in-page opener needs a registry migration. The card links to the League
Overview instead, which is a registered guide page where the Positional WAR term
already surfaces. Honest and functional, and worth a follow-up.

**One of the upgrade panel's six empty states cannot fire today.** The plan's
edge-case table implies `computeLineupSwap` can return a non-null `dropNote`
from a plain `mustDrop: true` call. Tracing `lib/faab/marginal.ts` shows that
message only fires when a drop guard is configured, which this feature's
computation spec does not include. The pass-through is correct and tested
against a mocked return, but wiring the value and drop-guard inputs is what
would make it reachable.

**IDP leagues get six positions and a footnote.** Sleeper publishes projections
for six positions only, so an individual defensive player league's defensive
slots have no projection. They are named in the footnote rather than silently
dropped, and never given a zero.

**Kicker sits further above the plan's rough band than the other positions.**
The plan's estimate was a generic-PPR back-of-envelope; the model scores kickers
under each league's own settings, and kicker is the position where a small
absolute difference is a large ratio. Worth watching rather than a defect.

**The pointer read path for shared curves is deferred**, on a stated threshold
of roughly ten thousand leagues, not on preference. At 212 leagues the
duplicated curves are a few megabytes and there is nothing to buy yet.

**Positional WAR history is out of scope.** Storing a curve per week so a reader
could watch scarcity move across a season needs a different table shape, a
retention policy, and a second chart.

---

## 11. Review pass

Four sub-agents reviewed the finished build independently, one per dimension,
each told to stay in its lane and to be adversarial about what the tests do not
cover.

### 11.1 What each reviewer confirmed

**RLS exists and works on both new tables**, verified against the live database
rather than by reading the SQL. `league_positional_war_cache` is readable by
anon and authenticated (21 live rows), and an anon insert raises an RLS
violation while an authenticated update affects zero rows.
`positional_war_curves` returns zero rows to both anon and authenticated
against a table proven to hold 17 rows as owner, which is RLS blocking rather
than an empty table. The eight new `leagues` columns inherit the table's
existing read-only posture: there is no client write policy on `leagues` at all.

**All twelve of the plan's most-likely-to-be-wrong areas hold.** The optimizer
has exactly one call site and is never rerun per player. The anti-double-count
is present and its regression guard would genuinely fail if simplified back.
Every consumer uses structural or weekly demand per the section 4.3 table.
Replacement is per position. The shallow pool never becomes a zero. A null
projection is never stored as a zero. The fingerprint's field list matches
section 6.1 exactly, with `source` absent and its absence enforced at compile
time. Write ordering is correct in both features. Clear-on-settled fires only on
settled. Positional WAR is genuinely parallel in `pulseLeagueDerived`. The
nightly cron does no per-league work.

**No duplicate implementations survived the concurrent build.** There is one
scarcest-and-deepest selection function and one chart geometry function, and the
on-page chart and the OG route call the same one.

**The palette's claimed contrast ratios are accurate.** The accessibility
reviewer independently recomputed WCAG relative luminance for three of the six
against the composited background and matched the comments exactly, and
confirmed the composited value against the Tailwind config.

**No data is hidden at any breakpoint.** The only responsive-hiding utilities in
the audited files are on the pre-existing rankings table, which already has a
compliant mobile equivalent.

### 11.2 What they found, and what was done about it

Seven findings were acted on. Each is listed with what it would have cost a
user.

**1. A cold curve was blocking the rankings table, not the chart.** The most
serious finding in the pass. `refreshPositionalWar` is a fourth parallel stage
inside `pulseLeagueDerived`, which is correct for the write path. But on the
overview, `pulseLeagueDerived` is awaited by the component that renders the
RANKINGS TABLE, not by the one that renders the curve. So a cold fingerprint,
about ten seconds of universe read, was holding up the page's primary content
while the curve's own skeleton resolved instantly against data already written
by the time it looked. The panel's Suspense fallback was doing nothing and the
rankings skeleton was doing the panel's waiting. The reviewer noted the plan's
section 12 never examined this call-site coupling, and that the live validation
measured the compute through the script rather than through a page render, which
is why it was not caught earlier.

Fixed by adding `includePositionalWar` to `pulseLeagueDerived` and a
`PositionalWarSection` server component that owns the compute behind the
boundary that shows it. Pages opt out; scripts and the refresh endpoint keep one
call that does everything. This is a deliberate divergence from the plan's
section 12 wording, and the reasoning is written into both files.

**2. The overlay dropped the injury designation the plan requires.** Section
15.1.1 says an IR or taxi player is marked rather than filtered, and that the
readout carries his designation, "the same one the rest of the product shows".
The pipeline resolved it but it never reached the surface: `WarCurvePoint` had
no field for it. A reader who owns an injured RB1 heard exactly the same
sentence as if the player were healthy, which contradicts what every other
surface tells the same reader about the same player. Fixed by carrying
`injuryStatus` onto the curve, into the spoken readout, and into a new Status
column in the data table.

**3. Orphaned rows when a league stops starting a position.** The upsert only
ever writes the positions the fresh computation produced, and nothing deleted a
row for a position that had disappeared. A commissioner dropping the DEF slot
mid-season would change the fingerprint, force a recompute returning one fewer
position, and leave the old DEF row in place. The read path takes every row for
the league season with no fingerprint filter, so a stale series computed under
settings that no longer describe the league would keep rendering on the chart,
the rail and the shared card. That is the same silent-wrong-answer failure the
fingerprint and the collision guard exist to prevent, arriving through the one
door neither of them watches. Fixed with a scoped delete after the write, plus a
test.

**4. A heading level was skipped on all three pages.** `Panel` renders h2 and
`ChartFigure` rendered h4 directly inside it, so a reader navigating by heading
hit an unexplained jump on every page carrying the chart. The plan itself
specified the h4, which conflicts with the project's unconditional
no-skipped-levels rule. Fixed by making the figure's title level a prop that
defaults to 4, so the Beacon Breakdown is untouched, and passing 3 from this
panel.

**5. The live region could rattle through announcements on a pointer sweep.**
The nearest point changes every five to fifteen pixels on a dense series, so a
mouse sweep or a touch drag could queue a dozen sentences into a polite region
in under a second. Fixed by debouncing the SPOKEN readout only. The visible
readout still tracks the pointer exactly, because a sighted reader wants that
and a screen reader wants the sentence for where the pointer came to rest.
Keyboard stepping settles inside the delay either way.

**6. An unguarded PostgREST `.or()` filter.** `resolveUnmatchedOwnerInfo` built
a comma-separated filter string from Sleeper ids with no character-class guard,
where the codebase's other `.or()` construction carries one and documents why.
Not reachable from request input under today's callers, since the ids come from
a service-role sync, but it is an exported function with no input-shape contract
in its own signature. Fixed with the same guard and the same reasoning.

**7. No cheap meter before the upgrade action's reads.** The evaluation meter is
claimed after validation, which is right for a reader on a stale page. But a
shaped-but-invalid payload still bought a league lookup and two more reads
before any meter fired, so garbage was the one input that skipped the meter.
That is precisely the hole a previous security review found in the Trade Ideas
limiter, which is why that module carries two meters. Fixed by adding a
deliberately loose outer bucket claimed before any read, plus a test.

Two further performance fixes were applied from the same pass: parallelizing the
independent chunk loops in the universe loader, which is where the cold
compute's time actually goes, and sharing the viewer reads through React
`cache()` the way the curve read already was.

### 11.3 Findings recorded but not acted on

**The axis toggle drops below 44 by 44 from the `sm` breakpoint up.** It is a
byte-for-byte copy of the existing rank-mode toggle the plan told the
implementer to model it on, and the project's own rule mandates 44 by 44 "in the
compact mobile layout", which it satisfies. Changing it here would make this one
control inconsistent with its sibling. Worth a separate pass across both.

**A redundant index.** `idx_league_positional_war_cache_league` on
`(league_id, season)` is a strict prefix of the unique index on
`(league_id, season, position)`, so Postgres can already satisfy the read from
the unique one. It costs nothing on reads, a little write amplification on
upsert. Worth folding into a future migration rather than adding one now.

**Mobile chart readability is unverified.** The plan says that if six curves are
unreadable below `sm` the fallback is a taller aspect ratio, never fewer series.
The implementation keeps one fixed aspect ratio at every breakpoint and never
reduces the series count, which satisfies the letter. Whether six overlapping
curves stay legible on a 320px phone needs a rendered screenshot to settle.

**One unreachable empty state.** If a league somehow had curves whose every
entry was empty, the panel would render a chart frame next to a "not calculated"
sentence. The reviewer judged it probably unreachable given the shallow-pool
fallback.

### 11.4 The performance picture, measured

The reviewer traced the cold compute to about 58 sequential database round trips
in the universe loader, which at roughly 150 to 175ms each accounts for
essentially the whole 10.2 seconds. The engine's own arithmetic, 19 exact
lineup fills plus roughly 15,000 closed-form normal CDF calls, is negligible
next to the I/O.

That matters for what to fix next, because the plan pre-designated the pointer
read path as "the next lever" and the reviewer showed the cost is not on the
read path at all. The chunk loops in the loader are over independent chunks and
were inherited from a function written for 350 players and reused here at three
times the width.

Cache key cardinality was checked against production and is healthy: across 210
real 2026 leagues there are only four distinct `toWeek` values and three scoring
bases, so the whole estate shares roughly 8 to 12 universe reads rather than
fragmenting. The cold path therefore recurs once per key per day, after the
nightly projections sync busts the tag, rather than once per league.

Bundle size is unremarkable: the overview is 137kB first load and the dedicated
route 127kB, against 152kB for Trade Ideas and 257kB for On The Clock.

Warm p95 for the WAR contribution is a few hundred milliseconds and comfortably
inside the plan's two-second budget. The cold path was the problem, and finding
1 above is the half of it that was blocking a user.

Measured after both fixes, on the same superflex league with the shared-curve
table emptied first so the compute genuinely ran cold: 5,111ms, against 9,525ms
for the same league before. Roughly half, from parallelizing loops that were
never sequential for a reason. It is still not fast, and the remaining time is
still database round trips; the next lever if it matters is widening the pages
rather than anything in the model.

---

## 12. Operating notes

- Recompute one league: `npm run calculate:positional-war -- --sleeper-league-id <id>`.
  Add `--force` to bypass the freshness gate. Forcing does NOT bypass compute
  sharing, which is intended: a forced run whose fingerprint another league has
  already computed still copies.
- Recompute everything: `npm run calculate:positional-war`. Do NOT wire this
  into a cron. Per-league recomputation is on demand by design, for the same
  scaling reason as the league power rankings.
- The only Positional WAR work in the nightly job is a single seven-day delete
  against the fingerprint-keyed sharing table, which iterates no leagues.
- To force every league to rescore, bump `war.modelVersion` in
  `/admin/power-pulse`. Changing any other WAR setting has the same effect
  automatically, because every field is in the fingerprint, which is why the
  fieldset says so out loud.
- Diagnose a league at `/admin/system/league-health`.

## Writing check

Ran the AI-writing-patterns check from the global instructions against this
document. No em dashes, en dashes, curly quotes, ellipsis characters, middle
dots, or emoji. One fix in the first draft: a sentence in section 9 read "not
just a test failure, a design failure", which is the negative-parallelism
construction the standard bans outright; it was rewritten to state plainly that
the bugs passed the unit suite and were found by running the code. No
three-item lists used as rhythm, and no significance-inflation clauses.

---

## 13. Follow-up pass: the recorded findings closed, and a performance audit

Written the same day, against the same working tree, after section 11 was
finished. Still nothing committed.

Section 11.3 recorded four findings without acting on them and section 10 named
two known gaps. All six are now closed, and a performance audit went after the
whole feature rather than only the lever the previous pass named. The full task
records with file lists are in `progress.md` under "Follow-up pass"; this
section is the reasoning.

### 13.1 Mobile chart readability: the risk the plan named was the wrong one

Section 11.3 said this needed a rendered screenshot to settle. It did, and the
screenshot answered a different question than the one being asked.

The plan's worry was six curves overlapping below `sm`. What actually breaks is
the TYPE. The chart drew into a fixed 640 by 360 viewBox and let the browser
scale it to the container, and `vector-effect="non-scaling-stroke"` protects
stroke widths but nothing protects text: a label set at 9 units renders at
9 times containerWidth / 640.

The container is not the viewport, which is why nobody caught this by looking at
a phone-width mockup of the page. On a 320px viewport the chart gets the
viewport less the page gutter (`px-4`, 32), the Panel body (`px-4`, 32) and the
ChartFigure (`p-4`, 32). That is 224 CSS px, a scale factor of 0.35, and every
axis label on both axes at about 3 CSS px, which is not legible at all.

The fix is the one the plan prescribes and it is now in a pure module,
`lib/positional-war/chart-layout.ts`, so the decision is testable rather than
buried in a component. Below 640 CSS px the coordinate space is sized to the
container itself, so the scale factor is never below 1 and a 10-unit label never
renders under 10 CSS px, and the aspect ratio grows as the container narrows so
six curves get vertical room to separate. Never fewer series; nothing in that
module can drop one, because it has no access to one.

Two details are load-bearing:

The measured width is floored to a 20px quantum, deliberately DOWN rather than
to nearest. The coordinate space must never end up wider than the container it
is drawn into, or the type shrinks again. Rounding to nearest would let a 630px
container round up to 640, cross the breakpoint, and take the wide box for a
container too narrow to carry it. That is the same defect in miniature, and a
test sweeps every width from 200 to 1400 CSS px asserting it cannot happen.

The x-axis label fitter is priority-ordered rather than left to right.
"Replacement level" is the one sentence on that axis and it is six times as wide
as the "0.5" and "1.5" that flank it, so it claims its space first and its
neighbours give way. This drops LABELS, never ticks and never series, and every
dropped value is still in the data table under the chart, so nothing is hidden
at any breakpoint.

Settled with a rendering of the real league at 224 CSS px, before and after.

### 13.2 The Signal Guide link now opens in place

Section 10 said no deep-link mechanism existed anywhere in the codebase and that
`/leagues/[id]/trade-ideas` was not in the guide page registry. Both were true.
Both are now built, and built generally rather than for one card.

`lib/guide/open-guide.ts` is a module-level bus carrying two directions of
traffic. The mount publishes whether the CURRENT page has a guide at all, and
any component anywhere can request an open at a named entry. That first
direction is what makes the control honest: `GuideTermLink` renders a real
opener when a guide exists and the League Overview link it used to be when one
does not, so a page with no guide gets a working link rather than a button that
silently does nothing. Server rendering always produces the link and upgrades on
hydration, so a crawler and a reader without JavaScript both get something that
works.

The panel resolves the requested heading against the FULL content rather than
the search-filtered lists, expands that entry, scrolls to it and moves focus to
it, and its own focus timer stands down for a deep link so a screen reader hears
the term it was sent to read instead of an empty search field it did not ask
for. A nonce rides along so asking for the same heading twice counts as two
requests; without it, closing the panel and pressing the same control again
would pass an unchanged prop and open at the top.

Migration 0217 registers the Trade Ideas and Positional WAR section routes,
which is what gives those pages a panel to open at all. The "Positional WAR"
term is already `is_global` from migration 0213, so it surfaces in both.

Confirmed in a browser against the production build: the Guide launcher now
appears on `/leagues/[id]/trade-ideas`, and its panel carries "Positional WAR"
as the thirty-third of thirty-three terms. That position is the argument for the
deep link. A reader who presses "What is Positional WAR?" was previously sent to
another page; before that they would have had to open the panel and scroll past
thirty-two other definitions.

A second entry was added at the same time, "WAR (wins above replacement)", for
the three-letter question. The existing entry is 2,180 characters of metric
explanation, which is the wrong answer to "what does WAR stand for". One row in
`guide_entries` serves the Signal Guide panel and BEAM, which reads the same
table, and a matching entry went into `/guides/fantasy-football-terms`. The
heading shape is deliberate: BEAM scores an exact heading match above a prefix
match above a substring hit, so "what is WAR" lands on the short entry and "what
is Positional WAR" still lands on the full one. Reproduced against production
before shipping it.

### 13.3 The unreachable states, and why one was deleted rather than wired

Two different unreachable states, two different answers.

The panel's "curves exist but every one is empty" state was reachable in
principle and rendered an empty chart frame beside a "not calculated yet"
sentence. Fixed in the panel, the rail and the OG card together, by asking
`curves.every(c => c.curve.length === 0)` instead of `curves.length === 0`. An
empty array satisfies `every`, so the original no-rows case is untouched.

The upgrade panel's sixth empty state is different: it is not reachable, it is
STRUCTURALLY not reachable. Both branches of `chooseDrop` that produce a note
require a drop guard, and this caller configures none, so `dropNote` was always
null. Section 10 suggested wiring the guard would make it reachable. Tracing it
further says that is the wrong move: both modes of the guard rank the roster by
trade VALUE, and Positional WAR is source-independent by contract, so wiring one
would put a value-source dependency into a surface whose entire point is that
the source toggle cannot change it.

So the pass-through is gone and the test was rewritten to pin the INPUT rather
than assert a pass-through against a mocked return the real call cannot produce.
If a drop guard is ever configured here, the test fails and says to bring the
sentence back with it.

### 13.4 Tap targets, in both files rather than one

Section 11.3 declined this because fixing one control would make it inconsistent
with the sibling it was copied from. Fixed in both, which removes the objection.
`sm` starts at 640px, and a tablet and a large phone turned sideways are both
touch devices well past that line. Four other controls elsewhere in the app carry
the same `sm:min-h-0` pattern; those are out of scope here and worth their own
sweep.

### 13.5 The performance picture, re-measured

Section 11.4 concluded that the engine's own arithmetic was negligible next to
I/O, and pointed the next round of tuning at widening the database pages. A CPU
profile of a cold compute says otherwise: 4,343ms of 7,460ms of samples landed
in one anonymous function inside `lib/power-pulse/lineup.ts`.

`buildOptimalLineup` rebuilt a candidate's eligible-slot array on every seat
attempt, scanning all 120 merged slots and running `Array.includes` over each
one's eligibility list, and allocated a `Set` per offer. Slot eligibility depends
on the candidate's POSITION and nothing else, so the answer is the same for
every candidate at that position and for every one of the many times an
augmenting path re-asks it about an incumbent. Precomputed once per fill, with a
stamped `Int32Array` replacing the per-offer `Set`.

Thirteen weekly fills on the live league took 1,108ms before. The whole engine,
fourteen fills plus every quantity read off them, is 175ms after. Verified
byte-identical over 640 randomized cases across four roster shapes (including
overlapping non-nested slots, which is the case plain greedy gets wrong), four
team counts and forty universes each. Power Pulse, FAAB and Trade Ideas all run
the same optimizer per candidate and all get the same speedup.

Three I/O findings, each with a measurement:

**The window was read twice.** The loader scanned it once for `(id, player_id)`
to learn which players exist, then again through `loadProjections` for the full
rows of exactly those players. The second read returns a strict subset of the
first read's rows. Positional WAR's universe is BY DEFINITION every player with
a projection in the window, so "the rows I need" and "the rows that exist" are
the same set, and the first scan bought nothing but round trips and 13,000 extra
rows on the wire. One pass now, with the completeness count running alongside
the walks instead of ahead of them. Universe load 1,872-2,062ms before,
719-739ms after, identical row and player counts.

**The player resolver shipped 2MB of jsonb to read one string.**
`players.metadata` holds the full raw Sleeper object per the project's
source-preservation rule, about 2kB compressed per row across 1,083 players, and
the resolver selected the whole column for `metadata.sleeper.injury_status`.
Postgres extracts it now. Verified against 200 production players, 103 of them
carrying a designation, that the extracted values match what the JavaScript
unpacking produced.

**The warm gate was seven serial round trips, on every page view.** This is the
one that matters most, because it is what a reader pays on every view of a
league whose curve is already fresh, which is almost every view. Two of those
reads were the same row of the same table a few lines apart. The context now
builds in two waves split at the week window, which is the only real dependency
in it, the memo caches the PROMISE rather than the resolved value so two
concurrent askers share one build, and the built context is threaded into the
compute, which used to rebuild the whole thing from scratch. 543-557ms before,
276-278ms after.

Plus a migration: `loadProjectionsSnapshot` runs on every league page view (it is
deliberately not memoized, because it is the read that DETECTS a fresh sync) and
was reading all 18,413 rows of the season and top-N sorting them to return one
value. 28.1ms and 18,659 shared buffer hits, down to 0.05ms and 12.

End to end against `next start` on the production build: the overview page's
first byte at 77ms, its rankings table in the stream at 239ms and the Positional
WAR panel at 932ms, which confirms section 11.2's first finding still holds; the
Positional WAR page at 150-230ms to first byte and 864-924ms to a complete
stream; the OG route at 380-490ms uncached; and a genuinely cold compute, with
`positional_war_curves` emptied first, at a 1,607ms median.

Correctness was checked the way it has to be for a performance change: the full
model was run over twelve real 2026 leagues on the universe the old loader
produced and on the universe the new one produces, spanning eight, ten and
twelve team counts and two scoring bases. Twelve of twelve produced
byte-identical curve JSON.

### 13.6 What was measured and deliberately left alone

**The cached universe is 4.9MB serialized** for a thirteen-week window and 6.8MB
for a full season. Next's in-memory data cache is 50MB by default and a hosted
Data Cache typically caps an entry well below this, so the memoization should be
assumed to be per-instance rather than shared across the fleet. It is less
alarming than it looks: `positional_war_curves` already shares the expensive
COMPUTE across leagues by fingerprint, so a universe miss is bounded by distinct
fingerprints, not by league count. Trimming it is not cheap: `stat_line` is 2.4MB
of the 4.9MB and the engine scores every league under its own settings, so it
cannot be pruned by key. Dropping zero-valued keys recovers 0.25MB, which does
not change the outcome and does change what `projectPlayerWeek` sees.

**`DB_CHUNK_CONCURRENCY` at 8 instead of 5** cut the projection scan from 619ms
to 445ms in isolation. Left at 5. The cap is shared with Power Pulse, and the
reason for 5 is connection-pool headroom under concurrent requests, which a
single-request benchmark cannot see.

**PAGE stays at 1000, and that is now written down in the loader.** PostgREST
caps this project at 1000 rows per response, so `limit(2000)` silently returns
1000 and the keyset walk's short-page stop condition ends the walk early.
Measured: 12,623 of 13,064 rows. The count guard catches it, which is what the
guard is for, but the right move is not to ask.

**The Positional WAR page serves 794kB of HTML, 79kB gzipped**, and 203kB of
that is the data table of every plotted player. That table is the accessibility
contract. Not worth restructuring.

### 13.7 A flaky test, found by running the suite enough times

`lib/positional-war/share.test.ts` asserted that two concurrently computed
upserts were deeply equal, `computed_at` included. Each call stamps its own
`new Date()`, so the assertion was that two clock reads landed in the same
millisecond. It passed almost always. It now compares the payloads with the
clock-read columns excluded and asserts separately that each parses as a date,
which is what the test was about all along: a concurrent second writer
overwrites with the same CURVE data, so the row a reader ends up with does not
depend on which writer won.

### 13.8 What section 12's operating notes gain

Nothing changes about how to run or diagnose the feature. One addition worth
knowing: a throw inside the staleness gate now writes an error verdict and
stamps `positional_war_attempted_at`, so it backs off for
`POSITIONAL_WAR_RETRY_MS` instead of rerunning the same failing read on every
view. Previously a throw there left no verdict and no backoff, which is the one
shape of failure the observability work in section 5.6 did not cover.

## Writing check, this section

Ran the AI-writing-patterns check from the global instructions against section
13. No em dashes, en dashes, curly quotes, ellipsis characters, middle dots, or
emoji. One fix in the first draft: a sentence read "that is not small, it is
gone", which is the negative-parallelism construction the standard bans. It was
rewritten to state the size plainly, in section 13.5 and in the module header
it was quoting. No three-item lists
used as rhythm, and no significance-inflation clauses.
