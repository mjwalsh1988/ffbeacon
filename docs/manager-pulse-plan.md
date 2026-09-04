# Manager Pulse: Implementation Plan

Status: BUILT. This document is the plan as written before the build, kept as
the record of intent. Section 5 in particular describes the schema as PLANNED,
and the schema as SHIPPED differs; the reconciliation is in section 15 at the
foot of this file. Where the two disagree, the shipped schema and `progress.md`
are correct and this document is history.
Drafted 2026-09-04. Next available migration number: 0249.
Task prefix in `progress.md`: `MP-T###`. Session state in `handoff.md`.

Revision 2 (2026-09-04) added two things on request:

- Section 5.1 and the new section 5.8: every limit, cap, cooldown and threshold
  is editable in a full admin panel at `/admin/manager-pulse`, registered in the
  existing admin dashboard, not a bare settings form.
- The new section 6.0: the whole report splits by league type. Dynasty and
  redraft are different games with different goals and different value scales,
  and the report says so everywhere rather than averaging across them.

---

## 1. What this is

Type a Sleeper handle. Get everything worth knowing about that person as a
fantasy manager, drawn from several seasons of their public Sleeper history:
what they win, how they draft, who they keep buying, what they overpay for, how
fast they move, and how to approach them in a trade.

One engine, two consumers. The page at `/tools/manager-pulse` is the first.
League Pulse Trade Ideas is the second, and it is the reason the engine is built
as a service rather than as a page.

Feature name in all copy: **Manager Pulse**. Never "manager profile", never any
DPC-derived branding.

---

## 2. What Sleeper actually gives us (verified, not assumed)

Everything below was checked against the live API while planning.

### 2.1 Multi-season history works

`GET /v1/user/{user_id}/leagues/nfl/{season}` answers for any past season.
Probed against a real user id: 2019 returned 1 league, 2021 returned 1, 2023
returned 3, 2025 returned 12, 2026 returned 12. No documented cutoff.

**Decision: the default window is the current season plus 3 prior, so 4
seasons.** Admin-configurable up to 6 in `manager_pulse_settings`. Four covers
two dynasty cycles, it is where most handles stop having data anyway, and it
bounds capture cost (section 4.3). The report always states the window it used
and how many league-seasons it actually found, so a manager with two seasons of
history is never presented as if we looked at four.

