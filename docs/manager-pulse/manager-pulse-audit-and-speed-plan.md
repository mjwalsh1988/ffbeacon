# Manager Pulse: audit, and the implementation plan to make it fast

Status: AUDIT AND PLAN. Nothing in this document has been built. Written
2026-09-05 against `main` at `bca707d`, revised the same day after owner
review to add three requirements (Part 3), the Sleeper GraphQL research
(MPS-T038) and the measurement protocol (Part 9). Task prefix for the build:
`MPS-T###` in `progress.md`. Next available migration number: 0261.

THIS DOCUMENT IS THE SPEC. Parts 1 to 4 say what is wrong and what the
product should do. Part 5 says exactly which file changes, what the code is,
what the SQL is, and which test proves it. Whoever builds this follows Part 5
as written and records deviations in `progress.md` under the task id rather
than deciding differently in place. Where Part 5 shows code, the code is the
intent; names, signatures and orderings are not suggestions.

The plan of record for the feature itself is `manager-pulse-plan.md` in this
folder. This document does not restate it.

---

## Part 1. What the owner asked for

1. The sync is slow and the progress bar sometimes looks stuck.
2. A live clock counting up from zero while the leagues sync, and a moving
   "electric" treatment on the bar so it always looks alive.
3. Show the report as soon as the first few leagues are in and let it fill in
   live while the rest arrive; raise the 60 league-season cap.
4. (Review, 2026-09-05) Never "double pull" a manager: a second reader looking
   up a handle that is already being captured joins that capture rather than
   queueing the same leagues again, and the same league is never re-synced
   over and over.
5. (Review) Staleness for Manager Pulse only: a league is re-synced only when
   it has not been synced for 14 days, and a finished season is never
   re-synced at all.
6. (Review) Every league sync, from whichever tool starts it, captures the
   full set of raw data every tool needs, so a league synced by League Pulse
   needs nothing more when Manager Pulse reads it. Without slowing any other
   tool.

---

## Part 2. How a cold lookup runs today

Read from the code. Numbers are typical, not measured under load.

```
reader submits handle
  |
  v
page render, one Suspense boundary (app/tools/manager-pulse/[handle]/page.tsx)
  getManagerFootprint (lib/manager-pulse/service.ts)
    warm cache by handle?                      no Sleeper call
    claim lookup slot (10/min, 200/day)
    resolve handle                             1 Sleeper call
    warm cache by user id?                     no
    findOpenRun                                indexed read
    startManagerCapture (lib/manager-pulse/capture.ts)
      discoverLeagueSeasons                    4 Sleeper calls (one per season, 3 at a time)
      leagues.last_pulsed_at for every id      1 read
      try_claim_manager_pulse                  RPC: per-user cooldown, 1 run row
      enqueue_manager_pulse_capture            RPC: N run_leagues rows, M footprint jobs
    return "building"                          page shows the progress panel
  |
  v
nothing happens for 0 to 60 seconds             the cron tick is the only trigger
  |
  v
league-sync-worker cron, every minute (lib/league-bulk-sync.ts runLeagueSyncWorker)
  claims 8 jobs, runs them ONE AT A TIME, 1.2 s pause between, 50 s budget
  each footprint job (lib/league-pulse.ts pulseLeagueFootprint):
    pulseLeagueCore        league, rosters, users, traded picks, drafts, 1 per draft   ~6 calls
    syncTransactions       weeks 0..25 in batches of 6, stop after 3 empty weeks      ~18-24 calls
    captureLeagueBrackets  winners + losers                                            2 calls
    (draft selections NOT captured here; matchups NOT captured here)
  closes the run_leagues rows, recounts the run, flips it to "computing"
  |
  v
browser poll (components/manager-pulse/use-capture-progress.ts): 1.5 s, x1.4, cap 8 s
  stops on "computing", calls router.refresh()
  |
  v
page renders AGAIN, boundary suspends, the generic skeleton replaces the panel
  getManagerFootprint resumes the run, loadManagerPulseInput reads the whole
  season (~15 paged queries), computeFootprint, writes manager_pulse_cache,
  closes the run
  |
  v
report
```

