# Handoff

Session of 2026-09-01. Build: **League Activity**, the scrollable log of
everything that happens in a league, on the League Pulse overview and on a full
page of its own. Tasks: `progress.md`, prefix `LA-T###`.

This build sits on top of `b052261` (League Relay), which was committed outside
this session while it was running. Nothing in this build is part of that commit.

## State

**Nothing from this build is committed.** The working tree holds all of it.

Green as of the last run:

- `npx tsc --noEmit` clean
- `npx vitest run`: 212 files, 3,302 tests, all passing (121 of them new)
- `npm run build` clean, `/leagues/[league_id]/activity` registered at 818 B of
  client JS (the whole feature is server rendered; that figure is the Link
  runtime)
- Verified against a real league (`1312210128811872256`, GDK): 119 events
  projected from 137 stored transactions, and a repeat sync writes zero

Migrations **0235** and **0236** are applied to the live project
(`cilvpyivysjxpxbudkfa`) and `lib/database.types.ts` is regenerated from 0235.
0236 changes only indexes and a constraint, so the types are unaffected.

Four sub-agent reviews (security, accessibility, implementation, performance)
ran against the finished build. Thirty-eight findings; everything at high or
medium severity is fixed. The full list and the four deliberate non-fixes are in
`progress.md` under "League Activity review outcomes".

## What it is

One table, `league_activity`, one row per detected event, and a feed that reads
it with one indexed query. Nineteen kinds in five filter buckets: Moves,
Results, Lineups, Settings, Managers.

Rows arrive two different ways, and the difference is the whole design:

- **Projected** from tables we already keep. Transactions carry Sleeper's own
  `created_at_sleeper`, so those are marked `exact` and the card prints the
  time. Finished matchups carry settled scores but no clock, so the timestamp is
  derived from the NFL week and the card leads with "Week 6" instead.
- **Detected** by diffing. Lineups, scoring, roster slots, team count, managers,
  owners: every sync used to upsert straight over the previous values, so
  `pulseLeagueCore` now takes a snapshot BEFORE the upsert and `diff.ts` decides
  what the difference means. Those are marked `observed` and the card says the
  window it was spotted in.

## Module map

```
lib/league-activity/
  types.ts     the event and the card, and the line between them
  labels.ts    Sleeper's field names in English, with value formatters
  diff.ts      PURE. the whole detection rulebook. 38 tests
  record.ts    snapshot read-before-write, and the idempotent event insert
  project.ts   transactions and played matchups into events. 28 tests
  writeup.ts   PURE. event plus identities into a card. 55 tests
  load.ts      the paginated read, the day ladder, the filters

components/league-activity/
  activity-visuals.ts   accent and icon name to Tailwind and Lucide
  activity-card.tsx     one entry
  activity-filters.tsx  chips, as links
  activity-panel.tsx    the panel both surfaces render

lib/sleeper-draft-picks.ts     extracted from league-pulse to break a cycle
lib/sleeper-player-lookup.ts   the shared player resolver
```

## Rules this build established

These belong in CLAUDE.md if the feature stays (not added yet, deliberately, so
the wording can be reviewed):

1. **THE FIRST SIGHT RULE.** The first time a league is synced there is no prior
   state, so NO state-change events are written. We did not watch anybody edit a
   lineup, we just met the league.

2. **A STALE COMPARISON IS NOT AN OBSERVATION.** Lineup and reserve events are
   dropped when the window between two syncs is wider than seven days
   (`OBSERVATION_LIMIT_MS`). Settings and people changes survive a wide window,
   because "the trade deadline moved at some point since September" is still
   worth knowing and nothing else records it.

3. **AN EMPTY ARRAY IS NOT EVIDENCE OF AN EMPTY LEAGUE.** `getSleeperLeagueUsers`
   returns `[]` both for a league with no members and for a FAILED request, so
   each half of the diff is gated on its own side of the data being present, and
   a failed snapshot read returns null rather than an empty prior. Without this,
   one throttled request wrote a permanent "manager left" card for every manager
   in the league. Same rule CLAUDE.md already carries for Power Pulse.

4. **A PLAYER WHO LEFT THE ROSTER IS THE TRANSACTION'S STORY.** Lineup events
   only name players held on BOTH sides of the window, so a waiver Wednesday
   produces one card and not two.

