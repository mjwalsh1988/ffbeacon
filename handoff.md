# Handoff: League Pulse integrity fixes

Started 2026-11-13 from a read-only audit of the whole League Pulse tool (seven
reviewers, production checked with SELECT-only SQL). The owner approved all 20
audit items with notes. Task lines: progress.md, heading "## League Pulse
integrity fixes". Nothing is committed until LPI-T12.

## State

Update this table after every task. Status is pending, running or done.

| Task | Status | What |
| --- | --- | --- |
| LPI-T01 | done | Site-wide retry for database reads |
| LPI-T02 | done | Sync foundation: frozen past seasons, week resolution, transaction walk, draft rounds |
| LPI-T03 | done | Pick valuation in team totals, league format matching |
| LPI-T04 | done | Power Pulse engine: league types, playoffs, staleness |
| LPI-T05 | done | Blueprint engine and Market Signals |
| LPI-T06 | done | Trade ideas and trade impact by league type |
| LPI-T07 | done | Transactions and activity views |
| LPI-T08 | done | Manager Ledger and Positional WAR, engine and display |
| LPI-T09 | done | Matchups, Lineups, Leaderboards, engine and display |
| LPI-T10 | done | Power Pulse and league overview display (after T04) |
| LPI-T11 | done | Blueprint display (after T05) |
| LPI-T12 | done | Gate, one reviewer sub-agent, fix findings, commit, push to main |

- Half-finished: none. The build is complete.
- Last gate: passed after the review fixes (typecheck, lint 0/0, 8,347 tests in 621 files, build). Committed and pushed to main.

## Resumed 2026-11-13: T02, T06, T08, T09 were resumed and T10, T11 started. The Paused notes below still describe what each needs.

## Paused 2026-11-13

STOPPED MID-TASK at the session limit: T02, T06, T08 and T09 were stopped by the lead before reporting. Their edits are partial and uncommitted in the working tree. For each: read its spec, read git diff for its owned files, finish what is missing, then run its tests. Expect tsc errors in lineups, trade-ideas, war, leaderboards and relay files until they are finished. T02 already applied its migration to production.


The owner paused the build at the session limit. T11 was started and stopped within a minute (check git status under components/league-blueprint for any stray edit). T10 and T11 have not been built. When resuming: finish any task still marked running, then T10, T11, T12.

What T11 needs from T05 (already in lib/league-blueprint/types.ts):
- BlueprintGrade.grade can be null: show 'Not scored' in the rings, the table and the share image.
- activity has cutsPct, sellCount, cutCount; sellsPct is sells only; the share card data has activity.cutsPct.
- standing.starterSharePct (whole percent or null).
- header has leagueKind, isBestBall, frozenSeasonNote.
- BlueprintLoad failed can carry reason empty-roster with EMPTY_ROSTER_TEXT; the page must render it instead of the generic failed text.

T02 has already applied a migration to production through the Supabase MCP and regenerated lib/database.types.ts (see the newest file in supabase/migrations and git status); its final report had not arrived when this note was written.

What T10 needs from T04 (in lib/power-pulse types and lib/league-power-pulse-data.ts):
- PulseTeam.titleOdds and playoffOdds: 0 to 1, or null in a chopped league.
- PulseTeam.projectedRecord: {wins, losses, ties} or null.
- PulseTeam.playoff: {phase: regular | playoffs | complete, seed, status: alive | eliminated | missed | champion | null, finalPlace} or null.
- PowerPulseView.playoffPhase and championRosterId.
- After the title game the stored result is kept with reason 'season complete, final result kept'.

