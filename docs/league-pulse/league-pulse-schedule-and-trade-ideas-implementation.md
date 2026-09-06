# Implementation report: Schedules and Trade Ideas

Built 2026-08-21 against `bf6b6e3`. Plan:
`docs/league-pulse/league-pulse-schedule-and-trade-ideas-plan.md`. Task log with the full
reasoning behind each decision: the tail of `progress.md`, tasks T626 to T673.

**Nothing is committed or pushed.** The working tree holds every change.

## Verification

| Check | Before | After |
| --- | --- | --- |
| `npx vitest run` | 124 files, 1780 tests, green | **135 files, 1980 tests, green** |
| `npx tsc --noEmit` | clean | clean |
| `npx next build` | clean | clean |
| Non-ASCII in new code | n/a | none |

Build output for the four new routes:

```
/leagues/[league_id]/schedules                    3.50 kB   122 kB
/leagues/[league_id]/schedules/[week]/[roster_id]  5.57 kB   125 kB
/leagues/[league_id]/trade-ideas                  6.64 kB   136 kB
/api/og/matchup/[league_id]/[week]/[roster_id]     315 B    103 kB
```

Two hundred new tests, no migration, no new table, no new cron.

## What was built

### Schedules

A new section in the League Pulse deep view, between Teams and Power Pulse.

`/leagues/[id]/schedules` carries two views behind URL params, so both are
linkable: `?view=week&week=N` lists every matchup in one week, `?view=team&roster=N`
lists one team's eighteen weeks with a playoff divider drawn at the league's own
`playoff_week_start`. A sticky control bar switches between them. The right rail
holds strength of schedule (read from the Power Pulse cache, never recomputed, so
the two pages cannot disagree), a luck index built from all-play records, this
week's closest game and biggest mismatch, and a sources panel.

`/leagues/[id]/schedules/[week]/[roster_id]` is the matchup detail. Both starting
lineups sit side by side in a real table, grouped QB, RB, WR, TE, FLEX,
SUPERFLEX, IDP, K, DEF, with the slot as the row header in the middle column so a
screen reader reads a row as the comparison the layout is drawing. Every player
cell opens a dialog with the projection before and after adjustments, the
opponent multiplier in words, beat rate, availability, reliability and the weekly
spread. Below the table, one bench-and-taxi upgrade panel per side, with taxi and
IR players tagged as needing a roster move first.

### Trade Ideas

`/leagues/[id]/trade-finder` is now `/leagues/[id]/trade-ideas`, with a permanent
308 in the routing layer so shared links never render the dead path. The
suggestion engine in `lib/trade-finder/` is untouched.

Two modes on one page. `mode=suggested` is the existing browser. `mode=build`
decodes a trade out of the URL and evaluates it server side, which is what makes
a built trade shareable and back-button-safe.

The new model is `lib/trade-impact/`. It answers two questions that routinely
disagree and says both: VALUE, what the assets are worth, and WINS, the optimal
lineup week by week against the real remaining schedule, run through the same
Monte Carlo season Power Pulse uses. A deal that adds value and costs wins is
right for a rebuilder and wrong for a contender, and the reasons say so. Twenty
reason kinds, each firing only when the figure behind it exists.

## The five things worth knowing

### 1. A positional bug that had not bitten yet

Sleeper's `starters` array is positional: `starters[i]` is the player in the i-th
startable slot, and an unfilled slot is the string `"0"`. The sync filtered that
placeholder out, which shifted every slot below the gap up by one. Nothing had
noticed because the only reader treats the array as an unordered set and drops
`"0"` itself. `starters_points` was never filtered, so the two arrays already
disagreed with each other.

The Schedules page reads the array positionally, so this had to be fixed first.
Both arrays now go in verbatim and every reader filters. No migration: `metadata`
holds the Sleeper object for rows written before the change.

`lib/power-pulse/load.test.ts` exists to prove Power Pulse did not move. It drives
the real `loadSchedule` with two datasets, one carrying placeholders and one
already filtered, and asserts the output is identical.

### 2. Reasons are templates, not a language model

Every sentence cites a figure present in the input, and a null figure means the
reason does not fire. A generated sentence can be plausible and wrong, and the
first time it is wrong about somebody's league the feature loses its credibility.
Templates are also testable, which is why each reason kind is a stable key.