5. **THE DEDUPE KEY IS BUILT FROM THE PRIOR SYNC TIME, NEVER FROM `now`.** Two
   server instances rendering the same cold league read the same stored row, so
   they compute the same key and the unique index collapses them. Keying on the
   detection time would post the same swap twice.

6. **ONE CARD PER GAME.** The result key is `game:<season>:<week>:<lowest roster
   id>`, matching how `lib/league-relay/select-matchup.ts` keys a recap, so the
   two features can never disagree about what counts as one game.

7. **NO COMPUTE ON THE READ PATH.** No valuation, no projection, no lineup
   optimisation. Every number a card shows was settled when the event was
   written. That is what lets the panel sit above the power rankings.

8. **NEVER WIRE THIS INTO A NIGHTLY CRON**, same scaling reason as Power Pulse
   and Positional WAR. Detection rides the sync a reader already triggered.

## Deliberate limitations, all of them honest in the UI

- **No commissioner signal exists.** `upsertLeagueUsers` writes
  `is_commissioner: false` for everyone, because Sleeper's `is_owner` means
  "active member" and overloading it would grant force-refresh to every
  co-owner. So `snapshotFromSleeper` CARRIES THE STORED FLAG FORWARD rather than
  recomputing it, and `commissioner_change` can never fire spuriously. The kind
  exists and works the day a real signal does.
- **Whether a game was played is derived, not read.** `league_matchups.is_final`
  is stamped at write time and is false forever for a normally synced league, so
  the projector re-derives finality from the league's own `settings.leg`. See
  `buildMatchupResultEvents`.
- **Result timestamps are derived from the week**, not measured.
  `nflWeekEndUtc` puts week 1 on the first Tuesday on or after September 9,
  which is the real Tuesday after Monday Night Football for every season 2020
  through 2026. It exists to ORDER the feed; the card never prints it as a clock
  time.
- **A league nobody has opened for a month gets no lineup history**, by rule 2.

## Measured, after the fixes

- Activity stage inside `pulseLeagueDerived`: **237 ms** on a cached sync,
  **146 ms** on a forced one, and it writes nothing when nothing changed. It is
  no longer the longest stage in that fan-out.
- The projector's overlap read: **0.17 ms and 27 rows**, against 22.8 ms and
  1,948 rows before migration 0236's index.
- The feed read with a team filter: **0.2 ms, 10 buffers**, served by
  `idx_league_activity_feed` with the roster containment applied as a filter.
- `/leagues/[id]/activity` ships **818 B** of client JavaScript, which is the
  Next Link runtime. The feed itself is entirely server rendered.

## Known follow-ups, none blocking

- **Bursts are not grouped.** A manager who makes eight free agent moves in an
  afternoon gets eight cards. `lib/league-relay/waiver-run.ts` already solves
  exactly this for Discord (group by time gap, digest above a threshold) and the
  same grouping would apply cleanly here.
- **Retention is unbounded.** A single `delete from league_activity where
  occurred_at < now() - interval '18 months'` belongs in the existing nightly
  `recalculate-derived` job, which already prunes `positional_war_curves` and
  iterates no leagues. Roughly 5 M rows and 2 to 3 GB at 10,000 leagues. It is a
  storage bill rather than a latency problem, because every read is prefixed by
  `league_id`. Revisit around 2,000 leagues.
- **No guide entry** for `/leagues/[id]/activity` in `lib/guide/registry.ts`,
  matching `schedules` and `power-pulse`, which also have none.
- **`league-power-rankings.ts` and `league-share-card.ts` still share their own
  private player resolver.** `lib/sleeper-player-lookup.ts` is the shared one
  now and `league-transactions-data.ts` was moved onto it; the other two return
  a different shape and were left alone.

- **Superseded identities are retained publicly.** `team_identity_change`,
  `manager_left` and `roster_owner_change` keep a manager's previous handle and
  team name, on a table anyone can read. Every value was public while it was
  current and the card says nothing without it, but the rest of the sync
  overwrites these rather than keeping them. Worth a decision if anyone ever asks
  to be forgotten.

## Where to pick up

Everything on the task list is done and reviewed, and the four reviews are
answered. The next real decisions are whether burst grouping and retention
pruning are worth doing before this ships, and whether the feature's rules
(the first-sight rule, the observation ceiling, the empty-array rule) should be
promoted into CLAUDE.md alongside the Power Pulse and Positional WAR sections.
