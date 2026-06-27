# Handoff: On The Clock (live Sleeper draft helper) - PHASE 6D (Admin Settings UI) - CODE COMPLETE

## Phase 6D status (admin settings manager for on_the_clock_settings) - CODE COMPLETE
All 10 tasks done at the code level (typecheck clean; 26 files / 269 tests pass, +14; build green;
/tools/on-the-clock 24.5 kB and Signal Check 14 kB BOTH unchanged). No value-pipeline change, no FF
Beacon source-behavior change, no league-format-detection change, no Sleeper polling, no commits/pushes.
NOT live-verified against a real active Sleeper draft (that is the next, final phase).

What changed (6D):
- NEW app/admin/on-the-clock/page.tsx: requireAdmin -> loadOnTheClockSettings (service role) + reads
  on_the_clock_settings.updated_at; force-dynamic. Mirrors /admin/faab/page.tsx.
- NEW app/admin/on-the-clock/on-the-clock-settings-manager.tsx ("use client"): grouped form mirroring
  the FAAB manager primitives (NumberInput text-buffer, Field/Toggle with aria-describedby hints,
  SectionCard, CollapsibleSection via native details/summary). Groups: Feature status; Sync & Sleeper
  limits; Board & player pool (read-only notes); Recommendation engine; Trade Analyzer (info only);
  Advanced position fallback (collapsed); Maintenance (cache TTLs + last-saved time in
  America/New_York via formatEastern + read-only settings JSON). Three buttons: Save, Reset form to
  defaults (local), Reset to defaults and save (confirm).
- NEW app/admin/on-the-clock/actions.ts: saveOnTheClockSettings (requireAdmin -> clamp -> validate ->
  service-role upsert, updated_by server-set, revalidates admin + tool) and resetOnTheClockSettings
  (defaults but KEEPS feature.enabled; upserts, never deletes the row).
- lib/on-the-clock/settings.ts: added clampOnTheClockSettings (coerces numerics into safe ranges +
  lockSeconds <= cooldownSeconds; preserves unwired/unknown keys).
- components/admin-nav.tsx: added "On The Clock Settings" (Timer icon, /admin/on-the-clock).
- Tests: lib/on-the-clock/settings.test.ts (+6) and NEW app/admin/on-the-clock/actions.test.ts (8).

Settings EXPOSED (all currently wired into running code): feature.enabled; sync.cooldownSeconds /
lockSeconds / realtimeEnabled; limits.maxActiveLeagues; recommendation.teamNeedEnabled / aggressiveness
(seeds weights) / weights.value|need|reach / maxReachTierBreak; positionAdjust.superflexQbMultiplier /
tePremiumMultiplier; dstk.recommendBehavior / requireStartingSlot / minRoundForDst / minRoundForK;
positionFallbackTargets.* (advanced). Also exposed under Maintenance: cache.activeTtlHours /
completedRetentionHours (with a "takes effect when the cleanup job runs" caveat; cleanup fn exists in
migration 0113 but is NOT cron-wired).

Settings kept CODE-ONLY (defined but NOT wired into running code; preserved untouched through save, NOT
shown as editable so as not to imply control): sourceFormat.defaultRankingSource (superseded by the
FF Beacon hard lock) and defaultFormatFallback; pools.enabledPools / defaultPool; limits.
maxAvailablePlayers; dstk.includedInRoom (board always includes DST/K; shown as a read-only note);
mappingVisibility.showUnmappedPanel. Trade Analyzer projection constants (FALLBACK_PICK_VALUE,
PLAYER_PICKER_CAP, 0.85^n discount, bucket %s, fair/lean thresholds) stay in lib/on-the-clock/
trade-analyzer.ts per the no-Trade-Analyzer-rewrite boundary; surfaced as an info note in the admin UI.

Auth/security: requireAdmin gates page + both actions (defense in depth; client isAuthorized never a
boundary). on_the_clock_settings RLS is service-role-only (migration 0106) - unchanged; writes go
through createAdminClient in the server action only. updated_by is the verified session userId, never
client input. No anon/auth write path added.

Validation/defaults: save flow is clamp -> validate -> upsert. clampOnTheClockSettings forces numerics
into safe bands and lockSeconds <= cooldownSeconds, so a valid-but-out-of-range payload is rescued;
validateOnTheClockSettings (existing zod, per-field defaults) then fills missing keys and rejects bad
enums/types. loadOnTheClockSettings deep-merges the stored row over code defaults so a partial/corrupt
row never breaks the public tool.

Reset to defaults: "Reset to defaults and save" reads the current row's feature.enabled, writes code
defaults with that enabled bit preserved (upsert, row kept), and returns the written settings so the
form re-syncs. The local "Reset form to defaults" only changes the in-memory form (keeps enabled) and
requires an explicit Save.

## Safe to proceed to final live-draft QA?
Yes. The admin settings phase is self-contained: it only reads/writes on_the_clock_settings (already
consumed by the routes + recommend engine) and added no Sleeper/value-pipeline surface. Recommended
first live step: open /admin/on-the-clock, flip feature.enabled on, then run the end-to-end live-draft
walkthrough that has been pending since 6A (sync within cooldown, Realtime fan-out, my-team detect,
snake/3RR ordering, Team Need across SF/TEP/dynasty/rookie, Trade Analyzer pick ownership).

---

# Handoff: On The Clock (live Sleeper draft helper) - PHASE 6C.1 (pick ownership) - CODE COMPLETE

## Phase 6C.1 status (Trade Analyzer pick ownership + transaction-aware values) - CODE COMPLETE
All 10 tasks done at the code level (typecheck clean; 25 files / 255 tests pass, +8; build green; Signal
Check 14 kB unchanged). NOT yet verified against a real active Sleeper draft. No admin UI, no value-
pipeline/source/format change, no polling, no commits/pushes.

What changed (6C.1):
- Migration 0115: traded_picks jsonb (NOT NULL default '[]') on on_the_clock_draft_cache (RLS inherited
  from 0107). lib/database.types.ts patched for the column.