### 3. Only two teams get projected

Turning "your lineup gains 4.3 points a week" into "playoff odds go from 41 to 58
percent" needs a weekly distribution for every team in the league. FAAB gets those
by projecting all 350 rostered players and building 216 lineups. Power Pulse
already computed exactly that and stored it, so the ten uninvolved teams are read
from `league_power_pulse_cache.weekly` and only the two whose rosters change are
projected.

The two involved teams use the freshly computed baseline on both sides of the
comparison, never the cached one. Mixing a cached baseline with a recomputed
post-trade lineup attributes every difference between the two computations to the
trade, which is how a deal that changes nothing reports a swing in playoff odds.

### 4. One copy of the simulation

`lib/faab/league-faab.ts` already ran the before-and-after season simulation for a
single free agent. That block was extracted to `lib/power-pulse/what-if.ts` and
both features now call it. The contract on the extraction was that all 72 FAAB
tests pass unchanged, with none edited to accommodate the move. They did.

### 5. A null is never a zero

Sleeper publishes projections for QB, RB, WR, TE, K and DEF only, so IDP slots
render the player with the words "No projection" and are excluded from totals with
a footnote saying how many. A zero would sum into the total and be believed.

## The review pass

Four agents audited the finished build: implementation, security, accessibility,
performance. They found twelve findings at HIGH or CRITICAL. All are fixed.

### Two critical correctness bugs, both in the one file with no test

**Per-position output never counted the players you acquire.** The "after" map was
the roster minus what you send, with nothing added back. Trading a receiver for a
better receiver reported that you had gutted your receiving corps.

**The same figure was a season total printed as a per-week rate.** It accumulated
across every remaining week and never divided, while the sentence says "points a
week". With ten weeks left the number was ten times too large, which also pushed
it permanently past the noise threshold meant to keep the reason quiet, so it
fired on nearly every trade.

Both shipped because the reason builder was tested and the thing producing its
input was not. `lib/trade-impact/evaluate-internals.test.ts` is the answer.

### The rate limiter was metering the wrong half

Both the security and performance reviews found this independently, and it is the
most instructive finding of the day. Validation was documented as cheap and was
not: it loaded the entire world, about twenty round trips and a megabyte of
projection rows, BEFORE comparing ownership. A proposal naming a player who is not
on the roster failed validation and therefore never reached the claim.

**Garbage was the cheapest way to spend our database, because garbage was the one
input that skipped the meter.** The module's own header claimed the opposite
property.

Fixed by splitting at the ownership boundary: validation reads only the finder
league, the world load moved behind the claim, and a second loose outer meter (60
a minute) is claimed before any read at all. The property the original design
wanted survives: a reader who clicks a stale link still spends no evaluation slot.

A related HIGH: the suggestion engine ran on every GET with no limit, while the
identical work behind the Search button was capped at twelve a minute. An attacker
never pressed Search. Now metered at the same ceiling.

### Focus was being torn out of a dialog

The builder passed an inline arrow as `onClose`, and `SlideUpDialog` listed
`onClose` in its effect dependencies. Picking a player re-rendered the parent,
which ran the effect cleanup, which restored focus to the button behind the modal,
and the effect then focused the Close button. The picker's "Moving to the list"
announcement became false, and the next Enter closed the dialog without adding
anyone.

Fixed at both ends: the caller memoizes, and the dialog holds `onClose` in a ref
so no future caller can trip it.

### The lineup table's left column had no row header

A `th scope="row"` is assigned only to cells that follow it in the row, and the
slot sits in the middle column. The body survived on self-contained aria-labels.
The footer did not: a blind reader checking their own totals heard "118.2, 121.4,
125.7, +7.3" with no way to tell Final from Projected from Best lineup from
Difference. Explicit `headers` attributes now associate both data cells with both
their column and their row.

### Performance, quantified

| Fix | Before | After |
| --- | --- | --- |
| Matchup detail projections | 261 ms, 306 rows, ~1 MB | 1.0 ms, 16 rows |
| Projection passes per evaluation | 5 (about 1260 redundant calls) | 2 |
| Lineup fills per evaluation | 84 | 56 |
| Matchup page queries | 4 duplicated by metadata | React-cached |
| Roster reads in matchup detail | 4 reads of 2 tables | 2 |

