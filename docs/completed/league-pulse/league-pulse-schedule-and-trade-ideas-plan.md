# League Pulse: Schedule page and Trade Ideas

Plan only. Nothing in here has been built. Written 2026-08-21 against the tree at
`bf6b6e3`.

Two pieces of work:

1. A new **Schedule** section inside the league deep view, with a week view, a
   team view, schedule quick stats, and a matchup detail that puts both starting
   lineups side by side with projections, per player reliability, and the bench
   or taxi players who would outscore the lineup as set.
2. **Trade Finder becomes Trade Ideas**: the existing suggestion engine keeps
   working exactly as it does, gains a real explanation of what a deal does to
   your team, and sits next to a builder where you propose any trade you like and
   get the same evaluation back.

---

## 1. What already exists

Both features are mostly assembly. Almost every number they need is already
computed and stored by Power Pulse, FAAB, and Trade Finder. This section is the
inventory, because the plan below leans on it constantly.

### Data already in Postgres

| Table | What it gives us | Written by |
| --- | --- | --- |
| `league_matchups` | Full 18 week head to head slate per league, plus `starter_ids`, `starter_points`, `player_ids`, `player_points`, `points`, `is_final`, and the raw Sleeper object in `metadata` | `lib/league-matchups.ts` via `pulseLeagueDerived` |
| `league_power_pulse_cache` | Per roster: `power_pulse`, `sos_points`, `sos_rank`, `lineup_efficiency`, `lineup_points_lost`, `projected_wins`, `playoff_odds`, `title_odds`, and a `weekly` jsonb of `{week, opponentRosterId, opponentName, mean, sigma, winProb}` | `lib/league-power-pulse.ts` |
| `player_weekly_projections` | Per player per week: `opponent`, `stat_line`, `projected_pts_ppr/half_ppr/std` | `lib/sync-weekly-projections.ts` |
| `player_projection_accuracy` | Per player: `beat_rate`, `availability_rate`, `shrunk_multiplier`, `ratio_stdev`, `weeks_played`, recency weighted | `lib/calculate-projection-accuracy.ts` |
| `nfl_defense_vs_position` | Opponent strength multiplier per team, season, position | `lib/calculate-defense-splits.ts` |
| `rosters` | `player_ids`, `starter_ids`, `reserve_ids`, `taxi_ids` | `lib/league-pulse.ts` |
| `league_power_rankings_cache` | Trade value per roster, per format and source | `lib/league-power-rankings.ts` |
| `draft_pick_values` | Pick values keyed by season, round, slot bucket | `scripts/sync-ktc.ts` |

### Code already written that both features reuse

- `lib/power-pulse/project.ts` `projectPlayerWeek()`. One player, one week, in the
  league's own scoring, adjusted for opponent, reliability, availability, and
  injury. This is the only place a player gets projected. Both features call it.
- `lib/power-pulse/lineup.ts` `buildOptimalLineup()` / `scoreSetLineup()` /
  `lineupSigma()`. Exact optimal fill with augmenting paths.
- `lib/power-pulse/simulate.ts` `simulateSeason()`. Seeded Monte Carlo season and
  bracket.
- `lib/power-pulse/load.ts`. `loadLeague`, `loadRosters`, `loadPlayers`,
  `loadProjections`, `loadAccuracy`, `loadDefenseSplits`, `loadSchedule`,
  `loadCompletedResults`. Paged, keyset, count guarded.
- `lib/faab/marginal.ts` `computeLineupSwap()`. Rebuilds the optimal lineup week
  by week with one player added and one dropped, returns `weeklyBefore` and
  `weeklyAfter` distributions.
- `lib/faab/league-faab.ts` around lines 320 to 380. Feeds those two
  distributions into `simulateSeason` twice and reports the playoff odds and
  projected wins delta. This is the exact shape Trade Ideas needs, for a package
  instead of a single free agent.
- `lib/trade-finder/*`. Engine, packages, ranking, explanation, fingerprinting.
  Unchanged by this work.
- `lib/trade-finder-grade.ts` `gradeSuggestion()`. Runs a suggestion through the
  Signal Check pipeline for a second opinion.
- `lib/league-format-resolution.ts` `resolveLeagueContext()`. The format and
  source contract for everything under `/leagues/[id]`.

### Design system already in place

- `components/league-shell/` gives the masthead, the breadcrumb, the action
  cluster, and puts the league's sections into the site rail.
- `components/league-shell/nav-items.ts` is the single list both the desktop rail
  and the mobile drawer read.
- `components/dashboard-panel.tsx` `Panel` is the bordered surface with the
  beacon hairline, eyebrow, heading, helper, and optional glow.
- `components/app-shell/page-columns.tsx` `PageColumns` is the
  `minmax(0,1fr) 340px` body with the sticky right rail that collapses below the
  content on a phone.
- `components/slide-up-dialog.tsx` and `components/bottom-sheet.tsx` for the
  mobile sheets, with focus trap and Escape handling already written.
- The intro strip pattern (radial purple and cyan wash, cyan eyebrow, h2, one
  line of copy, chips underneath) on Power Pulse and Trade Finder.

---

## 2. Feature 1: Schedule

### 2.1 Routes and navigation

New routes:

```
/leagues/[league_id]/schedule                        The week view and the team view
/leagues/[league_id]/schedule/[week]/[roster_id]     One matchup, both lineups
```

The matchup detail is a real route rather than a modal. It is the thing people
will link each other to in a group chat, it needs its own OG card, and the back
button has to work.

Keying the detail on `week` plus `roster_id` rather than `matchup_id` is
deliberate: `league_matchups.matchup_id` is nullable, and Sleeper leaves it null
for an unpaired roster. A roster and a week always resolve; the opponent is
derived by finding the sibling row with the same `matchup_id`.

Navigation changes in `components/league-shell/nav-items.ts`:

- Add `"schedule"` to `LeagueTabId`.
- Add an item between Teams and Power Pulse: label `Schedule`, hint
  `Every week, every matchup, both lineups`, icon a new `calendar` entry in
  `components/app-shell/nav-icons.ts` (lucide `CalendarDays`, not imported yet).
- Add `"schedule"` to the full route branch of `leagueTabHref`.

Both the desktop rail and the mobile drawer pick it up automatically, because
they both read that one list.

Order argument: Schedule sits after Teams and before Power Pulse. Overview and
Teams describe who is in the league, Schedule describes what happens to them, and
Power Pulse is the model built on top of the schedule.

Naming note: the request said "Schedules". The route segment and the nav label in
this plan are singular, because a league has one schedule and the plural reads
oddly next to Transactions and Teams. Say the word and it becomes `Schedules`
everywhere; it is a one line change in `nav-items.ts` and a directory rename.

### 2.2 One defect to fix first

`lib/league-matchups.ts` writes `starter_ids` through `.filter(validPlayerId)`,
which strips Sleeper's `"0"` placeholder for an empty starting slot. Sleeper's
`starters` array is positionally aligned to the league's starting slots, so
filtering it destroys the alignment. A league with an empty FLEX would render
every slot below the FLEX shifted up by one, and every player would appear in the
wrong slot.

The same line does not filter `starters_points`, so the two arrays already
disagree with each other today. Nothing reads them positionally yet, which is why
this has not bitten.

Fix: stop filtering at write time, filter at read time.

- `lib/league-matchups.ts`: write `m.starters` and `m.players` verbatim.
- Every existing reader already filters. `lib/power-pulse/load.ts` `loadSchedule`
  runs `asStringArray`, which drops `"0"`. `scoreSetLineup` skips ids it does not
  recognise. No consumer changes.
- Rows written before the change keep the filtered array. The raw array is still
  available in `metadata.starters`, because `metadata` stores the Sleeper object
  verbatim, which is exactly the backfill case the CLAUDE.md metadata rule is for.
  The reader prefers `metadata.starters` and falls back to `starter_ids`.