Open notes from finished tasks:
- T02: migration 0379_league_frozen_at applied. scripts/backfill-league-final-capture.ts was run once in production: 513 of 514 past-season leagues are frozen; one still fails capture and retries on its next view. It made one-line null-week skips in many files outside its set (power pulse, WAR, faab, trade finder, relay, on-the-clock, draft-value).
- T06: the dynasty default (Compete or Rebuild) comes from Power Pulse status only, not the Blueprint archetype. In IDP leagues the card lineup figure covers offense; defenders count through the simulation. It also edited app/actions/trade-finder.ts and trade-impact.ts (a pick lost its originalRosterId) and fixed bookmark saves in lib/trade-finder-saves.ts.
- T08: check in T12 that components/league-lineups/season-context.tsx around line 192 no longer tests for the old dash string the ledger formatters stopped returning. Model is ledger-7.
- T09: future weeks no longer show a win chance (no lineup is set yet); tell the owner. loadScheduleBoard takes the admin client as an optional third argument.
- T10: the rail card (components/league-rail/pulse-favorite-card.tsx, data from lib/league-pulse-favorite.ts) has no playoff phase, so after the title game it still reads as odds. Fix in T12: add the phase and show the champion. Hero size there is still text-2xl.
- T11: the share image infers No pick values from a zero total; no best ball wording on the Blueprint lineup section.
- T04: loadLeague now throws on a read error where it returned null, so check its callers at the gate. lib/power-pulse/legacy-rows.ts filters old chopped rows (pp-6 to pp-8); about 12 other readers of the Power Pulse cache should call it too (T12 reviewer to check). Three goldens regenerated on purpose (offense, idp, idp-on). Model is pp-12. Seeding confirmed in production: division winners seed first; playoff_seed_type 0 is a fixed bracket, 1 reseeds; playoff_type only shapes the losers bracket.
- T03: keeper leagues carry no pick value (its reading of the spec). lib/league-footprint-sync.test.ts had six failures while T02 was mid-edit; recheck at the gate.
- T05: lib/positional-war/naming.test.ts flags the phrase 'WAR is per player' at components/league-war/positional-war-panel.tsx (T08 file): reword the copy, do not edit the test. cadenceDays has no admin field. The profile band chart (lib/player-profile.ts) still uses the daily window for DynastyProcess.
- T07: the feed still lists failed claims, so the Waiver facet count can be lower than the feed total.

## How to resume

1. Read this file, then git status and git diff --stat to see what is on disk.
2. For a task marked running, read its spec below, check which of its items are already in the diff, and finish the rest.
3. T10 and T11 start only after T04 and T05 are done. T12 is last.
4. After each task: update the State table here and its line in progress.md.

## Rules for every task

- Read CLAUDE.md first. ASCII punctuation, American English, one shell command per tool call, no commits, no branches.
- Each task owns the files listed under it. Other tasks run at the same time in the same working tree. Do not edit a file another task owns; if a fix needs one, make the smallest possible edit there and say so in the report.
- Only T02 may add a migration. Any other task that needs a schema change reports it instead.
- Do not edit handoff.md, progress.md, plan.md or CLAUDE.md. The lead session does.
- Reuse what exists: league kind (redraft, keeper, dynasty, chopped, best ball) from lib/league-category.ts and the league row; paging from lib/supabase/fetch-all.ts; times from lib/datetime.ts.
- Every league kind must get figures that fit it: redraft, dynasty and chopped (guillotine), plus best ball and median-game leagues where the spec says so.
- A read error is a failure, never "no rows": throw (or return a failed result), never cache it, never delete a good cache because of it. The server Supabase clients already retry reads at 200, 600 and 1500 ms (lib/supabase/retrying-fetch.ts), so do not add retry loops.
- Copy shown to readers: short, plain words, one sentence, name the number. No text blocks. Visuals carry the page.
- Design pattern: docs/completed/team-blueprint/team-blueprint-plan.md section 10 (lines 1356 to 1440). One hero figure per section (font-mono font-black tabular-nums leading-none text-4xl sm:text-5xl), up to four secondaries (font-mono text-2xl font-black tabular-nums), the rest row figures. Models: components/league-leaderboards/podium.tsx, components/manager-pulse/stat-tile.tsx.
- Accessibility: a figure is one real text node (never aria-hidden copy plus sr-only copy), nulls in words ("No projection", "No market value", never a dash or 0), charts role="img" with a summary and a table under a disclosure, 44 px targets, nothing hidden on mobile without an equivalent.
- Tests: add or update tests for changed math. Never edit a guard.test.ts or naming.test.ts to pass. A golden file may be regenerated only when the change is intended; say which and why.
- While iterating run only your own test files (npx vitest run <paths>). Before reporting run npx tsc --noEmit once and fix errors in files you own; errors in files you do not own belong to another task, list them.
- Report back in under 250 words: what changed per item, files touched, tests run, anything left undone or needing the owner.

## Task specs

### LPI-T01 Site-wide read retry (done)