| Stage | Today |
| --- | --- |
| Sleeper calls per cold league-season | 26 to 32 |
| Leagues one worker minute finishes | 4 to 6 |
| Wall clock, 60 cold league-seasons, empty queue | 10 to 15 minutes |
| Time before the FIRST league moves | 0 to 60 s |
| Sleeper calls per minute, worst case | about 200 (Sleeper's guidance is 1,000) |
| Repeat lookup after 60 minutes | every league-season queued again, finished seasons included |
| Second reader looking up the same handle mid-capture | a second full set of jobs |

The queue is shared with Sync all and is first in, first out.

---

## Part 3. The three review requirements, and what the code does about them today

### 3.1 Joining a capture already in flight

What happens today when reader B looks up a handle reader A is already
capturing:

- `try_claim_manager_pulse` (migration 0257) keys the cooldown on the USER, so
  B gets their own run row. That part is right and stays: a run row is what B
  polls, what the cooldown meters, and what the admin page lists.
- `enqueue_manager_pulse_capture` (0257, 0260) decides `needs_capture` from
  `leagues.last_pulsed_at`. A's jobs have not finished, so every league still
  reads stale, so B's run queues a full second set of jobs. The "link to an
  in-flight job" branch only looks for jobs `where user_id = v_run.user_id`,
  and `league_sync_jobs_active_unique` is on `(user_id, sleeper_league_id)`,
  so the per-league dedupe is per USER, not per league.
- When B's job for a league finally runs, `pulseLeagueCore`'s 60-minute TTL
  usually makes it a cache hit (one read, no Sleeper), and two concurrent runs
  in one process are merged by `lib/request-coalesce.ts`. So the DOUBLE SLEEPER
  PULL is mostly avoided by accident, but B's run still waits behind a second
  queue of N jobs, B's progress bar counts B's own jobs, and B's report is
  computed a second time.

What it will do: the link branch looks for an in-flight job for that league
from ANY user and ANY job kind (a Sync all job now captures the same set, see
3.3), B's run links to A's jobs, queues nothing, spends no cooldown, and B's
progress bar counts A's jobs finishing. A live report is stored per SUBJECT
(the manager being looked up), not per run, so A and B read the same document
and it is computed once per checkpoint. When A's finalize writes the cache, B's
finalize finds the fingerprint already stored and simply closes. Part 5, tasks
T035, T041, T045.

The residual race: two enqueues for the same league in the same instant can
both insert a job. It is bounded by the worker's run-time freshness check
(T035: a claimed job whose league became fresh since enqueue is marked done
without a Sleeper call) and by the in-process coalescer. It is not eliminated
without a site-wide unique index, and that index would silently drop leagues
from Sync all requests, which count inserted rows. Recorded, not pretended
away.

### 3.2 Staleness, for Manager Pulse only

`capture.captureTtlMinutes` (default 60) is replaced by
`capture.captureStaleAfterDays` (default 14) and a SETTLED rule:

- A league-season is SETTLED when `leagues.status = 'complete'` (Sleeper's own
  status, stored on every pulse) or `leagues.season < currentNflSeason()`.
- A settled league-season whose capture set is complete
  (`leagues.capture_completed_at is not null`, see 3.3) is never captured again
  by Manager Pulse.
- An unsettled league-season is captured when `capture_completed_at` is null
  or older than `captureStaleAfterDays`.
- This rule is applied TWICE: at enqueue time in `capture.ts` (so a fresh
  league queues no job) and at run time in the worker (so a job whose league
  became fresh while it waited is closed without a Sleeper call).

League Pulse's own 60-minute TTL in `pulseLeagueCore` is untouched. A reader
opening a league deep view still gets a fresh league. The two rules compose:
when Manager Pulse decides a league is stale (14 days or more) the core TTL
(60 minutes) also sees it as stale, so `pulseLeagueFootprint` really refetches;
when Manager Pulse decides it is fresh, the footprint is never called.

`reportTtlHours` stays at 24. A report older than that starts a run that queues
nothing (every league is fresh under the 14-day rule), which is a free run that
recomputes from the database in the drainer and never touches Sleeper.

### 3.3 One capture set, whoever starts the sync

Today the raw data a league sync writes depends on who asked:

| Raw data | Deep view (`pulseLeagueCore` + `pulseLeagueDerived`) | Footprint job | Relay cron | Signal Check import (`pulseLeague`) |
| --- | --- | --- | --- | --- |
| league, rosters, users, traded picks, draft settings | yes | yes | yes | yes |
| transactions | yes | yes | yes | yes |
| draft selections (picks) | yes (capped 5 drafts per run) | NO | yes | yes |
| winners and losers brackets | NO | yes | NO | NO |
| matchups (schedule and results) | yes, inside Power Pulse | NO | yes | yes |

What it will do: one function, `captureLeagueRawData` in `lib/league-pulse.ts`,
captures transactions, brackets and draft selections, and optionally matchups,
and stamps `leagues.capture_completed_at` when every applicable stage
succeeded. `pulseLeagueDerived` calls it with `includeMatchups: false` (Power
Pulse already syncs the slate on that path, with the failed-week semantics it
needs). `pulseLeagueFootprint` calls it with `includeMatchups: true`. A guard
test asserts that no other code path reaches the individual stage functions.
After this, a league synced by any tool holds everything Manager Pulse reads.

Cost to the other tools, stated exactly: the deep view's header path
(`pulseLeagueCore`) is unchanged. Its derived half, which already streams
behind a Suspense boundary, gains at most two bracket calls, and only on a real
resync of a league whose season has reached its playoffs or is complete, plus
one update statement for the stamp. Draft selections and matchups on that path
are exactly what they are today. The relay cron and the warm endpoint call the
same halves and inherit the same change. On The Clock does not sync leagues; its
live poller writes `draft_selections` for the room it is watching
(`lib/on-the-clock/sleeper-sync.ts` line 389) and is untouched.

The footprint job grows: it now also captures draft selections (one call per
completed draft, once) and the matchup slate (about 18 calls once for a settled
season, then 3 per resync of a current season). That is the price of "every
sync captures everything", it is paid once per league-season for the whole
site, and the estimates in 4.8 include it.

---

## Part 4. Findings and decisions

Ordered by how much they hurt a reader. Bug: the code does something other
than what its own comments or the plan say. Gap: the plan promised it and the
code does not do it. Design: works as written; the writing was the problem.

### F1. Gap: per-section readiness is never written

`manager_pulse_runs.section_status` is read by the progress panel
(`components/manager-pulse/capture-progress.tsx`), the progress route and the
admin runs page, and written by nothing. Every reader sees eight sections at
"Reading" until the report lands. `partial` in the building result is only ever
a stale cached report, so a first-ever lookup renders eight "Still reading
leagues" lines. Replaced by the live report (4.2, T040 to T044).

### F2. Bug: nothing kicks the worker after a Manager Pulse enqueue

`app/api/leagues/bulk-sync/route.ts` runs a head-start pass in `after()`.
`lib/manager-pulse/capture.ts` writes jobs and returns; the cron tick is the
only trigger. Fix: T003, T039.

### F3. Gap: footprint jobs never capture draft selections

`captureLeagueDraftSelections` (`lib/league-draft-selections.ts`) is called
only from `pulseLeagueDerived` (`lib/league-pulse.ts` line 555).
`lib/manager-pulse/load.ts` reads `draft_selections` (line 537) and
`draft_market_adp` (line 576) for Drafting, repeat drafts and the draft
ledger. Fix: the capture set, T010.

### F4. Bug: a failed Sleeper request during discovery reads as "no leagues"

`getSleeperLeagues` (`lib/sleeper.ts` line 156) returns `[]` for a failed
request and for an empty season. `discoverLeagueSeasons` cannot tell them
apart, so a 429 on one season drops it from a report cached for 24 hours, and a
failure on all four renders the Empty state as a fact. `getSleeperWeekTransactions`
(line 175) collapses null the same way; three failed weeks stop the walk and
the league is stamped fresh with a truncated history that the settled rule
would then keep forever. Fix: T007, T008, T009.

### F5. Bug: waiting in a busy queue for 20 minutes ends in "one lookup at a time"

`findOpenRun` (`capture.ts`) resumes only a run whose `updated_at` is within
`resumeMaxAgeMinutes`, and `updated_at` moves only when one of that run's jobs
closes (`recountManagerPulseRun` in `lib/league-bulk-sync.ts`). Queued behind
another reader's big lookup, nothing closes, the run stops qualifying, the next
render claims a new run, `try_claim_manager_pulse` refuses it, and the reader is
shown the Throttled page. `getManagerFootprint`'s catch block also never closes
the run, so a compute that throws parks it at "computing" forever. Fix: T002,
T045, T046.

### F6. Design: the report is computed inside a page render, and the panel vanishes

On "computing" the poller stops and calls `router.refresh()`. The boundary
suspends, the skeleton replaces the panel, and the render does the whole load
and compute. Fix: the drainer finalizes (T034, T040, T041).

### F7. Design: finished seasons are re-captured every sixty minutes

`needsCapture` in `capture.ts` applies `captureTtlMinutes` to every
league-season. Fix: 3.2, T036.

### F8. Gap: "fresh" is decided by age, not by whether the data exists

A league opened in the deep view an hour ago is fresh by `last_pulsed_at` and
holds no brackets. Fix: `capture_completed_at` is stamped only when the set is
complete (T013, T015, T016), and freshness reads that column (T036).

### F9. Design: the worker runs jobs one at a time

`runLeagueSyncWorker`: `MAX_JOBS_PER_RUN = 8`, `FOOTPRINT_PACE_MS = 1200`,
`RUN_BUDGET_MS = 50_000`, sequential loop. Fix: T032 to T034.

### F10. Gap: no explicit Sleeper egress limiter, and 429 is treated like any error

`safeFetch` in `lib/sleeper.ts` returns null on any non-2xx; no Retry-After, no
retry, no counter. Fix: T032, T033.

### F11. Bug: the worker's limits are hardcoded, against the feature's own rule

Five constants in `lib/league-bulk-sync.ts`; the comment on the first still
says "Five". Fix: T028, T029, T034.

### F12. Design: first in, first out, site-wide

Known (MP-R010). Fix: T030.

### F13. Design: the poll backs off to eight seconds

`use-capture-progress.ts` defaults 1500 ms, x1.4, cap 8000 ms;
`components/league-sync-all.tsx` `POLL_MS = 8_000`. Fix: T005, T006.

### F14. Bug: two copies of the season rollover rule that disagree on the clock

`lib/sleeper.ts currentNflSeason()` uses `getMonth()`/`getFullYear()` (local
time); `lib/manager-pulse/service.ts currentSeason()` uses the UTC variants.
Fix: T001.

### F15. Gap: the progress API does not return what a clock or a queue position needs

Fix: T019 to T021.

### F16. Copy: "while we check for anything newer" when nothing is checking

`[handle]/page.tsx` line 195. Fix: T011.

### F17. Design: the cooldown counts runs, not work

One run per user per hour whatever its size. Fix: a league-season budget,
T028, T045, T047.

### F18. Design: the transaction walk asks about weeks that cannot exist

`getAllSleeperTransactions(leagueId, 25, 3, fromWeek)` walks to week 25 with a
three-empty stop. Fix: T037. The GraphQL research (T038) found every
transactions query closed without a Sleeper login, so the REST walk stays.

### F19. Minor

Section order duplicated between `capture-progress.tsx` and the admin runs
page; `GetManagerFootprintRequest.sections` declared and ignored; the progress
route reads the run row twice; the footprint path takes an activity snapshot
for settled seasons. T012, T019, T020; the snapshot is left alone (database
work only, bounded, not worth a fourth code path).

### F20. Gap: the same handle looked up by two readers is captured twice

Part 3.1. Fix: T035, T041, T045.

### F21. Gap: the raw data a sync captures depends on which tool asked

Part 3.3. Fix: T013 to T016.

### 4.1 The panel

The rule in `progress-bar.tsx` stays: the FILL is bound to counted work and
never to a timer. Everything below decorates or annotates it.

- The API gains `requestedAt`, `leaguesProcessing`, `queueAhead`,
  `workerSeenAt`, `partialVersion` (T019 to T021).
- A `<time>` clock beside the count, ticking once a second from
  `requestedAt`, outside the live region, running through "computing",
  stopping at "complete" (T022, T023, T025).
- An estimate line once three leagues have finished and 30 seconds have
  passed, from the measured rate, rounded to the minute, hidden during
  "computing", restated into the live region at most once a minute (T022).
- Three layers on one `role="progressbar"`: the fill (the only thing
  `aria-valuenow` describes); a striped segment `leaguesProcessing / total`
  wide immediately after it; a bright band travelling along the fill on a 2.4 s
  loop, purple into cyan into white, glow underneath, CSS keyframes only,
  `aria-hidden`, still under `prefers-reduced-motion` (T024).
- Liveness said out loud: `workerSeenAt` older than 20 s while capturing dims
  the band and the count line says "waiting for the next league" or "14
  leagues ahead of yours in the queue" (T025).
- The live region speaks on: status change; the estimate's first appearance;
  every fifth league; each live-report update at most once per 30 s;
  completion. Never the clock, never every poll (T025, T027).
- Sync all gets the same bar, clock and poll (T006, T026).

### 4.2 The live report

The engine is pure (`lib/manager-pulse/engine.ts computeFootprint`) and the
loader takes a list of league-seasons (`lib/manager-pulse/load.ts
loadManagerPulseInput`). A report over the finished league-seasons so far is the
same code over a shorter list, and `selectLeagueSeasons` already orders newest
season first. The section components in `components/manager-pulse/` carry no
server-only imports (checked 2026-09-05: only `capture-progress.tsx`,
`use-capture-progress.ts`, and the three manager-shell navigation files carry
`"use client"`, and none of the sections import `next/headers`, `server-only`
or `@/lib/supabase`), so they render on the client from JSON.

1. The drainer finishes a league, recounts the run, and if the SUBJECT has
   crossed a checkpoint computes a live report over the league-seasons that
   are `done` or `fresh` and writes it to `manager_pulse_live_reports`
   (T040, T041). Checkpoints: the first three finished, then every five
   more or every 20 seconds, whichever is later.
2. The progress poll carries `partialVersion`. When it rises the client
   fetches `GET /api/manager-pulse/runs/[run_id]/report` (T042).
3. `LiveManagerReport` renders masthead, rail and the eight sections from that
   JSON above a coverage banner (T043, T044).
4. On `complete` the same route returns the final report from
   `manager_pulse_cache` and the client swaps it in. No skeleton, no refresh.

Rules: every live figure carries its coverage in words above the fold; nothing
from a live report is written to `manager_pulse_cache` or
`manager_pulse_tendencies`; the narrative may change at checkpoints only; the
live region names the coverage, never the contents; a failed checkpoint write
leaves the previous live report in place.

### 4.3 One drainer, a call budget, concurrency, fairness

- A lease row makes exactly one worker pass the drainer at a time. A pass runs
  up to `sync.passBudgetSeconds`, renews the lease, and wakes the next pass
  itself when work remains. The cron tick exits when the lease is held (T031,
  T034, T039).
- A process-wide token bucket in front of `safeFetch`, `sync.sleeperCallsPerMinute`
  tokens (default 600), with 429/503 handling (T032, T033). With one drainer the
  in-process bucket IS the global bucket for queue traffic. A second drainer is
  the moment the bucket moves to the database, and `acquireSleeperToken` is the
  seam.
- `sync.jobConcurrency` (3) leagues at once through `mapLimit`, claimed
  `sync.jobsPerClaim` (12) at a time, no fixed pause (T034).
- `claim_league_sync_jobs` interleaves owners (T030).

### 4.4 Raising the cap

| Setting | Today | Proposed |
| --- | --- | --- |
| `capture.maxLeaguesPerRun` | 60 | 250 |
| `capture.maxLeaguesPerSeason` | 40 | 60 |
| `capture.seasonWindowDefault` | 4 | 4 |

Both proposed values are inside `MANAGER_PULSE_SETTING_BOUNDS` (500, 200).
Affordable only together with the live report, the drainer, the 14-day rule
and settled-forever. The cooldown moves to a league-season budget at the same
time (F17), or one large history locks a reader out for an hour.

### 4.5 Fewer calls per league-season

Settled seasons captured once, ever (3.2). Freshness means completeness (F8).
The transaction walk stops at `last_scored_leg + 1` (T037). Draft selections
one call per completed draft, once. Optionally, after everything else is
measured, the GraphQL core bundle (T038) replaces six REST calls with one:
the research found the league, rosters, traded picks, draft list and both
brackets open on Sleeper's GraphQL host without a login, and found every
transactions query closed and the matchup query missing per-player points,
so those two, which are most of the cost, stay on REST.

### 4.6 What the join looks like to a reader

Reader B, looking up a handle A started two minutes ago, sees B's own progress
panel with A's counts (31 of 87 read), B's own clock from B's own request time,
the same live report A is watching, and B's run closes the moment A's does.
B's hourly budget is untouched.

### 4.7 Things worth adding that nobody asked for

An admin Queue page (T048). "Email me when it is done" through `lib/email/`
(not scheduled). Supabase Realtime on `manager_pulse_runs` and
`league_sync_jobs` (not scheduled; the 2 s poll is cheap). Per-job telemetry
(T031, T034, T049).

### 4.8 What it should look like afterwards

Estimates from the arithmetic in Part 5, including the larger capture set of
3.3. Phase 5 replaces them with measurements before anyone repeats them.

Per cold SETTLED league-season under the full capture set: core about 6,
transactions about 19 (capped), brackets 2, draft picks 1, matchups about 18,
so about 46 calls and about 12 seconds of wall clock. Three at once is about 15
league-seasons a minute; at 600 calls a minute the bucket binds first at about
13 a minute. A current-season league on a repeat capture is about 12 calls.

| Situation | Today | After |
| --- | --- | --- |
| Time before the first league moves | 0 to 60 s | under 5 s |
| First live report, 100 cold league-seasons | never; final at 17 to 25 min | about 40 s |
| Final report, 60 cold, empty queue | 10 to 15 min | about 5 min |
| Final report, 100 cold, empty queue | not allowed | about 8 min |
| Final report, 250 cold, empty queue | not allowed | about 19 min, live report throughout |
| Repeat lookup, or a manager sharing captured leagues | 60 jobs every hour | only stale current-season leagues, under a minute |
| Second reader on a handle mid-capture | a second full queue | joins the first, queues nothing |
| Sleeper calls per minute, worst case | about 200, emergent | 600, chosen, editable |
| A small lookup behind a big one | waits for the whole big one | interleaved |

---

## Part 5. Implementation specification

Conventions for the whole part:

- One task is one file or one migration. Verification sub-agents run per task
  as `CLAUDE.md` requires. Every migration ships its RLS and grants in the same
  file, is applied through the Supabase MCP, and is followed by a types
  regeneration into `lib/database.types.ts` (prettier-formatted) before any
  TypeScript task that reads the new columns.
- No em dash, no en dash, no curly quote, no ellipsis character, no emoji, in
  code, comments, copy or SQL.
- Every timestamp shown to a person goes through `lib/datetime.ts
  formatEastern`.
- `after` is imported from `next/server` (already used in
  `app/api/leagues/bulk-sync/route.ts`, `app/api/leagues/[league_id]/warm/route.ts`,
  `app/api/beam/learn/route.ts`).
- The service-role client is `createAdminClient()` from `lib/supabase/server`.

### Phase -1: the baseline, measured before anything changes

The owner's question at the end is "how much time did we actually save". That
has one honest answer only if the same lookups are timed on the code as it is
today, before Phase 0 lands, and then again after each phase. Part 9 is the
protocol and the tables; these two tasks are the tooling and the first run.

#### MPS-T053 | scripts/measure-manager-pulse.ts (new)

A tsx script, run as `npm run measure:manager-pulse -- --handle <h> [--handle <h2> ...] [--label <text>] [--cold]`,
using `scripts/_supabase.ts getServiceClient()` and the site's own routes,
never the engine directly, so it measures what a reader experiences:

1. Signs in as the measuring admin through the same session cookie mechanism
   the other scripts that hit authenticated routes use (if none exists, the
   script accepts `--cookie <value>` copied from a browser session and stores
   nothing). `adminBypassThrottle` must be on so repeated runs are not
   throttled; the script asserts it by reading `manager_pulse_settings`.
2. With `--cold`: for every league-season the handle resolves to (discovered
   through `discoverLeagueSeasons` with the current settings), sets
   `leagues.last_pulsed_at = null`, `capture_completed_at = null` and
   `pulse_status = 'pending'` (after Phase 1; before it, `last_pulsed_at` only),
   deletes `manager_pulse_cache` and `manager_pulse_live_reports` rows for the
   subject, and deletes the measuring user's `manager_pulse_runs` rows for the
   subject. This is the ONLY place in the codebase allowed to null those
   stamps, it refuses to run against a league whose `sleeper_league_id` is in
   `league_relay` (a relayed league is somebody's live room), and it prints
   what it reset before continuing.
3. Records `t0`, then requests `GET /tools/manager-pulse/<handle>` and
   records the response time as `t_page`.
4. Polls `GET /api/manager-pulse/runs/<run_id>` every second (the run id from
   `manager_pulse_runs` for the subject, newest), recording:
   `t_first_league` (first poll where `leaguesDone` rises above the free
   count at enqueue), `t_first_live` (first poll where `partialVersion > 0`,
   after Phase 3), `t_computing`, `t_complete`, and every poll's counts.
5. Reads, after completion: `manager_pulse_run_leagues` counts by status for
   the run; the sum of `league_sync_jobs.sleeper_calls` and the max and p95 of
   `duration_ms` for the run's jobs (after Phase 3, both null before it);
   Sleeper calls per minute during the run, as that sum divided by the
   capture duration in minutes.
6. Prints one JSON line and one human table per handle, and appends the JSON
   line to `docs/manager-pulse/measurements.jsonl` with the `--label`, the git
   commit, the date, and the settings values in force (`sync` group and the
   capture caps).

Test: `scripts/measure-manager-pulse.test.ts` covers the poll-transition
detection over a recorded sequence of progress responses.

#### MPS-T054 | the baseline run

Before MPS-T000. Three handles, chosen once and kept for every later run,
recorded in Part 9.1: SMALL (about 10 to 15 league-seasons in the window),
MEDIUM (about 50 to 60, the current cap), LARGE (150 or more; on the current
code this one is capped at 60 and the script records that). Each run twice
with `--cold` and once warm, on an empty queue (the Queue page after Phase 4,
or a `select count(*) from league_sync_jobs where status in ('pending','processing')`
returning zero before it). Record the table in Part 9.2 under "Baseline".

### Phase 0: bugs that need no schema

#### MPS-T000 | docs path references

Every `docs/<name>.md` reference in code comments, `CLAUDE.md`, `plan.md`,
`progress.md` and `handoff.md` is rewritten to the path in `docs/README.md`.
Mechanical; one commit. Verify with
`grep -rn "docs/manager-pulse-plan.md" --include=*.ts --include=*.tsx --include=*.md .`
returning nothing outside `docs/README.md`.

#### MPS-T001 | lib/manager-pulse/service.ts: one season rollover rule

Delete the private `currentSeason()` function (near the bottom of the file,
below `resolveWindow`). Add `currentNflSeason` to the existing import from
`@/lib/sleeper` (there is no such import today; add
`import { currentNflSeason } from "@/lib/sleeper";`). In `resolveWindow`,
replace `const seasonTo = currentSeason();` with
`const seasonTo = Number(currentNflSeason());`.

Test: `lib/manager-pulse/service.test.ts` (new) mocks `@/lib/sleeper`
`currentNflSeason` to `"2026"` the way `capture.test.ts` does and asserts
`resolveWindow`'s output via a warm-cache call whose key is `season_to = 2026`.
Also add to `lib/manager-pulse/purity.test.ts`'s allowed-import assertions if
it lists service.ts imports.

#### MPS-T002 | lib/manager-pulse/service.ts: close the run on a thrown compute

In `getManagerFootprint`, hoist `let openRunId: string | null = null;` above the
`try`. After `capture` resolves with `runId`, set `openRunId = capture.runId`.
In the `catch`, before returning the error result:

```ts
if (openRunId) {
  await closeRun(admin, openRunId, "error", "The report could not be built.");
}
```

`closeRun` already never throws. Test: service.test.ts, a compute that throws
(mock `computeFootprint` to throw) leaves the run row updated with
`status = 'error'`.

(This task is superseded in Phase 3 when compute leaves the render path, but
it is a one-line fix worth shipping first.)

#### MPS-T003 | lib/manager-pulse/capture.ts: wake the worker after queueing

At the end of `startManagerCapture`, after `readCaptureProgress` succeeds and
before the return, when `enqueueResult.data` reports `queued > 0` OR the run
status is `computing` (a free run still needs finalizing once Phase 3 lands):

```ts
import { after } from "next/server";
import { wakeLeagueSyncWorker } from "@/lib/league-sync-wake";
// ...
const enqueue = (enqueueResult.data ?? {}) as { queued?: number };
if ((enqueue.queued ?? 0) > 0 || progress.status === "computing") {
  after(async () => {
    await wakeLeagueSyncWorker("manager-pulse-enqueue");
  });
}
```

`lib/league-sync-wake.ts` is new in this task:

```ts
import "server-only";

/**
 * Ask the drainer to start a pass now rather than at the next cron tick.
 *
 * A POST to the worker route with the cron secret. The route acquires the
 * lease and schedules its own pass in after(), so this returns in a few
 * hundred milliseconds whether or not a pass started. Never throws: a wake
 * that fails costs at most one minute, which is what the cron tick is for.
 */
export async function wakeLeagueSyncWorker(reason: string): Promise<void> {
  const base = process.env.NEXT_PUBLIC_SITE_URL;
  const secret = process.env.CRON_SECRET;
  if (!base || !secret) return;
  try {
    await fetch(`${base}/api/cron/league-sync-worker`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}`, "x-wake-reason": reason },
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
  } catch (err) {
    console.warn("[league-sync-wake] wake failed:", err instanceof Error ? err.message : err);
  }
}
```

Until MPS-T039 adds the POST handler, the POST returns 405 and the wake is a
harmless no-op; land T039 in the same session. `x-wake-reason` is logged by the
route and never trusted for anything.

Test: `capture.test.ts`, mock `next/server` `after` to invoke its callback
synchronously and `@/lib/league-sync-wake` `wakeLeagueSyncWorker` as a spy;
assert it is called once when the enqueue RPC reports `queued: 2` and not
called when it reports `queued: 0` with status `capturing` (linked only).

#### MPS-T004 | app/tools/manager-pulse/[handle]/page.tsx: room for after()

Add `export const maxDuration = 60;` beside `export const dynamic`. The wake
call is bounded at five seconds; sixty is headroom, not a budget.

#### MPS-T005 | components/manager-pulse/use-capture-progress.ts: steady poll

Replace the four constants and the backoff:

```ts
const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_FAILURE_BACKOFF_MS = 8000;
const DEFAULT_MAX_CONSECUTIVE_FAILURES = 6;