- A `force` pulse rewrites a league's rows correctly. No backfill script and no
  migration.

This is task one, because everything else in the matchup view depends on it.

### 2.3 New lib modules

All pure except `data.ts`.

**`lib/league-schedule/slots.ts`**

- `alignedStartingSlots(rosterPositions: string[]): string[]`. Every token that
  is not `BN`, `IR`, `TAXI`, or `NA`, in the league's own order. This is the
  alignment key for Sleeper's `starters` array. It differs from
  `lib/power-pulse/lineup.ts` `startingSlots()`, which additionally drops tokens
  it cannot project (the IDP slots). Power Pulse is right to drop them and the
  schedule view is right to keep them, so these are two functions and the
  difference gets a comment in both.
- `SLOT_GROUP_ORDER`. Display grouping, in the order requested:
  `QB, RB, WR, TE, FLEX, SUPERFLEX, IDP, K, DEF`. The FLEX group covers `FLEX`,
  `REC_FLEX`, `WR_TE`, `WRRB_FLEX`, `WRRB_WRT`. The SUPERFLEX group covers
  `SUPER_FLEX` and `Q_FLEX`. The IDP group covers `DL`, `LB`, `DB`, `IDP_FLEX`
  and any unrecognised token, so an exotic league renders rather than silently
  dropping a slot.
- `slotLabel(token)`. The visible label: `QB`, `RB`, `WR`, `TE`, `FLEX`, `W/T`,
  `W/R`, `SUPERFLEX`, `DL`, `LB`, `DB`, `IDP`, `K`, `DEF`.
- `slotDescription(token)`. Spelled out for the accessible name, because `W/T`
  read aloud is noise: "wide receiver or tight end flex".
- `isProjectableSlot(token)`. True when `PULSE_SLOT_ELIGIBILITY` has a non empty
  entry. Drives the "no projection" treatment on IDP slots.

**`lib/league-schedule/lineups.ts`**

- `readSetLineup(row, slots)`. Pairs the raw starters array with the aligned slot
  tokens and with `starters_points`, returning
  `{ slotToken, sleeperId | null, actualPoints | null }[]`. Handles a short or
  long array without throwing, because Sleeper is the source and it does not owe
  us a length.
- `orderForDisplay(entries)`. Stable sort by `SLOT_GROUP_ORDER` and then by
  position within the league's own order, so a league running `RB RB WR WR WR`
  keeps RB1 above RB2.

**`lib/league-schedule/matchup.ts`**

`buildMatchupView(input): MatchupView`. Pure. Given both rosters, the aligned
slots, the projection rows, the accuracy rows, the defense splits, the settings,
the week, and the current week, it returns for each side:

- `slots[]`: slot token, label, and either a resolved player or an empty slot.
  Each player carries name, position, NFL team, Sleeper id (for the headshot),
  injury status, NFL opponent that week, opponent multiplier, `beatRate`,
  `availabilityRate`, `reliability`, `projected`, `sigma`, and `actual` when the
  week is final.
- `projectedTotal`, `sigma`, `actualTotal` (final weeks only).
- `optimalTotal` and `pointsLeftOnBench`, from `buildOptimalLineup` over every
  player the roster could legally start.
- `benchUpgrades[]`. See 2.6.
- `unprojectedSlots`. How many filled slots we have no projection for, so the
  page can say so instead of quietly under counting.

Plus `winProb` for side A, using the same normal approximation
`lib/power-pulse/math.ts` already uses, so a matchup win probability here and the
one in the Power Pulse `weekly` array can never disagree.

Projection rule, stated once and applied everywhere: **for a final week we show
actual points and never a projection; for an unplayed week we show the projection
and never a zero.** A player with no projection row reads "no projection", not
`0.0`. That is the same distinction `projectPlayerWeek` makes when it returns
null, and it exists because a zero looks like an answer.

**`lib/league-schedule/insights.ts`**

Pure. Everything the quick stats rail shows.

- `remainingSos(teams)`. Reads `sos_points` and `sos_rank` straight from the
  Power Pulse cache. No recomputation, so the Schedule page and the Power Pulse
  page report the same strength of schedule.
- `playedSos(weeks, rosters)`. Average points scored by the opponents each team
  has already faced. Answers "who has had it easy so far", which the cache does
  not carry because Power Pulse only looks forward.
- `allPlayRecords(weeks)`. For every final week, score each team against every
  other team's score that week. The gap between real record and all play record
  is the luck index, and it is the stat league members argue about most.
- `toughestStretch(team, weeks, size = 3)`. The consecutive window with the
  highest total opponent projected points, and its mirror.
- `playoffPushSos(team, weeks, playoffWeekStart)`. Strength of schedule over the
  weeks between now and the playoffs, which is the window that decides seeding.
- `weekSpotlight(weekMatchups)`. The closest game by win probability and the
  biggest mismatch, for the selected week.
- `h2hCounts(weeks)`. Who each team plays twice, which decides tiebreak arguments
  and is invisible in Sleeper's own UI.

**`lib/league-schedule/data.ts`**

The only module here that touches Supabase.

- `loadScheduleBoard(supabase, { leagueRowId, season, currentWeek })`. One read of
  `league_matchups` for the season, one read of `league_power_pulse_cache`, one
  read of `rosters` and `league_users` for names and avatars. Returns weeks, each
  with its matchups, each carrying both sides' record, actual points when final,
  and projected mean, sigma, and win probability from the cache `weekly` array.
  This is enough for both the week view and the team view. Three queries for the
  whole page.
- `loadMatchupDetail(supabase, admin, { leagueRowId, season, week, rosterId })`.
  Resolves the pair, then calls `loadPlayers`, `loadProjections`, `loadAccuracy`,
  and `loadDefenseSplits` from `lib/power-pulse/load.ts` for just those two
  rosters. Roughly 60 players and one week, which is a fraction of what
  `pulseLeagueDerived` already does on the same visit.

### 2.4 The week view and the team view

One page, two modes, driven by URL search params so both are linkable and the
back button behaves:

```
/leagues/[id]/schedule?view=week&week=3
/leagues/[id]/schedule?view=team&roster=4
```

Default on first paint: `view=week`, `week` = the current NFL week resolved by
`resolveCurrentWeek` in `lib/league-matchups.ts`. Preseason resolves to week 1,
which is correct and already handled.

**Controls** (`components/league-schedule/schedule-controls.tsx`, client):

A single sticky control bar under the intro strip. Left side is the view toggle,
two buttons in a `role="group"` with `aria-pressed`, not a select, because there
are exactly two and a toggle is one press instead of three. Right side changes
with the mode:

- Week mode: previous and next week buttons flanking a labelled `<select>` of
  weeks 1 to 18. Each option reads "Week 3, final" or "Week 12, upcoming" so the
  state is in the option text rather than in a colour.
- Team mode: a labelled `<select>` of teams. Above eight teams it also gets the
  `PanelFilterField` treatment already used by the cross league panels, hoisted
  into a `SlideUpDialog` on a phone.

The bar is `position: sticky` under the masthead at `top-[5.5rem]`, matching the
rail offset used across the deep view.

**Week board** (`components/league-schedule/week-board.tsx`):

One card per matchup. Each card links to the matchup detail and carries:

- Both team names, owner handles, avatars (`components/sleeper-avatar.tsx`), and
  records.
- Final weeks: both actual scores, the winner's side marked with a filled bar and
  a "Won" label, never colour alone.
- Unplayed weeks: both projected totals, the win probability as a two segment
  bar with both percentages written out, and a "Projected" chip so nobody reads a
  projection as a result.
- A "leaving points on the bench" chip when a side's optimal lineup beats its set
  lineup by more than a threshold. The threshold lives in one constant, not
  scattered.
- The Power Pulse rank of each side as a small chip, so the schedule and the
  rankings agree at a glance.

