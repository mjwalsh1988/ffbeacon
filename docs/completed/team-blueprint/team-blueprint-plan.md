# Team Blueprint (League Pulse) and Market Signals: build plan

Status: BUILT 2026-10-29 (BP-T001 to BP-T085), not yet deployed; section 21
says what shipped differently. Drafted 2026-10-29; the owner answered every
open question the same day (section 18) and added two calls to action
(section 20). Next available migration number: 0340. Task prefix in
progress.md: BP-T###.

This document is written so that a fresh Claude Code session can build the
feature end to end without making a product decision. Every formula,
threshold, label, class string, table, route and task is spelled out. Section
18 records the owner's decisions; the builder follows them as written and
never reopens one. Anything genuinely missing is built the way the nearest
existing feature does it and listed in the handoff, not asked.

Read CLAUDE.md first. Every absolute rule there applies: one shell command per
tool call, no typographic punctuation anywhere (ASCII only, write banned
characters as JavaScript escapes), American English, no DPC branding, no
em dashes, Eastern time on every timestamp, the Source and Format Sync rule,
the naming rule for the token "WAR", defenders never priced, mobile first with
nothing hidden, nothing visible aria-hidden, 44px tap targets, the gate
(typecheck, lint, test, build) before any task is called complete.

Contents

1. What this is
2. What exists today (reuse, never rebuild)
3. Decisions already made
4. Names, URLs, navigation
5. Market Signals: the nightly Bollinger engine
6. The Blueprint view model, field by field
7. Storage: migrations 0340 to 0342
8. Loader, cache policy, fingerprint, rate limits
9. The page, section by section
10. Design specification
11. Share images
12. Player profile badge and other Market Signals surfaces
13. Admin panels
14. Accessibility
15. Security
16. Testing
17. Build order (atomic tasks) and sub-agent reviews
18. Owner decisions (answered 2026-10-29)
19. Copy, glossary and the words that are banned here
20. Calls to action: the league overview and the homepage
21. What shipped differently

---------------------------------------------------------------------------

## 1. What this is

Two deliverables that ship together.

1.1 Team Blueprint. One roster in one Sleeper league, read as a one-page
plan: where the team stands, what it is built from, what is rising and
falling on it, which players to buy, sell and hold, which positions to spend
on, what the draft capital is worth, three priorities in plain words, three
concrete trade shapes with a grade on each, the two best trade partners in the
league, and a spotlight on the week that just happened. It is a page under
League Pulse and a shareable PNG a reader copies as an image or as an image
link, the way the matchup scoreboard and the team card already work.

The reference sheets the owner supplied (two "Domain Team Blueprint" images)
set the CONTENT: starting lineup with a call per player, risers and fallers,
positional grades plus bench and draft capital, an age picture, a trade
activity gauge, team depth, a prospect spotlight, a buys and sells board,
league settings chips, a value archetype and a roster archetype, roster by
position with ranks, production share and value share with league ranks, a
two-year outlook, an overall grade, draft capital by season, top priorities, a
trade strategy board (downtier, uptier, pivot) and ideal trade partners. The
VISUAL treatment is FF Beacon's own, per CLAUDE.md rule 3 and section 10
below. Nothing from those sheets' styling, wording, logo or color is copied.

1.2 Market Signals. A nightly engine that places every priced player's
current value inside Bollinger bands built from his own value history, and
labels him buy, watch buy, hold, watch sell or sell, per format and per
source. It is ported from dynasty-price-check's exchange signal, rebuilt so it
runs inside a 300-second Vercel function every night with no per-row updates
and no statement timeouts. The Blueprint's buy, sell and hold calls read it.
The player profile shows it as a badge beside the value trend. A later
"Beacon Exchange" page can be built on the same table; this plan does not
build that page (section 12.4 says what it would need).

---------------------------------------------------------------------------

## 2. What exists today (reuse, never rebuild)

Everything below was verified on 2026-10-29. File paths are relative to the
repo root. The builder reads each of these before writing a module that
touches the same question.

2.1 Roster and values

- lib/league-share-card.ts loadTeamShareCard(supabase, leagueRowId,
  sleeperRosterId, formatConfigId, sourceSlug, season, status, includePicks,
  isDynasty) returns TeamShareCard: per-position groups (QB, RB, WR, TE) with
  each player's value, starter flag, topAtPosition, dropCandidate, plus
  starter, bench, picks and total value and overallRank. One roster, priced.
- lib/league-view-data.ts loadLeagueTeamCards(supabase, leagueRowId,
  formatConfigId, sourceSlug, currentSeason, leagueStatus, includePicks)
  returns TeamCardData[] for EVERY roster: record (wins, losses, ties,
  pointsFor), cacheRow (starter_value, bench_value, picks_value, total_value,
  overall_rank, starter_rank, positional_breakdowns), players (ResolvedPlayer
  with id, sleeper_id, full_name, position, team, age in whole years,
  years_experience), playerPositionRanks, draftPicks (DraftPickAsset, no
  value), positionValues and positionRanks (league rank per position),
  statRanks (starter, bench, picks, total), rosterIdToTeamName,
  rosterIdToOwnerUsername. Also exports resolvePlayers, loadPositionRanks,
  loadTrends (7-day fields only; section 8.2 extends the read).
- league_power_rankings_cache.positional_breakdowns holds per-position value
  subtotals and per-player values with slot "starter" or "bench". The
  "starter" there is a value-greedy fill, not Sleeper's actual starters.
- lib/trade-finder-data.ts loadTradeFinderLeague(supabase, {sleeperLeagueId,
  sourceSlug, identity}) returns TradeFinderLeague with FinderTeam[] (each
  FinderPlayer has value, hasValue, age as a decimal, projPoints, isInactive;
  each FinderPick has season, round, pickPosition, positionEstimated, label,
  value, hasValue, isOwnPick, originalOwnerHandle), startingSlots, isDynasty,
  allowPicks, poolMax, sleeperLeague, myRosterId. Picks are priced through
  lib/league-pick-position.ts buildPickPositionResolver and
  lib/draft-pick-snapshot.ts loadLatestPickSnapshot, with the KTC fallback.
  THIS is the per-pick valuation the Blueprint uses; calculateLeaguePowerRankings
  prices every pick at "mid" and must not be used for the draft capital
  section.
- lib/league-format-resolution.ts resolveLeagueContext(supabase,
  sleeperLeague, sourceSlug) returns LeagueContext (formatSlug,
  formatDisplay, formatConfigId, sourceSlug, sourceDisplay, coverage,
  fallback, derived, pickSource) or LeagueContextEmpty (coverage "none").

2.2 Lineup by slot

- lib/league-lineups/data.ts starterIdsFromRosterMetadata(metadata) returns
  the raw positional starters array including "0" placeholders.
- lib/league-schedule/slots.ts alignedStartingSlots() keeps every non-bench
  token including IDP. Pair the two to get slot label plus player per slot.
- lib/league-lineups/data.ts loadLineupView is the full lineup page loader
  (projections, optimizer, waivers). The Blueprint does NOT call it; it is too
  heavy and it meters a waiver panel the Blueprint does not show.

2.3 Team standing

- lib/league-power-pulse-data.ts loadPowerPulseView(supabase, leagueRowId,
  season, formatConfigId, sourceSlug) returns PowerPulseView with teams:
  PulseTeam[] carrying powerPulse, pulseRank, projectedWins, playoffOdds,
  titleOdds, expectedPointsPerWeek, positionPoints and positionRanks
  (projected starter points per position, league ranked), depthDropoffPct,
  scoreDepthRank (via score_depth_rank), lineupEfficiency, totalValue,
  valueRank, rankDivergence, status (TeamStatus), weekly, and preseason flag.
- lib/league-team-status.ts classifyTeamStatus, TeamStatus {key:
  "competitor" | "loaded" | "middle" | "rebuilder", variant, label, short,
  phrase, reason}. Labels: Contender, Loaded, Bubble, Rebuilder; redraft
  "Longshot" for rebuilder.
- lib/trade-finder/profile.ts buildTeamProfile(team, slots, baselines,
  {isDynasty, surplusFloor}) returns TeamProfile {direction: "win-now" |
  "balanced" | "rebuild", startingTotal, starterIds, positionNeed:
  Record<position, pointsPerWeek>, replacementCost: Map<playerId,
  pointsPerWeek>, surplus: FinderPlayer[], totalValue, meanAge}. Also
  directionOf, leagueStarterBaselines.
- lib/league-manager-ledger-data.ts loadManagerLedgerView(supabase,
  leagueRowId, season) returns per-roster officialPoints, efficiency,
  efficiencyRank, scoringRank, winsLeftOnBench. Read only; the Blueprint never
  triggers its compute (pulseLeagueDerived includeManagerLedger stays false).
- lib/league-positional-war-data.ts loadPositionalWarView(supabase,
  leagueRowId, season) returns WarView {curves, status, isStale, ...};
  lib/league-lineups/data.ts warBySleeperId(curves) maps a sleeper id to
  {war, rank, poolSize}.

2.4 Trade engines

- lib/trade-finder/engine.ts findTrades(input: TradeFinderInput):
  TradeFinderResult. Input supports goal: "consolidate" (several out, one
  better in) and "split-assets" (one out, several in), enforced by
  lib/trade-finder/rank.ts satisfiesGoal with TIER_JUMP = 1.15. Output
  TradeSuggestion has incoming, outgoing, counterparty, mine and theirs
  SideImpact (valueDelta, lineupDelta, winsDelta, ageDelta), acceptance
  ("likely" | "worth-asking" | "long-shot"), score, headline, rationale,
  whyYou, whyThem, pitch, caveats. MAX_RESULTS = 40. Cost: a few hundred
  candidate deals and about twice that many lineup fills.
- lib/trade-finder-grade.ts gradeAssetPairs(admin, sleeperLeague,
  GradeableTrade[]) returns SuggestionGrade[] {verdictLabel, favours,
  confidenceLabel, tradeShapeLabel, explanation, formatDisplay}. Batched.
- lib/trade-finder/packages.ts acquirablePool, givablePool.
- lib/trade-finder/tendency.ts appetiteScore(slice, position, playerId) in
  [-1, 1]; manager tendencies are loaded only for signed-in readers in
  app/leagues/[league_id]/trade-ideas/page.tsx lines 744 to 753.
- lib/trade-impact/proposal-url.ts proposalHref(sleeperLeagueId, proposal,
  {searchedUsername, source}) builds the /trade-ideas?mode=build link; a
  TradeProposal is {myRosterId, theirRosterId, incoming: BuildAsset[],
  outgoing: BuildAsset[]}, BuildAsset = {kind: "player", playerId} | {kind:
  "pick", season, round, pickPosition, originalRosterId}.
- lib/trade-impact/rate-limit.ts claimTradeSuggestionSlot (12 per minute per
  actor) is the pattern; the Blueprint gets its own bucket (section 8.4).
- lib/trade-impact/reasons.ts header lines 10 to 17 state the template rule
  this plan copies: every sentence cites a figure in the input, a null figure
  means the sentence does not fire, no language model.

2.5 Cut list, waivers, movers, chips, ages

- lib/league-lineups/advice.ts DYNASTY_KEEP_VALUE = 1500 (a dynasty or keeper
  player at or above it is never offered as a cut), buildDropOptions,
  goalBrief(status).
- lib/roster-badges.ts dropCandidateIds(candidates, {isDynasty}) (the three
  lowest-value non-starters), isTopAtPosition (rank <= 14), isDynastyStash.
- lib/rankings/insights.ts topMovers(rows: BoardRow[], {window: "7d" | "30d",
  limit}) returns {risers, fallers, considered}; applies a value floor of 5%
  of the board top at both ends of the window and the show_trend_* gate.
  Input is a board row shape; section 6.6 refactors it to a minimal row.
- lib/league-format-tags.ts buildLeagueFormatTags({rosterPositions,
  scoringSettings, teamCount}) returns FormatTag[] {key, label, tone}: "N
  teams", "Start N", "PPR x", "TEP x", "SF Yes/No", then per-slot counts.
- lib/player-age.ts computeAgeDecimal(birthDate, now), formatAge.
- lib/league-emphasis.ts emphasisForDynastyFlag(isDynasty) returns
  {mode: "wins" | "value", winsFirst, valueLabel, valueHint}.
- lib/league-masthead.ts leagueMastheadProps(league, context, cached).

2.6 Share infrastructure

- lib/og/brand.tsx: OG_SIZE, OG_COLORS, OG_POSITION_COLORS, OG_GRADIENT,
  ogResponseOptions(cacheControl, {status}), OG_ROOT_STYLE, OgAccentBar,
  OgBrandMark, fitText.
- lib/og/assets.ts: OG_FONTS (Geist 500 and 900 only), OG_LOGO_DATA_URI,
  OG_WORDMARK, loadRemoteImage, loadRemoteImages, sleeperPlayerImageUrl.
  Satori needs width and height in style on every img.
- lib/og/headline-card.tsx renderHeadlineCard(card, cacheControl): the
  branded placeholder used by leaderboards for empty and missing states.
- app/api/og/war/[league_id]/card.tsx: the pattern for a chart inside an OG
  image: a pure geometry module in lib/, an SVG string built from it, embedded
  as a data URI img. svgToDataUri lives there. The page SVG and the OG SVG
  consume the same geometry so they can never disagree.
- app/api/og/leaderboards/[league_id]/route.tsx: the newest route skeleton
  (308 to canonical on any unknown query, renderHeadlineCard placeholders,
  LONG_CACHE and SHORT_CACHE).
- app/leagues/[league_id]/matchups/[week]/[roster_id]/page.tsx lines 627 to
  692: the local ShareStrip (section with h2 "Share", Copy image, Copy image
  link, Copy page link). Section 9.14 extracts it.
- components/copy-image-button.tsx CopyImageButton({imageHref, description,
  label, ariaLabel, size}); components/copy-link-button.tsx
  CopyLinkButton({href, ariaLabel, label, size, icon, noun, prewarmHref,
  compactBelowSm}).