Dynasty leagues expose `previous_league_id`, which walks a league's own chain
backwards. We use it to LINK (this 2026 league is the same league as that 2023
one, so the manager's history in it is continuous), not to discover. Discovery
is the per-season user endpoint.

### 2.2 Results and finishes are available

`GET /v1/league/{id}/winners_bracket` returns the playoff tree. The match
carrying `p: 1` names the champion in `w` and the runner-up in `l`. Verified
against a completed 2025 league. `losers_bracket` gives the bottom finishes.
Regular season record and points come off `rosters[].settings`.

### 2.3 Per-pick draft timing does NOT exist

This is the one thing in the brief the API cannot give us retroactively, and the
plan says so rather than inventing it.

- `GET /v1/draft/{id}/picks` returns `draft_id, draft_slot, is_keeper, metadata,
  pick_no, picked_by, player_id, reactions, roster_id, round`. No timestamp.
  Verified on a real completed draft.
- Sleeper's GraphQL endpoint was introspected. The `DraftPick` type exposes
  exactly `metadata, player_id, draft_id, reactions, pick_no, picked_by,
  is_keeper`. No timestamp there either.
- The `Draft` type exposes `start_time`, `created`, `last_picked`,
  `last_message_time`, and `settings` (which carries `pick_timer`).

So there are three honest moves, and we make all three.

**A. Draft pace, labelled as a league fact.** From `start_time`, `last_picked`
and the pick count we get seconds per pick for the whole draft, and from
`settings.pick_timer` we get what share of the allowed clock the room used. That
is a fact about the ROOM, not about one manager. The UI says it in those words:
"Their drafts run at 42 seconds a pick on a 120 second clock." It is never
rendered as a personal stat, never ranked against other managers, and never fed
into Trade Ideas.

ABSOLUTE RULE: whole-draft pace is a property of the draft, never attributed to
a manager. No column name, chart axis, or sentence may imply otherwise.

**B. Real per-pick timing, captured going forward.** On The Clock already polls
live drafts and writes `on_the_clock_pick_cache` rows whose `created_at` is the
first moment we saw that pick. The gap between consecutive picks' first-seen
times is a real elapsed measurement, with an error bar equal to the poll
interval. We promote that into a durable ingestion table
(`draft_pick_observations`, section 5.5) so it accumulates instead of being
evicted with the cache. Every figure derived from it carries its sample size and
its stated accuracy ("measured on 3 drafts, accurate to about 10 seconds").

**C. Autopick, captured live.** `draft_autopickers(sport, draft_id)` on the
GraphQL endpoint answers unauthenticated and returns the user ids currently set
to autopick. Verified: it returns `[]` on a completed draft, which is exactly
why it is a live-only capture. Stored in `draft_pick_observations.metadata` at
poll time. "Was on autopick in 2 of their last 5 drafts" is a real engagement
signal and it is only obtainable while the draft is running.

If B and C have no rows for a manager, the draft clock card shows what it has
(the league pace, labelled as such) and says plainly that per-pick timing starts
accumulating from the first live draft we watch them in. It does not show an
empty chart and it does not guess.

### 2.4 Everything else already flows through existing code

Transactions, rosters, members, drafts, traded picks and matchups are already
fetched, normalized and stored by `lib/league-pulse.ts`. Manager Pulse adds no
new Sleeper call site outside `lib/sleeper.ts`.

New functions for `lib/sleeper.ts`, matching the existing 20-second timeout and
null-on-failure pattern:

- `getSleeperWinnersBracket(leagueId)` and `getSleeperLosersBracket(leagueId)`
- `getSleeperDraftAutopickers(draftId)`, the one GraphQL call, isolated behind a
  named function with its own timeout and null-on-failure return, so nothing
  else in the codebase touches an undocumented endpoint directly

---

## 3. Architecture: engine first, page second

The shape copies Signal Check, which is the pattern the brief asked for: a pure
pipeline plus a thin service wrapper other tools call with a structured request.

```
lib/manager-pulse/
  types.ts            Shared shapes. Request DTO, report DTO, tendency DTO, and
                      the rules in this document restated in its header.
  default-settings.ts Model constants and cache policy. Code fallback for the
                      admin row.
  settings.ts         Load and validate manager_pulse_settings.
  validate.ts         Server-side settings validation.
  discover.ts         Handle to user id to league-seasons. Pure given a fetcher.
  capture.ts          The only module that queues league captures.
  load.ts             Every database read. Paged. Named columns, never select *.
  index-build.ts      ManagerIndex: the ownership, acquisition and disposal
                      primitive every ledger below reads from. Pure.
  results.ts          Records, finishes, championships, percentiles. Pure.
  drafting.ts         Reach vs market, positional shape, keepers, pace. Pure.
  affinity.ts         Who they like, who they avoid, repeat exposure. Pure.
  trading.ts          Trade grades, net value flow, age and position lean. Pure.
  roster-ops.ts       Waivers, FAAB aggression, lineup efficiency roll-up. Pure.
  tendencies.ts       The compact cross-tool DTO derived from the above. Pure.
  narrative.ts        Deterministic sentence templates. Pure. No language model.
  engine.ts           computeFootprint(). Pure. Takes plain data, returns the
                      report DTO. No Supabase, no React, no fetch.
  fingerprint.ts      The exact invalidation key. Pure and clock-free.
  service.ts          THE PUBLIC DOOR. getManagerFootprint() and
                      getManagerTendencies(). Orchestrates load, engine, cache.
                      Never throws.
  sample.ts           The guest sample fixture. Imported by nothing that touches
                      a real read path.
```

ABSOLUTE RULE: `engine.ts` and every module above it in that list is pure. No
`SupabaseClient`, no `fetch`, no React import. That is what makes the engine
testable and what lets Trade Ideas call it without dragging a page's worth of
loading behind it. `lib/manager-pulse/purity.test.ts` enforces it by scanning
those module sources, in the same spirit as
`lib/projections/source-guard.test.ts`.

### 3.1 The service contract

Two entry points. Structured request in, structured result out, neither throws.

```ts
// The full report. Used by the Manager Pulse page.
getManagerFootprint(admin, {
  handle?: string,             // one of handle or sleeperUserId is required
  sleeperUserId?: string,
  seasons?: number,            // window size, clamped to settings bounds
  sections?: ManagerSection[], // subset, for partial loads
  maxAge?: number,             // ms; how stale a cached report may be
}): Promise<ManagerFootprintResult>

// The compact tendency DTO. Used by Trade Ideas and anything else later.
getManagerTendencies(admin, {
  sleeperUserIds: string[],    // batched, because a league has eleven of them
  minSample?: number,
}): Promise<Map<string, ManagerTendency>>
```

ABSOLUTE RULE: `getManagerTendencies` is a READ ONLY call. It never queues a
capture, never calls Sleeper, and never computes a report. A manager with no
cached tendency row comes back absent from the map. This is the same
on-demand-only scaling rule that governs Power Pulse, Positional WAR and the
Manager Ledger, for the same reason: loading a league page must not be able to
trigger forty-eight league captures.

`ManagerFootprintResult` is a discriminated union, never a throw:

```ts
| { status: "ready";     report: ManagerReport; generatedAt: string; stale: boolean }
| { status: "building";  progress: CaptureProgress; partial: PartialReport }
| { status: "not_found"; handle: string }
| { status: "throttled"; retryAfterSeconds: number }
| { status: "empty";     reason: "no_leagues" | "window_empty" }
| { status: "error";     detail: string }
```

`partial` matters. While capture is draining, sections that already have their
data render for real. The page is never all-or-nothing.

---

## 4. Capture, throttling and cost

### 4.1 Correcting a premise in the brief

The existing "sync all" on `/my-beacon/sleeper-leagues` is not 5 leagues per
minute per user. Reading `lib/league-bulk-sync.ts`: `MAX_JOBS_PER_RUN = 5` is
how many leagues ONE WORKER RUN takes, the worker runs on a one-minute cron,
`PACE_MS = 2500` spaces them inside a run, and `BULK_SYNC_COOLDOWN_SECONDS` is
twelve hours, which is a per-user cooldown on pressing the button. So the real
shape is about five leagues a minute SITE-WIDE, and one bulk press per user per
twelve hours.

That queue is still the right thing to reuse, and reusing it means Manager Pulse
cannot outrun it, because it shares the same drain.

### 4.2 What we reuse, what we add

Reuse, unchanged:

- `league_sync_jobs` and the worker at `app/api/cron/league-sync-worker`
- the `claim_league_sync_jobs` and `release_league_sync` RPCs
- the pace, the run budget, the attempt cap, the stale-processing sweep

Add:

- `league_sync_jobs.job_kind text not null default 'pulse'`, with `'footprint'`
  as the second value. A footprint job runs the lighter capture path in 4.4
  instead of a full pulse.
- `manager_pulse_runs`, the per-request ledger. Owns the cooldown, the progress
  counters and the terminal status. Mirrors `league_bulk_sync_requests`.

ABSOLUTE RULE: Manager Pulse never writes to `leagues`, `rosters`,
`league_users` or `league_transactions` directly. Every write goes through
`lib/league-pulse.ts`, per the existing rule. The new footprint path is a new
exported function INSIDE that file, not a second writer somewhere else.

### 4.3 Cooldown and budget

- One Manager Pulse run per user per **60 minutes**, claimed atomically by an
  RPC before any work starts (`try_claim_manager_pulse`, same shape as
  `try_claim_league_refresh`). Sixty minutes rather than twelve hours because
  looking up a second opponent is the normal use of this tool, and unlike a bulk
  sync most runs hit a warm cache and queue nothing.
- A hard cap of `maxLeaguesPerRun` (default 60) league-seasons per run. Twelve
  leagues across four seasons with some churn lands near forty; sixty leaves
  headroom without letting one handle monopolize the drain. Over the cap we take
  the most recent seasons first, and the report states what it skipped.
- Reports cache for 24 hours (`MANAGER_PULSE_TTL_MS`). A cached report serves
  instantly and queues nothing.
- A run that queues zero jobs (everything already fresh) does not consume the
  cooldown. Being fast should not cost the reader their next lookup.

### 4.4 The footprint capture path

A full `pulseLeague` is far too much here. It syncs matchups and computes
trade-value power rankings, Power Pulse, Positional WAR and optionally the
Manager Ledger. Manager Pulse needs none of that for most sections.

New in `lib/league-pulse.ts`:

```ts
pulseLeagueFootprint(supabase, sleeperLeagueId, { force })
```

It runs `pulseLeagueCore` (league, rosters, members, drafts, traded picks) plus
transaction history and the two brackets, then stops. It shares
`pulseLeagueCore`'s coalescing, its 60-minute TTL, and its `last_pulsed_at`
stamping rule (stamp only after child rows land).

One section needs more: **lineup efficiency**. That lives in
`league_manager_ledger_cache`, which only exists for leagues someone has opened
the Decisions or Lineups page on.

ABSOLUTE RULE: Manager Pulse READS `league_manager_ledger_cache` and never
triggers a ledger compute. A league-season with no ledger row contributes
nothing to the efficiency roll-up, and the card names how many league-seasons it
could actually measure. This is the `includeManagerLedger` default-false rule
held from the other direction: the ledger is expensive, so a cross-league tool
reads what exists rather than manufacturing it for forty leagues.

### 4.5 Progress that is real

`manager_pulse_runs` carries `leagues_total`, `leagues_done`, `leagues_failed`
and a per-section status map. The progress bar is `leagues_done / leagues_total`.

ABSOLUTE RULE: no progress bar animates on a timer. Every bar is bound to a
counted fraction of real work. A run with an unknown total renders an
indeterminate bar that says so, never a determinate bar with a made-up
percentage. A bar that fills while nothing is happening is worse than a spinner,
because it makes a promise.

---

## 5. Database schema

Every new table ships its RLS policies in the same migration, per the project
rule, with the access matrix documented at the top of the file.

### 5.1 `manager_pulse_settings` (0249)

Single `id = 'global'` row, `settings jsonb`, service-role only. Admin-edited at
`/admin/manager-pulse` (section 5.8), validated server side by
`lib/manager-pulse/validate.ts`. Code fallbacks in `default-settings.ts`.

ABSOLUTE RULE: no limit, cap, cooldown, window, threshold or sample floor in
this feature is a hardcoded constant in a lib module or a page. Every one of
them lives in this row, reads through `loadManagerPulseSettings`, and is
editable in the admin panel. `default-settings.ts` holds the code fallback for
each, and that fallback exists so a missing row cannot break the engine, not so
a number can quietly live in two places. A test asserts that every key in
`DEFAULT_MANAGER_PULSE_SETTINGS` is reachable from a form field in the admin
panel, so adding a setting without exposing it fails the build.

The full settings shape, grouped the way the admin panel groups it:

```
capture:
  seasonWindowDefault        4      seasons the report covers by default
  seasonWindowMax            6      the most a reader may ask for
  seasonWindowMin            1
  maxLeaguesPerRun          60      league-seasons one run may queue
  maxLeaguesPerSeason       40      guard against a handle in 200 leagues
  runCooldownSeconds      3600      per user, between runs
  reportTtlHours            24      how long a computed report serves
  tendencyTtlHours          72      how long a tendency row serves
  captureTtlMinutes         60      the footprint sync's own freshness window
  jobMaxAttempts             3
  includeBestBall         true      count best ball leagues at all
lookup:
  handleLookupPerMinute     10      rate limit on resolving a handle
  handleLookupPerDay       200
samples:
  minTradesForMargin         4      below this, no average margin is shown
  minTradesForPositionLean   6
  minTradesForAgeLean        6
  minOverpaySample           3      times they paid up before we call it a habit
  minDraftsForReach          2
  minAvoidSeasons            3      seasons a player was available to them
  minSeasonsForTendency      1
  minLeagueSeasonsForRate    3      below this, win rate shows as a raw count
draft:
  reachRoundsThreshold     0.75     rounds early before it counts as a reach
  earlyRoundCutoff           3      what counts as an early pick for affinity
  pickObservationGapMs   45000      poll interval written as the error bar
display:
  favouritesShown           12
  avoidsShown                8
  tradesShown               20
  leagueRowsShown           50
  narrativeSentencesMax      6
tendency:
  bandStepMax                1      how far a tendency may move an acceptance band
  confidenceLowMax           5      sample size ceilings for the three bands
  confidenceMediumMax       15
  enabledForTradeIdeas    true      the global kill switch
modelVersion               "mp-1"
```

Saving does not fan out recomputes. Bumping `modelVersion` invalidates every
cached report and every tendency row on next view, same as Power Pulse.

### 5.2 `manager_pulse_runs` (0250)

One row per requested run. Columns: `id`, `user_id` (the signed-in requester),
`sleeper_user_id`, `sleeper_handle`, `season_from`, `season_to`, `status`
(`pending | capturing | computing | complete | error | throttled`),
`leagues_total`, `leagues_done`, `leagues_failed`, `section_status jsonb`,
`detail text`, `requested_at`, `completed_at`.

RLS: `manager_pulse_runs_select_own` (auth.uid() = user_id) and
`manager_pulse_runs_service_role_all`. No anon access, no client writes. The
enqueue RPC is `security definer`.

`detail` is server-written, never user-controlled, and rendered as text.

### 5.3 `manager_pulse_cache` (0251)

One row per `(sleeper_user_id, season_from, season_to, model_version)`. Columns:
`report jsonb`, `fingerprint text`, `league_seasons_counted int`,
`generated_at`, `metadata jsonb`.

RLS: service-role only. The page reads it in a server component with the admin
client behind the auth gate, never from the browser.

### 5.4 `manager_pulse_tendencies` (0252)

The compact cross-tool row, one per `sleeper_user_id`. Columns: `tendency jsonb`
(carrying the `overall`, `dynasty` and `redraft` slices), `dynasty_sample int`,
`redraft_sample int`, `season_from`, `season_to`, `model_version`,
`generated_at`.

The two sample counts are real columns rather than jsonb keys so Trade Ideas can
filter to rows that clear the floor for the league type it is in without
deserializing anything.

Split from the report cache on purpose. Trade Ideas needs eleven of these per
league page and must not deserialize eleven full reports to get them.

RLS: service-role only.

### 5.5 `draft_pick_observations` (0253)

The per-pick timing ingestion table. One row per `(sleeper_draft_id, pick_no)`.
Columns: `sleeper_draft_id`, `pick_no`, `round`, `draft_slot`, `roster_id`,
`picked_by`, `sleeper_player_id`, `first_seen_at timestamptz`,
`observation_gap_ms int` (the poll interval at capture time, which is the error
bar), `was_autopick boolean`, `metadata jsonb not null default '{}'`.

`metadata` preserves the raw pick object and the autopicker list as received,
per the original-source-preservation rule.

Written by the On The Clock live sync path only. RLS: service-role only.

### 5.6 `league_sync_jobs.job_kind` (0254)

`text not null default 'pulse'` with a check constraint of
`('pulse', 'footprint')`. The worker switches on it. Existing rows and existing
enqueue paths keep working untouched because of the default.

### 5.7 RPCs (0255)

- `try_claim_manager_pulse(p_user_id uuid, p_cooldown_seconds int)` returns
  claimed or retry_after_seconds. `security definer`, granted to `authenticated`
  only, revoked from `public` and `anon` by name (all three roles named, per the
  SECURITY DEFINER grant rule).
- `enqueue_manager_pulse_capture(p_run_id uuid, p_leagues jsonb)` writes the
  footprint jobs and the run's `leagues_total` in one transaction.

After every migration: regenerate types via MCP into `lib/database.types.ts`,
then confirm policies exist by querying `pg_policies`.

### 5.8 The admin panel

`/admin/manager-pulse`, registered in `lib/nav-tree.ts` under the existing admin
section so it appears in the dashboard beside Power Pulse and the rest. Four
sub-pages behind a sub-nav, following the `BEACON_SUBPAGES` registry pattern in
`lib/manager-pulse-admin-nav.ts` so adding a page is one edit and it shows up in
both the landing index and the sub-nav.

**`/admin/manager-pulse` (Settings).** Every value in the block above, grouped
by what it does rather than by the shape of the JSON, each group stating the
consequence of changing it. Same form conventions as
`app/admin/power-pulse/power-pulse-settings-manager.tsx`: real labels tied by
id, a polite live region for the save result, a reset button that does not
navigate, server-side zod validation before the write, and the service-role
client doing the writing.

**`/admin/manager-pulse/runs` (Runs).** The observability page. Recent
`manager_pulse_runs` rows with handle, window, status, leagues done over total,
failures, duration and detail. A row expands to its per-section status map.
Filter by status. This is where an admin sees a capture that stalled.

**`/admin/manager-pulse/cache` (Cache).** What is stored: how many reports, how
many tendency rows, the oldest and newest, the count per model version, and a
per-handle lookup. Two buttons: invalidate one handle's report, and invalidate
every report on a superseded model version. Both are confirms, both use the
house dialog with `desktopPlacement="center"` because they are decisions rather
than detail views.

**`/admin/manager-pulse/observations` (Draft clock).** How much per-pick timing
we have actually accumulated: drafts observed, picks observed, coverage by
season, and the median observation gap, which is the error bar the report
quotes. This page is the honest answer to "is the draft clock feature working
yet", and it exists because that feature starts empty by construction.

ABSOLUTE RULE: every admin write is admin-gated twice, in the page and again in
the server action, and validated server side before it touches the row. The
client payload is never trusted. Same rule the Power Pulse admin already holds.

---

## 6. The report

### 6.0 Dynasty and redraft are separated, everywhere

Dynasty and redraft are different games. The goal differs, the asset horizon
differs, what a good trade looks like differs, and, critically, the VALUE SCALE
differs: a dynasty superflex trade and a redraft PPR trade are priced against
different format configs, so their margins are not on the same axis.

The report therefore carries a **lens** at the top: All, Dynasty, Redraft. It is
a real filter on every section, it lives in the URL as `?lens=dynasty` so a view
is shareable, and it defaults to whichever bucket holds more of the manager's
league-seasons. League type comes from the existing
`lib/league-category.ts categorizeLeague`, the same four-bucket rule the rest of
the site uses (dynasty, redraft, best-ball-dynasty, best-ball-redraft), with
best ball folded into its parent for the lens and broken out inside the sections
that care.

ABSOLUTE RULE: a figure priced in league value is NEVER pooled across dynasty
and redraft. Trade margins, overpay detection, position appetite and age lean
are computed per league type and stored per league type. There is no combined
number for any of them, not even under the All lens, which shows the two figures
side by side instead. Averaging a dynasty margin with a redraft margin produces
a number with no unit.

Metrics fall into three buckets, and every one of them declares which it is in
`types.ts`:

- **Scale-free, poolable.** Win rate, championships, playoff rate, finish
  percentile, lineup efficiency, moves per week, waiver counts, draft reach in
  rounds. These have a combined figure, and the lens narrows it.
- **Scale-dependent, never pooled.** Every value-priced figure above. Dynasty
  and redraft each get their own, and All shows both.
- **Type-exclusive.** Only meaningful in one game, and absent in the other
  rather than shown as zero:
  - Dynasty only: pick trading behaviour, age lean, startup versus rookie draft
    split, rookie pick usage, the rebuild-or-contend read.
  - Redraft only: in-season churn rate as a share of the roster, waiver
    dependence, and the fact that every team is win-now, which is already how
    `lib/trade-finder/profile.ts` flattens direction in a redraft league.

Under the All lens, a type-exclusive card renders with its type named in the
heading ("Dynasty only") rather than being hidden, so a reader is never left
wondering where a card went.

The header states the split in words on first paint: "31 league-seasons: 19
dynasty, 12 redraft."

Eight sections. Each loads independently, caches independently, and states its
own sample size.

### 6.1 Header: who this is

Handle, avatar, seasons covered, league-seasons found, the split across dynasty,
redraft and best ball, and the first season we can see them in. One large accent
figure: total league-seasons. Sub-line: "4 seasons, 31 leagues, 2019 to 2026."

### 6.2 Results

Aggregate record, win rate, championships, runner-ups, playoff rate, last-place
finishes, and average finish as a percentile of league size.

Percentile rather than raw rank, because 3rd in a 10-team league and 3rd in a
14-team league are different achievements. Points for and against normalize the
same way, as a rank within their own league-season rather than a raw total,
because scoring settings differ.

Large accent numbers: win rate, championships, playoff rate.

### 6.3 Draft habits

- Reach index: average pick number minus market ADP, from `draft_market_adp`,
  expressed in rounds. Positive means they take players earlier than the market.
- Positional shape of their first three rounds, across all drafts.
- Rookie versus veteran lean in dynasty startups.
- Keeper usage where the league has keepers.
- Draft pace, labelled as a league fact per 2.3A.
- Per-pick clock and autopick rate when `draft_pick_observations` has rows, with
  sample size and error bar stated on the card.

ABSOLUTE RULE: a grade for a draft pick is the existing On The Clock draft
grading, not a second implementation. `lib/on-the-clock/draft-grade.ts` is the
one copy. Manager Pulse aggregates its output across drafts.

### 6.4 Who they like

Exposure is the number of distinct league-seasons in which the manager rostered
a player, weighted by how deliberately they got him. Drafted inside the first
three rounds counts most, drafted late counts less, a waiver add less again, and
a trade-in counts as a deliberate acquisition.

Two lists:

- **Favourites**: highest exposure relative to how commonly that player is
  rostered across every league in our database. A player everyone rosters is not
  a preference.
- **Avoids**: players with high league-wide exposure this manager has never
  rostered across the window.

ABSOLUTE RULE: an avoid needs opportunity. A player is listed as an avoid only
if he was available in leagues the manager played in for at least
`minAvoidSeasons` seasons. Otherwise we are reporting an accident as a habit.

Repeat drafting gets its own line. The same player taken in three separate
drafts is the loudest affinity signal there is.

### 6.5 Trading

Every trade the manager was in across the window, graded through the existing
Signal Check batch pipeline (`lib/league-signal-check.ts analyzeLeagueTrades`).
No second grader.

Derived from those grades:

- Trade frequency per season and per league-season.
- Average value margin FROM THEIR SIDE. Negative means they habitually give up
  more than they get, priced at market.
- Verdict distribution across their trades.
- Net value flow by position: which positions they are a net buyer of, which
  they sell.
- Age lean: net value flow weighted by player age. This is the dynasty tell. A
  buyer of 22-year-olds and a buyer of proven production want very different
  offers.
- Pick behaviour: do they trade picks at all, and do they buy or sell them.
- Who they trade with most.

**"Who they overpay for"** is the intersection of two facts already computed
here: positions or specific players where their average paid-versus-market
margin is negative AND the exposure count is high enough to be a pattern rather
than one bad Tuesday. `minOverpaySample` in settings governs it. Below that
floor the card says nothing rather than saying it quietly.

ABSOLUTE RULE: a trade containing a draft pick the value source cannot price is
flagged, and its margin is reported on the players only, exactly as the Manager
Ledger does. Never silently dropped, never priced as zero.

### 6.6 Roster management

- Moves per week, and the shape of that across a season (front-loaded, steady,
  gone by week 10).
- Waiver and FAAB aggression: claims per season, average bid as a share of
  budget, and what those claims produced.
- Lineup efficiency, best-lineup record and wins left on the bench, read from
  `league_manager_ledger_cache` per 4.4, with the covered-league count stated.
- Abandonment signal: league-seasons ending with several weeks of zero moves and
  an incomplete lineup. Reported as a count, not as a judgement.

### 6.7 How to deal with them

The actionable summary, and the section the whole tool exists for. Deterministic
sentences built from the figures above.

ABSOLUTE RULE: no language model anywhere in this feature. Every sentence is a
template citing a figure present on the same screen, and a null figure means the
sentence does not fire. Same rule Trade Ideas already holds, for the same
reason: a reader has to be able to check every claim against the numbers beside
it.

Template shapes (final copy written condensed and plain):

- "Trades a lot. 14 trades in 4 seasons, about 4 a year."
- "Pays up for young receivers. Bought 6 WRs under 25, gave up 8% more value
  than market on 5 of them."
- "Will not trade picks. 0 picks moved in 14 trades."
- "Sets a good lineup. 96% of available points, measured in 9 of 31 seasons."
- "Quiet after October. Half their moves land in the first four weeks."

Each sentence carries its sample size inline, in the sentence, not in a
footnote.

### 6.8 League list

Every league-season we counted, with its result, so the reader can see the
evidence. Sortable. Each row links to the League Pulse deep view when we hold
that league.

---

## 7. The page

### 7.1 Routes

- `/tools/manager-pulse`: entry. A search box for a handle. Signed in, search
  works. Signed out, a sign-in prompt sits where the search box would be, and
  the full sample report renders below it.
- `/tools/manager-pulse/[handle]`: the report. Signed in only.

Both use the normal tool page shell so they sit alongside the rest of the tools
directory. The handle is validated against Sleeper's own handle grammar before
any lookup, and the resolved user id is what everything downstream keys on, so a
renamed handle does not fracture the cache.

`robots: noindex` on `/tools/manager-pulse/[handle]`. These pages describe named
real people from public data. They should not be indexed.

### 7.2 Auth gate

ABSOLUTE RULE: the gate is server-side, in the page and independently in every
API route. A client prop is never a security boundary, the same rule the league
refresh endpoint already holds.

The guest experience is a real page, not a redirect: the tool header, the
sign-in call to action, then the sample report in full.

### 7.3 The sample report

Full fidelity. Same components, same layout, obviously fake data.

Fenced by five independent signals, and the ones carrying the weight are WORDS
rather than styling, because a badge and a dashed border are exactly what a
screen reader cannot use. This copies the Manager Ledger's example rules, which
exist for this reason:

1. The handle is `SampleManager`, which cannot be read as a real Sleeper handle.
2. Every player name in the fixture is a placeholder, not a real NFL player.
3. A Sample badge on the container.
4. A heading saying in words that these are not real numbers.
5. A `<caption>` on every table saying the same, since a caption is the first
   thing announced on entering a table.

The fixture lives in `lib/manager-pulse/sample.ts`, is imported by the guest
view only, and a test asserts that no real read path imports it.

### 7.4 Loading model

The page shell paints immediately. Nothing in the first paint awaits a Sleeper
call or a compute.

- The shell (header skeleton, section nav, section frames) is static.
- Each section is its own `Suspense` boundary reading its own slice of the
  service, exactly as the league deep view already streams its panels.
- When a capture is queued, a client component polls
  `GET /api/manager-pulse/runs/[id]` and renders the real progress bar from
  `leagues_done / leagues_total`, plus a per-section status list. The poll
  interval backs off and stops on a terminal status.
- Sections whose data is already cached render on first paint and never wait for
  the queue.

Progress bars are real `role="progressbar"` elements with `aria-valuenow`,
`aria-valuemin`, `aria-valuemax` and `aria-valuetext` ("31 of 44 leagues read"),
inside an `aria-live="polite"` region that announces on meaningful change rather
than on every tick.

### 7.5 Design

Premium, with mobile as the top priority.

- FF Beacon brand only: dark ground, purple `#A855F7` to cyan `#22D3EE`, Geist.
  No gold, no `#0c0c18`.
- Every section leads with one large accent number and a short subtitle. That is
  the premium tell: a figure big enough to read across a room, with a sentence
  under it saying what it means in plain words.
- Gradient section headers alternate so a long report does not read as one grey
  column.
- Entry animations are short, respect `prefers-reduced-motion`, and never gate
  content behind an animation finishing.
- Every drill-down (a player's exposure history, a graded trade, a league-season)
  opens in `components/slide-up-dialog.tsx`: up from the bottom below `sm`, in
  from the right at `sm` and above. `desktopPlacement="center"` is not used
  here, because nothing in this feature is a confirm.
- Section navigation reuses the `components/league-shell` pattern: a rail on
  desktop, the mobile nav dock on small screens. New `components/manager-shell/`
  with the same three files (`nav-items.ts`, rail, mobile nav) rather than
  bending the league one, since the nav items differ.

Mobile rule, non-negotiable: no data is hidden at any breakpoint. Where a
desktop table has six columns, the mobile layout is a two-line row or a stacked
cell still carrying all six values. Tap targets stay at least 44 by 44 CSS px.
The accessibility reviewer confirms "no data hidden at any breakpoint"
explicitly.

### 7.6 Charts

Every chart is `role="img"` with a summary as its accessible name, and a real
`<table>` under a disclosure carrying the same numbers. Same rule the Lineups
season charts already follow.

---

## 8. Extending Trade Ideas

The second consumer, and the reason for the service boundary.

### 8.1 The DTO

```ts
/** The per-league-type half. Everything value-priced lives in here. */
type TendencySlice = {
  tradeCount: number;
  tradesPerSeason: number;
  /** Mean value margin from THIS manager's side, as a share. Negative pays up. */
  avgValueMargin: number | null;
  /** Net value bought minus sold, per position. */
  positionAppetite: Partial<Record<TradePosition, number>>;
  /** Positive means they buy youth. Dynasty only; null in redraft. */
  ageLean: number | null;
  picksTraded: number;
  favouritePlayerIds: string[];
  avoidPlayerIds: string[];
  sampleSize: number;
  confidence: "low" | "medium" | "high";
};

type ManagerTendency = {
  sleeperUserId: string;
  seasonsCovered: number;
  /** Scale-free and safe to read whatever league you are in. */
  overall: { leagueSeasons: number; winRate: number | null; lineupEfficiency: number | null };
  dynasty: TendencySlice | null;
  redraft: TendencySlice | null;
};
```

ABSOLUTE RULE: a caller reads the slice matching the league it is in and never
the other one, and never a blend of the two. `pickTendencySlice(tendency,
leagueCategory)` is the one accessor, and it returns null rather than falling
back to the other game. A dynasty read of a manager we have only seen in redraft
is an absence, not an approximation.

### 8.2 How it enters the engine

`TradeFinderInput` gains one optional field:

```ts
managerTendencies?: Map<number, ManagerTendency>; // keyed by rosterId
```

The engine stays pure. The page resolves `league_users.sleeper_user_id` per
roster, calls `getManagerTendencies` once for the whole league, and passes the
map in. One batched read per page load, from cache only.

### 8.3 What it is allowed to change

ABSOLUTE RULE: tendencies never touch the VALUE math or the WINS math. Both
sides of every trade are still priced and simulated exactly as they are today.
Tendencies affect three things and nothing else.

1. **The acceptance band.** A manager who trades often and has historically
   accepted deals at a value loss gets a band bump. A manager with zero
   completed trades in the window gets a downgrade. Bounded to one band step in
   either direction, and the reason is always stated.
2. **Package construction ordering.** Prefer building offers around players in
   their `favouritePlayerIds` and positions they are a net buyer of.
   Deprioritize positions they have never bought. Skip pick-based offers
   entirely for a manager with `picksTraded === 0`.
3. **New reason sentences.** Deterministic templates, same as everything else.

ABSOLUTE RULE: every tendency-driven sentence names its sample size, and a
tendency below `minSample` is dropped entirely rather than shown hedged. "They
like tight ends" from two trades is noise wearing a suit.

ABSOLUTE RULE: Trade Ideas never triggers a Manager Pulse capture. A league
where nobody has a cached tendency behaves exactly as it does today: no new
sentences, no band adjustments. The feature degrades to absent, never to zero.

### 8.4 What the reader sees

Under the acceptance band on each suggestion card, a short line: "Trades often,
pays up for backs. 11 trades, 3 seasons." Expanding it opens the slide-up dialog
with that manager's tendency detail and a link to their full Manager Pulse.

A setting turns tendency influence off, because some readers want the pure value
read. Default on.

---

## 9. Security

- Auth gate server-side on the page and on every route handler, re-validated
  independently, never from a client prop.
- Rate limits: the run cooldown RPC, plus `claimRateLimitSlot` on the handle
  lookup endpoint so an authenticated user cannot enumerate handles at speed.
  The limiter fails closed on the lookup and open on rendering a cached report,
  so a limiter outage does not turn every report into an error state.
- Handle input validated against Sleeper's grammar before any fetch, length
  capped, encoded at every call site.
- All new tables service-role only except `manager_pulse_runs`, which is
  owner-scoped select.
- `detail` and every other server-written status string renders as text, never
  as HTML.
- No `auth.users` exposure. The report is keyed by Sleeper user id and never
  joined to a site account, so looking someone up never reveals whether they
  have an FF Beacon account.
- No email, no IP, nothing beyond what Sleeper publishes publicly.
- `npm audit` clean before the review pass.

---

## 10. Testing

Unit tests alongside every pure module, matching the existing convention.

- `discover.test.ts`: season window, dedupe across `previous_league_id` chains,
  the cap and what it drops first.
- `index-build.test.ts`: ownership spans, acquisition attribution, a player
  acquired and dropped twice in one season.
- `results.test.ts`: bracket parsing, the `p:1` champion, a league with no
  bracket, a two-way tie.
- `drafting.test.ts`: reach index with a missing ADP row, keeper exclusion, pace
  when `last_picked` is null.
- `affinity.test.ts`: the opportunity requirement for avoids, baseline
  normalization.
- `trading.test.ts`: margin sign convention from the manager's own side, an
  unpriceable pick flagged rather than dropped, the overpay sample floor.
- `tendencies.test.ts`: confidence banding, the minSample drop.
- `narrative.test.ts`: every template fires only with its figure present.
- `fingerprint.test.ts`: clock-free, and changes on every input that should
  change it.
- `purity.test.ts`: no Supabase, fetch or React import in the pure modules.
- `sample-isolation.test.ts`: `sample.ts` is imported by the guest view only.
- `naming.test.ts`: the "WAR" token rule holds inside `lib/manager-pulse/`, the
  same way `lib/positional-war/naming.test.ts` enforces it elsewhere. Nothing
  here measures a position-independent metric, so the token appears nowhere.

Trade Ideas keeps its existing suite green. If a change in `lib/trade-finder/`
breaks an existing test, the change is wrong.

---

## 11. Build order and sub-agent plan

I orchestrate and write the connective code. Sub-agents run on the latest
Sonnet. Waves run in parallel; each wave lands before the next starts, because
the next depends on it.

Every sub-agent brief carries the relevant CLAUDE.md rules verbatim, the file
paths it owns, the file paths it must not touch, the tests it must write, and
the copy rules (condensed, plain words, no em dash, straight quotes, no emoji).

Per the spawning rule in the global CLAUDE.md: **no `name` parameter, no
`team_name`**. Keep the returned agent id and let the completion notification
deliver the report.

**Wave 0 (me, alone).** Migrations 0249 through 0255, applied via MCP, saved to
`/supabase/migrations/`, `pg_policies` verified, types regenerated into
`lib/database.types.ts`. Everything else compiles against those types, so this
is not parallelized.

**Wave 1, four agents in parallel.**

- A1: `lib/sleeper.ts` additions (both brackets, autopickers) plus tests.
- A2: `lib/manager-pulse/` types, default-settings, settings, validate,
  fingerprint. The shapes everything else compiles against.
- A3: `pulseLeagueFootprint` in `lib/league-pulse.ts`, `job_kind` handling in
  `lib/league-bulk-sync.ts` and the worker, plus tests.
- A4: `/admin/manager-pulse` settings page, the nav-tree registration, the
  sub-nav registry, and the server validation.

**Wave 2, five agents in parallel.** The pure engine modules, one agent each,
against the Wave 1 types: results, drafting, affinity, trading, roster-ops. Each
writes its own tests. They do not touch each other's files.

**Wave 3, three agents in parallel.**

- B1: `index-build.ts`, `engine.ts`, `narrative.ts`, `tendencies.ts`.
- B2: `load.ts`, `capture.ts`, `service.ts`, the run RPC wiring, the status API
  route.
- B3: `draft_pick_observations` capture inside the On The Clock live sync path.

**Wave 4, four agents in parallel.**

- C1: `components/manager-shell/`, the page shell, section nav, the league-type
  lens control, and the loading skeletons.
- C2: Sections 6.1 through 6.4 as components.
- C3: Sections 6.5 through 6.8 as components.
- C4: The sample fixture and the guest view.

**Wave 5, three agents in parallel.**

- D1: Trade Ideas extension: the `TradeFinderInput` field, the engine effects,
  the reason templates, the page's batched tendency read, and the toggle.
- D2: The progress bar component, the polling client, aria-live wiring, and
  reduced-motion handling.
- D3: The three remaining admin sub-pages: runs, cache, draft-clock coverage.

**Wave 6, me.** Integration, typecheck, full test run, a manual walk of the page
on a real handle and on the guest path, and a mobile viewport check.

### 11.1 Session continuity

This build is large enough to span sessions, so the two state files are updated
as the work happens rather than at the end.

ABSOLUTE RULE: `progress.md` gets one atomic task per file, in the project's
`MP-T###` format, written the moment that task completes. Never batched, never
back-filled at the end of a wave. A task row carries its files, its
dependencies, and whether it has been verified.

ABSOLUTE RULE: `handoff.md` is rewritten at the end of every wave, and again
before any pause. It states exactly what is green, what is half-built, which
migrations are live on the Supabase project, what the next wave is, and anything
a fresh session could not work out from the code. It is written for someone who
has read nothing else.

The two are different documents on purpose. `progress.md` is the ledger of what
happened; `handoff.md` is the briefing for what happens next.

---

## 12. Review pass

When the build is done, four Opus reviewer sub-agents run in parallel. Again, no
`name` parameter.

1. **Implementation review.** Does the build match this plan. Every ABSOLUTE
   RULE in this document checked one at a time and cited by file and line.
   Naming conventions, file placement, schema correctness, and no duplicate
   implementation of anything that already exists.
2. **Security review.** Auth gate on the page and on every route, rate limits on
   every path that can trigger work, RLS policies present and actually
   enforcing, no secret exposure, no IDOR on the run id, no SSRF through the
   handle, error messages that do not leak, `npm audit`.
3. **Accessibility review.** WCAG 2.2 AA and the project rules. Screen reader
   and pointer-reader coverage on every figure, including the charts and the
   progress bars. Focus management in the slide-up dialog. Heading hierarchy.
   Explicit confirmation that no data is hidden at any breakpoint. Explicit
   confirmation that no visible figure is `aria-hidden`.
4. **Performance review.** First paint awaits nothing. Every section really is
   its own boundary. Every progress bar is bound to counted work rather than a
   timer. No N+1 reads. Every list read is paged past the 1000-row cap. Cache
   keys and fingerprints include everything that should invalidate them. Bundle
   impact of the new client components.

Anything a reviewer finds is fixed before the feature is called done.

---

## 13. Finishing

- **Do not commit. Do not push.** The work is left in the working tree for
  review.
- Output the build report as an Artifact: what was built, what each reviewer
  found, what was fixed, what was deliberately left out and why, and the honest
  limits (per-pick draft timing starts from zero, lineup efficiency only covers
  leagues that already have a ledger row, the season window and what it missed).

---

## 14. Copy rules for everything in this feature

- The shortest version of every string that still says the thing.
- Plain words. "Pays up for" beats "exhibits a value premium on".
- No em dash, no en dash, no curly quotes, no ellipsis character, no middle dot,
  no emoji. Straight ASCII punctuation only.
- No negative parallelism, no puffery, no rule-of-three cadence, no formulaic
  transitions.
- Every timestamp through `lib/datetime.ts`. Never a bare `toLocaleString`.
- Every number that is an estimate says so, and every figure carries its sample
  size wherever that sample could be small.

---

## 15. What shipped, where it differs from the plan

Written after the build and after four independent reviews. Section 5 above is
the schema as planned; this is the schema as built. The differences are all
things the build learned that the plan could not have known.

### Migrations, as shipped

The plan named seven migrations, 0249 to 0255. Ten shipped, 0249 to 0260.

| No. | Object | Note |
| --- | --- | --- |
| 0249 | `manager_pulse_settings` | as planned |
| 0250 | `manager_pulse_runs` | plus `counts_against_cooldown`, unplanned |
| 0251 | `manager_pulse_run_leagues` | NOT IN THE PLAN. See below. |
| 0252 | `manager_pulse_cache` | planned as 0251 |
| 0253 | `manager_pulse_tendencies` | planned as 0252; `dynasty_sample` and `redraft_sample` are real columns |
| 0254 | `draft_pick_observations` | planned as 0253 |
| 0255 | `league_sync_jobs.job_kind` | planned as 0254 |
| 0256 | `league_sync_jobs` second owner | NOT IN THE PLAN. `request_id` nullable, `manager_run_id` added, exactly-one-owner constraint. |
| 0257 | the two RPCs | planned as 0255 |
| 0258 | `player_roster_exposure` | NOT IN THE PLAN. See below. |
| 0259 | fix 0258 to count distinct rosters | review finding |
| 0260 | fix 0257's counting and its zero cap | review finding |

**`manager_pulse_run_leagues` (0251)** exists because `league_sync_jobs` has a
unique index on (user, league) for in-flight rows, so a league already being
synced by somebody's Sync all press produces NO new job row. A progress bar
counting inserted jobs would therefore stall below 100 percent forever. The bar
counts these rows instead, and the enqueue RPC links to the in-flight job rather
than duplicating it.

**`player_roster_exposure` (0258)** exists because the affinity section ranks
favourites against how commonly a player is rostered generally, and without that
denominator every manager's favourites list is the same list of good players.
The loader correctly refused to compute it per report (the only options were one
query per player or a full scan of every roster on the site), so it is a
pre-calculated table rebuilt on the existing nightly derived job. It iterates no
leagues, so it does not break the no-per-league-cron rule.

**Section 5.7 as written would have been a security bug.** It says the claim RPC
is "granted to `authenticated` only". Both RPCs are SECURITY DEFINER and write
past RLS, so they are granted to `service_role` only, revoked from `public`,
`anon` AND `authenticated` by name. The build got this right; the plan text did
not.

### Settings, as shipped

The plan listed six groups. Eight shipped. `behaviour` (move-shape thresholds,
the abandonment quiet-week floor) and `wording` (ten thresholds that decide which
word a figure earns) were both extracted during the build, each time because an
agent shipped them as local constants and said so, and each time because they are
exactly what the "no hardcoded limit" rule is about: a number that decides
whether we call somebody "faded" is a judgement about what we are willing to say
about a person.

`draft.pickObservationGapMs` was REMOVED after review: the observation gap is
measured per row and stored on it, so a configured value would have been a
second, disagreeing answer.

### Section 3's module map

`index-build.ts` was never built. The shaping it described lives in `load.ts`
feeding `input-types.ts`, and the review confirmed no ownership logic was
duplicated as a result. `input-types.ts` and `service.ts` are in the shipped tree
and were not in the plan's map.

`discover.ts` was planned as "pure given a fetcher" and was built impure (it
calls Sleeper directly). The purity guard excludes it deliberately and names the
reason, which is the correct handling of what was actually built.

### Section 7.4's loading model

The plan says each of the eight sections is its own Suspense boundary reading its
own slice of the service. The service returns ONE atomic report, so eight
boundaries around already-resolved data could never suspend. This was corrected
after review to one real boundary around the whole report, which is what the
shape of the service actually supports. Splitting the service into eight
independently-resolving slices remains possible and is not built.
