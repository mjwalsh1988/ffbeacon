# Handoff

Session of 2026-08-26. Built League Pulse: Positional WAR, from
`docs/league-pulse-positional-war-plan.md`, then closed the review's open items,
ran a performance audit, and did a copy and hover-announcement pass.

This work is COMMITTED and PUSHED. The full task list with live status is in
`progress.md` under "League Pulse: Positional WAR", and the reasoning is in
`docs/league-pulse-positional-war-implementation-review.md`.

## What shipped

The feature: a per-league positional scarcity curve at
`/leagues/[id]/positional-war`, a panel on the Overview and the Power Pulse
page, a rail summary card, a shareable social card at
`/api/og/war/[league_id]`, a Positional WAR note on the Trade Ideas asset card,
an upgrade what-if, an admin settings block, and a parity pass that brought
Power Pulse's observability up to the same standard.

Behind it: the pure model in `lib/positional-war/`, the orchestrator at
`lib/league-positional-war.ts`, cross-league compute sharing keyed by
fingerprint in `positional_war_curves`, and `npm run calculate:positional-war`.

## Database

Migrations 0211 through 0218 are ALREADY APPLIED to production and
`lib/database.types.ts` is regenerated. Do not re-apply them.

- 0211 to 0215: the cache tables, the status columns, the Signal Guide term,
  the shared-curve table, Power Pulse status parity.
- 0216: the projections freshness index, and the drop of a redundant index.
- 0217: Signal Guide pages for the Trade Ideas and Positional WAR routes.
- 0218: the global "WAR (wins above replacement)" glossary term.

Real curve rows exist for several leagues from live testing. They are valid
data, not fixtures.

## Rules this feature added

`CLAUDE.md` carries them in full. The two that catch people:

- The token "WAR" names exactly ONE metric, the player-independent positional
  one, and carries "Positional" adjacent to it. Team-specific work stays
  `winsDelta` / `expectedWins` in code and "projected wins" in copy.
  `lib/positional-war/naming.test.ts` enforces the proximity rule.
- Positional WAR is recomputed ON DEMAND only, through `pulseLeague`. Never wire
  it into a cron. The nightly job's only WAR work is a seven-day prune of the
  shared-curve table, which iterates no leagues.

## Performance, for anyone tuning this next

Measured and fixed this session (numbers and method in the review document,
section 13.5):

- `buildOptimalLineup` precomputes slot eligibility per fill. Thirteen weekly
  fills went from 1,108ms to a 175ms whole engine. Power Pulse, FAAB and Trade
  Ideas run the same optimizer and all benefit.
- The universe loader makes ONE pass over the projection window instead of two.
  1,872-2,062ms down to 719-739ms, verified byte-identical over twelve real
  leagues.
- The warm gate went from seven serial round trips to two waves, 543-557ms down
  to 276-278ms.

Do NOT raise `PAGE` above 1000 in `lib/positional-war/load.ts`. PostgREST caps
this project at 1000 rows per response, so a larger limit silently returns 1000
and the keyset walk's short-page stop condition ends the walk early. The loader
says so at the call site.

## Known follow-ups

- `sm:min-h-0` drops four unrelated controls below a 44px tap target
  (`team-chip-bar`, `brief-sidebar`, `board-editor`). The two Positional WAR
  toggles were fixed; those four want their own sweep.
- The cached universe serializes to 4.9MB for a thirteen-week window, which is
  larger than a hosted Data Cache entry usually allows, so treat the
  memoization as per-instance. Not urgent: `positional_war_curves` already
  shares the expensive compute across leagues.
- `/leagues/[id]/trade-ideas?roster=N` did not finish streaming within five
  minutes on a twelve-team superflex dynasty league. Pre-existing, in the
  trade-finder engine rather than in Positional WAR, and worth its own look.