- lib/on-the-clock/sleeper-sync.ts: getSleeperTradedPicks(leagueId) added to the existing sync
  Promise.all (ONE extra Sleeper call per sync, inside the durable lock; [] on failure = partial-safe).
  Written to the traded_picks column. cache.ts shapes it; ShapedDraftCache.tradedPicks (types.ts).
  Read path + Realtime both surface the freshly-written ownership, so co-viewers benefit after a sync.
- NEW lib/on-the-clock/pick-ownership.ts (pure): normalizeTradedPicks, resolveCurrentDraftPicks (every
  pick in the current draft, any owner; ownership = made pick's actual roster > traded_picks owner for
  (season,round,original) > original seat roster; unknown when seat mapping missing), resolveTradedFuturePicks.
- lib/on-the-clock/trade-analyzer.ts buildTradeCatalog rewritten: groups = Available/Rookie players,
  Made picks (valued by the selected player's FF Beacon value; unmapped -> 0/estimated/unavailable),
  Upcoming picks (projected from post-exclusion board, ANY owner), Future pick buckets (generic), Traded
  future picks (owner-aware). Owner labels "Your pick"/team/"owner unknown". User's picks sort first.
- on-the-clock-client.tsx: builds currentPicks + tradedFuturePicks + teamNameByRosterId from the cache
  and passes them (valueBoard = full board) to buildTradeCatalog. TradeAnalyzer component unchanged
  (already renders any groups generically).
- NEW lib/on-the-clock/pick-ownership.test.ts (12); trade-analyzer.test.ts rewritten for the new API.

Tasks: [x] 1 audit (T105) [x] 2 txn audit (T106) [x] 3 ownership module (T107) [x] 4 sync+cache (T108)
[x] 5/6/7 catalog (T109) [x] 8 UI (T110) [x] 9 tests (T111) [x] 10 checks (T112).

## Live-draft verification still pending (6C.1)
- traded_picks fetch returns real data and a traded current/future pick shows the correct new owner.
- Made picks show the right selected player + value; ownership labels match the real league.
- A partial sync (traded_picks fetch fails) still loads picks/board with ownership falling back to order.

## What is safe to continue next (admin settings UI + final QA)
- All On The Clock engines (board, Team Need, Trade Analyzer incl. pick ownership) are code-complete and
  pure/tested. Remaining: the admin settings manager UI for on_the_clock_settings (mirrors FAAB) and
  end-to-end live-draft QA. Trade Analyzer projection discounts/caps are documented constants in
  trade-analyzer.ts (no admin control yet).

---

# Handoff: On The Clock (live Sleeper draft helper) - PHASE 6C (real Trade Analyzer) - CODE COMPLETE

## Phase 6C status (real Trade Analyzer) - CODE COMPLETE
All 9 tasks done at the code level (typecheck clean; 24 files / 247 tests pass, +23; build green). NOT
yet verified against a real active Sleeper draft. No admin UI, no value-pipeline change, no source/format
change, no Sleeper polling, no commits/pushes. Signal Check untouched. No mock panels remain in OTC.

What changed (6C):
- NEW lib/on-the-clock/trade-analyzer.ts - pure, browser-safe, deterministic value analyzer.
  - buildTradeCatalog(input) -> TradeItemGroup[]: pool-driven. Everyone => Startup Trade Builder
    ("Available players" + "Your upcoming startup picks" + "Future pick buckets"); Rookies => Rookie
    Draft Signal Check style ("Rookie players" + "Current rookie picks" + "Future rookie pick buckets").
    Players = FF Beacon value (not estimated). Current picks project from `available` via the existing
    snake/linear/3RR shape (pickNoForSeat): value = availSorted[max(0, overallPickNo - onTheClockPickNo)],
    only upcoming picks offered, estimated=true. Future buckets = poolSorted[(round-1)*teams +
    bucketSlot(bucket)-1] * futureDiscount(yearsAhead) (0.85^n), estimated=true, projected from the
    PRE-exclusion pool board. Empty board => [] (graceful unavailable). Documented constants:
    FALLBACK_PICK_VALUE=50, PLAYER_PICKER_CAP=200, bucketSlot (early/mid/late ~15/50/85%).
  - analyzeTradeSides(a,b) -> totals + diff/diffPct + lean (empty | fair<=5% | a/b-lean<=15% |
    a/b-strong>15%) + plain-English headline/detail (+ estimate note) + hasEstimates. Thresholds mirror
    the site trade analyzer. Did NOT import lib/trade-analyzer.ts (server-side, KTC-pick-based); reused
    only the threshold pattern. Signal Check pipeline untouched.
- NEW lib/on-the-clock/trade-analyzer.test.ts (23 tests).
- trade-analyzer.tsx rewritten: { pool, groups, boardReady }. Removed the "Sample data only" note;
  Startup Trade Builder / Rookie Draft Signal Check framing + "value signal, not a recommendation" +
  estimate notes. Native <select> add control (type-ahead search, keyboard + SR friendly). 5-bucket
  ResultPanel with aria-live result. Graceful EmptyCard when the board is not ready.
- on-the-clock-client.tsx: builds tradeGroups via buildTradeCatalog from the live board; passes
  groups + boardReady; <TradeAnalyzer key={`${draftId}-${pool}`}> so switching league OR pool resets
  both sides. Placed items snapshot their option, so a board reload never mutates a placed asset and a
  player drafted mid-build stays on the side with its value (documented).
- fixtures.ts: removed the dead MOCK_*_TRADE_GROUPS block. page.tsx + client header copy: no mock
  panels remain; Trade Analyzer pick values are projected/estimated.

Tasks: [x] 1 audit (OTC-T099) [x] 2/3/4/6 module (T100) [x] 5 UI (T101) [x] 7 state (T102)
[x] 8 tests (T103) [x] 9 checks (T104).

## Live-draft verification still pending (6C)
- Startup pick projections look sane on a real board (projected player names match expectations).
- Rookie mode catalog populates from a real rookie-pool board.
- Switching leagues mid-session clears the analyzer; a drafted-mid-build asset stays with its value.

## What is safe to continue next (admin settings UI + final QA)
- All On The Clock engines (board, Team Need, Trade Analyzer) are code-complete and pure/tested. The
  remaining work is the admin settings manager UI for on_the_clock_settings (mirrors FAAB; defaults in
  lib/on-the-clock/default-settings.ts) and end-to-end live-draft QA. The Trade Analyzer has NO tunable
  settings yet (projection discounts/caps are documented constants in trade-analyzer.ts); wire them into
  on_the_clock_settings later if admin control is wanted.

---

# Handoff: On The Clock (live Sleeper draft helper) - PHASE 6B (Team Need engine) - CODE COMPLETE

## Phase 6B status (Team Need recommendation engine) - CODE COMPLETE
All 8 tasks done at the code level (typecheck clean; 23 files / 224 tests pass, +33; build green). NOT
yet verified against a real active Sleeper draft. No Trade Analyzer (6C), no admin UI, no value-pipeline
changes, no source/format behavior change, no Sleeper polling, no commits/pushes.

What changed (6B):
- NEW lib/on-the-clock/recommend.ts - pure, deterministic engine. recommend() returns { best, need,
  aligned, rosterKnown, positionNeeds, debug }. Exported helpers: buildSlotModel, assignToSlots,
  slotFitFor, tallyPositions, isSuperflexFormat, isTepFormat, dstkRecommendable, reachScoreFor.
  - Team Need scoring: blended = wValue*valueScore + wNeed*needScore - wReach*reachScore (all 0-100,
    weights from on_the_clock_settings.recommendation.weights). valueScore = value rescaled across the
    available board. VORP: replacement[pos] = value of the league-wide last startable AVAILABLE player
    at that position (depth = teams * startableDepth, FLEX/SF folded into skill spots; QB depth gets SF
    only when superflex); vorScore rescaled 0-100. needScore = slotFit.factor * formatMult *
    (50 + 0.25*valueScore + 0.25*vorScore), rescaled 0-100. slotFit: dedicated open 1.0, FLEX/SF 0.7,
    bench-only 0.25. Deterministic tie-break: blended -> value -> position_rank -> id.
  - Slot model: from Sleeper draft.settings slots_qb/rb/wr/te/flex/super_flex/k/def (rec_flex folded
    into FLEX); fallback to settings.positionFallbackTargets. assignToSlots fills dedicated -> FLEX
    (RB/WR/TE) -> SUPER_FLEX (QB/RB/WR/TE) so a QB reduces SF need. have = my picks + seeded (dynasty).
  - SF/TEP/rookie: isSuperflexFormat (SF slot or slug ~ /sflex/) applies superflexQbMultiplier to QB
    need; isTepFormat (slug ~ /tep/) applies tePremiumMultiplier to TE need; rookies-only just runs on
    the caller's pre-filtered pool (need rescales within the eligible pool, no dynasty overreaction).
  - DST/K gate: dstkRecommendable() - default suppress_until_need = currentRound >= minRoundForDst/K
    AND (requireStartingSlot ? league has slot) AND team lacks one; "never"/"always_allowed" honored.
    Gated DST/K leave the Team-Need pool but stay in available + Best Available.
- NEW lib/on-the-clock/recommend.test.ts (33 tests).
- page.tsx passes the full admin `settings` to OnTheClockClient; partial-live notice now says only the
  Trade Analyzer is sample.
- on-the-clock-client.tsx: removed pickBestByValue + SampleBadge + the needSample stand-in; added
  coercePosition(); computes engine inputs from live cache + board; renders rec.best / rec.need, with a
  single "aligned" spotlight when value and need point at the same player.

Tasks: [x] 1 audit (OTC-T094) [x] 2-5 engine+scoring+slot model+DST/K (T095) [x] 6 UI wiring (T096)
[x] 7 tests (T097) [x] 8 checks (T098).

## Live-draft verification still pending (6B)
- Team Need recommends sensible players on a real draft across SF / TEP / dynasty-seeded / rookie pools.
- Seeded dynasty roster positions resolve from the board's sleeperId map for the user's real roster.
- DST/K surface as a Team-Need pick only in the late rounds when the league requires the slot.

## What is safe to continue next (Phase 6C - Trade Analyzer)
- recommend.ts is self-contained and pure; the Trade Analyzer can reuse RankedPlayer values + the board
  loader independently. Engine debug breakdowns are available for any future "why this pick" UI.

## Tunables (already in on_the_clock_settings, no admin UI yet)
- recommendation.weights (value/need/reach), aggressiveness, maxReachTierBreak, teamNeedEnabled.
- dstk.recommendBehavior / requireStartingSlot / minRoundForDst / minRoundForK.
- positionAdjust.superflexQbMultiplier / tePremiumMultiplier. positionFallbackTargets.
  Defaults live in lib/on-the-clock/default-settings.ts; the admin manager UI is a later phase.

---

# (Prior 6B in-progress note superseded above)

---

# Handoff: On The Clock (live Sleeper draft helper) - PHASE 6A.2 CODE-COMPLETE (force FF Beacon + format detect)

## Phase 6A.2 status (force FF Beacon source + auto-detect league format + DEF/K) - CODE COMPLETE
Owner approved 6A.2 only. Forced OTC value source to FF Beacon, auto-detect closest league format
from Sleeper (like Signal Check), removed user-facing source/format selectors, fixed DEF/K. All 8
tasks done at the code level (typecheck + 191 tests + build green). NOT 6B/6C, NO admin, NO
value-pipeline changes, NO commits/pushes. NOT yet verified against a real active Sleeper draft.

What changed (6A.2):
- board-loader.ts FORCES source='ffbeacon' (read regardless of is_active; sourceActive flag; missing
  row -> "source-unavailable"). Signature now { formatSlug, rookieSeason }. BOARD_ROW_CAP 500 -> 1500
  (K/DEF sit at overall_rank ~509-797; 500 truncated them out - the SECOND reason DEF/K were missing,
  beyond source selection).
- board-types.ts: BoardStatus + "source-unavailable"; BoardResult + sourceActive.
- NEW lib/on-the-clock/format-detect.ts (ffbeaconFormatCandidates + detectLeagueFormat). leagues route
  detects format per league from the already-fetched rich SleeperLeague (zero extra Sleeper calls);
  LeagueCard gains formatSlug/formatLabel/formatDerivedLabel/formatIsClosest.
- NEW GET /api/on-the-clock/board?format= (forces FF Beacon; header-guarded + feature-gated). Board
  moved out of page.tsx; client fetches it per-league on select (fetchBoard) and holds it in state.
- command-header: locked chips (Format auto-detected, Values=FF Beacon) + helper; no selectors.
- ffbeacon is_active is now TRUE in the DB, so the board renders fully and DEF/K appear live.

Tasks: [x] 1 audit (OTC-T088) [x] 2 force ffbeacon (T089) [x] 3+4 detect format + route ctx (T090)
[x] 5 remove selectors / board route (T091) [x] 6+7 DEF/K audit+fix (T092) [x] 8 tests (T093).

## Live-draft verification still pending (6A.2)
- DEF/K visible in available list / board / pick list / My Draft and removed when drafted, on a real
  draft (unit-verified; not live-verified).
- Format auto-detect matches the real Sleeper league (exact + closest paths).
- Closest-format path for a half-PPR / standard redraft league (ffbeacon supports only PPR redraft).

## What is safe to continue next (Phase 6B - Team Need engine)
- The real `available` board (FF Beacon, incl K/DEF) + deriveDraftState (myRosterId/mySlot + roster
  seed players) feed straight into lib/on-the-clock/recommend.ts. Replace the SAMPLE needCard in
  on-the-clock-client.tsx with the engine; add the late-round DST/K roster-need gate there.

---

# (Prior 6A.2 in-progress notes superseded above)

Key facts (audited OTC-T088):
- Root cause DEF/K missing: OTC used the GLOBAL source chain -> resolveSourceForFormat filters
  is_active -> picks KTC (no K/DEF); ffbeacon (has K/DEF) is is_active=false so never selected.
- FF Beacon slug = "ffbeacon" (FFBEACON_SOURCE_SLUG in lib/signal-check/format.ts; display "FF Beacon").
  Signal Check reads ffbeacon values REGARDLESS of source is_active (gates only on FORMAT active).
- Format detection utils: lib/sleeper-to-format.ts (deriveLeagueFormat/deriveFormatSlug/
  describeDerivedFormat/pickClosestSupportedFormat). Candidate set = ffbeacon supported_format_slugs
  INTERSECT active format_configs.
- ffbeacon has K (58) + DEF (32, sleeper id = team code "ARI"/"BUF"), real values. toDraftPosition
  already maps DEF/DST->DEF, K/PK->K; exclusion matches DEF team-code ids. So forcing ffbeacon fixes
  DEF/K with no loader-coercion change needed.
- leagues route already fetches rich SleeperLeague (scoring_settings/roster_positions) -> detect format
  there, zero extra Sleeper calls.

Plan: loader forces ffbeacon (read row regardless of is_active; admin note if inactive; graceful error
only if row/data missing). leagues route detects + returns per-league format. Board load moves to a
per-league GET /api/on-the-clock/board route fetched on league select. UI chips locked.

Task progress: [x] 1 audit (OTC-T088) [ ] 2 force ffbeacon [ ] 3 detect format [ ] 4 route context
[ ] 5 remove selectors [ ] 6 DEF/K audit [ ] 7 DEF/K fix [ ] 8 tests.

Files first: app/tools/on-the-clock/{page,on-the-clock-client,command-header}.tsx, lib/on-the-clock/
{board-loader,board-types,types,client}.ts, app/api/on-the-clock/leagues/route.ts, lib/sleeper-to-
format.ts, lib/signal-check/format.ts.

---

# (Prior) Handoff: On The Clock - PHASE 6A CODE-COMPLETE (real ranked board)

## Phase 6A status (real ranked-board loader) - CODE COMPLETE; live-draft verify pending
Owner approved 6A only. Replaced MOCK_AVAILABLE with the real FF Beacon ranked board (consume-only).
All 8 tasks done at the code level (typecheck + 181 tests + build all green). NOT 6B Team Need,
NOT 6C Trade Analyzer, NO admin, NO value-pipeline changes, NO commits/pushes.

Key facts (confirmed via MCP):
- SEASON LABEL IS NOT STALENESS (audited OTC-T087): rankings.season=2025 is a fixed board-season
  LABEL. rankings.generated_at, player_value_history.captured_at, and player_value_trends.updated_at
  are ALL today (daily). Production Rankings Board hardcodes SEASON=2025 (writer + reader). The OTC
  loader now uses the LATEST published ranking season per (format,source) as the board label and the
  UI never implies staleness. Values are always current (latest player_value_history row, which has
  no season column). Do NOT reintroduce currentNflSeason() for the board season.
- Only ffbeacon ranks K/DEF and it is is_active=false, so by DEFAULT the board shows only QB/RB/WR/TE;
  K/DEF appear once a K/DEF-ranking source is active. Loader includes them when present.
- Rookie = years_experience===0 (fallback draft_year===rookieSeason=currentNflSeason()). age from
  birth_date.
- format/source via the global resolver chain (OTC is /tools/, CLAUDE.md global-sync rule). League-
  auto-detected format is DEFERRED (needs the uncached rich Sleeper league object).
- Canonical query shape: app/rankings/page.tsx:114-228 (Rankings Board NOT changed).

Task progress: [x] 1 inspect (OTC-T080) [x] 2 loader (OTC-T081) [x] 3 exclusion (OTC-T082)
[x] 4 pools (OTC-T083) [x] 5 wire UI (OTC-T084) [x] 6 draft-shape (OTC-T085) [x] 7+8 tests/checks
(OTC-T086).

## What was just completed (Phase 6A)
- NEW lib/on-the-clock/board-types.ts (DraftPosition/RankedPlayer/RecommendationCardData/BoardResult;
  fixtures.ts re-exports). NEW lib/on-the-clock/board-loader.ts (loadRankedBoard, read-only).
- draft-derive.ts: excludeDrafted, filterPool, pickBestByValue (browser-safe, pure) + generalized
  draft shape (DraftShape/draftShapeFromMeta/isReversedRound/seatForPick/pickNoForSeat for
  snake/linear/3RR). draft-board.tsx uses the shared pickNoForSeat.
- page.tsx loads the board (global format/source chain) and passes BoardResult to the client.
- on-the-clock-client.tsx: available board + Best Available are REAL; Team Need is a labeled SAMPLE;
  Format/Source chips show resolved labels; empty/error/season-fallback states added.
- NEW board-loader.test.ts + extended draft-derive.test.ts. typecheck clean; 20 files/181 tests;
  build green (/tools/on-the-clock 21.6 kB).

## What stays MOCK after 6A
- Team Need spotlight (SAMPLE, clearly labeled) -> Phase 6B engine (lib/on-the-clock/recommend.ts).
- Trade Analyzer (mock) -> Phase 6C.

## What is safe to continue next (Phase 6B - Team Need engine)
- Build lib/on-the-clock/recommend.ts (VORP + slot-fill + reach + DST/K gate per ON-THE-CLOCK-PLAN
  section 7), consuming the real `available` board + the connected user's roster/picks (deriveDraftState
  already gives myRosterId/mySlot; rosters carry seed players). Replace the SAMPLE needCard in
  on-the-clock-client.tsx with the engine output. The available board, pool filter, and best-by-value
  are already real and feed straight in.

