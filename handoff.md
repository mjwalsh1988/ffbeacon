# Handoff

## IDP phase 1 build (IDP-1xx), session of 2026-09-24. BUILT, IN REVIEW

Plan: docs/idp/idp-guide-and-data-plan.md, section 6 (phase 1). Every task and
its notes are at the END of progress.md under "IDP across FF Beacon, phase 1".
NOT COMMITTED, NOT PUSHED, NO BRANCH, by instruction. Stop after phase 1; do
not start phase 2 without the owner.

State: IDP-101 to IDP-132 completed. One independent reviewer ran (the owner
asked for one covering everything); no blockers; fixes applied and the rest
explained in progress.md ("IDP-132 review round"). Typecheck green, 405 test
files and 6,028 tests passing, build green. STOP: owner review before phase 2.
Open owner decisions: review finding 8 (retire other unpriced Would You Rather
trades?) and 12 (metadata shape for the one merged two-way player). Measure the
stats cron's duration on a preview deploy (accuracy step about 141 s).

ALREADY DONE TO PRODUCTION (cannot be undone by discarding the working tree):
- Migrations 0296 to 0300 applied via MCP; lib/database.types.ts regenerated.
- Data runs: players sync (eligible_positions), backfill:sleeper-stats for
  2020 to 2025, backfill:idp-columns for every season, calculate:finishes,
  calculate:idp-seasons --all, backfill:weekly-projections --idp-only 2020 to
  2025, sync:weekly-projections (nightly path, now stores defenders),
  calculate:projection-accuracy, build:projections, calculate:defense-splits,
  faab:priors.
- Three Would You Rather pool trades holding a defender retired (ids in
  progress.md, IDP-130; none had votes).
- IMPORTANT, until this code is deployed: the DEPLOYED nightly projection
  sync still asks Sleeper for six positions, and its stale sweep clears every
  row for a synced week that the run did not touch. It will therefore blank
  the 2026 defender projection rows for the current and later weeks each night
  (points and stat_line to null, availability "unprojected"). Nothing in the
  deployed app reads those rows, so no page changes; the first run of this
  code after deploy restores them. The 2020 to 2025 history is untouched,
  because the nightly sync only sweeps the weeks it syncs.

- The same applies to three other nightly jobs on the deployed code: the
  projection accuracy rebuild deletes and rewrites the whole table without
  idp123 rows; the FAAB priors rebuild removes the DL/LB/DB cells as stale;
  and the stats sync writes new weeks without the typed IDP columns (existing
  rows keep theirs). After deploy, run once: npm run backfill:idp-columns --
  --season 2026, npm run calculate:idp-seasons, npm run
  calculate:projection-accuracy, npm run faab:priors. The finishes rebuild is
  a database function, already updated, so it is correct either way.

Deviations from the plan (each explained in its progress.md entry): IDP-102
guard allow-lists 22 pre-existing wording-variant maps; IDP-103 keeps
PositionColorKey at six; IDP-113 narrows "usable IDP map" to bare IDP maps
(goldens caught the plain OR); IDP-114 keeps out/unprojected semantics; IDP-116
adds an IDP-only fetch; IDP-117 orchestrator is lib/calculate-idp-seasons.ts;
IDP-119 skips the beacon calibration slope list; IDP-123 also skips defenders
from the cut list; IDP-125 test lives beside the capability.

## Session of 2026-09-20 (part two): page widths and the League Pulse season switch

NOT COMMITTED, by instruction. The chopped Power Pulse work from earlier the
same day IS committed (6f2ed87). Tasks PW-T01 and LS-T01 to LS-T05 at the end
of progress.md carry the detail; this says where it stands.

State: typecheck clean, 373 test files and 5,701 tests passing, punctuation
scan clean over every changed file. No migration in this half: the value
freeze needed no new table.

Two things NOT done, both stated rather than hidden:

1. Nothing here has been opened in a browser. The overview cards, the two
   post-season states and every re-widened tool page are verified by typecheck,
   by unit tests and, where there was data to check, against production rows.
   None of them has been looked at.
2. Trade grades on a finished league's Transactions feed still price at
   TODAY's player values, not at the values on the day of the trade. The page
   says so in a line of its own. Fixing it properly means an as-of lookup
   against player_value_history inside lib/trade-analyzer.ts, threaded through
   every caller of analyzeTrade. That is the obvious next piece of work.

Verified against production during the session:

- A completed 2025 dynasty league resolves the right champion and runner-up
  off Sleeper's winners bracket.
- A live chopped league resolves the right elimination (roster 7, week 1),
  correctly flagged as this week's, with 17 alive and 1 out.
- The value freeze holds: a full pulse of a finished 2025 league left
  generated_at exactly where it was, where before this change the 24-hour TTL
  would have recomputed it.

## FAAB overhaul and chopped guide build (FB-T / FB-G)

Session of 2026-09-19. BUILT, REVIEWED, COMMITTED AND PUSHED to main at
the owner's instruction at the end of the session.
Plans: docs/faab/faab-calculator-overhaul-plan.md (FB-T) and
docs/faab/chopped-guillotine-guide-seo-plan.md (FB-G). Every task and its
notes are at the end of progress.md.

### SESSION OF 2026-09-20

Half the list below is now closed. FB-R01 (browser QA at phone width) was done
by the owner. FB-R02 (the IndexNow ping) was run and accepted. FB-R04 (playoff
odds on chopped leagues) and FB-R06 (the unfed reason clause) were built this
session, are NOT COMMITTED, and are written up in full at the end of
progress.md. Migration 0291 IS applied to production and
lib/database.types.ts is regenerated, so the tree and the database agree.

What is left: FB-R03 (finish the review coverage) and the three judgement
calls, FB-R05, FB-R07 and FB-R08, all still recommended to leave. The FB-R04
work is itself unreviewed by anyone but its author and is the newest code in
the tree, so if one reviewer gets scoped at anything, scope it at that diff.

### NEXT SESSION: START HERE

The build is DONE and COMMITTED. Every task in both plans is built, the full
suite passes, and the migrations are applied to production. What follows is
what is left, in priority order, with a recommendation on each. Tracked as
FB-R01 to FB-R08 at the end of progress.md.

Where everything lives:

- The plans of record, both still accurate as intent:
  docs/faab/faab-calculator-overhaul-plan.md (tasks FB-T, list in section 9.2)
  docs/faab/chopped-guillotine-guide-seo-plan.md (tasks FB-G, list in section 9)
- Every task with its status and a note on what actually shipped: the end of
  progress.md, prefixes FB-T, FB-G and FB-R.
- The rules that bind any further work: CLAUDE.md in the repo root and
  ~/.claude/CLAUDE.md. Read both before touching anything.

THE PRIORITY LIST

1. FB-R01, browser QA at phone width. DONE by the owner, 2026-09-20. What it
   covered was the original note: the new result card at 400px, the
   screen-reader announcements against plan 7.14, and prefers-reduced-motion.
   It was the highest risk item on this list because the card is entirely new
   and the owner reads by screen reader.

2. FB-R02, IndexNow after deploy. DONE 2026-09-20, accepted with a 200. The
   command written here does NOT work from this machine, and neither failure
   says so out loud. .env.local pins NEXT_PUBLIC_SITE_URL to localhost, so
   lib/indexnow.ts treats an ffbeacon.com URL as a foreign host, drops it, and
   reports only "Not submitted (status 0)"; and Git Bash rewrites a leading
   slash argument into a Windows path. What worked, in one line:
       NEXT_PUBLIC_SITE_URL=https://ffbeacon.com npm run indexnow -- https://ffbeacon.com/guides/chopped-league-strategy

3. FB-R03, finish the review coverage. The final reviewer ran out of road.
   Unreviewed, meaning unknown rather than known bad: bid-hero, goal-toggle,
   impact-grid, drop-options, week-strip, signal-list, market-card,
   bid-actions, market-stats.tsx, the replay modules and script, the admin
   Replay section, priors-write.ts, loadAuctionHistory and groupAuctions
   against plan 7.5, and the guide copy against section 5 of the guide plan
   (which lists the exact passages that had to change). Recommended AFTER
   FB-R01, because the browser pass catches the same class of problem more
   directly. Scope one reviewer to the UI components only.

4. FB-R04, Power Pulse on chopped leagues (plan finding D3). DONE
   2026-09-20, NOT COMMITTED. A chopped league now runs
   lib/chopped/survival.ts instead of the bracket, writes null into every
   bracket figure rather than a precise meaningless one, drops the schedule
   component out of the score and shares its weight over the other three, and
   scores only the teams still alive. Four new columns (migration 0291,
   APPLIED to production) carry the chop odds, the chance of being last
   standing and the expected weeks alive, and eleven surfaces were changed to
   render them. modelVersion is pp-8, so every league in the product rescores
   on next view.

   Running it against production turned up one thing no test had: an upsert
   leaves behind the row of a roster the run has stopped scoring, which in a
   chopped league is the eliminated team's 0.0 point, 0 percent, last place
   row sitting in a table of live teams. The calc prunes those now, which also
   covers an ordinary league whose roster count shrank. Full write-up in the
   FB-R04 note at the end of progress.md.

