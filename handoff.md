# Handoff

## Session of 2026-09-11: design pass, NOT COMMITTED

A presentation-only redesign of the Who Should I Start result cards, the
toughest-calls grid and the written sections under both Who Should I Start
and the trade calculator. Tasks DSN-T001 onward at the end of progress.md.
No engine, query or migration change. Nothing committed or pushed, by
instruction: the owner reviews first.

Found and left, pre-existing: the Reliability tab lists unplayed and
unsynced weeks as "Did not play" (lib/breakdown/load-extras.ts
loadReliabilityWeeks has no week bound); the BookmarkBar in the site shell
throws a hydration id mismatch in dev; this week's toughest-calls pairs are
exact projection ties, so every card reads "0.0 points clear, 50 percent".

## Session of 2026-09-10

Build: Who Should I Start, the trade calculator slug,
IndexNow, and the site SEO audit. Plan of record:
docs/seo/who-should-i-start-and-site-seo-plan.md. Tasks and every deviation:
progress.md, prefix SEO-T###, at the very end of that file.

The previous entry (the site speed build, session of 2026-09-08) lives in the
git history of this file.

## State: COMPLETE, NOT COMMITTED

Every task in plan section 6 is done, all five reviews ran and their findings
were fixed (SEO-T990 to T995), and the final checks passed (SEO-T996):
npm run build succeeds, npx tsc --noEmit reports zero errors, npx vitest run
passes 330 files and 5020 tests. Nothing is committed and nothing is pushed,
by instruction. No database migrations are part of this build.

## What the owner still has to do

1. Review and commit the working tree (git status shows the renames of
   app/tools/signal-check to app/tools/trade-calculator and
   app/tools/beacon-breakdown to app/tools/who-should-i-start).
2. After deploy, per plan 2.15: curl -I /tools/beacon-breakdown,
   /tools/signal-check and /tools/signal-check/v/<id> and confirm a 308 with
   the query string kept; open /tools/who-should-i-start logged out and check
   view-source for the H1, the Week line, the toughest calls and every H2;
   run the Rich Results test; npm run indexnow for the new URLs (the key file
   public/<key>.txt must be live first); request indexing in Search Console
   and resubmit the sitemap.
3. Before or soon after launch, per the plan's research note: run the four
   head terms through a logged-out US Google session and note who the AI
   Overview cites.

## Known and deliberately left

- npm audit: two advisories in the postcss that next pulls in; the only fix
  is a major next upgrade, which needs its own tested change.
- Deferred performance items, with reasons under SEO-T994: league-impact's
  sequential awaits (opt-in, rate-limited, cached), the player summary's
  uncached rankings read (parallel, adds no latency), per-player trade RPCs
  (parallel, capped).
- lib/beam/capabilities/player-value.ts multiplies change_30d_pct by 100 a
  second time. Found during this build, outside its scope, not fixed.
- One sub-agent ran git stash and git stash pop mid-build; checked at the
  time, nothing was lost.
