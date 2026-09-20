# FAAB calculator overhaul: audit, decisions and build spec

Status: APPROVED PLAN, NOT BUILT. Written 2026-09-19. Owner decisions recorded in section 1.
Page: `/tools/faab`. Engine: `lib/faab/`. Companion content plan: `docs/faab/chopped-guillotine-guide-seo-plan.md`.

This document is written so a brand-new session with no memory of the planning conversation can build the whole thing. Nothing in it should need guessing. Where a fact could not be verified during planning it is marked VERIFY FIRST with the exact check to run.

---

## 0. Read this first (fresh-session protocol)

Do these in order before writing any code.

1. Read `CLAUDE.md` in the repo root and `~/.claude/CLAUDE.md`. Both are binding. The rules that bite hardest on this build:
   - Read `.env.local` first and echo back only the variable NAMES. Supabase keys are `SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY`. Never use anon or service_role key names.
   - One shell command per tool call. No `&&`, `;`, `||` chaining, no `cd x ;` prefixes.
   - No em dashes, en dashes, curly quotes, ellipsis characters or middle dots anywhere: code, comments, copy, commit text, docs. Plain ASCII punctuation.
   - Screen reader owner: plain text in chat responses, no bold, no headings, code in code blocks.
   - Every timestamp shown to a human goes through `lib/datetime.ts` (America/New_York).
   - Every new table ships its RLS policies in the same migration; regenerate `lib/database.types.ts` after every schema change.
   - Every read of `player_weekly_projections` or `player_projection_accuracy` names exactly one source, resolved through `lib/projections/source.ts resolveProjectionSourceForWindow`.
   - Never run the optimiser per player inside `lib/positional-war/`; never trigger a Power Pulse, Positional WAR or Manager Ledger compute from this feature. Read their caches only.
   - Sub-agents: never pass `name` or `team_name` to the Agent tool.
2. DO NOT COMMIT. DO NOT PUSH. DO NOT CREATE A BRANCH. The owner reviews and commits by hand. This holds for every task in this document, including the last one, and including when a tool or template suggests committing. When the build is finished, stop with the working tree dirty and report.
3. Read this whole document once, then `lib/faab/*.ts`, `app/tools/faab/*.tsx`, `app/admin/faab/*`, and the section 5 file map.
4. Add the tasks in section 9 to `progress.md` (format in 9.1) before starting them, and update each one as it completes.
5. The Supabase MCP server may fail to connect. If it does, apply migrations with the MCP when it is available; if it is not, stop and tell the owner rather than applying SQL another way. Read-only analysis queries may use a scratch script with `@supabase/supabase-js` and `SUPABASE_SECRET_KEY` (the planning session did this; see 3.4).
6. After each phase, run the three review sub-agents CLAUDE.md requires (implementation, accessibility, security) and fix what they find before marking tasks complete.
7. If anything in this document conflicts with the code as you find it, the code wins for facts (names, signatures) and this document wins for intent. Note the conflict in progress.md and in the final report. If the conflict changes behaviour the owner will see, ask before choosing.

---

## 1. Owner decisions (locked, 2026-09-19)

1. Readers choose the goal. A two-option control on every result: "Good value" and "Make sure I win". Both modes, both league types. Default is "Good value", except it defaults to "Make sure I win" when the chopped model says the reader is in real danger of elimination this week (7.12.8).
2. The rivals table shows real team names (the same labels `loadTeamNames` already produces; they are public on `/leagues/[id]`).
3. Publish anonymous bid statistics from synced leagues on the public page. Aggregates only: percentages and sample sizes. Never a league name, league id, team name, manager handle or a single identifiable claim.
4. Chopped and guillotine leagues (Sleeper Chopped, Yahoo Death Leagues, ESPN Knockout, FFPC Chop Classic, Fantasy Life Guillotine Leagues, MFL Chop Leagues, NFFC Eliminator) are IN THIS ROUND, with their own bidding math (7.12), not a relabelled standard model.
5. No commit, no push (section 0, item 2).
6. A separate chopped/guillotine/death league guide plus a section in the existing FAAB strategy guide, per `docs/faab/chopped-guillotine-guide-seo-plan.md`.

---

## 2. Why now

Google Search Console, 2026-08-22 to 2026-09-19, `/tools/faab`:

- 1,359 impressions, 94 clicks, 6.9% click-through.
- "faab calculator": 850 impressions, 58 clicks, average position 8.3. Every close variant sits between 7.7 and 8.6.
- Unserved: "chopped faab calculator" 19 impressions (position 8.6), "guillotine faab calculator" 5, "dynasty faab calculator" 4 (position 18), "how much is faab worth in redraft" 3.
- `/guides/faab-strategy` is indexed (last crawled 2026-09-18) and has had zero impressions in 90 days.

Sleeper added in-app "Suggested FAAB Bids" for 2025 (a range, method undisclosed). Every Sleeper reader has seen a number before they reach us, so ours has to come with reasons and a win chance.

---

## 3. What our own data says

Read-only queries over `league_transactions` (waiver type, seasons 2024 to 2026) for the 575 leagues synced on 2026-09-19. All figures are a share of that league's full FAAB budget (`leagues.metadata.settings.waiver_budget`). The bid amount is `league_transactions.metadata.settings.waiver_bid`; the claimant is the first entry of `roster_ids`; a losing bid has `status = 'failed'` and `metadata.metadata.notes = 'This player was claimed by another owner.'`.

### 3.1 Volume

- 27,347 waiver claims: 16,937 complete, 10,410 failed.
- Failed notes: 7,063 "This player was claimed by another owner." (LOSING BIDS, amount intact), 3,134 roster-size failures, 148 over budget, 61 drop already started, 4 drafting.
- Complete claims: 8,680 at $0, 8,257 priced.
- League types (`settings.type`): 191 redraft (0), 20 keeper (1), 333 dynasty (2), 31 chopped (3).

### 3.2 Priced winning bids

| Slice | Claims | Median | p75 | p90 | p99 |
|---|---|---|---|---|---|
| All | 8,257 | 5.0% | 12.4% | 26.0% | 83.5% |
| Redraft | 1,332 | 4.0% | 10.0% | 20.0% | 52.0% |
| Keeper and dynasty | 6,925 | 5.0% | 13.0% | 28.6% | 93.0% |
| Weeks 0 to 1 | 4,967 | 5.0% | 12.0% | 26.0% | 83.5% |
| Weeks 2 to 3 | 736 | 5.0% | 15.0% | 33.0% | 89.0% |
| Weeks 4 to 6 | 851 | 6.0% | 14.0% | 27.0% | 72.0% |
| Weeks 7 to 10 | 819 | 4.0% | 10.0% | 21.0% | 55.0% |
| Weeks 11 to 13 | 501 | 5.0% | 11.0% | 25.0% | 62.0% |
| Week 14 on | 383 | 7.0% | 18.0% | 42.0% | 100% |

Weeks 0 to 1 in dynasty (4,570 claims) are mostly offseason rookie claims and must be excluded from in-season pricing.

### 3.3 Auctions (grouped by league, season, week, single player added)

- 16,409 auctions with a winner; 4,651 had a losing bid. Median bidders 1, p75 2, p90 3, max 20.

| Bidders | Auctions | Winning median | p75 | p90 | Runner-up median | Runner-up p75 |
|---|---|---|---|---|---|---|
| 1 | 11,758 | 0% | 2% | 8% | n/a | n/a |
| 2 | 2,823 | 1% | 8% | 20% | 0% | 2% |
| 3 | 986 | 6.5% | 17% | 35% | 2% | 8.8% |
| 4 or more | 842 | 16% | 34% | 53.3% | 11% | 25% |

- Winner over runner-up: median 2.0 times (p25 1.24, p75 4.0). In budget terms median 2%, p75 8%.
- In-season contested auctions (weeks 2 to 13): 1,512, median 5%, p75 15%, p90 34%.
- 100% claims in season are almost all superflex starting quarterbacks after an injury (Jake Browning 2025 week 2 in three leagues with 4, 6 and 7 bidders; Philip Rivers 2025 week 14 in eight leagues) or running backs inheriting a backfield (Trey Benson 9 bidders, Sean Tucker 8, Kimani Vidal 6).

### 3.4 Verified bugs (checked against production data, read only)

- Sleeper's roster `players` array (stored as `rosters.player_ids`) CONTAINS every reserve and taxi id: 495 of 495 reserve ids and 1,582 of 1,582 taxi ids sampled were inside `player_ids`. Of 563 rosters holding IR or taxi players, 107 (19%) would be told by `lib/faab/league-faab.ts:342` that they must cut someone while an active spot is open.
- `roster_positions` tokens seen: QB, RB, WR, TE, FLEX, SUPER_FLEX, BN, K, DEF, IDP_FLEX, DL, LB, DB, WRRB_FLEX, REC_FLEX. IR and TAXI are NOT tokens; they are `settings.reserve_slots` and `settings.taxi_slots`.

### 3.5 Chopped leagues we hold

- 31 leagues with `settings.type = 3`. Mostly 18 teams, $1,000 budgets (others $200, $500, $1,001), team counts 11 to 32. `disable_trades: 1` typical, `playoff_week_start: 0`, `reserve_slots` up to 5.
- League settings keys present on chopped but not redraft: `pick_timer`, `disable_elimination`. Also present: `last_chopped_leg` (values seen 1, 10, 15, 16, 17, 18, or absent). Its meaning is NOT verified (see 7.12.2).
- Roster settings on eliminated teams: `eliminated` (an integer; values seen 1, 12, 14, 16, which read as the week the team was chopped) and `locked: 1`. Eliminated rosters usually have empty `player_ids`. `waiver_budget_used` stays as it was.
- `league_matchups` holds 9,756 rows for chopped leagues with Sleeper-assigned `matchup_id`s, and `league_power_pulse_cache` holds rows for some of them. Head-to-head odds on a chopped league mean nothing.
- Priced chopped winning bids by week (small sample; one finished 2025 league plus 2026 to date):

| Week | Claims | Median | p90 | Max |
|---|---|---|---|---|
| 1 | 68 | 3.5% | 35.1% | 60.0% |
| 2 | 18 | 3.2% | 40.0% | 70.0% |
| 3 | 16 | 4.0% | 40.0% | 50.1% |
| 4 | 12 | 2.5% | 33.7% | 55.1% |
| 5 | 15 | 2.0% | 34.0% | 40.0% |
| 6 | 11 | 2.5% | 22.0% | 34.7% |
| 7 | 13 | 2.2% | 25.0% | 25.5% |
| 8 | 19 | 1.0% | 8.5% | 22.0% |
| 9 | 8 | 1.8% | 25.0% | 25.0% |
| 10 | 6 | 1.0% | 9.8% | 9.8% |
| 11 to 17 | 33 | 0.1 to 0.3% | under 2% | 1.8% |

- Top chopped claims: Josh Allen 70% (2025 week 2), James Cook 60% (2026 week 1), Saquon Barkley 55.1% (2025 week 4), Matthew Stafford 52.1%, Patrick Mahomes 50.1%, Caleb Williams 50.0%, A.J. Brown 45%, Joe Burrow 42%, Chase Brown 40%, Emeka Egbuka 40%, Puka Nacua 40% (2025 week 5).

The analysis scripts live outside the repo. To reproduce, page `league_transactions` with `.range()` (the 1,000-row cap truncates silently) selecting `league_id, season, week, type, status, metadata->settings->waiver_bid, metadata->adds, metadata->metadata`.

---

## 4. Outside research

### 4.1 Standard FAAB