export type CaptureProgressPollingOptions = {
  pollIntervalMs?: number;
  failureBackoffMs?: number;
  maxConsecutiveFailures?: number;
};
```

`scheduleNext(delay)` takes the delay explicitly: `pollIntervalMs` after a
successful poll, `failureBackoffMs` after a failed one. Remove
`backoffFactor`, `startDelayMs`, `maxDelayMs`. `TERMINAL_STATUSES` becomes
`new Set(["complete", "error", "throttled"])`: "computing" is no longer
terminal, because Phase 3 makes the drainer finish it and the poll must see it
through. Until Phase 3 lands, `capture-progress.tsx`'s existing
`router.refresh()` on "computing" still fires once (it is keyed on the status
value, not on the poll stopping), so behaviour in the interim is unchanged.

Test: `components/manager-pulse/use-capture-progress.test.ts` (new, vitest with
fake timers): a successful poll schedules the next at 2000 ms; a failed poll at
8000 ms; six failures set `unavailable`; "computing" keeps polling.

#### MPS-T006 | components/league-sync-all.tsx: same poll

`POLL_MS` becomes a prop `pollIntervalMs` with default 2000, passed by
`app/my-beacon/sleeper-leagues/page.tsx` from
`loadManagerPulseSettings(admin).sync.pollIntervalMs` once T028 lands; until
then the default applies.

#### MPS-T007 | lib/sleeper.ts: null-on-failure variants

Add, beside the existing functions and matching `getSleeperDraftPicksOrNull`:

```ts
/** Null when the REQUEST failed; [] when Sleeper answered with no leagues. */
export async function getSleeperLeaguesOrNull(
  userId: string,
  season: string,
): Promise<SleeperLeague[] | null> {
  return safeFetch<SleeperLeague[]>(`${BASE}/user/${encodeURIComponent(userId)}/leagues/nfl/${season}`);
}

