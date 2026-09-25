# Handoff

## NEXT SESSION: START HERE. THE IDP SWITCH IS ON (2026-09-25 UTC); NEXT IS IDP-406

- Invariant check passed on the deployed code (every ordinary league
  identical), then the switch went on with DL 0.33, LB 0, DB 0, defense splits
  recomputed, and versions pp-9, war-5, ledger-6 plus the guide copy pushed.
  See IDP-405 in progress.md.
- NEXT: the owner's visual and screen-reader pass; then IDP-406 day-one checks
  (no "No projection" for projected defenders, no "Unknown player" rows, rerun
  the invariant, IndexNow for the guide and gated defender slugs), Search
  Console at 28 and 56 days, then IDP-407 close-out.

## EARLIER THE SAME DAY: PHASE 4 PART ONE (kept for history)

- Phase 3 is still committed locally and NOT pushed. This session's work is
  UNCOMMITTED in the working tree, by instruction. The IDP switch is OFF and no
  production data or settings were changed.
- DONE (details in progress.md, IDP-401, IDP-402, IDP-4R):
  IDP-401 ESLint installed and customised; `npm run lint` is part of the gate
  (typecheck, lint, test, build) and passes with zero errors and warnings.
  IDP-402 backtest: `npm run backtest:idp`, report in
  docs/idp/idp-accuracy-backtest.txt.
- MEASURED, NOT SAVED (IDP-403): DL 0.33, LB 0, DB 0 (owner chose 0 for DB).
  Owner chose to save these in the same step as the switch-on (IDP-405).
- OPEN OWNER DECISIONS:
  1. DB reliability: DECIDED, 0.
  2. CLAUDE.md wording: APPROVED AND APPLIED (IDP-404 done).
  3. Phase 3 and this session are COMMITTED AND PUSHED at the owner's
     instruction. When the deploy is live the owner will ask for
     `npm run verify:idp-invariant`; IDP-405 waits on it and on the go-ahead.
  4. FAAB urgencySignal was dead code (never wired into the output) and was
     deleted; say if it should come back as a real signal.
- Tool gotcha: the file-writing tool turns a typed backslash-u escape into the
  literal character. Generate such text from character codes in a script.

## PREVIOUS: IDP PHASE 4 (launch) WAS NEXT, NOT STARTED (kept for history)

### Where things stand (end of 2026-09-24, seventh pass)

- IDP phases 1, 2 and 3 are all BUILT, REVIEWED AND COMMITTED to main. Phases 1
  and 2 are pushed and deployed. PHASE 3 IS COMMITTED LOCALLY BUT NOT PUSHED
  (owner instruction), so production does not run phase 3 code yet. Check with
  `git status` and `git log origin/main..main` before doing anything.
- The IDP switch, `league_power_pulse_settings.settings.idp.enabled` (row
  id='global'), is OFF on production and must stay off until task IDP-405.
  With it off, every League Pulse number is exactly what it was before phase 3.
- Phase 3 tasks IDP-301 to IDP-317 and the review round IDP-317R are recorded
  at the end of progress.md under "IDP across FF Beacon, phase 3". Phase 4's
  task list (IDP-401 to IDP-407, all pending) is directly below them.
- Last gate: typecheck green, `npx vitest run` 429 files / 6,215 tests (plus
  one plainName test added after that run, green on its own), `npm run build`
  57 of 57, punctuation scan clean over every changed file.
- Migrations: latest on disk and applied is 0302. Phase 3 added none. Next
  number 0303. The plan's "Start here" still says 0295; ignore that.

### What to read, in order

1. CLAUDE.md in the repo root and ~/.claude/CLAUDE.md. Read .env.local and echo
   the variable NAMES only.
2. docs/idp/idp-guide-and-data-plan.md: section 0 (decisions, do not reopen
   without the owner), section 8 (phase 3, what now exists) and section 9
   (phase 4, the work).