- generateMetadata on league pages is inline: {title, description, robots:
  {index: false, follow: true}, openGraph: {images: [{url, width: 1200,
  height: 630}]}, twitter: {card: "summary_large_image", images: [url]}}.
  See app/leagues/[league_id]/teams/[roster_id]/page.tsx lines 64 to 127.

2.7 Page chrome and navigation

- components/league-shell/league-shell.tsx LeagueShell props:
  sleeperLeagueId, activeTab: LeagueTabId, viewer, homeHref, crumbs,
  copyHref, copyAriaLabel, otherLeagues, masthead, alert, children.
- components/league-shell/nav-items.ts: LeagueTabId union, LEAGUE_NAV_ITEMS
  {id, label, hint, icon}, and the full-route list inside leagueTabHref (an
  id missing there resolves to ?tab=).
- components/league-lineups/lineup-controls.tsx LineupControls (client):
  {sleeperLeagueId, linkUsername, week, weeks, rosterId, teams}; sticky bar,
  native selects, prev and next steppers, CONTROL and STEPPER class strings.
  The Blueprint reuses the roster select half (section 9.2).
- components/dashboard-panel.tsx Panel {id, eyebrow, title, helper, action,
  glow, headingLevel, className, bodyClassName, headingFocusable, as}, and
  StatReadout {label, value, accent}.
- components/manager-pulse/stat-tile.tsx StatTile with size "hero" (one per
  section) and default.
- components/chart-kit.tsx: DataTable, Th, Td, ChartFigure, SeriesLegend,
  linePath, makeScale, markerPath, POSITION_SERIES, SERIES_A, SERIES_B,
  ChartEmpty. No bar helper exists; bars are a div track plus a div fill.
- components/trend-chip.tsx TrendChip {direction, delta, deltaPct,
  windowLabel, cadence}; components/position-chip.tsx PositionChip.
- components/league-leaderboards/podium.tsx, top-tier.tsx, leader-row.tsx:
  the number hierarchy this page copies (section 10).
- components/PulseLoader.tsx, components/section-loading-card.tsx.

2.8 Settings pattern

- lib/would-you-rather/default-settings.ts and settings.ts: one global jsonb
  row, zod schema, validate, merge with defaults on a bad row, load through
  memoTtl("settings:<name>", 60_000), save through upsert on id,
  app/admin/would-you-rather/{page.tsx, actions.ts, *-settings-manager.tsx},
  nav entry in lib/nav-tree.ts. Migration shape: supabase/migrations/
  0225_would_you_rather.sql line 75 onward.

2.9 Cron pattern

- vercel.json cron entries (UTC); every cron route exports runtime "nodejs",
  dynamic "force-dynamic", maxDuration 300, RUN_BUDGET_MS 280_000.
- lib/cron-auth.ts verifyCronRequest; lib/cron-runs.ts recordCronRun(admin,
  jobName, fn, {quietWhen, timeoutMs}), CRON_JOBS registry and CronJobName
  union (a new job must be added to both, and lib/cron-schedule-sync.test.ts
  fails if vercel.json and the registry disagree); lib/cron-health.ts assumes
  every route is 300 seconds or less (STALE_RUNNING_MS 20 minutes).
- lib/calculate-trends.ts: HISTORY_LOOKBACK_DAYS 140, HISTORY_READ_SLICES 4,
  keyset paging on (captured_at, id) at PAGE 1000 through withRetry,
  computeTrendRows (pure), chunkUpsert 500, market = value - formula_offset.
  recalculate-derived (10:00 UTC) already spends 150 to 180 seconds of its
  280-second budget, most of it in that read. There is NO headroom for a
  second history read in that route.
- lib/supabase/fetch-all.ts fetchAllRows, fetchAllRowsByKeyset,
  fetchAllRowsInChunksByKeyset; lib/supabase/retry.ts withRetry, chunkUpsert.
- player_value_history: unique (player_id, format_config_id, source,
  captured_at); index idx_player_value_history_format_source_captured on
  (format_config_id, source, captured_at desc) INCLUDE (player_id, value)
  (migration 0122). About 10,000 new rows a day across sources; 2.07M rows
  on 2026-09-08. The KTC backfill stamps UTC noon and the sync stamps its run
  time, so one calendar day can hold two rows for a player.

2.10 Player profile

- components/player-profile/player-hero.tsx PlayerHero badge row (around
  lines 150 to 188): position chip, team chip, status chip, RoleBadge. Status
  chip classes: inline-flex items-center rounded-md bg-signal-warning/15 px-2
  py-0.5 text-xs font-semibold uppercase tracking-wider text-signal-warning.
- components/player-profile/overview-sidebar.tsx OverviewSidebar: Panel
  eyebrow "Market" title "Value trend", current value in font-mono text-3xl
  font-bold tabular-nums text-brand-purple with a TrendChip beside it, then
  components/player-profile/value-trend-chart.tsx ValueTrendChart.
- lib/player-profile.ts loadValueSeries(...) loads one player's history.

2.11 dynasty-price-check (READ ONLY reference, at
C:\Users\mjwal\OneDrive\Desktop\dynasty-price-check)

- src/lib/exchange-signal.ts: BOLLINGER_WINDOW 30 rows, multiplier 2,
  WATCH_THRESHOLD_PCT 0.05, computeBollinger (sample stdev, n-1),
  classifySignal. Order of rules: sell, watch_sell, buy, watch_buy, hold.
  Boundaries inclusive. band_pct = (value - lower) / (upper - lower).
- Production runs the SQL twin exchange_recompute_bollinger_bands, which
  UPDATEs band columns on every history row through a LATERAL 30-row lookup
  in chunks of 250, halving on statement timeout (error 57014) because RPCs
  through PostgREST inherit the 8-second statement timeout. It was rewritten
  three times and still times out when another sync writes concurrently. It
  has no gap handling, no hysteresis, a stale-bands bug when an older row is
  inserted later, and a dashboard query that matches historical BUY rows
  rather than each player's latest row.
- Its UI: labels BUY, WATCH (BUY), HOLD, WATCH (SELL), SELL, BUILDING
  BASELINE; a "Why this signal?" drawer; a Recharts band chart.
We keep the algorithm's shape (window, k, five states, 5% watch zone) and
replace the job, the storage and the UI entirely. Nothing is copied from its
source files.

---------------------------------------------------------------------------

## 3. Decisions already made

These were decided in the 2026-10-29 planning session and are not open.

3.1 The Blueprint is a page AND two generated images (a 1200x630 link
preview and a portrait share card), built from ONE view model stored in a
cache table. The image routes read the stored view and never run an engine.
A page and its image therefore show the same numbers by construction.

3.2 No new prediction model. Every figure is read from an existing cache or
is arithmetic over existing figures. The only engine run at render is
findTrades, which Trade Ideas already runs on every view, metered.

3.3 Market Signals is a separate nightly cron route, not a step inside
recalculate-derived. It reads one (format, source) partition at a time,
writes latest-only rows, and stops at its deadline; a second schedule entry
twenty minutes later finishes whatever the first one did not. There are no
per-row band updates and no RPC that does heavy work.

3.4 The college prospect card on the reference sheet is NOT reproduced. We
hold no prospect or college data and the owner's zero-cost data rule forbids
buying any. Its slot is taken by the Spotlight (section 6.13).

3.5 The age picture is per-position bars (this roster versus the league),
not a time series. We hold no history of a roster's age and would be
inventing one.

3.6 Buys are defined as positions of need with named targets on other
rosters; sells, holds and build-arounds are the reader's own players. A
market signal alone never produces a call; it strengthens or weakens a
roster-based one (section 6.7).

3.7 Redraft leagues get a Blueprint too, with the dynasty-only parts stated
as not scored (draft capital grade, two-year outlook, age archetype) rather
than hidden.

3.8 Grades are 1 to 10 integers, league-relative, with an overall to one
decimal. (Open question 18.1 can change this to letters before the build
starts; after that it is fixed.)

3.9 Defenders (DL, LB, DB) and specialists (K, DEF) are shown on the roster
with "No market value" and receive no call, no grade contribution and no
market signal, per CLAUDE.md IDP rules.

3.10 The view model, the cache row and the share images are versioned by
BLUEPRINT_MODEL_VERSION. Any change to a formula bumps it; a stale version
rebuilds on next view.

3.11 Roster age is TRACKED from launch so a history chart can be drawn
later. Every build writes one compact row per roster per day to
league_roster_age_history (section 7.2). The page draws bars today; the
"age over time" chart is a follow-up that reads that table and is not in this
gate.

3.12 "Blueprint" sits directly after "Overview" in the league navigation.
The league overview page carries a call to action above the activity panel,
and the homepage carries a short feature strip under the hero (section 20).

3.13 Database size is a design constraint, not an afterthought. Every new
table in this plan is either latest-only, change-only or pruned on a stated
schedule, and nothing is added to player_value_history (section 7.4).

3.14 The running back sell cutoff is 28 (QB 33, WR 30, TE 30 as proposed).

3.15 The leaderboards page is moved onto the shared share strip in this
build; it is in the gate, not a follow-up.

---------------------------------------------------------------------------

## 4. Names, URLs, navigation

4.1 Feature name in copy: "Team Blueprint". Section label in the league
navigation: "Blueprint". The engine: "Market Signals" in admin and docs; on a
reader's screen it is "market signal" in lower case inside a sentence and the
badge reads the state word.

4.2 Routes

- Page: /leagues/[league_id]/blueprint?roster=N. roster is the Sleeper
  roster_id. With no roster param, the roster is the viewer's own team
  through lib/sleeper-handle/resolve.ts resolveSleeperViewer, matched by
  rosters.owner_user_id first and display name second (CLAUDE.md saved handle
  rules). With no viewer and no param, the page shows the roster picker and
  the first roster by Sleeper roster_id, and says in the intro that no team
  was chosen.
- Link preview image: /api/og/blueprint/[league_id]/[roster_id]?source=slug
- Portrait share image: /api/og/blueprint/[league_id]/[roster_id]/share?source=slug
- Any query string other than source (and username on the page) gets a 308
  to the canonical URL on the image routes, as the leaderboards routes do.
- The canonical copy link is /leagues/[id]/blueprint?roster=N with no
  username, per components/league-header-actions.tsx header comment.

4.3 Navigation

- Add "blueprint" to the LeagueTabId union and an entry to LEAGUE_NAV_ITEMS:
  {id: "blueprint", label: "Blueprint", hint: "One team's plan: grades,
  calls, trade shapes and partners", icon: <an existing NavIconName; use the
  same icon the Decisions tab uses if no better one exists>}. Add "blueprint"
  to the full-route list inside leagueTabHref. Place it DIRECTLY AFTER
  "overview" in the order, before "teams".
- components/team-card.tsx header strip gains a link "Open blueprint" to
  /leagues/[id]/blueprint?roster=N (plain Link, same size class as the Copy
  buttons beside it, min-h-11).
- app/leagues/[league_id]/teams/[roster_id]/page.tsx gains the same link
  under the TeamCard, beside the existing "Who should I start" link.
- Breadcrumbs: pass crumbs [{label: league.name, href: /leagues/[id]},
  {label: "Blueprint"}] to LeagueShell.

4.4 Admin

- /admin/league-blueprint: thresholds and weights (section 13.1).
- /admin/market-signals: engine settings and the last run (section 13.2).
- Both get a lib/nav-tree.ts entry under the existing admin group that holds
  /admin/power-pulse.

4.5 Calls to action: section 20 specifies the overview page CTA
(components/league-blueprint/blueprint-cta.tsx) and the homepage strip
(components/blueprint-feature-strip.tsx) in full.

4.6 Docs

- This file lives at docs/team-blueprint/team-blueprint-plan.md and gets a
  row in docs/README.md under Active. When the build ships it moves to
  docs/completed/team-blueprint/ with git mv and the row moves too.
- Nothing at run time reads or writes docs/. The engine writes no files.

---------------------------------------------------------------------------

## 5. Market Signals: the nightly Bollinger engine

5.1 Definitions

A SERIES is one player's market values for one (format_config_id, source),
one point per UTC calendar day. When a day holds more than one
player_value_history row (the KTC backfill noon stamp beside a sync stamp),
the LATEST captured_at of that day wins. The market value of a row is
value - formula_offset, the same figure lib/calculate-trends.ts uses, so a
source with a formula offset is measured on its market number.

The WINDOW is the last 30 calendar days ending on the series' latest day with
data, which must be within STALE_DAYS (default 3) of the run date or the
series is skipped as stale (no row written, previous row left alone).

POINTS_IN_WINDOW is the count of days inside the window that have a value.
MIN_POINTS (default 24 of 30) must be met; below it the signal is
"baseline" with the count shown, and bands are still stored when at least 10
points exist so the profile chart can draw a faint band, but no call is
issued and no change is logged.

5.2 The formula (lib/market-signals/bollinger.ts, pure)

Given the window's values v[1..n]:

    mean  = sum(v) / n
    stdev = sqrt( sum((v - mean)^2) / (n - 1) )      sample stdev, n >= 2
    upper = mean + K * stdev                          K default 2
    lower = mean - K * stdev
    width = upper - lower
    bandPct = (latest - lower) / width                 null when width == 0
    bandwidth = width / mean                           null when mean == 0

Store bandPct unclamped to three decimals; clamp to [-0.5, 1.5] only for
drawing.

5.3 The five states, with hysteresis

Let W = width, WATCH = 0.05 (settings), HOLD_BACK = 0.10 (settings).
prev is the previous stored signal for the same (player, format, source), or
null.

    if width == 0 or points < MIN_POINTS:          signal = "baseline"
    else if latest >= upper:                       "sell"
    else if latest >= upper - WATCH * W:           "watch_sell"
    else if latest <= lower:                       "buy"
    else if latest <= lower + WATCH * W:           "watch_buy"
    else:                                          "hold"

    hysteresis, applied after the above:
    if prev == "sell"  and signal in {"watch_sell", "hold"}
        and latest >= upper - HOLD_BACK * W:        signal = "sell"
    if prev == "buy"   and signal in {"watch_buy", "hold"}
        and latest <= lower + HOLD_BACK * W:        signal = "buy"