/** Null when the REQUEST failed; [] when Sleeper answered with no transactions. */
export async function getSleeperWeekTransactionsOrNull(
  leagueId: string,
  week: number,
): Promise<SleeperTransaction[] | null> {
  return safeFetch<SleeperTransaction[]>(
    `${BASE}/league/${encodeURIComponent(leagueId)}/transactions/${Math.trunc(week)}`,
  );
}
```

Leave the array-returning originals in place for their other callers.

#### MPS-T008 | lib/manager-pulse/discover.ts: incomplete discovery is an error

`discoverLeagueSeasons` calls `getSleeperLeaguesOrNull`. Its return type gains
`failedSeasons: number[]`. A season whose result is null is pushed there and
contributes no leagues. `startManagerCapture` in `capture.ts`:

```ts
if (failedSeasons.length > 0) {
  return { status: "error", detail: `Sleeper did not answer for ${failedSeasons.join(", ")}` };
}
```

placed BEFORE the `leagueSeasons.length === 0` check and BEFORE the claim, so
no run row is written and no cooldown is spent. `service.ts` already maps
`capture.status === "error"` to the Error state, whose copy ("Something went
wrong while reading Sleeper. Try again") is right for this.

Test: `discover.test.ts`, one season null and three arrays returns the three
seasons' leagues plus `failedSeasons: [2024]`; `capture.test.ts`, a failed
season returns `{ status: "error" }` and the `try_claim_manager_pulse` RPC is
never called.

#### MPS-T009 | lib/sleeper.ts: a failed week fails the walk

`getAllSleeperTransactions` calls `getSleeperWeekTransactionsOrNull`. When any
week in a batch returns null, throw
`new Error(\`Sleeper did not answer for week ${week} of league ${leagueId}\`)`.
`syncTransactions` in `lib/league-pulse.ts` already runs inside a try/catch on
both callers (`pulseLeagueDerived` line 464, `pulseLeagueFootprint` line 626),
which log and continue; that is correct for the deep view (a page must render)
and WRONG for a footprint job, which must fail so the worker retries it. So in
`pulseLeagueFootprint` the catch around `syncTransactions` is removed and the
error propagates to `syncOneLeague`, whose own catch turns it into
`failOrRetry`. `captureLeagueBrackets` keeps its catch (a null bracket is
already skipped, not written).

Test: `lib/sleeper.test.ts` (exists? if not, create
`lib/sleeper-transactions.test.ts`) with a mocked `safeFetch` path: a null week
throws; `lib/league-footprint-sync.test.ts` asserts a footprint returns
`ok: false` when the transaction walk throws.

#### MPS-T010 | lib/league-pulse.ts: draft selections in the footprint

Interim fix before the capture set (T013) lands, so the Drafting section
starts filling on the next deploy: inside `pulseLeagueFootprint`'s coalesced
block, after `captureLeagueBrackets`, add

```ts
try {
  await captureLeagueDraftSelections(supabase, core.leagueRowId);
} catch (err) {
  console.warn(`[pulseLeagueFootprint] draft-pick capture failed for league ${core.leagueRowId}:`, (err as Error).message);
}
```

gated by the same `if (force || resynced)`. T013 replaces this block.

#### MPS-T011 | app/tools/manager-pulse/[handle]/page.tsx: stale note copy

Line 195 to 198. Replace the sentence with:
`Showing the report generated {formatEastern(result.generatedAt)}. A fresh
capture will be possible once your hourly budget refills.` The retry time is
not known on this branch (the throttled outcome's `retryAfterSeconds` was
consumed by the stale-report branch in `service.ts`); T047 threads it through.

#### MPS-T012 | one section order

`components/manager-pulse/capture-progress.tsx`: delete `SECTION_ORDER` and
derive it: `const SECTION_ORDER = MANAGER_NAV_ITEMS.map((item) => item.id);`
importing `MANAGER_NAV_ITEMS` from `@/components/manager-shell/nav-items`
(a plain module, no directive). `app/admin/manager-pulse/runs/page.tsx`: same
replacement for its `SECTION_ORDER`, and `SECTION_LABEL` becomes
`Object.fromEntries(MANAGER_NAV_ITEMS.map((i) => [i.id, i.label]))`.

### Phase 1: the capture set and the schema it needs

#### MPS-T013 | migration 0261_leagues_capture_completed.sql

```sql
-- Migration 0261: leagues.capture_completed_at, the capture-set stamp
--
-- One league sync, whoever starts it, captures the same raw set: transactions,
-- both playoff brackets, completed-draft selections, and the matchup slate.
-- This column is stamped by lib/league-pulse.ts captureLeagueRawData ONLY when
-- every applicable stage of that set succeeded, so a reader of this column
-- (Manager Pulse's freshness rule in lib/manager-pulse/capture.ts) can trust
-- that the league holds everything without counting rows in four tables.
--
-- last_pulsed_at keeps its meaning (the core league/roster/member sync) and its
-- 60-minute TTL. This column is the SECOND stamp, for the tail.
--
-- Access matrix: unchanged from the leagues table (public select, service-role
-- writes). No new policy.
--
-- Rollback note:
--   alter table public.leagues drop column if exists capture_completed_at;
--   alter table public.leagues drop column if exists capture_error;

alter table public.leagues
  add column if not exists capture_completed_at timestamptz,
  add column if not exists capture_error text;

comment on column public.leagues.capture_completed_at is
  'Stamped by captureLeagueRawData when transactions, brackets, draft selections and (on the footprint path) matchups all succeeded. Null means the capture set is incomplete. Manager Pulse freshness reads this, never last_pulsed_at.';
comment on column public.leagues.capture_error is
  'Server-written reason the last capture set did not complete. Rendered as text only, never as HTML.';

-- Manager Pulse's enqueue read: many sleeper_league_ids at once, three columns.
create index if not exists leagues_capture_state_idx
  on public.leagues (sleeper_league_id, capture_completed_at, status, season);
```

Apply, verify with the RLS sequence (no policy change; confirm anon select
still works and anon update is blocked), regenerate types (T014).

#### MPS-T014 | regenerate lib/database.types.ts

Per the MCP workflow memory: extract `.types` from the MCP response, write the
file, prettier-format.

#### MPS-T015 | lib/league-pulse.ts: captureLeagueRawData

Add after `pulseLeagueDerived` and before `pulseLeagueFootprint`:

```ts
export type CaptureRawOptions = {
  force: boolean;
  /**
   * Whether this call syncs the matchup slate. The derived half passes false
   * because refreshPowerPulse syncs the slate itself with the failed-week
   * semantics Power Pulse needs and running it twice in one pass would refetch
   * the volatile window twice. The footprint path passes true: nothing else on
   * that path touches the slate.
   */
  includeMatchups: boolean;
};

export type CaptureRawResult = {
  transactions: "ok" | "failed";
  brackets: "ok" | "failed" | "not_applicable";
  draftSelections: "ok" | "failed";
  matchups: "ok" | "failed" | "skipped";
  complete: boolean;
};

/**
 * THE CAPTURE SET. Everything a league sync writes beyond the core rows,
 * whoever asked for the sync. lib/league-capture-set.test.ts asserts that
 * pulseLeagueDerived and pulseLeagueFootprint both call this and that nothing
 * else calls the stage functions directly.
 *
 * Stamps leagues.capture_completed_at only when every applicable stage
 * succeeded, and writes capture_error otherwise. Never throws; a stage failure
 * is a value in the result, and the FOOTPRINT caller turns an incomplete
 * result into a failed job so the worker retries it.
 */
export async function captureLeagueRawData(
  supabase: ServiceClient,
  league: { leagueRowId: string; sleeperLeagueId: string; season: number },
  options: CaptureRawOptions,
): Promise<CaptureRawResult> {
  const { leagueRowId, sleeperLeagueId, season } = league;
  const result: CaptureRawResult = {
    transactions: "failed",
    brackets: "not_applicable",
    draftSelections: "failed",
    matchups: "skipped",
    complete: false,
  };

  // One read for everything the stages need to decide applicability.
  const { data: row } = await supabase
    .from("leagues")
    .select("status, leg:metadata->settings->leg, playoff_week_start:metadata->settings->playoff_week_start")
    .eq("id", leagueRowId)
    .maybeSingle();
  const status = row?.status ?? null;
  const leg = Number(row?.leg);
  const playoffWeekStart = Number(row?.playoff_week_start);
  const seasonComplete = status === "complete" || season < Number(currentNflSeason());
  const playoffsStarted =
    seasonComplete ||
    (Number.isFinite(leg) && Number.isFinite(playoffWeekStart) && leg >= playoffWeekStart);

  try {
    await syncTransactions(supabase, leagueRowId, sleeperLeagueId, season, options.force);
    result.transactions = "ok";
  } catch (err) {
    console.warn(`[captureLeagueRawData] transactions failed for ${leagueRowId}:`, (err as Error).message);
  }

  if (playoffsStarted) {
    const bracketsOk = await captureLeagueBrackets(supabase, leagueRowId, sleeperLeagueId);
    result.brackets = bracketsOk ? "ok" : "failed";
  }

  try {
    await captureLeagueDraftSelections(supabase, leagueRowId);
    result.draftSelections = "ok";
  } catch (err) {
    console.warn(`[captureLeagueRawData] draft selections failed for ${leagueRowId}:`, (err as Error).message);
  }

  if (options.includeMatchups) {
    const nflState = await getNflState();
    const currentWeek = resolveCurrentWeek(
      nflState,
      season,
      Number.isFinite(playoffWeekStart) ? playoffWeekStart : 15,
    );
    const sync = await syncLeagueMatchups(supabase, leagueRowId, sleeperLeagueId, season, currentWeek, {
      force: options.force,
    });
    result.matchups = sync.ok && sync.failedWeeks.length === 0 ? "ok" : "failed";
  }

  result.complete =
    result.transactions === "ok" &&
    result.brackets !== "failed" &&
    result.draftSelections === "ok" &&
    result.matchups !== "failed";

  const now = new Date().toISOString();
  await supabase
    .from("leagues")
    .update(
      result.complete
        ? { capture_completed_at: now, capture_error: null, updated_at: now }
        : {
            capture_error: `incomplete: ${Object.entries(result)
              .filter(([k, v]) => k !== "complete" && v === "failed")
              .map(([k]) => k)
              .join(", ")}`,
            updated_at: now,
          },
    )
    .eq("id", leagueRowId);

  return result;
}
```

`captureLeagueBrackets` changes its return type from `Promise<void>` to
`Promise<boolean>`: true when at least one bracket was written or both were
already present, false when both fetches returned null. `captureLeagueDraftSelections`
already never throws; treat a result with `draftsConsidered > draftsCaptured`
AND a null fetch as failure by making it return `fetchFailures: number` (add the
field to `CaptureDraftSelectionsResult` in `lib/league-draft-selections.ts`,
incremented in the `picks === null` branch) and set `result.draftSelections =
captured.fetchFailures > 0 ? "failed" : "ok"`.

Imports to add at the top of `lib/league-pulse.ts`: `currentNflSeason`,
`getNflState` from `@/lib/sleeper`; `resolveCurrentWeek`, `syncLeagueMatchups`
from `@/lib/league-matchups`. Check `lib/league-matchups.ts` does not import
`lib/league-pulse.ts` (it does not today; it imports only `@/lib/sleeper` and
the types), so no cycle.

#### MPS-T016 | lib/league-pulse.ts: both halves call the capture set

In `pulseLeagueDerived`, inside the `Promise.all`, the first member's
`syncTransactions` call and the last member's `captureLeagueDraftSelections`
block are replaced by one member:

```ts
(async () => {
  if (force || resynced) {
    await timed("capture-set", () =>
      captureLeagueRawData(
        supabase,
        { leagueRowId, sleeperLeagueId: league.sleeper_league_id, season },
        { force, includeMatchups: false },
      ),
    );
  }
  // projectLeagueActivity stays here, sequential after the capture, for the
  // reason the existing comment gives.
  try { ... projectLeagueActivity ... } catch { ... }
})(),
```

In `pulseLeagueFootprint`, the coalesced block becomes:

```ts
const raw = await coalesce(`footprint-derived:${core.leagueRowId}:${force}`, async () => {
  if (!(force || resynced)) return null;
  return captureLeagueRawData(
    supabase,
    { leagueRowId: core.leagueRowId, sleeperLeagueId, season: core.season },
    { force, includeMatchups: true },
  );
});
if (raw && !raw.complete) {
  return { ok: false, error: "capture set incomplete", sleeperLeagueId };
}
```

followed by the existing transaction count read. `pulseLeagueFootprint`'s
return type is unchanged; an incomplete set is an `ok: false` so the worker's
`failOrRetry` retries it.

Delete the T010 interim block.

Test: `lib/league-capture-set.test.ts` (new): reads the SOURCE of
`lib/league-pulse.ts` and asserts (a) `captureLeagueRawData(` appears inside
both `pulseLeagueDerived` and `pulseLeagueFootprint`, (b) `syncTransactions(`,
`captureLeagueBrackets(` and `captureLeagueDraftSelections(` each appear
exactly once outside their own definitions, inside `captureLeagueRawData`.
Same source-scanning style as `lib/positional-war/naming.test.ts`.
`lib/league-footprint-sync.test.ts` gains: an incomplete set returns
`ok: false`; a cached core skips the set entirely.

#### MPS-T017 | performance guard for the deep view

`app/leagues/[league_id]/page.tsx` and the other league pages are untouched.
Verify by timing: with a league already in its playoffs, one deep-view resync
logs `capture-set=` in the derived timings line and the total derived time is
within two bracket calls of before. Record the two numbers in `progress.md`.

### Phase 2: the panel

#### MPS-T018 | migration 0262_manager_pulse_live_reports.sql

```sql
-- Migration 0262: manager_pulse_live_reports (the report while it is still filling in)
--
-- Keyed by SUBJECT (the manager being looked up) and window, not by run. Two
-- readers who look up the same handle two minutes apart share one live
-- document and it is computed once per checkpoint, which is the whole point of
-- letting a second reader JOIN a capture rather than start one.
--
-- Never promoted to manager_pulse_cache: the final report is written by
-- finalizeManagerPulseRun from the full run, and manager_pulse_tendencies is
-- written only there. Nothing downstream may read a partial opinion.
--
-- Access matrix
--   anon          : none
--   authenticated : none (the report route reads it with the service role after
--                   checking the run belongs to the caller)
--   service_role  : ALL
--
-- Rollback note:
--   drop table if exists public.manager_pulse_live_reports;

create table if not exists public.manager_pulse_live_reports (
  sleeper_user_id text not null,
  season_from int not null,
  season_to int not null,
  model_version text not null,
  report jsonb not null,
  coverage int not null default 0,
  coverage_total int not null default 0,
  version int not null default 0,
  computed_at timestamptz not null default now(),
  primary key (sleeper_user_id, season_from, season_to, model_version),
  constraint manager_pulse_live_reports_coverage_sane
    check (coverage >= 0 and coverage_total >= coverage)
);

comment on table public.manager_pulse_live_reports is
  'The Manager Pulse report computed over the league-seasons finished so far, one row per subject and window, overwritten at each checkpoint. Service-role only. Never the source of manager_pulse_cache or manager_pulse_tendencies.';

alter table public.manager_pulse_live_reports enable row level security;

drop policy if exists manager_pulse_live_reports_service_role_all
  on public.manager_pulse_live_reports;
create policy manager_pulse_live_reports_service_role_all
  on public.manager_pulse_live_reports
  for all to service_role using (true) with check (true);

revoke all on table public.manager_pulse_live_reports from anon, authenticated;

-- The checkpoint ledger lives on the run, since checkpoints are counted per run
-- and the version is read per subject.
alter table public.manager_pulse_runs
  add column if not exists live_checkpoint_done int not null default 0,
  add column if not exists live_checkpoint_at timestamptz;

comment on column public.manager_pulse_runs.live_checkpoint_done is
  'leagues_done at the last live-report checkpoint this run triggered.';
```

Regenerate types.

#### MPS-T019 | lib/manager-pulse/types.ts: the progress shape

Replace `CaptureProgress`:

```ts
export type CaptureProgress = {
  runId: string;
  status: "pending" | "capturing" | "computing" | "complete" | "error" | "throttled";
  /** ISO, from manager_pulse_runs.requested_at. The clock's anchor. */
  requestedAt: string;
  leaguesTotal: number;
  leaguesDone: number;
  leaguesFailed: number;
  /** Linked jobs currently 'processing'. */
  leaguesProcessing: number;
  /** Pending jobs created before this run's oldest pending job, not belonging to it. */
  queueAhead: number;
  /** ISO of the newest updated_at across this run's jobs; null when it has none. */
  workerSeenAt: string | null;
  /** manager_pulse_live_reports.version for this run's subject; 0 when none. */
  partialVersion: number;
  detail: string | null;
};
```

`sectionStatus` and `SectionStatus` are removed from the type. `PartialReport`
and the `partial` field on the `building` result are removed; the `building`
result becomes `{ status: "building"; progress: CaptureProgress }`. Remove
`sections` from `GetManagerFootprintRequest`.

#### MPS-T020 | lib/manager-pulse/capture.ts: readCaptureProgress returns the new fields

Rewrite `readCaptureProgress`:

```ts
export async function readCaptureProgress(
  admin: SupabaseClient<Database>,
  runId: string,
): Promise<CaptureProgress | null> {
  try {
    await reconcileFinishedJobs(admin, runId);

    const { data: run, error: runError } = await admin
      .from("manager_pulse_runs")
      .select("id, status, requested_at, sleeper_user_id, season_from, season_to, leagues_total, leagues_done, leagues_failed, detail")
      .eq("id", runId)
      .maybeSingle();
    if (runError || !run) return null;

    const { data: leagueRows } = await admin
      .from("manager_pulse_run_leagues")
      .select("status, job_id")
      .eq("run_id", runId);

    let leaguesDone = run.leagues_done;
    let leaguesFailed = run.leagues_failed;
    const jobIds: string[] = [];
    if (leagueRows) {
      leaguesDone = 0;
      leaguesFailed = 0;
      for (const row of leagueRows) {
        if (row.status === "fresh" || row.status === "done") leaguesDone += 1;
        else if (row.status === "failed") leaguesFailed += 1;
        if ((row.status === "queued" || row.status === "pending") && row.job_id) jobIds.push(row.job_id);
      }
    }

    let leaguesProcessing = 0;
    let queueAhead = 0;
    let workerSeenAt: string | null = null;
    if (jobIds.length > 0) {
      const { data: jobs } = await admin
        .from("league_sync_jobs")
        .select("status, updated_at, created_at")
        .in("id", jobIds.slice(0, 200));
      let oldestPending: string | null = null;
      for (const job of jobs ?? []) {
        if (job.status === "processing") leaguesProcessing += 1;
        if (!workerSeenAt || job.updated_at > workerSeenAt) workerSeenAt = job.updated_at;
        if (job.status === "pending" && (!oldestPending || job.created_at < oldestPending)) {
          oldestPending = job.created_at;
        }
      }
      if (oldestPending) {
        const { count } = await admin
          .from("league_sync_jobs")
          .select("id", { count: "exact", head: true })
          .eq("status", "pending")
          .lt("created_at", oldestPending)
          .not("id", "in", `(${jobIds.join(",")})`);
        queueAhead = count ?? 0;
      }
    }

    const { data: live } = await admin
      .from("manager_pulse_live_reports")
      .select("version")
      .eq("sleeper_user_id", run.sleeper_user_id)
      .eq("season_from", run.season_from)
      .eq("season_to", run.season_to)
      .eq("model_version", (await loadManagerPulseSettings(admin)).modelVersion)
      .maybeSingle();

    return {
      runId: run.id,
      status: run.status as CaptureProgress["status"],
      requestedAt: run.requested_at,
      leaguesTotal: run.leagues_total,
      leaguesDone,
      leaguesFailed,
      leaguesProcessing,
      queueAhead,
      workerSeenAt,
      partialVersion: live?.version ?? 0,
      detail: run.detail,
    };
  } catch {
    return null;
  }
}
```

`jobIds.slice(0, 200)` matches the 200-id chunk rule; a run linking more than
200 open jobs reports processing counts over its first 200, which is a display
figure. Pass `settings` in from callers that have it to avoid the settings read
(add an optional third parameter `settings?: ManagerPulseSettings`).

Test: `capture.test.ts` extends the fake admin with `league_sync_jobs` and
`manager_pulse_live_reports` handlers and asserts the five new fields.

#### MPS-T021 | app/api/manager-pulse/runs/[run_id]/route.ts: the response

The ownership read selects `id, user_id` and the progress read follows; keep
both (the ownership check must not be folded into a function that reconciles
rows). The JSON body returns every field of `CaptureProgress` except `runId`.
`isRunProgressResponse` in `use-capture-progress.ts` is updated to check
`requestedAt` (string), `leaguesProcessing`, `queueAhead`, `partialVersion`
(numbers), `workerSeenAt` (string or null), and no longer checks
`sectionStatus`.

#### MPS-T022 | lib/manager-pulse/progress-estimate.ts (new, pure)

```ts
/** m:ss, or h:mm:ss past an hour. Never negative. */
export function formatElapsed(ms: number): string;

/**
 * "about N minutes left", or null when there is not enough evidence.
 *
 * Null until `done >= minDone` and `elapsedMs >= minElapsedMs`, and null when
 * `remaining <= 0`. Rate is done / elapsed; the estimate is remaining / rate,
 * rounded UP to whole minutes, and "about a minute left" below 90 seconds.
 * Stated as an estimate in the text itself, because it is one.
 */
export function estimateRemaining(input: {
  done: number;
  total: number;
  elapsedMs: number;
  minDone?: number;       // default 3
  minElapsedMs?: number;  // default 30_000
}): string | null;
```

Test: `lib/manager-pulse/progress-estimate.test.ts`: formatting at 0, 59 s,
61 s, 1 h; estimate null below thresholds; 30 of 90 done in 60 s gives "about
2 minutes left"; 89 of 90 gives "about a minute left". Add the file to
`purity.test.ts`'s scanned set (it imports nothing).

#### MPS-T023 | components/manager-pulse/elapsed-clock.tsx (new, "use client")

Props: `{ requestedAt: string; running: boolean; id?: string }`. Renders
`<time id={id} dateTime={\`PT${seconds}S\`}>{formatElapsed(ms)}</time>` with a
`setInterval` of 1000 ms while `running`, cleared on unmount, computing `ms =
Date.now() - Date.parse(requestedAt)`. No `aria-live`. No `role`. The label
"elapsed" is a sibling `<span>` with `aria-hidden="false"`, so a screen reader
navigating to the clock hears "2:14 elapsed".

#### MPS-T024 | components/manager-pulse/progress-bar.tsx: segment and band

`ProgressBar` gains `processing: number` (default 0). `progressState` gains a
fourth argument `processing` and, on the determinate branch, returns
`processingFraction: Math.min(1 - fraction, Math.max(0, processing) / total)`
and text `"31 of 87 leagues read, 3 in progress"` when processing is above
zero (and ", 2 failed" as today). Render, on the determinate branch only:

```tsx
<div className="h-full rounded-full bg-beacon transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${state.fraction * 100}%` }} />
<div aria-hidden="true" className="absolute inset-y-0 mp-processing" style={{ left: `${state.fraction * 100}%`, width: `${state.processingFraction * 100}%` }} />
<div aria-hidden="true" className={`absolute inset-y-0 left-0 mp-current ${waiting ? "mp-current-waiting" : ""}`} style={{ width: `${state.fraction * 100}%` }} />
```

The outer element becomes `relative`. `waiting: boolean` is a new prop. The
indeterminate branch is unchanged and never renders the band.

`app/globals.css` gains, in the components layer:

```css
@keyframes mp-current { from { background-position: 120% 0; } to { background-position: -120% 0; } }
.mp-processing {
  background-image: repeating-linear-gradient(135deg, rgb(168 85 247 / 0.28) 0 6px, rgb(34 211 238 / 0.22) 6px 12px);
}
.mp-current {
  background-image: linear-gradient(90deg, transparent 35%, rgb(255 255 255 / 0) 42%, rgb(255 255 255 / 0.85) 50%, rgb(255 255 255 / 0) 58%, transparent 65%);
  background-size: 220% 100%;
  animation: mp-current 2.4s linear infinite;
  mix-blend-mode: screen;
  filter: drop-shadow(0 0 6px rgb(34 211 238 / 0.8));
}
.mp-current-waiting { animation-duration: 5s; opacity: 0.5; }
@media (prefers-reduced-motion: reduce) {
  .mp-current { animation: none; background-image: none; filter: none; }
}
```

Test: `progress-bar.test.ts` gains: processing fraction never pushes past
1.0; text names in-progress count; indeterminate ignores processing.

#### MPS-T025 | components/manager-pulse/capture-progress.tsx: the panel

Replace the section list with:

- The heading: `RUN_STATUS_LABEL[status]` as today.
- `<ProgressBar done failed total processing={progress.leaguesProcessing} waiting={isWaiting} ... />`
  where `isWaiting = status === "capturing" && progress.workerSeenAt !== null && Date.now() - Date.parse(progress.workerSeenAt) > 20_000`.
- The count line `id=manager-pulse-progress-count-{runId}` as today, followed
  by `<ElapsedClock requestedAt={progress.requestedAt} running={status !== "complete" && status !== "error" && status !== "throttled"} />`.
- A second line: when `isWaiting` and `queueAhead > 0`: `"{queueAhead} leagues
  ahead of yours in the queue"`; when `isWaiting`: `"Waiting for the next
  league"`; otherwise when `leaguesProcessing > 0`: `"{n} in progress"`.