3. progress.md from the heading "IDP across FF Beacon, phase 3" to the end:
   what was built, every deliberate deviation with its reason, and the phase 4
   task list.
4. docs/idp/phase-3-invariant-report.txt: switch off against switch on for the
   31 IDP leagues on production, and the 20 ordinary leagues that came out
   identical.

### Before phase 4 can start (owner steps, ask, do not assume)

1. The owner reviews phase 3 and says whether to PUSH it. Nothing in phase 4
   that touches production (IDP-405 above all) may happen until phase 3 is
   pushed AND deployed: flipping the switch against old code turns on nothing
   and still rescores every league.
2. After the deploy, run `npm run verify:idp-invariant` once more; every
   ordinary league must print "identical" and the script must exit 0.
3. The owner has never opened the phase 3 screens in a browser, at phone width
   or with a screen reader. They only render with the switch ON, so this is
   part of IDP-405/406, not before it.

### Phase 4, in order (plan section 9; details in progress.md)

- IDP-401 lint decision: OWNER CHOOSES. Do not install eslint unasked.
- IDP-402 accuracy backtest per position (idp123 against a naive last-4-weeks
  average, 2020 to 2025): findings to the owner.
- IDP-403 set DL, LB, DB positionReliability from measured values only, through
  the admin form.
