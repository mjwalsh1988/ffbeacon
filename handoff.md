# Handoff

Session of 2026-08-21. Building two League Pulse features from
`docs/league-pulse-schedule-and-trade-ideas-plan.md`:

1. A **Schedule** section inside the league deep view (week view, team view,
   quick stats rail, and a matchup detail with both starting lineups side by
   side plus bench and taxi upgrades).
2. **Trade Finder becomes Trade Ideas**: same suggestion engine, plus a real
   explanation of what a deal does to your team, plus a builder for any trade
   you want checked.

Nothing has been committed. Baseline before this session: 124 test files, 1780
tests, all green, `npx tsc --noEmit` clean.

## State right now

**COMPLETE.** Built, reviewed by four agents, and every HIGH and CRITICAL finding
fixed. Nothing committed or pushed.

| Check | Before | After |
| --- | --- | --- |
| `npx vitest run` | 124 files, 1780 tests | **135 files, 1980 tests, green** |
| `npx tsc --noEmit` | clean | clean |
| `npx next build` | clean | clean |

Tasks T626 to T673 are recorded in `progress.md`. The full write-up is
`docs/league-pulse-schedule-and-trade-ideas-implementation.md`.

Four new routes:

```
/leagues/[league_id]/schedules
/leagues/[league_id]/schedules/[week]/[roster_id]
/leagues/[league_id]/trade-ideas          (308 from /trade-finder)
/api/og/matchup/[league_id]/[week]/[roster_id]
```

## What is left

1. **Commit and push.** Deliberately not done; the owner asked for the work only.
2. **T664, saving a built trade, is BLOCKED on purpose.** The existing
   `savedSuggestionSchema` is `.strict()` and demands `acceptance`,
   `qualityRatio`, `score`, `headline`, `whyYou`, `whyThem`, `pitch`. A built
   trade produces none of them, and filling them would put an invented acceptance
   band on a card nothing graded. The schema was NOT widened. Decide what a saved
   built trade is first; the answer is a stored `TradeImpact`, not a stored
   `TradeSuggestion`.
3. **Browser check.** Nothing here has been opened in a real browser or against a
   real screen reader. Worth doing on a 12-team superflex league, an IDP league,
   an odd-team league, and a completed past season.

## Things a new session must not get wrong

- **Power Pulse must not move.** T626 changed a table Power Pulse reads. The
  safety argument is that `asStringArray` in `lib/power-pulse/load.ts` already
  drops `"0"`, so the read side is unchanged. T669 is the test that holds that
  line. If T645 (the FAAB simulation extraction) makes any test under
  `lib/faab/*.test.ts` fail, the correct move is to revert
  `lib/faab/league-faab.ts` and let Trade Ideas carry its own copy. Never edit a
  FAAB test to accommodate the extraction.
- **Rate limiting covers the render path, not just the action.** The Trade Ideas
  page decodes a trade out of its own URL and evaluates it during render. That
  is an entry point. `claimTradeEvaluationSlot()` from
  `lib/trade-impact/rate-limit.ts` must be called there too, and validation runs
  BEFORE the claim so a stale link cannot burn a reader's budget.
- **Plain ASCII everywhere.** No em-dash, no curly quotes, no ellipsis
  character, in code, comments, UI copy, or aria-labels.
- **No data hidden at any breakpoint.** Compact mobile layouts, never reduced
  ones. 44x44 minimum tap targets.
- **A null projection is not a zero.** A player Sleeper does not publish gets
  `null` and the words "No projection". A zero looks like an answer.
- Clear `.next/types` after a route rename or `tsc` reports phantom errors for
  the old path.