Platform rules:
- Sleeper: default $100, $0 allowed, `waiver_bid_min` configurable, ties to rolling waiver priority (a successful claim goes to the back), budgets never reset or roll over unless the commissioner does it, FAAB is tradeable. In-app Suggested FAAB Bids since 2025.
- Yahoo: $100 default, $0 allowed, rolling-list ties, budget never replenishes.
- ESPN: $100 default (reported), $0 allowed, ties follow waiver order (weekly reset or rolling by setting).
- Fleaflicker: $0 bids process, regular-season ties to the worst team, budgets can carry over.
- NFFC, NFBC, FFPC: $1,000; NFBC and FFPC Chop Classic have a $1 minimum.

What people pay:
- FantasyPros 2024, 600,000+ home-league adds: redraft median winning bid $14 (week 1 $11); QB $21, RB $21, WR $29, TE $20, K $3, DST $10. Dynasty: 71% of adds at $25 or less, under 5% at $100 or more. Mixed $100 and $1,000 budgets.
- NFFC Primetime 2026 week 2 ($1,000): top ten averaged $84.13 winning against $44.03 runner-up, about 1.9 times. Our leagues: 2.0 times. By position (winning, runner-up): QB $34.76 ($5.91), RB $48.72 ($21.53), WR $87.48 ($44.89), TE $47.93 ($12.93), K $9.16 ($1.35), DST $28.65 ($13.83).
- FFPC Main Event 2026 week 2: from $389 (38.9%) for a starting tight end down to $12. The same tight end went for $172 in one FFPC league.

Frameworks (percent of budget):
- Tiers: league-winner 40 to 70% and up, weekly starter 15 to 30%, flex or stash 5 to 12%, streamer 1 to 4%.
- Dynasty: RB1 opportunity 25 to 40%, top-five handcuff 15 to 25%, WR promoted 10 to 20%, streaming $1 to $5; contenders over 50% playoff odds spend 40 to 50% of what is left in weeks 5 to 10.
- Handcuffs $3 to $10 before the injury, $40 or more after.
- Superflex backup QB: 1% in one-QB leagues, 20 to 30% in superflex.
- Spend early: FantasyPros 30 to 40%, 4for4 75 to 80% on a true breakout, Fantasy Footballers "easily worth 100%". Hold back: 25-25-25-25 by quarter, or 25 to 30% cap in weeks 1 to 4 in dynasty.
- Bid odd numbers ($11, $16, $21).
- Nobody publishes numeric league-size or superflex multipliers.

Competitors: FantasyPros Waiver Wire Assistant (league sync, premium), Fantasy Life Waiver Wire Tool (styles Average, No Tomorrow, Aggressive, Conservative, The Hoarder), Faabtastic (aggregated expert bids), FAAB Lab (crowd bids), War Room / dynastytradegenerator (tiers, low and high competition), My Fantasy Analyzer (Sleeper sync, reasons), League Logs (conversion only), FAABFAX (reads Sleeper and ESPN history including losing bids, manager profiles; closest to our Phase 2). Gaps nobody fills: a win probability, the runner-up distribution, league history next to the wider market, contender versus rebuilder tied to real odds, stated confidence, accessibility.

### 4.2 Chopped, guillotine, death and knockout leagues

Names by platform:
- Sleeper "Chopped": launched 2025-08-14. 2025-08-22 update added up to 32 teams, creating from an existing league, and a commissioner "manual chop" that can cut several teams in one week. Help page recommends 18 teams, $1,000 FAAB, 2 IR slots, PPR, trades off, no playoffs. Elimination tie: lower season points is chopped; in week 1 the better draft slot is chopped. Bid tie: rolling waiver priority. Detected by `settings.type === 3`.
- Yahoo "Fantasy Death Leagues" (named Guillotine Leagues in 2025, with Liquid Death): public leagues 14 teams over 13 weeks, private default 18 and up to 17 weeks, no week 18; $1,000; eliminated players get a forced one-day waiver; elimination tie goes against fewer season points.
- ESPN "Knockout" (launched 2026-07-07): 12 or more teams recommended; a 20-team league ends with two teams and the higher final-week score wins. No FAAB defaults published.
- FFPC Chop Classic: 18 teams, 14-man rosters, QB, 2 RB, 2 WR, TE, 2 FLEX, PPR with 1.5 per TE catch, $1,000 FAAB, $1 minimum, no adds once spent, no trades. Bid tie: worst total points, then worst previous week, then coin toss. Chopped rosters enter free agency Tuesday morning in weeks 1 to 14; from week 15 chopped players are locked.
- Fantasy Life Guillotine Leagues: $1,000, $0 allowed, blind bidding on set days, bid tie to lowest season points. Week 14 was the last week chopped players were released (2024).
- NFFC Guillotine/Eliminator: 17 teams, one chop a week in weeks 1 to 13, then four teams play total points weeks 14 to 17; $1,000, $1 minimum, no $0 bids; no trades.
- MFL Chop Leagues: 18 teams ideal, ends week 17, blind bid or standard waivers.

Real prices (Fantasy Life Guillotine Leagues 2024, $1,000, 18-team public leagues, prior-week medians; alive counts derived):
- About 13 alive: Justin Jefferson $434, James Cook $301, Mike Evans $238.
- About 11 alive: Derrick Henry $424, Saquon Barkley $414, Breece Hall $349, Amon-Ra St. Brown $333.
- About 9 alive: Jefferson $340, Barkley $339, De'Von Achane $213.
- About 8 alive: Henry $241, Bijan Robinson $228, Lamar Jackson $156.
- About 6 alive: Jahmyr Gibbs $88, St. Brown $76, A.J. Brown $51.
- The same player reprices lower as the field shrinks: Jefferson minus 22%, Henry minus 43%, St. Brown minus 77%.
- Travis Kelce 2023 average winning bid by month: September $486, October $310, November $222, December $53.
- NFFC Eliminator 2025 study (117 releases, hobbyist, method unpublished), medians as share of budget: top-12 RB 28.9% with half or more alive, 12.8% with 30 to 50% alive, 0% below 30% alive (p75 35.0% and 15.1%). Top-12 WR about 13.8% and 7.1%. Top-6 QB about 4%, top-6 TE about 2%.
- Snippet only: Ja'Marr Chase went for $999 in a 24-team Sleeper chopped league with 22 alive (2025), runners-up $500, $351, $306, $300.

Strategy:
- Charchian: keep $900+ through September, $750+ through October, $250+ through November; "every $1 in September is worth $10 in December"; elite players $100 to $200 in week 3, $200 to $300 in weeks 8 to 11.
- The 2024 champion held $969 after week 4, $904 after week 8, $240 after week 12 and $11 after week 14; a rival who spent $636 by week 4 did not win.
- Reserve by standing at 12 of 18 alive: top third hold 80 to 95%, middle 65 to 80%, bottom 50 to 65%.
- Endgame by money left: 65% or more bid hard on elite; 35 to 65% pay 2 to 5% for mid-tier; under 35% stream.
- Caps on one early player range from 10% (RotoWire) to 20% (LaMarca) to 30% (Fantasy Footballers). Masters argues 20 to 35% in September; Gretch describes a barbell (30 to 50% early then coast).
- Handcuffs never above $5. K and DEF under 1%.
- FantasyVerdicts formula: bid = (budget / eliminations left) x tier x survival, tier 4.0 elite to 0.25 replacement, survival 2.5 bottom two, 1.5 near the cut, 1.0 mid-pack, 0.7 safe.
- Survival baseline: 1 in N chance each week for N equal teams.

Tools: RotoWire (survival odds, FAAB ROI, Sleeper sync, likely paid), Fantasy Life Guillotine Waiver Wire Assistant (free; week, teams remaining, budget, five styles), Fantasy Heartbeat (ESPN Knockout simulator), Chop Fantasy Football, FallGuy Fantasy. Nobody reads a Sleeper chopped league's own history, models rival budgets, prices simultaneous substitutes, or covers every platform's rules.

Sources for all of section 4 are in section 13.

---

## 5. The system today (file map and facts)

### 5.1 Files

- `app/tools/faab/page.tsx`: server page, `force-dynamic`, metadata title "FAAB Calculator for Fantasy Football: What to Bid", resolves format and source, renders `FaabForm`, `WrittenSections`, `DiscordCtaSection`.
- `app/tools/faab/faab-form.tsx`: client. `LeaguePanel`, `OrDivider`, the manual form (teams, starters, budget, need), `ManualResult`. Need control at lines 285 to 299 feeds BOTH modes.
- `app/tools/faab/league-panel.tsx` (983 lines): Sleeper handle gate, league choice, player combobox, "Price this bid", "All N leagues". Single sr-only live region at 862 to 872. Renders `BidResult` inside `${ids}-result`.
- `app/tools/faab/manual-result.tsx`: fetches `fetchPlayerOutlook`, runs `computeManualMarginal`, `buildMarket`, `buildLadder` in the browser, falls back to `calculateFaabRecommendation`.
- `app/tools/faab/bid-result.tsx` (630 lines): `BidView` type (line 40), `viewFromLeagueReport`, `BidResult`, internal `Ladder`, `ImpactGrid`, `DropOptions`, `WeekStrip`, `SignalList`, `MarketCard`. Title is an `h4` (line 120), subsections `h5`.
- `app/tools/faab/written-sections.tsx`: `FAAB_FAQ` and `WrittenSections()` using `components/tool-explainer.tsx` (emits FAQPage JSON-LD from the same array).
- `app/tools/faab/actions.ts`: server actions with `claimSlot(bucket, max)` over `try_claim_rate_limit`, 60 s window. Buckets: `faab_outlook` 30, `faab_free_agents` 30, `faab_connect` 10, `faab_league_bid` 12, `faab_all_leagues` 4.
- `app/admin/faab/page.tsx`, `actions.ts` (`saveFaabSettings`), `faab-settings-manager.tsx` (1,357 lines, sections listed in 7.17).
- `lib/faab/types.ts`, `default-settings.ts`, `settings.ts` (zod `faabSettingsSchema`, `validateFaabSettings`, `loadFaabSettings` memoized 60 s under key `settings:faab`, table `faab_calculator_settings`, id `global`).
- `lib/faab/league-faab.ts` (`calculateLeagueFaab`), `marginal.ts` (`computeLineupSwap`), `market.ts`, `ladder.ts`, `signals.ts`, `manual.ts`, `outlook.ts`, `calculate-faab.ts`, `league-load.ts`, `multi-league.ts` (`MAX_PRICED_LEAGUES = 10`), `free-agents.ts`, `player-list.ts`, `backtest.ts`.
- Tests: `lib/faab/{calculate-faab,ladder,manual,marginal,market,settings,signals}.test.ts`. No tests for league-faab, multi-league, free-agents, league-load, outlook, player-list, backtest.
- Commands: `npm test` (vitest run), `npm run typecheck` (tsc --noEmit), `npm run lint` (next lint).
- Migrations: highest is `supabase/migrations/0288_relays_perf_indexes.sql`. Next free number 0289. Pattern `NNNN_snake_case.sql`. `faab_calculator_settings` was 0105 (service-role-only policy).
- `progress.md` last unprefixed id T728; prefixed series exist. This build uses prefix `FB-T` (not used yet).

### 5.2 Key types (current)

