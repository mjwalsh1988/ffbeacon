# Handoff: Trade Finder navigation and bookmarks (2026-08-06)

## Status summary

Complete and self-reviewed. Nothing committed or pushed, at the owner's request.
No dev server is running.

- Safe to review: YES. `npx tsc --noEmit` clean, 1254 tests pass, build clean.
- Live in the database already: YES. Migration 0175 creates
  `trade_suggestion_saves`. RLS was verified against prod inside a rolled-back
  transaction (details below). `lib/database.types.ts` was regenerated.
- No feature flag. Navigation and the renamed search button are unconditional.
  Bookmarks are gated on a session and degrade to a sign-in link.

This session covers T477 to T487 in progress.md, and follows the consolidation
work in T469 to T476 from the previous session.

## The bug that started it

The submit button read "Find another trade" and re-ran a deterministic search
with unchanged filters and an unchanged pass list, which returned the identical
trade. It looked like navigation and it was a no-op. Worst on the league tab,
which server-renders a deal on first paint, so the page opened with a suggestion
visible and a button underneath promising another one.

Three intentions were tangled into two controls. They are now three controls:

- **Search with these settings** re-runs the query, and sits with the filters.
- **Previous / Next** move through the shortlist the server already sent.
- **Not interested** still means refused. **Save for later** means keep.

## What is new architecturally

The action used to return `suggestions[0]` and throw the rest away. It now
returns a window of twelve with their grades. Navigation is therefore pure client
state: no round trip, no rate-limit pressure, and no wait to see a deal that was
already computed. Passing is also instant now, because it splices the deal out of
what is held rather than re-searching.

Grading twelve deals costs one batch of value lookups rather than twelve, because
a league's suggestions come off the same rosters: one resolver built over the
union of their assets answers all of them, and the pipeline after it is pure.
See `gradeSuggestions` in `lib/trade-finder-grade.ts`.

## Two bugs found while wiring this

**The league tab's first paint ignored the consolidation gate.** Its `findTrades`
call never passed the quality config added in T473, so the tab opened on a deal
assembled by plain addition while every later search used the gate. The first
suggestion was one its own Search button could not reproduce. Fixed in
`app/leagues/[league_id]/trade-finder/page.tsx`.

**`givablePool` had a value ceiling nobody intended.** It sorts ascending (the
balancer wants the cheapest package that clears the target) and then took the
first fourteen, which keeps the fourteen *cheapest* assets and discards
everything above. On a deep dynasty roster the engine could not offer a good
player because the good players were never in the pool. The cut now takes eight
from the cheap end and six from the expensive one.

## Security: the one decision worth re-reading

Bookmarks store the whole suggestion, and **the client posts that snapshot**. The
alternative is posting a fingerprint and re-running the whole search to find the
deal it names, which is about 2.5 seconds of database work to record a bookmark.

The argument for accepting it is the one migration 0173 already makes for the
pass list: the row is only ever read back by the person who wrote it, so the
worst a forged one can do is show its author a trade they invented. The Zod
schema in `lib/trade-finder-saves.ts` is bounded hard and `.strict()` throughout,
and that is what stops the column becoming general storage. It does not prove
provenance and the comments say so rather than implying more. 16 tests, each one
a payload the column must refuse.

If you would rather have provenance, it is a one-line change to which function
`saveSuggestion` calls, at the cost of that latency.

## RLS verification (live, zero persistence)

Run against prod inside `begin ... rollback`:

```
anon                          permission denied for table (grant level, not policy)
authenticated user A          sees 1 of 2 rows
A deletes B's bookmark        0 rows affected
A updates B's bookmark        0 rows affected
A inserts a row owned by B    refused by WITH CHECK, nothing written
pg_policy                     5 policies, correct roles and expressions
```

## Decisions you may want to revisit

- **Window of twelve.** Past what anyone pages through in a sitting, and small
  enough that the payload is roughly 20 to 30 KB and the grading batch is one
  round of lookups. `SUGGESTION_WINDOW` in the action, `INITIAL_WINDOW` on the
  page, `SUGGESTION_TAKE` in the cross-league walk. Change all three together.
- **100 bookmarks per user**, checked with a count before insert. That can race
  and leave someone on 101. Acceptable for a bookmark; the exact version is a
  `security definer` RPC doing the count and insert in one statement.
- **No rate limit on save, remove, or list.** They are small writes, RLS-scoped
  to self, and bounded by the per-user ceiling. This matches how `declineSuggestion`
  already behaves. If save turns out to be worth hammering, it goes behind the
  same `claimSlot` helper the searches use.
- **Changing the goal resets the portfolio cursor**, so the walk starts over. The
  alternative leaves every league already visited unexamined under the new goal.

## Not done

- **No browser testing.** Everything is verified by unit tests, typecheck, build,
  and live SQL. Nobody has driven the arrows, the Saved tab, or the sign-in gate
  in a real browser. This is the largest untested surface in the change.
- **Two engine findings deferred, as agreed.** The engine still never builds a
  genuine two-for-two (the incoming side is a single asset except under the
  "Add depth" goal), and picks are only acquirable under "Add picks" or when a
  rebuilding reader is on "Best available". Both are real gaps and both are
  bigger than this change.
- **No keyboard shortcut for the arrows.** The card sits between form controls
  and other buttons, so hijacking left and right there is more likely to surprise
  than help. Easy to add scoped to the card region if wanted.
- **npm audit: 3 high, all pre-existing.** `next`, `postcss`, `sharp`, all
  transitive, package.json untouched. Still deserves its own task.

## Next session, if picking this up cold

Read progress.md from T477. The files that carry the design are
`lib/trade-finder-grade.ts` (batch grading), `lib/trade-finder-saves.ts` (the
bookmark boundary), and `components/trade-finder.tsx` (the three separated
controls). `docs/signal-check.md` covers the consolidation work from last
session and did not need changes for this one.