- IDP-404 CLAUDE.md updates: DRAFT the wording and get OWNER APPROVAL before
  writing. The plan lists the sentences that become false (PROJECTION_POSITIONS,
  the Schedules null-projection paragraph, Power Pulse and Positional WAR
  position statements, the Manager Ledger IDP paragraph, the stale "team deep
  view, future phase" route) plus a new short IDP section.
- IDP-405 switch on and version bumps: OWNER GO-AHEAD REQUIRED, after the push
  and deploy. idp.enabled true; modelVersion pp-9; Positional WAR war-5;
  Manager Ledger ledger-5; decide tf2 (phase 3 left it on purpose, see
  IDP-311); guide lesson 8 and the FAQ answer flip to "yes, in League Pulse".
  Recompute stays on demand through pulseLeague; nothing goes into a cron.
- IDP-406 post-launch checks (day 1, then Search Console at 28 and 56 days).
- IDP-407 final reviews and close-out.
- Reviews at the end: for phases 2 and 3 the owner asked for ONE reviewer
  sub-agent instead of the plan's three. Ask which they want for phase 4.
  Never pass `name` to the Agent tool.

### Known and live today, not caused by phase 3

- Fourth & Violence (sleeper 1361073366127083520), the one league that starts
  only defenders, shows a Power Pulse table of 0.0 points a week with playoff
  odds of 100 or 0 percent while the switch is off. Switching on fixes it.
- 32 man (sleeper 1375706195679019008) shows 0.00 expected wins for all 32
  teams in both switch states. Not an IDP effect; not investigated.

### Open items for the owner (reasons in progress.md)

- FAAB manual mode has no defender picker (IDP-312).
- The FAAB result card shows no idp123 finish line for a defender (IDP-312).
- The Who Should I Start page still refuses a defender before its league tab;
  routing one there is an owner decision (IDP-313).
- R-5 cut protection is deliberately not on the Positional WAR upgrade what-if
  or Who Should I Start, which guard no player at all (IDP-317R item 10).
- Carried from phase 2 and still open: the items listed under "Carried INTO
  phase 3" further down this file, except IDP-308 and the IDP-305 link, which
  phase 3 closed. The DE/DT position normalisation in the players sync was NOT
  done in phase 3.

### Session rules that still bind

One atomic task at a time; typecheck and tests after each; update progress.md
after each; never chain shell commands; plain ASCII punctuation everywhere; no
Claude attribution in commits; do not push or create a branch unless the owner
says so; stop at the end of the phase for the owner.

## PREVIOUS: FINISH IDP PHASE 3 (IDP-315 to IDP-317, then one reviewer), kept for history

State at the end of the session of 2026-09-24 (sixth pass): IDP-301 to IDP-314
are BUILT and recorded task by task at the very end of progress.md under
"IDP across FF Beacon, phase 3". NOTHING IS COMMITTED OR PUSHED, by instruction.
The switch (league_power_pulse_settings.settings.idp.enabled) exists, defaults
to false, and must STAY OFF; phase 4 (IDP-405) turns it on.

Owner instructions for the phase (still binding): finish phase 3, then spawn
ONE independent reviewer sub-agent (bugs, security, performance/speed,
accessibility, plan adherence) over the whole phase 3 diff, fix what it finds,
STOP, and give the owner a plain-language report of what phase 3 did. Do not
commit or push. Do not start phase 4. Never pass `name` to the Agent tool.

Read first: CLAUDE.md (repo and ~/.claude), .env.local (echo names only), plan
docs/idp/idp-guide-and-data-plan.md section 8 (and 0 for the decisions), then
the phase 3 block at the end of progress.md.

### What exists now (the shape a new session must know)

- lib/power-pulse/default-settings.ts: settings.idp.enabled, idpEnabledFrom().
  validate.ts has the zod object; admin form has a "Defensive players (IDP)"
  section.
- NEW lib/power-pulse/idp-reads.ts: idpReadsFor(idpEnabled, rosterPositions,
  scoringBase) returns slotMap, candidatePositions, scoringKeys and
  loadsDefenders (true only when the switch is on AND the league starts a
  defensive slot). scoringKeysArg() passes a bare string when off, so OFF reads
  are byte-identical. EVERY loader threads the switch through this.
- lib/power-pulse/lineup.ts: startingSlots / buildOptimalLineup /
  countStartingSlots take an optional slot map (default OFF map);
  LineupCandidate.eligible (set only when on); pulseEligibility(); playedAsFor();
  LineupSlot.playedAs.
- Callers wired: Power Pulse engine + orchestrator, Schedules (slots.ts,
  matchup.ts, data.ts), Lineups (build.ts, simulate.ts, data.ts,
  season-data.ts, board, swap dialog, optimiser panel, page), lib/projections/
  read.ts (includeDefenders opt-in), NEW lib/idp/free-agents.ts, NEW
  lib/league-lineups/defender-protection.ts (R-5), advice.ts, Positional WAR
  (replacement, engine, load with offense/defense slices at the query and
  CACHE_SHAPE_VERSION v3, fingerprint, orchestrator, panel with Offense and
  Defense charts, dashboard, table, upgrade what-if, action, OG card line),
  Manager Ledger (lineup, engine, load, orchestrator), trade impact (load,
  evaluate, roster-swap, reasons "defender-caveat"), Trade Ideas builder
  (defenders with "No market value" only when on), FAAB (marginal.ts slotMap,
  candidateEligible, protectedIds; league-faab.ts; NEW lib/faab/
  idp-free-agents.ts; actions.ts; combobox), Who Should I Start league impact,
  defender profile "This week" links.
- New goldens: lib/power-pulse/golden/power-pulse-idp-on.json,
  lib/positional-war/golden/war-idp-on.json. All 11 phase-1 goldens are
  unchanged and green (the proof the OFF path is untouched).

### Deliberate deviations and open items (full reasons in progress.md)

- Power Pulse form ratio is now null (components.formUnmeasured) for a league
  that starts slots the model cannot fill, i.e. every IDP league while the
  switch is off. Plan IDP-307 asked for this; it changes IDP leagues' OFF
  output once two weeks settle, and nothing else.
- Admin hint says turning the switch on rescores EVERY league (the stored
  document changes the effective model version); only IDP leagues change.
- Lineups "What is IDP scoring?" link is in the footnotes, not the colgroup
  header (a link there would be re-read on every cell).
- R-5 "starter count" read per roster, not league-wide.
- Not done, stated: trade-finder fingerprint tf2 (suggestions never hold a
  defender, so no bump needed); FAAB manual mode IDP shapes and league-load.ts
  idp123 finishes; the Who Should I Start page still refuses defenders before
  the league tab (league-impact itself now handles one when on; routing is an
  owner decision).
- IDP-314 tests were not re-run after the last edit (typecheck green).

### Next steps, in order

1. LINE ENDINGS FIRST. The working tree is CRLF (core.autocrlf=true) and several
   files edited this session by sed or node appends now mix CRLF and LF lines
   (for example lib/power-pulse/lineup.test.ts, lib/faab/marginal.ts,
   lib/trade-impact/load.ts and evaluate.ts, lib/projections/read.ts,
   lib/league-positional-war-data.ts, app/leagues/[league_id]/lineups/page.tsx,
   app/leagues/[league_id]/positional-war/page.tsx, lib/manager-ledger/load.ts,
   lib/breakdown/league-impact.test.ts, progress.md). Find every modified or new
   file with `git status --short`, and for each one that mixes endings rewrite
   it to a single style with a small Node script (never Python: it writes CRLF).
   Then check `git diff --stat` shows no whole-file rewrites.
2. Run `npx vitest run lib/player-profile components/player-profile` (IDP-314),
   then `npm run typecheck`, then the full `npx vitest run` (last full count
   before this phase: 419 files / 6,143 tests; it should now be higher).
3. IDP-315, tests sweep: plan section 8 lists the modules (lib/power-pulse
   variance tests, lib/league-lineups status/weeks, lib/league-schedule
   lineups/insights, lib/positional-war war, chart-geometry, table, tiers,
   upgrade, scatter-geometry, chart-layout, share). For each: add the IDP case
   where behaviour changed, otherwise record "reviewed, unchanged" in
   progress.md. Also run the guard tests: lib/idp/points-guard.test.ts,
   lib/projections/source-guard and raw-column-guard, lib/positional-war/
   naming.test.ts (WAR token rule), lib/site.test.ts (noun-map ledger: two
   lines were deleted this phase, player-detail-dialog and slot-swap-dialog; the
   trade-finder explain.ts/types.ts lines are still there and were NOT folded).
4. IDP-316: NEW scripts/verify-idp-invariant.ts (+ a test for its pure parts,
   isRunDirectly guard, package.json script). It loads engine INPUTS through the
   existing loaders for about 20 sampled non-IDP leagues and all 40 IDP leagues,
   runs the pure engines (computePowerPulse with idpEnabled false/true,
   computeCurves with league.idpEnabled, computeLedger with idpEnabled) and diffs
   the outputs. It must NEVER call calculateLeague* (those write). Non-IDP: must
   be identical. IDP: write before/after figures (weekly totals, playoff odds,
   efficiency, curves) into progress.md for the owner.
5. IDP-317 gate: typecheck, full suite, `npm run build`, ASCII scan of every
   touched file (no em/en dashes, curly quotes, ellipsis, middle dots, nbsp),
   goldens green with the switch off.
6. Spawn ONE reviewer (no `name`) over the phase 3 diff with the scope above,
   including "no data hidden at any breakpoint" on the Positional WAR Defense
   section, the Lineups board and the Power Pulse rooms, and security on the
   widened upgrade action, the builder's defender assets and the metered
   free-agent panels. Fix findings, rerun the gate, record everything in
   progress.md, then STOP with the plain-language report. No commit, no push.

## PREVIOUS: IDP PHASE 3 START NOTES (kept for history)

SIDE QUEST DONE, COMMITTED AND PUSHED (2026-09-24, fifth pass): every Supabase read that could silently stop at 1000 rows is fixed through the shared helper lib/supabase/fetch-all.ts (RC-T01 to RC-T06 at the end of progress.md, gate green). Phase 3 code should use fetchAllRows / fetchAllRowsInChunks for any read that can pass 1000 rows. After deploy, watch the three items in RC-T06.

State on 2026-09-24: IDP phases 1 and 2, the phase 2 follow-ups (IDP-2R1 to
IDP-2R5) and the Sleeper ADP widening (ADP-201 to ADP-205) are COMMITTED AND
PUSHED to main at the owner's instruction (the phase 2 commit is the one after
e15e17c; see git log). Nothing is left uncommitted from this work. Last gate:
typecheck green, npx vitest run 417 files / 6,129 tests, npm run build 57 of 57.