The current week's card gets the elevated treatment: `border-line-accent`, the
corner glow, and the beacon hairline, the same emphasis `TradeFinderCard` uses.
Everything else on the page is flat by comparison, which is what makes it read as
the thing to look at.

**Team season** (`components/league-schedule/team-season.tsx`):

The selected team's 18 weeks as rows: week, opponent (name, record, Power Pulse
rank), result or projection, win probability, and a difficulty chip driven by the
opponent's projected mean against the league median. Playoff weeks get a section
divider labelled with the league's own `playoff_week_start`, because the
difference between week 13 and week 15 is the whole point of looking at a
schedule.

Above the rows, a summary strip: remaining SOS rank, projected record, hardest
week, easiest week, and how many times this team plays each opponent.

### 2.5 The matchup detail

`/leagues/[league_id]/schedule/[week]/[roster_id]`

Layout, top to bottom:

1. **Header.** Both teams, records, Power Pulse ranks, the week, and the state
   (final, in progress, upcoming). Projected or actual totals large, with the win
   probability bar underneath and both percentages written out.
2. **The lineup comparison.** The centrepiece.
3. **Bench and taxi upgrades**, one panel per side.
4. **Right rail.** Season series between these two teams, both teams' recent
   form, and a "how these numbers are built" panel.

**The lineup comparison markup.** A real `<table>`, not two floated columns.

```
<table>
  <caption class="sr-only">Week 3 starting lineups, Team A against Team B</caption>
  <thead>  Team A | Slot | Team B
  <tbody>  one <tr> per slot, slot is <th scope="row">
```

The slot is the row header in the middle. A screen reader then reads
"QB, Josh Allen, projected 22.4, Patrick Mahomes, projected 21.8" for the row,
which is the comparison the sighted layout is making. Two stacked lists would
force the reader to hold twelve names in their head to compare anything.

Rows are grouped with a `<tbody>` per position group and a group heading row, so
the QB block, the RB block, the FLEX block and so on are distinct. The order is
exactly `SLOT_GROUP_ORDER`.

Each player cell shows headshot, name, `POS, TEAM`, the NFL opponent for that
week (`@SF` or `vs BUF`, `BYE` when there is no projection row for a scheduled
week), the projected points in bold, and for a final week the actual points with
the projection beside it. An injury designation renders as a text chip, never as
a colour on the name.

