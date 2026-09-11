# Redraft parity, draft grades and the post-draft handoff

Plan of record for the build started 2026-08-31. Task ids are `RD-T###` and their
status lives in `progress.md`. If a session ends mid-build, `handoff.md` says
exactly where it stopped.

## Why this exists

Four separate findings, one theme: the product answers a dynasty question by
default, and a redraft manager is shown numbers that do not decide anything for
them.

1. A regression shipped in `eeb07c5`: `playoff_week_start` is `0` in leagues with
   no playoffs (guillotine, best ball, bracket), and `(x ?? 15) - 1` yields `-1`,
   which filters every week out of Draft Pulse and scores every team zero.
2. The fallback variance figures were measured on the wrong sample. Across the
   startable range, wide receivers ARE more volatile than running backs, and the
   ordering flips again between PPR and standard scoring.
3. A draft grade punishes an empty starting slot as though the slot could never
   be filled. In a redraft league with a live waiver wire and a 15-man roster,
   the best available tight end is a claim away, and treating that hole as
   permanent produced a bad grade for a draft that was fine.
4. A completed draft leaves the reader on a recommendation screen with nothing
   to recommend, and no route into League Pulse, which is where the roster they
   just built actually lives.

## Principles

- **Redraft is not dynasty with the future removed.** Asset value is a
  bargaining tool in redraft, never the scoreboard. Every surface leads with
  projected wins in a redraft league and demotes value to a supporting line.
- **A replaceable hole is not a hole.** Anything scarce enough to be worth
  punishing is scarce on the waiver wire too. Scarcity is measured, not assumed.
- **An award that cannot be won is not an award.** A dynasty-only award is not
  emitted in a redraft league at all, rather than emitted permanently pending.
- **Nothing is invented.** Every number added here is measured from
  `player_stats`, `player_weekly_projections` or the league's own Sleeper
  settings. Where a figure cannot be measured, the surface says so.

## Phases

### Phase 0: the regression (RD-T001)
One guard, matching what `lib/power-pulse/load.ts` already does.

### Phase 1: measurement corrections (RD-T010..T013)
Variance recalibrated on the startable range, made scoring-aware, then
rank-aware. `playoff_round_type` honoured in the bracket simulation.

### Phase 2: waiver-aware roster construction (RD-T020..T023)
The replacement-level idea Positional WAR already owns, applied to the draft
grade. A slot a manager can fill from the wire on Tuesday is scored against the
best freely available player at that position, not against zero.

### Phase 3: redraft emphasis (RD-T030..T034)
Format-aware ordering, labels and grade weights.

### Phase 4: awards (RD-T040..T052)
Drop the unwinnable, repair the weak, add the seven new ones.

### Phase 5: the post-draft state (RD-T060..T064)
A terminal screen that reports the draft and hands the reader to League Pulse.

### Phase 6: review (RD-T070..T073)
Four sub-agent reviews: implementation, security, accessibility, performance.

## Non-goals

- No change to Power Pulse's projection stack beyond the variance figures. The
  QB dispersion question was asked and answered: recalibrate variance only.
- No new cron work. Everything here is on-demand or draft-time, per the
  scaling rules in CLAUDE.md.
- No change to the frozen snapshot contract. A finalized draft stays frozen; the
  new state reads it rather than recomputing it.
