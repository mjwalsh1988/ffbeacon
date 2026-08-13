# Handoff: Beacon Steals (2026-08-12)

## Status summary

**Complete and reviewed.** Nothing committed or pushed, at the owner's request.
No dev server is running.

Beacon Steals: a per-(player, format) score for whether the market is letting a
player fall past where FF Beacon would draft him. Plan of record is
`docs/beacon-steals-plan.md`; the task log is `progress.md` T562 to T577.

Owner scope decision: everything EXCEPT a standalone `/tools` page. The launch
surface is `/guides/fantasy-football-draft-guide`.

- Safe to review: YES. `npx tsc --noEmit` clean, 1612 tests across 116 files
  pass, `npx next build` compiles clean.
- Live in the database already: YES. Migrations 0188 to 0193 applied to prod,
  `lib/database.types.ts` regenerated and formatted, and both data jobs have
  been run against prod.
- Four review sub-agents ran (implementation, security, performance,
  accessibility) and every confirmed finding is fixed. See the "Review pass"
  section at the end of `progress.md`, including what was deliberately not fixed.
- Not committed, not pushed.

## The four failure modes this design exists to prevent

Anyone touching the engine needs these. Two were found before writing code by
running the naive version against production, two during the build. All four are
covered by named regression tests in `lib/draft-value/engine.test.ts` and
`lib/draft-value/verdict.test.ts`.

1. **Deep-board noise.** The raw gap is LARGEST exactly where both numbers are
   least reliable. Guarded by `confidence`.
2. **Cross-position units.** `overall_rank` is a cross-position VALUE rank; ADP
   is a SCARCITY price. Comparing them flags every quarterback in every
   single-QB format (measured: 6 of the top 12). Guarded by the
   points-above-replacement ladder.
3. **Scale.** A ladder INDEX and an ADP are not the same unit. Subtracting them
   made the quarterback artifact WORSE than the naive version (10 of 12).
   Guarded by `projectOntoMarketScale`, which redistributes the market's own
   pick slots in our order.
4. **Whole positions.** Even with the ladder, a VOR model wants elite QBs earlier
   than a one-QB room takes them. That is a strategy claim, not a per-player
   steal. Guarded by subtracting each position's MEDIAN gap before ranking.

Trap 4 has two consequences that read like bugs if you do not know them:

- `value_gap` is the RAW arithmetic and `position_adjusted_gap` is what the board
  ranks on, so a row's two gaps can disagree in SIGN. The verdict explains the
  divergence rather than contradicting its own bucket. Nine rows shipped without
  that clause and were fixed in T577.
- Centering can lift a player with no competitive case, so a steal now also
  requires positive points above replacement, or none measured at all.

## Database state

**Migrations 0188 to 0193 are WRITTEN AND APPLIED TO PROD.** RLS confirmed in
`pg_policies` and verified empirically as `anon` with rollback-wrapped probes.
Next migration number is **0194**.

| Object | Access |
| --- | --- |
| `draft_selections` | service_role only |
| `draft_market_adp` | service_role only |
| `draft_value_settings` | service_role only, seed row `id='global'` |
| `draft_value_targets` | public SELECT + service_role ALL |
| `draft_value_board_formats` (view) | security_invoker, inherits the above |

0192 adds `draft_value_targets.position_adjusted_gap`. 0193 adds the view plus
`league_drafts.picks_captured_at` and `.pick_capture_attempts`.

### Data on prod

- `draft_selections`: **20,955 picks across 139 drafts**, 19,677 carrying a
  format. Pass B of the backfill recovered 13,401 picks from 99 completed league
  drafts that existed nowhere in our database.
- `draft_market_adp`: 2,672 players across 11 cohorts.
- `draft_value_targets`: 4,136 rows, 8 formats, season 2026, model `bs-1`.
  246 steals, 23 swings, 643 fades. `redraft-half-std` and `redraft-std-std` are
  correctly skipped: neither has FF Beacon rankings.

## Commands

```
npm run backfill:draft-selections          # ONE TIME ONLY, never a cron
npm run backfill:draft-selections -- --skip-sleeper
npm run calculate:draft-value              # room ADP, then the board
npm run calculate:draft-value -- --skip-room-adp
```

Nightly: `/api/cron/rebuild-draft-value` at 15:00 UTC, after the rankings, ADP,
and weekly-projection jobs it depends on. Build time is **11 seconds** after the
review pass, down from 48, and no longer grows with database age.

## Known limitations, left in deliberately

- Positional centering uses the MEDIAN, so a skewed position can still show a
  non-zero MEAN afterwards. Switching to the mean would let a cluster of
  genuinely mispriced players hide itself, which is the worse failure.
- 10 of 139 synced drafts carry no format. Their `league_metadata` predates
  migration 0180 and their league is not in `leagues` either, so there is nothing
  to derive from. They are excluded from every ADP cohort.
- Auction drafts are stored but excluded from ADP.
- Rookie-pool boards, guide-page caching, and SQL-side room-ADP aggregation are
  all deferred with reasons in the plan's section 9.
- No backtest yet. DynastyProcess ADP goes back to 2023 and
  `player_positional_finishes` further, so grading last year's board and
  publishing a hit rate is possible. Its own phase.

## Two things for the owner to decide

1. `backfill:draft-selections` is deliberately NOT in `npm run backfill:all`
   (it hits Sleeper and is a one-time recovery), but CLAUDE.md says
   `backfill:all` runs every backfill script. One of the two should change.
2. `text-ink-subtle` (#6B6B7D) fails WCAG AA at 3.68:1 on card fills across the
   whole site. The new files were moved off it; raising the token itself would
   fix it everywhere and is a site-wide change.