What to read, in order:
1. CLAUDE.md in the repo root and ~/.claude/CLAUDE.md. Read .env.local and echo
   the variable names only.
2. The plan: docs/idp/idp-guide-and-data-plan.md, all of it. Section 0 holds
   every decision (do not reopen one without the owner), section 2 what the
   audit corrected, section 8 is phase 3 (IDP-301 to IDP-317), section 9 the
   gate and phase 4.
3. progress.md, from the heading "IDP across FF Beacon, phase 1" to the end:
   phase 1, phase 2, the IDP-2R follow-ups and the ADP-2xx tasks. Add phase 3's
   tasks below them in the same format.

Facts the plan text does not have yet:
- Migrations: latest applied AND on disk is 0302 (the plan's "Start here" still
  says 0295). Next number is 0303. Regenerate lib/database.types.ts after any
  schema change (memory note: extract .types, then prettier).
- Phase 3 goal from the plan: every League Pulse model projects, seats, grades
  and suggests defenders when settings.idp.enabled is true, and produces
  byte-identical output when it is false. The switch does not exist yet
  (IDP-301 creates it, default false).
- Reviews: the plan says three phase-end review sub-agents (implementation,
  accessibility, security). For phase 2 the owner asked for ONE reviewer
  instead. Ask the owner which they want for phase 3 before dispatching.
  Never pass `name` to the Agent tool.