- The estimate line from `estimateRemaining` when status is `capturing`.
- The failed-count line as today.
- `detail` as today.

Live region (`announcement` state) rules, implemented in the existing effect:

- status change (not the first read): `RUN_STATUS_LABEL[status]`.
- `leaguesDone` crossing a multiple of 5 upward: `"{done} of {total} leagues read."`
- first non-null estimate: the estimate text; then again only if 60 s have
  passed since the last estimate announcement (`lastEstimateAnnouncedAt` ref).
- `partialVersion` rising: `"Report updated with {coverage} of {total}
  league-seasons."` no more than once per 30 s (`lastLiveAnnouncedAt` ref);
  `coverage` comes from the report fetch (T043), passed back via an
  `onLiveReport` callback prop.
- completion: `"Complete. {done} of {total} leagues read."`

Remove the `router.refresh()` effect entirely once T044 lands; until then keep
it keyed on `status === "complete"` only (not "computing").

The `polling` prop is now `{ pollIntervalMs, failureBackoffMs, maxConsecutiveFailures }`
and the page passes it from settings (T044).

#### MPS-T026 | components/league-sync-all.tsx: the same panel

Replace the count-only notice body with `ProgressBar` (done = `state.done`,
failed = `state.failed`, total = `state.total`, processing = `state.processing`)
and `ElapsedClock` from `state.requestedAt` while `state.active`. The existing
three-announcement rule stays.

#### MPS-T027 | accessibility audit sub-agent on T023 to T026

Checklist: the clock is not in any live region; nothing visible is
`aria-hidden` except the band, the processing segment and icons; the bar's
name still comes from the count line; the estimate and queue lines are plain
text; 44 px targets on the demo controls if any; reduced motion leaves nothing
moving; mobile at 360 px hides nothing.

### Phase 3: settings, the budget, the drainer, freshness, fairness

#### MPS-T028 | lib/manager-pulse/default-settings.ts: the sync group and capture changes