5. FB-R05, the zero-dollar bid question. In a league with no minimum bid an
   uncontested claim prices at $0, even for a player who will start. Plan 7.8
   rule 7 and rule 2 can be read against each other. My recommendation is to
   LEAVE IT: $0 is the honest answer when nobody else is bidding, and
   lib/faab/ladder.test.ts pins it deliberately. Change it only if it reads
   wrong to you.

6. FB-R06, the unfed reason clause. DONE 2026-09-20, NOT COMMITTED. The
   injured-starter test that already ran over the reader's own roster is now
   one function and runs over the interested rivals too, so
   rivalsWithStarterOut is fed and the clause can fire. reasons.ts is
   untouched, so the sentence printed is the one already written and tested.
   Not yet seen on screen in a league where a rival really does have a starter
   out at the candidate's position.

7. FB-R07, the bid search cost. bidForTarget calls the simulation once per
   whole dollar and each call scans every run, so a $1,000 budget at 3,000
   runs is millions of iterations per goal. Correct, and measured at about
   two seconds for a whole chopped answer, so it is not a problem today.
   Recommended only if a page ever feels slow.

8. FB-R08, ESLint. npm run lint still cannot run anywhere in this repo: there
   is no ESLint config and next lint drops into its interactive setup. This
   predates the build and is not caused by it. Recommended someday, so the
   gate exists at all; typecheck and vitest are the gates until then.

TWO THINGS A NEW SESSION SHOULD NOT UNDO

- lib/faab/tendency.ts measures a manager as a shrunk deviation from the
  room's own mean log bid, NOT plan 7.6's "divide by heat". The two shrink
  constants differ, so the plan's literal form left identical managers at
  1.12 instead of 1. The code is right and the plan text is unamended.
- The replay prices an auction off the cell for the REAL bidder count, not
  the plan's "count minus one". The cells count total bidders including the
  winner, so minus one priced a contested auction off the uncontested
  distribution. Correcting it moved the value goal from 35.2% to 60.7%.

### State

All 51 FB-T and 14 FB-G tasks are complete. The engine, the chopped model,
the result card, the manual form, the admin panel, the OG route, the replay
and both guides are built, checked and committed.

Of the eight follow-ups, four are closed: FB-R01, FB-R02, FB-R04 and FB-R06,
the last two in the 2026-09-20 session and NOT COMMITTED. What remains is
FB-R03, the unfinished review coverage, and the three judgement calls FB-R05,
FB-R07 and FB-R08.

### VERIFY FIRST results

1. `settings.last_chopped_leg` (plan 7.12.2). NOT the final chop week. In the
   one completed 2025 chopped league (18 teams, 17 eliminations) it reads 17,
   which equals the LAST COMPLETED chop; in 2026 leagues with exactly one
   elimination it reads 1; two 32-team leagues that have chopped twice carry
   null; one 18-team league at week 1 carries 18. It is the most recent
   completed leg and it is unreliable. DECISION: ignore it, per the plan's
   fallback. finalWeek = min(17, currentWeek + aliveCount - 2), and
   `finalWeekVerified` is false so the UI can hedge. Written out in full in
   the header of lib/chopped/league.ts.

2. Waiver position direction on a tie (plan 7.7). INCONCLUSIVE, and the check
   cannot be made to work after the fact. Over 108 two-way ties at the same
   top amount in 2025, the winner held the lower waiver_position number 31
   times, the higher 40 and an equal one 37. `rosters.waiver_position` is
   today's value and Sleeper sends a successful claimant to the back of the
   order, which is most likely what the "higher" bias is. DECISION: pass null,
   so a tie splits 0.5, per the plan's fallback. The reasoning is in the
   comment at the call site in lib/faab/league-faab.ts.

### Numbers from the two runs

`npm run faab:priors`: 1,955 cells from 15,667 auctions across 351 leagues in
8.3 seconds. Bidder-count medians as a share of budget: 0% at one bidder, 5%
at two, 10.5% at three, 20% at four or more; winner over runner-up 2.0 times,
which matches the plan's own audit. Chopped: alive_50p 324 samples across 16
leagues, alive_30_50 53, alive_lt30 31.

