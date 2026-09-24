# IDP across FF Beacon: data, every tool, every surface, and the IDP guide

Status: APPROVED DIRECTION, NOT BUILT. Written 2026-09-23. Revision 4 (same day): a six-part code audit re-verified every cited line, re-measured the database and Sleeper's live feed, and rewrote the build as four phases with a review stop after each. The build starts in a NEW session from this document.
Protocol: the fresh-session protocol of `docs/faab/faab-calculator-overhaul-plan.md` section 0 applies, including DO NOT COMMIT, DO NOT PUSH, DO NOT CREATE A BRANCH unless the owner says so.
Task prefix in `progress.md`: `IDP`. Task ids are `IDP-1xx` (phase 1) to `IDP-4xx` (phase 4). The revision 1 to 3 ids (IDP-01 to IDP-85) are retired; nothing was built under them.
Owner-facing summary (plain language, kept in step): https://claude.ai/artifact/3vmyhZLJ77nwexvAVNyHLA (Artifact tool: read, then republish with its url).

Written so that a Sonnet-class agent can execute each task without further research: every task names the files, the functions, the lines as read on 2026-09-23, the exact change, the test that proves it, and the condition for marking it done.

---

## Start here (new session)

1. Read CLAUDE.md and `.env.local` first. Echo the variable names.
2. Read this whole document. Section 0 holds every decision; do not reopen one without the owner. Section 2 lists what the audit corrected, so the older mental model does not leak back in.
3. Re-run section 4.6 (live checks) and record the figures in progress.md. Line numbers in this plan were read on 2026-09-23; if a file has moved, find the construct named beside the line rather than trusting the number.
4. Work one phase at a time, one atomic task at a time, in order. After each task: run the task's test, then `npm run typecheck`, then `npm test`, then update progress.md. Never leave typecheck red between tasks.
5. At the end of each phase, run the phase gate in section 9 (typecheck, full test suite, `npm run build`, the phase's database checks), then dispatch the three review sub-agents (implementation, accessibility, security) ONCE for the phase, fix findings, and STOP for the owner's code review. Do not start the next phase in the same session without the owner saying so.
6. Supabase: project `cilvpyivysjxpxbudkfa`. Migrations via MCP `apply_migration` plus a file in `supabase/migrations/` (latest on disk and applied: 0295). RLS in the same migration. Regenerate `lib/database.types.ts` after every schema change (see memory note: extract `.types`, then prettier).
7. Sub-agent spawning: never pass `name` (memory rule). Sub-agents are used for the three phase-end reviews only, to save session budget.
8. Lint: `npm run lint` cannot run today (no ESLint config, eslint not installed; `next lint` would prompt to create one). The green checklist is typecheck, test, build. The owner decides whether to install `eslint-config-next` (task IDP-401); do not install it unasked.

## The premium standard (every surface that can show a defender)

A task touching a defender surface is not done until every line holds:
- No offensive column on a defender (no rush yards, receptions, targets, carries, PPR, position rank by PPR).
- No zero that reads like a valuation and no "n/a" where a sentence belongs. A missing value renders as words ("No market value: no value source prices defensive players"). Never "0", never a red error, never "check back" for data that will never exist.
- Every IDP point figure names its scoring beside the number ("Sleeper default IDP scoring", "Big 3 scoring", "your league's scoring").
- Position chips use the DL, LB and DB colour tokens (R-22), never the grey fallback.
- Positions are spelled out in prose and in accessible names ("linebacker", not "LB"), through ONE shared helper (`positionNoun` in `lib/site.ts`, task IDP-102).
- Mobile shows every figure desktop shows (CLAUDE.md mobile rule). Screen reader row names read naturally.
- Copy, titles, meta descriptions and JSON-LD describe what a defender page actually has.
- A test asserts the defender branch of that surface, AND a test or golden asserts the offensive branch is unchanged.

---

## 0. Decisions

Owner decisions, 2026-09-23:
- D-1. DONE. Sleeper's default IDP scoring is exactly IDP123, read from a fresh test league ("FF Beacon IDP defaults check", id 1408582758980153344): solo tackle 2, assisted 1, tackle for loss 2, sack 6, QB hit 1, pass defended 3, forced fumble 3, fumble recovery 3, safety 3, blocked kick 3, interception 6, IDP TD 6; plain Tackle, sack yards, return-yard rates and all bonuses zero. UI and guide may say "Sleeper's default IDP scoring". The test league is unused and may be deleted.
- D-2. Defenders leave the PPR finishes rebuild; IDP finishes are built separately on IDP123.
- D-3. Under the projection engine switch, IDP rows are mirrored under `ffbeacon` like K and DEF.
- D-4. League Pulse IDP support is part of this build.

Design decisions (recommended defaults, overrule before the build starts):
- R-1. Types. `PulsePosition` gains DL, LB, DB. `OFFENSE_POSITIONS` (the existing six, exported from `lib/site.ts` as an alias of `POSITIONS`) pins every surface that must stay six. `IDP_POSITIONS = ["DL","LB","DB"]`, `isDefender(position)` and `positionNoun(position)` live in `lib/site.ts` and are the ONLY source of defender checks and position nouns. `lib/site.ts POSITIONS` itself is NOT widened (rankings tabs, board scopes CHECK 0056:32, search default).
- R-2. Primary and eligibility. `players.position` stays as the sync stores it today (`pickPrimaryPosition`, `lib/sync-sleeper-players.ts:139-153`, first KNOWN_POSITIONS match, which is why a Sleeper `["DB","LB"]` player is stored LB). Changing the primary rule would relabel thousands of players and their depth rooms for no product gain. `players.eligible_positions text[]` is Sleeper's `fantasy_positions` upper-cased, FILTERED to the nine `PulsePosition` values (OL, LS, LEO, OT and other labels are dropped), defaulting to `[position]`. A lineup candidate carries `position` (primary: variance curve, opponent key, accuracy) and `eligible`.
- R-3. Attribution. A seated player is credited to the position he was seated AS (`playedAs` on `LineupSlot`); in IDP_FLEX that is his primary. Positional WAR draws one curve per player at his primary; replacement at a position counts every benched player ELIGIBLE for it.
- R-4. Scoring. The canonical IDP scoring key is `idp123`. A defender is NEVER scored from `pts_ppr`, `pts_half_ppr`, `pts_std` or `pts_idp`. If a league's scoring has no nonzero `idp_*` key, a defender's projection is null ("No projection"), decided BEFORE the dot product (hazard B, section 5).
- R-5. No market value exists for IDP. In a dynasty or keeper league a defender is protected from the cut list when the optimiser seats him in at least half the remaining regular-season weeks, or ranks inside the league's IDP starter count at his primary on rest-of-season points. Trade Ideas never builds IDP into SUGGESTED packages; the builder accepts IDP with "No market value" on the value side and counts them on the wins side, with a reason sentence.
- R-6. IDP free agents: unrostered DL, LB, DB with a projection this week, ranked by points under the league's scoring, top 15 per position (`lib/idp/free-agents.ts`). Used by the Lineups waiver panel and FAAB.
- R-7. Opponent splits for DL, LB, DB in `nfl_defense_vs_position` under `idp123`; `positionReliability` for the three starts at 0 and moves only to calibrated values (IDP-406).
- R-8. Stat-line normaliser `lib/idp/stat-line.ts`: (a) derives `idp_tkl = idp_tkl_solo + idp_tkl_ast` only when a line lacks it (Sleeper DOES project `idp_tkl`, verified 2026-09-23 for 2020, 2022 and 2026, so this is a fallback); (b) for a PROJECTED line keeps only `idp_*` keys, dropping the team-defense keys Sleeper attaches to some defenders (`def_pr_yd`, `def_pr_td`, `def_kr_yd`, `def_fum_td`, `pass_int_td`) and the ADP keys; (c) for an ACTUAL line scores every key Sleeper emitted (actual lines carry no team-defense keys; they do carry `bonus_tkl_10p`, `bonus_sack_2p`, `st_*` and return keys, which Sleeper credits to the player). Threshold bonuses, `idp_pass_def_3p` and `idp_blk_kick` are effectively unprojected and the UI says so.
- R-9. Power Pulse depth includes DL, LB, DB.
- R-10. Positional WAR shows two charts, Offense and Defense. The OG card is pinned to `OFFENSE_POSITIONS` explicitly (it would otherwise draw nine lines, section 2 item 8) and carries one line saying the defensive curve is on the page.
- R-11. On The Clock, Draft Pulse, Draft Value stay offense-only. IDP tokens are filtered explicitly with tests. A defender PICK in a live draft is shown by name with the R-22 chip, gets no value verdict (IDP-215), and grades say "graded on N of M picks".
- R-12. Leagues with no IDP slot load no IDP row; the Positional WAR universe is filtered by the league's startable positions before the fill.
- R-13. IDP projection accuracy under `idp123` from the 2020 to 2025 backfill.
- R-14. Defender player profiles are a full defender variant (section 7, phase 2).
- R-15. Search: header palette and Free Agent Finder include defenders through a relevance gate (a `player_idp_seasons` row for the current or previous season with at least one game at 20+ defensive snaps, OR on an NFL team with a non-null `depth_chart_order`), built as a memoised set beside `rankedPlayerIdSet`. Signal Check search, Breakdown, generic Who Should I Start, Signal Scout and My Rankings stay out, each with a test. The Signal favourite picker ALREADY includes defenders (no position filter); it gains the noun and chip only.
- R-16. Defender profile scoring selector: Sleeper default (IDP123) first, then Big 3, FantasyPros, ESPN presets, then the signed-in reader's synced IDP leagues by name. Re-scores every figure in the browser from stored stat lines. Reader's leagues through `lib/sleeper-handle/resolve.ts` only.
- R-17. Indexing: defenders passing the R-15 gate are indexed and in `players.xml`; the rest get `robots: { index: false, follow: true }`. Titles, descriptions and `llms-full.txt` describe a defender page honestly.
- R-18. Rankings and My Rankings stay offense-only; the rankings board shows one line linking to the IDP guide.
- R-19. Trade grading with an unpriced player (Signal Check, transaction feed, trade calculator and its share page, OG trade card, Would You Rather, profile Trades tab, On The Clock trade history, League Relay trade posts, Manager Pulse verdict buckets): the player is named with "No market value" in words; totals and margin use priced pieces only; a `partial` flag renders "Partial grade: excludes N defensive players no value source prices"; when a side's priced pieces are empty there is NO verdict. Would You Rather's pool refuses any trade with an unpriced asset and retires the ones already in (3 active today, votes kept). Unresolved players (no `players` row) are reported separately from unpriced ones.
- R-20. BEAM gets full IDP support in phase 2. The early fix (phase 1) gates the stat-line card and the admin alias editor for alias rows, which is the only path a defender reaches BEAM today.
- R-21. Brief desk: defenders in `box_score_lines` get IDP columns; `rank_at_position` for a defender ranks on IDP123; `value` carries `coverage: "not_covered"`; the seed instructions tell the model how to say it. `top_scorers` stays offense-only (already true by construction).
- R-22. Colour tokens for DL, LB, DB in `tailwind.config.ts position.*`, mirrored in every accent map (list in IDP-103). Chart series for the three pass the existing distinct colour, dash and marker test; a contrast assertion is ADDED to `chart-kit.test.ts` (today's contrast figures are comments only).
- R-23. Direct-slug leaks: the Who Should I Start BOARD already refuses defenders (`lib/start-sit/load.ts:239-243, 362-367`). The leaks are the picker chip, the Beacon Breakdown core and the breakdown OG route; each refuses a defender with a sentence.
- R-24. Defender depth charts are sub-position aware (`metadata.sleeper.depth_chart_position`, read nowhere today) and never use the offensive role ladder.
- R-25. The switch. `league_power_pulse_settings.settings.idp.enabled` (default false) is threaded as a plain boolean, never read from inside a pure or client module: `slotEligibility(idpEnabled)` in `lib/power-pulse/types.ts` returns one of two frozen maps; `PULSE_SLOT_ELIGIBILITY` keeps its name and today's contents (the OFF map); every server loader reads the flag once and passes `idpEnabled` into engine inputs, fingerprints and component props (the slot-swap dialog gets it as a prop). With the flag false, every phase 3 code path is provably the OFF map, which is what makes the byte-identical tests possible.
- R-26. IDP projection rows are stored only when Sleeper attached a game (772 projected plus 521 "out" rows a week); the roughly 3,000 ADP-only placeholder rows without a game are dropped before the upsert. A row with any finite `idp_*` key is `projected`; one with a game and no stats is `out`, exactly like offense.
- R-27. Teams tab and team page: in an IDP league, defenders are listed by name in their own Defense group with "No market value"; the value total says it covers offensive players. Kickers and team defenses, silently dropped today, get a one-line note in the same task.
- R-28. League cards (League Pulse entry list, dashboard saved leagues) show an "IDP" tag derived from the live `roster_positions`, so a reader knows before opening the league.
- R-29. Golden fixtures are captured BEFORE any engine code changes (IDP-101) and stay green through the build with the switch off.

---

## 1. Why this build

- Keyword Planner (US, Sep 2025 to Aug 2026): six IDP terms at 1K to 10K a month each. None of our 11 guides covers IDP. Page one is mostly small IDP sites plus Yahoo and Footballguys.
- 40 of 674 synced leagues start IDP slots (31 of them in 2026; 31 of the 40 are dynasty by Sleeper type). Every one reports Power Pulse and Positional WAR as "ok" today, which means those models are silently computing WITHOUT the defenders those leagues start, rather than failing. Their IDP starters render as "Unknown player" on Schedules and Lineups, the cut list offers "Unknown player" as a drop, the Manager Ledger names claimed defenders "Player 12345", the form driver is inflated, and a chopped IDP league's chop odds are computed on offense-only totals (all confirmed in code, section 2).
- We already hold every defender's weekly stat line 2020 to 2026, and Sleeper serves IDP projections (RotoWire) for every season back to 2020.

---

## 2. What the revision 4 audit corrected (read before trusting any older note)

1. Hazard A (projection sync nulling) is REMOVED, not managed: `getSleeperWeeklyProjections` builds one URL with one `position[]` per entry (`lib/sleeper.ts:853-856`), so IDP positions join the same fetch, same inserts array, same `nowIso`. Never add a second fetch. An in-memory dedupe by `player_id` is needed before the upsert (none exists; a duplicate conflict key inside one 500-row chunk fails).
2. `idp_tkl` IS projected by Sleeper (772 of 772 projected defenders in 2026 week 3; 528 of 528 in 2022 week 8). R-8's derivation is a fallback. Sack yards and interception return yards are projected too. Some defenders carry team-defense keys in projections (`def_pr_yd` on 179 players) that must be dropped (R-8b).
3. The weekly IDP response is 4,358 rows, of which 772 are projected, 521 are out, and 3,065 are ADP placeholders with no game (R-26). Sleeper attaches TODAY's player object to historical rows, so historical dual eligibility is today's label; the guide's stability figure states this.
4. `lib/league-scoring.ts isUsableScoring` (85-90) requires an offensive yardage AND touchdown key, so `scoreStatMap(line, IDP123)` returns null today. Hazard B is at 207-208 (a defender under a league with no `idp_*` keys scores a confident 0 through the dot product), not at the fallback branch 263.
5. An unprojected row stores `stat_line` NULL (`lib/sync-weekly-projections.ts:331`), so an IDP row misclassified by `hasPublishedPoints` (85-91, checks `pts_*` only) would lose its line, not merely its label.
6. `player_projection_accuracy` would start writing PPR garbage for defenders the night IDP projections land (`lib/calculate-projection-accuracy.ts:609-610` grades on `pts_ppr`, positions unfiltered). D7 ships in the SAME task group as D3.
7. Widening `PulsePosition` is caught by `tsc` first: `VARIANCE_CURVES` (`lib/power-pulse/variance-curve.ts:89, 120-208`), `defaultCv` and `positionReliability` (`default-settings.ts:133, 141, 465-500`), the zod objects (`validate.ts:18-34`, which strip unknown keys), `POSITION_SERIES` (`components/chart-kit.tsx:295-308`), `lib/positional-war/engine.test.ts:26-33`, `card.tsx:98`, `components/league-war/summary.ts:27-34`, `upgrade-panel.tsx:31-38`, `lib/start-sit/reasons.ts:57-64`, `toughest-calls.ts:114-121`, and every numeric per-position setting listed in IDP-110.
8. `PLAYER_SERIES` (`chart-kit.tsx:339-345`) SPREADS `PULSE_POSITIONS` (the plan said the opposite); it silently grows to nine. The Positional WAR OG card (`app/api/og/war/[league_id]/card.tsx:65-69, 79-95, 140, 169`) admits cache rows by `isPulsePosition` and would draw nine lines; it is pinned to `OFFENSE_POSITIONS` (R-10).
9. `PULSE_SLOT_ELIGIBILITY` is a const read by pure and client modules (`lineup.ts:53,66`, `league-schedule/slots.ts:184`, `league-lineups/simulate.ts:48`, `build.ts:618`, `manager-ledger/lineup.ts:141`, `positional-war/replacement.ts:159`, engine parameter at `positional-war/engine.ts:346-358`). A DB switch cannot be read there: R-25 threads a boolean.
10. `loadAccuracy` (`lib/power-pulse/load.ts:642-693`) and `loadDefenseSplits` (701+) are called with ONE offense scoring key per league (`lib/league-schedule/data.ts:464`, `lib/league-lineups/data.ts:680`); defenders need a second read under `idp123` merged in.
11. The finishes key is the PRIMARY KEY (player_id, season, scoring) with scoring CHECK ('pts_ppr','pts_half_ppr','pts_std') (0142:24, :31). Add 'idp123' to the CHECK; no sibling table. `rebuild_positional_finishes` (0171:86-142, where clause 124-125) ranks every non-null position today (OL, P, LS included). Restrict the live RPC `get_player_positional_finishes` (0124:20) identically.
12. The Who Should I Start board already refuses defenders; the trade calculator DOES take defenders through the Sleeper import (`app/tools/trade-calculator/import-actions.ts:526-547`) and a crafted action payload (`lib/signal-check/rules/schema.ts:18-25`), and its share page drops the `noValue` flag (`lib/signal-check/freeze.ts:61-67`) so the public page shows a defender as a plain priced asset.
13. The Trade Ideas builder does NOT accept value-less assets today (`app/leagues/[league_id]/trade-ideas/page.tsx:993-997, 1006-1007, 805`); R-5's "accepts IDP" is a code change.
14. Teams tab and team page render a defender NOWHERE (`components/team-card.tsx:62-82, 831-845`), and the team page `app/leagues/[league_id]/teams/[roster_id]/page.tsx` is LIVE and linked (team-card.tsx:222, 485-486; trade-finder-card.tsx:139; league-activity/writeup.ts:1057); CLAUDE.md's "future phase" is stale.
15. `draft-snapshot.ts:402-403` stamps a value verdict from Sleeper ADP alone, so a defender pick can read "good value" with no value behind it.
16. Manager Pulse drops defenders from the first-rounds shape numerator AND denominator (`lib/manager-pulse/drafting.ts:159-160`, types.ts:154, 263) and buckets a defenders-only trade as a clear win or loss on zeros (`load.ts:1401-1406` flags unpriced PICKS only).
17. BEAM's direct and fuzzy lookups already exclude defenders (`lib/beam/resolve/player.ts:40, 408`; RPC 0201:102). The alias path is the only entry, and the live hazard is mis-resolution: "how did garrett do" resolves to Garrett Wilson at the single tier (player.ts:195-203). There are two `positionNoun` copies with different defaults (templates.ts:131 raw code, interpret/index.ts:898 empty string).
18. The Brief has no position chip anywhere (plain "LB, DAL" text); nothing to recolour. The Brief desk bundle hands the model an offensive box-score line, a PPR rank among DL and a null value with no instruction.
19. League Relay's waiver post prints "Nobody publishes a weekly projection for X, which is itself a review" for every defender (`lib/league-relay/waiver-writeup.ts:205-208`).
20. Sleeper-derived format: IDP slots have NO effect on `deriveLeagueFormat` (`lib/sleeper-to-format.ts:49-86`); the 6 IDP leagues with a null format are dynasty non-PPR, the normal null case. No change; a test pins it.
21. The R-6/R-15 relevance gate, the D5 season table and the BEAM stat reads all depend on the D1 typed columns; BEAM cannot proceed before phase 1.
22. The 3.8 matchup-points check counted unplayed weeks (Sleeper publishes zero rows in advance); filter on `is_final` (section 4.6).
23. Guide registration also needs `app/guides/page.tsx GUIDES` (:143); the two enumerating tests iterate the register and need no edit.
24. `app/api/og/team/.../route.tsx:33-38` and `app/api/og/faab/route.tsx:31-38` index a colour map with no fallback (K and DEF already yield `undefined`); the player OG card has no accent for K and DEF either. All fixed in IDP-103.

---

## 3. Research facts the guide and copy may use (unchanged from revision 3, sources in section 12)

Positions by platform: Sleeper DL, LB, DB, IDP_FLEX (dual eligibility case by case); ESPN DT, DE, LB, CB, S, DB, DP; Yahoo D, DL, DB, LB, DT, DE, CB, S (no QB hit category); NFL.com custom leagues only; Fleaflicker EDR and IL since 2020.
Scoring: IDP123 (D-1); ESPN defaults solo 1.5, assisted 0.75, TFL 2, sack 4, INT 5, FF 4, FR 4, TD 6, safety 2, PD 1.5, blocked kick 2; Big 3 solo 1.25, assisted 0.75, QB hit 2, TFL 3, FR 3, PD 4, FF 4, sack 5, safety 5, blocked kick 5, INT 6, TD 6; FantasyPros solo 1.5, assisted 0.75, TFL 2.5, sack 4, INT 5, FF 4, FR 4, TD 6, safety 2, PD 1.5. Yahoo, CBS, NFL.com defaults UNVERIFIED, never printed.
The stacking trap: Sleeper's Tackle stacks on Solo and Assisted; a sack also scores a tackle, a TFL and a QB hit. Our data: 15 of 40 IDP leagues score plain Tackle, 9 of those also score Solo (re-verified 2026-09-23).
Tackle recording: not an official NFL statistic; home crews chart them; SI 2015 assist rates 7% to 44% by crew. Sleeper corrections run through Thursday.
Adoption: The IDP Show 2025 survey of 95,284 leagues: 13.3% IDP, 37.1% IDP-lite, average 7.04 IDP starters, 71.1% of IDP managers in dynasty.
Strategy with two or more sources: linebackers dominate tackle-heavy scoring; every-down role; box safeties over free safeties and corners; sacks repeat worse than pressure (SIS R-squared 0.13 against 0.27).
Keyword map: `/guides/idp-fantasy-football` primary "idp fantasy football", secondary "what is idp fantasy football", "idp scoring", "idp scoring settings", "idp league settings", "idp positions", "dynasty idp strategy"; must NOT target "idp rankings", "idp waiver wire", "week N idp".

---

## 4. What we hold today (re-measured 2026-09-23 by query)

### 4.1 Weekly stats
- `lib/sync-sleeper-stats.ts` stores every position; the only ingest filter is the players id map (156-157). No typed defensive column exists (`lib/sleeper-stats-map.ts:70-115` writes 0 into offensive counting columns for a defender). The full object is in `player_stats.metadata.stats`.
- Regular-season defender rows with `def_snp`, joined on `players.position in (DL,LB,DB)`: 2020 9,900; 2021 11,064; 2022 10,317; 2023 10,522; 2024 10,549; 2025 9,941; 2026 1,218 so far. Total defender rows including bench weeks: 2025 19,071. (Revision 3's figures did not reproduce; use this query, section 4.6.)
- 2025 defender key coverage (player-weeks): idp_tkl 8,685; idp_tkl_solo 7,211; idp_tkl_ast 6,654; idp_qb_hit 2,146; idp_tkl_loss 2,134; idp_pass_def 1,881; idp_sack 1,210; idp_sack_yd 1,132; idp_int 366; idp_ff 347; bonus_tkl_10p 347; idp_int_ret_yd 214; idp_fum_rec 211; bonus_sack_2p 123; idp_fum_ret_yd 64; idp_pass_def_3p 63; idp_def_td 43; idp_blk_kick 41; idp_safe 9; def_snp 9,941; tm_def_snp 12,029; pts_idp 8,961 (2025 only, never read for history). Defender actual lines carry NO team-defense keys (`sack`, `int`, `def_td` absent), so a dot product cannot double count.
- `player_stats` has `opponent`, `game_id`, `season_type` (regular/post/pre), team in `metadata->>team`; unique (player_id, week, season, season_type) (0004:52).

### 4.2 Players
- `players.position`: DL 1,542, LB 1,057, DB 1,766 (status active 3,879, inactive 449, ir 37). No `eligible_positions` column; `fantasy_positions` only in `metadata.sleeper`. Multi-eligible in metadata: DL 214, LB 46 (the DB/LB players are stored LB, the DB/WR player is stored WR). `depth_chart_position` and `depth_chart_order` are in `metadata.sleeper` only.

### 4.3 Leagues and matchups
- 40 IDP leagues (31 in 2026); slot tokens in use are exactly DL, LB, DB, IDP_FLEX (no DE, DT, CB, S, DP). 20 use only IDP_FLEX. 33 distinct IDP scoring profiles counting the tackle and sack bonuses (26 on `idp_*` keys alone). Keys scored by all 40: idp_safe, idp_def_td, idp_ff, idp_fum_rec, idp_blk_kick, idp_int, idp_pass_def, idp_sack; by 38: idp_tkl_loss, idp_tkl_ast; 34 idp_tkl_solo; 27 idp_qb_hit; 15 idp_tkl; 13 idp_int_ret_yd; 12 idp_fum_ret_yd; 10 idp_pass_def_3p; 9 idp_sack_yd; 16 bonus_sack_2p; 15 bonus_tkl_10p.
- `league_matchups.player_points` on SETTLED weeks carries real defender points: DL 5,365 player-weeks at 7.0 avg, LB 5,209 at 8.9, DB 4,182 at 7.2, across 25 to 26 leagues. Unsettled weeks hold zeros (105k rows), so every check filters `is_final`.
- 2026 IDP leagues today: 25 report Power Pulse and Positional WAR "ok", 5 null, 1 WAR "skipped". None errors: the models run without defenders.

### 4.4 Projections
- `player_weekly_projections` holds ZERO defender rows (any source). `PROJECTION_POSITIONS` (`lib/sleeper.ts:818`, six values, not exported) drives both the weekly fetch (854) and the season/market fetch (825).
- Live 2026 week 3 IDP response: 4,358 rows, company rotowire, 772 with `idp_*` stats (all with `game_id`), 521 with a game and no stats, 3,065 with neither. Keys on projected rows: idp_tkl, idp_tkl_ast, idp_tkl_solo (772 each), idp_tkl_loss 621, idp_pass_def 496, idp_qb_hit 395, idp_sack 395, idp_sack_yd 386, idp_ff 244, idp_int 232, idp_fum_rec 174, idp_int_ret_yd 170, idp_safe 8, idp_blk_kick 1, plus team keys def_pr_yd 179, def_pr_td 47, pass_int_td 38, def_fum_td 10 (dropped per R-8b), and pts_ppr/half/std on 572 (offensive-only, meaningless). `player.position` is a sub-position (CB 771, DE 542, DT 526, NT 47, ILB 64, OLB 123, SS 70, FS 60, S 23); `player.fantasy_positions` is the fantasy label (DL/LB 199, DB/LB 43, DB/WR 1, plus OL/LS/LEO/OT oddities to filter). 2022 week 8: 528 projected; 2020 week 8: same shape.

### 4.5 What a defender sees today
- Profile (`/players/myles-garrett-3973`, indexable): game log "Rush Yd, Rec, Rec Yd, Snap%, PPR" of zeros; "Last 3 finishes (PPR)"; market panel "check back"; depth row from the offensive ladder; the "next season schedule not published" helper (fires for any player with no projection rows, `components/player-profile/overview-game-log.tsx:113-115`).
- Search: excluded twice (`lib/player-search.ts:186` default from `lib/ranking-boards.ts:22`, ranked gate 216-217). Not in the sitemap; linked from 231 `article_players` rows and 355 `relay_players` rows (growing).
- Finishes table: DB 10,305, DL 9,990, LB 5,814, OL 8,544, DE 6 rows ranked on PPR.
- Trade surfaces: priced at 0 with a verdict (`lib/trade-analyzer.ts:294-296`, `lib/signal-check/value-engine.ts:119-131`, pipeline never gates on `noValue`), red "(no value)" in three components, "0" on the OG trade card (`route.tsx:295-297`), plain asset on the calculator share page, `n/a` in OTC trade history. Would You Rather pool: 3 active trades contain a defender.
- League Pulse: "Unknown player" (`lib/power-pulse/load.ts:353, 438-439` drop DL/LB/DB; `lib/league-schedule/matchup.ts:228-252`; `lib/league-lineups/build.ts:196-219`), cut list offers "Unknown player" first (`advice.ts:155 perWeek ?? -1`, no null guard), ledger "Player 12345" (`moves.ts:173-175`), form ratio numerator includes IDP and denominator does not (`engine.ts:501-507` against 427/259), FAAB bids pooled into "any" (`priors-build.ts:126-130, 189`).

### 4.6 Live checks to re-run at the start of the build (record in progress.md)
```sql
-- IDP leagues, slot tokens, tackle stacking
select count(*) filter (where roster_positions ?| array['DL','LB','DB','IDP_FLEX']) as idp_leagues, count(*) as all_leagues from leagues;
select tok, count(*) from leagues, jsonb_array_elements_text(roster_positions) tok where roster_positions ?| array['DL','LB','DB','IDP_FLEX'] and tok in ('DL','LB','DB','IDP_FLEX','DE','DT','CB','S','DP') group by 1;
-- defender stat coverage by season (join on players.position)
select ps.season, count(*) filter (where ps.metadata->'stats' ? 'def_snp') as with_snaps, count(*) as rows from player_stats ps join players p on p.id = ps.player_id where ps.season_type = 'regular' and p.position in ('DL','LB','DB') group by 1 order by 1;
-- settled IDP points in matchups
select p.position, count(*), round(avg((kv.value)::numeric),2) from league_matchups lm cross join lateral jsonb_each_text(lm.player_points) kv join players p on p.external_ids->>'sleeper' = kv.key where lm.is_final and p.position in ('DL','LB','DB') group by 1;
-- defender projection rows (0 before IDP-120)
select pwp.source, count(*) from player_weekly_projections pwp join players p on p.id = pwp.player_id where p.position in ('DL','LB','DB') group by 1;
-- finishes rows for non-offense (0 after IDP-116)
select position, count(*) from player_positional_finishes where position not in ('QB','RB','WR','TE','K','DEF') group by 1;
-- Would You Rather pool trades holding a defender
select count(distinct t.id) from would_you_rather_trades t join league_transactions lt on lt.id = t.transaction_id cross join lateral jsonb_object_keys(coalesce(lt.adds,'{}'::jsonb)) pid join players p on p.external_ids->>'sleeper' = pid where t.status = 'active' and p.position in ('DL','LB','DB');
```
Plus `curl "https://api.sleeper.app/projections/nfl/2026/3?season_type=regular&position[]=LB&position[]=DL&position[]=DB"` returns rows whose `stats` carry `idp_tkl`.

---

## 5. Hazards (each has a task and a test)

- A. Projection sync clear-stale: one combined fetch (section 2 item 1). Test: one week synced yields both a WR and a DL row; `getSleeperWeeklyProjections` called once per week.
- B. Defender scored to a confident 0 under a league with no IDP keys (`lib/league-scoring.ts:207-208`). Test: null.
- C. Positional WAR cached universes drop IDP ids until `CACHE_SHAPE_VERSION` (`lib/positional-war/load.ts:174`, "v2") is bumped.
- D. Stale `stat_line`: IDP rows misclassified as unprojected lose their line (`lib/sync-weekly-projections.ts:331`).
- E. Series maps that spread `PULSE_POSITIONS` grow to nine silently (`chart-kit.tsx:339-345`, `components/league-war/overlay.ts:94`, `selection.ts:14`, `card.tsx:65-69`).
- F. `loadPlayers` drops defenders (`lib/power-pulse/load.ts:353, 438-439`) for nine consumers (league-power-pulse.ts:536, manager-ledger/load.ts:360, league-lineups/season-data.ts:222, league-lineups/data.ts:303 and 681, positional-war/upgrade.ts:279, trade-impact/load.ts:229, faab/league-faab.ts:386, breakdown/league-impact.ts:276, league-schedule/data.ts:459).
- G. Team-defense and ADP keys on a defender's projected line (R-8b).
- H. Accuracy rows graded on PPR for defenders the night projections land (section 2 item 6).
- I. Upsert chunk with a duplicate `player_id` fails (dedupe before upsert).
- J. Duplicate helpers drift: two `positionNoun` copies, two `POSITION_PLURAL` copies (`lib/start-sit/reasons.ts:57-64`, `app/tools/who-should-i-start/start-sit-card.tsx:112-119`), two `PLAYER_SELECT` copies (`lib/start-sit/load.ts:92-93`, `lib/beacon-breakdown.ts:137-138`), `computeAge` duplicated (`lib/beacon-breakdown.ts:141-152` against `lib/player-age.ts`). Each is folded into one copy in the task that touches it.

---

## 6. Phase 1: foundation, data and the fixes for what is broken today

Goal: every typed column, table, constant, colour, type and guard the later phases need; the data backfilled to 2020; nothing user-visible changes for offensive players; the live IDP-league bugs stop. Nothing in this phase depends on the switch.

Order matters: IDP-101 first (goldens), then constants, then migrations, then syncs, then the type widening (which the goldens protect), then the early fixes.

### 6.1 Goldens and constants

IDP-101 | Golden fixtures before any engine change | NEW lib/power-pulse/test-fixtures.ts, lib/power-pulse/golden/*.json, lib/positional-war/golden/*.json, lib/manager-ledger/golden/*.json, lib/league-lineups/golden/*.json, lib/league-schedule/golden/*.json, NEW *.golden.test.ts beside each engine
- Lift the complete `PowerPulseInput` builder from `lib/power-pulse/chopped.test.ts:35-154` (league, roster, players, projections, schedule, input; scoringSettings at :43) into `lib/power-pulse/test-fixtures.ts` (a non-test module imported only by tests). Add `idpLeague()`: roster positions `["QB","RB","WR","TE","DL","LB","DB","IDP_FLEX","BN"]`, scoring merged with the IDP123 map (D-1 values), one DL player with `eligible ["DL","LB"]`, one LB, two DB, IDP projection lines with `idp_*` keys.
- For each pure engine (`computePowerPulse` in lib/power-pulse/engine.ts, `computeCurves` in lib/positional-war/engine.ts, `computeLedger` in lib/manager-ledger/engine.ts, `buildLineup` in lib/league-lineups/build.ts, `buildMatchupView` in lib/league-schedule/matchup.ts) run the non-IDP fixture (the chopped one) and the IDP fixture, serialise with a stable key order (no Map values; check first), commit as JSON, and assert `toEqual` against the parsed golden with version fields stripped.
- Test: the five golden tests pass on the untouched code. Done when: they pass and `progress.md` records the git hash they were captured at.

IDP-102 | Position constants and the one noun helper | lib/site.ts, lib/beam/answers/templates.ts:117-134, lib/beam/interpret/index.ts:885-902, lib/start-sit/reasons.ts:57-64, app/tools/who-should-i-start/start-sit-card.tsx:112-119, components/league-war/summary.ts:27-34, war-rail-summary.tsx:70-77, upgrade-panel.tsx:31-38, app/api/og/war/[league_id]/card.tsx:98-105, components/power-pulse/projected-champion.tsx:67-71, lib/league-schedule/slots.ts (noun readers), lib/site.test.ts (new or extended)
- In `lib/site.ts` after `POSITIONS` (531-532): `export const OFFENSE_POSITIONS = POSITIONS;` `export const IDP_POSITIONS = ["DL","LB","DB"] as const;` `export function isDefender(position: string | null | undefined): boolean`; `export function positionNoun(position, form: "singular" | "plural")` returning quarterback(s), running back(s), wide receiver(s), tight end(s), kicker(s), team defense(s), defensive lineman/linemen, linebacker(s), defensive back(s), and the raw code for anything else.
- Replace every listed noun map with a call to `positionNoun` (delete the BEAM copy in interpret/index.ts and import templates.ts's, which itself delegates). Keep the exports the callers use.
- Test: `positionNoun("LB","plural")` is "linebackers"; `isDefender("DB")` true, `isDefender("DEF")` false; a grep test in lib/site.test.ts asserts no other file under lib/, components/, app/ defines a Record whose keys are exactly QB/RB/WR/TE(/K/DEF) mapping to English nouns (allow-list the colour and order maps by path). Done when: typecheck green, goldens green.

IDP-103 | Colour tokens for DL, LB, DB and every accent map | tailwind.config.ts:86-93, components/player-profile/player-hero.tsx:28-37, components/player-profile/positional-finishes.tsx:10-17, components/player-profile/role-badge.tsx (unchanged), app/api/og/player/[slug]/route.tsx:21-28, app/api/og/start-sit/route.tsx:48-55, app/api/og/team/[league_id]/[roster_id]/route.tsx:33-38, app/api/og/faab/route.tsx:31-38, app/api/og/matchup/[league_id]/[week]/[roster_id]/share/route.tsx:72-82, lib/on-the-clock/position-colors.ts:20-63, components/league-activity/activity-visuals.ts:125-138, components/waiver-wire/player-card.tsx:49-83, board-rail.tsx:30-46, top-pickup.tsx:43, components/manager-pulse/drafting-section.tsx:36-43, components/chart-kit.tsx:295-308 and 353 (markerPath), components/chart-kit.test.ts, NEW lib/on-the-clock/position-colors.test.ts
- Add `position.dl`, `position.lb`, `position.db` tokens (distinct hues from the six, AA on both surfaces; pick from the brand family, not grey). Add the three to every map above; give K and DEF their site hues in the player OG accent (21-28) and add a fallback in the team and FAAB OG maps (they index with no fallback today). Add three `POSITION_SERIES` entries with distinct colour, dash and marker (add three marker shapes at 353). Replace the matchup share card's single IDP grey with the LB token for the IDP group (one group, one colour, until the group is split).
- Test: `chart-kit.test.ts` loops the nine and passes distinct colour/dash/marker; ADD a contrast assertion (relative luminance against `#0F0F1A` and against the light surface, at least 3:1 for series lines) for all nine; `position-colors.test.ts` maps DL/LB/DB to classes and never returns the grey fallback for them. Done when: typecheck, goldens, chart tests green.

### 6.2 Migrations (all of phase 1's schema in one block, each its own migration file and task)

IDP-104 | Migration: typed IDP columns on player_stats | supabase/migrations/0296_player_stats_idp_columns.sql, lib/database.types.ts
- Nullable numeric columns: `def_snp`, `tm_def_snp`, `def_snap_pct`, `idp_tkl`, `idp_tkl_solo`, `idp_tkl_ast`, `idp_tkl_loss`, `idp_sack`, `idp_sack_yd`, `idp_qb_hit`, `idp_int`, `idp_int_ret_yd`, `idp_pass_def`, `idp_pass_def_3p`, `idp_ff`, `idp_fum_rec`, `idp_fum_ret_yd`, `idp_def_td`, `idp_safe`, `idp_blk_kick`, `bonus_tkl_10p`, `bonus_sack_2p`. Partial index `(season, week) where def_snp is not null`. Header comment: access matrix unchanged (existing `player_stats` policies apply). Regenerate types. Done when: types show the columns and `npm run typecheck` is green.

IDP-105 | Migration: players.eligible_positions | 0297_players_eligible_positions.sql, lib/database.types.ts
- `alter table players add column eligible_positions text[] not null default '{}'`; one backfill UPDATE from `metadata->'sleeper'->'fantasy_positions'` upper-cased, filtered to the nine PulsePosition values, falling back to `array[position]` when empty. Index not needed. Done when: `select count(*) from players where cardinality(eligible_positions) > 1` is about 260 and every defender has at least one.

IDP-106 | Migration: finishes offense-only rebuild plus idp123 finishes | 0298_positional_finishes_idp.sql
- Extend the CHECK at 0142:24 to include `'idp123'`. Replace `rebuild_positional_finishes` (body from 0171:86-142): restrict the PPR ranking where clause (124-125) to `('QB','RB','WR','TE','K','DEF')`; add a second insert for `('DL','LB','DB')` with scoring `'idp123'` and points as the IDP123 weighted sum over the IDP-104 columns (solo 2, ast 1, tkl_loss 2, sack 6, qb_hit 1, pass_def 3, ff 3, fum_rec 3, safe 3, blk_kick 3, int 6, def_td 6). Restrict `get_player_positional_finishes` (0124:20) the same way. Delete existing rows for positions outside the six under the PPR keys. Done when: section 4.6 finishes check returns only DL/LB/DB rows under idp123 and Roquan Smith's 2025 idp123 total matches the D-1 arithmetic on his typed columns (after IDP-112).

IDP-107 | Migration: player_idp_seasons | 0299_player_idp_seasons.sql, lib/database.types.ts
- Columns: `player_id uuid references players`, `season int`, `season_type text check in (regular, post, pre)`, `position text check in (DL, LB, DB)`, `eligible_positions text[]`, `games int`, `games_20_snaps int`, `avg_def_snap_pct numeric`, one total per IDP-104 stat column (same names), `computed_at timestamptz default now()`, PK (player_id, season, season_type). No points column, no metadata (derived table). RLS: `player_idp_seasons_select_public` (anon and authenticated SELECT), `player_idp_seasons_service_role_all`. Verify with `pg_policies`, an anon SELECT and a refused anon INSERT. Done when: the six-step RLS sequence from CLAUDE.md is recorded in progress.md.

IDP-108 | Migration: CHECK widenings | 0300_idp_check_widenings.sql
- `nfl_defense_vs_position`: position CHECK (0163:35) gains DL, LB, DB; scoring CHECK (0163:36) gains `'idp123'`. `player_projection_accuracy` scoring CHECK (0164:44) gains `'idp123'`. `league_positional_war_cache` position CHECK (0211:42) and `positional_war_curves` (0214:36) gain DL, LB, DB. `faab_market_priors` position CHECK (0289:30) gains DL, LB, DB (keeps 'any'). Do NOT touch 0056:32 or 0054:17. Done when: each constraint's definition is read back from `pg_constraint` and pasted into progress.md.

### 6.3 Stats and players sync

IDP-109 | Map IDP keys in the stats mapper | lib/sleeper-stats-map.ts (after 56, and 95-99), NEW lib/sleeper-stats-map.test.ts
- Add `NULLABLE_IDP_COLUMNS` with the IDP-104 names mapped through `num()` (absent means null, never 0, the same rule as 16-21). Derive `def_snap_pct = def_snp / tm_def_snp` beside `snap_pct` with the zero-denominator guard. Neither sync file changes (both spread `...mapped`: `lib/sync-sleeper-stats.ts:166`, `scripts/backfill-sleeper-stats.ts:139`).
- Test: a defender payload maps every key and leaves `rec`, `rush_att`, `pts_ppr` at their offensive values; an offensive payload leaves every `idp_*` null; a payload without `tm_def_snp` gives `def_snap_pct` null.

IDP-110 | Backfill typed IDP columns from stored metadata, then close the gap | NEW scripts/backfill-idp-stat-columns.ts, package.json (`backfill:idp-columns`), progress.md
- Page `player_stats` by season with `range()` (1000-row cap rule), map `metadata.stats` through `mapStatPayloadToRow`, update ONLY the IDP-104 columns. Zero Sleeper calls. Idempotent. Pure helpers exported and tested; `main()` guarded by the `isRunDirectly` pattern (`scripts/measure-manager-pulse.ts:985-997`).
- Then: `npm run sync:players`, then `npm run backfill:sleeper-stats -- --season N` for 2020 to 2025 (defenders an old allow-list dropped), then re-run the column backfill. Record per-season defender row counts before and after.
- Verify: typed-column totals equal `metadata.stats` totals per key and position group for 2025, to the unit (one SQL, pasted).

IDP-111 | Fill eligible_positions in the players sync | lib/sync-sleeper-players.ts:205-221 (StagedRow), 361-376 (fill), 465-481 (write), lib/sync-sleeper-players.test.ts
- Fill from `player.fantasy_positions` upper-cased, filtered to the nine, default `[position]`. Test: `["DL","LB"]` gives primary DL and eligible both; `["LB","LS"]` gives eligible `["LB"]`; absent gives `[position]`; primary rule unchanged (existing case at :85 stays).

IDP-112 | The IDP stat-line module and scoring presets | NEW lib/idp/stat-line.ts, lib/idp/scoring-presets.ts, lib/idp/stat-line.test.ts
- `normalizeProjectedIdpLine(stats)`: keep `idp_*` keys only; derive `idp_tkl` when absent. `normalizeActualIdpLine(stats)`: drop `pos_rank_*`, `pts_*`, `adp_*` and `gp/gs/gms_active` keys; keep the rest. `IDP_PRESETS`: idp123 (D-1), big3, fantasypros, espn as full scoring maps carrying ONLY `idp_*` keys plus `bonus_tkl_10p 0`, `bonus_sack_2p 0`. `scoreIdpLine(line, preset)`: dot product.
- Test: Roquan Smith's stored 15-tackle line scores 40 under idp123 (read the real row into the fixture); a projected line with `def_pr_yd` loses it; a line with solo 5 and ast 3 and no tkl derives 8; presets have no offensive key.

IDP-113 | Scoring core: usable IDP maps and hazard B | lib/league-scoring.ts:85-90 (isUsableScoring), 113, 117-123, 201-227 (scoreWithFallback), lib/league-scoring.test.ts, lib/league-activity/labels.ts:219-230
- `isUsableScoring` returns true when the map has at least one nonzero `idp_*` key even without offensive keys. `scoreWithFallback(...)`: if `isDefender(position)` and the league map has no nonzero `idp_*` key, return `{ points: null, usedLeagueScoring: false }` BEFORE the dot product; a defender never falls through to the stored `pts_*` columns. Add labels for idp_qb_hit, idp_sack_yd, idp_int_ret_yd, idp_fum_ret_yd, idp_pass_def_3p, bonus_tkl_10p, bonus_sack_2p.
- Test: the existing :69-74 case stays; a bare IDP123 map is usable; a DL under an offense-only league scores null; a DL under IDP123 scores the D-1 arithmetic; a league scoring plain Tackle projects solo plus assisted through the normaliser.

### 6.4 Projections, accuracy, splits, curves

IDP-114 | IDP projections in the one weekly fetch (hazards A, D, G, I) | lib/sleeper.ts:818, 853-856, lib/sync-weekly-projections.ts:85-91, 129-136, 265, 282-336, lib/sync-weekly-projections.test.ts, lib/sleeper-fetch.test.ts
- `export const IDP_PROJECTION_POSITIONS = ["DL","LB","DB"] as const;` the weekly loop at 854 iterates `[...PROJECTION_POSITIONS, ...IDP_PROJECTION_POSITIONS]`; line 825 (season/market) is untouched. Before building rows: drop any row with no `game_id` and no `idp_*` key (R-26); dedupe by `player_id`, merging `stats` when a player appears twice (the DB/WR player). `hasPublishedPoints` also returns true for any finite `idp_*` key. `stat_line` for a defender is `normalizeProjectedIdpLine(stats)` (IDP-112); `projected_pts_*` stay null for a defender (312-318 already read absent keys as null).
- Test: the weekly URL contains `position[]=DL`, `LB`, `DB` and the season URL does not; an IDP row with `idp_tkl_solo` and a game is `projected`; one with a game and no stats is `out`; one with neither is dropped; a mocked-client sweep of one week records ONE Sleeper call and an upsert set holding both a WR and a DL row, and no chunk contains a duplicate `player_id`.

IDP-115 | IDP accuracy under idp123 (hazard H, ships with IDP-114) | lib/calculate-projection-accuracy.ts:86-87, 353-377, 473-538, 588-649, 651-705, 707-711, 727-763, 765-797, 799-817, lib/calculate-projection-accuracy.test.ts, lib/projection-scoreboard.ts:116-120, 379-386, app/admin/projections/page.tsx, lib/projections/source-guard.test.ts, raw-column-guard.test.ts
- `ScoringBase` union gains `"idp123"`. Export `scoringKeysFor(position)` returning `["idp123"]` for DL/LB/DB and the three bases otherwise; the per-player loop uses it. Defender projections are read in a second query that inner-joins `players.position in (DL,LB,DB)` and selects `stat_line`; scored with `scoreIdpLine(normalizeProjectedIdpLine(line), IDP_PRESETS.idp123)`. Defender actuals are read from the IDP-104 typed columns (not metadata) and scored with the same preset. `toInsert` writes scoring `idp123`. `summarizeSource` reports defenders under idp123 or skips them, stated in its comment. The scoreboard picks the key per position; the admin projections page shows a fourth basis or excludes defenders, labelled.
- Test: `scoringKeysFor`; Roquan 40; the two guard tests stay green (add no allow-list entry; if one is needed the design is wrong).

IDP-116 | Backfill IDP projections 2020 to 2025 | scripts/backfill-weekly-projections.ts:69-79 (clearStale false path), package.json, progress.md
- Run per season, IDP positions only if the script takes a position list, else all positions (idempotent on the unique key), paced by `lib/sleeper-budget.ts`. Record rows per season. Then run `npm run calculate:projection-accuracy` (or the stats cron path) and record the first idp123 beat rates per position.
- Verify: `lib/projections/source.ts` count parity (154-189) still holds after `npm run build:beacon-projections` mirrors the IDP rows (D-3; engine.ts:270-287 notProjectable path needs no change; add an engine test that a DL row mirrors with its line intact and null points).

IDP-117 | player_idp_seasons build script and nightly registration | NEW lib/idp/seasons.ts, lib/idp/seasons.test.ts, scripts/calculate-idp-seasons.ts, package.json (`calculate:idp-seasons`, and `sync:stats:full` at :67 gains it), app/api/cron/sync-sleeper-stats/route.ts (derived tuple array, about 72-80), lib/cron-runs.ts:552-577 (summarizeCronResult key), lib/data-freshness.ts:100-150 (FRESHNESS_SPECS entry: table player_idp_seasons, column computed_at, months [1,2,8,9,10,11,12], kickoffGated true), lib/derived-tables-scheduled.test.ts
- Pure aggregation from the IDP-104 columns per (player, season, season_type), position from `players.position`, eligibility from `players.eligible_positions`. `--all` for 2020 to 2025 once; the current season chained as the fourth derived step of the stats cron. Test: aggregation on three fixture rows; the derived-tables guard sees the new module imported by the cron route.

IDP-118 | IDP opponent splits | lib/calculate-defense-splits.ts:90, 93, 100-107, 222, 251-255, 274, NEW lib/calculate-defense-splits.test.ts (pure parts), lib/power-pulse/load.ts:701+ (loadDefenseSplits, second read under idp123 merged by key)
- POSITIONS gains DL, LB, DB; STARTABLE_PER_TEAM DL 4, LB 3, DB 4; SCORING_BASES gains idp123; `pointsFor` computes idp123 from the typed columns for a defender row, null for cross cases. The bucket key already uses `row.opponent` (279), which for a defender is the offense faced; `project.ts:74` resolves `${opp}|${season}|LB` unchanged. Callers that pass one scoring key (`lib/league-schedule/data.ts:464`, `lib/league-lineups/data.ts:680`, and every `loadAccuracy` caller) get the merge in phase 3 (IDP-303); here the loaders accept an array of keys and merge. Test: `pointsFor` cross cases null; a DL row lands in the bucket keyed by his opponent.

IDP-119 | IDP variance curves, defaults, zod | lib/power-pulse/variance-curve.ts:6 (ScoringBase), 89, 96-102 (pattern), 120-208, lib/power-pulse/default-settings.ts:133, 141, 321, 465-500, lib/power-pulse/validate.ts:18-34, 183, app/admin/power-pulse/power-pulse-settings-manager.tsx:462, 564, 592, lib/power-pulse/variance-curve.test.ts, variance.test.ts, validate.test.ts, app/admin/manager-pulse/settings-coverage.test.ts pattern
- Measure DL, LB, DB coefficient-of-variation anchors under idp123 from `player_stats` 2020 to 2025 with the existing `npm run measure:variance` approach; add `DL_CURVE`, `LB_CURVE`, `DB_CURVE` shared across bases; `defaultCv` and `positionReliability` (0) entries; zod objects gain the three keys; the admin form's three lists gain them (the calibration-slope list at 564 gains them with a note that IDP slopes start at 1.0). Model version stays `pp-8` here (bumped at switch-on, IDP-410). Test: curves exist for all nine under every base including idp123; a settings document with DL/LB/DB keys round-trips through validate.

### 6.5 Type widening (the compiler pass), pinned to OFFENSE_POSITIONS where six must stay

IDP-120 | Widen PulsePosition and pin every six-position site | lib/power-pulse/types.ts:11, 13 (and slotEligibility per R-25: add `IDP_SLOT_ELIGIBILITY` and `slotEligibility(idpEnabled)`; `PULSE_SLOT_ELIGIBILITY` unchanged), lib/projections/read.ts:73-78, lib/power-pulse/load.ts:353, 439 (pin to OFFENSE_POSITIONS for now, with a comment naming IDP-301), lib/positional-war/load.ts:458 (pin), components/chart-kit.tsx:339-345 (PLAYER_SERIES spreads OFFENSE_POSITIONS), components/league-war/overlay.ts:94, selection.ts:14 (pin), app/api/og/war/[league_id]/card.tsx:65-69 (pin, R-10), lib/positional-war/chart-geometry.ts:103 (unchanged), lib/manager-ledger/types.ts:57 (alias of PulsePosition), lib/start-sit/reasons.ts and toughest-calls.ts (compiler-listed), lib/trade-finder/types.ts:173-193, 196-219, lib/trade-finder/explain.ts:613, lib/on-the-clock/* Records (recommend.ts:185, 320, 332, 434, 494, 591; draft-pulse.ts:91, 181, 284, 360, 406; rosters.ts:31, 82-83; draft-alerts.ts:39, 48), lib/projections/engine.ts:100, lib/projections/default-settings.ts:205, lib/faab/default-settings.ts:210, lib/on-the-clock/default-settings.ts:94, and every other file `tsc` lists
- Rule for each compiler-listed site: if the surface must stay six (draft, value, rankings, Beacon values), change its key type to `OffensePosition` (= typeof OFFENSE_POSITIONS[number]) rather than adding fake IDP entries; if it is a League Pulse or display map, add the three entries. Record the decision per file in progress.md as sub-tasks.
- Test: `npm run typecheck` green; all goldens green (the pins guarantee identical output); `components/league-war/overlay.test.ts:104-119`, `lib/positional-war/load.test.ts:715-739`, `lib/power-pulse/lineup.test.ts:30-32`, `lib/league-lineups/simulate.test.ts:80-83` stay green unchanged because the OFF map is unchanged; `lib/positional-war/replacement.test.ts:624-643` gains the IDP case against `slotEligibility(true)`.

IDP-121 | Guard test: no defender module reads stored points columns | NEW lib/idp/points-guard.test.ts
- Copy `lib/projections/raw-column-guard.test.ts` (walk, allow-list, three standing tests, "guard itself works"). Columns: `pts_ppr`, `pts_half_ppr`, `pts_std`, `pts_idp`. Roots: `lib/idp/`, files under `lib/player-profile/` whose basename starts with `defender`, files under `lib/guides/` whose basename starts with `idp-`. Assert the scanned list is non-empty (vacuity check as in `lib/derived-tables-scheduled.test.ts:67-71`). The rule is textual: no such module names those columns at all.

### 6.6 Early fixes for what is broken today (each independent, each shippable alone)

IDP-122 | Name IDP players in League Pulse loaders (names only, no projections) | lib/power-pulse/load.ts:135, 353, 363-364, 438-439, lib/power-pulse/load.test.ts
- `loadPlayers` gains an option `positions: readonly string[]` defaulting to OFFENSE_POSITIONS; the nine consumers in hazard F pass `[...OFFENSE_POSITIONS, ...IDP_POSITIONS]` ONLY for the players map used to NAME players (schedules data.ts:459, lineups data.ts:303 and 681, ledger load.ts:360, season-data.ts:222), and keep the default everywhere a candidate list is built. Select `eligible_positions`. First confirm on a live IDP league (progress.md records the league id and the "Unknown player" row before the fix). Test: an LB row is kept with the wide list and dropped with the default.

IDP-123 | Cut list: never offer an unknown or unprojected player first | lib/league-lineups/advice.ts:127-157, lib/league-lineups/advice.test.ts
- Skip entries with `playerId` null; sort `perWeek` null LAST with the note "No projection"; the panel says why a player was not named. Test: a bench entry with null playerId is never offered.

IDP-124 | FAAB priors by IDP position | lib/faab/priors-build.ts:70, 126-130, 189, lib/faab/priors-build.test.ts:83, 162, progress.md (count of IDP winning bids pooled into "any" before the fix, described query in section 2 of the audit)
- POSITIONS gains DL, LB, DB so an IDP auction emits its position cell as well as "any". Rebuild priors (`npm run build:faab-priors`). Test: an LB auction emits an LB cell.

IDP-125 | BEAM early gate | lib/beam/capabilities/player-stat-line.ts:104, 126, app/admin/beam/actions.ts:133-138, lib/beam/interpret/interpret.test.ts
- Before `statLineFor`, a defender gets a decline card "Defensive stat lines arrive with IDP support" and the note at 126 says "IDP123 scoring" for a defender. The alias editor refuses a defender slug (select `position` at :136). Test: a defender alias yields the decline card.

IDP-126 | OG trade card and every "(no value)" rendering | app/api/og/trade/[transaction_id]/route.tsx:295-297, components/signal-check-trade-card.tsx:287-291, app/tools/trade-calculator/trade-result.tsx:144-147, app/games/would-you-rather/verdict-panel.tsx:146-150, app/tools/on-the-clock/trade-history.tsx:328
- Print "No market value" in words (text-ink-subtle, sr text identical) wherever a `noValue` asset renders; never "0", never red, never "n/a". The partial-grade label itself comes in IDP-207. Test: `renderToStaticMarkup` of the trade card with a noValue asset contains "No market value" and not "(no value)".

IDP-127 | Breakdown and picker refuse defenders (R-23) | app/tools/who-should-i-start/page.tsx:170-194, 342-343, lib/beacon-breakdown.ts:341-508 (loadBreakdownCore gains `refusedSlugs`), app/api/og/breakdown/[a]/[b]/route.tsx:113-118, lib/breakdown/league-impact.ts:430 (cast becomes a guard), lib/start-sit/load.test.ts, breakdown tests
- Fold the duplicate `PLAYER_SELECT` and `computeAge` (hazard J) while here. Test: a DB slug lands in refusedSlugs; the breakdown OG returns the not-found image with "Defensive players are not compared here".

IDP-128 | Game log helper copy | components/player-profile/overview-game-log.tsx:113-115
- When `projections.season` is null during a live season, say "No upcoming games are projected for this player" instead of claiming next season's schedule is unpublished. Test: render helper with a null season during week 3 contains no "schedule has not been published".

IDP-129 | League Relay waiver jab | lib/league-relay/waiver-writeup.ts:205-208, lib/league-relay/waiver-writeup.test.ts
- A missing projection is never a judgement: for a defender say "plays a position no value source prices"; for anyone else say "has no projection this week". Test: neither text contains "itself a review".

IDP-130 | Would You Rather pool refuses unpriced trades and retires the three | lib/would-you-rather/pool.ts:303-338, NEW lib/would-you-rather/pool.test.ts, one-time script or SQL recorded in progress.md
- After grading, return [] when `result.view.hasMissingValues` (and the IDP-207 `partial` flag once it exists). Retire active rows holding a defender (status retired, votes kept). Test: a graded result with hasMissingValues is not inserted.

IDP-131 | Draft snapshot value verdict only with a value | lib/on-the-clock/draft-snapshot.ts:402-403, lib/on-the-clock/draft-pulse.ts:252-255, its tests
- `value_verdict` is written only when `beacon_value` is non-null; otherwise `adp_only: true` and the UI says "market only". Draft Pulse splits `unprojected` into `unprojectedIdp` and `unprojectedOther`. Test: a pick with null beacon_value has no verdict.

IDP-132 | Phase 1 verification and reviews
- Section 4.6 re-run; Part A checks: typed totals equal metadata totals (2025, per key, to the unit); `player_idp_seasons` idp123 totals within 0.1% of Sleeper's 2025 `pts_idp` per position group; row counts before and after the gap close; one-week projection sweep holds both sets; RLS verified; `npm run typecheck`, `npm test`, `npm run build` green; goldens green. Then the three review sub-agents, then STOP for owner review.

---

## 7. Phase 2: defenders across the whole site, and the guide

Goal: every surface a defender can already reach today is honest and premium; the guide publishes; SEO improves. No League Pulse model changes (those are phase 3). Prerequisite: phase 1 complete.

### 7.1 Search and constants in the search path

IDP-201 | Search pool option and the relevance gate | lib/player-search.ts:110, 184-186, 216-217, lib/player-search.test.ts:33-92 (table switch for player_idp_seasons), :107, app/api/search/route.ts:89-94, app/api/players/search/route.ts:14-16, 34-39, 53, 64-68, components/site-search.tsx:524-569, lib/site.ts:133 (SEARCHABLE_TOOLS entry for the guide with keywords idp, linebacker, defensive player)
- `pool?: "ranked" | "ranked+idp"` default "ranked". `idpRelevantPlayerIdSet` memoised like `rankedPlayerIdSet`, from `player_idp_seasons` (current or previous season, games_20_snaps >= 1) union players with a team and non-null `metadata.sleeper.depth_chart_order`. Header palette opts in. Verify which route the Free Agent Finder calls (the players/search route serves My Rankings and is auth-gated); add a `pool` query param there defaulting to ranked, validated against the union only when ranked+idp. Result row shows `positionNoun` and the R-22 chip; no value.
- Test: ranked+idp admits a DL in the set; default filters him out; the four stay-out routes (breakdown 56, signal-scout 97, signal-check 148, WSIS page 196) each have a test asserting the default pool.

### 7.2 The defender profile

IDP-202 | Defender loader and team slate | NEW lib/player-profile/defender.ts, lib/player-profile/defender.test.ts, lib/player-profile-cache.ts (versioned key `["player-defender-profile", playerId, "v1"]`, tags playerStats and playerProjections), lib/season-schedule.ts (team slate helper from teammates' projection rows, since `nfl_game_odds` covers only priced weeks)
- Reads the IDP-104 columns weekly and by season, `player_idp_seasons`, idp123 finishes, IDP projection rows (`stat_line`, availability, opponent) for the resolved source, idp123 accuracy, and the schedule. Returns stat lines, never points: points are computed in the browser per preset. Reader leagues (R-16) are read outside the cache through `lib/sleeper-handle/resolve.ts loadSavedSleeperHandle` plus the reader's synced IDP leagues' `scoring_settings`.

IDP-203 | Defender profile page branch and metadata | app/players/[slug]/page.tsx:57-60, 114, 118, 176, 203, 244-245, 284-294, NEW app/players/[slug]/profile-branch.test.ts
- `const defender = isDefender(player.position)` computed once after 176. Title "{Name} IDP Stats, Snap Share and News | FF Beacon"; description names tackles, sacks and snap share; TAB_METADATA defender variants; JSON-LD jobTitle uses positionNoun; breadcrumb item 2 is "Players" with no item URL (not /rankings, and /players is not a route); FantasyCalc banner wrapped in `!defender`; `robots: { index: false, follow: true }` when the R-15 gate fails. Pass `variant="defender"` to hero, overview and stats tabs.
- Test: source assertion in the og/faab route.test.ts style: `isDefender(` occurs once in page.tsx and `variant="defender"` only inside that branch.

IDP-204 | Defender hero, summary, depth chart, market card | components/player-profile/player-hero.tsx:65-69, 139-144, lib/player-profile/summary.ts:54-56 (defender template), lib/player-profile.ts:815-825 (depthRoleLabel: defender branch reading `depth_chart_position`, labels like "Inside linebacker, left", two order-1 starters at different sub-positions both "Starter"), components/player-profile/depth-chart-card.tsx:31, overview-sidebar.tsx:64-83 (fixed explanation card, no chart, no "check back"), player-bio-overview.tsx:90
- Test: summary reads "finished LB1, LB5 and LB9 in Sleeper default IDP scoring" with "linebacker" in the sr text; the market card contains "No market value"; a LILB with order 1 is "Starter".

IDP-205 | Scoring selector (R-16) | NEW components/player-profile/defender-scoring.tsx (client), test via renderToStaticMarkup of the initial state
- Native radio fieldset in the glossary ScoringSwitcher pattern (`app/guides/fantasy-football-terms/glossary-classroom.tsx:164-290`): presets then "Score as: {league name}" for each reader league. Changing it re-scores every figure from the stat lines and announces the new season total in one polite live region. Persists per viewer in localStorage inside try/catch; renders correctly without it.

IDP-206 | Defender game log, career table, finishes, this-week projection | components/player-profile/stats-tab.tsx:112, 242, 261-330, stat-shaping.tsx:11-25, 127-140, 454, game-log-table.tsx:189, 295-304, positional-finishes.tsx, weekly-projections.tsx, projection-outlook.tsx, lib/player-profile/game-log.ts (defender row builder)
- Columns: Opp, Snap%, Tkl (solo plus ast in the accessible name), TFL, Sack, QB hit, PD, INT, FF, FR, TD, Pts (selected scoring), Proj, +/-. Byes and pending weeks from the team slate (IDP-202). Career: same per season plus games, games at 20+ snaps, avg snap share, points per game. Finishes: idp123 with the scoring named. This week: the IDP projection line, projected points under the selected scoring, the idp123 beat rate, hidden with a sentence when Sleeper has not projected him. Mobile: the existing two-line row pattern, no column dropped.
- Test: the defender stat columns contain no rec/rush key; an offensive player's `statColumns("WR")` output is unchanged (golden markup of `StatsTab` pieces captured before this task, per the test audit's renderToStaticMarkup pattern).

IDP-207 | Partial-grade trade valuation everywhere (R-19) | lib/trade-analyzer.ts:102-122, 294-296, 446-463, lib/signal-check/pipeline.ts:101-148, verdict.ts (no-verdict variant), builder-view.ts:90-119, freeze.ts:61-101 (carry noValue, partial, unpricedCount into the public payload), explanation.ts:102-105, confidence.ts:59 (keep), app/tools/trade-calculator/v/[shareId]/page.tsx:161-185, app/api/og/signal-check/[shareId]/route.tsx, app/tools/trade-calculator/import-actions.ts:526-547 (notice when a matched player is a defender), components/transaction-row.tsx:218-221, 297-306, 383-391, lib/league-relay/trade-writeup.ts (after 537: partial line; no verdict when a side is all unpriced), lib/manager-pulse/load.ts:1401-1406 (`hasUnpricedPlayer` routes to ungraded), lib/on-the-clock/trade-history.ts:236-253, tests: lib/signal-check/pipeline.test.ts, lib/trade-analyzer-startup.test.ts, lib/manager-pulse/trading.test.ts:182, lib/league-relay trade-writeup test (new)
- Distinguish unresolved (`playerId` null) from unpriced. Test: a side of only a noValue player yields no verdict, `partial` true, `unpricedCount` 1; the frozen public payload carries `partial`; a defenders-only trade lands in Manager Pulse "ungraded".

IDP-208 | Manager Pulse position figures | lib/manager-pulse/types.ts:154, 209, 263, 282, 481, drafting.ts:152, 159-160, trading.ts:207-210, 250-253, load.ts:1478, components/manager-pulse/affinity-section.tsx:132, 236, drafting-section.tsx:36-43, lib/manager-pulse/drafting.test.ts
- `ManagerPosition = TradePosition | "DL" | "LB" | "DB"` for the first-rounds shape and affinity; `TradePosition` stays for appetite and overpays with a sentence saying defenders are excluded from value figures. Test: an LB early pick appears in the shape under LB and shares still sum to 1.

IDP-209 | Teams tab and team page (R-27) | components/team-card.tsx:62-82, 148, 304-331, 831-845, lib/league-view-data.ts:57, 300, 311, lib/league-share-card.ts:19-24, app/api/og/team/[league_id]/[roster_id]/route.tsx, NEW components/team-card.test.tsx (renderToStaticMarkup)
- In a league whose `roster_positions` include an IDP token, add a Defense group listing DL, LB, DB by name with the chip and "No market value"; the value total's caption says "offensive players and picks". One-line note for kickers and team defenses. OG team card lists defenders by name without values only in IDP leagues. Test: an IDP roster renders the defender's name; a non-IDP roster's markup is unchanged (golden).

IDP-210 | League cards IDP tag (R-28) | app/tools/league-pulse/league-results.tsx, league-detail-sheet.tsx, lib/league-format-tags.ts:28-52 (already maps IDP_FLEX to "IDP"), NEW lib/league-format-tags.test.ts
- Derive `hasIdp` from the live `roster_positions`; render "IDP" beside the type bucket on every card (dashboard shares the component). Test: DL/LB/DB/IDP_FLEX tags emitted; a non-IDP league has no tag.

IDP-211 | Draft tools stay offense-only with honest defender picks (R-11) | lib/on-the-clock/board-loader.ts:325-326, draft-grade.ts:214-228, awards.ts:319-344, 686-688, player-brief.ts:92, pulse-service.ts:343, projection-board.ts:57, 202, 244-284, lib/draft-tracker/board.ts:234-235, lib/draft-value/build.ts:87-89, 586-587, tests: board-loader.test.ts, draft-pulse.test.ts, awards.test.ts, draft-grade-spread.test.ts, app/api/on-the-clock/draft/sync/route.test.ts
- Every IDP token and row is filtered explicitly with a test; the grade evidence says "graded on N of M picks; K defensive picks have no value"; the player brief refuses IDP positions with a sentence until IDP finishes are wired (then reads idp123); a defender pick syncs with `playerId` set. Query and record whether any DL/LB/DB rows exist in the rookie ADP table (R-11's "no IDP ADP we trust" was unmeasured).

IDP-212 | Signal favourites noun and chip | components/signal/signal-block.tsx:288-311, app/my-beacon/signal/favorites-editor.tsx:290-300, 385-396, app/my-beacon/signal/showcase/page.tsx:56-67, optional actions.ts:369-374 (restrict typeahead to the R-15 set), NEW components/signal/signal-block.test.tsx
- Accessible name "Name, linebacker, Dallas". Test: a favourite defender's aria-label contains "linebacker".

IDP-213 | Brief desk (R-21) | lib/brief-desk/datasets.ts:30, 227-268, 301-326, bundle.ts:372-382, 438-455, 509, lib/brief-desk/types.ts:48-54 (`coverage`), instructions-seed.ts:19 (and the DB copy via `scripts/gen-brief-desk-settings-sql.ts`; AI prompts must stay editable in admin, memory rule), components/brief-desk/blocks/box-score-lines.tsx:67, lib/brief-desk/datasets.test.ts, NEW bundle test
- Defender rows get IDP columns with idp123 points; `rank_at_position` for a defender ranks on idp123; value `coverage: "not_covered"`; seed instruction: "A value marked not_covered is written as 'no value source prices defensive players', never as 0"; the source note no longer claims a missing row means no stat. Test: a DL row has IDP columns and no rec_yd; rank is idp-based.

IDP-214 | BEAM full IDP support (R-20) | lib/beam/resolve/player.ts:40, lib/beam/stats/registry.ts:28-73, 83-84, 101+, 922-925, 941-949, 962-977, 985+, lib/beam/stats/query.ts:29-35 (STAT_SELECT gains the IDP-104 columns), lib/beam/interpret/lexicon.ts:183-209 (dl, defensive line, defensive lineman, lb, linebacker(s), db, defensive back(s), cornerback, corner, idp; leave "edge" and "safety" out), lib/beam/capabilities/player-weeks-projection.ts:316-340 (idp123 finishes for a defender), NEW migration 0301_beam_search_players_idp.sql (copy 0201:66-118 body, positions array gains DL, LB, DB, revoke/grant block kept), remove the IDP-125 gates, scripts/beam-smoke.ts:40-95, lib/beam/interpret/interpret.test.ts
- Registry ids: idp_tkl_solo, idp_tkl_ast, idp_tkl, idp_tkl_loss, idp_sack, idp_qb_hit, idp_pass_def, idp_int, idp_ff, idp_fum_rec, idp_def_td, def_snp, def_snap_pct, idp_points (idp123), each with positions DL/LB/DB; `statLineFor` DL/LB/DB branches; POSITION_SWAPS pass_int to idp_int and def_sack to idp_sack for defenders; "touchdowns" bare unit maps to idp_def_td. Value, rank and projection capabilities keep their clean "not-ranked" decline.
- Test: "how did garrett do in 2025" resolves to a clarify between Myles Garrett and Garrett Wilson, not a confident Wilson; `statLineFor("LB")` has no pass_/rush_/rec_ id; a value question on a defender returns "not-ranked"; a tackles question answers with "linebacker" in the sentence.

IDP-215 | Indexing and llms (R-17) | lib/sitemap/sections.ts:219-245 (idpPlayerSlugs sibling), 422-436, 493-500, lib/llms/llms-full-txt.ts:125-129, lib/llms/build.test.ts, NEW lib/sitemap/sections.test.ts, lib/indexnow.ts (one push of the new slugs after deploy)
- Test: a gated defender slug appears in players.xml; the llms profile paragraph describes both kinds without "trade value" for defenders.

IDP-216 | Rankings guide link and glossary rows (R-18) | app/rankings/** (one line), app/guides/fantasy-football-terms/glossary-figures.tsx:123-141 (DL, LB, DB, IDP flex rows), lib/guides/fantasy-football-terms.ts:210-217 (idp term link)

### 7.3 The guide (Part C)

IDP-217 | Guide data readers | NEW lib/guides/idp-seasons.ts, idp-stability.ts (year-over-year method fixed and tested: group by players.position, per-game rates, players with 8+ games both seasons), idp-leagues.ts (starter counts from our 40 leagues, the 15-of-40 stacking count), lib/guides/idp-scoring-presets.ts (re-exports lib/idp presets), tests for each, cached in the lib loader (guide pages are `force-dynamic`, figures read at request time, `formatEastern` for "Stats through week N")
IDP-218 | Guide figures | NEW app/guides/idp-fantasy-football/idp-figures.tsx (server SVG inside `ChartFigure` from components/chart-kit.tsx:51-70 with title, summary, tableLabel, table, aria-hidden SVG; pattern app/guides/chopped-league-strategy/chopped-figures.tsx:93+)
IDP-219 | Guide interactives | NEW idp-classroom.tsx (client, native radios and ranges in labelled fieldsets, one polite live region each, pattern chopped-classroom.tsx:196, 342, 456, 525): Stacking check, Scoring switcher (four presets plus Custom sliders, 2025 top 12 per position re-scored live), Replacement level, Chase or ignore quiz, In-season checklist
IDP-220 | Guide page | NEW app/guides/idp-fantasy-football/page.tsx (structure of chopped page.tsx: metadata 129-176, `force-dynamic`, TOC, LESSONS array with eyebrow "Lesson N of 10", GuideSectionHeader, FAQ, JSON-LD Article + FAQPage + BreadcrumbList, Discord CTA). Lessons: 1 What IDP is (starter-count figure, 7.04 survey), 2 Read your scoring first (four systems compared, Stacking check), 3 Same players four systems (Scoring switcher), 4 Which position runs out first (rank-group figure, Replacement level), 5 What repeats (stability figure beside the SIS sack finding, quiz, stat crews dated), 6 Position labels change value (dual-eligibility figure, label-drift caveat), 7 Drafting IDP (LB snap share against points, sourced round ranges), 8 In season (checklist; the "League Pulse projects your IDP players" sentence rendered only when the switch is on), 9 Dynasty IDP (sourced only), 10 Setting up an IDP league (three templates). No "WAR" anywhere. ASCII only. Every figure names its preset.
IDP-221 | Guide test | NEW lib/guides/idp-fantasy-football.test.ts (anchors rendered, ASCII across the three files, FAQ agrees with the page, no WAR, navLabel length)
IDP-222 | Register the guide (one sub-task per file) | lib/guides/published.ts:40-180, app/guides/page.tsx:143, app/page.tsx:1189, app/api/og/guide/[slug]/route.tsx:35 (required, a missing card 404s), lib/nav-tree.ts:139-206, lib/breadcrumbs.ts:45-55, lib/site.ts SEARCHABLE_TOOLS (done in IDP-201), glossary link (IDP-216); the two enumerating tests iterate the register and must stay green
IDP-223 | Internal links from the terms guide, dynasty strategy, FAAB settings by platform, and the IDP group header in Lineups (a "What is IDP scoring?" link, phase 3 renders it)
IDP-224 | Phase 2 verification and reviews: premium-standard checklist walked per surface (profile, search row, teams tab, trade surfaces, Brief desk, BEAM, Signal, draft tools), goldens green, offensive-profile goldens green, typecheck, test, build; the three review sub-agents (accessibility must confirm "no data hidden at any breakpoint" on the defender profile and teams tab); STOP for owner review. Publish the guide and IndexNow after the owner's review.

---

## 8. Phase 3: League Pulse behind the switch

Goal: every League Pulse model projects, seats, grades and suggests defenders when `idp.enabled` is true, and produces byte-identical output when false. Prerequisites: phases 1 and 2.

IDP-301 | The switch and the threading (R-25) | lib/power-pulse/default-settings.ts (settings.idp.enabled false), validate.ts, admin manager (toggle with the sentence "Turning this on recomputes every IDP league on next view"), lib/power-pulse/types.ts (`slotEligibility(idpEnabled)`, `IDP_SLOT_ELIGIBILITY` = OFF map plus DL:["DL"], LB:["LB"], DB:["DB"], IDP_FLEX:["DL","LB","DB"]), every server loader that builds an engine input reads the flag once and passes `idpEnabled` (lib/league-power-pulse.ts, lib/league-positional-war.ts, lib/league-manager-ledger.ts, lib/league-lineups/data.ts, lib/league-schedule/data.ts, lib/trade-impact/load.ts, lib/faab/league-faab.ts, lib/breakdown/league-impact.ts), components receive it as a prop (slot-swap-dialog)
- Test: with false, `slotEligibility(false)` is the same object as `PULSE_SLOT_ELIGIBILITY`; each orchestrator test asserts `loadPlayers` is called with the offense list when the flag is false.

IDP-302 | Multi-eligibility candidates and playedAs in the optimiser | lib/power-pulse/lineup.ts:36-41, 49-58 (startingSlots takes the map), 97-104, 120-132 (union of slotsByPosition over `eligible`, memoised by the sorted eligible key), 147-153, types.ts:88-95, lib/power-pulse/lineup.test.ts
- Kuhn augmenting paths stay exact. Test: a DL/LB player fills an LB slot when DL is full; `playedAs` is LB there; `startingSlots` keeps IDP tokens with the ON map and drops them with the OFF map.

IDP-303 | Loaders: players, projections, accuracy and splits under two keys | lib/power-pulse/load.ts:135, 353, 438-439 (positions from the flag), 642-693 (loadAccuracy accepts keys per position: idp123 for defenders, the league base otherwise, merged by player), 701+ (splits, same), lib/projections/read.ts:73-78 (positionByPlayer stays primary; add eligibleByPlayer), lib/power-pulse/project.ts:234-243, 328-333, 370-373 (curveFor for DL/LB/DB under idp123; scoringBase for a defender is idp123 for variance, league scoring for points), lib/power-pulse/load.test.ts, project.test.ts, lib/projections/read.test.ts
- Test: a DL under a league with no IDP keys projects null, never PPR; a DL under IDP123 projects the D-1 arithmetic; accuracy for a DL comes from the idp123 row.

IDP-304 | Schedules and matchup detail | lib/league-schedule/slots.ts:13-19, 178-186 (comments; isProjectableSlot takes the map), matchup.ts:221-264, 412-439, share-card.ts:274-292, components/league-schedule/matchup-table.tsx:230-231, 408-418, bench-upgrades.tsx:119-124, app/api/og/matchup/.../share/route.tsx:72-82, tests: slots.test.ts:62-80, 139-143, matchup.test.ts:186-213 (replace the hand-built LB row with one the loader returns; add the projected twin), 516-535, share-card.test.ts:219-228
- Footnote wording becomes "slots we cannot project" and appears only for unknown tokens (EDGE stays unprojectable). "No projection" stays the null state.

IDP-305 | Lineups | lib/league-lineups/build.ts:453-458, 477-479, 498-503, 510-527, 600, 616-626 (pairing uses the outgoing player's eligible list, never `as never`), simulate.ts:46-56 (isEligibleFor takes a list), season.ts:47-55, components/league-lineups/lineup-board.tsx:56, 430-441, 561, lineup-summary.tsx:13, season-charts.tsx:122-127, slot-swap-dialog.tsx (prop), tests build.test.ts:283-297, 310, 323, 507-521, simulate.test.ts:80-83, 127, 148, season.test.ts, recap.test.ts
- Also the "What is IDP scoring?" link on the IDP group header (IDP-223). Test: `isEligibleFor("IDP_FLEX", ["LB"])` true; `unprojectableSlotCount` 0 for an IDP league when on.

IDP-306 | IDP free agent universe, waivers and cut-list protection (R-5, R-6) | NEW lib/idp/free-agents.ts (and test), lib/league-lineups/data.ts:655-748 (merge, inside the metered panel, claimed after validation as today), advice.ts:65, 127-157 (R-5 seat test; says which players it declined to name), advice.test.ts
- Test: a dynasty roster never names an IDP player the optimiser seats in half the remaining weeks as a cut; the waiver list contains the top projected unrostered LB under the league's scoring.

IDP-307 | Power Pulse engine and UI | lib/power-pulse/engine.ts:377-384, 411-415 (credit `slot.playedAs`), 479 (depth includes DL, LB, DB), 501-508 (form ratio compares like with like once slots include IDP; while the flag is off for an IDP league, set formRatio null when unprojectable slots exist and state it), 400, 429-432, components/power-pulse/pulse-detail.tsx:273-290 (nine tiles wrap, order offense then defense), projected-champion.tsx:67-71 (positionNoun), lib/chopped (no change; chop odds follow the shared slots), tests engine, chopped.test.ts (a chopped IDP league's weekly mean includes IDP slots), model-version.test.ts unchanged until IDP-410

IDP-308 | Positional WAR engine, replacement, universe filter, cache shape | lib/positional-war/replacement.ts:19-25 (invariant rewritten), 66-106 (seated by playedAs; benched counted at every eligible position), 156-162, 172-197, engine.ts:64-77 (filter the universe by `startablePositions(league.slots)` before weekCandidates, R-12), 137, 173, 211-212 (curve at the primary), 346-358, load.ts:140, 174 (`CACHE_SHAPE_VERSION` "v3", hazard C), 426-427 (eligible_positions), 443-458, 475-476, fingerprint.ts:88 (IDP slots now enter the fingerprint), tests engine.test.ts:369-374, fingerprint.test.ts:252-264 (FLIP to not.toBe), load.test.ts:715-739 (switch-conditional), 832-856 (idp123 twin if the base enters the key), replacement.test.ts (dual-eligible seating, playedAs), naming.test.ts (stays green; every new string has "Positional" adjacent)
IDP-309 | Positional WAR page: Offense and Defense charts | app/leagues/[league_id]/positional-war/**, components/league-war/* (overlay.ts:94 plottable per chart, selection.ts:14, summary.ts:27-34 nine nouns, war-rail-summary.tsx:70-77, upgrade-panel.tsx:31-38, 114 dropdown), app/api/og/war/[league_id]/card.tsx (pinned in IDP-120; add the "defensive curve on the page" line), tests overlay.test.ts:104-119, summary.test.ts:158 (copy), route.test.ts:205-219 (DL/LB/DB rows ignored by the card)
IDP-310 | Manager Ledger | lib/manager-ledger/types.ts:57, lineup.ts:105-116, 140-143 (eligible list), 191-192, 244-258, 292, moves.ts:173-182, load.ts:340-341, 360, components/manager-ledger/how-it-works.tsx:15-18, 77, ledger-detail.tsx:173-175, lib/manager-ledger/empty-state.ts (the `settled` reason stops firing for IDP-only-ungradable leagues), tests lineup.test.ts:28-40, 96-118, engine.test.ts:88, 156-159 (an LB/DB-only league now grades), moves.test.ts (a claimed defender is named), empty-state.test.ts
IDP-311 | Trade Ideas and trade impact | app/leagues/[league_id]/trade-ideas/page.tsx:805, 993-997, 1006-1007 (IDP assets allowed into the builder with a noValue marker and "No market value"), lib/trade-finder/packages.ts:241 (unchanged, tested), types.ts (TRADE_POSITIONS widened in IDP-120), fingerprint.ts:64, 76 (prefix tf2), lib/trade-finder-data.ts:371-379 (wins side reads IDP projections), 401-417, 506, lib/trade-impact/evaluate.ts:168, 198, 522-524, 609-612 (comment), reasons.ts (defender caveat: "judged on projected wins only; no value source prices defenders"), tests packages.test.ts, fingerprint.test.ts, reasons.test.ts:840-845
IDP-312 | FAAB | lib/faab/free-agents.ts:86, 100-110, 137 (IDP universe from startable IDP tokens), marginal.ts:144-160 (eligibility), 174-177, 202-247 (R-5 before 219), league-load.ts:341 (idp123 finishes for defenders), manual.ts:64-79 (replacementRankFor for IDP shapes; flip manual.test.ts:69-71), app/tools/faab/player-combobox.tsx (labelled by position), app/api/og/faab/route.tsx (colours done), tests marginal.test.ts, manual.test.ts, priors-build.test.ts (done in IDP-124)
IDP-313 | Who Should I Start league tab | lib/breakdown/league-impact.ts:63, 276, 430 (guard from IDP-127 becomes the inclusion path when the flag is on), lib/start-sit/* exhaustive maps (already widened in IDP-120), tests league-impact.test.ts (a DL candidate is evaluated under league scoring when on, refused when off)
IDP-314 | Defender profile "This week" links into League Pulse (rendered only when the flag is on) | components/player-profile/* (small)
IDP-315 | Updated tests sweep | every file in the test audit list not yet touched: lib/power-pulse/variance.test.ts, variance-curve.test.ts (done), lib/league-lineups/status, weeks, lib/league-schedule/lineups, insights, lib/positional-war/war, chart-geometry, table, tiers, upgrade, scatter-geometry, chart-layout, share tests: review each, add the IDP case where the module's behaviour changed, record "reviewed, unchanged" otherwise
IDP-316 | Non-IDP invariant and the 40-league report | NEW scripts/verify-idp-invariant.ts (+ .test.ts for its pure parts, isRunDirectly guard): loads engine INPUTS through the existing loaders for 20 sampled non-IDP leagues and all 40 IDP leagues, runs the pure engines with the flag on and off, diffs stripped outputs; never calls `calculateLeague*` (they write). Non-IDP: identical apart from version strings. IDP: before and after (projected weekly totals, playoff odds, efficiency, curves) written to progress.md for the owner; every change must trace to IDP being counted.
IDP-317 | Phase 3 verification and reviews: goldens green with the flag off; typecheck, test, build; the invariant script; accessibility review of every changed League Pulse surface (no data hidden at any breakpoint, IDP rows read naturally); security review (migrations, free agent metering, admin validation); STOP for owner review. The switch stays OFF.

---

## 9. Phase 4: verification, launch, measurement

IDP-401 | Lint decision | owner chooses: install `eslint-config-next` and add lint to the gate, or drop lint from the checklist and say so in CLAUDE.md
IDP-402 | Accuracy backtest per position | from the 2020 to 2025 backfill: idp123 projected against actual correlation and mean error per position, against a naive "last 4 weeks average"; any position worse than naive ships with `positionReliability` 0 and a note; findings to the owner
IDP-403 | Opponent-split calibration | set DL, LB, DB `positionReliability` only to measured values (existing calibration approach); saved through the admin form
IDP-404 | CLAUDE.md updates (owner approves wording) | the rules that become false: "Sleeper publishes projections for QB, RB, WR, TE, K and DEF only" (`PROJECTION_POSITIONS` sentence), the Schedules null-projection paragraph, the Power Pulse and Positional WAR position statements, the Manager Ledger IDP paragraph, the League Pulse route list ("team deep view, future phase" is stale: the page is live), plus a new short IDP section naming `lib/site.ts isDefender/positionNoun`, `lib/idp/*`, the switch threading rule (R-25), the R-8 normaliser rule, and the points-guard test
IDP-405 | Switch on and version bumps | `idp.enabled` true; `modelVersion` pp-9; Positional WAR war-5 (cache shape v3 already); Manager Ledger ledger-5; trade-finder fingerprint tf2 (done); defender profile cache key v2 if its shape changed. On-demand recompute only through `pulseLeague`; nothing added to any cron. Guide lesson 8 sentence and the FAQ "does FF Beacon project IDP" answer flip to "yes, in League Pulse".
IDP-406 | Post-launch checks | day 1: zero "No projection" IDP slots for players Sleeper projects, zero "Unknown player" rows, the 40-league report re-run; Search Console at 28 and 56 days (indexed, impressions on three or more primaries, average position under 30); IndexNow pushed for the guide and the gated defender slugs
IDP-407 | Final reviews and progress.md close-out

---

## 10. Test strategy (what "we know before launch" means here)

- Baseline on 2026-09-23: 383 test files, 5,902 tests, 30 seconds, all green. The count only goes up.
- Vitest runs in node with no DOM: component assertions use `renderToStaticMarkup` substrings or exported pure helpers; page components that read Supabase are covered by source-level assertions (the og/faab route.test.ts pattern) and by their loaders' tests.
- Goldens (R-29) protect every engine and the offensive profile from the first task to the last. They are captured before any change and diffed with version fields stripped.
- Every hazard in section 5 has a named test. Every exhaustive position map is compiler-enforced by the widened type; every "stays six" surface is pinned by `OffensePosition` so the compiler also catches an accidental widening.
- Guard tests: the two projection guards, the naming guard, the sleeper-handle guard, the capture-set guard and the derived-tables guard stay green with no new allow-list entries; the new points guard (IDP-121) covers every defender module.
- Phase gate, in order: `npm run typecheck`; `npm test`; `npm run build` (the only step that catches client-boundary and `node:` import mistakes); the phase's database checks; the three review sub-agents.
- Fixtures: no shared fixture module exists today; IDP-101 creates the one for Power Pulse; every other module keeps its in-file factories and gains an IDP variant beside them (the audit listed each: positional-war/engine.test.ts:40-98, manager-ledger/lineup.test.ts:12-25, league-lineups/build.test.ts:38-124, league-schedule/matchup.test.ts:27-59, league-scoring.test.ts:17-43, faab/marginal.test.ts:14, trade-impact/reasons.test.ts:70).

## 11. Risks

- Stat crew noise in tackles: stated, never presented as exact. Label drift: `players.position` and Sleeper's eligibility are today's labels applied to past seasons, stated on the stability figure and in the accuracy write-up.
- Projection quality for IDP is unmeasured until IDP-115 runs; IDP-402 decides what ships with reliability 0.
- Blast radius: phase 1's type widening touches dozens of files; the goldens and the pins contain it, and phase 1 ends with an owner review before any product behaviour changes.
- The switch: with the threading rule (R-25) the OFF path is the existing map object, so "off means identical" is a property of the code, not a promise.
- Stored `pts_*` for defenders are offensive-only; the points guard (IDP-121) fails the suite if a defender module names them.
- Budget: this plan was written under session limits; sub-agents are used only for phase-end reviews.

## 12. Sources

Sleeper: https://support.sleeper.com/en/articles/3998131-what-scoring-options-are-available ; https://support.sleeper.com/en/articles/4056297-how-are-tackles-calculated ; https://support.sleeper.com/en/articles/3186339-what-stacks ; https://support.sleeper.com/en/articles/5992251-positional-designations-info-requests ; https://support.sleeper.com/en/articles/2441282-stat-corrections ; https://sleeper.com/message/590314338342969344/590322755656785920/590324439468519424
ESPN: https://www.espn.com/fantasy/football/story/_/id/45531787/2025-fantasy-football-how-play-idp-league ; https://www.espn.com/fantasy/football/story/_/id/45525668/2025-fantasy-football-idp-league-scoring-travis-hunter-eligibility ; https://support.espn.com/hc/en-us/articles/115003939192-Roster-Slots-Defense
Yahoo: https://help.yahoo.com/kb/fantasy-football/position-abbreviations-eligibility-players-play-positions-sln6500.html ; https://help.yahoo.com/kb/fantasy-football/stat-categories-sln6451.html
Other platforms: https://support.nfl.com/hc/en-us/articles/35869720023060-League-Settings ; https://www.fleaflicker.com/help/new-idp-designations ; http://www46.myfantasyleague.com/2020/describe?NAME=Basic+IDP
Scoring systems: https://www.theidpshow.com/p/big-3-scoring ; https://www.fantasypros.com/scoring-settings/ ; https://www.pff.com/news/the-pff-idp-scoring-system-revisited ; https://idpplus.com/idp-scoring-systems-and-how-to-pick-one-in-2025/ ; https://www.theidpcenter.com/guides-and-resources/idp-scoring ; https://www.profootballnetwork.com/idp-scoring-settings-for-beginners/ ; https://fantasysixpack.net/idp-scoring-systems-explained/
Surveys: https://www.theidpshow.com/p/2025-state-of-idp-report-part-1-fantasy-football ; https://www.theidpshow.com/p/2025-state-of-idp-report-fantasy-football ; https://www.theidpshow.com/p/2024-state-of-idp-report
Strategy and stability: https://www.fantasylife.com/articles/fantasy/idp-fantasy-football-2026-strategy-guide-lineup-construction-dra ; https://www.si.com/onsi/fantasy/nfl/2025-fantasy-football-idp-strategy-guide-tackles-snap-counts ; https://www.footballguys.com/article/2026-idp-draft-blueprint-godfathers-step-by-step-guide ; https://www.playerprofiler.com/article/fantasy-football-idp-101/ ; https://www.draftsharks.com/kb/what-is-idp-fantasy-football-best-strategy ; https://www.nfl.com/news/2026-fantasy-football-idp-draft-strategy-players-to-target-how-travis-hunter-factors-in ; https://www.pff.com/news/idp-tackles-and-sacks-linebackers ; https://www.sportsinfosolutions.com/2024/05/28/under-pressure-projecting-sack-numbers-using-advanced-pass-rushing-metrics/ ; https://www.thefantasyfootballers.com/analysis/commissioner-guide-creating-an-idp-league-fantasy-football/
Tackle recording: https://en.wikipedia.org/wiki/List_of_NFL_annual_tackles_leaders ; https://www.si.com/nfl/2015/09/18/nfl-tackling-history-stat-leaders-lavonte-david ; https://www.footballguys.com/article/2018-idp-stat-crews ; https://sports.yahoo.com/nfl-tries-tackle-tackling-next-230525118.html