lib/supabase/retrying-fetch.ts (+ test), wired into the three clients in lib/supabase/server.ts. GET and HEAD only; retries on a thrown request or 502, 503, 504.

### LPI-T02 Sync foundation (audit items 4, 5, 20, part of 1 and 9)

Owns: lib/league-pulse.ts, lib/sleeper.ts, lib/league-matchups.ts, lib/league-draft-selections.ts, lib/league-on-demand-sync.ts, lib/league-maintenance.ts, lib/league-bulk-sync.ts, their tests, supabase/migrations, lib/database.types.ts.

1. Frozen past seasons (owner decision). A league from a season before the current one, whose final capture completed after its season ended, is a snapshot: no Sleeper request for it ever again, no rewrite of its rows, pages read what is stored. Add what is needed to mark it (for example leagues.frozen_at; migration with the Supabase MCP, saved as the next numbered file, types regenerated). Maintenance, bulk sync and on-demand sync skip frozen leagues. A past-season league not yet fully captured gets one last full capture, then freezes. Report how many production leagues freeze.
2. lib/league-matchups.ts resolveCurrentWeek: a null NFL state must not mean week 1. Return null (or a skipped verdict) and make every caller skip the sync and the compute and serve what is stored. Callers live in lib/league-power-pulse.ts:491, lib/league-positional-war.ts:313 and lib/positional-war/upgrade.ts:265 (owned by T04 and T08): make the minimal edit there.
3. Same function, season_type "post": every fantasy week is played, so return MAX_MATCHUP_WEEK + 1. The matchup sync (:145, :260) must never downgrade a stored is_final true to false.
4. lib/sleeper.ts:463-468 transaction walk: when the last scored week bounds the walk, do not stop after three empty weeks; the resume point (stored max week minus 1) must not hit the same stop forever. Production: 130 leagues sit 4 or more weeks behind, 129 complete leagues have zero transactions. After the fix, check a few against Sleeper and say whether a one-time idempotent backfill script is needed (write it under scripts/ if so, do not schedule it).
5. lib/league-pulse.ts:1909-1931 buildBaselinePicks: read settings.draft_rounds instead of assuming 4; no rookie picks for redraft and chopped leagues; drop a season's picks once that season's draft is complete; write the known slot (pick_position or slot) when the draft order is known. :1829-1849 stamp slot and label with the same draft lib/league-drafts.ts chooseDraftPerSeason picks.
6. lib/league-draft-selections.ts:57,159: remove the 250 ms sleep, rely on the Sleeper budget. :208-220: a draft written with zero rows is marked attempted so it is not refetched every sync.
7. lib/league-on-demand-sync.ts:216-222: report a Sleeper timeout as a temporary failure, not "could not find that league"; honor core.syncFailed. lib/league-pulse.ts:626-630: a failed child upsert must not leave the row "syncing".

### LPI-T03 Pick valuation and format matching (items 1, 12)

Owns: lib/league-power-rankings.ts, lib/league-format-resolution.ts, lib/sleeper-to-format.ts, lib/league-pick-position.ts, their tests.

1. league-power-rankings.ts:152-153 and sumPickValues (:479-497): skip picks of a season whose draft is done (same rule as lib/league-view-data.ts:212-217, one shared helper); price each pick by its real slot when known, else the projected slot from lib/league-pick-position.ts, never a blanket "mid"; price picks from context.pickSource so FantasyCalc and DynastyProcess readers get real pick value (today 0 in 2,208 of 2,208 rows each). Redraft and chopped leagues carry no pick value. Fix the comment that says KTC.
2. :258-265 and lib/league-power-pulse-data.ts:216-218 style reads here: throw on error; rank ties get a stable tiebreak.
3. league-format-resolution.ts:303-330: the fallback must weigh TE premium (use pickClosestSupportedFormat from sleeper-to-format.ts:171). sleeper-to-format.ts:49-86: read settings.best_ball and map to the bestball formats; :124 half and standard superflex redraft must not report "exact" when mapped to a PPR format, so the fallback banner shows.
4. After the change, bump whatever version or fingerprint makes stored rankings rebuild on next view.

### LPI-T04 Power Pulse engine (items 3, 10, 11)