So a player who crossed the upper band stays "sell" until his value falls
back more than 10% of the band width inside it. This is the one deliberate
change from dynasty-price-check, whose signals flip daily around a boundary.

A thin market is never signaled: when latest < FLOOR_PCT (default 0.05) of
the top market value in that (format, source) on the latest day, signal is
"thin" and no change is logged. The same floor lib/rankings/insights.ts
topMovers uses, for the same reason: a 40-point player moving to 60 is not a
buy window, it is noise.

5.4 Storage (migration 0342, section 7.3)

player_value_signals, one row per (player_id, format_config_id, source),
latest only. player_value_signal_changes, one row per state change (from, to,
day), append only. No band columns on player_value_history, ever. The profile
chart computes its bands on the fly from the series it already loads, with
the SAME pure function, so there is nothing to keep in sync.

5.5 The job (app/api/cron/market-signals/route.ts)

Shape: runtime "nodejs", dynamic "force-dynamic", maxDuration 300,
RUN_BUDGET_MS 280_000, verifyCronRequest, recordCronRun(admin,
"market-signals", fn, {timeoutMs: RUN_BUDGET_MS}). Registered in CRON_JOBS
and the CronJobName union. vercel.json gets TWO entries for the same path:
"30 10 * * *" and "50 10 * * *" (UTC). The 10:00 recalculate-derived run is
finished by 10:03 on every measured night; the 10:45 community-rankings run
is short. (The 10:50 entry is the catch-up; on a normal night it finds
nothing to do and records a quiet run through quietWhen.)

Work unit: one PARTITION = one (format_config_id, source) that source_registry
declares supported (supported_format_slugs, NULL meaning all active formats)
and that has at least one history row in the last STALE_DAYS. Partitions are
listed from format_configs x source_registry (is_active), then filtered by a
head count on player_value_history for the last 3 days. Expect 12 to 20
partitions.

Per partition:

1. Read the last LOOKBACK_DAYS (default 45; 30 for the window plus 15 of
   slack for gaps and the stale check) of rows for that partition with ONE
   keyset walk on (captured_at, id) through fetchAllRowsByKeyset, selecting
   player_id, value, formula_offset, captured_at only. The 0122 index covers
   it. Expect 25k to 60k rows, 25 to 60 pages, 4 to 10 seconds.
2. Fold to series in memory: Map<player_id, Map<utcDay, market>> keeping the
   latest captured_at per day. Memory: trivial.
3. Read the partition's existing player_value_signals rows (one page per
   1000, selecting player_id, signal, signal_since) for hysteresis and change
   detection.
4. Compute every player's row with the pure function. Collect upserts and
   change rows.
5. chunkUpsert player_value_signals in chunks of 500 on conflict (player_id,
   format_config_id, source); insert player_value_signal_changes in chunks of
   500 with ignoreDuplicates on (player_id, format_config_id, source,
   changed_on).
6. Stamp the partition done: market_signal_runs row (section 7.3) with
   as_of_day, rows written, duration.

The deadline rule: before starting a partition, if Date.now() + the longest
partition so far this run (or 30 seconds on the first) would pass
RUN_BUDGET_MS - 10 seconds, stop and return {ok: true, partial: true,
remaining: [...]} with NO failedSteps. The 10:50 entry picks up the
remaining partitions because the staleness check (step 0) skips any partition
whose market_signal_runs.as_of_day already equals today's latest history day.
A partition whose read or write throws is pushed to failedSteps and the run
moves to the next partition; recordCronRun then records the run as error and
emails through the existing cooldown. Nothing here is a sleep, a retry loop
or an RPC. Every page goes through withRetry.

Order of partitions: by source_registry display_order then
format_configs.display_order, so the default source and format are always
first and always finish.

Cache: after the last partition, revalidateTag(CACHE_TAGS.playerValues) so
the profile badge and any cached blueprint fingerprint see the new
computed_at.

5.6 Why this cannot time out the way dynasty-price-check does

- No RPC: nothing runs under the 8-second PostgREST statement timeout. Every
  query is a plain indexed range select of at most 1000 rows or a 500-row
  upsert.
- No per-row history updates: 2 million rows are never touched; the
  partition's 50k rows are read once and about 1,000 latest rows are written.
- The job is resumable by construction: partitions are independent, stamped
  when done, and skipped when fresh. A missed night is caught the next night
  (the window reads calendar days, not row counts, so the result is the same
  whenever it runs).
- Concurrency with other syncs only slows reads; it cannot cancel them.
- Measured expectation: 12 to 20 partitions at 5 to 15 seconds each, 90 to
  240 seconds total on a cold night, so most nights finish in the first
  entry; the second entry exists for the nights that do not.

5.7 Backfill

None scheduled, per the CLAUDE.md backfill rule. One-time script
scripts/backfill-market-signal-changes.ts, npm run backfill:market-signals
with --from and --to, replays the state machine day by day for one partition
at a time and writes player_value_signal_changes only. It is run once after
launch for the last 365 days so the profile can say "Buy window since Oct 3"
on day one. It refuses to run without a window. Idempotent through the
unique key.

5.8 Settings (market_signal_settings, section 7.3, admin section 13.2)

    window_days 30, k 2.0, watch_pct 0.05, hold_back_pct 0.10,
    min_points 24, stale_days 3, lookback_days 45, floor_pct 0.05,
    enabled true, model_version 1

Changing window_days or k changes every row on the next run; the admin page
says so beside those two fields. model_version is stored on every row.

---------------------------------------------------------------------------

## 6. The Blueprint view model, field by field

lib/league-blueprint/types.ts exports BlueprintView. Every field below is
required unless marked nullable; a nullable field is rendered as the stated
sentence, never as 0 or blank.

6.1 Inputs the loader assembles (lib/league-blueprint/data.ts)

In this order, after pulseLeagueCore has run for the league (the page's
getSyncedLeague) and pulseLeagueDerived has run with includePositionalWar
false and includeManagerLedger false:

- context = resolveLeagueContext(admin, league.metadata, sourceSlug). When
  coverage is "none" the page renders the empty state 9.17 and nothing else
  runs.
- cards = loadLeagueTeamCards(admin, leagueRowId, formatConfigId, sourceSlug,
  season, status, includePicks = isDynasty). mine = the requested roster.
- shareCard = loadTeamShareCard(... includePicks = isDynasty, isDynasty).
- pulse = loadPowerPulseView(...) (nullable; preseason or not built).
- war = loadPositionalWarView(...) (nullable).
- ledger = loadManagerLedgerView(...) (nullable; never computed here).
- finder = loadTradeFinderLeague(admin, {sleeperLeagueId, sourceSlug,
  identity}) for pick values, decimal ages, projPoints and the profile.
- signals = one read of player_value_signals for the roster's player ids and
  the format and source, plus the same for every other roster's players that
  end up as targets (one in() call per 200 ids).
- trends30 = a read of player_value_trends for the league's player ids with
  the 30-day fields (section 8.2).
- rawStarters = starterIdsFromRosterMetadata(mine roster.metadata) aligned
  with alignedStartingSlots(league roster_positions).
- idpEnabled = league_power_pulse_settings.settings.idp.enabled, read once
  here and passed down as a boolean.
- settings = loadBlueprintSettings(admin).
- spotlight inputs (6.13).

6.2 Grades (lib/league-blueprint/grades.ts)

Let T = teamCount. rankScore(rank) = (T - rank + 1) / T, in (0, 1].

Positional grade for P in QB, RB, WR, TE:
    valueScore  = rankScore(cards.positionRanks[P])
    pointsScore = pulse ? rankScore(pulse.mine.positionRanks[P]) : null
    score = pointsScore == null ? valueScore
          : w.value * valueScore + w.points * pointsScore     (w sums to 1,
            defaults 0.5 and 0.5)
    grade = clamp(round(score * 10), 1, 10)

Bench grade:
    valueScore  = rankScore(cards.statRanks.bench)
    depthScore  = pulse ? rankScore(pulse.mine.scoreDepthRank) : null
    same blend, same mapping.

Draft capital grade (dynasty only):
    grade = clamp(round(rankScore(cards.statRanks.picks) * 10), 1, 10)
    Redraft: null, rendered "Not scored in redraft".

Overall grade:
    weights default QB 1.0 (1.5 when derived.is_superflex), RB 1.0, WR 1.0,
    TE 0.75, bench 0.5, picks 0.5 (dynasty) or 0 (redraft).
    overall = sum(grade * weight) / sum(weight), one decimal.

Each grade carries a one-line "because": "3rd of 12 in running back value,
5th in projected running back points." built by gradeReason(P), used by the
page tooltip row and the share card footnote.

6.3 Archetypes and the two-year outlook (lib/league-blueprint/archetype.ts)

status = pulse ? pulse.mine.status : null. When null (preseason without a
Pulse cache), valueArchetype and outlook are null and the page says "Standing
is computed once the league's Power Pulse has run."

Value archetype (dynasty and keeper):
    competitor -> "Win now"
    loaded     -> "Loaded"
    middle     -> ageGap >= 0.5 and picksGrade >= 6 ? "One year reload"
                                                    : "Retool"
    rebuilder  -> "Rebuild"
Redraft: competitor and loaded -> "Contend", middle -> "In the hunt",
rebuilder -> "Longshot".

Roster archetype (every league):
    starterShare = cacheRow.starter_value / (starter_value + bench_value)
    "Top heavy"    when starterShare >= 0.80
    "Deep"         when starterShare <= 0.62
    "Well rounded" otherwise
Thresholds in settings.