Each player cell is a button that opens `PlayerDetailDialog`, on every
breakpoint. That dialog carries the full numbers: raw projection before
adjustments, opponent multiplier and what it means ("San Francisco allows 12
percent below average to running backs"), beat rate with its sample size,
availability rate, reliability multiplier, the weekly spread, season to date
points, and a link to the player profile. Putting it behind a dialog on desktop
too is deliberate: it is one component and one interaction to learn, and the
alternative is a desktop hover popover a keyboard cannot reach.

**Mobile.** The table stays a table. Three columns at 360px works because the
centre slot column is fixed at about 56px and each player cell is a two line
stack: name on the first line, `POS @OPP` and the points on the second. Nothing
is hidden and nothing moves to a separate sheet. This is what the mobile first
rule asks for: a compact layout, not a reduced one. Below `sm` the headshot drops
to 24px and the group heading rows carry the position label so the reader always
knows which block they are in after scrolling.

**Totals row.** A `<tfoot>` with each side's projected total, its optimal total,
and the difference. When any slot is unprojectable (IDP), the footer says so in
words: "Totals exclude 3 IDP slots, which Sleeper does not publish projections
for." That sentence is the honest version of a number that would otherwise look
complete.

### 2.6 Bench and taxi upgrades

One panel per side, below the lineup table.

What it computes, in `lib/league-schedule/matchup.ts`:

1. Build the optimal lineup from every player the roster could legally start that
   week (excludes IR and taxi, because Sleeper will not let you start them). The
   difference against the set lineup is `pointsLeftOnBench`.
2. For each non starting player with a projection, find the best single swap: the
   eligible starter with the lowest projection whose slot the bench player can
   fill. Report the pair and the gain when the gain is positive.
3. Repeat over IR and taxi players, but tag those results `requiresMove`, because
   starting them means a roster move first. The request asked for taxi players to
   appear, and they should, with the string attached said out loud.

Presentation: a list of sentences, each with the arithmetic visible.

> Start **Jaylen Warren** over **Zach Charbonnet** in FLEX. **+4.3** projected
> points.
>
> **Brian Thomas Jr.** is on your taxi squad and projects **+6.1** over your WR3.
> Starting him needs a roster move first.

Then one summary line: "Your best legal lineup projects 118.4, which is 9.7 above
the lineup you have set." When there is nothing to gain the panel says "This is
your best lineup this week" rather than rendering an empty list. An empty panel is
a bug report; a stated conclusion is the feature.

The single swap gains do not add up to the total, and the copy must never imply
they do: taking one swap changes what the next one is worth. The total comes from
the optimal lineup, the swaps are the route to it, and both are labelled.

For a final week the same panel becomes retrospective: "You left 18.4 points on
your bench in week 3", computed from `player_points`, which the sync already
stores for every rostered player. This is some of the most read content on any
fantasy site and it costs one extra branch.

### 2.7 The right rail quick stats

The rail uses `PageColumns` so it drops below the content on a phone, in DOM
order after it. Panels, in order:

1. **Strength of schedule.** Every team ranked by remaining SOS, from
   `league_power_pulse_cache.sos_points` and `sos_rank`. Columns: rank, team,
   opponent points per week, and a hardest or easiest chip on the top and bottom
   two. Rank 1 is the hardest remaining schedule, matching the column comment in
   migration 0165, and the panel header says so, because "SOS rank 1" is
   ambiguous everywhere it appears on the internet.
2. **Luck index.** Real record against all play record, with the biggest gap in
   either direction called out. "You are 4-2 with the 8th best points. Two of
   those wins came against the two lowest scores of the week."
3. **This week.** The closest projected game and the biggest mismatch, each a link
   to its matchup detail.
4. **Schedule quirks.** Who plays whom twice, and which teams have the toughest
   run into the playoffs, from `playoffPushSos`.
5. **How this is built.** The sources panel, in the same `dt`/`dd` shape as the
   Trade Finder rail: projections from Sleeper rescored under the league's own
   settings, opponent strength from `nfl_defense_vs_position`, reliability from
   `player_projection_accuracy`, values not used on this page.

Panels 1 and 2 are the ones worth the rail. If the rail gets long, 4 moves into
the main column under the board as a "Schedule insights" section rather than
being cut.

### 2.8 Performance and caching

No new tables and no new cron.

- The board reads three queries and the Power Pulse cache. The cache is refreshed
  by `pulseLeague` on the schedule the CLAUDE.md rules already fix (12 hour TTL,
  plus a recompute when the live week passes `through_week`).
- The matchup detail projects about 60 players for one week. That is a fraction
  of the work `pulseLeagueDerived` already does on the same visit.
- The page follows the streaming pattern the other deep view sections use:
  `pulseLeagueCore` awaited in the page so the masthead paints,
  `pulseLeagueDerived` awaited inside a `<Suspense>` boundary that wraps the
  board.
- If the matchup detail ever needs caching, the shape is a
  `league_matchup_projection_cache` keyed by
  `(league_id, season, week, roster_id)` with a `model_version`. Not building it
  now. Measure first.

### 2.9 Edge cases, each with a stated behaviour

| Case | Behaviour |
| --- | --- |
| League has no schedule yet (`noScheduleYet` from `syncLeagueMatchups`) | Branded empty state naming the reason: Sleeper publishes the slate at league creation, so this league has not been created for the season yet. Reuse the tone of `components/power-pulse/pre-draft-notice.tsx`. |
| Some weeks failed to fetch (`failedWeeks` non empty) | Show what we have and say which weeks are missing. Never present a partial slate as complete. Same rule Power Pulse follows when it refuses to score a failed fetch. |
| Odd number of teams, roster unpaired that week | The week row reads "No opponent" and the detail route renders a named message rather than a generic not found. |
| `matchup_id` null | Same as unpaired. |
| Player on the roster but not in `players` | Render that slot as "Unknown player" and count it under `unprojectedSlots`. Do not drop the row, or the slots below it shift. |
| IDP slots | Rendered in their group, player named, projection reads "not published". Excluded from totals with the footer sentence. |
| Bye week | The slot shows `BYE` and contributes nothing. `projectPlayerWeek` already returns null for a missing projection row, which is the same code path. |
| Past season | Everything is final. The projection column is absent rather than empty. |
| League with no Power Pulse cache row | The board still renders from `league_matchups` alone: opponents, records, and final scores. Projections, win probability, and the SOS panel show a "still calculating" state, matching the Power Pulse page's own wording. |

### 2.10 Accessibility

- One `h1`, owned by the masthead (the league name). The intro strip owns the
  `h2`. Panels use `Panel`'s `headingLevel` to stay in order.
- The lineup comparison is a table with a `<caption>`, `scope="row"` on the slot,
  and `scope="col"` on the team headers.
- The view toggle is a `role="group"` of buttons with `aria-pressed`. The week
  and team pickers are labelled selects. Prev and next carry
  `aria-label="Previous week"` and are disabled at the ends, with the disabled
  state announced by the label rather than by opacity.
- Changing week or team announces the result in an `aria-live="polite"` region:
  "Week 4, six matchups", and focus moves to the board heading, the pattern
  `components/trade-finder.tsx` already uses for its arrows.
- Every player button has an accessible name that stands alone: "Josh Allen,
  quarterback, Buffalo, at San Francisco, projected 22.4 points. Open details."
- Win probability bars are decorative. Both percentages are in the text.
- Tap targets stay at or above 44 by 44, including the compact mobile player cells
  and the week stepper buttons.
- Colour never carries meaning alone: won and lost, hard and easy, gain and loss
  all carry a word or a sign.

### 2.11 Format and source

Per the League Pulse format resolution contract, the Schedule page calls
`resolveLeagueContext()` and ignores the global format toggle. In practice the
page uses almost no value data: projections are scored under the league's literal
`scoring_settings` through `lib/league-scoring.ts`, and the only source dependent
figures are the Power Pulse ranks in the chips, which are source independent
anyway. The resolver is still called, because the masthead renders the coverage
chips and because every page under `/leagues/[id]` is required to.

---

## 3. Feature 2: Trade Ideas

### 3.1 What changes and what does not

Unchanged: `lib/trade-finder/engine.ts`, `packages.ts`, `rank.ts`, `profile.ts`,
`fingerprint.ts`, `explain.ts`. The search, the balancing, the acceptance bands,
and the variety walk keep working exactly as they do. The directory keeps its
name; it is the internal name of the search engine, not a user facing string.

Changed: the route, the page, the labels, and what gets rendered around a deal.

### 3.2 Rename

- `app/leagues/[league_id]/trade-finder/` becomes
  `app/leagues/[league_id]/trade-ideas/`.
- `next.config.ts` gains a permanent redirect
  `/leagues/:league_id/trade-finder` to `/leagues/:league_id/trade-ideas`, in the
  same `redirects()` block that already handles the legacy `/u/:handle` paths.
  308, so old links and anything already shared keep working.
- `LeagueTabId` `"trade-finder"` becomes `"trade-ideas"`. Label `Trade Ideas`,
  hint `Deals worth offering, and any deal you want checked`.
- `leagueTabHref` full route branch updated.
- Call sites: `app/leagues/[league_id]/page.tsx` lines 245 to 246,
  `components/league-shell/nav-items.ts`, and the page's own `copyHref` and
  `TeamChooser` links.
- `components/trade-finder-panel.tsx`, the cross league panel on the dashboard,
  keeps its behaviour and takes the new label, so one name is used everywhere.
- `components/trade-finder.tsx` and `components/trade-finder-card.tsx` STAY where
  they are. This is a deliberate change from the first draft of this plan, which
  moved them into `components/trade-ideas/`. They are the browser and the card
  for the suggestion engine, they are named after `lib/trade-finder/` which is
  also keeping its name, and they are imported by the dashboard portfolio panel
  as well as the league page. Moving them touches three call sites and changes
  nothing a user can see, while making every future `git log --follow` on the
  most complicated client component in the feature start with a rename. The new
  surfaces go in `components/trade-ideas/` beside them. What renames is what the
  reader sees: the route, the nav label, the headings, and the copy.
- `app/actions/trade-finder.ts` keeps its path. Renaming a server action module
  changes nothing a user sees, and leaving it alone keeps the diff honest.

### 3.3 Page shape

```
Intro strip            eyebrow "Trade lab", h2 "Trade Ideas", one line
Mode tabs              Suggested | Build a trade        (?mode=build)
Main column            the deal, then the evaluation
Right rail             your team, saved trades, where the numbers come from
```

Mode tabs are real links (`?mode=`), not client state, so both modes are linkable
and the server can render either without hydration. `aria-current="page"` on the
active one.

Both modes converge on the same output component. That is the point of the
change: a suggested trade and a trade you typed in get the identical evaluation,
so there is one thing to learn and no reason to distrust one of them.

### 3.4 The evaluation

This is the new engine work. A new directory, `lib/trade-impact/`.

**`lib/trade-impact/types.ts`**

```ts
export type BuildAsset =
  | { kind: "player"; playerId: string }
  | { kind: "pick"; season: number; round: number; pickPosition: PickSlot };

export type TradeProposal = {
  myRosterId: number;
  theirRosterId: number;
  /** What I receive. */
  incoming: BuildAsset[];
  /** What I send. */
  outgoing: BuildAsset[];
};

export type WeekImpact = {
  week: number;
  opponentRosterId: number | null;
  opponentName: string | null;
  beforeMean: number;
  afterMean: number;
  delta: number;
  winProbBefore: number | null;
  winProbAfter: number | null;
};

export type TeamImpact = {
  rosterId: number;
  teamName: string;
  statusLabel: string | null;          // Competitor / Mid Tier / Rebuilder
  valueBefore: number;
  valueAfter: number;
  valueDelta: number;
  ageDelta: number | null;
  pickCountDelta: number;
  lineupBefore: number;                // points per remaining week
  lineupAfter: number;
  lineupDelta: number;
  weeks: WeekImpact[];
  weeksImproved: number;
  weeksWorsened: number;
  /** Weeks an incoming player actually starts, keyed by player id. */
  incomingStartWeeks: Record<string, number>;
  projectedWinsBefore: number | null;
  projectedWinsAfter: number | null;
  playoffOddsBefore: number | null;
  playoffOddsAfter: number | null;
  titleOddsBefore: number | null;
  titleOddsAfter: number | null;
  /** Positional starter output before and after, for the depth story. */
  positionBefore: Record<PulsePosition, number>;
  positionAfter: Record<PulsePosition, number>;
};

export type TradeReason = {
  kind: string;                        // stable key, for tests
  label: string;                       // the short line
  detail: string;                      // the sentence with the number in it
  tone: "good" | "bad" | "neutral";
};

export type TradeImpact = {
  mine: TeamImpact;
  theirs: TeamImpact;
  reasons: TradeReason[];
  caveats: string[];
  grade: SuggestionGrade | null;       // Signal Check, second opinion
  unavailable: {
    lineup: boolean;                   // no projections loaded
    simulation: boolean;               // no remaining schedule
    picks: boolean;                    // redraft, or no pick values
  };
};
```

`TradeReason` deliberately mirrors `PowerPulseDriver` in shape, so the same
`tone` styling renders both and a reader who has seen the Power Pulse drivers
already knows what a given tone means.

**`lib/trade-impact/roster-swap.ts`**

A generalisation of `lib/faab/marginal.ts` `computeLineupSwap` from "add one, drop
one" to "add N, remove M". Same machinery: for each remaining week, build the
optimal lineup before, build it again with the outgoing players removed and the
incoming players inserted, and record both distributions. Returns `weeklyBefore`,
`weeklyAfter`, per week detail, and which weeks each incoming player starts.

Reuses `buildOptimalLineup` and `lineupSigma`. Adds nothing to the projection
model; every candidate arrives already projected by `projectPlayerWeek`, which is
the rule `lib/power-pulse/project.ts`'s own header sets out.

**`lib/power-pulse/what-if.ts`** (extraction, not new logic)

`lib/faab/league-faab.ts` around lines 320 to 380 already builds a `SimTeam[]`
for the whole league, swaps one team's weekly distribution, and runs
`simulateSeason` twice to get before and after playoff odds and projected wins.
Trade Ideas needs the identical thing, except two teams change instead of one.

Extract that block into `lib/power-pulse/what-if.ts` as
`simulateWithReplacements(rosters, baseline, replacements, upcoming, options)`,
have FAAB call it with one replacement and Trade Ideas call it with two. One copy
of the code that turns points into odds. FAAB's existing tests are the guard on
the extraction; the task is not done until they pass unchanged.

**`lib/trade-impact/load.ts`**

One read of everything, reusing what exists:

- `loadLeague`, `loadRosters`, `loadPlayers`, `loadProjections`, `loadAccuracy`,
  `loadDefenseSplits`, `loadSchedule` from `lib/power-pulse/load.ts`.
- `loadTradeFinderLeague` from `lib/trade-finder-data.ts` for values, ages, pick
  values, team status, and the format and source context. This is the same read
  the suggestion engine uses, so a built trade and a suggested trade are priced
  identically by construction.
- `loadPowerPulseSettings` from `lib/power-pulse/settings.ts`.

**`lib/trade-impact/evaluate.ts`**

`evaluateTrade(admin, session, proposal)`. Orchestrates: load, validate the
proposal against the loaded rosters, run the swap for both sides, run the
simulation, compute the value and age deltas, call `gradeSuggestion` for the
Signal Check second opinion, build the reasons, return `TradeImpact`.

**`lib/trade-impact/reasons.ts`**

Pure. Takes the computed `TeamImpact` pair plus the league context and returns
`TradeReason[]`, ordered by how much they should matter to the reader. Every
reason cites a figure that was computed; nothing is generated from a model and
nothing is invented, which is the contract `lib/trade-finder/explain.ts` already
holds.

The reason set, each with its trigger condition:

| Kind | Fires when | Example |
| --- | --- | --- |
| `lineup-gain` | `lineupDelta` above the noise floor | "Your starting lineup gains 4.3 points a week for the rest of the season." |
| `lineup-loss` | below the negative floor | "Your starting lineup loses 2.1 points a week." |
| `starts-often` | an incoming player starts in most remaining weeks | "Chase starts for you in 10 of your 11 remaining weeks." |
| `starts-rarely` | an incoming player starts in few weeks | "He only cracks your lineup in 2 of 11 weeks. You are trading for depth, not points." |
| `swings-weeks` | win probability crosses 0.5 in either direction | "It turns two projected losses into coin flips, in weeks 12 and 15." |
| `schedule-timing` | the biggest gains land in high leverage weeks | "The biggest gains land in weeks 14 and 16, both against top four scoring teams." |
| `odds` | simulation available | "Projected wins go from 6.4 to 7.1. Playoff odds go from 41 percent to 58 percent." |
| `value-gain` / `value-loss` | `valueDelta` past the format's noise floor | "You give up 1,240 points of trade value, about 8 percent of your roster." |
| `younger` / `older` | `ageDelta` past a threshold | "Your roster gets 1.4 years younger at the positions you start." |
| `picks` | `pickCountDelta` non zero | "You add a 2027 first and a 2027 third." |
| `depth-cost` | a position's starter output drops and the next man up is well below | "It thins your running backs. Your next man up projects 6.1 below the back you are sending." |
| `fills-hole` | the weakest starting slot improves | "It fixes your weakest starting slot. Your FLEX goes from 8.2 to 13.9." |
| `direction-fit` | team status and the deltas agree | "You are ranked 9th by Power Pulse. This deal adds value and costs wins, which is the trade a rebuilding team wants." |
| `direction-clash` | team status and the deltas disagree | "You are ranked 2nd by Power Pulse and this deal costs you 2.1 points a week. That is the wrong direction for a team trying to win now." |
| `grade` | Signal Check returned | "Signal Check calls it an even trade on FF Beacon values." |
| `their-side` | always, one line | "For them it is plus 900 in value and minus 1.8 points a week, which is why they might say yes." |

Caveats, separate from reasons, in the same list `lib/trade-finder/explain.ts`
`buildCaveats` already produces:

- "No projection published for X. He is priced on value only."
- "Pick values come from KTC. Your chosen source does not publish them."
- "This league has no remaining games, so the odds figures are unavailable."
- "Player X is on IR and cannot start without a roster move."

**Why the reasons are deterministic templates and not a language model.** Every
one of them is checkable against the numbers on the same screen. A generated
sentence can be plausible and wrong, and the first time it is wrong about
somebody's league the whole feature loses its credibility. The templates are also
testable, which is why `TradeReason.kind` is a stable key.

### 3.5 The builder

`components/trade-ideas/trade-builder.tsx` (client).

- Two panels, side by side above `md`, stacked below. Left is your team, right is
  theirs. The right panel opens with a team `<select>`; picking a team loads its
  assets from data the page already has, so there is no round trip.
- Each panel lists what that side sends. An "Add player" button opens
  `components/player-picker.tsx`, which already handles a long grouped list with a
  filter and a screen reader friendly option label. On a phone the picker is
  wrapped in `SlideUpDialog`.
- Dynasty leagues also get "Add pick", from `finderLeague.teams[].picks`, which
  already carries labels like "2027 1st (early)" and values.
- A running total per side while you build: value out, value in, and the gap, so
  you can see the shape before you press anything. This costs nothing; it is
  addition over data already in the browser.
- "Evaluate trade" calls the server action. While it runs the button goes to a
  pending state, and the result is announced in a live region.
- Assets are capped at six per side, matching `MAX_ASSETS_PER_SIDE` in
  `lib/trade-finder-saves.ts`, so a saved built trade fits the existing schema.

**URL state.** The built trade is encoded into the URL so it is shareable and the
back button works: `?mode=build&with=4&in=<ids>&out=<ids>`. Player ids are uuids
and picks are `2027-1-mid`. On load the page decodes, validates against the
league, and renders the evaluation server side. A malformed or stale link renders
the builder with a named message rather than an error.

**Prefill from a suggestion.** Every suggestion card gets an "Open in builder"
action that loads that exact deal into build mode. Somebody who likes a
suggestion but wants to swap one piece can, which is the thing people always want
to do with a trade tool and currently cannot.

**Saving a built trade.** `lib/trade-finder/fingerprint.ts` `suggestionKey()` is
deterministic over the assets, so a built trade can be given a valid `tf1-` key
and stored in `trade_suggestion_saves` through the existing action. No new table
and no migration. The stored row is a snapshot, which is already the contract
that file's header sets out.

### 3.6 The verdict panel

`components/trade-ideas/trade-verdict.tsx`. One component, rendered by both
modes, under the deal card.

Structure:

1. **Reasons.** The headline section, not a footnote. Each reason is a row with a
   tone marker (icon plus word, never colour alone), the short label in semibold,
   and the sentence under it. Good reasons first, then neutral, then the costs,
   and the costs are never collapsed or hidden. A trade card that shows the upside
   and buries the downside is a sales pitch, which is the rule
   `components/trade-finder-card.tsx` already states about its own figures.
2. **Performance.** Projected points per week before and after, projected record
   before and after, playoff odds before and after, title odds before and after.
   Then the per week strip: one column per remaining week, height by delta, with a
   table underneath carrying the same numbers. The strip is decorative and the
   table is the data.
3. **Value.** Total value in and out, the gap as a percentage, age delta, pick
   count delta, and the Signal Check verdict with its explanation. This is mostly
   what the current card shows, moved into its own section so performance and
   value stop competing for the same space.
4. **For them.** The same three numbers from the other side. Compressed, but
   present, because the acceptance band is meaningless without it.

Each section is a `Panel` with an eyebrow, so the outline is navigable and a
screen reader user can jump between "Reasons", "Performance", "Value", and "For
them".

Mobile: the four sections stack. The per week strip scrolls horizontally inside
its own `overflow-x:auto` container, with the table below it always full width.
The "For them" section is an expandable `<details>` on a phone and open by default
above `md`, which keeps every figure reachable while making the primary answer the
first thing on screen.

### 3.7 The right rail

1. **Your team right now.** Power Pulse rank and score, projected record, playoff
   odds, trade value rank, team status label, and the weakest starting slot. Every
   figure comes from `league_power_pulse_cache` and `league_power_rankings_cache`,
   both already loaded by this page. It gives the reasons a reference point:
   "adds 4.3 points a week" means more next to "projected 6.4 wins".
2. **Saved trades.** The existing saved list, already built.
3. **Where the numbers come from.** The existing sources panel, extended with a
   line for the performance model.

### 3.8 Server action, validation, and limits

`app/actions/trade-impact.ts`, `evaluateProposedTrade(input)`.

Security rules, each of which matters:

- Zod schema on the input. Roster ids are integers, asset ids are uuids matched
  against `UUID_PATTERN`, picks are `{season, round, pickPosition}` with bounded
  ranges. The same shape `app/actions/trade-finder.ts` already validates.
- **Ownership is re-derived, never trusted.** The client says "player X from
  roster 4"; the server checks `rosters.player_ids` and rejects the proposal if it
  does not hold. Without this a forged input produces a confident evaluation of a
  trade that cannot happen, which is a correctness bug wearing a security bug's
  clothes.
- Six assets per side, twelve total. Rejected above that, not truncated.
- Both rosters must belong to the league named in the request.
- The action reads league data through the admin client (Power Pulse settings and
  Signal Check config are service role only, as `lib/trade-finder-grade.ts`
  documents) and reads nothing user scoped through it.
- No user text reaches the reason builder, so there is no injection surface in the
  rendered output.

`React.cache` around the load for the duration of one request, so the suggested
mode and the rail do not read the league twice.

### 3.9 Rate limiting, on every path that can run an evaluation

An evaluation is the most expensive thing a guest can ask this codebase to do
without signing in: two Monte Carlo seasons plus 40 to 80 exact lineup fills. It
has to be limited on **every** entry point, and there are three.

1. The server action `evaluateProposedTrade`, pressed by the builder.
2. The **server rendered** page path. `?mode=build&in=...&out=...` is decoded and
   evaluated during the render, so a loop over GET requests with different asset
   combinations runs the same work without ever touching the action. A limit that
   only guards the action is not a limit.
3. The streamed evaluation under the on-screen suggestion (T662), which is also
   server rendered inside a Suspense boundary.

All three claim from one bucket through one helper.

**`lib/trade-impact/rate-limit.ts`**

```ts
export const TRADE_EVAL_BUCKET = "trade-impact-evaluate";
export const TRADE_EVAL_WINDOW_SECONDS = 60;
export const TRADE_EVAL_MAX = 10;

export async function claimTradeEvaluationSlot(): Promise<boolean>
```

- Same mechanism `app/actions/trade-finder.ts` `claimSlot` uses: derive the actor
  through `resolveRateLimitActorKey` (auth uid when signed in, salted IP hash
  otherwise), then the `try_claim_rate_limit` RPC through the admin client.
- **Fails closed.** A limit that cannot be evaluated does not pass. Same rule and
  same reasoning as the existing helper.
- Ten per minute, below the finder's twelve, because one evaluation costs more
  than one search. One shared bucket across all three paths, so the builder and
  the page cannot be alternated to double the ceiling.
- `claimSlot` in `app/actions/trade-finder.ts` and this helper both wrap
  `headers()` in a `Request` for `resolveRateLimitActorKey`. Rather than a third
  copy of that, the shared piece moves to `lib/rate-limit-claim.ts`
  (`claimRateLimitSlot(bucket, max, windowSeconds)`) and both callers use it.

**Degradation, not a wall.** When the page's claim fails, the rest of the page
still renders: the league, the tabs, the suggestion, the rail. Only the
evaluation section is replaced with a named state ("You have run a lot of
evaluations in the last minute. This one will run again shortly."), with a retry
control. Throwing a 429 for the whole document would punish a reader for a
feature they were using correctly, and it would take the navigation with it.

**A cheap gate before the expensive one.** Validation runs first and does not
claim a slot. A malformed proposal, a player who is not on the roster he is
claimed to be on, or an over-length asset list is rejected before any slot is
spent, so a reader cannot lose their budget to a stale link, and an attacker
gains nothing by sending garbage.

**What is deliberately not limited.** The Schedule matchup detail projects about
60 players for one week. Its URL space is bounded at 18 weeks times the roster
count, roughly 216 addresses per league, all cacheable, and the work per address
is a fraction of what `pulseLeagueDerived` already does on the same visit. There
is no amplification: an attacker cannot construct a more expensive schedule URL
than the ones the navigation already links to. It gets no limit, and this
paragraph is the record of why, so the decision is reviewable rather than an
omission.

### 3.10 Cost, and why the shortlist does not get the full treatment

An evaluation costs two lineup rebuilds per remaining week per team, plus two
Monte Carlo seasons. For an eleven week remainder that is roughly 44 lineup fills
and two simulations. Fine for one trade, wrong for twelve.

So:

- The shortlist keeps the cheap figures it already has. `SideImpact.lineupDelta`
  is computed by the engine today from a single week fill, and the existing
  `rationale`, `whyYou`, `whyThem` strings stay as they are.
- The deal currently on screen gets the full evaluation, streamed into the page
  behind its own `<Suspense>` boundary. The card paints immediately with the cheap
  figures and the evaluation fills in underneath.
- Moving to the next suggestion fires a new evaluation for that deal. The client
  keeps the last few in a `Map` keyed by suggestion fingerprint, so arrowing back
  and forth is free.

If measurement says the simulation dominates, the first lever is dropping the
simulation iteration count for the on screen evaluation and stating the
confidence, not dropping the feature. The iteration count already lives in
`league_power_pulse_settings` and is admin editable.

### 3.11 Accessibility

- Mode tabs are links with `aria-current="page"`.
- The builder's two panels are `<section>`s with headings. Each asset row has a
  remove button with a full name: "Remove Josh Allen from what you send".
- Adding or removing an asset announces the new totals in a live region.
- "Evaluate trade" announces the verdict headline on completion and moves focus to
  the verdict heading, matching the pattern `components/trade-finder.tsx` already
  uses.
- The per week strip is `aria-hidden`; its table is the accessible copy.
- Reason tone is icon plus word plus text. Never colour alone.
- All tap targets 44 by 44, including the asset remove buttons, which are the ones
  most likely to be built too small.

---

## 4. Power Pulse must not move

Two tasks in this plan reach into code Power Pulse depends on. Power Pulse is the
most visible number on the site, it is cached for 12 hours, and a regression in
it would be discovered by users rather than by us. So both tasks carry an
explicit no-change contract.

**T626, the matchup starter write.** It changes what goes into
`league_matchups.starter_ids`, which `lib/power-pulse/load.ts` `loadSchedule`
reads into `setLineups`, which feeds `scoreSetLineup`, which produces
`lineup_efficiency` and `lineup_points_lost`.

The safety argument is that `loadSchedule` already calls `asStringArray`, which
drops `"0"` along with every other non-id. So the read side sees the identical
array before and after. The argument is not enough on its own, so it gets a test:
`lib/power-pulse/load.test.ts` feeds a row with placeholders and a row without,
and asserts `setLineups` is byte identical for both.

**T645, the simulation extraction.** It moves working FAAB code into
`lib/power-pulse/what-if.ts`. The contract is that `calculateLeagueFaab` produces
identical output before and after, and the guard is FAAB's existing suite
(`lib/faab/*.test.ts`) passing unchanged, with no test edited to accommodate the
move. A test that has to be adjusted is evidence the extraction changed
behaviour, and the correct response is to revert the extraction and let Trade
Ideas carry its own copy with a comment naming the duplication.

**The standing rule for the whole build.** Every task ends with the full suite
green, not just the tests it added. `npx vitest run` and `npx tsc --noEmit` both
clean before a task is written into `progress.md` as complete. The suite is 1747
tests across 122 files today; that number may only go up.

**Files this build must not change the behaviour of:**

`lib/power-pulse/engine.ts`, `simulate.ts`, `lineup.ts`, `project.ts`, `math.ts`,
`load.ts` (beyond additive exports), `lib/league-power-pulse.ts`,
`lib/league-scoring.ts`, and every file under `lib/trade-finder/`. New code
imports them. It does not edit them.

---

## 5. Cross cutting rules this work must follow

- **Format and source.** Both pages call `resolveLeagueContext()`. The global
  format toggle has no effect inside a league view. Source stays user controlled.
  Pick values fall back to KTC with the footnote.
- **Time display.** Any timestamp goes through `formatEastern` from
  `lib/datetime.ts`. Relative strings ("3 hours ago") are zone independent and
  need nothing.
- **Naming.** Tables and columns, if any are added, use FF Beacon terms. Nothing
  in the new lib directories carries a source name.
- **Punctuation.** Plain ASCII everywhere, in code, comments, copy, and ARIA
  labels.
- **Mobile.** No data hidden at any breakpoint. Where the desktop layout has room
  for something the phone does not, the phone gets a compact layout or a sheet,
  not a shorter feature.
- **Sub agent reviews.** Implementation, accessibility, and security review after
  each atomic task, per the project workflow.

---

## 6. Migrations

Feature 1: **none.** The starter alignment fix is a write side change plus a
metadata fallback for old rows.

Feature 2: **none.** Built trades reuse `trade_suggestion_saves` through the
existing fingerprint.

Two follow ups that would need migrations, both deliberately out of scope for now:

- `league_matchup_projection_cache`, if the matchup detail turns out to be slow.
- `league_trade_evaluations`, if repeated evaluations of the same proposal turn
  out to be common.

Both are optimisations, and building either before measuring would be guessing.

---

## 7. Task breakdown

Atomic, one file or one concern each, in dependency order. Numbering continues
from `progress.md`, which ends at T625.

### Feature 1: Schedule

```
T626 | pending | Stop filtering Sleeper starter placeholders at write time
     | files: lib/league-matchups.ts, lib/league-matchups.test.ts (new)
     | depends on: none

T669 | pending | Power Pulse regression guard: placeholders never reach setLineups
     | files: lib/power-pulse/load.test.ts
     | depends on: T626

T627 | pending | Slot alignment, labels, and display order for league lineups
     | files: lib/league-schedule/slots.ts, lib/league-schedule/slots.test.ts
     | depends on: T626

T628 | pending | Read a set lineup from a matchup row, aligned to its slots
     | files: lib/league-schedule/lineups.ts, lib/league-schedule/lineups.test.ts
     | depends on: T627

T629 | pending | Matchup view builder: both lineups, projections, totals
     | files: lib/league-schedule/matchup.ts, lib/league-schedule/matchup.test.ts
     | depends on: T628

T630 | pending | Bench and taxi upgrade calculation
     | files: lib/league-schedule/matchup.ts, lib/league-schedule/matchup.test.ts
     | depends on: T629

T631 | pending | Schedule insights: SOS, all-play luck, stretches, spotlight
     | files: lib/league-schedule/insights.ts, lib/league-schedule/insights.test.ts
     | depends on: none

T632 | pending | Schedule read layer
     | files: lib/league-schedule/data.ts
     | depends on: T629, T631

T633 | pending | Add Schedule to the league navigation
     | files: components/league-shell/nav-items.ts,
     |        components/app-shell/nav-icons.ts
     | depends on: none

T634 | pending | Schedule controls: view toggle, week stepper, team picker
     | files: components/league-schedule/schedule-controls.tsx
     | depends on: T633

T635 | pending | Week board and matchup row
     | files: components/league-schedule/week-board.tsx,
     |        components/league-schedule/matchup-row.tsx
     | depends on: T632

T636 | pending | Team season view
     | files: components/league-schedule/team-season.tsx
     | depends on: T632

T637 | pending | Quick stat rail panels
     | files: components/league-schedule/sos-panel.tsx,
     |        components/league-schedule/luck-panel.tsx,
     |        components/league-schedule/spotlight-panel.tsx
     | depends on: T631

T638 | pending | Schedule page
     | files: app/leagues/[league_id]/schedule/page.tsx
     | depends on: T634, T635, T636, T637

T639 | pending | Side-by-side starting lineup table
     | files: components/league-schedule/matchup-table.tsx
     | depends on: T629

T640 | pending | Player detail dialog
     | files: components/league-schedule/player-detail-dialog.tsx
     | depends on: T639

T641 | pending | Bench upgrades panel
     | files: components/league-schedule/bench-upgrades.tsx
     | depends on: T630

T642 | pending | Matchup detail page
     | files: app/leagues/[league_id]/schedule/[week]/[roster_id]/page.tsx
     | depends on: T639, T640, T641

T643 | pending | Empty, partial, and error states for the schedule
     | files: components/league-schedule/schedule-empty.tsx,
     |        app/leagues/[league_id]/schedule/page.tsx
     | depends on: T638

T644 | pending | OG card for a matchup
     | files: app/api/og/matchup/[league_id]/[week]/[roster_id]/route.tsx
     | depends on: T642
```

### Feature 2: Trade Ideas

```
T645 | pending | Extract the before/after season simulation out of FAAB
     | files: lib/power-pulse/what-if.ts, lib/power-pulse/what-if.test.ts,
     |        lib/faab/league-faab.ts
     | depends on: none

T646 | pending | Trade impact types
     | files: lib/trade-impact/types.ts
     | depends on: none

T647 | pending | Multi-asset roster swap, generalised from the FAAB marginal
     | files: lib/trade-impact/roster-swap.ts, lib/trade-impact/roster-swap.test.ts
     | depends on: T646

T648 | pending | Trade impact read layer
     | files: lib/trade-impact/load.ts
     | depends on: T646

T649 | pending | Reason builder
     | files: lib/trade-impact/reasons.ts, lib/trade-impact/reasons.test.ts
     | depends on: T646

T650 | pending | evaluateTrade orchestration
     | files: lib/trade-impact/evaluate.ts, lib/trade-impact/evaluate.test.ts
     | depends on: T645, T647, T648, T649

T651 | pending | Grade any pair of asset lists, not only a TradeSuggestion
     | files: lib/trade-finder-grade.ts
     | depends on: none

T667 | pending | Shared rate-limit claim helper, one copy of the actor + RPC call
     | files: lib/rate-limit-claim.ts, app/actions/trade-finder.ts
     | depends on: none

T668 | pending | Trade evaluation rate limit, one bucket for all three paths
     | files: lib/trade-impact/rate-limit.ts
     | depends on: T667

T652 | pending | evaluateProposedTrade server action with validation and limits
     | files: app/actions/trade-impact.ts
     | depends on: T650, T651, T668

T653 | pending | Route rename plus permanent redirect
     | files: app/leagues/[league_id]/trade-ideas/page.tsx (moved),
     |        next.config.ts, components/league-shell/nav-items.ts,
     |        app/leagues/[league_id]/page.tsx
     | depends on: none

T654 | pending | User-facing "Trade Ideas" copy in the finder components
     | files: components/trade-finder.tsx, components/trade-finder-card.tsx,
     |        components/trade-finder-panel.tsx
     | depends on: T653
     | The files keep their names; only the words the reader sees change.

T655 | pending | Mode tabs
     | files: components/trade-ideas/mode-tabs.tsx
     | depends on: T653

T656 | pending | Reason list
     | files: components/trade-ideas/reason-list.tsx
     | depends on: T649

T657 | pending | Per-week impact strip and its table
     | files: components/trade-ideas/impact-weeks.tsx
     | depends on: T646

T658 | pending | Verdict panel
     | files: components/trade-ideas/trade-verdict.tsx
     | depends on: T656, T657

T659 | pending | Trade builder
     | files: components/trade-ideas/trade-builder.tsx
     | depends on: T652, T658

T660 | pending | URL encoding for a built trade
     | files: lib/trade-impact/proposal-url.ts,
     |        lib/trade-impact/proposal-url.test.ts
     | depends on: T646

T661 | pending | Trade Ideas page, both modes, rate limited on the render path
     | files: app/leagues/[league_id]/trade-ideas/page.tsx
     | depends on: T654, T655, T659, T660, T668

T662 | pending | Stream the full evaluation under the on-screen suggestion
     | files: components/trade-ideas/suggested.tsx,
     |        app/leagues/[league_id]/trade-ideas/page.tsx
     | depends on: T661

T663 | pending | Open a suggestion in the builder
     | files: components/trade-ideas/deal-card.tsx,
     |        components/trade-ideas/trade-builder.tsx
     | depends on: T659

T664 | pending | Save a built trade through the existing fingerprint
     | files: lib/trade-finder-saves.ts, components/trade-ideas/trade-builder.tsx
     | depends on: T659

T665 | pending | Your team right now rail panel
     | files: components/trade-ideas/your-team-panel.tsx
     | depends on: T661
```

### Documentation

```
T666 | pending | Document the schedule feature and the impact model
     | files: docs/league-pulse.md (new or extended), CLAUDE.md
     | depends on: T644, T665
```

CLAUDE.md needs two additions when this lands: the League Pulse feature section
gains the Schedule route, and the Trade Ideas rename replaces every mention of
Trade Finder as a route.

---

## 8. Testing

Vitest, matching the existing suites (1747 tests across 122 files today).

**Pure module tests, which is where most of the risk is:**

- `slots.test.ts`: alignment against a superflex league, an IDP league, a league
  with an empty FLEX (the placeholder case), and a league with a token we have
  never seen.
- `lineups.test.ts`: short array, long array, missing metadata, placeholder in the
  middle, duplicate ids.
- `matchup.test.ts`: totals exclude unprojectable slots, a bye contributes nothing
  rather than zero, a final week reports actuals and no projection, win
  probability matches `lib/power-pulse/math.ts` for the same inputs.
- `matchup.test.ts` (upgrades): a bench player who beats a starter is found, a
  taxi player is found and tagged `requiresMove`, an optimal lineup returns an
  empty list, the sum of single swaps is never reported as the total gain.
- `insights.test.ts`: all-play record against a hand worked six team season,
  toughest stretch at the season boundary, SOS rank direction.
- `roster-swap.test.ts`: two in two out, a swap that changes no lineup returns
  zero, an outgoing player who was not starting costs nothing, an incoming player
  with no projection is excluded rather than counted as zero.
- `reasons.test.ts`: each `kind` fires on its trigger and stays silent otherwise,
  the cost reasons are never omitted, no reason renders a number the input did not
  carry.
- `what-if.test.ts`: the extraction produces identical results to the FAAB path it
  replaced, on the FAAB fixtures.
- `proposal-url.test.ts`: round trip, malformed input rejected, stale player id
  rejected.

**Guard tests, the kind this codebase already writes:**

- A test that fails if `lib/league-matchups.ts` reintroduces the starter filter.
- A test that fails if the schedule page re-derives format from `?format=` rather
  than through `resolveLeagueContext`.
- A test that fails if `evaluateProposedTrade` trusts client supplied roster
  membership.

**Manual checks before either feature is called done:**

- A real 12 team superflex league, a 10 team redraft league, an IDP league, and a
  league with an odd roster count.
- Preseason (week 0 state), mid season, and a completed past season.
- A league whose Power Pulse cache is empty.
- 360px wide, keyboard only, and with a screen reader for the lineup table and the
  builder.

---

## 9. Risks and open questions

**Risks**

1. **The starter alignment fix touches a table Power Pulse reads.** Mitigated by
   the fact that every existing reader already filters placeholders, and by T626
   shipping with its own test. Worth a careful review anyway, because a mistake
   here corrupts Power Pulse, which is the most visible number on the site.
2. **The FAAB extraction (T645).** It is the right thing to do and it is a
   refactor of working code. The FAAB tests are the guard; if they cannot be made
   to pass unchanged, the extraction is wrong and gets abandoned rather than
   forced, and Trade Ideas keeps its own copy with a comment naming the
   duplication.
3. **Evaluation latency.** Two Monte Carlo seasons plus 40 to 80 lineup fills.
   Should be well under a second, but it has not been measured. The streaming
   boundary means a slow evaluation degrades to a delay rather than a blocked
   page, and the iteration count is already admin tunable.
4. **IDP leagues get a partial answer.** Sleeper's projections endpoint is called
   with `["DEF","K","QB","RB","TE","WR"]` in `lib/sleeper.ts`, so we hold no IDP
   projections. Their slots render with the player named and the projection stated
   as unpublished. Turning IDP projections on is a separate piece of work with a
   real consequence: it would change Power Pulse scores in every IDP league by
   filling slots the model currently drops. Out of scope here, on purpose.
5. **Scope.** Feature 1 is 19 tasks and Feature 2 is 21. They are independent past
   T626, so they can ship in either order or in parallel.

**Open questions**

1. **"Schedule" or "Schedules"** as the nav label and route segment. This plan
   uses the singular. One line to change.
2. **Where the trade builder lives.** This plan puts it on the Trade Ideas page
   behind a mode tab. The alternative is a separate
   `/leagues/[id]/trade-ideas/build` route. A tab keeps the two modes next to each
   other, which is the argument for merging them in the first place, so the tab is
   the recommendation.
3. **Cross league.** `components/trade-finder-panel.tsx` runs the same engine
   across every league a manager is in. Should the builder and the full evaluation
   appear there too? Recommendation: not in this pass. The portfolio surface takes
   the rename and the new deal card, and the evaluation follows once the single
   league version has been used for a while.
4. **The week list's headline projection.** This plan shows the optimal lineup
   projection as the primary number, matching Power Pulse, with the as-set number
   beside it. The alternative is leading with as-set, which answers "what happens
   if nobody touches anything" but disagrees with the ranking table one tab over.
   Both numbers are always visible either way; only the emphasis is in question.

---

## 10. Out of scope

- IDP weekly projections.
- A trade proposal that actually gets sent to another manager. This evaluates
  trades; it does not negotiate them.
- Three team trades. The engine, the Signal Check pipeline, and the impact model
  are all two sided today.
- Live in-game scoring on the matchup page. `league_matchups.points` updates on
  the pulse cadence, not in real time, and pretending otherwise would be worse
  than the honest lag.
- Any nightly cron. Both features compute on demand, which is the rule for every
  per league calculation in this codebase.