Owns: lib/power-pulse/**, lib/league-power-pulse.ts, lib/league-power-pulse-data.ts.

1. engine.ts:299-302, 366: a roster with no players is not a team. Exclude it from scoring, z-scores and bracket slots in every league kind. Chopped keeps its alive-roster rule; redraft and dynasty must both work pre-draft, in season and after.
2. Playoffs (owner: must read right before, during and after). Today the cache is cleared when no regular season weeks remain (league-power-pulse.ts:645-661). Add a playoff mode: simulate from the league's real stored bracket with the playoff-week projections already loaded (:601), eliminated teams read as eliminated, and once the final is played the result is the real champion and final order, kept, never cleared.
3. simulate.ts:180-182 seeding: division winners first where the league has divisions (102 leagues); read playoff_seed_type and playoff_type instead of always reseeding (:192-246). Confirm Sleeper's meaning of each value from stored brackets in production before coding it; say what you confirmed.
4. simulate.ts:210-216 with engine.ts:510-511: playoff rounds use lineups built from weeks 15 to 17 projections, not the regular-season mean.
5. engine.ts:392-427: in the live week, points already scored count; only unplayed players are projected.
6. Staleness (league-power-pulse.ts:280-285): league settings that change the result (playoff teams, scoring, roster slots, divisions) and the projection sync stamp are part of the cache version.
7. Errors as empty: load.ts:1021, load.ts:357 and :393, league-power-pulse-data.ts:193, lib/league-matchups.ts:177-186 callers. Throw; never cache.
8. Old bracket-style rows for chopped leagues from model pp-6 to pp-8 must not be served by any reader without a rebuild.
9. Expose every team's title odds, playoff odds, projected record and the playoff state in the data the page reads, so T10 can draw them. Report the shape.

### LPI-T05 Blueprint engine and Market Signals (items 2, 10, 13, parts of 18 and 20)

Owns: lib/league-blueprint/** (not the components), lib/market-signals/**, app/api/cron/market-signals.

1. grades.ts:84, 93, 101-105: a group with no figure is null ("Not scored"), never 1 of 10, and stays out of the overall. build.ts:113: team count is rosters with players. An empty roster (eliminated chopped team) gets a worded state and is never cached. Grades, archetype and priorities must fit the league kind: no draft capital grade outside dynasty and keeper; chopped reads survival, not playoffs.
2. cache.ts:39-52, 95-145 and data.ts:124: the fingerprint includes the league sync stamp or a hash of all rosters (starters, reserve, taxi) and picks, and honors resynced on the warm path.
3. data.ts:186, 195, 295 and the reads it calls in lib/league-view-data.ts:193-195, 474, 522 and lib/trade-finder-data.ts:156, 181: throw on error (minimal edits in the two files owned elsewhere).
4. market-signals/bollinger.ts:147-155: a minimum band width from settings; under it the signal is hold. default-settings.ts:36: minPoints fits each source's cadence so DynastyProcess readers get signals or a plain "not enough history" line. run-partition.ts:141, 226: a partial latest day does not stamp the partition fresh.
5. strategy.ts:56: a downtier sends a player (not a pick) worth at least TIER_JUMP times the best incoming asset.
6. age.ts:58 compare Math.floor(age). activity.ts:71-78: largest-remainder rounding to 100, cuts counted apart from sells (:42, :76). calls.ts:99-100: the hard-sell note only on a "sell" lean.
7. Reader sentences written here, short and plain: calls.ts:39, 42 ("Priced near his 30-day high" style, no "market band" or "value window"); activity.ts:68 ranks with "of N" and Power Pulse named plainly; partners.ts:124 "of N"; archetype.ts:41-42 keep the starter share of value in the view so the page can print it. Report every type change so T11 can use it.
8. Blueprints cached for past seasons (16 rows): past-season leagues are frozen by T02; make sure the view says it is a frozen season where shown, or is not built.

### LPI-T06 Trade ideas and trade impact (item 7)

Owns: lib/trade-finder/**, lib/trade-finder-*.ts, lib/trade-impact/**, lib/trade-analyzer.ts, lib/league-relay/trade-impact.ts, app/leagues/[league_id]/trade-ideas/**, components/trade-ideas/**, components/trade-finder-card.tsx, components/trade-builder.tsx and the other trade idea components.

Owner's rule: suggestions fit the league kind and the team's situation.
- Redraft and chopped: the goal is winning now. Rank by what the trade does to projected points, projected wins, playoff odds and title odds (survival odds in chopped). Market value is not the driver and is not the headline.
- Dynasty: a mode the reader can switch, Compete or Rebuild (keep a middle option if the code already has one). Compete ranks like redraft; Rebuild ranks on value, youth and picks. The default is inferred from the team's own status (lib/league-team-status.ts, the Blueprint archetype) and the page says which was chosen and why in one line. Map this onto the existing strategy setting; do not add a parallel one.
- Defenders and other unpriced players: left out of the value margin, shown as "No market value", and the call for a deal that includes one rests on projected points and wins.

Fixes:
1. One lineup and projected-wins figure per deal: the card (trade-finder-data.ts:60, 118-145; rank.ts:142-171) and the evaluation under it (trade-impact/evaluate.ts:293-345, 680-696) share one window, one injury map and one method. "Wins before" comes from Power Pulse's cache (evaluate.ts:663-696, 770), the simulation supplies only the change.
2. One shared helper for the value percent (rank.ts:174-180, outcome.ts:280-282, trade-analyzer.ts:489-490).
3. The 2-for-1 consolidation curve applies in ranking (rank.ts:159-161, 737) and in the builder's call (outcome.ts:274-289), matching Signal Check.
4. evaluate.ts:164, outcome.ts:274-289, 329: unpriced assets out of the margin.
5. trade-finder-grade.ts:69, engine.ts:241-249: the grade carries pickPosition and slotEstimated.
6. trade-analyzer.ts:304-332, 482-499: three-team deals net each roster's in and out, or give no verdict.
7. Round 5 and later picks appear in the builder as "No market value" (trade-ideas/page.tsx:1042-1043).
8. Display: one hero per card and per outcome (the figure that fits the league kind: wins added or title odds for win-now, value gained for Rebuild); figures as single text nodes (trade-finder-card.tsx:617-618, trade-builder.tsx:780-781, trade-outcome.tsx:322-351); no aria-label on a plain span (:176-181); "n/a" and "pp" in words; "Value gap" says who gains; fix "3th" (:512). Errors as empty at trade-finder-data.ts:268-275, 327.
9. Keep the order validate, claim a rate limit slot, expensive work. Watch speed: do not add a second simulation per card.

### LPI-T07 Transactions and activity views (parts of 19 and 20)

Owns: app/leagues/[league_id]/transactions/**, components/transaction-filters.tsx, components/signal-check-trade-card.tsx, components/league-activity/**, lib/league-activity/**, lib/league-transactions-data.ts, lib/league-transaction-volume.ts.

1. Past trades are graded at today's values: say so always, in one short line (transactions/page.tsx:267-276, signal-check-trade-card.tsx:406).
2. lib/league-activity/load.ts:210 with the 40-row cap: a category is not disabled as empty when the list was truncated. :131-133 order gets a unique tiebreak. Facet counts leave out failed claims, matching the volume panel.
3. transaction-filters.tsx:313-315 announces the result count; targets at :167, 177, 210, 253, 290 and activity-filters.tsx:170, 212, 225 are 44 px; aria-label on plain spans (signal-check-trade-card.tsx:170-175, transaction-filters.tsx:154-159) becomes real text.
4. Chopped and redraft leagues: no dynasty-only wording or pick talk where the league has no picks.

### LPI-T08 Manager Ledger and Positional WAR (items 8, 15, parts of 9, 17, 18, 19)

Owns: lib/manager-ledger/**, lib/league-manager-ledger*.ts, lib/positional-war/**, lib/league-positional-war*.ts, lib/trade-impact/positional-war-context.ts, components/manager-ledger/**, components/league-war/**, app/leagues/[league_id]/decisions/**, app/leagues/[league_id]/positional-war/**.

Ledger:
1. manager-ledger/load.ts:166 (and the roster read it shares): throw on error; lib/league-manager-ledger.ts:689-692 clears the cache only after a successful empty read.
2. Best ball leagues (22 cached): no lineup grading, no "Sharpest lineups"; show what still applies (waivers, trades).
3. load.ts:157-165: record, wins left behind and scoring rank use regular season weeks only (before playoff_week_start) and include the median game where league_average_match is on (313 leagues). Chopped leagues have no head-to-head record: grade decisions against the weekly cut line instead, or leave the record out.
4. moves.ts:115-124: a claim's points end at the next drop. :282, 289: trade net uses started points, same basis as waivers.
5. fingerprint.ts: add a digest of ineligible (IR, taxi) ids and summed official points.
WAR:
6. upgrade.ts:400 use rosterIsFull (lib/faab/league-faab.ts:583). :250-260 default target is the best free agent; a rostered player is offered as a trade target and labeled so.
7. tiers.ts:102-103 wording matches replacement.ts:172 (short, plain). :173 the Starter floor uses a low percentile. Copy says WAR is per player and does not add up to a team total.
8. The weeks covered ("Weeks 10 to 14") beside the heading. After the regular season ends (league-positional-war.ts:731) keep and show the last result with its weeks instead of clearing. Past seasons are frozen by T02.
9. league-positional-war-data.ts:200, 324: throw on error, chunk the .in() list.
Display (both pages): one hero per section per the pattern (decisions/page.tsx:470-505, ledger-headline.tsx:43, war-player-table.tsx:422, upgrade-panel.tsx:203, 212); single text nodes (ledger-table.tsx:71-74, 261-264, ledger-detail.tsx:228-229); nulls in words (war-player-table.tsx:412, 429, 442); dashboard charts role="img" with summary and table under a disclosure (war-dashboard.tsx:13-17, positional-war-chart.tsx:521, war-scatter-chart.tsx:238); one short plain line each for "Pts over repl.", "Wins/wk", "Scarcity", "Replacement level", "Started", "Left behind".

### LPI-T09 Matchups, Lineups, Leaderboards (items 6, 14, parts of 9, 17, 18, 19)

Owns: lib/league-schedule/**, lib/league-lineups/**, lib/league-leaderboards/**, lib/league-season/**, lib/chopped/**, components/league-schedule/**, components/league-lineups/**, components/league-leaderboards/**, components/league-season/**, app/leagues/[league_id]/matchups/**, lineups/**, leaderboards/**.

1. Chopped leagues (565 of 1,630): no head-to-head anywhere. Lineups (league-lineups/data.ts:499-515, 684-690; week-recap.tsx:91-150) frames the week around the cut line: your score, the lowest score, your margin and your chance to survive. Matchups board has no "Won" (league-schedule/data.ts:267); Leaderboards has no "Games that stood out" (build.ts:337-356, leaderboards/page.tsx:481-488). league-season/phase.ts:140-145 names the champion the way chopped/survival.ts:183-190 settles a season.
2. Best ball leagues: no start/sit advice or optimizer; say the lineup sets itself.
3. lineups/page.tsx:566-582, league-lineups/status.ts:65: after Thursday the optimizer, waiver and cut panels stay; locked players keep their banked points and only unlocked slots are optimized.
4. One win chance: your set lineup against their set lineup, conditioned on points already scored, used by the board (league-schedule/data.ts:311-323, 235-237), the matchup detail (matchup.ts:612, matchups/[week]/[roster_id]/page.tsx:757) and the Lineups what-if (league-lineups/data.ts:501-512, simulate.ts:254). It moves as games finish.
5. matchup-row.tsx:103, 247-258: "Projected" means the set lineup everywhere; the best-lineup figure, if kept, is labeled as such.
6. Two-week playoff rounds (playoff_round_type, 41 leagues): results, recap and leaderboard games add the legs (data.ts:267, recap.ts:141, leaderboards/build.ts:354).
7. league-lineups/season-data.ts:256-288 against season.ts:192-206: compare projected and actual over the same starters.
8. Errors as empty: league-leaderboards/load.ts:214 (do not cache an empty view built on a failure), league-schedule/data.ts:108-146.
9. matchup-row.tsx:136 and the detail page :750: an unpaired roster in a playoff week is a bye or eliminated, not "odd number of teams". insights.ts:140-146: luck uses regular season weeks only, with one plain line defining it. leaderboards/build.ts:155: a rostered player's zero-point game counts as a game once the week is final.
10. Display: win-prob-bar.tsx:94-133, 168 single text nodes. Heroes per the pattern: win chance, board score (matchup-row.tsx:256), recap scoreline (week-recap.tsx:100), points left on the bench (optimizer-panel.tsx:105, lineup-summary.tsx:238), champion card, podium (podium.tsx:141).

### LPI-T10 Power Pulse and overview display (items 17, 18, 19; after T04)

Owns: components/power-pulse/**, components/power-rankings-row.tsx, components/league-rail/**, components/league-overview/**, app/leagues/[league_id]/power-pulse/**, app/leagues/[league_id]/page.tsx, app/leagues/[league_id]/teams/**.

1. Every team's title odds and playoff odds are visible without expanding a row; heroes per the pattern (projected-champion.tsx, pulse-favorite-card.tsx:125, the rankings and standings tables). The overview table (page.tsx:1469-1503) shows odds beside the Pulse score.
2. Playoff states from T04: before (odds), during (bracket odds, eliminated teams), after (champion, final order). Chopped shows survival, not playoffs. Redraft and dynasty wording fits each.
3. projected-champion.tsx:386-398 single text node. Nulls in words (pulse-detail.tsx:43, 48; pulse-rankings-table.tsx:53, 210, 251, 263, 438; projected-standings.tsx:143-172); "under 1%" instead of "0%".
4. One short plain line each for "Pulse", fractional projected records, "Lineup", "Starter reliability", "opp".
5. Overview activity: page.tsx:963, 996 passes the truncated flag T07 adds.

### LPI-T11 Blueprint display (items 16, 17, 18, 19; after T05)

Owns: components/league-blueprint/**, app/leagues/[league_id]/blueprint/**, app/api/og/blueprint/**, components/trend-chip.tsx.

1. Section order: Standing, The plan, Buy sell hold, Trade strategy, Grades, then lineup, depth, shares, age, movers, spotlight, draft capital. Renumber.
2. gauge.tsx: visible label "Recommended trade activity", one line giving the Low, Moderate and High cut points, drawing aria-hidden with the text as the one figure. calls-panel.tsx:81, 162, 225: a Cuts figure beside Sells; :182-184 the points-short figure is a row figure.
3. Null grade from T05 reads "Not scored". capital-panel.tsx:50: "No pick values" when every pick is unpriced. lineup-table.tsx:129: "No call" in the Call column. trend-chip.tsx:37 with movers: the percent shows when delta is null. movers-panel.tsx:37 and card.tsx:645: "No player moved enough to list."
4. standing-panel.tsx:38, 42: "Team direction" and "Roster shape", with the starter share number T05 keeps. shares-panel.tsx:38 secondaries at text-2xl font-black; :48 "percentage points". strategy-panel.tsx:70-84 "Value change", "Projected wins change". age-chart.tsx: ages printed at the bar ends, role="img" with summary.
5. Share image (card.tsx): Bench and Draft capital spelled out, same null words as the page, gauge ticks from the admin band settings (:458). grade-rings.tsx:90, lineup-table.tsx:38 scroll regions focusable with a name.
6. League kinds: sections that do not apply (draft capital in redraft and chopped) are left out, not shown empty.

### LPI-T12 Close out

Gate in order: npm run typecheck, npm run lint (0 errors, 0 warnings), npm test, npm run build. npm run verify:idp-invariant (League Pulse loaders changed). One reviewer sub-agent (owner's count) covering new bugs, wiring, security, speed. Fix what it finds. Update progress.md and this file. Commit in the owner's voice with no Claude attribution, push to main.

## Owner decisions recorded

- Past-season leagues are frozen snapshots and are never synced again (T02).
- Trade ideas: redraft and chopped rank on winning now; dynasty has Compete and Rebuild with the default inferred from the team (T06).
- Explanations stay short and plain; visuals carry the page.
- The league-relay cron (app/api/cron/league-relay, every 15 minutes) is the one approved exception to the no cron iterates leagues rule; the Discord bot depends on it. Recorded in CLAUDE.md.

## Left for the owner

- Done 2026-11-13: the 377 old chopped Power Pulse rows (22 leagues, 2026 season) were deleted from league_power_pulse_cache; each league rebuilds on its next view.
- app/leagues/[league_id]/page.tsx reads the Power Pulse view three times per request (it did before this build).
- One past-season league still fails its final capture and retries on its next view.
- cadenceDays (Market Signals) has no admin field; the player profile band chart still uses the daily window for DynastyProcess.
- Keeper leagues carry no pick value in team totals.
- No browser pass was done on the changed pages.

## Blocked

- nothing blocked
