# Handoff

Session of 2026-08-31. Build: redraft parity, draft grades and the post-draft
handoff. Plan: `docs/redraft-and-draft-grades-plan.md`. Tasks: `progress.md`,
prefix `RD-T###`.

## State

**Nothing from this build is committed.** The working tree holds all of it. Two
commits from earlier in the session are already on `main`:

- `4bd7d40` cron health (kickoff gate, ledger prune)
- `eeb07c5` power pulse and on the clock audit fixes

Green as of the last run: `npx tsc --noEmit` clean, `npx vitest run` 3,045 tests
across 199 files.

## Done, RD-T001 through RD-T062

**Phase 0, the regression.** `playoff_week_start = 0` (four synced leagues have
no playoffs) yielded a through-week of -1, which filtered every week out of Draft
Pulse and scored every team zero. `regularSeasonThroughWeek` in
`lib/on-the-clock/pulse-service.ts`.

**Phase 1, measurement.** `lib/power-pulse/variance-curve.ts` replaces one
volatility number per position with a measured curve keyed on the player's own
projected points AND the league's scoring base. Receivers are more volatile than
running backs across the whole startable range; the old sample had it backwards
because it weighted RB25-48 committee backs equally with bell cows.
`playoff_round_type` is honoured in the bracket (`lib/power-pulse/simulate.ts`).
Model version **pp-4**, WAR version **war-3**.

**Phase 2, the waiver problem.** `lib/on-the-clock/waiver-replacement.ts`. An
empty starting slot is scored at the best unrostered player rather than zero, so
a redraft draft with no tight end costs the difference between two tight ends
instead of a whole slot. Stays correctly brutal where the position is genuinely
gone. The grade's construction component now measures how much of a team's
output comes from players it does not own. Draft Pulse version **otc-pulse-3**.

**Phase 3, redraft emphasis.** `lib/league-emphasis.ts`. Format-aware grade
weights (`redraftWeights`): redraft grades ~42% on the lineup against dynasty's
~30%, and the market drops from ~32% to ~21%. Rankings table and trade verdict
tabs rename the value column in redraft.

**Phase 4, awards.** `first-starting-roster` retired (kept as `RetiredAwardId` so
old snapshots still render). `long-game` is not emitted at all in redraft rather
than emitted permanently pending. `most-reliable` gated on a spread worth
reporting. Seven new: `round-steals`, `most-balanced`, `most-top-heavy`,
`bye-week-nightmare`, `against-the-room`, `late-round-haul`, `toughest-schedule`,
`positional-war-winner` (titled "The Cliff Edge Award", category "Best Scarcity
Read", deliberately NOT called WAR in any copy per the CLAUDE.md naming rule).
**AWARDS_VERSION 3.**

**Phase 5, the post-draft screen.** `app/tools/on-the-clock/draft-complete.tsx`
replaces the recommendation surface once the draft is over, and hands the reader
into League Pulse.

## Not done

- **RD-T043** dropped, with reasoning recorded in `progress.md`. A trade is a
  value exchange in every format; the redraft complaint was about team quality,
  not about trades.
- **RD-T063** deferred. The "what changed since your draft" banner is built and
  the prop is wired as `null`, so it never renders. What is missing is the count:
  compare the reader's players against `projection_snapshot_date` to find the
  ones whose injury designation moved. Small server read, deliberately not faked.
- **RD-T070 to T073** the four sub-agent reviews were in flight when this was
  written. Whatever they found is in the session report.

## Things a fresh session must know

- The stored `league_power_pulse_settings` row OVERRIDES code defaults and is a
  byte-for-byte echo of the old pp-2 defaults. `npm run sync:power-pulse-settings`
  advances it to whatever the code holds (it reads the defaults at run time, so
  it carried pp-3 and pp-4 with no edit). **It must run AFTER a deploy, never
  before**, or production stamps caches with the new version while still running
  the old model.
- Migration `0233_on_the_clock_projection_vintage.sql` is already applied to
  production. No new migration was needed for this build.
- Do not commit or push. The owner reviews the report first.
- Update `progress.md` after every atomic task.
- The awards engine is long. `computeDraftAwards` emits in a fixed order and
  `lib/on-the-clock/awards.test.ts` asserts that order; a new award must be added
  to that list or the test fails, which is the point.