`npm run faab:replay`, 1,514 auctions graded across 104 leagues:
value goal wins 60.7% (target 55 to 75, INSIDE), sure goal wins 89.6%
(target 85 to 95, INSIDE), median overpay on the value goal 6.1% of budget
(target under 2%, OUTSIDE).

The overpay miss has a known cause and it is not a calibration problem: the
replay cannot apply the worth cap, because historical rosters are not stored,
and that cap (ladder rules 2, 4 and 5) is exactly what holds the live bid down
to what the player is worth. The script prints that its win shares are an
upper bound. The two chopped buckets with real samples sit at 2.1% and 1.8%.

A SPEC CORRECTION came out of the first replay run and is worth knowing about:
the priors cells count TOTAL bidders including the winner, so the plan's
"bidders from the real count minus one" priced a contested auction off the
uncontested distribution. Using the real count moved the value goal from 35.2%
to 60.7% and the sure goal from 72.5% to 89.6%. The manual-mode mapping in the
plan (Just me to "1", Half the league to "4p") was already consistent with
total bidders and needed no change.

### Migrations

0290_faab_market_priors_public_floor is APPLIED TO PRODUCTION. It floors the
PUBLIC read of the priors table at 5 claims per cell. The table is built with
a cell for every combination, thin ones included, because the fallback ladder
needs to know a cell is thin in order to widen past it, but 152 of the 1,955
cells rested on a single claim and 299 on a single league, and a one-claim
cell is not an aggregate: it is one manager's bid republished as a quantile.
Owner decision 3 allows aggregates and forbids "a single identifiable claim".
The floor is deliberately NOT the admin's display threshold
(priors.minCellSamples, default 30), which an admin may lower: this is a
privacy floor and must not move with a settings change. Verified as anon:
1,555 cells visible, thinnest 5.

0289_faab_market_priors is APPLIED TO PRODUCTION through the Supabase MCP.
pg_policies shows SELECT for anon and authenticated and ALL for service_role;
an anon SELECT inside a rolled-back transaction returned the row and an anon
INSERT was refused with 42501. lib/database.types.ts is regenerated and
prettier-formatted, and the only change to it is the new table.

### Deliberate divergences from the plan

1. FB-T24 is COMPLETE as of 2026-09-19 (see progress.md). The carry lives in
   lib/faab/league-faab.ts, not in the shared projection path, so the other
   four models are untouched. What follows was the earlier state:
   FB-T24 was PARTIAL. `injuredStarters` ships and drives the superflex
   emergency trigger, but `injury.carryOutFromSource` is not implemented: it
   would have to change projectPlayerWeek in lib/power-pulse/project.ts, which
   is the shared projection path behind Power Pulse, Lineups, Schedules and
   the Manager Ledger, and plan section 12 puts changing those models out of
   scope. The setting exists and is admin-editable. This needs its own call.
2. Manual chopped has no survival card. Survival needs a real league's
   rosters, so `chopped` is null there; the chopped controls still drive the
   price through the alive-fraction curve and the danger multipliers.
3. Manual mode prices a chopped league over the regular-season weeks rather
   than to week 17, because lib/faab/outlook.ts has one season window and no
   chopped variant.
4. The guide register entry uses priority 0.8, matching every other content
   guide, rather than the plan's 0.7 (the plan's own line said to match).
5. The league deep view route segment is [league_id], not
   [sleeper_league_id] as both plans write it.

### Checks

- `npx tsc --noEmit`: CLEAN.
- `npx vitest run`: 371 files, 5,666 tests, ALL PASSING.
- A scan of all 92 changed files for em dashes, en dashes, curly quotes,
  ellipsis characters, middle dots, bullets, minus signs and non-breaking
  spaces: ZERO hits. One was found and fixed on the way: the punctuation test
  in lib/faab/reasons.test.ts had had its escape sequences turned into the
  literal characters, so the test that forbids them contained them.
- `npm run lint` STILL CANNOT RUN: the repo has no ESLint config and
  `next lint` drops into its interactive setup. Unchanged since the Relays
  build. Typecheck and vitest are the gates.

### What running it end to end found

The engine was run against a real standard league and a real chopped league
from production data, which caught four things tests had not:

1. `unstable_cache` throws "incrementalCache missing" outside a Next request,
   so any script importing the engine crashed. loadPriorCellsCached now falls
   back to an uncached read.