```ts
// lib/faab/types.ts (abridged)
type NeedLevel = "low" | "medium" | "high";
type FaabSettings = { userDefaults; bidCurve; depthAdjustments; needMultipliers; dump;
  valueNormalization; copy; marginal; dropGuard; signals; market; ladder; leagueDump;
  manualReplacement };
type MarginalValue = { weeksConsidered; weeksStarting; pointsPerWeek; pointsPerStartedWeek;
  netPointsPerWeek; expectedWinsAdded: number|null; playoffOddsBefore: number|null;
  playoffOddsAfter: number|null; titleOddsBefore: number|null; titleOddsAfter: number|null;
  weeks: MarginalWeek[]; dropCost; dropOptions; dropNote; isBenchOnly };  // odds are 0-100 points
type BidLadder = { walkAway; likely; aggressive; likelyPct; budgetAfterLikely };
type MarketRead = { yourBudget; rivalsRicher; rivalsAtLeastAsRich; richestRivalBudget;
  medianRivalBudget; leagueTotalBudget; everyoneAtFullBudget; interestedRivals; rivalsChecked;
  comparable; weeksLeft; urgencyMultiplier };
type LeagueFaabReport = { league: {...}; player: {...}; availability; rosteredBy; marginal;
  signals; market; ladder; aggressionLabel; isDumpCandidate; headline; explanation; notices;
  confidence };
```

Power Pulse pieces this build reuses unchanged:
- `lib/power-pulse/lineup.ts`: `startingSlots(rosterPositions)`, `buildOptimalLineup(slots, candidates)`, `lineupSigma(slots)`.
- `lib/power-pulse/what-if.ts`: `simulateWithReplacements({ rosters, baseline, replacements, upcoming, options })` returns `{ before, after }` maps of `{ expectedWins, playoffOdds, titleOdds, byeOdds }` in 0 to 1, or null.
- `lib/power-pulse/math.ts`: `createRng(seed)`, `normalDraw(rng)`, `normalCdf`, `clamp`, `round`.
- `lib/power-pulse/project.ts`: `projectPlayerWeek(...)`, `LONG_TERM_INJURY_STATUSES`, `injuryMultiplier(...)`. Projection rows carry `availability` ("projected", "out", "unprojected") and `injuryStatus` per week.
- `lib/power-pulse/load.ts`: `loadLeague`, `loadRosters` (RosterRow has `playerSleeperIds`, `reserveSleeperIds`, `taxiSleeperIds`, `pointsFor`, `teamName`), `loadPlayers` (PlayerRow has `depthOrder` from `metadata.sleeper.depth_chart_order`), `loadProjections`, `loadAccuracy`, `loadSchedule`. `playoffWeekStart` falls back to a default when Sleeper stores 0.
- `lib/league-positional-war-data.ts loadPositionalWarView(supabase, leagueRowId, season)` returns curves with per-player `war`.
- `lib/league-team-status.ts classifyTeamStatus({ pulseRank, valueRank, teamCount, playoffTeams, variant })` returns `competitor | loaded | middle | rebuilder`.
- `lib/league-power-pulse-data.ts loadPowerPulseView(...)` (reads `league_power_pulse_cache`).
- `components/chart-kit.tsx ChartFigure({ title, summary, table, titleLevel, children })`, `DataTable`, `Th`, `Td`.
- `lib/analytics.ts trackEvent(name, params)`; AnalyticsEvent union at line 73; `AnalyticsTool` includes "faab".
- OG pattern: `app/api/og/start-sit/route.tsx` (runtime nodejs, 1200x630, rate limit via `try_claim_rate_limit`, cache header `public, max-age=300, s-maxage=3600, stale-while-revalidate=86400`, brand constants).
- Global aggregate precedent: `app/api/cron/recalculate-derived/route.ts` already rebuilds a global cross-league aggregate (`player_roster_exposure`) that "iterates no leagues". The priors build (7.4) goes there.

---

## 6. Audit findings

Severity: HIGH changes the number in common cases, MEDIUM in specific cases, LOW is clarity.

### 6.1 Standard leagues

- A1 HIGH. No model of what it takes to win. `ladder.ts:145-153`: "Bid this" = worth to the reader x market multipliers (rival interest moves it at most 25%, `market.ts:179-206`). Price is set by bidder count (3.3) and winners pay about 2x the runner-up.
- A2 HIGH. History blend drags bids toward $5. `ladder.ts:155-162`, `market.ts:81-96`: every priced winning claim, including $1 cleanup and offseason rookie claims, gets 35% weight.
- A3 HIGH. Early-season discount points the wrong way. `market.ts:216-229`: weeks 1 to 3 x0.85; our data has weeks 2 to 6 as the most expensive in-season window.
- A4 HIGH. 7,063 losing bids ignored. `league-load.ts:118` keeps `status = 'complete'` only.
- A5 HIGH, VERIFIED. IR and taxi counted against the roster limit. `league-faab.ts:342` `mustDrop = mine.playerSleeperIds.length >= league.rosterPositions.length`. 19% of rosters with IR or taxi players are affected (3.4). The phantom cut is subtracted from the upgrade.
- A6 MEDIUM. Multi-week absences without an IR tag count as healthy after this week (`injuryMultiplier` discounts week-to-week tags in the current week only, unless the source priced it in).
- A7 MEDIUM. Need counted twice in league mode (`ladder.ts:138-146`) and the control sits in the manual form (`faab-form.tsx:285-299`).
- A8 MEDIUM. Playoff weeks worth nothing (`league-faab.ts:204-207`); title odds computed and ignored by `upgradeStrengthOf`.
- A9 MEDIUM. Manual mode reads breakouts as "Not an upgrade" (`manual.ts:131`); `outlook.ts:299` hardcodes the regular season end at week 14.
- A10 MEDIUM. Dynasty value invisible to league mode (market value only guards the cut list).
- A11 MEDIUM. Superflex QB scarcity not modelled directly; manual mode has no superflex input; Positional WAR cache unused.
- A12 MEDIUM. Empty-the-clip thresholds (3.5 points a week or 12 odds points) rarely reachable early.
- A13 LOW. `backtest.ts` compares distributions, not auction outcomes.
- A14 LOW. Cut guard picks the value source by priority (`league-load.ts:257-308`) instead of the reader's source.
- B1 to B7 (presentation): no win chance on the hero rung; collapsed rungs read as broken; one dense explanation paragraph; rivals summarised in one line; no copy or share; `h4` with no `h3` (`bid-result.tsx:120`); fallback and projection models look different without saying why.
- C1 to C3 (content): explainer answers five questions; our bid data is unused on the page; title and H1 fine.

### 6.2 Chopped leagues (all HIGH unless noted)