- Rules for the session: one atomic task at a time, typecheck and tests after
  each, update progress.md after each, never chain shell commands, ASCII only,
  do not commit or push unless the owner says so, do not start phase 4.

Carried INTO phase 3 (each is recorded in progress.md with its reason):
- IDP-308: filter defender rows out of Positional WAR's projection read AT THE
  QUERY (reverted once because 12 load-test fakes do not model the join; that
  task rewrites the loader and its fakes). Also measure the per-week cache
  entry against Next's 2 MB item limit.
- IDP-305 renders the Lineups IDP group header; it carries the "What is IDP
  scoring?" link to /guides/idp-fantasy-football (IDP-223 left it for then).
- The players sync stored two defenders with position "DE" (Azur Kamara, no
  team; Kendall Donnerson, inactive; Sleeper's fantasy position for both is
  LB). Normalize DE/DT/NT/EDGE, ILB/OLB/MLB and CB/S/FS/SS in the players sync
  when phase 3 touches positions; the IDP guide already folds them.
- lib/site.test.ts allow-lists 22 older position-noun maps as a debt ledger;
  a phase 3 task that touches one of those files folds it into positionNoun
  and deletes its line.
- Phase 2 review items left open for phase 3 or the owner (full text in
  progress.md under "IDP-224 review round"): 8 PositionChip and the hero use
  an aria-hidden code plus an sr-only noun twin, the pattern CLAUDE.md warns
  about on the Lineups board (a cross-surface call, fix it where phase 3 adds
  chips to League Pulse); 10 the reader's IDP leagues read is capped at 200
  memberships; 21 draft grade "N of M" omits unvalued offensive picks; 22 On
  The Clock detail repeats "No market value"; 34 Brief desk snap share is 0-1
  under a % header (pre-existing); 41 offensive team-card span aria-labels
  (pre-existing); 53 guide figure colours are hardcoded hex; 54 the OG team
  card's defender footer needs a visual check; C6 the accuracy rebuild is
  delete-then-insert and leaves a partial table mid-run (pre-existing); C7
  defense-splits recentSeasons swallows an error; a covering index for the
  accuracy scan was suggested, not applied (test on a branch first).