2. The rival count and the rival table used two different definitions of
   "would start him", so a chopped league rendered "Nobody else would start
   him" above a table of thirteen rivals. There is now one definition.
3. A chopped league was being told we had no stored schedule and therefore no
   playoff odds, which is the same category error as simulating a bracket for
   it. That notice is now standard-only.
4. A reason could print "from 2% to 2%". It now says the figure barely moves
   and gives it once.

### The review, and what it is NOT saying

One review agent ran at the end (two earlier attempts died on a session rate
limit). Nine findings were fixed; the details and the fixes are in the FB-T50
note in progress.md. The blocker was worth the pass on its own: the
empty-the-clip walk-away still read the need control in league mode, so a
radio the page describes as manual-only was moving the most important number
on the card between 75% and 100% of the whole budget.

WHAT THE REVIEW DID NOT REACH. Record these as unreviewed, not as clean:

- Most of the new result UI beyond its structure: bid-hero, goal-toggle
  keyboard and announcement behaviour, impact-grid, drop-options, week-strip,
  signal-list, market-card, bid-actions. In particular NOBODY has checked the
  400px layout, prefers-reduced-motion, the live-region wording against plan
  7.14, or "no data hidden at any breakpoint" on the responsive utilities in
  those files.
- market-stats.tsx beyond its imports and heading levels.
- The replay engine, its loader and script, and the admin Replay section,
  including whether that action and rebuildFaabPriors require admin (the
  building agent says both call requireAdmin; it was not independently read).
- priors-write.ts, so nothing confirms the stale-cell deletion is right.
- loadAuctionHistory and groupAuctions against plan 7.5, beyond their tests.
- The guide side beyond structure, and specifically section 5 of the guide
  plan, which lists the exact passages in /guides/faab-strategy that had to
  change because they described the old behaviour.
- An independent AI-writing pass over the build's strings. Each agent ran the
  check on its own copy and named what it fixed; nobody checked another's.

### Open decisions, not defects

1. An uncontested claim in a league with no minimum bid is priced at zero
   dollars, even for a player who starts. Plan 7.8 rule 7 can be read as
   wanting 1 there, and rule 2 as wanting 0. A test pins the current 0.
2. RESOLVED 2026-09-19. Chopped substitutes are now counted for real: the
   chopped path loads the league's free agents at the candidate's position,
   projects the top 40 through the SAME path the candidate went through, and
   counts those whose rest-of-season mean clears substituteShare of his. A
   failed read leaves the count at zero and simply forgoes the discount,
   rather than reading as "we looked and found none".
3. `rivalsWithStarterOut` is never populated, so the ", k of them with a
   starter out" clause cannot fire.
4. lib/faab/tendency.ts measures a manager as a shrunk deviation from the
   room's own mean log bid, rather than plan 7.6's "divide by heat". The two
   shrink constants differ, so the plan's form left identical managers at
   1.12 instead of 1. The code is right and the PLAN TEXT IS UNAMENDED: do
   not "fix" it back.
5. `bidForTarget` calls the simulation's `winChanceAt` once per whole dollar,
   and each call scans every run. Correct, but on a $1,000 budget at 3,000
   runs that is millions of iterations per goal.

### Known follow-ups

1. Plan finding D3: Power Pulse, Schedules and the League Pulse pages still
   run a head-to-head playoff simulation on chopped leagues, where it means
   nothing. Out of scope here by plan section 12; it needs its own decision.
2. The replay's overpay figure cannot be trusted until the worth cap can be
   applied, which needs historical rosters we do not store.
3. FB-T24's projection carry-forward, as above.
4. IndexNow for the new guide is a POST-DEPLOY step: nothing here is
   committed, so the URL is not live yet.
## Sessions of 2026-09-16 and 2026-09-17: Relays and Briefs, BUILT AND REVIEWED, NOT COMMITTED

Plan of record: docs/beacon-brief/relays-and-briefs-plan.md. Tasks: progress.md,
prefix BD, at the very end of that file. Every task carries its status there;
this file says where the work stands and what a fresh session must know.

Nothing is committed and nothing is pushed, by instruction.

### State