## Live-draft verification still pending (do NOT claim verified without a real active draft)
- Board excludes the right players as real picks land (player_id + sleeper-id + name-guard paths).
- Rookies-only pool matches the real rookie class for the league's season.
- snake/linear/3RR board ordering matches the real Sleeper board.
- K/DEF appear when a K/DEF-ranking source is active (today none active).

Files to inspect first: app/tools/on-the-clock/{on-the-clock-client,page}.tsx, lib/on-the-clock/
{board-loader,board-types,draft-derive}.ts, app/tools/on-the-clock/draft-board.tsx.

---

# (Prior) Handoff: On The Clock - PHASE 5 CODE-COMPLETE (live verify pending)

## Phase 5 status (live data wiring) - CODE COMPLETE; live-draft verification pending
Owner approved Phase 5. Scope: wire the existing cockpit to the existing Phase 3 routes + Supabase
Realtime. NO redesign, NO Phase 6 engine, NO real Trade Analyzer/Signal Check, NO admin, NO value
pipeline changes, NO auto Sleeper polling, NO commits/pushes. All 8 tasks done at the code level
(typecheck + 158 tests + build all green). Behavior against a REAL active Sleeper draft is NOT yet
verified (see the live-verification list lower in this file).

LIVE-wiring this phase: leagues lookup, draft cache load (warm+cold), Sync button, Realtime pick
merge, draft board, pick list, My Draft, on-the-clock status, my-team detection.
STAYS MOCK (clearly labeled "Sample data"): available Big Board, Best Available / Team Need
spotlight, Best remaining by position, Trade Analyzer. (Real ranked-board loader + recommendation
engine are the NEXT phase.)