After the deploy of this commit (owner steps, not phase 3 tasks):
- Watch the first nightly stats cron: the projection-accuracy step was made
  concurrent in the phase 2 review and has never run end to end. Check its
  cron_runs record for a finish inside maxDuration 300 s.
- IndexNow for the IDP guide and the defender profile slugs (about 1,558). From
  this machine NEXT_PUBLIC_SITE_URL must be overridden, see the FAAB section
  below for the exact form that works.
- The guide's publishedAt is 2026-09-24; change it if it goes live later.
- Nobody has opened the phase 2 screens in a browser at phone width or with a
  screen reader: defender profiles, the guide's sliders, quiz and figures, the
  Teams tab Defense group, league card IDP tags.
- The Sleeper ADP cron (11:00 UTC) now stores every position; the IDP guide's
  lesson 7 reads it and the cron busts CACHE_TAGS.marketAdp. Nothing to run.

## Sleeper ADP for every position (session of 2026-09-24, fourth pass), DONE

COMMITTED AND PUSHED with phase 2. Tasks ADP-201 to ADP-205 at the very end of progress.md.

- The nightly cron /api/cron/sync-sleeper-market (11:00 UTC) now stores Sleeper ADP for QB, RB, WR, TE, K, DEF and DL, LB, DB. No migration: ADP is a jsonb map per row. Today's partition was filled by a manual run (4,584 rows).
- The IDP guide's lesson 7 reads that data live; the cron busts CACHE_TAGS.marketAdp after each successful run, so the guide shows each morning's numbers. A manual npm run sync:market cannot bust it; the guide then catches up within a day.
- Fixed on the way: On The Clock's ADP lookup was capped at 1,000 rows (about 2,500 exist), and two other market reads paged without a total order. Past draft snapshots are not rewritten.
- Open: two players stored with position "DE" by the players sync (should be DL or LB). Guide handles it; sync should be fixed in phase 3.
- After deploy: nothing to run. The next 11:00 UTC cron writes the next partition with defenders.

## IDP build: phase 2 (session of 2026-09-24, second), DONE, history only

Committed and pushed later the same day at the owner's instruction. Progress per task is at
the very end of progress.md under "IDP across FF Beacon, phase 2". To resume:
read the plan section 7, then the phase 2 block in progress.md, and continue
with the first task not marked completed. When all of IDP-201 to IDP-223 are
done: phase gate (typecheck, npm test, npm run build), then ONE reviewer
sub-agent (bugs, security, speed, accessibility, plan adherence, plus the
phase 1 stats/accuracy cron for safe speed-ups), apply its fixes, then STOP and
give the owner a plain-language report. Do not start phase 3.

PHASE 2 FOLLOW-UP DONE (2026-09-24, third pass), since committed and pushed. IDP-2R1 to IDP-2R5 all completed; details at the very end of progress.md. BEAM: a value, rank or projection question about an unranked player declines cleanly again, without catching bio questions; the projection-source helper no longer crashes outside a Next request. Guide: lesson 7 has sourced round ranges (Sleeper IDP ADP read 2026-09-24 as a dated snapshot, plus IDP+, Fantasy Life, Footballguys), and the replacement-level slider, chase-or-ignore quiz, Custom scoring sliders, rank-group and eligibility figures are built. One scoped reviewer ran; all 12 findings fixed. Gate: typecheck green, 417 files / 6,121 tests, build 57 of 57. NEXT: phase 3, see the top of this file.


## IDP build: phase 1 DONE and LIVE (history only; phase 2 is also done)