- D1. Chopped leagues are treated as keeper leagues. `league-load.ts:239-240`: `isKeeperLeague = ... sleeperType >= 1`, and type 3 is chopped. The keeper cut guard (bottom 40% by dynasty value only) runs on a one-season league.
- D2. Eliminated teams count as rivals: their remaining budget enters `rivalBudgets`, their empty rosters enter the rival swap and the simulation.
- D3. Chopped leagues get a head-to-head playoff simulation that does not exist (`playoff_week_start: 0` falls back to the default week, Sleeper's placeholder `matchup_id`s become a schedule).
- D4. Chopped leagues are priced with the standard market: calendar ramp, league history across formats, no notion of teams alive, total money left, substitutes released together, or release cutoffs.
- D5 MEDIUM. Manual mode has no chopped option at all.

---

## 7. Target design (build spec)

### 7.1 Vocabulary (used in code, copy and this doc)

- Worth: the most the player is worth to THIS reader, as a share of the league's full budget. Becomes "Walk away above".
- Price: what it is likely to take to beat every other bidder. Modelled as a distribution of the highest rival bid.
- Win chance at b: probability the reader's bid b beats every rival, including the tiebreak.
- Goal: `"value"` or `"sure"`. Picks the target win chance.
- League kind: `"standard"` (redraft, keeper, dynasty, best ball) or `"chopped"` (Sleeper type 3, or manual chopped).
- All money inside the models is a share of the league's FULL budget `T` (0 to 100). Convert to dollars only at the edge: `dollars = Math.round(pct / 100 * T)`, clamped to the reader's remaining budget.

### 7.2 Settings additions

Add these groups to `FaabSettings` in `lib/faab/types.ts`, defaults in `lib/faab/default-settings.ts`, zod groups with per-field `.default(...)` in `lib/faab/settings.ts` (same pattern as the existing groups, so stored rows without them parse to defaults), and admin sections (7.17). Remove `market.urgency` from the TYPE and default only after `market.calendar` replaces every reader of it; zod strips unknown keys, so old rows still parse.

```ts
export type GoalKey = "value" | "sure";

export type AuctionSettings = {
  enabled: boolean;              // default true
  runs: number;                  // 4000, int 500..20000
  participation: number;         // 0.7, 0..1: chance an interested rival bids at all
  strayBidRate: number;          // 0.06, 0..1: chance an uninterested rival bids anyway
  bidSigma: number;              // 0.55, 0.1..1.5: lognormal spread of a rival bid around its centre
  heatShrink: number;            // 20, samples at which a league's own heat gets half weight
  tendencyShrink: number;        // 8, same for one manager
  heatClamp: [number, number];   // [0.5, 2.5]
  tendencyClamp: [number, number]; // [0.5, 2.5]
  minContestedWeek: number;      // 2: auctions before this week are ignored for heat/tendency
  oddNudge: boolean;             // true: +1 on a bid that is a multiple of 5 and at least 10
};

export type GoalSettings = {
  defaultGoal: GoalKey;          // "value"
  valueTarget: number;           // 0.6
  sureTarget: number;            // 0.9
  sureMaxOverWorthPct: number;   // 25: "sure" may exceed worth by at most this %, labelled
};

export type CalendarBand = { fromWeek: number; toWeek: number | null; multiplier: number };
export type CalendarSettings = {
  enabled: boolean;              // true
  bands: CalendarBand[];         // see default below; contiguous, first fromWeek 1, last toWeek null
};

export type PriorsSettings = {
  minCellSamples: number;        // 30: a priors cell below this falls back to a coarser cell
  staleAfterDays: number;        // 6: rebuild threshold used by the cron step
  styleMultipliers: { tight: number; typical: number; wild: number }; // 0.7, 1, 1.4
};

export type PlayoffValueSettings = {
  enabled: boolean;              // true
  playoffWeekWeight: number;     // 1.0: a playoff week counts this much times P(making playoffs)
  titleOddsWeight: number;       // 0.25: share of upgrade strength from title odds gain
  bigTitleOddsPoints: number;    // 5: title-odds gain (points) that counts as full strength
};

export type DynastyValueSettings = {
  enabled: boolean;              // true
  blendByStatus: { competitor: number; loaded: number; middle: number; rebuilder: number };
                                 // 0.15, 0.25, 0.35, 0.6: weight on market value vs points
  eliteRankFactor: number;       // 0.25: elite value = value at rank teams*starters*this
};

export type InjurySettings = {
  carryOutFromSource: boolean;   // true: use per-week projection availability for OUT weeks
  teammateSignal: { enabled: boolean; maxAdjustPct: number }; // true, 20
};

export type BreakoutSettings = {
  enabled: boolean;              // true
  blendWeight: number;           // 0.5: weight on recent usage-implied points when usage jumped
};

export type ChoppedSettings = {
  enabled: boolean;              // true
  runs: number;                  // 3000
  strengthWeights: { surviveThisWeek: number; winLeague: number; weeksAlive: number };
                                 // 0.4, 0.35, 0.25 (must sum to 1, validated)
  bigSurvivePoints: number;      // 10: gain in P(survive this week), points, for full strength
  bigWinPoints: number;          // 5: gain in P(win league), points
  bigWeeksAlive: number;         // 1.0: gain in expected weeks alive
  maxPctFromUpgrade: number;     // 70
  priceByAliveFraction: Array<{ minFraction: number; multiplier: number }>;
                                 // [{0.5,1.0},{0.3,0.45},{0,0.15}] ordered high to low
  dangerThreshold: number;       // 0.2: P(chopped this week) that flips the default goal to sure
  dangerWeight: number;          // 0.5: how much a rival's own danger raises its bid centre
  substituteShare: number;       // 0.9: a free agent projecting >= this share of the candidate is a substitute
  substituteDiscount: number;    // 0.5: participation /= (1 + discount * substitutes)
  paceTargets: Array<{ throughWeek: number; holdPct: number }>;
                                 // [{4,90},{8,75},{12,25},{17,0}]
  manualDangerMultipliers: { bottomTwo: number; nearCut: number; midPack: number; safe: number };
                                 // 1.6, 1.25, 1.0, 0.8
};
```

`FaabSettings` gains: `auction`, `goal`, `market.calendar` (inside `MarketSettings`), `priors`, `playoffValue`, `dynastyValue`, `injury`, `breakout`, `chopped`. `leagueDump` gains `contestedRivals: number` (4) and `superflexQbStarterOut: boolean` (true). `manualReplacement` gains `superflexQbPerTeam: number` (1.9). `userDefaults` gains `defaultLastRegularWeek: number` (14, int 10..18), `defaultLeagueBudget: number` (100) and `defaultStyle: "tight" | "typical" | "wild"` ("typical").

Default calendar bands (from 3.2 p75 ratios, tempered):

```ts
bands: [
  { fromWeek: 1, toWeek: 1, multiplier: 1.0 },
  { fromWeek: 2, toWeek: 6, multiplier: 1.1 },
  { fromWeek: 7, toWeek: 10, multiplier: 0.9 },
  { fromWeek: 11, toWeek: 13, multiplier: 1.0 },
  { fromWeek: 14, toWeek: null, multiplier: 1.3 },
]
```

Zod rules to add: bands contiguous and ordered; `valueTarget < sureTarget`; `chopped.strengthWeights` sum within 0.99 to 1.01; `priceByAliveFraction` strictly descending by `minFraction` with the last at 0; `paceTargets` ascending by week; clamps as pairs `[min, max]` with `min < max`. Add tests to `lib/faab/settings.test.ts` for each rule.

### 7.3 Database: `faab_market_priors`

Migration `supabase/migrations/0289_faab_market_priors.sql` (renumber if 0289 is taken when you start). Apply with the MCP, save the file, regenerate types, write `lib/database.types.ts`, prettier-format it.

```sql
-- Access matrix
--   anon, authenticated: SELECT (the public page publishes these aggregates)
--   service_role: ALL (built by recalculate-derived and npm run faab:priors)
-- Contents are anonymous quantiles only. No league, roster, user or player
-- identifier is stored, so a public read reveals nothing about anyone.
create table public.faab_market_priors (
  id uuid primary key default gen_random_uuid(),
  cell_key text not null unique,
  league_kind text not null check (league_kind in ('redraft','dynasty','chopped','any')),
  superflex text not null check (superflex in ('yes','no','any')),
  position text not null check (position in ('QB','RB','WR','TE','K','DEF','any')),
  phase text not null,          -- standard: 'wk1','wk2_6','wk7_10','wk11_13','wk14p','any'
                                -- chopped: 'alive_50p','alive_30_50','alive_lt30','any'
  bidders text not null check (bidders in ('1','2','3','4p','any')),
  sample_size integer not null check (sample_size >= 0),
  zero_share numeric not null,  -- share of auctions won at 0
  p05 numeric not null, p10 numeric not null, p25 numeric not null, p50 numeric not null,
  p75 numeric not null, p90 numeric not null, p95 numeric not null, p99 numeric not null,
  runner_up_ratio_p50 numeric,  -- winner / runner-up median, null when no contested samples
  leagues_count integer not null,
  seasons integer[] not null,
  built_at timestamptz not null default now()
);
alter table public.faab_market_priors enable row level security;
create policy faab_market_priors_select_public on public.faab_market_priors
  for select to anon, authenticated using (true);
create policy faab_market_priors_service_role_all on public.faab_market_priors
  for all to service_role using (true) with check (true);
comment on table public.faab_market_priors is
  'Anonymous FAAB clearing-price quantiles by situation. Derived from league_transactions by lib/faab/priors-build.ts. No identifiers.';
```

`cell_key` = `${league_kind}|${superflex}|${position}|${phase}|${bidders}`. Every quantile is a share of that league's full budget, 0 to 100. Verification after applying (CLAUDE.md sequence): query `pg_policies`; SELECT as anon inside `begin; set local role anon; ...; rollback;`; confirm an anon INSERT fails. Derived table, so no `metadata` column (CLAUDE.md pre-calc rule).

### 7.4 Priors builder

- `lib/faab/priors-build.ts` (pure): `buildPriorCells(auctions: PriorAuction[], opts: { minCellSamples: number }): PriorCellRow[]`.
  - `PriorAuction = { leagueKind: 'redraft'|'dynasty'|'chopped'; superflex: boolean; position: string; week: number; aliveFraction: number | null; bidderCount: number; winningPct: number; runnerUpPct: number | null; leagueId: string; season: number }`.
  - League kind: settings.type 2 is dynasty, 3 is chopped, 0 and 1 are redraft (keeper prices as redraft, matching `lib/sleeper-to-format.ts`).
  - Superflex: `roster_positions` includes `SUPER_FLEX`, or counts two or more `QB` tokens.
  - Standard phases from the week; exclude standard weeks below 1 and dynasty week 0 to 1 claims whose `created_at_sleeper` falls before the NFL regular season start of that season (use the season's week-1 date from `getNflState` history or, simpler and acceptable, exclude dynasty weeks 0 and 1 entirely from standard phases; they still count toward the `any` phase).
  - Chopped phase from `aliveFraction` = alive rosters at that week / total rosters. Alive at week w = rosters whose `metadata.settings.eliminated` is 0, null, or greater than or equal to w.
  - Build every combination of each dimension at its value AND at `any`, so coarse cells exist. Emit only cells with `sample_size >= 1`; the reader decides fallback.
  - Quantiles: nearest-rank, same as `lib/faab/market.ts percentile`.
  - Leagues with no numeric `waiver_budget` or a budget of 0 are skipped. A bid above the budget is clamped to 100.
- `lib/faab/priors-load.ts` (server): `loadAuctionUniverse(supabase)` pages `leagues` (id, metadata->settings->waiver_budget, metadata->settings->type, roster_positions), `rosters` (league_id, sleeper_roster_id, metadata->settings->eliminated) and `league_transactions` (type='waiver', statuses complete and failed, notes filter for losing bids) with `.range()` in 1,000-row pages, joins positions from `players` by `external_ids->>sleeper` in chunks of 500, and groups into `PriorAuction[]` using the grouping in 7.5.
- `lib/faab/priors-write.ts`: `rebuildFaabMarketPriors(supabase)` loads, builds, then in one pass upserts on `cell_key` and deletes cells not in the new set. Returns `{ cells, auctions, leagues, ms }`.
- `scripts/build-faab-priors.ts` plus `package.json` script `"faab:priors": "tsx scripts/build-faab-priors.ts"`.
- Cron: add a non-fatal step to `app/api/cron/recalculate-derived/route.ts` after the roster-exposure step: if the newest `built_at` is older than `settings.priors.staleAfterDays`, call `rebuildFaabMarketPriors`, then `revalidateTag(CACHE_TAGS.faabPriors)`. Add `faabPriors: "faab-priors"` to `lib/cache-tags.ts`. This is a global aggregate over transaction rows, not a per-league compute, the same shape as the roster-exposure rebuild already in that job. Update that route's header comment to say so.
- `lib/faab/priors-read.ts`: `loadPriorCellsCached()` reads all rows (a few hundred) with `unstable_cache`, key `["faab-market-priors"]`, `revalidate: CACHE_TTL.daily`, tag `faabPriors`. `pickCell(cells, want, minCellSamples)` falls back in this order until `sample_size >= minCellSamples`: exact; position any; superflex any; phase any; league_kind any; everything any. Returns the cell and a `fellBackTo` label for the confidence note.
- `priorCdf(cell, pct): number` linear interpolation over (0, zero_share), (p05..p99), (100, 1). Monotone by construction.

### 7.5 League auction history

`lib/faab/league-load.ts` gains `loadAuctionHistory(supabase, leagueRowId, seasons): Promise<LeagueAuction[]>` and `loadWinningBids` is deleted once nothing reads it.

```ts
export type LeagueBid = { rosterId: number; amount: number; won: boolean };
export type LeagueAuction = { season: number; week: number; playerSleeperId: string;
  bids: LeagueBid[] };  // sorted high to low
```

- Page `league_transactions` for the league and seasons, `type = 'waiver'`.
- Keep `status = 'complete'` rows, and `status = 'failed'` rows whose `metadata.metadata.notes` starts with "This player was claimed by another owner". Ignore other failures (they were never in the auction).
- Group by (season, week, the single key of `adds`). Skip rows adding more than one player.
- Keep a group only when it has exactly one winning row.
- `rosterId` = first element of `roster_ids`.

### 7.6 League heat and manager tendency

`lib/faab/tendency.ts` (pure).

- Reference price for an auction: the priors cell for (league kind, superflex, position, phase, bidders) p50, via `pickCell`. If the reference is 0, use 1 (a share of budget) to avoid dividing by zero.
- League heat: over the league's auctions with `week >= auction.minContestedWeek` and 2 or more bids, `r_i = ln(max(winningPct, 0.5) / max(ref_i, 0.5))`. `heat = exp( (n / (n + heatShrink)) * mean(r_i) )`, clamped to `heatClamp`. With no samples `heat = 1`.
- Manager tendency: for roster k, every bid it made (won or lost) in those auctions, `r = ln(max(bidPct,0.5) / max(ref,0.5))`, same shrink with `tendencyShrink`, relative to heat: `tendency_k = exp(shrunkMean_k) / heat`, clamped to `tendencyClamp`. Unknown roster gives 1.
- Label per rival for the table: tendency at or above 1.25 is "Spends big", at or below 0.8 "Holds money", otherwise "Typical". A rival with fewer than 3 bids is "Not enough history".

### 7.7 Auction simulation

`lib/faab/auction.ts` (pure, seeded, no I/O).

```ts
export type AuctionRival = {
  rosterId: number;
  budgetPct: number;          // remaining budget as share of T
  interested: boolean;
  centerPct: number;          // bid centre if it bids, share of T (already includes heat, tendency, calendar, danger)
  waiverPosition: number | null;  // lower = higher priority (VERIFY FIRST, see below)
};
export type AuctionInput = {
  yourBudgetPct: number; yourWaiverPosition: number | null;
  rivals: AuctionRival[]; strayCell: PriorCell | null;
  settings: AuctionSettings; seed: number; participationScale?: number; // chopped substitutes
};
export type AuctionCurve = {
  winChanceAt: (pct: number) => number;          // 0..1, non-decreasing
  rivalTop: { p50: number; p75: number; p90: number }; // highest rival bid, share of T
  noRivalShare: number;                          // runs where nobody else bid
};
export function simulateAuction(input: AuctionInput): AuctionCurve;
```

Algorithm, per run (runs from settings, RNG from `createRng(seed)`):
1. For each rival: if interested, bids with probability `participation * (participationScale ?? 1)`; if not interested, bids with probability `strayBidRate`.
2. Interested amount: `centerPct * exp(bidSigma * z)`, z from `normalDraw`. Stray amount: a draw from the stray cell by inverse CDF (uniform u, invert `priorCdf`); with no cell, 1% of T.
3. Cap every amount at the rival's `budgetPct` and 100, round to the league's dollar grid (`Math.round(pct/100*T)` then back to pct) so ties are real.
4. Record the maximum rival amount and the waiver position of whoever holds it (lowest position among tied top bidders).
Then sort the maxima. `winChanceAt(b)` = share of runs with max below b, plus for runs with max equal to b, 1 if `yourWaiverPosition` is known and lower than the top bidder's position, else 0.5. Runs with no bids count as a win for any b at or above the league minimum bid.

Rival interest and centre (league mode, standard):
- For every alive rival, `computeLineupSwap` as today (no drop search). `netPointsPerWeek >= market.rivalNeed.minPointsPerWeek` means interested.
- Rival worth: `upgradeStrengthOf({ ...marginal with odds null }, settings.marginal) * settings.marginal.maxPctFromUpgrade`.
- `centerPct = rivalWorth * heat * tendency_k * calendarMultiplier(week)`.
- Waiver position: `rosters.waiver_position`. VERIFY FIRST that 1 means first priority on Sleeper: find a completed waiver in our data where two equal bids met (group by auction with two equal amounts) and check the winner had the lower `waiver_position` at the time. If you cannot confirm, pass null and the tie splits 0.5, and say so in progress.md.

Calibration targets (checked by the replay in 7.18): the model's recommended value-goal bid wins 60 to 75% of historical contested auctions; the median ratio of simulated winning bid to simulated runner-up lands between 1.4 and 2.6 (observed 2.0).

### 7.8 Goal and the new ladder

Replace `BidLadder` with:

```ts
export type BidRung = { dollars: number; pct: number; winChance: number | null };
export type BidLadder = {
  goal: GoalKey;
  bid: BidRung;            // the recommendation for the chosen goal
  stretch: BidRung;        // the other goal's number when higher, else walkAway
  walkAway: BidRung;       // worth
  priceAboveWorth: boolean;// winChance(walkAway) < valueTarget
  rivalTop: { p50: number; p75: number } | null; // dollars
  budgetAfterBid: number;
  bidsByGoal: { value: BidRung; sure: BidRung };  // so the toggle is instant, no server call
};
```

Rules (in `lib/faab/ladder.ts buildLadder`):
1. `worthPct` as today minus the need multiplier in league mode (6.1 A7), plus 7.11 adjustments. Manual mode keeps need.
2. `walkAway` = worth, floored at the league minimum bid when the player starts for the reader.
3. `bidFor(target)` = smallest integer dollar amount b in [minBid, yourBudget] with `winChanceAt(b) >= target`, or null.
4. Value goal: `bid = min(bidFor(valueTarget) ?? walkAway, walkAway)`.
5. Sure goal: `cap = min(yourBudget, round(walkAway * (1 + sureMaxOverWorthPct/100)))`; `bid = min(bidFor(sureTarget) ?? cap, cap)`. When `bid > walkAway` the copy says how far over worth it is.
6. Bench-only player (`isBenchOnly`): bid = league minimum bid for both goals, win chance still shown.
7. Nobody else bids in at least 95% of runs: bid = minimum bid (1 when a $0 bid is not allowed or the player starts; `settings.waiver_bid_min` when present), headline "Nobody else needs him".
8. Odd nudge (settings.auction.oddNudge): if bid >= 10, bid % 5 == 0 and bid + 1 <= the goal's cap, add 1.
9. `stretch`: for value goal, the sure bid if higher, else walkAway; for sure goal, walkAway.
10. Empty the clip: existing triggers plus `interestedRivals >= leagueDump.contestedRivals` while the player starts for the reader, plus superflex QB when a reader's starting QB is out this week and `superflexQbStarterOut`. The trigger raises `walkAway` to the dump range max for the need level and sets headline "Empty the clip". It never overrides `alreadyCooked` (playoff odds below `loserOddsCeiling`).
11. Manual mode has no simulation. `winChanceAt(b) = priorCdf(cell, (b/T*100) / styleMultiplier)` where the cell is picked from (league kind, superflex, position, phase, bidders) and bidders come from the competition control (7.10).

Headlines (exact strings): "Empty the clip", "Priority add", "Worth a real bid", "Cheap upgrade", "Not an upgrade", "Nobody else needs him", "He will likely cost more than he is worth to you" (when `priceAboveWorth`), chopped: "Survive this week" (7.12.8).

### 7.9 League mode pipeline (changes to `calculateLeagueFaab`)

In order:
1. Load league, rosters, NFL state as today. Compute `leagueKind` with `isChoppedLeague(league settings)` (7.12.1). Branch to `calculateChoppedFaab` (7.12) for chopped. Everything below is standard.
2. `mustDrop` fix (A5): `activeCount = playerSleeperIds.filter(id => !reserve.has(id) && !taxi.has(id)).length`; `activeLimit = rosterPositions.filter(t => t !== "IR" && t !== "TAXI").length`; `mustDrop = activeCount >= activeLimit`. Unit-test with a roster holding two IR players and one open spot.
3. Weeks: regular season as today, plus playoff weeks `playoffWeekStart .. playoffWeekStart + rounds - 1` when `playoffValue.enabled` (rounds from `playoffTeams` and `playoffRoundType`; reuse the bracket-length logic in `lib/power-pulse/simulate.ts` if exported, else compute `ceil(log2(playoffTeams))` rounds, doubled for round type 1, plus one for type 2). Playoff weeks enter `computeLineupSwap` as extra weeks; each playoff week's gain is multiplied by `playoffWeekWeight * P(making playoffs before)` when averaging (so add a `weekWeights?: Map<number, number>` input to `computeLineupSwap`, default 1).
4. Upgrade strength (`upgradeStrengthOf`) adds a title-odds term: `titleTerm = clamp((titleAfter - titleBefore) / bigTitleOddsPoints, 0, 1.25)`; final strength = `(1 - titleOddsWeight) * current + titleOddsWeight * titleTerm` when title odds exist.
5. Dynasty blend (A10), only when the league is dynasty or keeper (`leagueKind` standard and `isKeeperLeague`): `valuePct = clamp((candidateValue - dropValue) / eliteValue, 0, 1.25) * maxPctFromUpgrade` where values come from `player_value_trends.current_value` for the READER's resolved source (`resolveLeagueContext(...).sourceSlug`, fixing A14) on the league's format, `dropValue` is the applied cut's value (0 when no cut) and `eliteValue` is the value at overall rank `round(teams * starters * eliteRankFactor)` on that board. `worthPct = (1 - w) * pointsWorth + w * valuePct` with w from `blendByStatus[status]`, status from `classifyTeamStatus` using `league_power_pulse_cache.pulse_rank` for the reader's roster (read, never compute). Missing status uses `middle`.
6. Injuries (A6): for the reader's roster, when a projection row's `availability` is "out" for a week, the player is out that week (already true in `projectPlayerWeek`); when there is no row for a future week and the player's status is OUT or DOUBTFUL, carry the current-week multiplier forward ONLY for weeks where the source published nothing (`carryOutFromSource`). Add a report field `injuredStarters: { name, status, weeksOut: number | null }[]` for the roster's optimal starters who are out this week.
7. Teammate injury signal (new in `signals.ts`): candidate has `depthOrder >= 2`, and a teammate at the same position with `depthOrder` 1 has status OUT, IR, PUP, SUS or DOUBTFUL. Needs the depth and status of the candidate's NFL teammates: add `loadTeamDepth(supabase, team, position)` to `league-load.ts` reading `players` where `team = X` and `position = Y` (metadata sleeper depth_chart_order and injury_status). Multiplier `1 + teammateSignal.maxAdjustPct/100 * (depthOrder === 2 ? 1 : 0.5)`. Label "His starter is out", detail names the teammate and status.
8. Breakout blend (A9): when the opportunity signal fires "His role just grew", blend the candidate's projected points toward `recentPointsPerGame` (mean fantasy points over the last `recentGames` games under league scoring, from `player_stats`) with `blendWeight`, and add notice "Projection adjusted for his new role". League mode and manual mode.
9. Positional WAR (A11): `loadPositionalWarView(supabase, league.id, season)`; if the candidate appears in a curve, report `positionalWar: { value, positionRank, position }` and show it in the impact grid labelled "Positional WAR". No compute; absent view shows nothing.
10. Money: `money.budgets` filtered to alive rosters (all rosters in standard leagues). `T = money.totalBudget ?? fallbackBudget`. When `money.totalBudget` is null, rivals' budgets are unknown: run the manual-style priors curve (7.8 rule 11) instead of the simulation and keep the existing notice.
11. Auction: history via 7.5 (seasons from `market.history.lookbackSeasons`), heat and tendencies via 7.6, rivals via 7.7, simulate once with seed `pulseSettings.simulation.seed`.
12. Ladder via 7.8. Remove `market.history.blendWeight` blending (A2) and the `urgency` signal (A3); the calendar now enters rival centres only.
13. Report additions (7.13).

### 7.10 Manual mode

New controls in the manual form, in this order, all native radios or selects with labels:
1. League type: "Redraft", "Dynasty or keeper", "Chopped or guillotine". Default Redraft.
2. Superflex: "One QB" / "Superflex". Default One QB. Superflex changes `manualReplacement` QB starters per team from 1.0 to `superflexQbPerTeam` (new setting, default 1.9) and picks superflex priors cells.
3. Teams, starters (as today), budget (as today; relabel "Your remaining FAAB" and add "League starting budget" defaulting to 100, since prices are shares of the full budget).
4. How does your league bid: "Tight", "Typical", "Wild" (style multiplier).
5. How many teams will chase him: "Let us guess" (default), "Just me", "One or two", "Half the league". Maps to bidders "1", "2", "3", "4p". "Let us guess" picks from upgrade strength: at least 0.6 gives "4p", at least 0.3 gives "3", at least 0.1 gives "2", else "1".
6. Need (manual mode only).
7. Chopped only: "Teams at the start", "Teams still alive", "Your danger this week" ("Bottom two", "Near the cut", "Middle of the pack", "Safe"), "Platform rules" ("Sleeper Chopped", "Yahoo Death League", "ESPN Knockout", "FFPC Chop Classic", "Fantasy Life Guillotine", "Other"). The platform preset sets `minBid` (FFPC and NFFC 1, others 0) and `releaseCutoffWeek` (FFPC 14, Fantasy Life 14, others null).
- `outlook.ts` season end: replace the hardcoded 14 with `settings.userDefaults.defaultLastRegularWeek` (new, default 14); chopped manual uses 17.
- The compact layout: on `lg` and up the setup is one row of grouped controls above the result; below `sm` they stack. The result stays in the sticky right column as today. Keep every control reachable; hide nothing at any breakpoint.

### 7.11 Value summary

Worth (league mode, standard) = `upgradeStrength(points incl. weighted playoff weeks, playoff odds, title odds) x maxPctFromUpgrade x playerSignals`, blended with dynasty value when applicable. Player signals now include the teammate signal and use breakout-blended projections. Need is gone from league mode.

### 7.12 Chopped model

#### 7.12.1 Detection and helpers (`lib/chopped/league.ts`, pure)

- `isChoppedLeague(settings: Record<string, unknown> | null | undefined): boolean` = `Number(settings?.type) === 3 && Number(settings?.disable_elimination ?? 0) !== 1`.
- `isAliveRoster(rosterSettings): boolean` = eliminated is 0, null or absent. Use `rosters.metadata.settings.eliminated`.
- `eliminatedWeek(rosterSettings): number | null`.
- Add `eliminated?: number` and `locked?: number` to a new `SleeperRosterSettings` type in `lib/sleeper.ts` for documentation; the field is read from stored metadata, never from a new Sleeper call.
- `lib/faab/league-load.ts loadLeagueValueContext` (D1): `isKeeperLeague = config?.league_type === 'dynasty' || sleeperType === 1 || sleeperType === 2`. Chopped (3) is NOT a keeper league. Add a test.

#### 7.12.2 Season shape

- `aliveCount` = alive rosters. `startCount` = all rosters. `aliveFraction = aliveCount / startCount`.
- `finalWeek`: VERIFY FIRST what `settings.last_chopped_leg` means. Check: for the one completed chopped league in our data (2025, 18 teams, `last_chopped_leg: 17`), list each roster's `eliminated` week; if the last elimination week equals `last_chopped_leg`, it is the final chop week. Until verified, `finalWeek = Math.min(17, currentWeek + aliveCount - 2)` and ignore the field. Record the finding in progress.md and in the `lib/chopped/league.ts` header.
- `weeks = currentWeek .. finalWeek`.
- Release cutoff: Sleeper has no confirmed cutoff; manual presets set it (7.10). When a cutoff exists and `currentWeek > cutoff`, the pool stops refilling: show "Chopped rosters are no longer released in this league" and price only against existing free agents.

#### 7.12.3 Weekly distributions

For each ALIVE roster, `buildRosterWeeks` as today (projections under the league's scoring), then `buildOptimalLineup` per week gives `{ mean, sigma }` (reuse `buildLineupTotals`). Eliminated rosters are dropped everywhere: rivals, budgets, heat, simulation.

#### 7.12.4 Survival simulation (`lib/chopped/survival.ts`, pure)

```ts
export type SurvivalTeam = { rosterId: number; seasonPoints: number;
  weeks: Map<number, { mean: number; sigma: number }> };
export type SurvivalResult = { rosterId: number; pChoppedThisWeek: number;
  pAliveAfter: Map<number, number>; expectedWeeksAlive: number; pWin: number };
export function simulateSurvival(teams: SurvivalTeam[], weeks: number[],
  opts: { runs: number; seed: number; choppedPerWeek?: number }): Map<number, SurvivalResult>;
```

Per run: copy alive set and season points. For each week in order, while more than one team is alive: draw each alive team's score `max(0, mean + sigma * z)` (a missing week uses that team's mean of known weeks, sigma the same); add to season points; the lowest score is chopped, ties broken by lower season points (Sleeper rule; week-1 draft-slot tie rule ignored, stated in a code comment). `choppedPerWeek` defaults 1. After the last week, the survivor with the most season points in the final week wins if more than one remains (ESPN and NFFC style finals are out of scope for Sleeper; manual presets use the same rule). `expectedWeeksAlive` counts weeks survived from `currentWeek`. Same seed for before and after.

#### 7.12.5 Upgrade strength (chopped)

Run the reader's swap with `computeLineupSwap` (mustDrop fixed, drop guard with `isKeeperLeague = false`). Simulate survival before and after (only the reader's weekly distributions change).
- `surviveGain = (pChoppedBefore - pChoppedAfter) * 100` points.
- `winGain = (pWinAfter - pWinBefore) * 100`.
- `weeksGain = expectedWeeksAliveAfter - expectedWeeksAliveBefore`.
- `strength = w1*clamp(surviveGain/bigSurvivePoints,0,1.25) + w2*clamp(winGain/bigWinPoints,0,1.25) + w3*clamp(weeksGain/bigWeeksAlive,0,1.25)`, clamped 0 to 1.
- `worthPct = strength * chopped.maxPctFromUpgrade * playerSignals * priceByAliveFraction(aliveFraction)`.

The alive-fraction multiplier sits on worth as well as on rival centres because money in a chopped league loses value as the field shrinks and the pool fills with starters (4.2: Jefferson minus 22%, St. Brown minus 77%; Eliminator medians 28.9% to 12.8% to 0%).

#### 7.12.6 Rivals in a chopped league

- Every alive roster other than the reader is a rival.
- Interest: `computeLineupSwap` per rival as in standard mode.
- Centre: `rivalWorth * heat * tendency * priceByAliveFraction(aliveFraction) * (1 + dangerWeight * dangerShare_k)` where `dangerShare_k = pChoppedThisWeek_k / max over alive of pChoppedThisWeek`. Heat and tendency use chopped priors cells (league kind `chopped`, phase by alive fraction).
- Substitutes: load the league's free agents at the candidate's position (`loadLeagueFreeAgents`, then project the top 40 by rank with the same projection path) and count those whose rest-of-season mean is at least `substituteShare` of the candidate's. Pass `participationScale = 1 / (1 + substituteDiscount * substitutes)` to `simulateAuction`.
- Tiebreak: Sleeper rolling waiver priority, as standard.

#### 7.12.7 Chopped report fields

```ts
export type ChoppedRead = {
  aliveCount: number; startCount: number; currentWeek: number; finalWeek: number;
  finalWeekVerified: boolean;
  before: { pChoppedThisWeek: number; pWin: number; expectedWeeksAlive: number };
  after: { pChoppedThisWeek: number; pWin: number; expectedWeeksAlive: number };
  dangerRank: number;                  // 1 = most likely chopped this week
  moneyLeftInLeague: number;           // dollars, alive teams only
  yourShareOfMoney: number;            // 0..1
  yourMoneyRank: number;               // 1 = richest
  pace: { holdPct: number; targetHoldPct: number; status: "ahead" | "on-pace" | "behind" };
  substitutes: number;
  releaseCutoffWeek: number | null;
};
```

Pace: `holdPct = remaining / T * 100`; target from `paceTargets` (first entry with `throughWeek >= currentWeek`); within 10 points is "on-pace", above is "ahead", below is "behind".

#### 7.12.8 Chopped goal and copy

- Default goal flips to "sure" when `before.pChoppedThisWeek >= dangerThreshold`, and the headline is "Survive this week".
- Reasons use chopped words: "Cuts your chance of being chopped this week from 18% to 9%", "12 teams left, and 7 of them would start him", "You hold 64% of the money left in the league, 2nd most".
- Never mention playoffs, schedule, opponents or "wins" in chopped copy.

#### 7.12.9 Manual chopped

- Worth: manual marginal (points over replacement) with the league's scale, times `priceByAliveFraction(alive/start)`, times `manualDangerMultipliers[danger]`.
- Price curve: priors cell (`chopped`, superflex, position, alive phase, bidders from competition control or "Let us guess"), style multiplier.
- Default competition guess in chopped: bidders "4p" when upgrade strength is at least 0.4 and alive fraction at least 0.5, otherwise the standard mapping.

#### 7.12.10 Chopped-specific non-goals

- Power Pulse, schedules and League Pulse pages for chopped leagues are NOT changed in this build. Write a follow-up line in the final report noting D3 applies to Power Pulse too.

### 7.13 Report and view changes

- `LeagueFaabReport` gains: `leagueKind: "standard" | "chopped"`, `goalDefault: GoalKey`, `ladder: BidLadder` (new shape), `rivals: RivalRow[]`, `injuredStarters`, `positionalWar`, `chopped: ChoppedRead | null`, `heat: { value: number; samples: number } | null`, `priorsFallback: string | null`.
- `RivalRow = { rosterId: number; teamName: string; budget: number; wouldStart: boolean; style: "Spends big" | "Typical" | "Holds money" | "Not enough history"; likelyBid: { low: number; high: number } | null }` where likely bid is centre x exp(-bidSigma) to centre x exp(bidSigma), in dollars, capped at budget. Only rivals who would start him are listed, sorted by likely high bid; the rest are summarised as "N other teams would not start him".
- `MarketRead`: drop `comparable` and `urgencyMultiplier`; add `calendarMultiplier`, `aliveCount`.
- `BidView` in `bid-result.tsx` mirrors these plus `mode: "league" | "manual"` and `leagueKind`.
- `MultiLeagueRow` unchanged in shape; its list shows bid, win chance and walk away.
- `lib/faab/calculate-faab.ts` (old rank curve) stays only as the no-projection fallback. Label that result "Rough estimate, no projections available" and render it through the same `BidResult` shell with win chance hidden.

### 7.14 UI spec

Files: rewrite `app/tools/faab/bid-result.tsx`, split into:
- `bid-result.tsx` (shell and `viewFromLeagueReport`)
- `bid-hero.tsx`
- `win-chance-chart.tsx`
- `bid-reasons.tsx`
- `rival-table.tsx`
- `chopped-card.tsx`
- `bid-actions.tsx`
- `goal-toggle.tsx`
- keep drop list, week strip and signals as their own components moved out of the old file.

Order on screen:
1. Heading row: player name as `h3` (fixes B6; section headings inside are `h4`), subtitle "{league}, week {n}" or "{teams}-team, {format}, manual", confidence pill ("Strong read", "Reasonable read", "Thin read").
2. `GoalToggle`: a `fieldset` with legend "What matters more?" and two native radios, "Good value" and "Make sure I win". Switching reads `bidsByGoal` and re-renders; no server call. The live region announces the new bid.
3. `BidHero`: "Bid {dollars}" in the gradient mono figure; beside it "{winChance}% chance to win"; under it "Worth up to {walkAway} to you. Above that, let him go." When over worth on the sure goal: "That is {n} over his worth to you, the price of making sure." When `priceAboveWorth`: headline string from 7.8 plus "Bid {walkAway} and let him go above it."
4. `WinChanceChart`: `ChartFigure` titled "Your chance to win at each bid", `titleLevel={4}`. SVG step line of win chance from 0 to the reader's budget, x in dollars, y 0 to 100%; vertical marks at the bid, stretch and walk away with text labels; shaded band for the rivals' top bid p50 to p75. `summary` sentence: "Bidding {bid} wins about {w}% of the time; {walk} wins about {w2}%. The most likely top rival bid is {p50} to {p75}." `table`: rows every 5% of budget (and the three marked bids) with columns Bid, Chance to win. Hover tooltip per step. Colours from chart-kit series constants; text in ink tokens.
5. `BidReasons`: `h4` "Why this number", an `ul` of three to five one-line reasons generated by `lib/faab/reasons.ts` (pure, deterministic templates, each citing a figure in the report, a null figure means the reason does not fire, ordered by effect size). Templates in 7.14.1.
6. `ChoppedCard` (chopped only): `h4` "Survival". A `dl` with: chance you are chopped this week (before to after), chance you win the league, expected weeks alive, teams left, money left in the league and your share and rank, pace line.
7. `RivalTable`: `h4` "Who else wants him". A real `table` with `caption` "Teams that would start {player}, and what they can spend". Columns: Team, Budget left, Bid style, Likely bid. Team names are real (owner decision 2). Below: "N other teams would not start him."
8. Impact grid (existing figures plus Positional WAR), drop options, week strip, signals, notices. On mobile the week strip, signals and notices are inside one `details` "More detail", closed by default; on `lg` open. Nothing is hidden, only collapsed behind a disclosure with a visible summary.
9. `BidActions`: "Copy bid" button (clipboard text below; status message "Copied" in the live region), "Share image" button (copies the OG URL, uses existing `share` analytics event with `content_type: "faab_bid"`), and in league mode "Check this bid in all my leagues" (existing all-leagues action).

Copy text format (exact):

```
FAAB: bid {bid} of {budget} on {player} ({winChance}% to win). Walk away above {walkAway}. ffbeacon.com/tools/faab
```

Live region: exactly one `role="status" aria-live="polite"` per mode (the existing ones), message: "{headline}. Bid {bid} FAAB, {winChance} percent chance to win, walk away above {walkAway}." Chopped appends ", chance of being chopped this week {after} percent."

Accessibility (non-negotiable, audited by sub-agent): no `aria-hidden` on any figure; units in the same text node or sr-only inside the same element; 44 px targets; focus visible; `prefers-reduced-motion` stops the win bar animation; heading order h2 section, h3 result, h4 parts; every chart has a table; the goal toggle is a native radio group; colour never the only signal (tone chips have words).

Design: FF Beacon tokens only (dark default, purple #A855F7, cyan #22D3EE, Geist and Geist Mono). One gradient figure per card (the bid). Tone chips: good, bad, neutral with words. Mobile keeps every figure (stacked cells).

Form: league panel stays first. The need control moves inside the manual form's own fieldset and gets the note "Manual mode only. With a league connected we read your need from your roster." League mode shows the auto-read need line instead: "{n} starters out this week" or "No starters out".

#### 7.14.1 Reason templates (`lib/faab/reasons.ts`)

Each returns a string or null. Numbers rounded as shown.
- rivals: "{n} teams would start him, {k} of them with a starter out." (k from rivals' own injured starters, omit the clause when 0) / "Nobody else would start him."
- upgrade: "Adds {x.x} points a week over {dropName or 'your current lineup'}{', playoffs included' when playoff weeks counted}."
- odds: "Playoff odds {a}% to {b}%." / chopped: "Cuts your chance of being chopped this week from {a}% to {b}%."
- heat: "Your league pays {h.h} times the usual price for contested adds." (only when samples >= 10 and |h - 1| >= 0.15)
- money: "The richest rival holds {r}; you hold {y}." (only when a rival can outbid you or none can)
- calendar: "Weeks 2 to 6 are the busiest bidding of the season." / "From week 14 leftover FAAB buys nothing." (only when multiplier differs from 1)
- teammate: "His starter, {name}, is {status}."
- dynasty: "In a dynasty league his long-term value adds to the bid." (when blend weight >= 0.3 and valuePct > pointsWorth)
- chopped money: "{alive} teams left, holding {money} between them; you hold {share}%."

### 7.15 OG image and analytics

- `app/api/og/faab/route.tsx`: GET params `p` (Sleeper player id, `^[0-9A-Za-z_-]{1,32}$`), `bid`, `walk`, `budget` (ints 0 to 100000), `win` (int 0 to 100), `k` (`standard` or `chopped`). Validate, then rate limit bucket `og_faab`, 20 per 60 s, fail closed with 429 as in start-sit. Card: player headshot and name (from `players` by Sleeper id), "Bid {bid} of {budget}", "{win}% chance to win", "Walk away above {walk}", "FF Beacon" wordmark, "ffbeacon.com" footer, brand gradient. No league or team names on the card. Cache header as start-sit. `runtime = "nodejs"`. Add a test like `app/api/og/war/route.test.ts` for param validation.
- Analytics (`lib/analytics.ts`): extend the union with `{ name: "faab_result"; params: { mode: "league" | "manual"; league_kind: "standard" | "chopped"; goal: GoalKey; bid_pct: number; win_chance: number } }` and `{ name: "faab_goal_change"; params: { goal: GoalKey } }`. Fire `faab_result` once per result, `faab_goal_change` on toggle, `share` with `content_type: "faab_bid"` on copy and share.

### 7.16 Calculator page content

Changes to `app/tools/faab/page.tsx` and `written-sections.tsx`:
- Meta description (after the auction model ships): "Free FAAB calculator: how much to bid on any waiver claim, your chance to win it, and when to walk away. Chopped and guillotine leagues too."
- Masthead description: "What to bid, your chance to win, and when to walk away. Connect your Sleeper league, chopped leagues included, or enter your setup by hand."
- New server component `app/tools/faab/market-stats.tsx`, section heading `h2` "What leagues actually pay", placed after the explainer steps. Reads `loadPriorCellsCached()`. Content:
  - Intro: "Winning FAAB bids from {leagues} Sleeper leagues synced to FF Beacon, seasons {min} to {max}, as a share of each league's budget. Updated {formatEasternDate(built_at)}. No league or manager is identifiable."
  - Table 1 "By how many teams bid": rows 1, 2, 3, 4 or more; columns median, 1 in 4 paid more than (p75), 1 in 10 paid more than (p90). Cells from `any|any|any|any|{bidders}`.
  - Table 2 "By week of the season": standard phases, cells `any|any|any|{phase}|any`.
  - Table 3 "By position when 3 or more teams bid": QB, RB, WR, TE, one-QB versus superflex columns for QB.
  - Table 4 "Chopped and guillotine leagues, by teams left": alive phases.
  - A sentence under the tables: "Winners paid a median of {x} times the second-highest bid." from `runner_up_ratio_p50` of the `any` cell.
  - Any cell below `minCellSamples` renders "Not enough data yet". Never render a table whose every cell is below the threshold.
  - Each table is a real `table` with a `caption`; add a small bar chart for Table 1 through `ChartFigure` (single series, cyan).
- `FAAB_FAQ` additions (answers drafted; keep straight quotes, no em dashes):
  - "Can you bid $0 in FAAB?" Yes on Sleeper, Yahoo, ESPN and Fleaflicker, and a $0 bid wins when nobody else bids. High-stakes leagues like the NFFC and FFPC set a $1 minimum. The calculator reads your league's minimum when it is connected.
  - "What happens when two FAAB bids tie?" Sleeper and Yahoo give it to the team higher in the rolling waiver order, and that team drops to the back. ESPN follows waiver order, Fleaflicker gives it to the worse team, and the FFPC gives it to the team with fewer points. The calculator counts your waiver position when it prices a tie.
  - "Is a $100 budget different from $1,000?" Only in the numbers. Think in percentages: 12% is $12 of $100 and $120 of $1,000. Every figure here is a share of the league's full budget and converted to your dollars at the end.
  - "Should I spend my FAAB early?" In our synced leagues the most expensive stretch of the regular season is weeks 2 to 6, and prices jump again from week 14 when leftover budget is worth nothing. A starter who appears in September is often worth more than whoever appears in November, because you get him for more weeks.
  - "How much do people really bid?" Answered from the market-stats cells with live numbers (render this answer from data, and keep a static fallback sentence when priors are empty).
  - "How does FAAB work in dynasty?" Budgets usually do not roll over or reset on Sleeper unless the commissioner does it, and a young player's long-term value counts. With a dynasty league connected the calculator blends his market value into the bid, more for a rebuilding team than for a contender.
  - "How is superflex different?" A second starting quarterback is scarce, and our data has quarterbacks going for the whole budget after an injury. Pick Superflex in the setup so the calculator prices quarterbacks against a superflex replacement level.
  - "How does FAAB work in chopped and guillotine leagues?" The lowest scorer is eliminated each week and the whole roster goes to waivers, so budgets are big and the goal is surviving the week. Prices fall as teams are eliminated because fewer rivals chase a pool full of starters. Connect a Sleeper chopped league or pick Chopped or guillotine in the setup, and read our chopped league strategy guide. (Link to the new guide.)
- `/guides/faab-strategy` quotes the calculator's current behaviour (the early-season discount, the old bid bands, the old rung names). Those passages must change in the same build; the exact edits are section 5 of `docs/faab/chopped-guillotine-guide-seo-plan.md`.
- Explainer step 4 renamed "Get a bid and your chance to win" with body describing goal toggle and walk away.
- Notes: add "Works for chopped and guillotine leagues" (tone cyan) with a link to the new guide.

### 7.17 Admin

`app/admin/faab/faab-settings-manager.tsx` gains sections (same `SectionCard` / `CollapsibleSection` patterns, every input labelled):
- "Auction model" (badge "League mode"): runs, participation, stray bid rate, bid spread, heat and tendency shrink and clamps, earliest week counted, odd-number nudge.
- "Goals": default goal, value target, sure target, most over worth for "make sure".
- "Time of season": the calendar bands editor (add, remove, contiguous validation message).
- "Market data": minimum samples per cell, rebuild after N days, style multipliers, a read-only line "Last built {formatEastern(built_at)}, {cells} cells from {leagues} leagues", and a "Rebuild now" button calling a new admin server action `rebuildFaabPriors()` (requireAdmin, then `rebuildFaabMarketPriors`, then `revalidateTag`).
- "Playoffs and title", "Dynasty value", "Injuries and roles", "Chopped leagues" (every chopped field, including the alive-fraction and pace tables).
- "Replay": runs the replay (7.18) on demand and shows the summary table.
Remove the "Time of season" urgency fields and the history blend field once nothing reads them.

### 7.18 Replay (replaces the calibration in `backtest.ts`)

`lib/faab/replay.ts` (pure) plus `lib/faab/replay-load.ts`:
- For every league auction in our data with 2 or more bids and week >= 2 (standard) or any week (chopped): rebuild what the model can know WITHOUT historical rosters: the priors-curve price (7.8 rule 11) for the auction's cell, with bidders from the real count minus one, league heat computed from auctions strictly BEFORE this one, and tendency ignored.
- Metrics: share of auctions where the value-goal bid would have won (beats the real winning bid, tie by 0.5), share for the sure goal, median overpay versus the real winner (bid minus winning bid when won), and the same split by phase and by chopped alive phase.
- Targets to report (not to gate the build): value goal wins 55 to 75%, sure goal wins 85 to 95%, median overpay below the observed winner-minus-runner-up median of 2% of budget.
- `scripts/faab-replay.ts` plus `"faab:replay"` npm script printing the table; the admin "Replay" section calls the same function through a server action (requireAdmin).
- Delete `lib/faab/backtest.ts` once replay replaces it and nothing imports it.

---

## 8. Tests to write (all vitest, colocated `*.test.ts`)

- `lib/faab/league-faab` roster limit helper (extract `rosterIsFull(roster, rosterPositions)` into `lib/faab/roster.ts` and test: two IR plus open bench spot is not full; taxi players ignored; full active roster is full).
- `lib/faab/league-load.test.ts`: `loadLeagueValueContext` decides keeper correctly for types 0 to 3 (mock client), `loadAuctionHistory` grouping (pure grouping function extracted as `groupAuctions(rows)`).
- `lib/faab/priors-build.test.ts`: phases, superflex detection, alive fraction, `any` rollups, quantiles, clamp over-budget bids, skip zero-budget leagues.
- `lib/faab/priors-read.test.ts`: `pickCell` fallback order, `priorCdf` monotone and bounded.
- `lib/faab/tendency.test.ts`: heat shrink, clamps, no-sample defaults, labels.
- `lib/faab/auction.test.ts`: deterministic for a seed; win chance non-decreasing; nobody interested gives near 1 at min bid; budget caps respected; tie handled with and without waiver positions; more interested rivals lowers win chance at a fixed bid.
- `lib/faab/ladder.test.ts` rewritten: goals, caps, over-worth labelling, odd nudge, bench-only, nobody-bids, dump triggers, manual priors path.
- `lib/faab/reasons.test.ts`: each template fires only with its figure, and no output contains the code points U+2013, U+2014, U+2018, U+2019, U+201C, U+201D or U+2026 (write the test regex with escape sequences, never the literal characters).
- `lib/chopped/league.test.ts`, `lib/chopped/survival.test.ts` (seeded; equal teams give about 1/N chop chance; a much stronger team rarely chopped; tie rule; expected weeks bounded), chopped strength and worth.
- `lib/faab/settings.test.ts`: every new zod rule.
- `app/api/og/faab/route.test.ts`: param validation.
- Update existing tests broken by removed fields; never delete a test to make it pass without replacing its intent.

---

## 9. Task list

### 9.1 progress.md format

```
FB-T01 | pending | Fix roster limit to count active players only
     | files: lib/faab/roster.ts, lib/faab/roster.test.ts, lib/faab/league-faab.ts
     | depends on: none
     | verified: no
```

Status values pending, in_progress, blocked, completed. Add a `notes:` line with the date (Eastern) when completing. One file or one concern per task.

### 9.2 Tasks, in build order

Phase 1, correctness
- FB-T01 Roster limit fix (A5). Files: `lib/faab/roster.ts`, test, `league-faab.ts`.
- FB-T02 Keeper detection excludes chopped (D1). Files: `lib/faab/league-load.ts`, test.
- FB-T03 Remove need multiplier from league mode (A7). Files: `lib/faab/ladder.ts`, tests. Keep for manual.
- FB-T04 Move the need control into the manual fieldset with its note; add league auto-need line. Files: `app/tools/faab/faab-form.tsx`, `league-panel.tsx`.
- FB-T05 Heading order fix (B6). File: `app/tools/faab/bid-result.tsx`.
- FB-T06 Manual season end setting (A9). Files: `types.ts`, `default-settings.ts`, `settings.ts`, `outlook.ts`, admin quick setup field.
Phase 2, market data
- FB-T07 Migration 0289 `faab_market_priors` with RLS; verify per 7.3; regenerate types.
- FB-T08 `lib/faab/priors-build.ts` plus tests.
- FB-T09 `lib/faab/priors-load.ts` (paged reads).
- FB-T10 `lib/faab/priors-write.ts` plus `scripts/build-faab-priors.ts` plus npm script; run it once and record cell count in notes.
- FB-T11 `lib/faab/priors-read.ts` (cache, `pickCell`, `priorCdf`) plus tests; cache tag in `lib/cache-tags.ts`.
- FB-T12 Cron step in `recalculate-derived` plus header comment.
- FB-T13 `loadAuctionHistory` plus `groupAuctions` plus tests; VERIFY waiver position direction (7.7) and record.
- FB-T14 `lib/faab/tendency.ts` plus tests.
Phase 3, auction and ladder
- FB-T15 Settings groups: auction, goal, calendar, priors (types, defaults, zod, tests).
- FB-T16 `lib/faab/auction.ts` plus tests.
- FB-T17 New `BidLadder` and `buildLadder` rules plus tests (standard and manual paths).
- FB-T18 `lib/faab/reasons.ts` plus tests.
- FB-T19 Wire auction, heat, tendency, rivals, calendar into `calculateLeagueFaab`; remove history blend and urgency; report additions.
- FB-T20 Manual mode: new controls and priors-based pricing in `manual-result.tsx`, `faab-form.tsx`.
Phase 4, value upgrades
- FB-T21 Settings groups: playoffValue, dynastyValue, injury, breakout (types, defaults, zod, tests).
- FB-T22 Playoff weeks with weights and title term (`marginal.ts` weekWeights, `ladder.ts upgradeStrengthOf`, `league-faab.ts`).
- FB-T23 Dynasty value blend with reader-resolved source (fixes A14).
- FB-T24 Injury carry and `injuredStarters`.
- FB-T25 Teammate signal plus `loadTeamDepth`.
- FB-T26 Breakout blend.
- FB-T27 Positional WAR read and display.
- FB-T28 Empty-the-clip new triggers.
Phase 5, chopped
- FB-T29 `lib/chopped/league.ts` plus tests; VERIFY `last_chopped_leg` and record.
- FB-T30 Chopped settings group (types, defaults, zod, tests).
- FB-T31 `lib/chopped/survival.ts` plus tests.
- FB-T32 `calculateChoppedFaab` in `lib/faab/league-chopped.ts` (alive filter, survival before and after, strength, rivals with danger and substitutes, pace, report).
- FB-T33 Priors: chopped phases verified in built cells.
- FB-T34 Manual chopped controls and pricing.
Phase 6, result UI
- FB-T35 Split `bid-result.tsx` into the components in 7.14; `GoalToggle`.
- FB-T36 `BidHero` and `WinChanceChart`.
- FB-T37 `BidReasons` and `RivalTable`.
- FB-T38 `ChoppedCard`.
- FB-T39 `BidActions` (copy, share, all leagues) and live region messages.
- FB-T40 Multi-league list shows bid, win chance, walk away.
- FB-T41 OG route plus test.
- FB-T42 Analytics events.
Phase 7, content and admin
- FB-T43 `market-stats.tsx` section.
- FB-T44 FAQ additions, explainer copy, meta and masthead copy.
- FB-T45 Admin sections and `rebuildFaabPriors` action.
- FB-T46 Replay (`lib/faab/replay.ts`, loader, script, admin section); delete `backtest.ts`.
- FB-T47 Guide work per `docs/faab/chopped-guillotine-guide-seo-plan.md` (its own task list, prefix FB-G).
Phase 8, finish
- FB-T48 Full `npm test`, `npm run typecheck`, `npm run lint`; fix everything.
- FB-T49 Manual QA (section 10) in the dev server against at least one standard Sleeper league and one chopped league from our data.
- FB-T50 Final review sub-agents (implementation, accessibility incl. "no data hidden at any breakpoint", security incl. RLS on the new table and the rate limits on the OG route and actions).
- FB-T51 Write `handoff.md` section for this build and the final report (section 11). Do not commit or push.

---

## 10. Verification and QA checklist

- `npm test`, `npm run typecheck`, `npm run lint` all pass.
- Migration verified per CLAUDE.md sequence and 7.3.
- `npm run faab:priors` builds cells; `npm run faab:replay` prints targets (report the numbers, whatever they are).
- Dev server: `/tools/faab`
  - Manual: pick a running back, 12 teams, superflex off, Typical, Let us guess. Win chance shows; toggle goal and confirm the bid changes without a network request.
  - Manual chopped: 18 start, 10 alive, Near the cut; confirm chopped reasons and no playoff words.
  - League: connect a standard Sleeper league we hold; confirm rivals table with real team names, heat reason when applicable, IR roster no longer forces a cut.
  - League: a chopped league from our data; confirm eliminated teams absent from rivals and money, survival card present, default goal flips when in danger.
  - Keyboard only: reach every control, toggle goal, copy bid; screen reader announcement matches 7.14.
  - 400 px width: every figure visible or behind a labelled disclosure, no horizontal scroll.
  - `prefers-reduced-motion`: no animation.
  - Times displayed Eastern.
- Search the diff for banned characters: em dash, en dash, curly quotes, ellipsis character.

## 11. Finish protocol

1. Do not commit. Do not push. Do not create a branch.
2. Update every FB task in `progress.md` to its true status with notes.
3. Add a dated section to `handoff.md`: what shipped, what did not, every VERIFY FIRST result, replay numbers, open follow-ups (D3 for Power Pulse on chopped leagues).
4. Final report to the owner in plain text (screen reader): files changed grouped by phase, test and typecheck results with counts, replay numbers, verification results, anything skipped and why, and the AI-writing check result.

## 12. Out of scope

- Changing Power Pulse, schedules or League Pulse for chopped leagues (follow-up).
- Non-Sleeper league sync (manual mode covers other platforms).
- Per-player weekly FAAB articles.
- Any per-league cron.

## 13. Sources

Standard FAAB:
- https://sleeper.com/blog/how-does-faab-bidding-work/
- https://support.sleeper.com/en/articles/4678615-how-do-faab-and-waivers-work
- https://sleeper.com/blog/what-is-faab-fantasy-football/
- https://support.sleeper.com/en/articles/12111984-suggested-faab-bids
- https://help.yahoo.com/kb/SLN6811.html
- https://support.espn.com/hc/en-us/articles/4407164936980-Waiver-Order-Overview-and-Free-Agent-Budget-Tiebreaker
- https://www.fleaflicker.com/help/waivers
- https://home.myfantasyleague.com/features.html
- https://fantasyanalyst.substack.com/p/2024-waiver-wire-overview
- https://myffpc.com/cms/public/play/main-event-rules-explained
- https://www.fantasypros.com/2025/09/fantasy-football-waiver-wire-pickups-win-championships/
- https://www.fantasypros.com/2025/08/fantasy-football-strategy-faab-waiver-wire-advice/
- https://fantasyanalyst.substack.com/p/2026-fantasy-football-nffc-primetime-964
- https://fantasyanalyst.substack.com/p/2026-fantasy-football-circa-world-4cb
- https://www.legendaryupside.com/faabulous-football-week-2-the-clip-curse-continues/
- https://www.4for4.com/2025/preseason/ultimate-guide-waiver-wire-faab-strategy-2025
- https://www.thefantasyfootballers.com/analysis/fantasy-football-101-faab-strategies/
- https://dynastytradegenerator.com/guides/dynasty-faab-strategy
- https://dynastytradegenerator.com/faab-calculator
- https://scoutcast.ai/blog/what-is-faab-in-fantasy-football/
- https://www.rotoballer.com/faab-waiver-wire-advice-week-4-fantasy-pickups-2025/1704354
- https://fantasysquawk.com/handcuffs
- Competitors: https://www.fantasypros.com/nfl/myplaybook/waiver-wire-assistant.php , https://www.fantasylife.com/tools/waiver-wire , https://www.faabtastic.com/ , https://www.faablab.app/ , https://faabfax.com/ , https://myfantasyanalyzer.com/waiver-wire/ , https://leaguelogs.com/guides/faab-calculator

Chopped and guillotine:
- https://x.com/SleeperHQ/status/1956124863434838030 and https://x.com/SleeperHQ/status/1959016458559619322
- https://support.sleeper.com/en/articles/12005468-introduction-to-chopped-leagues
- https://sleeper.com/chopped
- https://support.sleeper.com/en/articles/1876040-how-does-faab-bidding-work
- https://github.com/sengi12/triplecrown/pull/74
- https://myffpc.com/cms/public/play/chop-classic-leagues-official-rules
- https://www.fantasylife.com/articles/guillotine-leagues/how-to-set-up-our-waiver-wire-in-guillotine-leagues
- https://www.fantasylife.com/articles/guillotine-leagues/guillotine-leagues-waiver-wire-strategy-how-to-manage-faab-2026
- https://www.fantasylife.com/articles/guillotine-leagues/guillotine-league-adds-and-faab-advice-for-week-7 (and weeks 8, 9, 11, 12, 14)
- https://www.fantasylife.com/articles/guillotine-leagues/how-to-manage-your-faab-in-guillotine-league-fantasy-football
- https://www.fantasylife.com/articles/guillotine-leagues/how-to-win-a-guillotine-league-tips-from-a-first-time-champion
- https://www.fantasylife.com/articles/guillotine-leagues/why-its-time-to-start-adjusting-your-faab-bidding-strategy-in-gu
- https://www.fantasylife.com/articles/guillotine-leagues/guillotine-leagues-end-game-strategy-the-best-players-to-add-bas
- https://www.fantasylife.com/tools/guillotine-league-waiver-wire
- https://nfc.shgn.com/rules/2703
- https://www.si.com/onsi/fantasy/nfl/fantasy-football-guillotine-leagues-rules-strategy-waiver-wire-tips
- https://help.yahoo.com/kb/fantasy-football/overview-fantasy-guillotine-leagues-sln37116.html
- https://sports.yahoo.com/fantasy/article/death-leagues-are-back-with-new-name-and-a-new-look-125625273.html
- https://espnpressroom.com/press-release/espn-fantasy-football-introduces-knockout-leagues-format/
- https://support.espn.com/hc/en-us/articles/18378552635156-What-is-a-Knockout-League
- https://home.myfantasyleague.com/chopleagues.html
- https://bengretch.substack.com/p/guillotine-league-strategy-reader
- https://jakobsanderson.substack.com/p/pre-season-mailbag-answers
- https://www.draftsharks.com/kb/best-guillotine-league-strategy
- https://www.mastersfantasyfootballleagues.com/blog/guillotine-strategy/guillotine-faab-strategy-how-to-survive-the-chop-and-win-it-all/
- https://fantasyverdicts.com/guillotine-league-strategy
- https://www.rotowire.com/football/article/guillotine-league-waiver-wire-week-2-pickups-faab-strategy-134599
- https://www.rotowire.com/football/article/guillotine-fantasy-football-week-2-strategy-chopped-league-elimination-odds-rankings-faab-roi-tools-to-survive-134587
- https://www.thefantasyfootballers.com/analysis/fantasy-101-chopped-leagues-fantasy-football/
- https://fantasyheartbeat.com/espn-knockout
- Snippet only (page blocked): https://forums.footballguys.com/threads/first-time-guillotine-chopped-league-faab-questions.817710/