ONE additive route change: leagues GET returns a top-level `userId` (resolved Sleeper user_id) so
the client can detect the user's team. Existing fields unchanged.

Task progress (ALL DONE - code-level; live-draft verification still pending):
- [x] Task 1 - inspect mocked UI/data flow (no code changed). progress.md OTC-T071.
- [x] Task 2 - username/search -> leagues route. OTC-T073.
- [x] Task 3 - league selection -> draft load. OTC-T074.
- [x] Task 4 - Sync button -> sync route. OTC-T075.
- [x] Task 5 - Supabase Realtime. OTC-T076.
- [x] Task 6 - recommendations + Trade Analyzer stay mock. OTC-T077.
- [x] Task 7 - feature-flag (503) clean state + enable path. OTC-T078.
- [x] Task 8 - tests/checks. OTC-T079.

## What was just completed (Phase 5)
The draft DATA flow is LIVE-wired (no commits/pushes). New/changed:
- NEW lib/on-the-clock/client.ts (fetchLeagues/fetchDraft/syncDraft, header guard, status->UI
  state mapping). NEW lib/on-the-clock/draft-derive.ts (pure: Realtime pick mapping + merge,
  on-the-clock/my-team derivation, sync status copy). NEW tests for both.
- cache.ts: exported shapePickRow (Realtime reuses the read-path shaper).
- leagues route: additive top-level `userId` (resolved Sleeper user_id) for my-team detection.
- on-the-clock-client.tsx: async state machine (connect/pick-league/room) with real fetches,
  Supabase Realtime subscription (postgres_changes on on_the_clock_pick_cache, filter
  sleeper_draft_id=eq.{id}), controlled sync + UI-only cooldown countdown, live-status fallback.