In `ManagerPulseCaptureSettings`: remove `captureTtlMinutes`; add
`captureStaleAfterDays: number` (doc: "Manager Pulse only. An unsettled
league-season whose capture set is older than this is re-captured. A settled
one never is.") and `leaguesPerUserPerHour: number` (doc: "The cooldown as a
budget: league-seasons one reader may QUEUE per rolling hour. Linked and fresh
leagues cost nothing."). Defaults: 14 and 150. Bounds: `{ min: 1, max: 90 }`
and `{ min: 1, max: 5000 }`. Change `maxLeaguesPerRun` default to 250 and
`maxLeaguesPerSeason` to 60. Remove `runCooldownSeconds` and its bound (T045
replaces the RPC parameter); keep `resumeMaxAgeMinutes` (used until T046).

New group:

```ts
export type ManagerPulseSyncSettings = {
  /** The token bucket in front of every Sleeper call. */
  sleeperCallsPerMinute: number;
  /** A drainer pass hands off after this many calls. */
  maxCallsPerPass: number;
  /** Leagues one pass syncs at once. */
  jobConcurrency: number;
  /** Rows one claim takes. */
  jobsPerClaim: number;
  /** Seconds one pass may run. Under the route's maxDuration of 300. */
  passBudgetSeconds: number;
  /** A job still 'processing' after this many minutes had no worker finish it. */
  staleProcessingMinutes: number;
  /** The panel's poll while a run is open. */
  pollIntervalMs: number;
  /** The panel's poll after a failed request. */
  pollFailureBackoffMs: number;
  /** League-seasons finished before the first live report. */
  liveReportFirstAfter: number;
  /** Then every N more. */
  liveReportEveryLeagues: number;
  /** And never more often than this. */
  liveReportMinIntervalMs: number;
};
```

Defaults: 600, 2400, 3, 12, 280, 10, 2000, 8000, 3, 5, 20000. Bounds:
sleeperCallsPerMinute 60 to 950; maxCallsPerPass 100 to 10000; jobConcurrency
1 to 8; jobsPerClaim 1 to 50; passBudgetSeconds 30 to 290; staleProcessingMinutes
2 to 60; pollIntervalMs 1000 to 30000; pollFailureBackoffMs 2000 to 60000;
liveReportFirstAfter 1 to 50; liveReportEveryLeagues 1 to 50;
liveReportMinIntervalMs 5000 to 120000. Add `sync` to `ManagerPulseSettings`,
to `DEFAULT_MANAGER_PULSE_SETTINGS`, to `MANAGER_PULSE_SETTING_BOUNDS`, and
to `mergeManagerPulseSettings`. Bump `modelVersion` is NOT required: no report
meaning changes.

#### MPS-T029 | lib/manager-pulse/validate.ts and the admin form

`validate.ts`: mirror every new key with `bounded(...)`; add refines
`sync.jobConcurrency <= sync.jobsPerClaim` ("A pass cannot run more leagues at
once than it claims") and `sync.pollIntervalMs < sync.pollFailureBackoffMs`.
Remove `captureTtlMinutes` and `runCooldownSeconds`.

`app/admin/manager-pulse/manager-pulse-settings-manager.tsx`: in the Capture
group replace the "Capture TTL, minutes" field with "Re-capture an unfinished
season after, days" bound to `captureStaleAfterDays`, remove "Run cooldown,
seconds", add "League-seasons one reader may queue per hour" bound to
`leaguesPerUserPerHour`. Add a `<Group title="Sync" description="How the
drainer talks to Sleeper and how the progress panel polls. Changes apply on
the next pass; nothing is recomputed.">` with a `Field` per key above, using
`MANAGER_PULSE_SETTING_BOUNDS.sync.<key>.min/max`. `settings-coverage.test.ts`
passes when every leaf name appears in the form source; run it.

#### MPS-T030 | migration 0263_claim_league_sync_jobs_fair.sql

```sql
-- Migration 0263: claim_league_sync_jobs interleaves owners
--
-- The queue was first in, first out across the whole site, so one 250-league
-- Manager Pulse run held every Sync all press and every other lookup behind it
-- for its full duration. Ordering by each job's rank WITHIN its own owner (a
-- Manager Pulse run or a Sync all request) and then by age gives every owner
-- its next league in turn: a ten-league lookup queued behind a hundred-league
-- one now finishes in about the time it would have taken alone.
--
-- Grants unchanged from 0172: service_role EXECUTE only.
-- Rollback: re-apply the function body from migration 0172.

create or replace function public.claim_league_sync_jobs(p_limit int)
returns setof public.league_sync_jobs
language sql
set search_path = public, pg_temp
as $$
  with ranked as (
    select id,
           created_at,
           row_number() over (
             partition by coalesce(manager_run_id, request_id)
             order by run_after, created_at
           ) as rank_in_owner
    from public.league_sync_jobs
    where status = 'pending'
      and run_after <= now()
  ),
  claimed as (
    select r.id
    from ranked r
    join public.league_sync_jobs j on j.id = r.id
    order by r.rank_in_owner, r.created_at
    for update of j skip locked
    limit greatest(coalesce(p_limit, 0), 0)
  )
  update public.league_sync_jobs j
     set status = 'processing',
         updated_at = now()
    from claimed
   where j.id = claimed.id
  returning j.*;
$$;

revoke all on function public.claim_league_sync_jobs(int) from public;
revoke execute on function public.claim_league_sync_jobs(int) from anon, authenticated;
grant execute on function public.claim_league_sync_jobs(int) to service_role;

-- The cross-user link in enqueue_manager_pulse_capture (0265) looks up an
-- in-flight job by league alone.
create index if not exists league_sync_jobs_league_active_idx
  on public.league_sync_jobs (sleeper_league_id, created_at)
  where status in ('pending', 'processing');
```

Verify with `begin; select ...; rollback;` per the MCP rollback memory: two
owners with 5 and 2 pending jobs, `p_limit 4`, returns 2 of each.

#### MPS-T031 | migration 0264_league_sync_worker_lease.sql

```sql
-- Migration 0264: the drainer lease, and per-job telemetry
--
-- Exactly one worker pass drains league_sync_jobs at a time. The pass that
-- holds this row is the only process making Sleeper calls on behalf of the
-- queue, which is what lets an in-process token bucket be the site's Sleeper
-- budget without a database round trip per call.
--
-- Access matrix: service_role ALL, nobody else anything. The two functions are
-- SECURITY DEFINER with service_role-only EXECUTE, revoked from public, anon
-- and authenticated by name.
--
-- Rollback:
--   drop function if exists public.release_league_sync_lease(text);
--   drop function if exists public.try_acquire_league_sync_lease(text, int);
--   drop table if exists public.league_sync_worker_lease;
--   alter table public.league_sync_jobs drop column if exists sleeper_calls, drop column if exists duration_ms;

create table if not exists public.league_sync_worker_lease (
  id text primary key default 'global' check (id = 'global'),
  holder text,
  held_until timestamptz not null default to_timestamp(0),
  updated_at timestamptz not null default now()
);
insert into public.league_sync_worker_lease (id) values ('global') on conflict do nothing;

alter table public.league_sync_worker_lease enable row level security;
drop policy if exists league_sync_worker_lease_service_role_all on public.league_sync_worker_lease;
create policy league_sync_worker_lease_service_role_all
  on public.league_sync_worker_lease for all to service_role using (true) with check (true);
revoke all on table public.league_sync_worker_lease from anon, authenticated;

-- Acquire or renew. True when p_holder now holds the lease.
create or replace function public.try_acquire_league_sync_lease(p_holder text, p_seconds int)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_ok boolean := false;
begin
  update public.league_sync_worker_lease
     set holder = p_holder,
         held_until = now() + make_interval(secs => greatest(coalesce(p_seconds, 0), 1)),
         updated_at = now()
   where id = 'global'
     and (held_until < now() or holder = p_holder)
  returning true into v_ok;
  return coalesce(v_ok, false);
end;
$$;

create or replace function public.release_league_sync_lease(p_holder text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.league_sync_worker_lease
     set held_until = now(), updated_at = now()
   where id = 'global' and holder = p_holder;
$$;

revoke all on function public.try_acquire_league_sync_lease(text, int) from public;
revoke execute on function public.try_acquire_league_sync_lease(text, int) from anon, authenticated;
grant execute on function public.try_acquire_league_sync_lease(text, int) to service_role;
revoke all on function public.release_league_sync_lease(text) from public;
revoke execute on function public.release_league_sync_lease(text) from anon, authenticated;
grant execute on function public.release_league_sync_lease(text) to service_role;

alter table public.league_sync_jobs
  add column if not exists sleeper_calls int,
  add column if not exists duration_ms int;
comment on column public.league_sync_jobs.sleeper_calls is 'Sleeper requests this job made, counted by the token bucket. Null before 0264.';
comment on column public.league_sync_jobs.duration_ms is 'Wall clock of the job in the worker. Null before 0264.';
```

Regenerate types.

#### MPS-T032 | lib/sleeper-budget.ts (new)

```ts
/**
 * The Sleeper call budget.
 *
 * One token bucket per process, refilled continuously at `perMinute` tokens a
 * minute, capacity `perMinute`. Every Sleeper call (lib/sleeper.ts safeFetch)
 * acquires a token first and WAITS for one rather than being refused, so a
 * burst spreads itself out instead of failing. `pause(ms)` empties the bucket
 * and holds refills for `ms`, which is how a 429 slows down every caller in
 * the process, not just the one that received it.
 *
 * With exactly one drainer (the lease in league_sync_worker_lease) this bucket
 * is the site's budget for queue traffic. If a second drainer is ever added,
 * `acquireSleeperToken` is the seam: its body moves to a database claim and
 * nothing else changes.
 *
 * Per-job counting uses AsyncLocalStorage so three concurrent jobs each count
 * their own calls.
 */
import { AsyncLocalStorage } from "node:async_hooks";

type Counter = { calls: number };
const counterStore = new AsyncLocalStorage<Counter>();

class TokenBucket {
  private tokens: number;
  private lastRefill = Date.now();
  private pausedUntil = 0;
  constructor(private perMinute: number) { this.tokens = perMinute; }
  configure(perMinute: number) { this.perMinute = Math.max(1, perMinute); this.tokens = Math.min(this.tokens, this.perMinute); }
  private refill() {
    const now = Date.now();
    if (now < this.pausedUntil) return;
    const elapsed = now - this.lastRefill;
    this.tokens = Math.min(this.perMinute, this.tokens + (elapsed / 60_000) * this.perMinute);
    this.lastRefill = now;
  }
  async acquire(): Promise<void> {
    for (;;) {
      this.refill();
      if (this.tokens >= 1 && Date.now() >= this.pausedUntil) { this.tokens -= 1; return; }
      const wait = Math.max(50, Math.min(1000, (1 - this.tokens) / this.perMinute * 60_000));
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  pause(ms: number) { this.tokens = 0; this.pausedUntil = Date.now() + ms; this.lastRefill = this.pausedUntil; }
}

const bucket = new TokenBucket(600);

export function configureSleeperBudget(perMinute: number): void { bucket.configure(perMinute); }
export async function acquireSleeperToken(): Promise<void> {
  await bucket.acquire();
  const c = counterStore.getStore();
  if (c) c.calls += 1;
}
export function pauseSleeperBudget(ms: number): void { bucket.pause(ms); }
/** Run `fn` with its own call counter; returns the result and the count. */
export async function countSleeperCalls<T>(fn: () => Promise<T>): Promise<{ result: T; calls: number }> {
  const counter: Counter = { calls: 0 };
  const result = await counterStore.run(counter, fn);
  return { result, calls: counter.calls };
}
/** Test seam. */
export function _resetSleeperBudgetForTests(perMinute = 600): void { bucket.configure(perMinute); (bucket as unknown as { tokens: number }).tokens = perMinute; }
```

Test: `lib/sleeper-budget.test.ts` with `vi.useFakeTimers()`: 600 tokens allow
600 immediate acquires and the 601st waits about 100 ms; `pause(5000)` makes
the next acquire wait at least 5 s; `countSleeperCalls` counts only calls made
inside its callback when two run concurrently.

#### MPS-T033 | lib/sleeper.ts: the budget and 429 handling in safeFetch

```ts
import { acquireSleeperToken, pauseSleeperBudget } from "@/lib/sleeper-budget";

const RETRYABLE = new Set([429, 503]);
const MAX_RETRY_AFTER_MS = 30_000;

function retryAfterMs(response: Response): number {
  const header = response.headers.get("retry-after");
  if (!header) return 2_000 + Math.floor(Math.random() * 1_000);
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, seconds * 1000));
  const at = Date.parse(header);
  return Number.isFinite(at) ? Math.min(MAX_RETRY_AFTER_MS, Math.max(0, at - Date.now())) : 2_000;
}

async function safeFetch<T>(url: string, timeoutMs = DEFAULT_TIMEOUT_MS, maxBytes = MAX_RESPONSE_BYTES): Promise<T | null> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await acquireSleeperToken();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { headers, cache: "no-store", signal: controller.signal });
      if (RETRYABLE.has(response.status)) {
        const wait = retryAfterMs(response);
        if (attempt === 0) { await new Promise((r) => setTimeout(r, wait)); continue; }
        // Second refusal: a fact about our rate, not this URL. Slow everyone.
        pauseSleeperBudget(Math.max(wait, 10_000));
        return null;
      }
      if (!response.ok) return null;
      const declared = Number(response.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > maxBytes) return null;
      const text = await readCapped(response, maxBytes);
      if (text === null) return null;
      return JSON.parse(text) as T;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}
```

`mapLimit` and `SLEEPER_BATCH_SIZE` are unchanged; the bucket is what paces.
The player dump call (`getSleeperPlayers`) passes through the same bucket; one
token, fine.

Test: `lib/sleeper-fetch.test.ts` (new) with a mocked global `fetch`: a 429
then a 200 returns the body and waited `Retry-After`; two 429s return null and
the next `acquireSleeperToken` waits; a 404 returns null with no retry.

#### MPS-T034 | lib/league-bulk-sync.ts: the pass

Delete `MAX_JOBS_PER_RUN`, `PACE_MS`, `FOOTPRINT_PACE_MS`, `RUN_BUDGET_MS`,
`STALE_PROCESSING_MS`, `MAX_ATTEMPTS` (the last stays as a literal fallback
inside the settings read). `runLeagueSyncWorker(admin, options: { holder: string })`:

```ts
export async function runLeagueSyncWorker(admin: Admin, options: { holder: string }): Promise<WorkerSummary> {
  const settings = await loadManagerPulseSettings(admin);   // never throws
  const sync = settings.sync;
  configureSleeperBudget(sync.sleeperCallsPerMinute);
  const summary: WorkerSummary = { claimed: 0, done: 0, retried: 0, failed: 0, reaped: 0, released: 0, requestsCompleted: 0, finalized: 0, liveReports: 0, callsMade: 0 };
  const deadline = Date.now() + sync.passBudgetSeconds * 1000;
  const touched = new Set<string>();
  const runsTouched = new Set<string>();
  let calls = 0;

  await reapStaleJobs(admin, summary, touched, settings.capture.jobMaxAttempts, sync.staleProcessingMinutes * 60_000);
  await finalizeComputingRuns(admin, settings, summary);   // T040

  while (Date.now() < deadline && calls < sync.maxCallsPerPass) {
    const renewed = await renewLease(admin, options.holder, sync.passBudgetSeconds + 30);
    if (!renewed) break;                                     // somebody else holds it now
    const { data: claimed, error } = await admin.rpc("claim_league_sync_jobs", { p_limit: sync.jobsPerClaim });
    if (error || !claimed || claimed.length === 0) break;
    const jobs = claimed as LeagueSyncJob[];
    summary.claimed += jobs.length;

    let index = 0;
    const leftover: LeagueSyncJob[] = [];
    await mapLimit(jobs, sync.jobConcurrency, async (job) => {
      index += 1;
      if (Date.now() >= deadline || calls >= sync.maxCallsPerPass) { leftover.push(job); return; }
      if (job.request_id) touched.add(job.request_id);
      const startedAt = Date.now();
      const { result: outcome, calls: jobCalls } = await countSleeperCalls(() => runOneJob(admin, job, settings));
      calls += jobCalls;
      summary.callsMade += jobCalls;
      await settleJob(admin, job, outcome, jobCalls, Date.now() - startedAt, settings, summary, runsTouched);
    });
    if (leftover.length > 0) await releaseJobs(admin, leftover, summary);
  }

  await closeFinishedRequests(admin, touched, summary);
  await liveReportCheckpoints(admin, settings, runsTouched, summary);   // T041
  await finalizeComputingRuns(admin, settings, summary);
  return summary;
}
```

`runOneJob` wraps `syncOneLeague` in try/catch and applies the run-time
freshness check first (T035). `settleJob` is the existing done/failed branch
extracted, writing `sleeper_calls` and `duration_ms` on the `done` and
`failed` updates, and calling `closeManagerPulseRunLeagues`, which now also
adds each affected `run_id` to `runsTouched`. `releaseJobs` is the existing
leftover block. `reapStaleJobs` takes the stale window as a parameter.
`renewLease` calls `try_acquire_league_sync_lease(holder, seconds)`.

`mapLimit` is imported from `@/lib/sleeper`.

Test: `lib/league-bulk-sync.test.ts` (new; the fake-admin style of
`capture.test.ts`): three jobs with `jobConcurrency: 2` run two at once (assert
via a counter of in-flight `syncOneLeague` mocks peaking at 2); a job past the
deadline is released; the summary counts calls; a lease renewal returning false
stops claiming.

#### MPS-T035 | lib/league-bulk-sync.ts: run-time freshness for footprint jobs

In `runOneJob`, before `syncOneLeague`, for `job.job_kind === "footprint"`:

```ts
const { data: league } = await admin
  .from("leagues")
  .select("capture_completed_at, status, season")
  .eq("sleeper_league_id", job.sleeper_league_id)
  .maybeSingle();
if (league && !managerPulseNeedsCapture(league, settings, Date.now())) {
  return { ok: true, skipped: "fresh" };
}
```

`managerPulseNeedsCapture` is the pure rule from T036, shared with
`capture.ts`. A skipped job settles as `done` with `sleeper_calls = 0`.

#### MPS-T036 | lib/manager-pulse/freshness.ts (new, pure) and capture.ts

```ts
import { currentNflSeason } from "@/lib/sleeper";
import type { ManagerPulseSettings } from "./types";

export type LeagueCaptureState = {
  capture_completed_at: string | null;
  status: string | null;
  season: number | null;
};

/** Sleeper marks a finished league 'complete'; a past season is finished by definition. */
export function isSettledLeagueSeason(state: LeagueCaptureState, currentSeason = Number(currentNflSeason())): boolean {
  return state.status === "complete" || (state.season !== null && state.season < currentSeason);
}

/**
 * Manager Pulse's freshness rule, and nobody else's. League Pulse keeps its
 * own 60-minute TTL in pulseLeagueCore.
 *
 *   settled and complete       never
 *   settled and incomplete     yes
 *   unsettled and complete     when older than captureStaleAfterDays
 *   unsettled and incomplete   yes
 *   no row at all              yes
 */
export function managerPulseNeedsCapture(
  state: LeagueCaptureState | null | undefined,
  settings: ManagerPulseSettings,
  nowMs: number,
): boolean {
  if (!state || !state.capture_completed_at) return true;
  if (isSettledLeagueSeason(state)) return false;
  const ageMs = nowMs - Date.parse(state.capture_completed_at);
  return ageMs > settings.capture.captureStaleAfterDays * 86_400_000;
}
```

`capture.ts` step 5: the `leagues` read selects
`sleeper_league_id, capture_completed_at, status, season`, the map stores the
whole state, and `needsCapture` becomes
`(id) => managerPulseNeedsCapture(stateByLeague.get(id), settings, nowMs)`.
Delete the `captureTtlMs` line.

`lib/sleeper.ts` is not a pure module, so `freshness.ts` takes `currentSeason`
as a defaulted parameter and the purity test lists it with the reason. (Or:
compute `currentSeason` once in the caller and pass it; prefer this and drop
the import, keeping the module pure. Do the latter.)

Test: `lib/manager-pulse/freshness.test.ts`: the five rows of the table above.

#### MPS-T037 | lib/sleeper.ts: cap the transaction walk

`syncTransactions` in `league-pulse.ts` reads `metadata->settings->last_scored_leg`
in the same query it already makes for the stored max week (widen the select on
`leagues` or pass it from `captureLeagueRawData`, which already reads the
league row; pass it). `getAllSleeperTransactions(leagueId, maxWeek, 3, fromWeek)`
is called with `maxWeek = Number.isFinite(lastScoredLeg) && lastScoredLeg > 0 ? lastScoredLeg + 1 : 25`.
For a settled league without the field, 18.

Test: `lib/league-footprint-sync.test.ts`: a league with `last_scored_leg: 17`
walks weeks up to 18 and no further.

#### MPS-T038 | Sleeper GraphQL: what the research found, and the one optional task it yields

The spike was run on 2026-09-05 against `https://sleeper.com/graphql`,
unauthenticated, with the `user-agent: ffbeacon/1.0` header the REST client
sends, using league `1182219116086235136` (2025, complete, 12 teams, 724
stored transactions, 216 stored matchup rows) and draft
`1182219116086235137`. Introspection uses snake_case on this server
(`__schema { query_type { name } }`, `of_type`); the root type is
`RootQueryType` with 240 fields. The full root introspection is not checked in;
re-run the query in this section's first paragraph to regenerate it.

What is OPEN without a login, verified by a returned payload:

| Query | Arguments | Returns | Notes |
| --- | --- | --- | --- |
| `get_league` | `league_id` | `League` | fields include `settings`, `scoring_settings`, `roster_positions`, `metadata`, `previous_league_id`, `total_rosters`, `draft_id`, `avatar`, `status`, `season`, `sport`, `name`, plus chat fields REST does not carry |
| `league_rosters` | `league_id` | `[Roster]` | `roster_id`, `owner_id`, `co_owners`, `players`, `starters`, `reserve`, `taxi`, `keepers`, `settings`, `metadata`, `player_map` |
| `league_users` | `league_id` | `[LeagueUser]` | `user_id`, `display_name`, `avatar`, `is_owner`, `is_bot`, `settings`, `metadata`. NO `username` field |
| `roster_draft_picks` | `league_id`, `season` | `[RosterDraftPick]` | same five fields as REST `traded_picks` |
| `drafts_by_league_id` | `league_id` | `[Draft]` | `draft_id`, `status`, `type`, `settings`, `start_time`, `last_picked`, `created`, `draft_order`, `season`, `league_id`. NO `slot_to_roster_id` |
| `league_playoff_bracket` | `league_id` | `Map` | identical shape to REST `winners_bracket` (`m`, `r`, `w`, `l`, `t1`, `t2`, `p`) |
| `league_playoff_loser_bracket` | `league_id` | `Map` | identical shape to REST `losers_bracket` |
| `matchup_legs_raw` | `league_id`, `round` | `[MatchupLeg]` | `leg`, `roster_id`, `matchup_id`, `points`, `custom_points`, `max_points`, `starters`, `players`. `player_map`, `picks`, `starters_games` came back null. NO `players_points`, NO `starters_points` |
| `draft_picks` | `draft_id` | `[DraftPick]` | `pick_no`, `player_id`, `picked_by`, `is_keeper`, `metadata`. NO `round`, NO `roster_id` |
| `get_draft` | `sport`, `draft_id` | `Draft` | same as `drafts_by_league_id` rows |
| `owned_leagues` | `user_id`, `season`, `season_type`, `sport` | `[League]` | NOT the user's league list: for user `737160154079993856`, 2025, it returned 23 leagues where REST `/user/{id}/leagues/nfl/2025` returned 31, with 9 only in REST and 1 only here |
| `draft_autopickers` | already used | | |

What is CLOSED without a login (`{"code":"unauthorized"}`), each verified:
`league_transactions`, `league_transactions_filtered`,
`league_transactions_by_status`, `league_transactions_by_player`,
`matchup_legs`, `matchup_legs_related_to_roster` (which would have been a
whole season for one roster in one call), `user_rosters` (answers but empty
for a user with 31 leagues).

Aliasing works: one POST carrying `w1: matchup_legs_raw(round: 1) ... w18:`
returned all eighteen weeks in 69,810 bytes in 0.21 s, and one POST carrying
`get_league`, `league_rosters`, `league_users`, `roster_draft_picks`,
`drafts_by_league_id` and both brackets answered in 0.12 s. Measured REST
latencies on the same league: rosters 0.10 to 0.13 s, one transactions week
0.16 s, one matchups week 0.11 s.

Conclusions:

1. Transactions stay on REST. Every transaction query requires a Sleeper
   session. Building the drainer on a logged-in scrape of an undocumented API
   is a policy decision the owner has not made, and this plan does not make
   it. The REST week walk (capped by T037) remains the cost it is.
2. Matchups stay on REST. `matchup_legs_raw` is open and eighteen weeks fit
   in one request, but it drops `players_points` and `starters_points`, and
   `league_matchups.player_points` is what the Manager Ledger, the Lineups
   page and the Schedules retrospective read. A slate without per-player
   points is not the capture set. Do not use it for the slate.
3. Draft picks stay on REST. `draft_picks` drops `round` and `roster_id`,
   which `recordDraftSelections` stores. One REST call per completed draft,
   once, is already the cost.
4. Discovery stays on REST. `owned_leagues` is a different set.
5. The core bundle IS a real, modest saving: `get_league`, `league_rosters`,
   `roster_draft_picks`, `drafts_by_league_id`, `league_playoff_bracket` and
   `league_playoff_loser_bracket` in ONE request replace six REST calls. Per
   cold league-season that is about 46 calls down to about 41 (13 percent),
   and at the 600 a minute bucket about 13 league-seasons a minute up to about
   15. `league_users` is left on REST because the GraphQL object lacks
   `username` and `league_users` rows keep the raw REST object in `metadata`
   under the metadata rule; the per-draft `get_draft` REST call also stays for
   `slot_to_roster_id`.

The optional task, NOT on the critical path, to be built only after Phase 3
has shipped and been measured (Part 9), so its effect is measured on its own:

`lib/sleeper.ts` gains `getSleeperLeagueCoreBundle(leagueId, season)` behind
the existing `SLEEPER_GRAPHQL_HOST`, guarded by a `LEAGUE_ID_PATTERN` of
`/^[0-9]{1,32}$/` and a `/^[0-9]{4}$/` season check before interpolation (the
same injection guard `getSleeperDraftAutopickers` uses), one token from the
bucket, the same timeout and `readCapped`, returning

```ts
{
  league: SleeperLeague;
  rosters: SleeperRoster[];
  tradedPicks: SleeperTradedPick[];
  drafts: SleeperDraft[];
  winnersBracket: unknown[] | null;
  losersBracket: unknown[] | null;
} | null
```

with the query

```graphql
{
  get_league(league_id: "<id>") { league_id name season sport status total_rosters previous_league_id draft_id avatar settings scoring_settings roster_positions metadata }
  league_rosters(league_id: "<id>") { roster_id owner_id co_owners players starters reserve taxi keepers settings metadata }
  roster_draft_picks(league_id: "<id>", season: "<season>") { season round roster_id previous_owner_id owner_id }
  drafts_by_league_id(league_id: "<id>") { draft_id league_id season status type settings start_time last_picked created draft_order }
  league_playoff_bracket(league_id: "<id>")
  league_playoff_loser_bracket(league_id: "<id>")
}
```

and null on any `errors` entry, non-200, timeout, or a `data` member that is
not the expected shape. `pulseLeagueCore` calls it first and, on null, falls
back to the six REST calls exactly as today; `captureLeagueRawData` receives
the two brackets from core when present (add an optional `brackets` field to
the league argument) and skips `captureLeagueBrackets`'s two fetches when
both are present.

Gate before switching: `lib/sleeper-graphql-shape.test.ts` (new) loads one
league through both paths, from recorded fixtures, and asserts that every
field `upsertRosters`, `upsertLeagueUsers`, `upsertLeagueDrafts`,
`deriveFormatSlug`, `snapshotFromSleeper` and the lineups fallback
(`rosters.metadata.starters`) read is present with the same value on both
shapes. Any field that differs is either mapped in the bundle function or the
bundle is not adopted. `leagues.metadata` keeps the REST shape's field set by
projecting the GraphQL `League` onto it (drop the chat fields), so nothing
downstream sees a new shape.

Measured effect, to be filled in by Part 9 after the task ships:
(calls per cold league-season, league-seasons per minute, final time for the
three reference handles).

#### MPS-T039 | app/api/cron/league-sync-worker/route.ts: lease, wake, self-chain

```ts
import { NextResponse, after } from "next/server";
import { randomUUID } from "node:crypto";
// ...existing imports

export const maxDuration = 300;

async function runPass(admin: ReturnType<typeof createAdminClient>, holder: string, reason: string) {
  try {
    const summary = await recordCronRun(admin, "league-sync-worker", () =>
      runLeagueSyncWorker(admin, { holder }),
    );
    console.log(`[cron/league-sync-worker] pass (${reason})`, summary);
    const { count } = await admin
      .from("league_sync_jobs")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending")
      .lte("run_after", new Date().toISOString());
    await admin.rpc("release_league_sync_lease", { p_holder: holder });
    if ((count ?? 0) > 0) await wakeLeagueSyncWorker("self-chain");
  } catch (err) {
    console.error("[cron/league-sync-worker] pass failed", err instanceof Error ? err.message : err);
    await admin.rpc("release_league_sync_lease", { p_holder: holder });
  }
}

async function acquire(admin, holder: string): Promise<boolean> {
  const settings = await loadManagerPulseSettings(admin);
  const { data } = await admin.rpc("try_acquire_league_sync_lease", {
    p_holder: holder,
    p_seconds: settings.sync.passBudgetSeconds + 30,
  });
  return data === true;
}

/** Cron tick: run a pass inline if nobody holds the lease. */
export async function GET(req: Request) {
  const auth = verifyCronRequest(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const admin = createAdminClient();
  const holder = `cron:${randomUUID()}`;
  if (!(await acquire(admin, holder))) return NextResponse.json({ ok: true, skipped: "lease held" });
  await runPass(admin, holder, "cron");
  return NextResponse.json({ ok: true });
}

/** Wake: acquire the lease, schedule the pass, answer immediately. */
export async function POST(req: Request) {
  const auth = verifyCronRequest(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const admin = createAdminClient();
  const holder = `wake:${randomUUID()}`;
  if (!(await acquire(admin, holder))) return NextResponse.json({ started: false, reason: "lease held" });
  const reason = req.headers.get("x-wake-reason") ?? "wake";
  after(() => runPass(admin, holder, reason));
  return NextResponse.json({ started: true }, { status: 202 });
}
```

`vercel.json` is unchanged: the minute tick stays as the backstop.
`lib/cron-runs.ts` `recordCronRun` is unchanged.

Security review sub-agent (MPS-T041): the POST accepts nothing but the bearer
and a reason header that is only logged; the lease functions are
service_role-only; the self-chain cannot loop without work because it wakes
only when pending rows exist and each wake is bounded by the lease.

#### MPS-T040 | lib/manager-pulse/finalize.ts (new) and service.ts becomes a reader

`finalize.ts` exports `finalizeManagerPulseRun(admin, runId, settings)`, which
is the block of `getManagerFootprint` from "4. Everything needed is present"
to the end, moved verbatim with these changes: it reads the run row for
`sleeper_user_id`, `sleeper_handle`, `season_from`, `season_to`; it resolves
`avatarUrl` from the newest cached report's identity when present, else null
(the handle resolve is not repeated); it reads the cache by user id first and,
on a matching fingerprint, closes the run as complete without writing; it never
throws (catch closes the run as `error` with "The report could not be built.").
It also deletes the subject's `manager_pulse_live_reports` row on success.

`finalizeComputingRuns(admin, settings, summary)` in `league-bulk-sync.ts`:

```ts
const { data: runs } = await admin
  .from("manager_pulse_runs")
  .select("id")
  .eq("status", "computing")
  .is("completed_at", null)
  .order("updated_at", { ascending: true })
  .limit(10);
for (const run of runs ?? []) {
  await coalesce(`finalize:${run.id}`, () => finalizeManagerPulseRun(admin, run.id, settings));
  summary.finalized += 1;
}
```

`service.ts getManagerFootprint` after the capture step returns
`{ status: "building", progress }` for BOTH `started` and `warm` outcomes and
never loads or computes. The `warm`/`computing` run is finalized by the next
drainer pass, which the wake in T003 triggers. `readRunLeagues`, the fingerprint
block and `writeReport` move to `finalize.ts`; `service.ts` keeps the cache
reads, throttle handling, `listRecentLookups`, `getManagerTendencies`.

Test: `lib/manager-pulse/finalize.test.ts`: matching fingerprint closes without
a write; a throw closes as error; success writes cache, tendency and deletes
the live row. `service.test.ts`: a warm run returns `building`, and
`computeFootprint` is never imported by service.ts (source assertion).

#### MPS-T041 | lib/manager-pulse/live-report.ts (new) and the worker hook

```ts
/** Pure. Whether this run has crossed a checkpoint since its last one. */
export function shouldComputeLiveReport(input: {
  leaguesDone: number;
  lastCheckpointDone: number;
  lastCheckpointAt: string | null;
  nowMs: number;
  sync: ManagerPulseSyncSettings;
}): boolean {
  const { leaguesDone, lastCheckpointDone, lastCheckpointAt, nowMs, sync } = input;
  if (leaguesDone < sync.liveReportFirstAfter) return false;
  if (lastCheckpointDone === 0) return true;
  if (leaguesDone - lastCheckpointDone < sync.liveReportEveryLeagues) return false;
  if (lastCheckpointAt && nowMs - Date.parse(lastCheckpointAt) < sync.liveReportMinIntervalMs) return false;
  return true;
}

/** Compute over the finished league-seasons and overwrite the subject's live row. Never throws. */
export async function computeLiveReport(admin, runId: string, settings: ManagerPulseSettings): Promise<void>;
```

`computeLiveReport` reads the run row, reads `manager_pulse_run_leagues` with
status in `('fresh','done')` (paged), calls `loadManagerPulseInput` over those,
`computeFootprint`, then `upsert` into `manager_pulse_live_reports` with
`coverage = rows.length`, `coverage_total = run.leagues_total`,
`version = coalesce(existing.version, 0) + 1` (read the existing version first;
two runs on one subject serialize through `coalesce("live:" + subjectKey)`),
and updates the run's `live_checkpoint_done` and `live_checkpoint_at`.

`liveReportCheckpoints(admin, settings, runsTouched, summary)` in
`league-bulk-sync.ts` runs after the job loop: for each run id in
`runsTouched`, read `status, leagues_done, live_checkpoint_done,
live_checkpoint_at`; if status is `capturing` and `shouldComputeLiveReport`
is true, `computeLiveReport`. Also called mid-pass every time `settleJob` closes
a job whose run crosses the FIRST checkpoint (so the first live report does not
wait for the pass to end): `settleJob` checks
`leagues_done >= sync.liveReportFirstAfter && live_checkpoint_done === 0` and
calls `computeLiveReport` inline.

Test: `live-report.test.ts`: the checkpoint table (first at 3; then 8 only
after 20 s; 13 immediately if 20 s passed).

#### MPS-T042 | app/api/manager-pulse/runs/[run_id]/report/route.ts (new)

Same header, same uuid check, same session and ownership check as the progress
route (copy them; do not share a helper that would hide the ownership check).
Then:

```ts
const settings = await loadManagerPulseSettings(admin);
const { data: run } = await admin.from("manager_pulse_runs")
  .select("status, sleeper_user_id, season_from, season_to").eq("id", runId).maybeSingle();
if (!run) return notFound();
if (run.status === "complete") {
  const { data: cached } = await admin.from("manager_pulse_cache")
    .select("report, generated_at, league_seasons_counted")
    .eq("sleeper_user_id", run.sleeper_user_id).eq("season_from", run.season_from)
    .eq("season_to", run.season_to).eq("model_version", settings.modelVersion).maybeSingle();
  if (!cached) return notFound();
  return json({ final: true, version: -1, coverage: cached.league_seasons_counted, coverageTotal: cached.league_seasons_counted, computedAt: cached.generated_at, report: cached.report });
}
const { data: live } = await admin.from("manager_pulse_live_reports")
  .select("report, coverage, coverage_total, version, computed_at")
  .eq("sleeper_user_id", run.sleeper_user_id).eq("season_from", run.season_from)
  .eq("season_to", run.season_to).eq("model_version", settings.modelVersion).maybeSingle();
if (!live) return json({ final: false, version: 0, coverage: 0, coverageTotal: 0, computedAt: null, report: null });
return json({ final: false, version: live.version, coverage: live.coverage, coverageTotal: live.coverage_total, computedAt: live.computed_at, report: live.report });
```

All responses `Cache-Control: no-store`. The report document is the reader's
own request's subject, which they are entitled to see; the ownership check on
the RUN is what stops enumeration of other people's lookups.

#### MPS-T043 | components/manager-pulse/live-manager-report.tsx (new, "use client")

Props: `{ handle: string; initialProgress: CaptureProgress; polling: CaptureProgressPollingOptions; lens: LeagueLens }`.

- Calls `useCaptureProgress(initialProgress, polling)`.
- Holds `report: ManagerReport | null`, `coverage`, `coverageTotal`, `final`.
- Effect on `progress.partialVersion` and on `progress.status === "complete"`:
  fetch `/api/manager-pulse/runs/${runId}/report` (abortable, `no-store`),
  validate the shape minimally (`report` is an object with `identity` and
  `counts`), set state. On complete, fetch once more until `final: true`
  (retry at `pollIntervalMs` up to five times, since finalize and the poll can
  race by a second).
- Renders `<CaptureProgressPanel progress={progress} onLiveReport={(c) => ...} />`
  while not final, then, when `report` is present, the same tree
  `[handle]/page.tsx` renders for a ready report (`ManagerMasthead`,
  `ReportColumns`, `ReportRail`, the seven section components in the same
  order), with a banner ABOVE the masthead when not final:

  `<p role="status" className="...">Based on {coverage} of {coverageTotal} league-seasons so far. Updating as the rest are read.</p>`

  (`role="status"` is polite and the text changes only at checkpoints, which is
  the cadence rule.)
- When `report` is null and not final, renders the eight `PendingSection`
  anchors as the page does today (move `PendingSection` into this component).
- `LensSwitch` is rendered inside the masthead exactly as the ready branch does.

`client-boundary.test.ts` gains an assertion that `live-manager-report.tsx`
imports only from `components/manager-pulse/*`, `components/manager-shell/*`,
`lib/manager-pulse/types`, `lib/datetime` and React/Next client modules.

#### MPS-T044 | app/tools/manager-pulse/[handle]/page.tsx: the building branch

The `building` branch renders

```tsx
<ManagerShell handle={handle}>
  <LiveManagerReport handle={handle} initialProgress={result.progress} polling={pollingFromSettings} lens={requestedLens} />
</ManagerShell>
```

where `pollingFromSettings` comes from `loadManagerPulseSettings(adminClient).sync`
(`pollIntervalMs`, `pollFailureBackoffMs`) read in `ManagerReportBoundary`
(one indexed read; pass it to `getManagerFootprint` too so the service does not
read it twice: add an optional `settings` parameter). Delete `PartialSections`,
`PartialSection` and `ReportHeading` from the page; `PendingSection` moves to
T043. Remove the `CaptureProgressPanel` import. The ready branch is unchanged.

#### MPS-T045 | migration 0265_manager_pulse_rpcs_v2.sql

`try_claim_manager_pulse` becomes:

```sql
create or replace function public.try_claim_manager_pulse(
  p_user_id uuid,
  p_sleeper_user_id text,
  p_sleeper_handle text,
  p_season_from int,
  p_season_to int,
  p_leagues_requested int,
  p_league_budget int,
  p_budget_window_seconds int default 3600
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := now();
  v_open uuid;
  v_used int;
  v_oldest timestamptz;
  v_run_id uuid;
begin
  if p_user_id is null then return jsonb_build_object('claimed', false, 'reason', 'no_user'); end if;
  if coalesce(btrim(p_sleeper_user_id), '') = '' then return jsonb_build_object('claimed', false, 'reason', 'no_subject'); end if;

  perform pg_advisory_xact_lock(hashtext('manager_pulse:' || p_user_id::text));

  -- A run this reader already has open for this exact question is the answer
  -- to a repeat of it. Resumed, never re-claimed, however long it has waited.
  select id into v_open
  from public.manager_pulse_runs
  where user_id = p_user_id
    and sleeper_user_id = btrim(p_sleeper_user_id)
    and season_from = p_season_from
    and season_to = p_season_to
    and status in ('pending', 'capturing', 'computing')
  order by requested_at desc
  limit 1;
  if found then
    return jsonb_build_object('claimed', true, 'run_id', v_open, 'resumed', true);
  end if;

  -- The budget: league-seasons this reader has QUEUED in the window. Linked
  -- and fresh leagues never counted, so joining someone else's capture is free.
  select coalesce(sum(leagues_charged), 0), min(requested_at)
    into v_used, v_oldest
  from public.manager_pulse_runs
  where user_id = p_user_id
    and leagues_charged > 0
    and requested_at > v_now - make_interval(secs => p_budget_window_seconds);

  if p_leagues_requested > 0 and v_used + p_leagues_requested > p_league_budget then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'budget',
      'budget_used', v_used,
      'budget_total', p_league_budget,
      'retry_after_seconds',
        greatest(1, ceil(extract(epoch from (v_oldest + make_interval(secs => p_budget_window_seconds) - v_now)))::int)
    );
  end if;

  insert into public.manager_pulse_runs (user_id, sleeper_user_id, sleeper_handle, season_from, season_to, status)
  values (p_user_id, btrim(p_sleeper_user_id), nullif(btrim(coalesce(p_sleeper_handle, '')), ''), p_season_from, p_season_to, 'pending')
  returning id into v_run_id;

  return jsonb_build_object('claimed', true, 'run_id', v_run_id, 'resumed', false);
end;
$$;
```

with `alter table public.manager_pulse_runs add column if not exists
leagues_charged int not null default 0;` above it, the old six-argument
signature dropped, and grants restated for the new signature (revoke from
public, anon, authenticated by name; grant to service_role).

`enqueue_manager_pulse_capture` (from 0260) changes in two places:

1. The link lookup drops the user filter and prefers the oldest job:

```sql
select id into v_job_id
from public.league_sync_jobs
where sleeper_league_id = v_league_id
  and status in ('pending', 'processing')
order by created_at
limit 1;
```

and this lookup runs BEFORE the insert attempt (so an in-flight job for any
user is linked rather than duplicated per user); only when it finds nothing
does the insert run, with the existing `on conflict do nothing` and re-select
as the per-user fallback.

2. The final update sets `leagues_charged = v_queued` beside
`counts_against_cooldown = (v_queued > 0)`.

`capture.ts` passes `p_leagues_requested` (the count of league-seasons for
which `managerPulseNeedsCapture` is true), `p_league_budget =
settings.capture.leaguesPerUserPerHour` (or a very large number when
`bypassThrottle`), `p_budget_window_seconds = 3600`. A `reason: 'budget'` reply
maps to `{ status: "throttled", retryAfterSeconds, budgetUsed, budgetTotal }`
(extend `CaptureOutcome` and `ManagerFootprintResult`). A `resumed: true` reply
skips the enqueue RPC entirely and reads progress.

Test (rollback verification in SQL): user with 140 charged in the window
requesting 20 against 150 is refused with `retry_after_seconds` above zero;
requesting 0 is allowed; an open run for the same subject is returned with
`resumed: true`; two users enqueueing the same league one after the other
produce ONE job and two linked run_leagues rows.

#### MPS-T046 | lib/manager-pulse/capture.ts: findOpenRun on job liveness

`findOpenRun` drops the `updated_at` filter. After finding the newest open run
for the (user, subject, window), it checks liveness:

```ts
const { data: openRows } = await admin
  .from("manager_pulse_run_leagues")
  .select("job_id").eq("run_id", data.id).in("status", ["pending", "queued"]).not("job_id", "is", null).limit(200);
const jobIds = (openRows ?? []).map((r) => r.job_id).filter((id): id is string => !!id);
if (jobIds.length > 0) {
  const stale = new Date(Date.now() - settings.sync.staleProcessingMinutes * 2 * 60_000).toISOString();
  const { count } = await admin.from("league_sync_jobs").select("id", { count: "exact", head: true })
    .in("id", jobIds).in("status", ["pending", "processing"]);
  const { count: deadCount } = await admin.from("league_sync_jobs").select("id", { count: "exact", head: true })
    .in("id", jobIds).eq("status", "processing").lt("updated_at", stale);
  if ((count ?? 0) === 0 || (deadCount ?? 0) === jobIds.length) return null;   // nothing alive
}
```

A run with no open job rows (computing, or all fresh) is alive by definition.
`resumeMaxAgeMinutes` is removed from settings, the validator and the form.
With T045's `resumed: true` this function is belt and braces; keep it, because
it saves the RPC round trip on every poll-driven render.

#### MPS-T047 | app/tools/manager-pulse/[handle]/page.tsx: ThrottledState copy

`ThrottledState` receives `budgetUsed` and `budgetTotal` when present:
"You have queued {used} of {total} league-seasons this hour. You can queue more
after {formatEastern(retryAt)}. Reports you have already generated stay
available, and a manager someone else is already capturing costs you nothing."

### Phase 4: observe

#### MPS-T048 | app/admin/manager-pulse/queue/page.tsx (new) and the subnav

Reads, with the service role behind `requireAdmin`: pending and processing
counts by `job_kind` and by owner (top 20 owners by pending count, owner shown
as the run's `sleeper_handle` or the request's user id prefix); oldest pending
`created_at` as an age; the lease row; the last 10 `cron_runs` for
`league-sync-worker` with their summaries; calls in the last 60 minutes as the
sum of `sleeper_calls` on jobs finished in that window. Register in
`lib/manager-pulse-admin-nav.ts` and `components/admin/manager-pulse-subnav.tsx`.
Every timestamp through `formatEastern`. Tables with captions, scroll regions
labelled, nothing hidden on mobile.

#### MPS-T049 | app/admin/manager-pulse/runs/page.tsx: telemetry

Add p50 and p95 of `duration_ms` and `sleeper_calls` per `job_kind` over the
last 24 hours as a small table above the runs table (one `select` of the two
columns for finished jobs in the window, percentiles computed in memory; the
window is bounded so the read is bounded).

#### MPS-T050 | measure, then rewrite 4.8

Run the Part 9 protocol in full (all three handles, cold twice and warm
once) on the finished build, fill Part 9.2's final row, replace the table in
4.8 with the measured figures, and update the artifact's summary figures and
its "How we will know" section. The owner's deliverable is the Part 9.3
table: baseline seconds against final seconds for each of the three handles,
and the percentage saved.

### Phase 5: clean-up

#### MPS-T051 | migration 0266_manager_pulse_runs_drop_section_status.sql

`alter table public.manager_pulse_runs drop column if exists section_status;`
after T019 to T025 have shipped and the admin runs page no longer reads it.

#### MPS-T052 | CLAUDE.md

Add the rules in Part 6 to the Manager Pulse section, in its voice.

---

## Part 6. Rules this plan adds

- The Sleeper call budget is `manager_pulse_settings.sync.sleeperCallsPerMinute`,
  enforced by one token bucket in `lib/sleeper-budget.ts` that every Sleeper
  call passes through. Never add a `sleep` as a rate limit.
- Exactly one worker pass drains `league_sync_jobs` at a time, under
  `league_sync_worker_lease`. A second drainer is the moment the bucket moves to
  the database, not before.
- ONE CAPTURE SET. `captureLeagueRawData` in `lib/league-pulse.ts` is the only
  caller of the transaction, bracket and draft-selection stages, and both
  halves of the league pulse call it. A league synced by any tool holds
  everything every other tool reads. `leagues.capture_completed_at` is stamped
  only when the whole set succeeded.
- Manager Pulse freshness is `lib/manager-pulse/freshness.ts` and nobody
  else's: a settled league-season with a complete capture set is never
  captured again; an unsettled one is re-captured after
  `captureStaleAfterDays`. League Pulse keeps its own 60-minute TTL.
- A handle being captured for one reader is JOINED by the next reader, never
  captured twice: the enqueue links to any in-flight job for a league, the live
  report is keyed by subject, and the second reader's budget is untouched.
- A failed Sleeper request during discovery or a transaction walk is never
  evidence about a manager or a league. Discovery with a failed season is an
  error that charges nothing; a failed week fails the job so it retries.
- The report is computed by the drainer (`lib/manager-pulse/finalize.ts`),
  never inside a page render. The page reads a cache or shows progress.
- A live report is labelled with its coverage above the fold, lives only in
  `manager_pulse_live_reports`, is never written to `manager_pulse_cache` or
  `manager_pulse_tendencies`, and is recomputed no more often than
  `shouldComputeLiveReport` allows.
- The progress bar's fill is bound to counted work. The band, the processing
  segment, the clock and the estimate decorate or annotate it and never move
  it. Under reduced motion nothing moves.
- A run is resumed while any of its jobs is alive, and `try_claim_manager_pulse`
  returns the open run for the same question rather than refusing it.
- The cooldown is a budget of league-seasons queued per hour
  (`leaguesPerUserPerHour`), and linked or fresh leagues cost nothing.

---

## Part 7. Things checked and found fine

- Both RPCs are `security definer`, revoked from public, anon and
  authenticated by name, granted to service_role only. The progress route
  checks ownership itself and answers 404 on a mismatch.
- The by-handle cache read escapes LIKE wildcards (MP-R014).
- The enqueue RPC counts stored rows, not payload rows (0260).
- `reconcileFinishedJobs` closes the link-versus-close race and never moves a
  run backwards.
- The day bucket is claimed before the minute bucket.
- The report page is `robots: noindex` on every branch.
- `loadManagerPulseInput` pages every read and chunks every `.in()` at 200.
- `draft_pick_observations` are written by the On The Clock live poller
  (`lib/on-the-clock/sleeper-sync.ts` line 457), and `draft_selections` by the
  same poller (line 389).
- `player_roster_exposure` is rebuilt by the nightly derived job and iterates
  no leagues.
- The purity guard covers `lib/manager-pulse/` except `discover.ts`, by name,
  with its reason.
- `closeManagerPulseRunLeagues` already updates every run row pointing at a
  job, whichever user owns the run, so cross-user linking needs no worker
  change.

---

## Part 9. Measurement protocol: the real numbers, not the estimates

Every figure in 4.8 is arithmetic. The build replaces it with measurements,
taken the same way every time so the before and after are comparable. The
builder does not report a phase complete without its row below filled in.

### 9.1 The three reference handles

Chosen at MPS-T054 and never changed afterwards. Record them here with the
league-season count the window resolved to on the baseline day:

| Name | Handle | League-seasons in the 4-season window | Chosen on |
| --- | --- | --- | --- |
| SMALL | (fill in) | (fill in) | (date) |
| MEDIUM | (fill in) | (fill in) | (date) |
| LARGE | (fill in) | (fill in) | (date) |

The measuring account is an admin with `adminBypassThrottle` on. Runs are
made on an empty queue, and the queue depth at `t0` is recorded with every
row. A run made against a busy queue is recorded and marked, never used as a
before or after figure.

### 9.2 The runs

One row per (phase, handle, cold or warm). Times are seconds from `t0` (the
page request). "First league" is the first poll where a league finished that
was not already fresh at enqueue. "First live" is the first poll with a live
report version above zero (Phase 3 onward; write "n/a" before it). "Final" is
`t_complete`. "Calls" is the sum of `sleeper_calls` for the run's jobs (Phase
3 onward; before it, write "not counted"). "Calls/min" is calls divided by the
capture duration in minutes.

| Phase | Handle | Cold or warm | Queue depth at t0 | First league (s) | First live (s) | Final (s) | League-seasons | Calls | Calls/min | Commit | Date |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Baseline | SMALL | cold | | | n/a | | | not counted | | | |
| Baseline | SMALL | cold | | | n/a | | | not counted | | | |
| Baseline | SMALL | warm | | | n/a | | | not counted | | | |
| Baseline | MEDIUM | cold | | | n/a | | | not counted | | | |
| Baseline | MEDIUM | cold | | | n/a | | | not counted | | | |
| Baseline | MEDIUM | warm | | | n/a | | | not counted | | | |
| Baseline | LARGE (capped at 60) | cold | | | n/a | | | not counted | | | |
| Baseline | LARGE (capped at 60) | cold | | | n/a | | | not counted | | | |
| Baseline | LARGE (capped at 60) | warm | | | n/a | | | not counted | | | |
| After Phase 0 | SMALL, MEDIUM, LARGE | cold x2, warm x1 | | | n/a | | | not counted | | | |
| After Phase 1 | same | same | | | n/a | | | not counted | | | |
| After Phase 2 | same | same | | | n/a | | | not counted | | | |
| After Phase 3 | same | same | | | | | | | | | |
| After T038 (optional GraphQL) | same | same | | | | | | | | | |
| Final (Phase 4 complete) | same | same | | | | | | | | | |

Add a second-reader row after Phase 3: with LARGE mid-capture for the
measuring account, a SECOND account looks the same handle up, and the row
records that account's first-league, first-live and final times plus how many
jobs its run queued (must be zero).

Add a fairness row after Phase 3: queue LARGE, then immediately queue SMALL
from a second account, and record SMALL's final time beside its empty-queue
final time.

### 9.3 The answer for the owner

Filled in at MPS-T050, from 9.2, cold runs averaged:

| Handle | Baseline final (s) | Final build final (s) | Saved (s) | Saved (%) | Baseline first league (s) | Final first league (s) | First live report (s) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SMALL | | | | | | | |
| MEDIUM | | | | | | | |
| LARGE | (capped at 60) | (at the full count) | | | | | |

LARGE's baseline is a 60-league-season run and its final is the full count,
so the honest comparison for LARGE is seconds per league-season, which the
table must also state. The repeat-lookup saving (warm rows) is reported
separately, as is the second-reader result, because those are the two cases
that used to cost a whole run and now cost nothing.

### 9.4 What counts as a regression

Any phase whose row is slower than the previous phase's row on the same
handle, cold, by more than 10 percent, is not complete until the cause is
found and recorded under the task in `progress.md`. A faster figure with a
higher calls-per-minute than `sync.sleeperCallsPerMinute` is a bug in the
bucket, not a win.

---

## Part 8. The docs folder

Reorganised on 2026-09-05, one folder per feature, moved with `git mv`.
`docs/README.md` is the index and records the old path of every file. Code
comments still cite the old paths (49 references to `docs/manager-pulse-plan.md`,
12 each to the projection engine and Positional WAR plans, a handful of
others); T000 rewrites them.