The `loadProjections` change is purely additive: an omitted ceiling builds a
byte-identical query, so the five other callers are untouched.

### Smaller fixes

Bench-loss figures were stamped on every future week from a number graded against
this week's lineup. The settled-week retrospective was computed from projections
rather than results, so it asserted what you left on your bench in a week that had
been played, from the wrong data. Bench upgrades could not recommend filling an
empty starting slot. A bye week rendered as "Tied". Raw Sleeper tokens reached the
reader as "Your SUPER_FLEX". `valueBefore` excluded draft picks while `valueDelta`
included them. Bare "N/A" strings, which screen readers pronounce inconsistently.
"3th round". Roster ids were unbounded on two routes, one of which caches for an
hour.

## Two things deliberately not done

**A package-level age figure was described as roster-level.** "It makes your roster
7.0 years younger" is arithmetic no single trade does to a thirty-man roster.
Reworded to name what was actually measured. The test asserting the old copy was
updated, which is correct here because the test was asserting the bug.

**Saving a built trade (T664) is blocked, not skipped.** The existing
`savedSuggestionSchema` is `.strict()` and requires `acceptance`, `qualityRatio`,
`score`, `headline`, `whyYou`, `whyThem` and `pitch`. A built trade produces none
of them: they are suggestion-engine outputs and the engine never ran. Filling them
would put an invented acceptance band ("Likely", "Long shot") on a card nothing
graded that way. The schema was not widened. The follow-up should decide what a
saved built trade is, and the answer is a stored `TradeImpact`, not a stored
`TradeSuggestion`.

## Where the two modes actually meet

The plan said the suggested deal on screen would carry the full evaluation inline.
It does not, and the first progress entry claimed it did until the implementation
review caught it. The record now says what is true.

Every suggestion card carries the Signal Check verdict, the lineup change per week
for both sides, the value delta, the value gap, the age, the acceptance band and
the reasons. What lives one press away in the builder is the rest of the same
evaluation: projected wins and playoff odds before and after, and the week by week
strip. Both modes render the identical component from the identical engine.

Inline was rejected for a reason rather than for effort. The suggestion browser
pages through the shortlist client side with no round trip, on purpose. A
server-rendered verdict pinned under it would describe suggestion 1 while the card
showed suggestion 3, which is worse than not having it. Putting the cursor in the
URL fixes the correctness and costs a round trip per arrow press, which is exactly
what that component was built to avoid. The card's control now names the payoff
("Full impact and edit") rather than the destination.

## Known limits, all recorded

- **No IDP projections.** Sleeper's endpoint is called with six positions.
  Enabling IDP would change Power Pulse scores in every IDP league, so it is a
  separate piece of work.
- **No player-profile link** in the schedule player dialog. `/players/[slug]` is
  keyed on `slug`, and the player shape carries a uuid and a Sleeper id. Linking
  from either would 404 on every player.
- **Venue is never claimed.** Sleeper's `opponent` is a bare team code with no
  home or away marker, so a bare code renders as itself. Rendering "vs SF" for an
  away game states something false.
- **Interchangeable slots.** `buildOptimalLineup` guarantees the optimal total,
  not a canonical assignment, so a 19-point receiver can seat in FLEX and leave
  the WR slot's figure unmoved. The "fixes a weak slot" reason gates on the slot
  actually improving, so it stays silent rather than reporting a slot that did not
  change. There is a test pinning this.
- **The builder's client payload** is about 12 KB gzipped for a 12-team dynasty
  league and about 40 KB for the 32-team league already in the database. Worth
  watching at the tail; fine at 12 teams.

## How this was built

Seven build agents across three waves on non-overlapping files, then four review
agents in parallel, then three fix agents plus direct work on the critical
findings. The type contracts (`lib/league-schedule/types.ts`,
`lib/trade-impact/types.ts`) were written first and frozen, which is what let the
component agents and the library agents run at the same time against a shape
neither had built yet.

Two agents reported problems they could not fix rather than reaching across a file
boundary or papering over them. One found the double read of the finder league;
one found the bye-week branch and supplied the exact fix needed. Both were fixed
by whoever owned the file. That is the behaviour worth keeping.