- sync-button.tsx -> controlled presentational. command-header.tsx -> threads the sync control.
- username-gate.tsx (error prop), league-picker.tsx (loading/error/refreshing/truncated).
- page.tsx: async; loads settings (feature gate + realtime + cooldown) + saved username; clean
  "not enabled yet" state when feature.enabled=false.

LIVE now: leagues lookup, draft cache load (warm+cold), Sync (synced/cooldown/synced-by-other/
served-cache/error), Realtime pick merge, draft board, pick list, My Draft, on-the-clock status,
connected-team detection. STILL MOCK (labeled "Sample data"): available Big Board, Best Available/
Team Need spotlight, Best remaining by position, Trade Analyzer.

Checks: typecheck clean; npm test 19 files / 158 tests pass; build green (/tools/on-the-clock 20.8
kB, 190 kB First Load).

## What is safe to continue next (after Phase 5)
- NEXT PHASE: the real ranked-board loader (consume rankings/player_value_history/player_value_
  trends keyed by resolved format+source+season, per ON-THE-CLOCK-PLAN section 4) to replace
  MOCK_AVAILABLE, then derive real Best Available (top value) from it, then the Phase 6/7 Team Need
  engine (lib/on-the-clock/recommend.ts). Then the real Trade Analyzer (reuse lib/trade-analyzer.ts
  for rookie mode; build the startup board-fill for startup mode). Then admin /admin/on-the-clock.
- The presentational components already take shaped props, so swapping MOCK_AVAILABLE/
  MOCK_RECOMMENDATIONS for real loaders is localized to on-the-clock-client.tsx + a new loader lib.