Plan: docs/idp/idp-guide-and-data-plan.md. Phase 2 is section 7 (IDP-201 to
IDP-224): defenders across the whole site and the IDP guide. Phase 3 (League
Pulse behind the IDP switch) and phase 4 (launch) follow, each with its own
review stop. Phase 1's task notes are at the end of progress.md under "IDP
across FF Beacon, phase 1"; add phase 2's tasks below them in the same format.

Where things stand (2026-09-24):
- Phase 1 (IDP-101 to IDP-132) is committed (e15e17c), pushed to main and
  deployed. The owner asked for that commit and push explicitly; the plan's
  default for phase 2 is still DO NOT COMMIT, DO NOT PUSH, NO BRANCH unless the
  owner says so.
- Migrations 0296 to 0300 applied; lib/database.types.ts regenerated. The next
  migration number is 0301 (the plan reserves it for IDP-214's BEAM search RPC).
- The post-deploy data runs are DONE (backfill:idp-columns 2026,
  calculate:idp-seasons, calculate:projection-accuracy, faab:priors). Checked
  after them: 13,018 current and future 2026 defender projection lines,
  6,204 idp123 accuracy rows, 300 DL/LB/DB FAAB prior cells, 1,765 2026
  defender season rows. Nothing further to run before phase 2.
- Last full check: typecheck green, 405 test files and 6,028 tests passing,
  npm run build green.

Start-of-session steps for phase 2 (from the plan's "Start here"):
1. Read CLAUDE.md and .env.local (echo the variable names), then the whole
   plan, then the phase 1 section of progress.md.
2. Re-run the section 4.6 live checks and record them. Expected now: defender
   projection rows present (sleeper and ffbeacon), finishes outside the six
   only under idp123, zero active Would You Rather trades holding a defender.
3. Work IDP-201 onward in order; typecheck and tests after every task; phase
   gate (typecheck, test, build) and the review at the end, then STOP.

Carried into phase 2 and 3 (full reasons in progress.md, "IDP-132 review round"):
- Owner decisions, settled 2026-09-24: (a) Would You Rather stays as built:
  the pool refuses any trade with an unpriced asset, and only the three
  defender trades were retired; no further retirement. (b) The two-way DB/WR
  player's two projection rows stay merged into one metadata object.
- Measure the nightly stats cron on production: maxDuration is 300 s and the
  accuracy step alone takes 120 to 145 s beside finishes, splits and the new
  defender seasons step. Check its cron_runs record for a timeout.
- IDP-201: player_idp_seasons is upsert-only; make the rebuild delete rows for
  players who are no longer DL/LB/DB before the search gate reads it.
- IDP-207: rebuild the "No market value" renderers with real render tests (the
  phase 1 tests are source-level), and add the partial flag to Would You
  Rather's admitGradedTrade.
- IDP-211: the live On The Clock room still computes its own ADP value marks
  for a defender pick; the stored snapshot no longer does.
- IDP-308: filter defender rows out of Positional WAR's projection read AT
  THE QUERY (tried in the review round, reverted because 12 load-test fakes do
  not model the join; that task rewrites the loader and its fakes). Also
  measure the per-week cache entry against Next's 2 MB item limit.
- lib/site.test.ts allow-lists 22 older position-noun maps as a debt ledger;
  a phase 2 or 3 task that touches one of those files folds it into
  positionNoun and deletes its line.
- Deviations already made (each explained in progress.md): IDP-102 allow-list;
  IDP-103 keeps PositionColorKey at six (the draft tracker types on it);
  IDP-113 only a BARE IDP map counts as usable scoring; IDP-114 keeps the
  out/unprojected split for defenders; IDP-116 added --idp-only to the
  projection backfill; IDP-117 orchestrator is lib/calculate-idp-seasons.ts;
  IDP-119 skipped the beacon calibration slope list; IDP-123 also keeps
  defenders off the cut list until phase 3's seat test (R-5).

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