Phases 1 to 5 and the run scripts are done (BD-T001 to BD-T047, BD-T049,
BD-T049b). Five review passes (implementation, security, accessibility,
performance, SEO) are in docs/beacon-brief/reviews/, every finding with a
Resolution line, and their fixes are applied (BD-T090). The 2026-09-17
session, after the 09-16 one ran out of context, confirmed the tree was
intact (tsc clean, full suite green), closed the review items that were
marked "left" but were mechanical, and filled in plan section 22 (BD-T091).
A second review pass then ran (BD-T092): four reports under
docs/beacon-brief/reviews/*-pass-2.md with their fixes applied; the
implementation reviewer was cut off by the session limit and wrote nothing.

THE BUILD IS COMPLETE. There is no feature code left to write. Do not spawn
another review pass over the whole feature: four sessions of budget went to
reviewers re-reading the tree. If a later change needs review, scope one
reviewer to that change's git diff and ask for blocker and major findings
only.

Deploy-order step found by the SEO pass: production still runs the old
commit, so the live pipeline kept publishing per-post articles after the
archive script ran (one is live at /brief/nico-collins-hamstring-injury).
After this tree deploys: `npm run backfill:relays -- --apply` then
`npm run archive:legacy-articles -- --apply` (both idempotent), then confirm
`select count(*) from articles where status = 'published' and article_type
<> 'brief'` is 0.

Migrations 0284 to 0288 are applied to production through the Supabase MCP
and lib/database.types.ts is regenerated.

Production data changed by the build (both authorised by plan section 20):
the Relay backfill (643 published, then 16 more after the grounding rules
were tightened; 64 hidden for the owner in /admin/brief-desk/relays; 194
dropped by the gates; 212 folded) and the archive of 492 legacy articles with
463 redirects. The live pipeline now writes Relays and no articles.

### Facts a new session needs

- The Supabase MCP server was authorised through the owner's browser
  (organisation FF Beacon). A new session may need to re-run the authenticate
  flow; the owner has to open the URL, or Claude in Chrome can.
- Migrations start at 0289 (0288 is the last file).
- BRIEF_DESK_TOKEN is in .env.local and .env.local.example. It still has to
  be added to the Vercel project environment by the owner.
- `npm run lint` cannot run: the repo has no ESLint config and `next lint`
  drops into its interactive setup. Every session has used `npm run
  typecheck` and `npm run test` instead.
- Owner-only tasks (BD-T014, BD-T048, BD-T048b, BD-T050, BD-T051, BD-T052)
  are left pending on purpose.

### What the owner still has to do

1. Review and commit the working tree.
2. Add BRIEF_DESK_TOKEN (the value in .env.local) to the Vercel environment.
3. Decide the Terms page sentence (docs/beacon-brief/reviews/seo.md, M1).
4. BD-T014: watch one day of the live pipeline in /admin/brief-desk/relays
   and /admin/beacon-brief/logs; clear or edit the 64 hidden Relays.
5. BD-T048: write the week 1, 2026 edition by hand in a session (plan 14.3),
   then BD-T048b copies its draft_payload to
   docs/beacon-brief/examples/week-1-2026-brief.json.
6. BD-T050: create the two cloud routines at claude.ai/code/routines with
   scripts/brief-desk/prompt.md and BRIEF_DESK_TOKEN in their environment.
7. BD-T051 and BD-T052 as the plan states.

### Known and deliberately left

Every item is recorded in plan section 22 with its reason. The short list:

- A retracted Relay's permalink renders the retracted notice with noindex and
  a 200, not a 410 (App Router pages cannot set a 410).
- `week` on relays is stored for regular and post season only; pre-season
  posts carry null with the phase reported by lib/relays/week.ts.
- The hub is dynamic; the permalink walks its ancestor chain one query at a
  time; the desk rate limit is keyed on the caller rather than the token;
  `brief_editions` has no partial unique index on the period.

## Session of 2026-09-11: design pass, NOT COMMITTED

A presentation-only redesign of the Who Should I Start result cards, the
toughest-calls grid and the written sections under both Who Should I Start
and the trade calculator. Tasks DSN-T001 onward in progress.md.
No engine, query or migration change. Nothing committed or pushed, by
instruction: the owner reviews first.

Found and left, pre-existing: the Reliability tab lists unplayed and
unsynced weeks as "Did not play" (lib/breakdown/load-extras.ts
loadReliabilityWeeks has no week bound); the BookmarkBar in the site shell
throws a hydration id mismatch in dev; this week's toughest-calls pairs are
exact projection ties, so every card reads "0.0 points clear, 50 percent".

Earlier entries (the SEO build of 2026-09-10 and before) live in the git
history of this file.