## Enable the feature for local/manual testing (service role / Supabase SQL editor)
insert into on_the_clock_settings (id, settings)
values ('global', '{"feature":{"enabled":true}}'::jsonb)
on conflict (id) do update set settings = on_the_clock_settings.settings
  || jsonb_build_object('feature', jsonb_build_object('enabled', true)), updated_at = now();
(loadOnTheClockSettings deep-merges over code defaults; set enabled false to turn it back off.)

## Live-draft verification still pending (do NOT claim done without a real active Sleeper draft)
- New picks appear after a Sync within one cooldown window and propagate to a 2nd browser via
  Realtime with no extra Sleeper call.
- Two browsers pressing Sync within the cooldown -> exactly one Sleeper fetch.
- Real my-team auto-detect from the user's roster; "your turn" / "Your pick" markers correct.
- Snake/3RR/linear seat ordering matches the real Sleeper board (current derivation is snake;
  linear/3RR approximated as snake - documented limitation).
- Real team display names per seat (board falls back to "Team N" until name resolution is polished).

Files to inspect first when resuming: app/tools/on-the-clock/on-the-clock-client.tsx, lib/on-the-
clock/{client,draft-derive,cache}.ts, app/tools/on-the-clock/page.tsx, the three routes under
app/api/on-the-clock/.

---

# (Prior) Handoff: On The Clock - PHASE 4.6 COMPLETE, PHASE 5 GATED

Active work: building the On The Clock feature, scoped to ON-THE-CLOCK-PLAN.md.
The prior Beacon Brief build is COMPLETE and recorded in progress.md (T843-T898);
this handoff is repurposed for the active feature.

## Read first (in this order)
1. CLAUDE.md (project rules: no em-dash, one shell cmd per call, RLS-in-migration,
   America/New_York time, mobile-first, source/format sync, MCP type-regen).
2. ON-THE-CLOCK-PLAN.md (the full feature plan; sections 9 + 12 = the DB + security
   contract we are building in Phase 1).
3. progress.md -> "On The Clock" section at the very bottom (OTC-T000+).

## What this feature is (one paragraph)
A public tool at /tools/on-the-clock that connects to a user's active Sleeper draft
and helps them draft using existing FF Beacon rankings/values. Supabase is the SHARED
cache/memory for active draft state (metadata + picks), synced through a server route
guarded by a durable 30s per-draft lock (SECURITY DEFINER RPC) so many viewers never
all hammer Sleeper. Manual "Sync Draft" button is the MVP refresh; Supabase Realtime
(Postgres Changes on the pick cache) fans new picks to co-viewers with NO Sleeper call.
DEF/K live in the room everywhere but are suppressed from recommendations except a
late-round roster-need case. Team Need uses VORP-normalized + slot-fill logic. Season
is dynamic via currentNflSeason()/getNflState(), never hardcoded.

## Current build state
- Phase 0 (safety audit) DONE. No blockers.
- Phase 4.6 (Trade Analyzer) COMPLETE. Added a mocked, pool-aware Trade Analyzer panel inside the
  draft cockpit as a THIRD room view (alongside "Who to pick" and "Drafted players"). New file
  trade-analyzer.tsx; new MOCK-ONLY fixtures in fixtures.ts; wired into on-the-clock-client.tsx as a
  tab (ArrowLeftRight icon). The analyzer mode follows the existing player-pool toggle: Everyone ->
  "Startup Value Check" (startup picks projected from the board + future buckets), Rookies only ->
  "Rookie Draft Signal Check" (rookie players + current-year rookie picks + future buckets). Build
  green (/tools/on-the-clock 17.2 kB); typecheck clean; 131 tests pass. NO Sleeper/Supabase/Signal-
  Check calls; fixtures only. NOT yet browser-verified this session (typecheck+build+tests only).
  Full screen-reader/axe pass still deferred to Phase 8.
- Phase 4.5 (premium draft-cockpit redesign) COMPLETE. Reworked the UI from tab-first into a
  DASHBOARD. New files: panel.tsx (cockpit Panel + StatReadout), player-spotlight.tsx (PlayerSpotlight
  + SecondaryPick), step-rail.tsx (onboarding stepper), dashboard-panels.tsx (DraftRoomStatus +
  BestRemainingByPosition). Reworked: on-the-clock-client.tsx (dashboard layout + section jump-nav,
  no primary tabs), command-header.tsx (premium control bar + on-the-clock banner), sync-button.tsx
  (polished + reduced-motion). fixtures.ts gained MOCK-ONLY spotlight fields (yearsExperience, age,
  recentFinishes, shortNote). DELETED recommendation-cards.tsx (replaced by the spotlight). Still
  fixtures-only, NO Sleeper/Supabase from the UI. typecheck clean; build green (/tools/on-the-clock
  12.9 kB); 131 tests pass. VISUALLY VERIFIED in a real browser (looks like a premium draft HQ).
  Accessibility preserved (semantic tables, heading outline, aria-current steps, live regions,
  reduced-motion, 44px, landmarks). Full screen-reader/axe pass still deferred to Phase 8.
- Phase 4 (mocked UI shell) COMPLETE (superseded visually by 4.5). Tool registered in lib/site.ts +
  app/tools/page.tsx.