Two-year outlook (dynasty and keeper only; redraft renders "One season at a
time: redraft has no next year to hold for."):
    nowWord: competitor, loaded -> "Contend"; middle -> "Reload";
             rebuilder -> "Rebuild"
    ageGap  = leagueMeanAge - mineMeanAge   (value-weighted, decimal years,
              from 6.4; positive means younger than the league)
    youngCoreShare = value of players aged <= 25 / total player value
    nextWord:
      now Contend: ageGap >= -0.5 ? "Contend" : "Reload"
      now Reload:  ageGap >= 0.5 and picksGrade >= 6 ? "Contend" : "Reload"
      now Rebuild: youngCoreShare >= 0.5 and picksGrade >= 7 ? "Reload"
                                                             : "Rebuild"
    reason: one sentence citing ageGap (one decimal), picksGrade and
    youngCoreShare as a percent.

6.4 Age profile (lib/league-blueprint/age.ts)

For each of QB, RB, WR, TE: value-weighted mean decimal age of this roster's
priced players at that position, and the same across every roster in the
league (the reference). Decimal age from computeAgeDecimal(birth_date, now),
where birth_date comes through finder FinderPlayer.age (already decimal). A
position with no priced player on the roster is null and reads "No priced
players". Output per position: {mine, league, gap, count}. Roster mean and
league mean are value-weighted across all four positions.

History write (decision 3.11): after a successful build, data.ts upserts
one row into league_roster_age_history for (league, roster, season,
as_of_day = today's Eastern date) carrying the four position pairs, the
counts, and the roster and league means, on conflict update. One row per
roster per day at most, written only for rosters somebody actually viewed.
Nothing reads it yet; the follow-up "Age over time" chart will.

6.5 Shares (lib/league-blueprint/shares.ts)

    valueShare = cacheRow.total_value / sum(total_value over all rosters)
    valueRank  = cacheRow.overall_rank
    productionShare = record.pointsFor / sum(pointsFor over all rosters)
    productionRank  = rank of pointsFor descending, ties by roster id
Preseason (sum of pointsFor == 0): productionShare null, rendered "No games
scored yet." Both shares are percentages to one decimal.

6.6 Risers and fallers (lib/league-blueprint/movers.ts)

Refactor lib/rankings/insights.ts so topMovers takes a MoverInput row
{slug, name, position, team, sleeper_id, value, value_ago, pct, rankChange,
show} instead of a board row, with a thin adapter boardRowToMoverInput kept
for the rankings page (its tests must still pass unchanged). The Blueprint
builds MoverInput rows for the roster's priced players from trends30
(window "30d": current_value, value_30d_ago, change_30d_pct,
rank_change_30d, show_trend_30d) and the floor is 5% of the FORMAT's top
value (read from the same trends set, max current_value over the league's
players is NOT the format top; use the rankings board top through
loadRankingsBoardCached is too heavy; so the floor uses max(current_value)
over player_value_trends for the format and source, one head query:
select current_value order by current_value desc limit 1).

Output: risers (up to 3) and fallers (up to 3), each {playerId, name,
position, team, value, pct, rankChange}, plus windowLabel "30 days". When
fewer than 7 of the roster's players pass the window gate, fall back to the
7-day window and say "7 days (30-day history is still building)".

6.7 Calls: buy, sell, hold (lib/league-blueprint/calls.ts)

Inputs per own priced player: value, starter (from rawStarters, not the
value-greedy fill), position, decimal age, projPoints, inSurplus
(profile.surplus contains him), replacementCost (profile.replacementCost),
market signal (6.1 signals; null when absent), trend30 pct, isInactive.
Direction = profile.direction.

Age cutoffs (settings): QB 33, RB 28, WR 30, TE 30.

Roster call, decided first:
    "cut"         non-starter, in dropCandidateIds (3 lowest value
                  non-starters), and (redraft, or value < DYNASTY_KEEP_VALUE)
    "sell"        inSurplus, or (direction rebuild and age >= cutoff and
                  value >= DYNASTY_KEEP_VALUE)
    "build"       starter and value rank within the roster's top 3 and
                  (direction != rebuild or age < cutoff)
    "hold"        everything else

Market overlay:
    signal in {sell, watch_sell}  -> marketLean "sell"
    signal in {buy, watch_buy}    -> marketLean "buy"
    else                          -> null

Final call and strength:
    roster sell  + marketLean sell -> "Sell", strength "hard", note
                                      "Value is at the top of his 30-day band."
    roster sell  + otherwise       -> "Sell", strength "soft"
    roster hold  + marketLean sell + age >= cutoff -> "Sell", "soft", note
                                      "Aging and priced high: a sell-high window."
    roster build + any             -> "Build around" (a market sell lean adds
                                      the note "Priced high right now; this is
                                      still a keep.")
    roster cut   + any             -> "Cut candidate"
    roster hold  + marketLean buy  -> "Hold", note "Priced low versus his own
                                      30-day band: do not sell now."
    roster hold  + otherwise       -> "Hold"

Buy targets (other rosters), per position of need (profile.positionNeed[P]
>= NEED_MIN points per week, default 1.0, ordered by need descending, at
most 3 positions): candidates = acquirablePool for that position restricted
to players whose owner is not the reader, excluding IR and taxi, value
between 0.6 and 1.6 of the reader's best outgoing surplus value (or any value
when surplus is empty). Rank by: marketLean buy first, then projPoints
descending. Take 2 per position. Strength: "hard" when the market signal is
buy or watch_buy, "soft" otherwise. Each target carries the owner's handle
and a proposalHref into the builder with that player incoming and nothing
outgoing (the builder lets the reader fill the other side).

Defenders and specialists: no call, label "No market value".

6.8 Trade activity gauge (lib/league-blueprint/activity.ts)

Over the roster's priced players (N):
    sellShare = count(call in Sell, Cut candidate) / N
    needShare = count(positions with positionNeed >= NEED_MIN) / 4
    divergence = clamp(|pulse.mine.rankDivergence| / (T / 2), 0, 1)
                 (0 when pulse is null)
    activity = round(100 * (0.40 * sellShare + 0.30 * needShare
                            + 0.30 * divergence))
Band: "Low" < 34, "Moderate" 34 to 66, "High" > 66. Weights and bands in
settings. The sentence under the gauge is built from the largest term:
"Driven mostly by N players worth selling." or "Driven mostly by needs at RB
and TE." or "Driven mostly by the gap between value rank 3 and Pulse rank
9."

Split percentages, over the same N: sells% = Sell + Cut, builds% = Build
around, holds% = Hold. Buys are NOT a share of the roster; the card prints
"Buy targets: K across P positions" beside the three percentages.

6.9 Top priorities (lib/league-blueprint/priorities.ts)

Candidates, each with a condition, a priority weight and a template. All
figures come from the view model; a null figure disables the candidate. The
three highest-weight firing candidates are shown, in weight order.

    P1 weight 100  weakest positional grade <= 4
       "Fix {position}: graded {grade} of 10, {rank}th of {T} in value."
    P2 weight 90   needShare > 0 and direction win-now
       "Upgrade {position}: the lineup is {need} points a week short there."
    P3 weight 85   sellShare >= 0.25 and direction rebuild
       "Sell {count} veterans while they still start: {names}."
    P4 weight 80   ledger.efficiency < 0.90 and gradedWeeks >= 4
       "Set better lineups: {pointsLeftPerWeek} points a week left on the
        bench, {efficiencyRank}th of {T}."
    P5 weight 75   benchGrade <= 4 and direction win-now
       "Add depth: bench value ranks {benchRank}th of {T}."
    P6 weight 70   picksGrade >= 8 and direction win-now
       "Spend draft capital: {seasons} picks rank {picksRank}th of {T} and a
        contender does not need them."
    P7 weight 65   ageGap <= -1.5 and direction != rebuild
       "Get younger: the roster averages {mineAge}, {gap} years older than
        the league."
    P8 weight 60   activity band Low
       "Hold steady: no move on this roster is worth making for its own
        sake."
    P9 weight 55   risers.length >= 2 and direction rebuild
       "Ride the risers: {names} gained {pct} in 30 days."
    P10 weight 50  fallback, always fires
       "Keep the core: {buildNames} are the players this team is built on."

6.10 Trade strategy board (lib/league-blueprint/strategy.ts)

One findTrades run with the page's identity, strategy "value" when isDynasty
and status key rebuilder, else "contender" (the same default Trade Ideas
uses), no goal, excludeKeys from lib/trade-finder-declines for signed-in
readers. Classify every suggestion:

    downtier: outgoing.length == 1 and incoming.length >= 2
    uptier:   outgoing.length >= 2 and incoming.length == 1
              and incomingTop.value >= TIER_JUMP * outgoingTop.value
    pivot:    outgoing.length == 1 and incoming.length == 1
              and incoming[0].position != outgoing[0].position
              and |valueGap| <= 0.12 * outgoing[0].value

Take the highest-score suggestion per shape. For an empty shape run
findTrades once more with goal "split-assets" (downtier) or "consolidate"
(uptier); pivot has no goal and stays empty when the base run had none. At
most three runs per build. Grade the chosen ones with gradeAssetPairs in one
batch. Each card: shape label, the headline from explain.ts, incoming and
outgoing names with positions, the grade verdict and confidence, winsDelta
and valueDelta for the reader, acceptance, and a proposalHref into the
builder. An empty shape renders "No {shape} worth proposing this week." and
the reason from the finder notice when present.

Shape copy:
    downtier: "Downtier: one star out, two starters back."
    uptier:   "Uptier: two pieces out, one difference-maker in."
    pivot:    "Pivot: one for one at a position you need."

6.11 Ideal trade partners (lib/league-blueprint/partners.ts)

For every other roster R with a profile:
    needFit    = sum over P of min(mine.positionNeed[P], surplusPoints(R, P))
    giveFit    = sum over P of min(R.positionNeed[P], surplusPoints(mine, P))
    direction  = 1.0 when directions are opposite (win-now vs rebuild),
                 0.5 when one is balanced, 0.25 when the same
    tendency   = signed-in and tendencies loaded ? (appetiteScore for the
                 position of my largest need, mapped from [-1, 1] to [0, 1])
                 : 0.5
    fit = 0.40 * norm(needFit) + 0.30 * norm(giveFit) + 0.20 * direction
        + 0.10 * tendency
where surplusPoints(R, P) is the sum of replacementCost for R's surplus
players at P, and norm divides by the league max of that term (0 when the
max is 0). Top 2 by fit, ties by roster id. Each card: team name, owner
handle, status label, a one-line reason naming the largest term ("They have
RB depth to spare and need a QB; you have the opposite."), and a link to
/trade-ideas?mode=build&with=R. Fewer than 2 rosters with a profile renders
"Not enough priced rosters to name a partner."

6.12 Draft capital by season (lib/league-blueprint/capital.ts)

Dynasty and keeper only. From finder.myTeam.picks grouped by season (the
current season's picks are already stripped after the draft by
loadLeagueTeamCards; the finder keeps the same rule). Per season: the pick
labels in order (round then slot, "1.05" style labels from FinderPick.label,
with "via @handle" when not own), the summed value, and the league rank of
that season's summed value computed across every roster's picks. Picks with
hasValue false are listed and counted but add 0 and the season says "N picks
unpriced". Footnote "Draft pick values powered by {pickSource.display}" when
context.pickSource is non-null. Redraft: the section renders one sentence,
"Redraft leagues hold no future picks."

6.13 Spotlight (lib/league-blueprint/spotlight.ts)

In season with at least one settled week: the roster's top scorer of the
latest settled week, read through lib/league-leaderboards/load.ts
loadLeaderboardsCached for that week filtered to this roster, with his
points, his projection for that week from league_power_pulse_cache.weekly
when present (else "no projection"), and the signed difference. Preseason or
no settled week: the roster's top riser from 6.6, or when there is none, the
roster's most valuable player with his position rank. The card always says
which of the three it is showing.

6.14 Lineup and depth (lib/league-blueprint/build.ts assembles these from
inputs; no module of their own)

lineup: one entry per aligned starting slot {slotLabel, slotDescription,
player (nullable for an empty "0" slot), value (nullable for a defender),
positionRank (nullable), call (6.7)}. depth: the roster grouped by position
in shareCard order, each player with value, positionRank, call, and the
starter mark, then IR and taxi listed from rosters.reserve_ids and
rosters.taxi_ids (read in data.ts; they are not in TeamCardData today).

6.15 Header fields

teamName, ownerHandle (Sleeper display name), avatar URL, record and
pointsFor, formatTags from buildLeagueFormatTags, sourceDisplay,
formatDisplay, generatedAt (ISO; rendered through formatEastern), season,
status label and phrase, valueArchetype, rosterArchetype, outlook.

---------------------------------------------------------------------------

## 7. Storage: migrations 0340 to 0342

Every migration carries the access matrix comment at its top, enables RLS,
and ships its policies in the same file. After each: apply through MCP, query
pg_policies, regenerate types to lib/database.types.ts, run prettier on it.

7.1 Migration 0340_league_blueprint_settings.sql

    create table league_blueprint_settings (
      id text primary key default 'global' check (id = 'global'),
      settings jsonb not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      updated_by uuid references auth.users(id)
    );
    RLS on; policy league_blueprint_settings_service_role_all for service_role
    using (true) with check (true); no anon or authenticated policy.

7.2 Migration 0341_league_blueprint_cache.sql

    create table league_blueprint_cache (
      id uuid primary key default gen_random_uuid(),
      league_id uuid not null references leagues(id) on delete cascade,
      roster_id integer not null,              -- Sleeper roster_id
      season text not null,
      format_config_id uuid not null references format_configs(id),
      source text not null,
      view jsonb not null,                     -- BlueprintView
      fingerprint text not null,
      model_version integer not null,
      generated_at timestamptz not null default now(),
      unique (league_id, roster_id, season, source)
    );
    index on (league_id, generated_at desc).
    RLS on; service_role all; no other policy. The page writes it through the
    admin client; both image routes read it through the admin client.
    Prune: the existing /api/cron/league-maintenance run gains one delete of
    rows older than 14 days (one statement, no iteration).

    Also in 0341 (decision 3.11):

    create table league_roster_age_history (
      id uuid primary key default gen_random_uuid(),
      league_id uuid not null references leagues(id) on delete cascade,
      roster_id integer not null,
      season text not null,
      as_of_day date not null,
      ages jsonb not null,   -- {QB:{mine,league,count}, RB:..., WR:..., TE:...,
                             --  roster: number, league: number}
      unique (league_id, roster_id, as_of_day)
    );
    index on (league_id, roster_id, as_of_day desc).
    RLS on; service_role all; league_roster_age_history_select_public for
    anon and authenticated (it is derived league data, the same class as
    league_power_rankings_cache). Prune: rows older than 730 days, one
    statement in league-maintenance.

7.3 Migration 0342_market_signals.sql

    create table player_value_signals (
      player_id uuid not null references players(id) on delete cascade,
      format_config_id uuid not null references format_configs(id),
      source text not null,
      as_of_day date not null,
      market_value numeric not null,
      mean_30 numeric, stdev_30 numeric,
      band_upper numeric, band_lower numeric,
      band_pct numeric, bandwidth numeric,
      points_in_window integer not null,
      signal text not null check (signal in
        ('buy','watch_buy','hold','watch_sell','sell','baseline','thin')),
      previous_signal text,
      signal_since date,
      model_version integer not null,
      computed_at timestamptz not null default now(),
      primary key (player_id, format_config_id, source)
    );
    index on (format_config_id, source, signal) where signal in ('buy','sell');
    index on (format_config_id, source, band_pct);

    create table player_value_signal_changes (
      id uuid primary key default gen_random_uuid(),
      player_id uuid not null references players(id) on delete cascade,
      format_config_id uuid not null references format_configs(id),
      source text not null,
      changed_on date not null,
      from_signal text,
      to_signal text not null,
      market_value numeric not null,
      band_pct numeric,
      unique (player_id, format_config_id, source, changed_on)
    );
    index on (player_id, format_config_id, source, changed_on desc).

    create table market_signal_runs (
      id uuid primary key default gen_random_uuid(),
      format_config_id uuid not null references format_configs(id),
      source text not null,
      as_of_day date not null,
      rows_written integer not null,
      changes_written integer not null,
      duration_ms integer not null,
      ran_at timestamptz not null default now(),
      unique (format_config_id, source, as_of_day)
    );

    create table market_signal_settings (
      id text primary key default 'global' check (id = 'global'),
      settings jsonb not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      updated_by uuid references auth.users(id)
    );

    Policies: player_value_signals_select_public and
    player_value_signal_changes_select_public (select for anon and
    authenticated using (true)); *_service_role_all on all four tables;
    market_signal_runs and market_signal_settings have no public policy.

These are derived tables (pre-calculated from internal data) so they carry no
metadata column, per the Data Architecture section of CLAUDE.md. The names
are FF Beacon native: "value signal", not "exchange" or "ktc".

7.4 Database size discipline (decision 3.13)

The owner's constraint: every active source is computed, but nothing here may
grow the database the way per-day band columns would have. The sizes below
are the design, and the builder checks them against reality in BP-T020.

    Table                          Growth rule                 Expected size
    player_value_signals           latest only, one row per    about 20,000
                                   priced player x partition;  rows, fixed
                                   overwritten nightly
    player_value_signal_changes    one row per state change    about 600 rows
                                   only (roughly 3% of rows    a day, 30 MB a
                                   change state on a day)      year; pruned
                                                               past 730 days
    market_signal_runs             one row per partition per   20 rows a day;
                                   day                         pruned past 90
                                                               days
    league_blueprint_cache         one row per VIEWED roster   20 to 40 KB a
                                   per source; rebuilt in      row; pruned
                                   place                       past 14 days
    league_roster_age_history      one small row per viewed    under 1 KB a
                                   roster per day              row; pruned
                                                               past 730 days
    player_value_history           UNCHANGED. No band columns, no flags, no
                                   extra rows. Ever.

Rules that keep it that way:

- Bands are never stored per day. The profile chart recomputes them from the
  series it already loads with the same pure function.
- The signals row stores numerics rounded to 3 decimals (band_pct,
  bandwidth) and 1 decimal (values); jsonb is not used on hot tables.
- Prunes are one DELETE each, by a date column with an index, and run from
  the existing league-maintenance cron (blueprint cache, age history) or at
  the end of a COMPLETE market-signals run (changes, runs). No cron iterates
  rows.
- A partition with fewer than 25 priced players on its latest day is skipped
  as too thin to signal (a source that covers a format barely). Logged in
  market_signal_runs with rows_written 0 so the admin page shows why.
- The blueprint view stores player names and values once per player; the
  lineup and depth sections reference players by id and the page joins in
  memory. (This is what keeps a row under 40 KB.)
- BP-T020 records the real row counts and bytes for the five tables after the
  first week in progress.md, and the admin market-signals page shows the
  current counts from pg_stat_user_tables through one admin-only read.

---------------------------------------------------------------------------

## 8. Loader, cache policy, fingerprint, rate limits

8.1 lib/league-blueprint/cache.ts

    BLUEPRINT_TTL_MS = 12 hours (settings cache.ttlHours, default 12)
    BLUEPRINT_MODEL_VERSION = 1 (code constant, bumped on formula change)

    buildFingerprint(input): sha1 of a JSON array of
      [sorted roster player_ids, league_power_rankings_cache.generated_at for
       (format, source), league_power_pulse_cache.generated_at (or null),
       league_positional_war_cache.generated_at (or null),
       league_manager_ledger_cache.generated_at (or null),
       max(player_value_signals.computed_at) for (format, source) (or null),
       league.through_week (or null), settings.version, BLUEPRINT_MODEL_VERSION]

    All of those are head reads or single-row selects: the warm path is six
    small queries and no engine, the same split lib/league-positional-war.ts
    makes. The stored row is fresh when fingerprint matches AND generated_at
    is within the TTL; else rebuild. A rebuild that throws leaves the old row
    in place and renders it with an "as of" line plus the sentence "The
    latest rebuild failed; showing the previous blueprint." (status 200).

8.2 Trends read

lib/league-view-data.ts loadTrends selects 7-day fields only. Add an
optional {window: "30d"} parameter that ALSO selects value_30d_ago,
change_30d, change_30d_pct, rank_change_30d, show_trend_30d. Existing
callers pass nothing and are unchanged. The Blueprint passes the option.

8.3 Request coalescing

The rebuild is wrapped in lib/request-coalesce.ts coalesce keyed on
"blueprint:" + leagueRowId + ":" + rosterId + ":" + source, so two tabs or the
page plus a hover prewarm share one build.

8.4 Rate limit (lib/league-blueprint/rate-limit.ts)

    claimBlueprintBuildSlot(actorKey): bucket "blueprint-build", 12 per 60
    seconds, through lib/rate-limit-claim.ts (fails closed).
Claimed only when the cache is stale and a rebuild is going to run, after the
roster id is validated and the league found. A refusal renders the stale row
when one exists (with the "as of" line) or the 9.17 "Try again in a minute"
state when none does. The findTrades run inside the build does NOT also
claim the trade-impact-suggest bucket; one bucket per page, and the Blueprint
is its own page.

8.5 What is never done here

No call to pulseLeague from an image route. No compute of Power Pulse,
Positional WAR or the Manager Ledger. No per-candidate optimizer rerun. No
language model. No cron that iterates leagues.

---------------------------------------------------------------------------

## 9. The page, section by section

File: app/leagues/[league_id]/blueprint/page.tsx. export const dynamic =
"force-dynamic". Structure copied from app/leagues/[league_id]/leaderboards/
page.tsx: getSyncedLeague (cached), generateMetadata, LeagueShell, an intro
section, then one Suspense boundary around the body with a BodySkeleton
fallback. The body awaits loadBlueprint (which handles cache, rebuild and
rate limit) and renders the sections below in this order. Every section is a
Panel (components/dashboard-panel.tsx) with headingLevel 2 unless stated;
the page's h1 is the masthead's.

9.1 Intro (outside Suspense). Eyebrow "Team Blueprint". h2: "{teamName}:
the plan". Lede: "Where this team stands, what it is built from, and the
moves worth making, from the league's own numbers as of {formatEastern}."
Below it the share strip (9.14) renders only when a cached view exists;
otherwise it renders after the body builds (it is inside the body in that
case).

9.2 Controls. The roster select from LineupControls (extract the select and
its label into components/league-lineups/roster-select.tsx with the same
CONTROL classes; LineupControls imports it so nothing changes there). The
bar is sticky like the Lineups bar. Changing it pushes ?roster=N with
withUsername. A source switch is the header's existing toggle.

9.3 Standing (Panel "Standing", glow). Hero StatTile size "hero": the
overall grade to one decimal, label "Overall grade", sub "of 10". Beside it
(grid sm:grid-cols-[auto_1fr]): the status label and phrase in text-ink with
the reason in text-ink-muted; three readouts (StatReadout) in a row: Value
archetype, Roster archetype, Outlook ("Contend, then Reload" with the reason
sentence under it). Redraft outlook renders its sentence. Preseason without
Pulse renders the sentence from 6.3 in place of the archetype.

9.4 Grades (Panel "Grades by position"). Six GradeRing components in a
grid grid-cols-3 sm:grid-cols-6, one per QB, RB, WR, TE, Bench, Draft
capital. Each ring is an SVG role="img" with aria-label "{Position noun}
grade {n} of 10" plus the visible numeral inside the ring in font-mono
text-2xl font-black tabular-nums; under it the label in the eyebrow style.
Below the grid, a DataTable (sr-only caption "Why each grade") under a
details disclosure listing position, grade, value rank, projected points
rank. The ring geometry is lib/league-blueprint/ring-geometry.ts (also used
by the share image).

9.5 Starting lineup (Panel "Starting lineup", bodyClassName "p-0"). A table
with scope="col" headers: Slot, Player, Value, Pos rank, Call. Row header is
the slot (th scope="row") whose accessible name is the spelled-out slot
only, per the CLAUDE.md lineups rule. Value is one text node with " value"
sr-only appended; defenders read "No market value". The call is a CallTag
(9.18). Empty slot reads "Empty". Below sm the table keeps every column; the
Player cell stacks name over team and position in two lines and Value and
Pos rank share one cell as "1,234 / WR12" (one text node, sr-only "value",
"position rank"). Nothing is hidden.

9.6 Depth (Panel "Depth"). Four columns (grid-cols-2 sm:grid-cols-4) of
position lists; each row: name, value, pos rank, call tag, starter mark "ST"
with sr-only "starter". Then "Injured reserve" and "Taxi squad" lists when
non-empty. Defenders and specialists in a fifth group "Defense and
specialists" with "No market value".

9.7 Shares (Panel "Share of the league"). Two StatTiles side by side
(default size, NOT hero; the hero is in 9.3): "Value share" 14.2% with sub
"3rd of 12", "Production share" 9.8% with sub "6th of 12", each with a share
bar under it (track h-1.5 rounded-full bg-ink/[0.07], fill bg-beacon). Null
production renders the sentence.

9.8 Age profile (Panel "Age by position"). ChartFigure (titleLevel 3) with
an SVG bar pair per position (mine in SERIES_A, league in SERIES_B) from
lib/league-blueprint/age-geometry.ts, a SeriesLegend, an sr-only summary
sentence ("Running backs average 24.1, 1.3 years younger than the league.")
and the DataTable under the disclosure with position, team age, league age,
gap, players counted.

9.9 Movers (Panel "Risers and fallers, 30 days"). Two lists (grid
sm:grid-cols-2), h3 "Rising" and "Falling", each row: name, position, value,
TrendChip. Empty list reads "Nothing moved more than the floor." The window
fallback sentence from 6.6 shows under the title as the helper.

9.10 Calls (Panel "Buy, sell, hold", glow). Top: the Gauge (role="img",
aria-label "Recommended trade activity: {band}, {n} of 100") drawn from
lib/league-blueprint/gauge-geometry.ts with the band word as the hero figure
(text-3xl sm:text-4xl font-mono font-black, bg-beacon bg-clip-text
text-transparent) and the driver sentence under it; then three StatReadouts:
Sells %, Builds %, Holds %, and the "Buy targets: K across P positions"
line. Below: three lists. "Sell" (hard first, then soft, each with its
note), "Build around", "Hold" (the holds with a note first). Then "Buy
targets" grouped by position: name, owner handle, value, strength, "Open in
builder" link. Cut candidates are a fourth list titled "Cut candidates" with
the dynasty keep note when it applies.

9.11 Draft capital (Panel "Draft capital"). One row per season: season as
the row heading (h3), summed value as the row figure (font-mono text-2xl
font-black tabular-nums), rank sub-line, the pick labels as a comma list.
Redraft renders the sentence. Footnote for the pick source.

9.12 Priorities (Panel "Top priorities"). An ol of three items; the first
is the hero of the section: text-lg sm:text-xl font-bold text-ink; the second
and third text-base text-ink-muted. Numerals in RankMark style (1 to 3
gradient).

9.13 Trade strategy and partners (Panel "Trade strategy"). Three cards in
grid gap-4 lg:grid-cols-3, one per shape, each an article with h3 the shape
label, the headline, outgoing and incoming as two short lists with a
"for" between, the grade verdict with confidence, the reader's wins and
value deltas as readouts, acceptance, and a link "Open in builder". Empty
shape: the sentence. Below the cards, h3 "Ideal trade partners": two cards
with team name, handle, status, reason, link.

9.14 Share strip. Extract the matchup page's ShareStrip into
components/share-strip.tsx with props {imageHref, imageDescription,
imageLinkAriaLabel, pageHref, pageAriaLabel, heading = "Share"}. The matchup
page, the leaderboards page and this page all use it (decision 3.15). On
this page: Copy image uses the portrait
/share route; Copy image link prewarms it; Copy page link copies the
canonical page URL.

9.15 Spotlight (Panel "Spotlight"). One card: avatar through the existing
PlayerAvatar from season-pulse/bits.tsx, name, the figure (points, or pct,
or value) as the row figure, the comparison line, and the label of which
spotlight it is.

9.16 Footnotes (a plain section, text-xs text-ink-muted): source display
name and format display; "Draft pick values powered by {pickSource}" when
set; "Defenders carry no market value and receive no call."; "Grades are
league relative: 10 is the best of {T} teams."; "Market signals compare each
player with his own last 30 days of {sourceDisplay} values."; the as-of
time; "Not a promise about any player; the league's numbers as they stand."

9.17 States

- coverage "none": the intro plus one Panel: "{sourceDisplay} has no values
  for this league's format. Pick another source in the header."
- No roster found: notFound() (the layout's 404).
- Cache miss and rate limited: Panel "Try again in a minute" with the
  sentence "Too many blueprints were built from here in the last minute."
- Rebuild failed with an old row: render the old row with the 8.1 sentence
  in the intro.
- Loading: BodySkeleton with aria-busy and a role="status" sentence, the
  leaderboards pattern.

9.18 CallTag (components/league-blueprint/call-tag.tsx). A span, not a
button. Classes: inline-flex items-center rounded-md px-2 py-0.5 text-[11px]
font-bold uppercase tracking-[0.12em]. Colors by call: Sell
bg-signal-warning/15 text-signal-warning; Build around bg-brand-purple/15
text-brand-purple-light; Hold bg-ink/[0.07] text-ink-muted; Cut candidate
bg-signal-danger/15 text-signal-danger; buy target strength chip
bg-signal-positive/15 text-signal-positive. The visible text is the full
word ("Sell", "Hard sell" when strength hard); color never carries meaning
alone. The note, when present, renders as text beside it, not a tooltip.

9.19 Components folder: components/league-blueprint/ holds standing-panel,
grade-rings, lineup-table, depth-lists, shares-panel, age-chart,
movers-panel, calls-panel, gauge, capital-panel, priorities-panel,
strategy-panel, partners-list, spotlight-card, call-tag, body-skeleton. All
server components except gauge and the charts are also server (SVG in
JSX); nothing here needs client state except the roster select, which is
already a client component.

---------------------------------------------------------------------------

## 10. Design specification

This section is the owner's answer to "AI slop" and the builder follows it
to the letter. The site ships ONE theme (dark); do not write dark: variants
or a light palette.

10.1 The hierarchy rule: one figure leads

Every section has at most ONE hero figure, a small number of secondary
figures, and the rest in a list or table. The leaderboards feature is the
model (components/league-leaderboards/podium.tsx, top-tier.tsx,
leader-row.tsx; components/manager-pulse/stat-tile.tsx).

    Hero figure (one per section):
      font-mono font-black tabular-nums leading-none text-4xl sm:text-5xl
      color: text-brand-cyan inside a StatTile hero, or
             bg-beacon bg-clip-text text-transparent when it stands alone
      label above it: text-[11px] font-semibold uppercase tracking-wide
             text-brand-cyan
      sub line under it: font-mono text-[11px] tabular-nums text-ink-subtle
    Secondary figure (up to four per section):
      font-mono text-2xl font-black tabular-nums text-ink
      label: text-[10px] font-semibold uppercase tracking-wide text-ink-subtle
    List or row figure:
      font-mono text-base font-extrabold tabular-nums text-ink sm:text-lg
      row sub-figures: whitespace-nowrap font-mono text-[11px] tabular-nums
             text-ink-subtle
    Rank numerals: RankMark classes from leader-row.tsx; 1 to 3 gradient,
      the rest text-ink-subtle.

On this page the heroes are: Standing = overall grade; Calls = the activity
band word; Shares = none (two equal secondaries, on purpose); Grades = none
(six equal rings; the overall lives in Standing); Priorities = the first
priority sentence; Draft capital = none (per-season row figures); Spotlight
= the player's figure.

10.2 Panels, surfaces, lines

- Section container is Panel: rounded-modal border border-line
  bg-surface/50, header band bg-surface-elevated/50, eyebrow with the
  gradient tick, h2 text-[17px] font-bold tracking-tight. Use glow on at
  most two panels (Standing and Calls).
- Inside a panel, inner cards are rounded-card border border-line
  bg-base/40. No nested shadow. No card inside a card inside a card.
- Hairlines, not shadows. The only glow is the panel glow prop.
- Gradient (bg-beacon) appears on: the masthead title (already there), the
  hero figures, the rank numerals 1 to 3, the share bar fills, and the top
  3px bar of the first partner card. Nowhere else. "Vibrant colors must
  earn their use" (plan.md section 2).
- Semantic colors (signal-positive, signal-warning, signal-danger) mean
  good, caution, bad and never decorate.
- Position colors come from the position chip only.

10.3 What is banned on this page (the slop list)

- An icon on every card, or any icon used as decoration. Icons appear only
  on buttons that already have them (copy, link) and in the nav rail.
- A grid of identical cards each with an icon, a title and a sentence.
- Centered everything. Text is left aligned; figures right align in tables.
- Gradient backgrounds on cards, gradient borders, glass blur on cards (the
  sticky controls bar is the one existing exception).
- Emoji anywhere. Medal colors. Trophies.
- Placeholder copy, "Lorem", "Coming soon", "AI-powered", "insights",
  "unlock", "elevate", "seamless", "leverage", "game-changing", "supercharge".
- Sentences that do not name a number when a number exists.
- Three-item rhythmic lists in copy for their own sake.
- Rounded pills for data that is not a state. A value is a number, not a
  pill.
- Progress rings for things that are not proportions. The grade ring is a
  proportion of 10 and is allowed; a ring around a dollar value is not.
- Tooltips as the only place a figure's meaning is explained. Explanations
  are text in a disclosure.
- Equal-weight typography. If two numbers sit side by side and one matters
  more, it is bigger.
- Skeleton screens that do not match the final layout's shape.

10.4 Type and spacing

- Section spacing: the body is mt-6 space-y-6; two-column groups use grid
  items-start gap-6 xl:grid-cols-2 (Shares beside Age; Movers beside
  Spotlight; Draft capital beside Priorities). Everything else full width.
- PageBody width "tool" (max-w-[90rem]).
- Running copy text-sm leading-relaxed text-ink-muted, at most 2xl wide.
- Numbers always font-mono tabular-nums. Points one decimal, values with a
  thousands separator, percentages one decimal, ages one decimal, grades
  integer (overall one decimal).
- Headings: h2 in Panel, h3 text-[11px] font-bold uppercase tracking-
  [0.14em] text-ink-subtle for sub-lists, h3 text-sm font-semibold text-ink
  for cards that carry a figure.

10.5 Motion

transition 180ms on hover color only. No entrance animations. Skeleton
animate-pulse with motion-reduce:animate-none.

10.6 The share images follow the same hierarchy in OG units (section 11).

---------------------------------------------------------------------------

## 11. Share images

11.1 Common

Both routes: runtime "nodejs"; validate league id and roster id (digits
only, 1 to 20 characters for the league, 1 to 3 for the roster) and return
a plain 400 otherwise; 308 any unknown query to canonical; admin client
reads leagues (id, name, season, status, metadata) then
league_blueprint_cache for (league, roster, season, source) with source
resolved through resolveLeagueContext(admin, metadata, ?source) so the
stored row for the right source is picked; a missing league returns a 404
through renderHeadlineCard("League not found") with max-age=0, s-maxage=60;
a missing cache row returns status 200 renderHeadlineCard with eyebrow "Team
Blueprint", headline "{teamName}" (from rosters plus league_users when
readable, else "This team"), subhead "Open the blueprint page to build it,
then share.", cache public, max-age=60, s-maxage=300. Success cache: public,
max-age=300, s-maxage=3600, stale-while-revalidate=86400. Fonts OG_FONTS
(weights 500 and 900 only). Root OG_ROOT_STYLE, OgAccentBar, OgBrandMark
bottom left, "ffbeacon.com" bottom right. Brand check: no gold, no #0c0c18,
no DPC wording; a route test asserts the rendered element tree's strings.

Headshots: loadRemoteImages over sleeperPlayerImageUrl for at most 12
players (the lineup) on the portrait card, 3 on the preview; a missing image
renders the position code in a box tinted with OG_POSITION_COLORS.

11.2 Preview, 1200 x 630 (app/api/og/blueprint/[league_id]/[roster_id]/route.tsx)

Layout (px): left column 0 to 720, right column 760 to 1160, top padding
56, bottom band 90.
- Left: eyebrow "TEAM BLUEPRINT" (weight 900, 22px, cyan, letter spacing
  0.18em); team name through fitText(maxSize 64, minSize 36, maxLines 2,
  weight 900); under it the status label, value archetype and roster
  archetype as three pills (border line, 20px, weight 500); under them the
  first priority sentence (28px, weight 500, ink, maxLines 2 through
  fitText).
- Right: the overall grade as the hero (160px, weight 900, gradient fill
  via OG_GRADIENT background-clip), label "OVERALL" above, "of 10" under;
  below it the six grade rings at 64px each in one row with the position
  code under each (lib/league-blueprint/ring-geometry.ts rendered as an SVG
  string, svgToDataUri, one img).
- Bottom band: brand mark, "{formatDisplay} values by {sourceDisplay}, as of
  {formatEastern}" (18px, ink-subtle), wordmark.

11.3 Portrait, 1080 wide (app/api/og/blueprint/[league_id]/[roster_id]/share/route.tsx)

Height is computed by lib/league-blueprint/share-layout.ts (pure, tested):
the sum of the section heights below plus 48px gaps, so an IDP league with
more slots gets a taller card rather than a clipped one. Order and heights:

    header       200   team name (fitText 56/36, 2 lines), handle, record,
                       format tags as pills, status, archetypes, outlook
    grades       220   overall hero 140px at left, six rings 72px at right
    lineup       52 x slots + 60   one row per slot: slot code (mono 22 ink-
                       subtle), headshot 40, name 26 weight 500, value mono
                       26 weight 900 right aligned, pos rank 20 ink-subtle,
                       call pill
    shares       150   two figures (value share, production share) 64px
                       mono 900 with rank sub-lines, share bars under each
    calls        260   gauge arc (gauge-geometry.ts SVG, 300 x 170) with the
                       band word 40px under it, sells/builds/holds as three
                       figures, then two columns: top 3 sells, top 3 buy
                       targets, names only with position codes
    movers       150   risers and fallers, up to 3 each, name and pct
    capital      110 + 40 x seasons   (dynasty only; redraft: the sentence)
    priorities   180   three sentences, first at 30px weight 900, others 24
                       weight 500
    strategy     260   three rows, one per shape: label, "out" names, "for",
                       "in" names, verdict; empty shape: the sentence
    partners     110   "Ideal partners: {name} ({handle}), {name} ({handle})"
    footer       100   brand mark, source and format line, as of, wordmark,
                       "Defenders carry no market value." when any defender
                       is rostered

Every text run that could overflow goes through fitText or displayName.
Pills: border 1px OG_COLORS.line, radius 999, padding 6 14, 20px weight 500.
Position color only on the position code text. Gradient only on the overall
hero and the three rank numerals. Nothing else from the sheets' styling.

11.4 describeBlueprint(view) (lib/league-blueprint/share.ts)

One sentence for CopyImageButton's description: "{teamName}'s blueprint:
overall grade {n} of 10, {status}, {valueArchetype}; first priority: {P1}."

11.5 Prewarm: the page's Copy image link button passes prewarmHref for the
portrait route; the preview route is requested by crawlers only.

---------------------------------------------------------------------------

## 12. Player profile badge and other Market Signals surfaces

12.1 lib/market-signals/read.ts

    loadPlayerSignal(supabase, playerId, formatConfigId, source):
      PlayerValueSignalRow | null
    loadSignalsFor(supabase, playerIds[], formatConfigId, source):
      Map<playerId, row>, chunked 200 ids per in().
    loadSignalChanges(supabase, playerId, formatConfigId, source, limit 12)
Both wrapped in React cache() for a render.

12.2 Profile badge (components/player-profile/market-signal-badge.tsx)

Placed in the OverviewSidebar "Value trend" panel beside the TrendChip, not
in the hero badge row (the hero names identity and role; the market panel is
where the value lives). Server component. Props {signal: row | null,
sourceDisplay}. Renders a span with the status chip classes from 2.10 and
the color by state: buy and watch_buy signal-positive; sell and watch_sell
signal-warning; hold ink-muted; baseline and thin ink-subtle. Visible text:
"Buy window", "Near a buy window", "Hold", "Near a sell window", "Sell
window", "Building baseline ({points} of 30 days)", "Thin market". Its
accessible name is the visible text plus " since {date}" when signal_since
is set. Beside it a details disclosure "Why this signal" (the chart-kit link
style summary) containing: "{sourceDisplay} value {market_value} against a
30-day band of {lower} to {upper}; band position {band_pct as percent}." and
a two-row DataTable of the last three changes from loadSignalChanges, dates
through formatEastern (date only). A null row renders nothing (no empty
chip).

12.3 Bands on the value chart

components/player-profile/value-trend-chart.tsx gains an optional bands prop
computed in lib/player-profile.ts from the loaded series with
lib/market-signals/bollinger.ts rollingBands(series, 30) (a pure helper that
returns upper and lower per day once 24 points exist). Drawn as a translucent
band (SERIES_A at 12% opacity) under the value line, with the legend entry
"30-day band". The chart's data table gains two columns. Same function as
the cron, so the chart and the badge agree by construction; a test asserts
that rollingBands' last row equals the cron's row for a fixture series.

12.4 Future: Beacon Exchange (not built by this plan)

A /market page listing buy and sell windows per format and source would read
player_value_signals through the two partial indexes above, show the
distribution of band_pct per position, and link to profiles. It needs: a
page, a route for its share image, the Source and Format Sync resolvers, and
nothing new in storage. The rankings page's Market Movers section could gain
"Buy windows" and "Sell windows" lists from the same read in one task. Both
are listed as follow-ups in section 17 and are not part of the gate for this
plan.

---------------------------------------------------------------------------

## 13. Admin panels

13.1 /admin/league-blueprint (lib/league-blueprint/settings.ts,
default-settings.ts, app/admin/league-blueprint/{page.tsx, actions.ts,
blueprint-settings-manager.tsx})

Settings shape (defaults in parentheses):

    version (1; bump to force rebuilds)
    cache: { ttlHours (12) }
    grades: { valueWeight (0.5), pointsWeight (0.5), overall: { qb (1.0),
      qbSuperflex (1.5), rb (1.0), wr (1.0), te (0.75), bench (0.5),
      picks (0.5) } }
    archetype: { topHeavyShare (0.80), deepShare (0.62),
      reloadAgeGap (0.5), reloadPicksGrade (6), contendHoldAgeGap (-0.5),
      rebuildYoungShare (0.5), rebuildPicksGrade (7), youngAge (25) }
    calls: { ageCutoff: { QB (33), RB (28), WR (30), TE (30) },
      needMinPoints (1.0), targetValueLow (0.6), targetValueHigh (1.6),
      targetsPerPosition (2), maxNeedPositions (3) }
    activity: { sellWeight (0.40), needWeight (0.30), divergenceWeight
      (0.30), lowBelow (34), highAbove (66) }
    movers: { window ("30d"), limit (3), minGated (7) }
    strategy: { maxRuns (3), pivotGapPct (0.12) }
    partners: { needWeight (0.40), giveWeight (0.30), directionWeight
      (0.20), tendencyWeight (0.10), count (2) }
    priorities: { count (3) }

Validation: zod, every weight in [0, 1], the overall weights positive, the
three activity weights summing to 1 within 0.001, lowBelow < highAbove, age
cutoffs 20 to 45. Saving does not rebuild anything; the version field is the
rebuild switch and the page says so beside it.

13.2 /admin/market-signals

The 5.8 settings with the same validation style (window 10 to 90, k 1 to 3,
watch 0 to 0.2, hold back 0 to 0.3, min points 5 to window, stale 1 to 7,
lookback >= window, floor 0 to 0.2), plus a read-only run table from
market_signal_runs (last 40 rows: partition, as of day, rows, changes,
duration, ran at in Eastern) and a "Run now" server action that calls the
same partition runner for one chosen partition under requireAdmin (not the
cron route; the action is bounded by one partition).

---------------------------------------------------------------------------

## 14. Accessibility

Everything in the CLAUDE.md Accessibility section applies. Specific to this
page:

- One h1 (the masthead). Panels are h2, sub-lists h3, no skipped levels.
- Every figure is one text node with the missing unit appended as sr-only
  inside the same element. No figure is drawn twice.
- Nothing visible is aria-hidden except icons, the gauge arc (its value is
  text beside it) and the slot abbreviations whose spelled-out form is the
  accessible name on the same element.
- Grade rings and the gauge are role="img" with an aria-label that states the
  value; the underlying table is real and under a disclosure.
- The lineup table's row header is the slot name only.
- Call tags are text; color never carries the state alone; the strength word
  is part of the text.
- Every link and button is at least 44px tall. The roster select is a native
  select with a visible label.
- Live regions: only the copy buttons' existing ones.
- Dates and times through formatEastern.
- Charts: ChartFigure with an sr-only summary sentence and a table.
- The share strip h2 "Share" and the three buttons keep their existing
  announcements.
- Skeleton: aria-busy with a role="status" sentence, no layout jump when the
  body arrives (the skeleton has the same section count and heights).
- The sub-agent accessibility review must confirm: no data hidden at any
  breakpoint, every figure a single text node, every image role named.

---------------------------------------------------------------------------

## 15. Security

- Ids validated before any read (digits only). notFound for an unknown
  roster.
- The page shows only data the team page already shows plus derived
  arithmetic. No private data; the ledger figures are already public on
  /decisions.
- The rebuild is metered (8.4), claimed after validation, fails closed.
- The cache view is server-written, never user-controlled; rendered as text.
- Image routes read only; every path sets Cache-Control; unknown queries
  308 so junk params cannot fill the CDN.
- The proposal links into the builder carry only ids the builder re-derives
  ownership for (the Trade Ideas rule).
- Admin actions behind requireAdmin with server-side validation; settings
  rows service-role only.
- The cron route behind verifyCronRequest; the "Run now" action bounded to
  one partition.
- Signals tables are public read, service-role write, no client writes.
- No new environment variables.
- The security sub-agent verifies pg_policies for all five new tables and
  tests an anon select on player_value_signals succeeds and on
  market_signal_settings fails.

---------------------------------------------------------------------------

## 16. Testing

Vitest, beside each module, fixtures under lib/league-blueprint/__fixtures__
and lib/market-signals/__fixtures__ (a 12-team league view input built from
plain objects, and three value series: steady, trending up through the band,
and a gap-filled one).

- bollinger.test.ts: mean and sample stdev against hand-computed numbers for
  1..30; width 0; fewer than min points; the day-collapse rule (two rows
  one day, latest wins); market = value - formula_offset; hysteresis (a
  value re-entering the band by less than hold back keeps "sell", by more
  drops to "hold"); thin floor; rollingBands last row equals the single
  computation.
- engine.test.ts (market signals): partition listing respects
  supported_format_slugs and NULL; the deadline rule stops before a
  partition, returns partial without failedSteps; a throwing partition is
  recorded in failedSteps and the next runs; stamped partitions are skipped
  on the catch-up entry; chunk sizes 500.
- cron-schedule-sync.test.ts passes with the two new entries; cron-health
  expectations updated for a job that runs twice a day.
- grades.test.ts: rank 1 of 12 is 10, 12 of 12 is 1, null pulse falls back
  to value only, redraft picks null, superflex QB weight, overall one
  decimal.
- archetype.test.ts: every branch of 6.3, redraft words, null pulse.
- age.test.ts: weighting, empty position null, gap sign.
- movers.test.ts: refactor keeps lib/rankings/insights.test.ts green; roster
  movers use the format top floor; fallback to 7 days.
- calls.test.ts: the decision table of 6.7 row by row; defender gets no
  call; dynasty keep value blocks a cut; target window and ranking.
- activity.test.ts: the formula and bands; driver sentence picks the largest
  term.
- priorities.test.ts: every template fires on its condition and not
  otherwise; every rendered sentence contains the cited figures; fallback
  always present; exactly three returned.
- strategy.test.ts: shape classification on synthetic suggestions; run cap
  of three; empty shape sentence.
- partners.test.ts: fit formula, normalization with a zero max, tie break.
- capital.test.ts: grouping, unpriced picks counted, season rank.
- cache.test.ts: fingerprint changes on each input; TTL; stale row kept on
  failure.
- share-layout.test.ts: height sums; a 14-slot league is taller than a 9-slot
  one.
- Route tests for both image routes: 400 on a bad id, 404 image on a missing
  league, placeholder on a missing row, 308 on an unknown query, cache
  headers on every path, brand check (no gold, no #0c0c18, no banned words),
  the ring SVG matches ring-geometry output.
- naming test: lib/positional-war/naming.test.ts gains lib/league-blueprint/
  and lib/market-signals/ in its scanned folders.
- source guard: lib/projections/source-guard.test.ts is untouched because
  the Blueprint reads no projections directly; the review confirms it.
- IDP invariant: npm run verify:idp-invariant must still print identical for
  every non-IDP league (the Blueprint changes no loader it checks, but the
  roster select extraction touches the lineups page, so run it).
- The gate: npm run typecheck, npm run lint (zero warnings), npm test,
  npm run build.

---------------------------------------------------------------------------

## 17. Build order (atomic tasks) and sub-agent reviews

Each line is one progress.md task in the T### | status | description format,
with files and depends-on lines added when entered. Tasks are atomic: one
file, one feature, one migration. Build in this order.

Phase A: foundations
BP-T001 Update this plan's row in docs/README.md Active table (status
        "Approved, building").
BP-T002 Migration 0340 league_blueprint_settings (apply, verify policies,
        regenerate types, prettier).
BP-T003 lib/league-blueprint/default-settings.ts (RB cutoff 28).
BP-T004 lib/league-blueprint/settings.ts (schema, validate, merge, load,
        save) plus settings.test.ts.
BP-T005 app/admin/league-blueprint/actions.ts.
BP-T006 app/admin/league-blueprint/blueprint-settings-manager.tsx.
BP-T007 app/admin/league-blueprint/page.tsx and lib/nav-tree.ts entry.
BP-T008 lib/league-blueprint/types.ts with the naming header; extend
        lib/positional-war/naming.test.ts folder list.

Phase B: Market Signals engine
BP-T009 Migration 0342 market signals (four tables, policies, indexes;
        verify anon select on signals and anon denial on settings; types).
BP-T010 lib/market-signals/default-settings.ts.
BP-T011 lib/market-signals/settings.ts plus test.
BP-T012 lib/market-signals/bollinger.ts (pure: collapse days, window, bands,
        classify with hysteresis, thin floor, rollingBands) plus test.
BP-T013 lib/market-signals/partitions.ts (list partitions from
        source_registry and format_configs, the 25-player floor, staleness
        check against market_signal_runs) plus test.
BP-T014 lib/market-signals/run-partition.ts (read, fold, compute, write,
        stamp) plus test with a mocked client.
BP-T015 lib/market-signals/engine.ts (the deadline loop over partitions, the
        end-of-run prunes for changes and runs) plus test.
BP-T016 app/api/cron/market-signals/route.ts; CRON_JOBS and CronJobName
        entries; vercel.json two entries; cron-schedule-sync and cron-health
        tests green.
BP-T017 scripts/backfill-market-signal-changes.ts and the npm script.
BP-T018 lib/market-signals/read.ts.
BP-T019 app/admin/market-signals (page, actions with "Run now" for one
        partition, manager component, the table-size readout) and nav entry.
BP-T020 Deploy, run the cron once by hand (curl with CRON_SECRET), confirm
        market_signal_runs rows and durations, run the backfill for the last
        365 days once, and record row counts and bytes for the new tables in
        progress.md (section 7.4).

Phase C: Blueprint pure modules
BP-T021 lib/league-blueprint/grades.ts plus test.
BP-T022 lib/league-blueprint/archetype.ts plus test.
BP-T023 lib/league-blueprint/age.ts plus test.
BP-T024 Refactor lib/rankings/insights.ts topMovers to MoverInput with the
        board adapter; existing tests green.
BP-T025 lib/league-blueprint/movers.ts plus test.
BP-T026 lib/league-blueprint/calls.ts plus test.
BP-T027 lib/league-blueprint/activity.ts plus test.
BP-T028 lib/league-blueprint/priorities.ts plus test.
BP-T029 lib/league-blueprint/strategy.ts plus test.
BP-T030 lib/league-blueprint/partners.ts plus test.
BP-T031 lib/league-blueprint/capital.ts plus test.
BP-T032 lib/league-blueprint/spotlight.ts plus test.
BP-T033 lib/league-blueprint/shares.ts plus test.
BP-T034 lib/league-blueprint/build.ts (assembler) plus fixture test.
BP-T035 lib/league-blueprint/ring-geometry.ts, gauge-geometry.ts,
        age-geometry.ts plus tests.
BP-T036 lib/league-blueprint/share.ts (buildBlueprintShareCard,
        describeBlueprint) and share-layout.ts plus tests.

Phase D: storage and loader
BP-T037 Migration 0341 league_blueprint_cache AND league_roster_age_history
        (policies, indexes, types).
BP-T038 The two one-statement prunes (blueprint cache 14 days, age history
        730 days) in the league-maintenance cron plus test.
BP-T039 lib/league-view-data.ts loadTrends window option (existing callers
        unchanged) plus test.
BP-T040 lib/league-blueprint/rate-limit.ts.
BP-T041 lib/league-blueprint/cache.ts (fingerprint, freshness, read, write)
        plus test.
BP-T042 lib/league-blueprint/age-history.ts (the daily upsert) plus test.
BP-T043 lib/league-blueprint/data.ts (every read; reserve and taxi ids;
        signals; coalesce; the rebuild path; the age history write).

Phase E: page
BP-T044 Extract components/league-lineups/roster-select.tsx from
        LineupControls; LineupControls uses it; run verify:idp-invariant.
BP-T045 Extract components/share-strip.tsx from the matchup page; matchup
        page uses it.
BP-T046 Leaderboards page swapped onto components/share-strip.tsx (decision
        3.15); its share tests green.
BP-T047 components/league-blueprint/call-tag.tsx.
BP-T048 components/league-blueprint/standing-panel.tsx.
BP-T049 components/league-blueprint/grade-rings.tsx.
BP-T050 components/league-blueprint/lineup-table.tsx.
BP-T051 components/league-blueprint/depth-lists.tsx.
BP-T052 components/league-blueprint/shares-panel.tsx.
BP-T053 components/league-blueprint/age-chart.tsx.
BP-T054 components/league-blueprint/movers-panel.tsx.
BP-T055 components/league-blueprint/gauge.tsx and calls-panel.tsx.
BP-T056 components/league-blueprint/capital-panel.tsx.
BP-T057 components/league-blueprint/priorities-panel.tsx.
BP-T058 components/league-blueprint/strategy-panel.tsx and
        partners-list.tsx.
BP-T059 components/league-blueprint/spotlight-card.tsx.
BP-T060 components/league-blueprint/body-skeleton.tsx.
BP-T061 app/leagues/[league_id]/blueprint/page.tsx (metadata, shell, intro,
        controls, Suspense body, states).
BP-T062 Nav item directly after Overview, leagueTabHref, team-card link,
        team deep view link.

Phase F: images
BP-T063 app/api/og/blueprint/[league_id]/[roster_id]/route.tsx plus
        card.tsx helpers and route.test.ts.
BP-T064 app/api/og/blueprint/[league_id]/[roster_id]/share/route.tsx plus
        test.

Phase G: profile
BP-T065 lib/market-signals/bollinger.ts rollingBands wired into
        lib/player-profile.ts and value-trend-chart.tsx bands prop plus
        table columns.
BP-T066 components/player-profile/market-signal-badge.tsx and its placement
        in overview-sidebar.tsx.

Phase H: calls to action (section 20)
BP-T067 lib/league-blueprint/cta-data.ts (the one-row cache read for the
        overview CTA) plus test.
BP-T068 components/league-blueprint/blueprint-cta.tsx.
BP-T069 Overview page: mount the CTA between SeasonResultSection and
        ActivitySection with the viewer's roster from matchViewerRoster.
BP-T070 lib/site-layout/default-settings.ts and settings validation gain
        homepage.blueprintStrip {enabled: true}; /admin/site-layout gains
        the switch.
BP-T071 components/blueprint-feature-strip.tsx (with the decorative preview
        SVG as its own small component in the same file).
BP-T072 app/page.tsx: mount the strip between Hero and ToolsSection, gated
        on the setting.

Phase I: finish
BP-T073 The gate: typecheck, lint, test, build.
BP-T074 Implementation review sub-agent (plan adherence, format and source
        propagation, naming rule, IDP invariant, no engine in image routes,
        no cron iterating leagues, section 7.4 size rules, section 20 copy).
BP-T075 Accessibility review sub-agent (section 14 checklist, plus the two
        CTAs: heading levels, the decorative preview, one control each).
BP-T076 Security review sub-agent (section 15 checklist, pg_policies on all
        six tables).
BP-T077 Fix findings; re-run the gate.
BP-T078 Screen check at 360px, 768px and 1280px through Chrome (memory note:
        the window cannot go under 500px; use the documented workaround):
        the page, both CTAs, copy image and copy link, the portrait card.
BP-T079 CLAUDE.md gains a "Team Blueprint" section and a "Market Signals"
        section summarizing the absolute rules (one view model, images read
        only, no engine at image time, signals never per-row, the deadline
        loop, hysteresis, the size rules of 7.4).
BP-T080 Move this plan to docs/completed/team-blueprint/ with git mv; update
        docs/README.md; write the "what shipped differently" section at the
        end of this file.
BP-T081 Commit on the current branch in the owner's voice, no attribution.

Follow-ups (not in the gate, each its own future plan or task): the "Age
over time" chart reading league_roster_age_history; the Beacon Exchange page
(12.4); rankings Market Movers buy and sell windows.

Sub-agent reviews run exactly as CLAUDE.md's Sub-Agent Workflow says, three
reviewers, after Phase F and again after Phase H, each with the plan file
path and the section numbers to check.

---------------------------------------------------------------------------

## 18. Owner decisions (answered 2026-10-29)

These are settled. The builder does not reopen them.

18.1 Grade scale: NUMBERS, 1 to 10, overall to one decimal.

18.2 Spotlight replaces the college prospect card: YES.

18.3 Age picture: BARS now, versus the league, no time series. AND track
roster age from launch so historical data can be shown later: YES. Built as
league_roster_age_history (7.2, 6.4). The chart that reads it is a
follow-up.

18.4 Buys are targets on other rosters at positions of need; sells, holds
and build-arounds are the reader's own players: YES.

18.5 Persist the view in league_blueprint_cache: YES.

18.6 Who may view a Blueprint: ANYONE. Signed-in extras (tendencies,
declined trades) as Trade Ideas does.

18.7 Market Signals compute EVERY active source, with the database-size
rules of section 7.4 (latest-only rows, change-only history, thin partitions
skipped, prunes on a schedule, nothing added to player_value_history).

18.8 Hysteresis: YES.

18.9 Cron at 10:30 and 10:50 UTC: YES.

18.10 One-time 365-day backfill of signal changes: YES.

18.11 Leaderboards page onto the shared share strip in this build: YES.

18.12 Beacon Exchange page: NO, out of scope; later.

18.13 Nav position: DIRECTLY AFTER OVERVIEW, and a CTA on the overview page
above the league activity panel (section 20.1). The owner also asked for a
homepage strip under the hero (section 20.2).

18.14 Sell cutoff ages: QB 33, RB 28, WR 30, TE 30; dynasty keep value
1,500. All editable in admin.

---------------------------------------------------------------------------

## 19. Copy, glossary and the words that are banned here

- The feature is "Team Blueprint"; the page section is "Blueprint". Never
  "Domain", "Dynasty Domain", "DPC", "exchange" in reader-facing copy.
- "Build around", "Hold", "Sell", "Hard sell", "Cut candidate", "Buy target",
  "Hard buy", "Soft buy". Never "oversold" or "overbought" (finance jargon
  that a fantasy reader does not use); the badge says "Buy window" and "Sell
  window".
- "Positional WAR" always with the adjective; nothing on this page is called
  WAR except that read, and the Blueprint does not display it at all (the
  calls use projPoints and value). The naming test enforces it.
- "Projected" for anything from Power Pulse; "scored" for anything settled.
- Grades are "of 10". Ranks are "3rd of 12". Shares are "14.2% of the
  league".
- The outlook is two words joined by "then": "Contend, then Reload".
- Every sentence that gives advice cites a number. A sentence that cannot is
  deleted, not softened.
- Times: formatEastern. Dates alone: the Eastern date.
- ASCII punctuation only. Write any banned character as a JavaScript escape
  generated from a character code, never typed.
- American English: "favorite", not "favourite", except the persisted keys
  listed in the memory note.
- CTA copy (section 20) uses none of the banned marketing words from
  section 10.3; it names what the page shows and nothing more.

---------------------------------------------------------------------------

## 20. Calls to action: the league overview and the homepage

Two placements, two components, one rule: a CTA names exactly what the
reader will get, shows a real number when one exists, and has ONE control.

20.1 League overview CTA

File: components/league-blueprint/blueprint-cta.tsx (server component).
Mounted in app/leagues/[league_id]/page.tsx inside the overview branch's
main column, AFTER the SeasonResultSection Suspense and BEFORE the
ActivitySection Suspense (today's lines 435 to 442), so it sits above the
scrollable activity panel. It renders only when activeTab is "overview".

Data: lib/league-blueprint/cta-data.ts loadBlueprintCtaFigure(admin,
leagueRowId, rosterId, season, sourceSlug) reads ONE row from
league_blueprint_cache (overall grade, status label, generated_at) and
returns null when there is none. It never builds. It is wrapped in its own
Suspense with fallback null (the card renders its no-figure state while the
read is in flight is NOT acceptable because it would then re-render; the
read is awaited inside the component and the whole card waits, which is one
indexed row and is immediate).

Props: {sleeperLeagueId, linkUsername, viewerRosterId: number | null,
viewerTeamName: string | null, figure: {overall: number, statusLabel:
string, generatedAt: string} | null}. viewerRosterId comes from the page's
existing matchViewerRoster(candidates, searchedUsername, focusedRosterId,
viewerSleeperUserId) (page.tsx lines 805 and 876 call it already).

Markup (reading order is the sentence):

    <section aria-labelledby="blueprint-cta-heading"
      class="relative overflow-hidden rounded-card border border-line-accent
             bg-surface/60 px-4 py-4 sm:px-5">
      hairline span (aria-hidden, the beacon hairline from 10.2)
      <div class="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div>
          <p class="text-[10px] font-semibold uppercase tracking-[0.18em]
                    text-brand-cyan">New: Team Blueprint</p>
          <h2 id="blueprint-cta-heading"
              class="mt-1 text-[17px] font-bold leading-tight tracking-tight
                     text-ink">
            {viewerTeamName ? "{viewerTeamName}'s blueprint"
                            : "A blueprint for every team"}
          </h2>
          <p class="mt-1 max-w-2xl text-sm leading-relaxed text-ink-muted">
            Grades by position, buy and sell calls, three trade shapes with a
            grade on each, and the two best trade partners in this league, on
            one page you can share as a picture.
          </p>
        </div>
        <div class="flex items-center gap-4 sm:justify-end">
          {figure && (
            <div class="text-right">
              <div class="text-[10px] font-semibold uppercase tracking-wide
                          text-ink-subtle">Overall grade</div>
              <div class="font-mono text-2xl font-black tabular-nums text-ink">
                {overall}<span class="sr-only"> of 10</span>
              </div>
              <div class="font-mono text-[11px] tabular-nums text-ink-subtle">
                {statusLabel}
              </div>
            </div>
          )}
          <Link href={href}
            class="inline-flex min-h-11 shrink-0 items-center gap-1.5
                   rounded-card border border-line bg-base px-4 py-2.5 text-sm
                   font-semibold text-ink transition-colors
                   hover:border-brand-cyan/60 hover:text-brand-cyan
                   focus-visible:outline focus-visible:outline-2
                   focus-visible:outline-offset-2 focus-visible:outline-brand-cyan">
            {viewerRosterId != null ? "Open my blueprint" : "Pick a team"}
            <ArrowRight aria-hidden="true" class="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </section>

href: viewerRosterId != null
      ? withUsername("/leagues/{id}/blueprint?roster={viewerRosterId}", linkUsername)
      : withUsername("/leagues/{id}/blueprint", linkUsername)
(withUsername is the existing helper the league pages use to carry
?username=.)

Rules: the grade figure is the only number and it is the real stored one; no
figure, no number (never a sample). No icon besides the arrow on the button.
No glow. Below sm the grid stacks and the button is full width (w-full
sm:w-auto). The hairline is the only decoration. Heading level is h2 because
the overview's panels are h2 siblings. The card is not dismissable and has
no "New" badge beyond the eyebrow word; the eyebrow drops the word "New:"
after 2027-01-31 by a dated constant in the component with a comment, so the
word does not live on the page forever.

20.2 Homepage feature strip

File: components/blueprint-feature-strip.tsx (server component). Mounted in
app/page.tsx between <Hero memberContext={memberContext} /> and
<ToolsSection cards={layout.homepage.cards} /> (today's lines 213 and 214),
gated on layout.homepage.blueprintStrip.enabled (new setting, default
true, in lib/site-layout/default-settings.ts, validated in its settings
module, switchable at /admin/site-layout so the owner can retire the strip
without a deploy).

Markup:

    <section aria-labelledby="blueprint-strip-heading"
      class="relative overflow-hidden border-b border-line">
      <div class="relative mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        <div class="grid items-center gap-6 rounded-modal border
                    border-line-accent bg-surface/50 p-5 sm:p-6
                    lg:grid-cols-[minmax(0,1fr)_360px]">
          hairline span (aria-hidden)
          <div>
            <SectionEyebrow>New in League Pulse</SectionEyebrow>
            <h2 id="blueprint-strip-heading"
                class="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">
              Get your team's blueprint.
            </h2>
            <p class="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted
                      sm:text-base">
              Pick any team in your Sleeper league and get a one-page plan:
              grades by position, who to buy and sell, three trade shapes
              with a grade on each, and the two managers most likely to deal.
              Share it as a picture.
            </p>
            <div class="mt-5 flex flex-wrap items-center gap-3">
              <Link href="/tools/league-pulse" class="{the primary button
                    classes MemberHeroCta uses for its non-member state}">
                Open League Pulse
                <ArrowRight aria-hidden="true" class="h-3.5 w-3.5" />
              </Link>
              <span class="text-xs text-ink-subtle">Free. No signup. Works
                for every Sleeper league.</span>
            </div>
          </div>
          <BlueprintPreview />   (decorative, aria-hidden="true")
        </div>
      </div>
    </section>

BlueprintPreview is a small inline SVG in the same file, 360 x 200 at lg,
full width below lg (max-width 100%, height auto), aria-hidden="true",
drawn from tokens: a surface rectangle with the line border, a large
"7.4" in Geist Mono weight 900 with the beacon gradient (an SVG
linearGradient from #A855F7 to #22D3EE), the words OVERALL above it in the
eyebrow style, six small rings at the right with the digits 8, 6, 7, 4, 5,
9 and the codes QB RB WR TE BN DC under them, and two call tags "SELL" and
"BUILD" in the 9.18 colors. It is a picture of the SHAPE of the page, not a
claim about any team, which is why it is decorative and why the text beside
it says everything the picture does. It must not include a team name, a
player name or a league name. prefers-reduced-motion: the SVG has no
animation to begin with.

A reader with a saved Sleeper handle who follows the button lands on their
own leagues (the saved-handle rule); the strip itself does not read the
handle and renders identically for everyone, so the homepage stays static.

20.3 Where the two CTAs end

Both link INTO the feature; nothing in the feature links back to them. The
overview CTA is also the one place the overview mentions the Blueprint; the
nav entry does the rest.

---------------------------------------------------------------------------

## 21. What shipped differently

Built 2026-10-29 as BP-T001 to BP-T085 in progress.md (BP-T074 to BP-T076
became one review sub-agent at the owner's request; BP-T081, the commit, was
skipped by the owner). Everything below is a departure from the sections
above, with the reason. Where this section and an earlier one disagree, this
one describes the code.

Storage and engine

- Migration 0341 was applied to production as two MCP migrations
  (0341_league_roster_age_history, 0341_league_blueprint_cache) and 0342 as
  four (0342_market_signals, _runs, _changes, _latest), because the MCP
  rejected the whole payload with "Invalid or expired requestState". The repo
  holds one file each with the same SQL.
- 0342 adds two indexes the plan does not list: player_value_signal_changes
  (changed_on) for the 730-day prune and market_signal_runs (ran_at desc) for
  the admin table. The runs prune filters on ran_at so it uses that index.
- A change row is written on a move INTO a call state, including the first
  run (from null), so the first night wrote about one row per signaled player
  once. Baseline and thin never log.
- source_registry has no display_order column, so partitions order the
  default source first, then priority, then format display_order.
- player_value_signal_changes measured about 44 MB after the 365-day backfill
  (132,558 rows for 2025-10-29 to 2026-10-28), above the 30 MB a year in 7.4.
  Changes average about 360 a day, against the 600 estimated, but the rows and
  indexes are larger than the estimate assumed. At 730 days the table will be
  roughly 60 to 90 MB.
- DynastyProcess publishes weekly. With staleDays 3 it has no partition most
  nights and its series never reach 24 points in 30 days, so it is effectively
  unsignaled. That is the size rules working, not a defect.
- A signal row older than staleDays is treated as no signal on every read
  (lib/market-signals/read.ts isSignalCurrent). 5.1 leaves a stale row in
  place, and without the read-side check a player a source stopped pricing
  would have kept his last call forever.
- The admin Market Signals page shows ROW COUNTS from exact head counts, not
  bytes. Bytes need a SECURITY DEFINER function, a migration this plan does
  not list; BP-T020 recorded bytes through the MCP instead.

The Blueprint view

- The stored view is viewer independent (rule 3 in lib/league-blueprint/
  types.ts). 18.6 asks for signed-in extras the way Trade Ideas has them; a
  shared cache row cannot carry one reader's declined trades or show a guest
  a tendency gated behind sign-in, so the partner tendency term is fixed at
  0.5 and the finder runs with no tendencies and no declined keys.
- The spotlight compares the week's top scorer with his season per-game
  average from the Leaderboards views, not with a projection:
  league_power_pulse_cache.weekly holds team distributions, not player
  projections. It also searches the position boards, because the overall
  season board is truncated.
- Priorities gained two fallbacks below P10 (P11 "Lean on {strongest
  position}", P12 "Track the total"), both citing figures, so exactly three
  always render as section 16 requires. P8 (Hold steady) is suppressed
  whenever an action priority fires, so the page never says both.
- A rebuilding roster does not sell a player under his position's age cutoff
  just for being trade-finder surplus; finder team names already carry the
  handle, so it is not doubled; Signal Check's Side A and Side B read You win
  and They win.
- The two stored call notes say "his own market band" rather than "30-day
  band", and every label that names the window reads the stored
  market_signal_settings value, so an admin change to the window never leaves
  a page describing the wrong band. The profile band uses the stored settings
  too, which closes the gap 12.3 left between the badge and the band.
- BLUEPRINT_MODEL_VERSION is 4, not 1: bumped for the verdict wording, then
  for the call notes.

The page and the images

- Depth columns are grid sm:grid-cols-2 xl:grid-cols-4 rather than
  grid-cols-2 sm:grid-cols-4, so a row of name, value, rank and call fits at
  390 and 768.
- Below sm the starting lineup is three columns: the slot (SF for
  superflex), the player with team, position and any call note, and one cell
  stacking value, position rank and the call. From sm up the separate
  columns return.
- Buy, sell, hold stacks Sell and Build around in one column and gives Hold
  the other two, flowing into two columns from sm when it holds more than 8,
  because a 25-row hold list beside two short lists left a large empty block.
- The age chart draws a 280-wide copy below sm and the 480 copy from sm, so
  its labels stay legible on a phone.
- The intro carries no "as of" time (9.1 has one). It is read before the body
  may rebuild, so it could disagree with the body; the body's notes carry it.
- The depth starter mark is the visible word "Starter", not "ST" with a
  spoken twin.
- The portrait share card sizes Top priorities and Trade strategy from their
  text (line counts estimated with fitText), capped at 310 each, instead of
  the fixed 180 and 260 in 11.3: priorities clip at 140 characters and
  strategy at 120, and the card grows rather than clipping. The footer is
  the wordmark row (it already reads FFBeacon.com) with the source line under
  it, rather than a second domain beside a long format name.
- The 1200x630 preview's right column is 360 wide with 52px rings so the ring
  row stays inside the padding.
- The missing-league image is renderHeadlineCard re-wrapped as a 404, because
  renderHeadlineCard takes no status.

Shared code

- components/admin/settings-form-kit.tsx is new: every existing admin
  manager carries its own copy of the field helpers, and the two new managers
  share one copy instead of adding two more.
- components/trend-chip.tsx now renders its figure as real text with sr-only
  words inside the same element. It had hidden the figure with aria-hidden
  and named a p element with aria-label, which screen readers do not reliably
  announce. The change reaches every page that renders a trend chip.
- The overview CTA reads view->standing only, not the whole stored view.
- A failed blueprint prune in the league-maintenance cron is recorded as a
  failed step and no longer stops the not-found league recheck.