- Phase 3 (API routes) COMPLETE. Three routes under app/api/on-the-clock/: leagues/route.ts
  (GET), draft/route.ts (GET read), draft/sync/route.ts (POST). All use createAdminClient()
  server-side only, require x-requested-with: ff-beacon, validate via lib/on-the-clock/validation,
  gate on settings.feature.enabled (OFF -> 503), private/no-store. Route tests added (23) +
  vitest.config include extended to app/**. `npm run typecheck` clean; `npm test` = 17 files /
  131 tests pass; `npm run build` green (routes emitted). Live-draft behavior NOT yet tested
  against a real active Sleeper draft.
- Phase 2 (server utilities + settings layer) COMPLETE. lib/on-the-clock/{types,default-settings,
  settings,validation,cache,sleeper-sync}.ts, lib/players/sleeper-map.ts, getSleeperDraftPicks in
  lib/sleeper.ts. Settings ship OFF (feature.enabled default false).
- Phase 1 (Supabase cache foundation) DONE: migrations 0106-0114 applied via
  MCP AND written to supabase/migrations/. All RLS + RPC + lock semantics verified via
  live SQL (see progress.md "Phase 1 verification" - all PASS). Last step (OTC-T016,
  regenerate lib/database.types.ts) was delegated to a sub-agent and may still be
  finishing; confirm it wrote the 4 new tables + 5 new functions before declaring Phase 1
  fully closed. [DONE: types regenerated, 3835 lines, all 4 tables + 5 functions present,
  npm run typecheck clean. PHASE 1 IS FULLY COMPLETE.]
- No app/lib/UI code yet (that is Phase 2+, which needs owner approval first).
- Two issues were found AND FIXED during verification:
  1. claim_on_the_clock_sync ambiguous column ref (RETURNS TABLE out-col shadowed the
     table col in the UPDATE WHERE) -> aliased target `as c`, qualified refs. 0110 file fixed.
  2. SECURITY: `revoke ... from public` left anon/authenticated EXECUTE on the SECURITY
     DEFINER RPCs (Supabase default privilege). Migration 0114 revokes them; re-verified
     service_role-only. If you add more On The Clock RPCs, remember to revoke from
     public, anon, authenticated explicitly, not just public.

## Trade Analyzer (Phase 4.6) - architecture note: UI/MOCK ONLY

What shipped is presentation only. There is NO trade math, NO pick-value lookup, NO Signal Check
call, NO Sleeper/Supabase access behind it. Every number is a fixture constant. The future (post
Phase 5) implementation must:
- ROOKIE MODE: reuse the existing Signal Check trade analyzer endpoints / lib (lib/trade-analyzer.ts
  -> analyzeTrade, which already reads player values from player_value_trends and pick values from
  draft_pick_values keyed by the resolved pick source). Do NOT duplicate trade-analyzer logic in the
  On The Clock tree. Current-year rookie picks get FF Beacon draft_pick_values by their bucket/slot;
  future picks use FF Beacon pick value buckets (source-resolved, KTC for picks today).
- STARTUP MODE: there is no startup-pick projection engine yet. The real version virtually fills the
  remaining draft board pick-by-pick using FF Beacon values, assigns each startup pick the projected
  player/value at that board position, sums each side, and reports which side carries more value.
  Keep it framed as a VALUE CHECK, never a recommendation/demand (the copy already does this).
- Use FF Beacon source values for future pick buckets; respect the user's selected source where the
  rest of the room does.
- The component tree (trade-analyzer.tsx + the TradeItemOption/TradeItemGroup shapes in fixtures.ts)
  is built so Phase 5+ swaps the fixture group constants for real (source-resolved) option lists and
  the local sum for analyzeTrade output, without changing the presentational layer.

Files: app/tools/on-the-clock/trade-analyzer.tsx (component), fixtures.ts (MOCK_STARTUP_TRADE_GROUPS
/ MOCK_ROOKIE_TRADE_GROUPS / MOCK_FUTURE_PICK_GROUP + the TradeItem* types), on-the-clock-client.tsx
(the "trade" view tab + tabpanel). Inspect these first when wiring the real analyzer.

## Phase 0 findings that drive Phase 1
- Next migration number = 0106 (0105 is the highest on disk + applied; duplicate file
  prefixes at 0028/0029/0100-0103 are cosmetic - DB ledger keys on timestamps).
- on_the_clock_settings copies supabase/migrations/0105_faab_calculator_settings.sql
  (single-row id='global' jsonb, service-role-only RLS, defaults in code).
- Sync-lock RPC copies supabase/migrations/0026_try_claim_league_resync.sql (SECURITY
  DEFINER, search_path=public, conditional ON CONFLICT window guard, revoke-from-public
  + grant execute). Ledger table copies 0025_league_resync_attempts.sql.
- No supabase_realtime publication migration exists; use `alter publication
  supabase_realtime add table ...` (Supabase provisions the publication by default).
- Type regen: MCP generate_typescript_types -> extract `.types` -> write
  lib/database.types.ts -> `npx prettier --write`.

## Phase 1 task plan (one atomic migration per file) - ALL APPLIED + FILE-WRITTEN
0106 on_the_clock_settings           [DONE]
0107 on_the_clock_draft_cache        [DONE]
0108 on_the_clock_pick_cache         [DONE]
0109 on_the_clock_lookup_attempts    [DONE]
0110 sync-lock RPCs (claim/complete/release) [DONE - claim def fixed for col ambiguity]
0111 try_claim_on_the_clock_lookup RPC       [DONE]
0112 enable Realtime on pick cache           [DONE]
0113 cleanup/TTL function (deletion only)    [DONE]
0114 RPC EXECUTE hardening (anon/auth revoke) [DONE - added during verification]
verify RLS + RPC semantics via SQL [DONE, all PASS], regenerate database.types.ts [OTC-T016, delegated].

## What is safe to continue next
Phase 4 is the stop point. WAIT for explicit owner approval before Phase 5 (live data wiring).
When approved, Phase 5 swaps fixtures for the Phase 3 routes WITHOUT changing the component tree:
  - username-gate onConnect -> GET /api/on-the-clock/leagues (set x-requested-with: ff-beacon).
  - league-picker selection -> the card already carries draftId+leagueId+season.
  - room load -> GET /api/on-the-clock/draft?draft_id= (warm read).
  - SyncButton -> POST /api/on-the-clock/draft/sync with {draft_id, league_id, season}; drive the
    status line from the returned status + cooldownRemainingSeconds + lastSyncedAt.
  - Realtime: subscribe to on_the_clock_pick_cache filtered by sleeper_draft_id; merge INSERT/UPDATE
    rows into local picks + recompute available WITHOUT calling Sleeper.
  - Replace the static board loader / RankedPlayer fixture with the real ranked board (Phase 5/6).
  - Remember: all routes 503 until settings.feature.enabled=true; set a settings row to test live.
Component prop shapes already match the shaped wire types (ShapedDraftCache/ShapedPick/LeagueCard),
so the swap is mostly replacing the fixture reads in on-the-clock-client.tsx with fetches + state.

## Phase 4 / 4.5 deliverables (DONE - reference)
app/tools/on-the-clock/{page,on-the-clock-client,username-gate,league-picker,command-header,
sync-button,player-spotlight,panel,step-rail,dashboard-panels,available-list,draft-board,pick-list,
my-draft,on-the-clock-card,trade-analyzer,states}.tsx + fixtures.ts. (recommendation-cards.tsx was
DELETED in 4.5; trade-analyzer.tsx added in 4.6.)
- The room is a DASHBOARD with a SWITCHED content area + persistent right rail: command bar, then a
  view switcher (WAI-ARIA tabs) -> "Who to pick" (Draft Signal hero + Available big board, default)
  or "Drafted players" (Board <-> List sub-toggle = native draft board OR pick list). Right rail
  (DraftRoomStatus / BestRemainingByPosition / Your draft) is persistent across views. (4.6 replaced
  the earlier section jump-nav with this in-place view switcher so the room is not one long scroll.)
- Player-pool toggle is card-style with icons (Everyone/Users, Rookies/Baby) in the command bar.
- Pick list (List view): narrow pick/round column, Player ahead of Team.
- ALL fixture reads live in on-the-clock-client.tsx (MOCK_LEAGUES / MOCK_DRAFT_CACHE / MOCK_AVAILABLE
  / MOCK_RECOMMENDATIONS / MOCK_CONNECTED_USER / MOCK_SYNC_STATUS). Phase 5 replaces THOSE reads with
  route fetches + Realtime; the presentational components below take the same shaped props.
- Live-region strategy STUBBED: polite channel in SyncButton + available-list count; assertive "your
  turn" channel (sr-only role=alert) in command-header.
- player-spotlight is a PLACEHOLDER fed by RecommendationCardData fixtures; the engine is Phase 6.
- Spotlight enrichment (yearsExperience/age/recentFinishes/shortNote) is MOCK-ONLY and each section
  hides when its data is absent, so Phase 5/6 can populate-or-omit without breaking the feature.

## API contract (Phase 3, for the Phase 4/5 client to consume)
- GET /api/on-the-clock/leagues?username=&season=  (header x-requested-with: ff-beacon)
  -> 200 { ok, season, leagues: LeagueCard[], truncated } | 400 | 403 | 404 | 429 | 503
  LeagueCard = { leagueId, draftId, season, name, totalRosters, avatar, draftStatus }.
- GET /api/on-the-clock/draft?draft_id=  (header guard)
  -> 200 { ok, cache: ShapedDraftCache } | 400 | 403 | 404 | 503. No Sleeper on warm reads.
- POST /api/on-the-clock/draft/sync  body { draft_id, league_id?, season? }  (header guard)
  -> 200 { ok, status, cooldownRemainingSeconds, lastSyncedAt, cache, error? } | 400 | 403 | 500.
  status is the SyncStatus union. Pass league_id+season (from the card) for the no-pre-fetch claim.
- Every client fetch MUST send `x-requested-with: ff-beacon` or it gets 403.
- All routes 503 while settings.feature.enabled is false (default). To exercise the live UI in
  dev, set an on_the_clock_settings row with feature.enabled=true (service role / admin).

## Phase 2 deliverables (DONE - reference for Phase 3+)
- Settings stack mirrors lib/faab/: types.ts (OnTheClockSettings nested groups +
  ShapedDraftCache wire types), default-settings.ts (DEFAULT_ON_THE_CLOCK_SETTINGS, ships
  OFF), settings.ts (zod per-field defaults, validateOnTheClockSettings + loadOnTheClockSettings).
- validation.ts: isValidUsername/Season/LeagueId/DraftId, normalizeUsername,
  sanitizeSleeperPlayerId(s). Use these in every route before any fetch/RPC.
- cache.ts: claimSync/completeSync/releaseSync/claimLookup (service-role only) +
  readDraftCache/shapeDraftCache (any client; whitelisted wire fields).
- sleeper-sync.ts: performDraftSync(admin, {draftId, leagueId?, season?, cooldownSeconds,
  lockSeconds}) -> SyncOutcome. Server-only. The Phase 3 sync + warm paths call this.
- lib/players/sleeper-map.ts: mapSleeperToPlayerIds (numeric + DST "BUF", sanitized .or(),
  partial-tolerant). DEVIATION from the ".in() preferred" hint is documented in the file
  header and progress.md OTC-T022 (json-path column can't be expressed via typed .in()).
- getSleeperDraftPicks added to lib/sleeper.ts.

## KEY DECISION for Phase 3 (leagues route inputs)
performDraftSync prefers caller-supplied leagueId+season (so the claim happens with no
pre-fetch and the lock fully collapses Sleeper calls). The leagues route should return
each league's draft_id ALONGSIDE its league_id + season so the client can pass all three
to the sync/draft routes. The sync route can still work with only draft_id (it resolves
league/season via one getSleeperDraft call), but passing all three is the efficient path.

## Decisions already locked (do not re-litigate)
- RPC EXECUTE grants: service_role ONLY (all four On The Clock RPCs are called
  server-side via createAdminClient; the browser never calls them). This is tighter
  than the league pattern which also granted to authenticated.
- Cache tables (draft_cache, pick_cache): RLS on, PUBLIC SELECT (required for Realtime
  / Postgres Changes is RLS-governed), NO anon/auth writes (writes only via SECURITY
  DEFINER RPC + service role).
- settings + lookup_attempts: service-role-only, no public access.
- Cleanup is deletion-only; do NOT wire a per-draft/per-league recompute cron. Cron
  wiring for cleanup is deferred (plan says avoid complicated cron wiring); the
  function ships and is documented as callable from the existing cron later.

## Blockers / decisions needed
None right now. After Phase 1 completes, STOP and report; await owner approval
before Phase 2.

## Verification gate (every session)
`npm run typecheck` then `npm run build`. Do not commit, do not push. Env in
.env.local uses SUPABASE_PUBLISHABLE_KEY / SUPABASE_SECRET_KEY (never anon/service_role
names). Supabase project cilvpyivysjxpxbudkfa (wired into .mcp.json).
